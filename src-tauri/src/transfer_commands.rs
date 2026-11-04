//! Tauri commands of the controlled transfer queue (Step 09f E1-E3).
//!
//! Every command starts with the main-window guard and validates its
//! arguments before touching a job. Errors are stable codes the UI
//! translates under `errors.ops.*`. Long work never runs here: `transfer_start`
//! registers the job and returns, and the shared job table carries progress
//! and cancel.

use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};

use crate::jobs::Jobs;
use crate::transfer_control::TransferCoordinator;
use crate::transfer_job_types::{
    TransferControl, TransferDecision, TransferError, TransferReport, TransferRequest,
    TransferState,
};

fn queue_error(code: &str) -> String {
    match code {
        "jobs.too_many" => TransferError::QueueFull.to_code(),
        "jobs.duplicate" => TransferError::InvalidRequest.to_code(),
        _ => TransferError::Io.to_code(),
    }
}

/// Start a copy or move. The job exists, with its Undo room reserved, before
/// this returns; progress and the first report page come through the shared
/// job table.
#[tauri::command]
pub fn transfer_start(
    window: WebviewWindow,
    app: AppHandle,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    jobs: State<'_, Jobs>,
    app_state: State<'_, crate::AppState>,
    request_id: String,
    request: TransferRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let items_total = request.sources.len();
    let verify_default = app_state.verify_copies();
    let coordinator = Arc::clone(coordinator.inner());
    let runtime = coordinator.enqueue(&request_id, request, verify_default)?;
    let token = match jobs.begin(&request_id, items_total) {
        Ok(token) => token,
        Err(code) => {
            coordinator.forget(&request_id);
            return Err(queue_error(&code));
        }
    };
    runtime.attach_token(token);
    crate::transfer_runner::spawn_ready(&app, &coordinator);
    Ok(())
}

/// The current state of one job (phase, progress, speed, open question).
#[tauri::command]
pub fn transfer_state(
    window: WebviewWindow,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    job_id: String,
) -> Result<TransferState, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&job_id)?;
    coordinator.state(&job_id).map_err(TransferError::to_code)
}

/// Pause, resume, skip the current item, or cancel.
#[tauri::command]
pub fn transfer_control(
    window: WebviewWindow,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    job_id: String,
    control: TransferControl,
) -> Result<TransferState, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&job_id)?;
    coordinator
        .control(&job_id, &control)
        .map_err(TransferError::to_code)
}

/// Answer the conflict or error question that is currently open.
#[tauri::command]
pub fn transfer_decide(
    window: WebviewWindow,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    job_id: String,
    decision: TransferDecision,
) -> Result<TransferState, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&job_id)?;
    coordinator
        .decide(&job_id, &decision)
        .map_err(TransferError::to_code)
}

/// Prove the exact objects of a recorded plan before the UI replays it.
///
/// The reply is empty on success; every refusal is a stable code
/// (`ops.source_changed`, `ops.undo_unavailable`, ...). A refusal happens
/// before any file is touched, so the Undo/Redo cursor stays where it is.
#[tauri::command]
pub fn transfer_replay_check(
    window: WebviewWindow,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    transfer_id: String,
    reverse: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&transfer_id)?;
    let history = coordinator.history().ok_or_else(|| TransferError::Io.to_code())?;
    let plan = history
        .lock()
        .map_err(|_| TransferError::Io.to_code())?
        .get(&transfer_id)?;
    crate::transfer_history_validation::validate_before_replay(&plan, reverse)
        .map_err(|error| error.code().to_string())
}

/// One page of a report: 200 item lines, five minutes per cursor.
#[tauri::command]
pub fn transfer_report_page(
    window: WebviewWindow,
    coordinator: State<'_, Arc<TransferCoordinator>>,
    cursor: String,
) -> Result<TransferReport, String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::parse_str(&cursor).is_err() {
        return Err(TransferError::InvalidRequest.to_code());
    }
    coordinator
        .page_for_cursor(&cursor)
        .map_err(TransferError::to_code)
}
