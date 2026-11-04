//! Storage scan commands and retention (Step 11c T1/T2, E1).
//!
//! One scan runs at a time; `storage_page` opens its own SQLite connection
//! so a cached first page is still readable while the worker writes. The
//! UI receives bounded pages, never the whole tree. A partial scan is a
//! successful result with `coverage: partial`, not a hidden job error.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// `::storage_scan` names the external storage-scan crate; this file is the
// same-named local command module.
use ::storage_scan::{
    scan_storage, FsScanIo, ScanIo, ScanRun, StoragePage, StorageScanRequest, StorageSummary,
    MAX_RETAINED_SCANS,
};
use fs_service::CancellationToken;
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::background::BackgroundTaskKind;
use crate::background_queue::{BackgroundPriority, BackgroundScheduler};
use crate::jobs::{spawn_job, Jobs};
use crate::storage_store::StorageStore;

#[derive(Debug, Clone)]
struct ScanKey {
    root_key: String,
    generation: u64,
    options_key: String,
}

#[derive(Default)]
struct ScanRegistry {
    retained: VecDeque<String>,
    running: HashSet<String>,
}

impl ScanRegistry {
    fn retain(&mut self, scan_id: &str) -> Option<String> {
        self.retained.push_back(scan_id.to_string());
        if self.retained.len() > MAX_RETAINED_SCANS {
            self.retained.pop_front()
        } else {
            None
        }
    }

    fn release(&mut self, scan_id: &str) {
        self.retained.retain(|id| id != scan_id);
    }

    fn set_running(&mut self, scan_id: &str, running: bool) {
        if running {
            self.running.insert(scan_id.to_string());
        } else {
            self.running.remove(scan_id);
        }
    }
}

/// Managed storage state. The profile directory comes from 10c's
/// `ProfileRoot`; this module never reselects AppData.
pub struct StorageState {
    profile_dir: PathBuf,
    registry: Mutex<ScanRegistry>,
    keys: Mutex<HashMap<String, ScanKey>>,
}

impl StorageState {
    pub fn new(profile_dir: PathBuf) -> Self {
        Self {
            profile_dir,
            registry: Mutex::new(ScanRegistry::default()),
            keys: Mutex::new(HashMap::new()),
        }
    }

    #[allow(dead_code)] // Kept for providers that need the profile path (12a).
    pub fn profile_dir(&self) -> &Path {
        &self.profile_dir
    }

    pub(crate) fn open_store(&self) -> Result<StorageStore, String> {
        StorageStore::open(&self.profile_dir)
    }

    fn key_of(&self, scan_id: &str) -> Result<ScanKey, String> {
        self.keys
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?
            .get(scan_id)
            .cloned()
            .ok_or_else(|| "storage.invalid".to_string())
    }

    fn remember(&self, scan_id: String, key: ScanKey) -> Result<(), String> {
        self.keys
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?
            .insert(scan_id, key);
        Ok(())
    }

    /// Drop the cache key of a scan the UI no longer holds.
    fn forget(&self, scan_id: &str) {
        if let Ok(mut keys) = self.keys.lock() {
            keys.remove(scan_id);
        }
    }
}

/// A shortcut is allowed only when the captured index coverage is complete
/// for the captured root generation. A pending or partial index always
/// means a metadata walk; partial rows are never presented as a full scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Index-reuse decisions are exercised by the T2 oracles.
pub enum IndexReuse {
    None,
    Partial,
    Complete,
}

#[allow(dead_code)] // Reserved for the 11a index bridge; never claim partial rows complete.
pub fn may_reuse_index_records(reuse: IndexReuse, generation_matches: bool) -> bool {
    reuse == IndexReuse::Complete && generation_matches
}

fn valid_uuid(value: &str) -> Result<(), String> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "storage.invalid".to_string())
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

struct StorageRunGuard {
    state: Arc<StorageState>,
    scan_id: String,
}

impl Drop for StorageRunGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.state.registry.lock() {
            registry.set_running(&self.scan_id, false);
        }
    }
}

/// Start a bounded scan. The shared job entry exists before this returns.
#[tauri::command]
pub async fn storage_scan_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    state: State<'_, Arc<StorageState>>,
    scheduler: State<'_, Arc<BackgroundScheduler>>,
    request_id: String,
    request: StorageScanRequest,
) -> Result<String, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    crate::validate_absolute_path(&request.root).map_err(|_| "storage.invalid".to_string())?;

    let io = FsScanIo;
    if ScanIo::is_network(&io, Path::new(&request.root)) && !request.allow_network {
        return Err("storage.invalid".to_string());
    }
    let root_info = ScanIo::inspect(&io, Path::new(&request.root))
        .map_err(|_| "storage.unavailable".to_string())?;
    let root_key = format!(
        "{}:{}:{}",
        root_info.key.volume_id, root_info.key.file_id, root_info.key.path_key
    );
    let generation = crate::storage_watch::root_generation(Path::new(&request.root))?;
    let options_key = request.options_key();
    let scan_id = Uuid::new_v4().to_string();

    let evicted = {
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?;
        if !registry.running.is_empty() {
            return Err("storage.busy".to_string());
        }
        // Reserve the single running slot before the awaited setup so two
        // starts cannot both pass the check.
        registry.set_running(&scan_id, true);
        registry.retain(&scan_id)
    };
    let run_guard = StorageRunGuard {
        state: state.inner().clone(),
        scan_id: scan_id.clone(),
    };
    state.remember(
        scan_id.clone(),
        ScanKey {
            root_key: root_key.clone(),
            generation,
            options_key,
        },
    )?;

    let state_for_store = state.inner().clone();
    let scan_for_store = scan_id.clone();
    let root_for_store = root_key.clone();
    let options_for_store = request.options_key();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if let Some(evicted) = evicted {
            state_for_store.forget(&evicted);
            let mut store = state_for_store.open_store()?;
            let _ = store.delete_scan(&evicted);
        }
        let mut store = state_for_store.open_store()?;
        store
            .begin_scan(
                &scan_for_store,
                &root_for_store,
                generation,
                &options_for_store,
                now_unix(),
            )
            .map_err(|_| "storage.unavailable".to_string())?;
        let _ = store.trim(now_unix());
        Ok(())
    })
    .await
    .map_err(|_| "storage.failed".to_string())??;

    let token = jobs.begin(&request_id, 0)?;
    let permit = match scheduler
        .acquire(
            BackgroundTaskKind::StorageScan,
            Uuid::new_v4(),
            BackgroundPriority::User,
            token.clone(),
        )
        .await
    {
        Ok(permit) => permit,
        Err(_) => {
            jobs.finish(&request_id, Err("storage.busy".to_string()));
            return Err("storage.busy".to_string());
        }
    };
    let state_for_job = state.inner().clone();
    let scan_for_job = scan_id.clone();
    let run = ScanRun {
        scan_id: scan_id.clone(),
        generation,
    };
    let request_for_job = request.clone();
    spawn_job(app, request_id, token, move |context| {
        let _permit = permit;
        let _run_guard = run_guard;
        let mut store = state_for_job.open_store()?;
        store.bind_scan(&scan_for_job);
        let mut progress = |update: &fs_service::OpProgress| {
            context.set_progress(update);
        };
        let cancel: &CancellationToken = context.token();
        let summary: StorageSummary = scan_storage(
            &request_for_job,
            &run,
            &mut store,
            cancel,
            &mut progress,
        )
        .map_err(|error| error.code().to_string())?;
        store
            .finish_scan(&summary)
            .map_err(|_| "storage.failed".to_string())?;
        let _ = store.trim(now_unix());
        let page = store
            .page(&scan_for_job, None, None, false)
            .map_err(|_| "storage.failed".to_string())?;
        serde_json::to_value(page).map_err(|_| "storage.failed".to_string())
    });
    // Additive acknowledgement: the UI may ask for a cached page while the
    // background refresh is still running. The job itself behaves exactly
    // as E1 describes.
    Ok(scan_id)
}

/// One bounded page. While a refresh runs, the newest valid cached page is
/// returned with `summary.stale = true`; it is never labelled current.
#[tauri::command]
pub async fn storage_page(
    window: WebviewWindow,
    state: State<'_, Arc<StorageState>>,
    scan_id: String,
    parent_id: Option<String>,
    cursor: Option<String>,
) -> Result<StoragePage, String> {
    crate::ensure_main(window.label())?;
    valid_uuid(&scan_id)?;
    if let Some(parent) = parent_id.as_deref() {
        valid_uuid(parent)?;
    }
    if let Some(cursor) = cursor.as_deref() {
        valid_uuid(cursor)?;
    }
    let key = state.key_of(&scan_id)?;
    let state_for_store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = state_for_store.open_store()?;
        match store.page(&scan_id, parent_id.as_deref(), cursor.as_deref(), false) {
            Ok(page) => Ok(page),
            Err(code) if code == "storage.failed" => {
                let cached = match store.find_cached(
                    &key.root_key,
                    key.generation,
                    &key.options_key,
                    &scan_id,
                )? {
                    Some(cached) => Some(cached),
                    None => store.find_cached_previous(
                        &key.root_key,
                        &key.options_key,
                        &scan_id,
                    )?,
                };
                if let Some(cached) = cached {
                    store.page(
                        &cached.scan_id,
                        parent_id.as_deref(),
                        cursor.as_deref(),
                        true,
                    )
                } else {
                    Err(code)
                }
            }
            Err(code) => Err(code),
        }
    })
    .await
    .map_err(|_| "storage.failed".to_string())?
}

/// Release one retained scan. Cached rows stay until LRU/age cleanup.
#[tauri::command]
pub fn storage_release(
    window: WebviewWindow,
    state: State<'_, Arc<StorageState>>,
    scan_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    valid_uuid(&scan_id)?;
    state
        .registry
        .lock()
        .map_err(|_| "storage.unavailable".to_string())?
        .release(&scan_id);
    state.forget(&scan_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{may_reuse_index_records, IndexReuse, ScanRegistry};
    use ::storage_scan::MAX_RETAINED_SCANS;

    #[test]
    fn incomplete_index_not_complete() {
        assert!(!may_reuse_index_records(IndexReuse::None, true));
        assert!(!may_reuse_index_records(IndexReuse::Partial, true));
        assert!(!may_reuse_index_records(IndexReuse::Complete, false));
        assert!(may_reuse_index_records(IndexReuse::Complete, true));
    }

    #[test]
    fn four_retained_scans_limit() {
        let mut registry = ScanRegistry::default();
        for index in 0..MAX_RETAINED_SCANS {
            assert_eq!(registry.retain(&format!("scan-{index}")), None);
        }
        assert_eq!(
            registry.retain("scan-4").as_deref(),
            Some("scan-0")
        );
        registry.release("scan-4");
        assert_eq!(registry.retained.len(), MAX_RETAINED_SCANS - 1);
    }
}


