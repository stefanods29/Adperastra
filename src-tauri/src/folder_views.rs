//! Remembered folder views (Step 05a): commands over
//! `fs_service::FolderViews` in `folder-views.json`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Manager, WebviewWindow};

use crate::{ensure_main, validate_absolute_path};

/// One lock for the file, so a read never races a write.
#[derive(Default)]
pub struct FolderViewsLock {
    pub lock: Mutex<()>,
}

fn folder_views_file(data_dir: &Path) -> PathBuf {
    data_dir.join("folder-views.json")
}

/// Validates the folder and mode arguments; errors are `folderViews.*` codes.
pub fn check_set_args(path: &str, mode: &str) -> Result<(), String> {
    validate_absolute_path(path).map_err(|_| "folderViews.bad_path".to_string())?;
    if !fs_service::is_view_mode(mode) {
        return Err("folderViews.bad_mode".to_string());
    }
    if path.chars().count() > fs_service::MAX_FOLDER_VIEW_PATH {
        return Err("folderViews.path_too_long".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn folder_views_get(
    window: WebviewWindow,
) -> Result<Vec<fs_service::FolderView>, String> {
    ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = folder_views_file(&app.state::<crate::AppState>().data_dir);
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock
            .lock
            .lock()
            .map_err(|_| "folderViews.other".to_string())?;
        Ok(fs_service::FolderViews::load(&file).folders)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_view_set(
    window: WebviewWindow,
    path: String,
    mode: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    check_set_args(&path, &mode)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = folder_views_file(&app.state::<crate::AppState>().data_dir);
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock
            .lock
            .lock()
            .map_err(|_| "folderViews.other".to_string())?;
        let mut views = fs_service::FolderViews::load(&file);
        if !views.set(&path, &mode, crate::unix_now()) {
            return Err("folderViews.other".to_string());
        }
        views
            .save(&file)
            .map_err(|_| "folderViews.other".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_views_clear(window: WebviewWindow) -> Result<(), String> {
    ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = folder_views_file(&app.state::<crate::AppState>().data_dir);
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock
            .lock
            .lock()
            .map_err(|_| "folderViews.other".to_string())?;
        let mut views = fs_service::FolderViews::load(&file);
        views.clear();
        views
            .save(&file)
            .map_err(|_| "folderViews.other".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_set_args_validates_every_argument() {
        assert!(check_set_args(r"C:\Photos", "largeIcons").is_ok());
        assert_eq!(
            check_set_args(r"relative\path", "list").unwrap_err(),
            "folderViews.bad_path"
        );
        assert_eq!(
            check_set_args(r"C:\Photos", "huge").unwrap_err(),
            "folderViews.bad_mode"
        );
        let long = format!("C:\\{}", "a".repeat(1100));
        assert_eq!(
            check_set_args(&long, "list").unwrap_err(),
            "folderViews.path_too_long"
        );
    }
}
