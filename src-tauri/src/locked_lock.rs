//! Lock, pending-generation and Save encrypted copy commands (Step 09k
//! E3/E7/E8). All long work runs as a shared job; no command holds a session
//! lock while doing disk I/O.

use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use locked_store::types::{
    LockRequest, LockedCopyRequest, LockedPersistRequest, LockedRecoveryAction,
    LockedRecoveryItem, LockedSession,
};
use locked_store::LockedError;

use crate::locked_sessions::LockedSessions;

#[tauri::command]
pub async fn locked_persist_start(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    snapshots: State<'_, Arc<crate::export_snapshots::ExportSnapshots>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockedPersistRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_persist(&request)?;
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    let snapshots = snapshots.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let result = sessions
            .persist(&request, &snapshots, context.token())
            .map_err(|error| error.code().to_string())?;
        serde_json::to_value(result).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn locked_lock_start(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    grants: State<'_, Arc<crate::files::FileGrants>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if request.session_id.is_nil() || request.discard_dirty && request.mode == locked_store::types::LockRequestMode::Idle {
        return Err(LockedError::Invalid.code().to_string());
    }
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    let grants = grants.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_context| {
        let outcome = sessions
            .lock(&request, &grants)
            .map_err(|error| error.code().to_string())?;
        serde_json::to_value(locked_store::types::LockResult {
            locked: outcome.locked,
            state: outcome.state,
        })
        .map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn locked_save_copy_start(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockedCopyRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if request.session_id.is_nil() || request.expected_revision == 0 {
        return Err(LockedError::Invalid.code().to_string());
    }
    crate::validate_absolute_path(&request.dest_path)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let result = sessions
            .save_copy(&request, context.token())
            .map_err(|error| error.code().to_string())?;
        serde_json::to_value(result).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn locked_recovery_list(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    session_id: String,
) -> Result<Vec<LockedRecoveryItem>, String> {
    crate::ensure_main(window.label())?;
    let session = Uuid::try_parse(&session_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    sessions
        .recovery_list(session)
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn locked_recovery_choose(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    grants: State<'_, Arc<crate::files::FileGrants>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    session_id: String,
    recovery_id: String,
    action: LockedRecoveryAction,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let session = Uuid::try_parse(&session_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    let recovery = Uuid::try_parse(&recovery_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    let grants = grants.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_context| {
        let result = sessions
            .recovery_choose(session, recovery, action, &grants)
            .map_err(|error| error.code().to_string())?;
        serde_json::to_value(result).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn locked_mark_dirty(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    session_id: String,
    entry_id: String,
    dirty: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let session = Uuid::try_parse(&session_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    let entry = Uuid::try_parse(&entry_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    sessions
        .mark_dirty(session, entry, dirty)
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
pub fn locked_touch(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    session_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let session = Uuid::try_parse(&session_id)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    sessions
        .touch(session)
        .map_err(|error| error.code().to_string())
}

fn validate_persist(request: &LockedPersistRequest) -> Result<(), String> {
    if request.session_id.is_nil()
        || request.entry_id.is_nil()
        || request.snapshot_id.is_nil()
        || request.content_id.is_nil()
        || request.expected_container_revision == 0
        || request.captured_revision == 0
    {
        return Err(LockedError::Invalid.code().to_string());
    }
    Ok(())
}

/// The UI may ask for one auto-lock pass; the native session decides which
/// sessions are actually due and never discards dirty bytes.
#[tauri::command]
pub async fn locked_idle_check(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    grants: State<'_, Arc<crate::files::FileGrants>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    let grants = grants.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_context| {
        let mut states: Vec<LockedSession> = Vec::new();
        for session_id in sessions.due_for_idle() {
            if let Ok(outcome) = sessions.lock(
                &LockRequest {
                    session_id,
                    mode: locked_store::types::LockRequestMode::Idle,
                    discard_dirty: false,
                },
                &grants,
            ) {
                states.push(outcome.state);
            }
        }
        serde_json::to_value(states).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}


