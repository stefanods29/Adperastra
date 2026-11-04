//! RAR status (Step 06e T7): asks the archive helper for the separately
//! installed 7-Zip's version. No path is accepted from the UI and no raw
//! executable path is returned.

use archive::RarToolStatus;
use tauri::WebviewWindow;

use crate::archive_helper::{HelperMessage, HelperRequest, HELPER_FLAG, HELPER_MEMORY_LIMIT};
use crate::ensure_main;
use crate::helper::{self, DriveEnd, DriveTimings, HelperProcess};

/// How long the status probe may take.
pub const STATUS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Ask the helper for the installed 7-Zip, without a user-controlled path.
#[tauri::command]
pub async fn archive_rar_status(window: WebviewWindow) -> Result<RarToolStatus, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(probe)
        .await
        .map_err(|_| "archive.other".to_string())?
}

fn probe() -> Result<RarToolStatus, String> {
    let mut process = HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)?;
    let line = serde_json::to_string(&HelperRequest::RarStatus)
        .map_err(|_| "archive.other".to_string())?;
    process.send_line(&line)?;
    let mut status: Option<RarToolStatus> = None;
    let mut failure: Option<String> = None;
    let token = fs_service::new_cancellation_token();
    let end = helper::drive(
        &mut process,
        &token,
        DriveTimings {
            idle: STATUS_TIMEOUT,
            ..DriveTimings::default()
        },
        &mut |text| {
            let message: HelperMessage =
                serde_json::from_str(text).map_err(|_| "archive.helper_failed".to_string())?;
            match message {
                HelperMessage::RarStatus { status: found } => {
                    status = Some(found);
                    return Ok(true);
                }
                HelperMessage::Failed { code } => {
                    failure = Some(code);
                    return Ok(true);
                }
                _ => {}
            }
            Ok(false)
        },
    );
    if let Some(code) = failure {
        return Err(code);
    }
    match end {
        Ok(DriveEnd::Finished) => status.ok_or_else(|| "archive.helper_failed".to_string()),
        Ok(DriveEnd::Cancelled) => Err("archive.cancelled".to_string()),
        Err(code) => Err(code),
    }
}
