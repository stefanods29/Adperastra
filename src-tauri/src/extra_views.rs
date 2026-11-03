//! Tauri commands of the extra viewers (Step 07f E2-E7). Every command
//! checks the main window, validates its arguments, and runs parser or disk
//! work on a blocking thread. Pages are bounded and source-stamp checked by
//! `ExtraViewSessions`; no file bytes travel as JSON.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::extra_view_sessions::ExtraViewSessions;
use crate::extra_view_types::{
    parse_cursor, parse_kind, parse_session_id, BookContentsPage, ExtraPageRequest, ExtraViewKind,
    ExtraViewPage,
};
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id, validate_absolute_path};

/// Open one source. The job resolves with the session summary.
#[tauri::command]
pub fn extra_view_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
    kind: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "extra_view.bad_request".to_string())?;
    validate_absolute_path(&path).map_err(|_| "extra_view.bad_request".to_string())?;
    let kind = parse_kind(&kind)?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "extra_view.bad_request".to_string())?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |ctx| {
        if ctx.token().load(Ordering::Relaxed) {
            return Err("files.cancelled".to_string());
        }
        let session = work_app
            .state::<ExtraViewSessions>()
            .open(std::path::Path::new(&path), kind)?;
        if ctx.token().load(Ordering::Relaxed) {
            let _ = work_app
                .state::<ExtraViewSessions>()
                .close(&session.session_id);
            return Err("files.cancelled".to_string());
        }
        serde_json::to_value(session).map_err(|_| "extra_view.unavailable".to_string())
    });
    Ok(())
}

/// One bounded page of a session.
#[tauri::command]
pub async fn extra_view_page(
    window: WebviewWindow,
    app: AppHandle,
    request: ExtraPageRequest,
) -> Result<ExtraViewPage, String> {
    ensure_main(window.label())?;
    parse_session_id(&request.session_id)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<ExtraViewSessions>().page(&request))
        .await
        .map_err(|_| "extra_view.unavailable".to_string())?
}

/// Close a session. Unknown or already-closed sessions succeed (E4).
#[tauri::command]
pub fn extra_view_close(
    window: WebviewWindow,
    sessions: State<'_, ExtraViewSessions>,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    parse_session_id(&session_id)?;
    sessions.close(&session_id)
}

/// Extract one saved attachment only after an explicit user action (E5).
#[tauri::command]
pub fn extra_view_attachment_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    attachment_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "extra_view.bad_request".to_string())?;
    parse_session_id(&session_id)?;
    uuid::Uuid::parse_str(&attachment_id).map_err(|_| "extra_view.bad_request".to_string())?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "extra_view.bad_request".to_string())?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |ctx| {
        if ctx.token().load(Ordering::Relaxed) {
            return Err("files.cancelled".to_string());
        }
        let path = work_app
            .state::<ExtraViewSessions>()
            .attachment(&session_id, &attachment_id)?;
        Ok(serde_json::Value::String(
            path.to_string_lossy().to_string(),
        ))
    });
    Ok(())
}

/// The subtitle cue page (E6). Only subtitle sessions answer this command.
#[tauri::command]
pub async fn extra_view_subtitles(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    cursor: Option<String>,
) -> Result<ExtraViewPage, String> {
    ensure_main(window.label())?;
    parse_session_id(&session_id)?;
    parse_cursor(cursor.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<ExtraViewSessions>();
        let request = ExtraPageRequest {
            session_id,
            cursor,
            ..ExtraPageRequest::default()
        };
        let page = sessions.page(&request)?;
        if page.kind != ExtraViewKind::Subtitle {
            return Err("extra_view.bad_request".to_string());
        }
        Ok(page)
    })
    .await
    .map_err(|_| "extra_view.unavailable".to_string())?
}

/// The bounded physical-table list of a SQLite session (additive E3
/// companion; see the handoff proposal).
#[tauri::command]
pub async fn extra_view_sqlite_tables(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
) -> Result<Vec<crate::extra_view_types::SqliteTableInfo>, String> {
    ensure_main(window.label())?;
    parse_session_id(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ExtraViewSessions>().sqlite_tables(&session_id)
    })
    .await
    .map_err(|_| "extra_view.unavailable".to_string())?
}

/// One page of the book table of contents (E7).
#[tauri::command]
pub async fn extra_view_book_contents(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    cursor: Option<String>,
) -> Result<BookContentsPage, String> {
    ensure_main(window.label())?;
    parse_session_id(&session_id)?;
    parse_cursor(cursor.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ExtraViewSessions>()
            .contents(&session_id, cursor.as_deref())
    })
    .await
    .map_err(|_| "extra_view.unavailable".to_string())?
}
