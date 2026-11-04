//! Clipboard-history commands (Step 09j T4/T5).
//!
//! Thin Tauri layer over `ClipboardHistoryState`: every argument is
//! validated here too, disk/crypto work runs on a blocking thread, and a
//! successful capture notifies the open panel through one event.
#![allow(dead_code)]


use std::sync::Arc;

use tauri::{AppHandle, Emitter, State, WebviewWindow};
use uuid::Uuid;

use crate::clipboard_history::ClipboardHistoryState;
use crate::clipboard_history_listener::CHANGED_EVENT;
use crate::clipboard_history_types::{
    ClipboardHistoryPage, ClipboardHistoryPatch, ClipboardHistorySettings, MAX_SEARCH_CHARS,
};

#[tauri::command]
pub async fn clipboard_history_list(
    window: WebviewWindow,
    state: State<'_, Arc<ClipboardHistoryState>>,
    query: String,
    cursor: Option<String>,
) -> Result<ClipboardHistoryPage, String> {
    crate::ensure_main(window.label())?;
    if query.chars().count() > MAX_SEARCH_CHARS {
        return Err("clipboard_history.invalid".to_string());
    }
    if let Some(cursor) = &cursor {
        Uuid::parse_str(cursor).map_err(|_| "clipboard_history.invalid".to_string())?;
    }
    let state = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state.list(&query, cursor.as_deref()))
        .await
        .map_err(|_| "clipboard_history.io".to_string())?
}

#[tauri::command]
pub async fn clipboard_history_patch(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<ClipboardHistoryState>>,
    patch: ClipboardHistoryPatch,
) -> Result<ClipboardHistoryPage, String> {
    crate::ensure_main(window.label())?;
    let state = Arc::clone(&*state);
    let page = tauri::async_runtime::spawn_blocking(move || state.patch(&patch))
        .await
        .map_err(|_| "clipboard_history.io".to_string())??;
    let _ = app.emit(CHANGED_EVENT, page.generation);
    Ok(page)
}

#[tauri::command]
pub async fn clipboard_history_resolve(
    window: WebviewWindow,
    state: State<'_, Arc<ClipboardHistoryState>>,
    id: String,
    target_document_id: Option<String>,
) -> Result<crate::transfer_types::TransferEnvelope, String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&id).map_err(|_| "clipboard_history.invalid".to_string())?;
    if let Some(target) = &target_document_id {
        Uuid::parse_str(target).map_err(|_| "clipboard_history.invalid".to_string())?;
    }
    let state = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        state.resolve(&id, target_document_id.as_deref())
    })
    .await
    .map_err(|_| "clipboard_history.io".to_string())?
}

/// Called by the coordinator after a successful app copy, with the
/// authoritative 09c transfer id (never a UI-provided payload).
#[tauri::command]
pub async fn clipboard_history_record(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<ClipboardHistoryState>>,
    transfer_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&transfer_id).map_err(|_| "clipboard_history.invalid".to_string())?;
    let state = Arc::clone(&*state);
    let generation = tauri::async_runtime::spawn_blocking(move || {
        state.record_transfer(&transfer_id)
    })
    .await
    .map_err(|_| "clipboard_history.io".to_string())??;
    let _ = app.emit(CHANGED_EVENT, generation);
    Ok(())
}

/// Apply settings at startup and after Settings is saved. This is the
/// only place that starts or stops the Windows-wide listener.
pub fn apply_settings(
    app: &AppHandle,
    state: &ClipboardHistoryState,
    settings: &ClipboardHistorySettings,
) -> Result<(), String> {
    settings.validate()?;
    state.apply_settings(settings.clone())?;
    let capture = settings.enabled && settings.capture_windows;
    if !capture {
        // Removing a listener that was never installed is harmless; turning
        // capture off must always succeed.
        let _ = crate::clipboard_history_listener::set_capture_enabled(app, false);
        return Ok(());
    }
    crate::clipboard_history_listener::set_capture_enabled(app, true)
}
