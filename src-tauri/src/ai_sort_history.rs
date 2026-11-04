//! App-state destination history commands (Step 17c T6).
//!
//! Counts are learned only after a successful ordinary move receipt. The
//! transfer coordinator calls `record_move_receipt`; no browser command can
//! claim a move happened.
#![allow(dead_code)]


use std::collections::HashSet;

use tauri::{State, WebviewWindow};

use crate::ai_search_types::{canonical_extension, SortHistory};
use crate::ai_semantic_history::{
    load_history, never_for_kind, record_move, reset_history, save_history,
};
use crate::ai_semantic_jobs::AiSemanticState;
use crate::{ensure_main, valid_request_id};

pub fn history_for(state: &AiSemanticState) -> SortHistory {
    load_history(state.profile_dir())
}

pub fn persist(state: &AiSemanticState, history: &SortHistory) -> Result<SortHistory, String> {
    save_history(state.profile_dir(), history).map_err(|error| error.code().to_string())?;
    Ok(history.clone())
}

/// Native hook called by 09f only after its report proves the move completed.
pub fn record_move_receipt(
    state: &AiSemanticState,
    extension: &str,
    destination_id: &str,
    sensitive: bool,
    receipt_succeeded: bool,
) -> Result<SortHistory, String> {
    if !receipt_succeeded {
        return Ok(history_for(state));
    }
    let history = history_for(state);
    let next = record_move(&history, extension, destination_id, sensitive, false);
    persist(state, &next)
}

pub fn write_never(state: &AiSemanticState, extension: &str) -> Result<SortHistory, String> {
    let history = history_for(state);
    let next = never_for_kind(&history, extension);
    persist(state, &next)
}

#[tauri::command]
pub async fn ai_sort_history_reset(
    window: WebviewWindow,
    state: State<'_, AiSemanticState>,
    expected_revision: u64,
) -> Result<SortHistory, String> {
    ensure_main(window.label())?;
    if !crate::ai_search_types::is_safe_u64(expected_revision) {
        return Err("ai_search.invalid".to_string());
    }
    let state = state.inner().clone();
    let history = history_for(&state);
    let next = reset_history(&history, expected_revision).map_err(|error| error.code().to_string())?;
    persist(&state, &next)
}

/// Re-exported for the transfer hook; keeps one canonical request-id check.
pub fn validate_reset_request_id(request_id: &str) -> Result<(), String> {
    valid_request_id(request_id)
}

pub fn valid_destination_ids(values: &[String]) -> bool {
    let mut seen = HashSet::new();
    values
        .iter()
        .all(|value| crate::ai_search_types::is_canonical_uuid(value) && seen.insert(value.clone()))
}

pub fn history_extension(path: &str) -> Option<String> {
    let name = path
        .replace('/', "\\")
        .rsplit('\\')
        .next()
        .unwrap_or_default()
        .to_string();
    let dot = name.rfind('.')?;
    if dot == 0 || dot + 1 >= name.len() {
        return None;
    }
    canonical_extension(&name[dot + 1..])
}
