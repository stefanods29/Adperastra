//! The app's cache service and its commands (Step 07a, E3/E5).
//!
//! The store owns `<data>/cache`; this service opens it lazily at the saved
//! size limit, turns validated records into pinned `adpfile` leases, and
//! exposes usage and clear to Settings. A lease grants a token only after
//! the owned blob was opened and verified.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cache_store::{
    CacheError, CacheKey, CacheKind, CacheLease, CacheRecord, CacheStore, CacheUsage,
};
use fs_service::source_stamp::SourceStamp;
use tauri::{State, WebviewWindow};

use crate::cache_leases::{Lease, LeaseTable, MAX_ACTIVE_LEASES};
use crate::cache_stamp;
use crate::ensure_main;
use crate::files::FileGrants;

/// 512 MiB until Settings says otherwise (plan D3).
pub const DEFAULT_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

/// The cache root under the app's data folder.
pub fn cache_root(data_dir: &Path) -> PathBuf {
    data_dir.join("cache")
}

fn cache_code(error: CacheError) -> String {
    match error {
        CacheError::BadRequest => "cache.bad_request".to_string(),
        CacheError::Unavailable | CacheError::Busy | CacheError::TooLarge | CacheError::Changed => {
            "cache.unavailable".to_string()
        }
    }
}

fn thumbnail_code(error: CacheError) -> String {
    match error {
        CacheError::TooLarge => "thumbnail.too_large".to_string(),
        CacheError::Changed => "thumbnail.changed".to_string(),
        CacheError::Busy => "thumbnail.busy".to_string(),
        CacheError::BadRequest => "thumbnail.bad_request".to_string(),
        CacheError::Unavailable => "thumbnail.failed".to_string(),
    }
}

/// Managed state for every cache command and preview provider.
pub struct CacheService {
    data_dir: PathBuf,
    grants: Arc<FileGrants>,
    limit_bytes: AtomicU64,
    store: Mutex<Option<CacheStore>>,
    leases: LeaseTable,
    pending_cleanup: AtomicBool,
}

impl CacheService {
    pub fn new(data_dir: PathBuf, grants: Arc<FileGrants>) -> Self {
        Self {
            data_dir,
            grants,
            limit_bytes: AtomicU64::new(DEFAULT_LIMIT_BYTES),
            store: Mutex::new(None),
            leases: LeaseTable::default(),
            pending_cleanup: AtomicBool::new(false),
        }
    }

    /// The saved settings limit, in bytes. The open store sees it at once.
    pub fn set_limit_bytes(&self, limit_bytes: u64) {
        // The next store call applies it; saving settings never waits for a
        // cache operation that is copying a blob.
        self.limit_bytes.store(limit_bytes, Ordering::Relaxed);
    }

    pub fn source_stamp(&self, path: &Path) -> Result<SourceStamp, String> {
        cache_stamp::capture(path)
    }

    /// Where a provider stages a helper result before `publish` copies it.
    pub fn pending_dir(&self) -> PathBuf {
        cache_root(&self.data_dir).join("pending")
    }

    /// Open the store for the first time on this call.
    pub(crate) fn with_store<T>(
        &self,
        work: impl FnOnce(&CacheStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| "cache.unavailable".to_string())?;
        let limit = self.limit_bytes.load(Ordering::Relaxed);
        if guard.is_none() {
            let store = CacheStore::open(&cache_root(&self.data_dir), limit).map_err(cache_code)?;
            *guard = Some(store);
        } else if let Some(store) = guard.as_ref() {
            store.set_limit(limit);
        }
        let store = guard
            .as_ref()
            .ok_or_else(|| "cache.unavailable".to_string())?;
        work(store)
    }

    pub(crate) fn lookup(&self, key: &CacheKey) -> Result<Option<CacheRecord>, String> {
        self.with_store(|store| store.lookup(key).map_err(cache_code))
    }

    /// Publish one helper-owned result. The caller maps the thumbnail codes.
    pub(crate) fn publish(
        &self,
        key: &CacheKey,
        source: &File,
        mime: &str,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<CacheRecord, String> {
        self.with_store(|store| {
            store
                .publish(key, source, mime, width, height)
                .map_err(thumbnail_code)
        })
    }

    /// Pin a verified owned blob and grant its `adpfile` token.
    pub fn lease(&self, record: &CacheRecord) -> Result<CacheLease, String> {
        record
            .validate()
            .map_err(|_| "cache.bad_request".to_string())?;
        if record.pending_delete {
            return Err("cache.bad_request".to_string());
        }
        if self.leases.active_count() >= MAX_ACTIVE_LEASES {
            return Err("cache.unavailable".to_string());
        }
        let (blob_path, pin) = self.with_store(|store| {
            let pin = store.open_blob(record).map_err(cache_code)?;
            Ok((blob_path(store.root(), record), pin))
        })?;
        let token = self
            .grants
            .grant(blob_path)
            .map_err(|_| "cache.unavailable".to_string())?;
        let lease_id = uuid::Uuid::new_v4().to_string();
        let lease = Lease {
            lease_id: lease_id.clone(),
            token: token.clone(),
            pin,
        };
        if self.leases.insert(lease).is_err() {
            self.grants.revoke(&token);
            return Err("cache.unavailable".to_string());
        }
        Ok(CacheLease {
            lease_id,
            token,
            name: lease_file_name(&record.mime),
            mime: record.mime.clone(),
            byte_len: record.byte_len,
            width: record.width,
            height: record.height,
            sensitive: false,
        })
    }

    /// Revoke the token first, then drop the pin. Unknown IDs are ignored.
    pub fn release(&self, lease_id: &str) -> Result<(), String> {
        if uuid::Uuid::try_parse(lease_id).is_err() {
            return Err("cache.bad_request".to_string());
        }
        let Some(lease) = self.leases.take(lease_id) else {
            return Ok(());
        };
        self.grants.revoke(&lease.token);
        drop(lease.pin);
        let _ = self.with_store(|store| {
            // Scrolling drops ordinary leases frequently. Only a previous
            // clear with pinned blobs requires immediate deferred cleanup.
            if self.pending_cleanup.load(Ordering::Relaxed) {
                let usage = store.trim().map_err(cache_code)?;
                self.pending_cleanup
                    .store(usage.pending_delete_bytes > 0, Ordering::Relaxed);
            }
            Ok(())
        });
        Ok(())
    }

    pub fn usage(&self) -> Result<CacheUsage, String> {
        self.with_store(|store| store.usage().map_err(cache_code))
    }

    pub fn clear(&self, kind: Option<CacheKind>) -> Result<CacheUsage, String> {
        self.with_store(|store| {
            let usage = store.clear(kind).map_err(cache_code)?;
            self.pending_cleanup
                .store(usage.pending_delete_bytes > 0, Ordering::Relaxed);
            Ok(usage)
        })
    }

    #[cfg(test)]
    pub(crate) fn active_leases(&self) -> usize {
        self.leases.active_count()
    }
}

fn blob_path(root: &Path, record: &CacheRecord) -> PathBuf {
    root.join("blobs").join(format!("{}.png", record.blob_id))
}

fn lease_file_name(mime: &str) -> String {
    match mime {
        "image/png" => "thumbnail.png".to_string(),
        "image/jpeg" => "thumbnail.jpg".to_string(),
        "application/pdf" => "preview.pdf".to_string(),
        _ => "preview.bin".to_string(),
    }
}

/// Physical usage and limits for Settings > Background work.
#[tauri::command]
pub async fn cache_usage(
    window: WebviewWindow,
    service: State<'_, Arc<CacheService>>,
) -> Result<CacheUsage, String> {
    ensure_main(window.label())?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.usage())
        .await
        .map_err(|e| e.to_string())?
}

/// Remove cached results. Leased blobs are retained and accounted.
#[tauri::command]
pub async fn cache_clear(
    window: WebviewWindow,
    service: State<'_, Arc<CacheService>>,
    kind: Option<CacheKind>,
) -> Result<CacheUsage, String> {
    ensure_main(window.label())?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.clear(kind))
        .await
        .map_err(|e| e.to_string())?
}

/// Release one lease; calling it twice is harmless.
#[tauri::command]
pub async fn cache_release(
    window: WebviewWindow,
    service: State<'_, Arc<CacheService>>,
    lease_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_uuid(&lease_id, "cache.bad_request")?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.release(&lease_id))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn validate_uuid(value: &str, code: &str) -> Result<uuid::Uuid, String> {
    uuid::Uuid::try_parse(value).map_err(|_| code.to_string())
}
