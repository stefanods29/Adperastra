//! Office worker operations never wait on the window thread.
use crate::office_edit_sessions::OfficeEditState;
use tauri::{AppHandle, Manager};

pub async fn run<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(&OfficeEditState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let edit = app.state::<OfficeEditState>();
        operation(edit.inner())
    })
    .await
    .map_err(|_| "office_edit.failed".to_owned())?
}
