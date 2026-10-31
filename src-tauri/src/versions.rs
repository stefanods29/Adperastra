//! Version hook and version history (contract 19, Steps 06a and 06b).

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use version_store::{
    snapshot_to_pending, StoreError, VersionInfo, VersionStore, MAX_SNAPSHOT_BYTES,
};

use crate::text_save::SavedFile;
use crate::{ensure_main, validate_absolute_path, AppState};

#[path = "version_files.rs"]
mod file_writes;

const BYTES_PER_MB: u64 = 1_048_576;
const VERSION_PAGE_SIZE: usize = 2_000;

/// Why a file's content is about to change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifyReason {
    Save,
    SaveAs,
    Restore,
}

/// The reason as it is stored in the history.
fn reason_text(reason: ModifyReason) -> &'static str {
    match reason {
        ModifyReason::Save => "save",
        ModifyReason::SaveAs => "saveAs",
        ModifyReason::Restore => "restore",
    }
}

/// One file's versions, plus whether the file is too large to keep one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionList {
    pub versions: Vec<VersionInfo>,
    pub too_large: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_before_id: Option<i64>,
}

/// What a restore changed, so the UI can undo it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    /// The snapshot of the content from before the restore, when it was kept.
    pub previous_id: Option<i64>,
    pub saved: SavedFile,
}

/// The one background thread that stores pending copies (Step 06b D3).
pub struct VersionWorker {
    sender: Mutex<Option<mpsc::Sender<()>>>,
}

impl VersionWorker {
    /// Start the worker and store copies left behind by an earlier run.
    pub fn start(app: AppHandle) -> Self {
        let (sender, receiver) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            lower_priority();
            loop {
                let _ = run_once(&app);
                if receiver.recv().is_err() {
                    break;
                }
            }
        });
        Self {
            sender: Mutex::new(Some(sender)),
        }
    }

    /// Ask the worker to store pending copies now.
    pub fn notify(&self) {
        if let Ok(guard) = self.sender.lock() {
            if let Some(sender) = guard.as_ref() {
                let _ = sender.send(());
            }
        }
    }
}

#[cfg(windows)]
fn lower_priority() {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
    };
    // SAFETY: GetCurrentThread returns the calling thread's pseudo handle,
    // which is always valid for SetThreadPriority on this thread.
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

#[cfg(not(windows))]
fn lower_priority() {}

/// Store every pending copy, then keep the store within the limits.
fn run_once(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let data_dir = state.data_dir.clone();
    let (keep_days, max_mb) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        (settings.versions.keep_days, settings.versions.max_mb)
    };
    let mut store =
        VersionStore::open(&store_dir(&data_dir)).map_err(|error| format!("{error:?}"))?;
    store
        .import_pending(crate::unix_now())
        .map_err(|error| format!("{error:?}"))?;
    store
        .trim(
            keep_days,
            u64::from(max_mb) * BYTES_PER_MB,
            crate::unix_now(),
        )
        .map_err(|error| format!("{error:?}"))?;
    Ok(())
}

fn store_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("versions")
}

/// Called before every change to an existing file's content (R-SAFE-5).
pub fn before_modify(app: &AppHandle, path: &Path, reason: ModifyReason) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (enabled, data_dir) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "versions.other".to_string())?;
        (settings.versions.enabled, state.data_dir.clone())
    };
    if !enabled {
        return Ok(());
    }
    match snapshot_to_pending(
        &store_dir(&data_dir),
        path,
        reason_text(reason),
        crate::unix_now(),
    ) {
        Ok(true) => {
            if let Some(worker) = app.try_state::<VersionWorker>() {
                worker.notify();
            }
            Ok(())
        }
        Ok(false) | Err(StoreError::TooLarge) => Ok(()),
        Err(_) => Err("versions.snapshot_failed".to_string()),
    }
}

/// A version id from the UI must be positive.
fn check_id(id: i64) -> Result<(), String> {
    if id > 0 {
        Ok(())
    } else {
        Err("versions.bad_request".to_string())
    }
}

fn store_error_code(error: StoreError) -> String {
    match error {
        StoreError::NotFound => "versions.not_found".to_string(),
        _ => "versions.other".to_string(),
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

fn open_store(data_dir: &Path) -> Result<VersionStore, String> {
    VersionStore::open(&store_dir(data_dir)).map_err(|error| format!("{error:?}"))
}

/// The file's kept versions, newest first.
#[tauri::command]
pub async fn versions_list(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    before_id: Option<i64>,
) -> Result<VersionList, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "versions.bad_request".to_string())?;
    if let Some(id) = before_id {
        check_id(id)?;
    }
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        store
            .import_pending(crate::unix_now())
            .map_err(store_error_code)?;
        let mut versions = store
            .list_page(&path, before_id, VERSION_PAGE_SIZE + 1)
            .map_err(|error| {
                if error == StoreError::NotFound {
                    "versions.bad_request".to_string()
                } else {
                    store_error_code(error)
                }
            })?;
        let has_more = versions.len() > VERSION_PAGE_SIZE;
        versions.truncate(VERSION_PAGE_SIZE);
        let next_before_id = if has_more {
            versions.last().map(|version| version.id)
        } else {
            None
        };
        let too_large = std::fs::metadata(&path)
            .map(|meta| meta.len() > MAX_SNAPSHOT_BYTES)
            .unwrap_or(false);
        Ok(VersionList {
            versions,
            too_large,
            next_before_id,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Extract a version to a read-only copy under `open/` and return its path.
#[tauri::command]
pub async fn versions_extract(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: i64,
    file_name: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    check_id(id)?;
    if file_name.chars().count() > 255 || fs_service::validate_new_name(&file_name).is_err() {
        return Err("versions.bad_request".to_string());
    }
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        let dest = store
            .extract_open(id, &file_name)
            .map_err(store_error_code)?;
        Ok(display_path(&dest))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Put a version's content back into the file, keeping the old content first.
#[tauri::command]
pub async fn versions_restore(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    id: i64,
) -> Result<RestoreResult, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "versions.bad_request".to_string())?;
    check_id(id)?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        let (previous_id, saved) =
            file_writes::restore_version(&mut store, Path::new(&path), id, crate::unix_now())?;
        if let Some(worker) = app.try_state::<VersionWorker>() {
            worker.notify();
        }
        Ok(RestoreResult {
            previous_id: Some(previous_id),
            saved: SavedFile {
                path: path.trim_start_matches(r"\\?\").to_string(),
                size: saved.size,
                modified_unix: saved.modified_unix,
            },
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Save a version as a separate file through Windows' save dialog.
#[tauri::command]
pub async fn versions_save_copy(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: i64,
    title: String,
    file_name: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    check_id(id)?;
    crate::text_save::check_dialog_texts(&title, &file_name, &filter_name)
        .map_err(|_| "versions.bad_request".to_string())?;
    let owner = crate::window_handle(&window);
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let extension = Path::new(&file_name)
            .extension()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let chosen = crate::file_dialogs::pick_save_path(
            owner,
            &title,
            &file_name,
            &filter_name,
            "*.*",
            &extension,
        )
        .map_err(|code| {
            if code == "dialog.failed" {
                "versions.other".to_string()
            } else {
                code
            }
        })?;
        let Some(target) = chosen else {
            return Ok(None);
        };
        let store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        let bytes = store.read_bytes(id).map_err(store_error_code)?;
        drop(store);
        let target = PathBuf::from(target);
        file_writes::save_copy(&target, &bytes)?;
        Ok(Some(display_path(&target)))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Delete every kept version; the user's files stay as they are.
#[tauri::command]
pub async fn versions_delete_all(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        store.delete_all().map_err(|_| "versions.other".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Disk usage of the index, pending copies, blobs and extracted open copies.
#[tauri::command]
pub async fn versions_store_size(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    ensure_main(window.label())?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&data_dir).map_err(|_| "versions.other".to_string())?;
        store.disk_bytes().map_err(|_| "versions.other".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_id_refuses_zero_and_negative() {
        assert_eq!(check_id(1), Ok(()));
        assert_eq!(check_id(0), Err("versions.bad_request".to_string()));
        assert_eq!(check_id(-5), Err("versions.bad_request".to_string()));
    }

    #[test]
    fn reasons_have_stable_names() {
        assert_eq!(reason_text(ModifyReason::Save), "save");
        assert_eq!(reason_text(ModifyReason::SaveAs), "saveAs");
        assert_eq!(reason_text(ModifyReason::Restore), "restore");
    }
}
