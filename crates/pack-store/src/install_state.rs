//! Installed-state and removal bookkeeping for packs. Everything here only
//! moves app-owned version directories to an app-owned trash folder.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::download_state::{DownloadPhase, DownloadRecord};
use crate::error::{map_io, PackError, PackResult};
use crate::install::{retire_to_trash, ActiveVersion, ActiveVersions};
use crate::types::{PackCatalog, PackId, PackState, PackStatePhase};

fn pending_marker(root: &Path, id: PackId) -> PathBuf {
    root.join("pending-remove")
        .join(format!("{}.json", id.as_str()))
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingRemove {
    schema_version: u32,
    pack_id: PackId,
}

/// Remember that removal was requested while leases were still open.
pub fn mark_pending_remove(root: &Path, pointer: &ActiveVersion) -> PackResult<()> {
    let path = pending_marker(root, pointer.pack_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| map_io(&error))?;
    }
    let marker = PendingRemove {
        schema_version: 1,
        pack_id: pointer.pack_id,
    };
    let bytes = serde_json::to_vec(&marker).map_err(|_| PackError::Failed)?;
    crate::download_state::write_atomic(&path, &bytes)
}

pub fn clear_pending_remove(root: &Path, id: PackId) -> PackResult<()> {
    match std::fs::remove_file(pending_marker(root, id)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(map_io(&error)),
    }
}

pub fn is_pending_remove(root: &Path, id: PackId) -> bool {
    pending_marker(root, id).exists()
}

/// Retire every app-owned version of one pack and clear its pointer. The
/// whole pack is removed only after the last lease closes; each version
/// directory is moved to trash, never permanently deleted in place.
pub fn retire_active_version(root: &Path, id: PackId) -> PackResult<()> {
    let versions = root.join("versions").join(id.as_str());
    if versions.is_dir() {
        for entry in std::fs::read_dir(&versions).map_err(|error| map_io(&error))? {
            let entry = entry.map_err(|error| map_io(&error))?;
            if entry.file_type().map_err(|error| map_io(&error))?.is_dir() {
                retire_to_trash(root, &entry.path(), "removed")?;
            }
        }
        let _ = std::fs::remove_dir(&versions);
    }
    let active = ActiveVersions::new(root);
    active.clear(id)?;
    clear_pending_remove(root, id)?;
    Ok(())
}

/// Build the Settings > App storage rows from the catalog, active pointers,
/// pending removals and download records. No row invents an installed state.
pub fn scan_states(
    packs_root: &Path,
    catalog: &PackCatalog,
    downloads: &[DownloadRecord],
    leased: impl Fn(PackId) -> u32,
) -> PackResult<Vec<PackState>> {
    let active = ActiveVersions::new(packs_root);
    let mut seen_ids = HashSet::new();
    let mut ids = Vec::new();
    for descriptor in &catalog.packs {
        if seen_ids.insert(descriptor.id) {
            ids.push(descriptor.id);
        }
    }
    // An installed version stays visible and removable even after a catalog
    // refresh no longer offers it.
    for id in active.list_ids()? {
        if seen_ids.insert(id) {
            ids.push(id);
        }
    }
    for record in downloads {
        if seen_ids.insert(record.pack_id) {
            ids.push(record.pack_id);
        }
    }
    let mut rows = Vec::new();
    for id in ids {
        let mut row = PackState::absent(id);
        row.available_version = catalog.newest(id).map(|pack| pack.version.clone());
        if let Some(pointer) = active.read(id)? {
            row.installed_version = Some(pointer.version.clone());
            row.installed_unix = Some(pointer.activated_unix);
        }
        let latest_download = downloads.iter().find(|record| record.pack_id == id);
        if let Some(record) = latest_download {
            row.bytes_received = record.bytes_received;
            row.error_code = if record.state == DownloadPhase::Failed {
                Some("packs.failed".to_string())
            } else {
                None
            };
        }
        row.state = if is_pending_remove(packs_root, id) {
            PackStatePhase::PendingRemove
        } else if row.installed_version.is_some() {
            PackStatePhase::Installed
        } else if let Some(record) = latest_download {
            match record.state {
                DownloadPhase::Downloading => PackStatePhase::Downloading,
                DownloadPhase::Paused => PackStatePhase::Paused,
                DownloadPhase::Verifying => PackStatePhase::Verifying,
                DownloadPhase::Failed => PackStatePhase::Failed,
            }
        } else {
            PackStatePhase::Absent
        };
        row.leased_count = leased(id);
        rows.push(row);
    }
    Ok(rows)
}
