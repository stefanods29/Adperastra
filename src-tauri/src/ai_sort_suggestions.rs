//! Explicit destination suggestions from local move history (Step 17c T6).
//!
//! A suggestion is not a mutation grant. The UI calls the ordinary 09f
//! transfer only after an explicit Move click, with the fresh source stamp
//! and the current approved destination list.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::ai_search_types::{
    is_canonical_uuid, AiDestination, AiSearchError, AiSortSuggestion, PREVIEW_TTL_SECONDS,
};
use crate::ai_semantic_history::ranked_destinations;
use crate::ai_semantic_jobs::{AiSemanticState, SemanticPolicy};
use crate::ai_sort_history::{history_for, history_extension};
use crate::jobs::{spawn_job, Jobs};
use crate::local_ai_types::AiInputRef;
use crate::{ensure_main, valid_request_id};

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

pub fn approved_destination(policy: &SemanticPolicy, id: &str) -> Option<AiDestination> {
    policy
        .settings
        .destinations
        .iter()
        .find(|destination| destination.id == id)
        .cloned()
}

pub fn build_suggestion(
    state: &AiSemanticState,
    input: &AiInputRef,
) -> Result<Option<AiSortSuggestion>, String> {
    let policy = state.policy();
    if !policy.settings.sort || policy.settings.destinations.is_empty() {
        return Ok(None);
    }
    let authorizer = state.authorizer();
    let stamp = authorizer.stamp_for(input)?;
    let extension = match history_extension(&stamp.path_key) {
        Some(extension) => extension,
        None => return Ok(None),
    };
    // "Never for this kind" lives in settings; the app-state history has its
    // own copy, so both must agree before a chip is shown.
    if policy
        .settings
        .disabled_sort_extensions
        .iter()
        .any(|disabled| disabled == &extension)
    {
        return Ok(None);
    }
    let ids: Vec<String> = policy
        .settings
        .destinations
        .iter()
        .map(|destination| destination.id.clone())
        .collect();
    let history = history_for(state);
    let ranked = ranked_destinations(&history, &extension, &ids);
    let Some((destination_id, score)) = ranked.first() else {
        return Ok(None);
    };
    if approved_destination(&policy, destination_id).is_none() {
        return Ok(None);
    }
    let identity = fs_service::source_stamp::FileIdentityKey {
        volume_id: stamp.volume_id.clone(),
        file_id: stamp.file_id.clone(),
        path_key: stamp.path_key.clone(),
        stable: stamp.volume_id != "00000000" && stamp.file_id != "0000000000000000",
    };
    let suggestion = AiSortSuggestion {
        id: Uuid::new_v4().to_string(),
        identity,
        source_stamp: stamp,
        destination_id: destination_id.clone(),
        score: *score,
        basis: "history".to_string(),
        reason: "history".to_string(),
        extension,
        expires_unix: now_unix().saturating_add(PREVIEW_TTL_SECONDS),
    };
    if !suggestion.score.is_finite() || !(0.0..=1.0).contains(&suggestion.score) {
        return Err(AiSearchError::Invalid.code().to_string());
    }
    Ok(Some(suggestion))
}

#[tauri::command]
pub async fn ai_sort_suggest_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AiSemanticState>,
    request_id: String,
    input: AiInputRef,
    prepared_id: String,
    outbound_consent_id: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if input.id.is_nil()
        || input.expected_revision == 0
        // An empty prepared id is the explicit history-only path, which needs
        // no model or network; a non-empty id must be a native preview id.
        || (!prepared_id.is_empty() && !is_canonical_uuid(&prepared_id))
        || outbound_consent_id
            .as_deref()
            .is_some_and(|id| !is_canonical_uuid(id))
    {
        return Err(AiSearchError::Invalid.code().to_string());
    }
    let state = state.inner().clone();
    if !state.policy().settings.sort {
        return Err(AiSearchError::Unavailable.code().to_string());
    }
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |_context| {
        let suggestion = build_suggestion(&state, &input)?;
        serde_json::to_value(suggestion).map_err(|_| AiSearchError::Failed.code().to_string())
    });
    Ok(())
}
