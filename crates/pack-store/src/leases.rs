//! Pack leases pin one verified immutable version. A leased version is never
//! removed; removal becomes pending until every lease closes. No serializable
//! executable path ever leaves this module.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::error::{PackError, PackResult};
use crate::install::{
    clear_pending_remove, is_pending_remove, mark_pending_remove, retire_active_version,
    ActiveVersion, ActiveVersions,
};
use crate::inventory::capability_path;
use crate::types::{PackDescriptor, PackId};
use crate::validation::validate_capability;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveOutcome {
    /// Other leases still hold the version; the pack is pending removal.
    Pending,
    /// No lease remained and the version was retired.
    Removed,
}

#[derive(Debug, Default, Clone, Copy)]
struct LeaseState {
    count: u32,
    pending_remove: bool,
}

/// Process-wide lease table for the shared `<packs>` root. One table serves
/// every profile so switching profiles cannot uninstall a leased engine.
pub struct PackLeases {
    root: PathBuf,
    table: Arc<Mutex<HashMap<PackId, LeaseState>>>,
}

impl PackLeases {
    pub fn new(packs_root: &Path) -> Self {
        Self {
            root: packs_root.to_path_buf(),
            table: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn lease_count(&self, id: PackId) -> u32 {
        self.table
            .lock()
            .map(|table| table.get(&id).map(|state| state.count).unwrap_or(0))
            .unwrap_or(0)
    }

    /// Pin the exact active version and capability. Refuses a pending
    /// removal and any descriptor/pointer mismatch before the count grows.
    pub fn acquire(
        &self,
        pointer: &ActiveVersion,
        descriptor: &PackDescriptor,
        capability: &str,
    ) -> PackResult<PackLease> {
        if is_pending_remove(&self.root, pointer.pack_id) {
            return Err(PackError::Busy);
        }
        validate_capability(descriptor, capability)?;
        if pointer.pack_id != descriptor.id
            || pointer.version != descriptor.version
            || pointer.descriptor_sha256 != descriptor.digest()
        {
            return Err(PackError::Changed);
        }
        let version_root = ActiveVersions::new(&self.root).version_root(pointer)?;
        let _entry = capability_path(&version_root, descriptor, capability)?;
        let mut table = self.table.lock().map_err(|_| PackError::Failed)?;
        let state = table.entry(pointer.pack_id).or_default();
        if state.pending_remove {
            return Err(PackError::Busy);
        }
        state.count = state.count.saturating_add(1);
        drop(table);
        Ok(PackLease {
            pack_id: pointer.pack_id,
            version: pointer.version.clone(),
            root: version_root,
            descriptor: descriptor.clone(),
            table: Arc::clone(&self.table),
            released: false,
            packs_root: self.root.clone(),
        })
    }

    /// Mark a pack for removal. New leases are refused immediately; an
    /// installed version is retired only after the last current lease closes.
    pub fn request_remove(
        &self,
        pointer: &ActiveVersion,
        cancel_queued: &dyn Fn(PackId),
    ) -> PackResult<RemoveOutcome> {
        cancel_queued(pointer.pack_id);
        let count = {
            let mut table = self.table.lock().map_err(|_| PackError::Failed)?;
            let state = table.entry(pointer.pack_id).or_default();
            state.pending_remove = true;
            state.count
        };
        mark_pending_remove(&self.root, pointer)?;
        if count > 0 {
            return Ok(RemoveOutcome::Pending);
        }
        retire_active_version(&self.root, pointer.pack_id)?;
        if let Ok(mut table) = self.table.lock() {
            table.remove(&pointer.pack_id);
        }
        Ok(RemoveOutcome::Removed)
    }

    /// The user changed their mind before the last lease closed.
    pub fn cancel_remove(&self, id: PackId) -> PackResult<()> {
        clear_pending_remove(&self.root, id)?;
        if let Ok(mut table) = self.table.lock() {
            if let Some(state) = table.get_mut(&id) {
                state.pending_remove = false;
            }
        }
        Ok(())
    }

    pub fn is_pending_remove(&self, id: PackId) -> bool {
        is_pending_remove(&self.root, id)
    }

    /// Finish removals that were waiting only for leases in a previous app
    /// run. The table is empty at startup, so an existing pending marker can
    /// be retired safely; a failure leaves the marker for the next attempt.
    pub fn complete_pending_removals(&self) -> PackResult<Vec<PackId>> {
        let directory = self.root.join("pending-remove");
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(crate::error::map_io(&error)),
        };
        let mut completed = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(id) = PackId::parse(stem) else {
                continue;
            };
            if self.lease_count(id) != 0 {
                continue;
            }
            retire_active_version(&self.root, id)?;
            if let Ok(mut table) = self.table.lock() {
                table.remove(&id);
            }
            completed.push(id);
        }
        Ok(completed)
    }
}

/// A pinned pack version. Dropping it releases the lease exactly once and
/// finishes a pending removal when it was the last user.
pub struct PackLease {
    pack_id: PackId,
    version: String,
    root: PathBuf,
    descriptor: PackDescriptor,
    table: Arc<Mutex<HashMap<PackId, LeaseState>>>,
    released: bool,
    packs_root: PathBuf,
}

impl PackLease {
    pub fn id(&self) -> PackId {
        self.pack_id
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Revalidate resources before a helper receives read access to the tree.
    pub fn verify_inventory(&self) -> PackResult<()> {
        crate::inventory::verify_tree(&self.root, &self.descriptor)
    }

    /// Resolve a fixed capability, revalidating the entrypoint's hash before
    /// a trusted native caller launches it.
    pub fn entrypoint(&self, capability: &str) -> PackResult<PathBuf> {
        capability_path(&self.root, &self.descriptor, capability)
    }

    fn release(&mut self) {
        if self.released {
            return;
        }
        self.released = true;
        let retire = {
            let mut table = match self.table.lock() {
                Ok(table) => table,
                Err(_) => return,
            };
            let Some(state) = table.get_mut(&self.pack_id) else {
                return;
            };
            state.count = state.count.saturating_sub(1);
            let retire = state.pending_remove && state.count == 0;
            if retire {
                table.remove(&self.pack_id);
            }
            retire
        };
        if retire {
            let _ = retire_active_version(&self.packs_root, self.pack_id);
        }
    }
}

impl Drop for PackLease {
    fn drop(&mut self) {
        self.release();
    }
}
