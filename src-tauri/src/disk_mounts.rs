//! Guarded read-only mount lifecycle (Step 09j T2).
//!
//! The registry owns every mount the app created, its source identity and
//! the handle that keeps the attachment alive. Windows work lives behind
//! `DiskHost` so the lifecycle rules (limits, reuse, source recheck,
//! eject safety) are testable without touching a real disk.
//!
//! No path here is trusted because the UI sent it: the request is
//! validated again, the source stamp is captured before and after the
//! attach, and an image that changed is never reported as mounted.
#![allow(dead_code)]


use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use fs_service::{CancellationToken, OpProgress, SourceStamp};

use crate::disk_image_types::{
    expected_matches, same_stamp, DiskImageKind, EjectResult, MountRequest, MountResult, MountState,
    MountedImage, MAX_APP_MOUNTS, MAX_VOLUME_ROOTS, VOLUME_WAIT_SECONDS,
};

/// One attachment the lifecycle keeps alive. Detaching twice must not
/// happen; the registry drops the handle with the record.
pub trait MountHandle: Send {
    /// Ask Windows to detach. An error keeps the mount listed.
    fn detach(&mut self) -> Result<(), String>;
}

/// What one attach attempt produced. `External` describes an image some
/// other program mounted: it is reported, never detached by the app.
pub enum AttachOutcome {
    Attached {
        handle: Box<dyn MountHandle>,
        physical_path: String,
        volume_roots: Vec<String>,
        brokered: bool,
    },
    External {
        physical_path: String,
        volume_roots: Vec<String>,
    },
    NeedsElevation,
    Failed(String),
}

/// The Windows-facing side of the lifecycle.
pub trait DiskHost: Send + Sync {
    fn capture_stamp(&self, path: &Path) -> Result<SourceStamp, String>;
    fn classify(&self, path: &Path) -> Result<DiskImageKind, String>;
    fn attach(
        &self,
        path: &Path,
        kind: DiskImageKind,
        stamp: &SourceStamp,
        allow_elevation: bool,
        token: &CancellationToken,
        progress: &mut dyn FnMut(u64),
    ) -> AttachOutcome;
    /// Open documents of this app whose authorized source lies on one of
    /// the volume roots. The 09a store provides the real implementation.
    fn documents_under(&self, roots: &[String]) -> Vec<String>;
}

struct Record {
    image: MountedImage,
    handle: Option<Box<dyn MountHandle>>,
}

#[derive(Default)]
struct Inner {
    records: BTreeMap<String, Record>,
    /// Slots reserved by a mount that is still attaching.
    reserved: usize,
}

/// The app's mount registry (managed state behind an `Arc`).
pub struct DiskMounts {
    inner: Mutex<Inner>,
    host: std::sync::Arc<dyn DiskHost>,
}

impl DiskMounts {
    pub fn new(host: std::sync::Arc<dyn DiskHost>) -> Self {
        DiskMounts {
            inner: Mutex::new(Inner::default()),
            host,
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "disk mount registry lock poisoned".to_string())
    }

    /// Every mount the app knows, owned or external, without changing it.
    pub fn list(&self) -> Result<Vec<MountedImage>, String> {
        let inner = self.lock()?;
        Ok(inner.records.values().map(|r| r.image.clone()).collect())
    }

    fn find_same(&self, stamp: &SourceStamp) -> Result<Option<MountedImage>, String> {
        let inner = self.lock()?;
        Ok(inner
            .records
            .values()
            .find(|r| same_stamp(&r.image.source, stamp))
            .map(|r| r.image.clone()))
    }

    fn owned_count(&self, inner: &Inner) -> usize {
        inner.records.values().filter(|r| r.image.owned).count() + inner.reserved
    }

    /// Mount one image read-only. Expected failures are a `MountResult`
    /// with `mount: null`; only an internal registry failure is `Err`.
    pub fn mount(
        &self,
        request: &MountRequest,
        token: &CancellationToken,
        progress: &mut dyn FnMut(OpProgress),
    ) -> Result<MountResult, String> {
        request.validate()?;
        let path = Path::new(&request.path);
        let kind = match self.host.classify(path) {
            Ok(kind) => kind,
            Err(code) => return Ok(MountResult::failed(&code)),
        };
        let before = match self.host.capture_stamp(path) {
            Ok(stamp) => stamp,
            Err(code) => return Ok(MountResult::failed(&code)),
        };
        if let Some(expected) = &request.expected {
            if !expected_matches(expected, &before) {
                return Ok(MountResult::failed("disk.changed"));
            }
        }
        if let Some(existing) = self.find_same(&before)? {
            return Ok(MountResult::mounted(existing));
        }

        // Reserve the slot before releasing the lock, so two simultaneous
        // mounts can never exceed the app-wide limit.
        {
            let mut inner = self.lock()?;
            if self.owned_count(&inner) >= MAX_APP_MOUNTS {
                return Ok(MountResult::failed("disk.unavailable"));
            }
            inner.reserved += 1;
        }
        let _reservation = Reservation { mounts: self };

        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(MountResult::failed("disk.cancelled"));
        }
        progress(OpProgress {
            items_done: 0,
            items_total: VOLUME_WAIT_SECONDS as usize,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });

        let outcome = self.host.attach(
            path,
            kind,
            &before,
            request.allow_elevation,
            token,
            &mut |seconds| {
                progress(OpProgress {
                    items_done: seconds.min(VOLUME_WAIT_SECONDS) as usize,
                    items_total: VOLUME_WAIT_SECONDS as usize,
                    bytes_done: 0,
                    bytes_total: 0,
                    current: String::new(),
                });
            },
        );

        if token.load(std::sync::atomic::Ordering::Relaxed) {
            // A cancelled mount never leaves an attachment of ours behind.
            if let AttachOutcome::Attached { mut handle, .. } = outcome {
                let _ = handle.detach();
            }
            return Ok(MountResult::failed("disk.cancelled"));
        }

        match outcome {
            AttachOutcome::Failed(code) => Ok(MountResult::failed(&code)),
            AttachOutcome::NeedsElevation => Ok(MountResult::elevation_required()),
            AttachOutcome::External {
                physical_path,
                volume_roots,
            } => {
                let Some(volume_roots) = checked_roots(volume_roots) else {
                    return Ok(MountResult::failed("disk.unavailable"));
                };
                let image = MountedImage {
                    mount_id: uuid::Uuid::new_v4().to_string(),
                    source: before,
                    kind,
                    volume_roots,
                    physical_path,
                    readonly: true,
                    owned: false,
                    state: MountState::Mounted,
                    brokered: false,
                };
                // Another program mounted it; report it, keep no handle.
                let image = self.insert_if_absent(image)?;
                Ok(MountResult::mounted(image))
            }
            AttachOutcome::Attached {
                handle,
                physical_path,
                volume_roots,
                brokered,
            } => {
                let after = match self.host.capture_stamp(path) {
                    Ok(stamp) => stamp,
                    Err(code) => {
                        let mut handle = handle;
                        let _ = handle.detach();
                        return Ok(MountResult::failed(&code));
                    }
                };
                if !same_stamp(&before, &after) {
                    let mut handle = handle;
                    let _ = handle.detach();
                    return Ok(MountResult::failed("disk.changed"));
                }
                let mut handle = handle;
                if let Some(existing) = self.find_same(&before)? {
                    // A parallel request mounted the same image first.
                    let _ = handle.detach();
                    return Ok(MountResult::mounted(existing));
                }
                let Some(volume_roots) = checked_roots(volume_roots) else {
                    let _ = handle.detach();
                    return Ok(MountResult::failed("disk.unavailable"));
                };
                let image = MountedImage {
                    mount_id: uuid::Uuid::new_v4().to_string(),
                    source: before,
                    kind,
                    volume_roots,
                    physical_path,
                    readonly: true,
                    owned: true,
                    state: MountState::Mounted,
                    brokered,
                };
                let mut inner = self.lock()?;
                inner.records.insert(
                    image.mount_id.clone(),
                    Record {
                        image: image.clone(),
                        handle: Some(handle),
                    },
                );
                Ok(MountResult::mounted(image))
            }
        }
    }

    fn insert_if_absent(&self, image: MountedImage) -> Result<MountedImage, String> {
        let mut inner = self.lock()?;
        if let Some(existing) = inner
            .records
            .values()
            .find(|r| same_stamp(&r.image.source, &image.source))
        {
            return Ok(existing.image.clone());
        }
        inner.records.insert(
            image.mount_id.clone(),
            Record {
                image: image.clone(),
                handle: None,
            },
        );
        Ok(image)
    }

    /// Eject only an app-owned mount whose full source identity still
    /// matches. Open documents under the volume stop the eject with
    /// `disk.in_use` and the mount stays listed.
    pub fn eject(&self, mount_id: &str) -> Result<EjectResult, String> {
        if uuid::Uuid::parse_str(mount_id).is_err() {
            return Err("disk.denied".to_string());
        }
        let (image, mut handle) = {
            let mut inner = self.lock()?;
            let record = match inner.records.get_mut(mount_id) {
                Some(record) => record,
                None => return Err("disk.denied".to_string()),
            };
            if !record.image.owned {
                return Err("disk.denied".to_string());
            }
            let Some(handle) = record.handle.take() else {
                return Err("disk.in_use".to_string());
            };
            let image = record.image.clone();
            record.image.state = MountState::Ejecting;
            (image, handle)
        };

        let current = match self.host.capture_stamp(Path::new(&image.source.path_key)) {
            Ok(stamp) => stamp,
            Err(_) => return self.restore(mount_id, handle, "disk.changed", MountState::Error),
        };
        if !same_stamp(&image.source, &current) {
            return self.restore(mount_id, handle, "disk.changed", MountState::Error);
        }
        let open = self.host.documents_under(&image.volume_roots);
        if !open.is_empty() {
            return self.restore(mount_id, handle, "disk.in_use", MountState::InUse);
        }

        match handle.detach() {
            Ok(()) => {
                let mut inner = self.lock()?;
                inner.records.remove(mount_id);
                Ok(EjectResult { ejected: true })
            }
            Err(code) => {
                let code = if code.starts_with("disk.") {
                    code
                } else {
                    "disk.in_use".to_string()
                };
                self.restore(mount_id, handle, &code, MountState::InUse)
            }
        }
    }

    /// Put a handle back after a refused eject. If the record vanished in
    /// the meantime the attachment is still ours, so detach it here.
    fn restore(
        &self,
        mount_id: &str,
        handle: Box<dyn MountHandle>,
        code: &str,
        state: MountState,
    ) -> Result<EjectResult, String> {
        let mut handle = Some(handle);
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(record) = inner.records.get_mut(mount_id) {
                record.handle = handle.take();
                record.image.state = state;
            }
        }
        if let Some(mut handle) = handle {
            let _ = handle.detach();
        }
        Err(code.to_string())
    }

    /// Number of app-owned mounts (tests and diagnostics).
    pub fn owned_mounts(&self) -> Result<usize, String> {
        let inner = self.lock()?;
        Ok(inner.records.values().filter(|r| r.image.owned).count())
    }
}

fn checked_roots(roots: Vec<String>) -> Option<Vec<String>> {
    if roots.is_empty()
        || roots.len() > MAX_VOLUME_ROOTS
        || !roots
            .iter()
            .all(|root| crate::disk_image_types::valid_volume_root(root))
    {
        return None;
    }
    Some(roots)
}

struct Reservation<'a> {
    mounts: &'a DiskMounts,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.mounts.inner.lock() {
            inner.reserved = inner.reserved.saturating_sub(1);
        }
    }
}

#[cfg(test)]
#[path = "disk_mounts_step09j_tests.rs"]
mod step09j_tests;
