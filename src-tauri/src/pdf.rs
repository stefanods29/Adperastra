#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! PDF commands (Step 07d E1-E4).
//!
//! The UI's only way into PDF.js. Every command starts with `ensure_main`,
//! validates every argument, and runs disk/helper work off the UI thread.
//! Hex or base64 of a document never crosses this boundary: pages are PNG
//! leases and text is bounded runs.

use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::pdf_jobs;
use crate::pdf_sessions::PdfSessions;
use crate::pdf_types::{
    PdfInput, PdfOutlinePage, PdfRenderRequest, PdfSession, PdfTextPage, PDF_MAX_ANSWER_BYTES,
    PDF_MAX_SEARCH_QUERY,
};
use crate::{ensure_main, valid_request_id};

fn parse_session(session_id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(session_id).map_err(|_| "pdf.bad_request".to_string())
}

/// Start opening a PDF from a normal file path (the compatibility adapter of
/// `openPdf`). A password is kept in memory for this call only.
#[tauri::command]
pub fn pdf_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
    password: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf.bad_request".to_string())?;
    let input = PdfInput::File {
        path,
        expected: None,
    };
    start_open(app, jobs.inner(), request_id, input, password)
}

/// Start opening any PDF input: a granted file or an immutable snapshot
/// (E1). Snapshot references are resolved natively; an unregistered resolver
/// answers `pdf.snapshot_unavailable`.
#[tauri::command]
pub fn pdf_open_input_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    input: PdfInput,
    password: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf.bad_request".to_string())?;
    match &input {
        PdfInput::File { path, .. } => {
            if !crate::pdf_types::valid_pdf_path(path) {
                return Err("pdf.bad_request".to_string());
            }
        }
        PdfInput::Snapshot { reference } => {
            if !reference.is_valid() {
                return Err("pdf.bad_request".to_string());
            }
        }
    }
    start_open(app, jobs.inner(), request_id, input, password)
}

fn start_open(
    app: AppHandle,
    jobs: &Jobs,
    request_id: String,
    input: PdfInput,
    password: Option<String>,
) -> Result<(), String> {
    let password = match password {
        Some(value) if value.chars().count() <= crate::pdf_helper_types::PDF_MAX_PASSWORD => {
            Some(value)
        }
        Some(_) => return Err("pdf.bad_request".to_string()),
        None => None,
    };
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        let session = pdf_jobs::open_input(&work_app, &work_token, &input, password)?;
        serde_json::to_value(session).map_err(|_| "pdf.corrupt".to_string())
    });
    Ok(())
}

/// Close a session (idempotent). Unknown sessions are already closed.
#[tauri::command]
pub async fn pdf_close(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let session = parse_session(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<PdfSessions>().close(session)
    })
    .await
    .map_err(|_| "pdf.unavailable".to_string())?
}

/// Start one page render (E2).
#[tauri::command]
pub fn pdf_render_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: PdfRenderRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf.bad_request".to_string())?;
    if !request.is_valid() {
        return Err("pdf.bad_request".to_string());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        let image = pdf_jobs::render_page(&work_app, &work_token, &request)?;
        serde_json::to_value(image).map_err(|_| "pdf.corrupt".to_string())
    });
    Ok(())
}

/// One bounded chunk of a page's text (E3).
#[tauri::command]
pub async fn pdf_text_page(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    page: u32,
    after_run: Option<u32>,
) -> Result<PdfTextPage, String> {
    ensure_main(window.label())?;
    let session = parse_session(&session_id)?;
    if page == 0 || page > crate::pdf_types::PDF_MAX_PAGES {
        return Err("pdf.bad_request".to_string());
    }
    let cancel = fs_service::new_cancellation_token();
    let page_result = tauri::async_runtime::spawn_blocking(move || {
        pdf_jobs::read_text(&app, &cancel, session, page, after_run)
    })
    .await
    .map_err(|error| error.to_string())??;
    let bytes = serde_json::to_vec(&page_result).map_err(|_| "pdf.corrupt".to_string())?;
    if bytes.len() > PDF_MAX_ANSWER_BYTES {
        return Err("pdf.too_large".to_string());
    }
    Ok(page_result)
}

/// One bounded page of the outline (E4).
#[tauri::command]
pub async fn pdf_outline(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    cursor: Option<String>,
) -> Result<PdfOutlinePage, String> {
    ensure_main(window.label())?;
    let session = parse_session(&session_id)?;
    let cursor = match cursor {
        Some(value) => Some(Uuid::parse_str(&value).map_err(|_| "pdf.bad_request".to_string())?),
        None => None,
    };
    let cancel = fs_service::new_cancellation_token();
    let page = tauri::async_runtime::spawn_blocking(move || {
        pdf_jobs::read_outline(&app, &cancel, session, cursor)
    })
    .await
    .map_err(|error| error.to_string())??;
    let bytes = serde_json::to_vec(&page).map_err(|_| "pdf.corrupt".to_string())?;
    if bytes.len() > PDF_MAX_ANSWER_BYTES {
        return Err("pdf.too_large".to_string());
    }
    Ok(page)
}

/// Start a search (E4). The cursor binds the exact query and source.
#[allow(clippy::too_many_arguments)] // Command arguments are part of the wire API.
#[tauri::command]
pub fn pdf_search_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    query: String,
    match_case: bool,
    cursor: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf.bad_request".to_string())?;
    let session = parse_session(&session_id)?;
    if query.trim().is_empty() || query.chars().count() > PDF_MAX_SEARCH_QUERY {
        return Err("pdf.bad_request".to_string());
    }
    let cursor = match cursor {
        Some(value) => Some(Uuid::parse_str(&value).map_err(|_| "pdf.bad_request".to_string())?),
        None => None,
    };
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        let answer = pdf_jobs::search(&work_app, &work_token, session, &query, match_case, cursor)?;
        serde_json::to_value(answer).map_err(|_| "pdf.corrupt".to_string())
    });
    Ok(())
}

/// The session state the UI polls after an eviction (used by tests).
pub fn session_or_changed(sessions: &PdfSessions, session: Uuid) -> Result<PdfSession, String> {
    sessions.get(session).map(|entry| entry.session.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_must_be_uuids() {
        assert!(parse_session("not-a-uuid").is_err());
        let value = Uuid::new_v4();
        assert_eq!(parse_session(&value.to_string()), Ok(value));
    }
}
