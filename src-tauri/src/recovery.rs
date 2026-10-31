//! Recovery copies of unsaved text (Step 06a): read, write and delete one
//! JSON file per document in `<data>/recovery`.

use std::path::PathBuf;

use tauri::{State, WebviewWindow};

use crate::{ensure_main, AppState};

fn recovery_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("recovery")
}

#[tauri::command]
pub async fn recovery_write(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    text: String,
    file_modified_unix: u64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::validate_absolute_path(&path).map_err(|_| "recovery.bad_request".to_string())?;
    if text.len() as u64 > fs_service::MAX_DRAFT_BYTES {
        return Err("recovery.too_large".to_string());
    }
    let dir = recovery_dir(&state);
    let saved_unix = crate::unix_now();
    tauri::async_runtime::spawn_blocking(move || {
        let draft = fs_service::Draft {
            schema_version: fs_service::DRAFTS_SCHEMA,
            path,
            text,
            saved_unix,
            file_modified_unix,
        };
        fs_service::write_draft(&dir, &draft)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn recovery_read(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<fs_service::Draft>, String> {
    ensure_main(window.label())?;
    crate::validate_absolute_path(&path).map_err(|_| "recovery.bad_request".to_string())?;
    let dir = recovery_dir(&state);
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<Option<fs_service::Draft>, String>(fs_service::read_draft(&dir, &path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn recovery_delete(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::validate_absolute_path(&path).map_err(|_| "recovery.bad_request".to_string())?;
    let dir = recovery_dir(&state);
    tauri::async_runtime::spawn_blocking(move || fs_service::delete_draft(&dir, &path))
        .await
        .map_err(|error| error.to_string())?
}
