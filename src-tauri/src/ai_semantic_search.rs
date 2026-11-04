//! Tauri commands for semantic search, status and rebuild (Step 17c T3).
//!
//! Search is one shared cancellable job. The query is embedded with the same
//! local model/revision as the stored rows; a stale revision is never mixed.
//! Sensitive one-shot requests consume a native one-use grant and leave no
//! disk or history record.
#![allow(dead_code)]


use fs_service::CancellationToken;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::ai_search_types::{
    eligible_roots_for_mode, AiSearchError, AiSearchResult, AiSemanticRoot, SemanticPage,
    SemanticQuery, SemanticQueryKind, SemanticStatus, SemanticVectorKind,
};
use crate::ai_semantic_jobs::{
    run_rebuild, AiSemanticState, SensitiveOneShot, SensitiveConsents,
};
use crate::ai_semantic_store::SemanticStore;
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

fn code(error: AiSearchError) -> String {
    error.code().to_string()
}

fn allowed_roots(state: &AiSemanticState, query: &SemanticQuery) -> Vec<String> {
    let policy = state.policy();
    let mode = match query.kind {
        SemanticQueryKind::Text | SemanticQueryKind::SimilarText => "text",
        SemanticQueryKind::Photo | SemanticQueryKind::SimilarImage => "photos",
    };
    eligible_roots_for_mode(&policy.settings, &policy.index_roots, &policy.sensitive_root_ids, mode)
        .into_iter()
        .map(|root: &AiSemanticRoot| root.root_id.clone())
        .collect()
}

/// Consent is per action: the 11a content root and the selected query mode
/// must both be switched on, and every root must still be enabled.
fn ensure_query_allowed(state: &AiSemanticState, query: &SemanticQuery) -> Result<(), String> {
    query.validate().map_err(code)?;
    let policy = state.policy();
    let enabled = match query.kind {
        SemanticQueryKind::Text | SemanticQueryKind::SimilarText => policy.settings.semantic_text,
        SemanticQueryKind::Photo | SemanticQueryKind::SimilarImage => policy.settings.photo_index,
    };
    if !enabled {
        return Err("ai_search.unavailable".to_string());
    }
    // The mode is unavailable while its pinned local embedder is missing;
    // no empty page or fallback is produced in that state.
    state
        .embedder()
        .model_identity(query.kind.vector_kind())
        .map_err(|_| "ai_search.unavailable".to_string())?;
    let allowed = allowed_roots(state, query);
    for root in &query.root_ids {
        if !allowed.iter().any(|candidate| candidate == root) {
            return Err("ai_search.denied".to_string());
        }
    }
    if query.sensitive_consent_id.is_some()
        && !matches!(query.kind, SemanticQueryKind::SimilarText | SemanticQueryKind::SimilarImage)
    {
        return Err("ai_search.sensitive".to_string());
    }
    Ok(())
}

fn store_search(
    state: &AiSemanticState,
    store: &SemanticStore,
    query: &SemanticQuery,
    cancel: &CancellationToken,
) -> Result<SemanticPage, String> {
    if let Some(consent_id) = &query.sensitive_consent_id {
        let consents: SensitiveConsents = state.consents();
        let input = consents.consume(consent_id)?;
        let mut one = SensitiveOneShot::new(input);
        let mut effective = query.clone();
        effective.input = one.input_ref();
        let (reply, _kind) = state.query_embedding(&effective, cancel)?;
        let kind = effective.kind.vector_kind();
        match store.current_model(kind).map_err(code)? {
            Some((stored_id, stored_revision))
                if stored_id == reply.model_id && stored_revision == reply.model_revision => {}
            Some(_) => return Err("ai_search.changed".to_string()),
            None => return Err("ai_search.unavailable".to_string()),
        }
        one.set_vector(reply.dimensions, reply.vector).map_err(code)?;
        let page = one.compare(store, &effective, cancel).map_err(code)?;
        one.lock();
        return Ok(page);
    }
    let (reply, kind) = state.query_embedding(query, cancel)?;
    if kind == SemanticVectorKind::Text {
        // Text and similar_text use the E5 model.
        if reply.dimensions != crate::ai_search_types::TEXT_EMBEDDING_DIMENSIONS {
            return Err("ai_search.invalid".to_string());
        }
    } else if reply.dimensions != crate::ai_search_types::IMAGE_EMBEDDING_DIMENSIONS {
        return Err("ai_search.invalid".to_string());
    }
    let writable = state.open_store()?;
    // A query never promotes or rewrites the index. If the selected model no
    // longer matches the stored one, the feature is unavailable until an
    // explicit rebuild, rather than silently deleting vectors mid-search.
    match writable.current_model(kind).map_err(code)? {
        Some((stored_id, stored_revision))
            if stored_id == reply.model_id && stored_revision == reply.model_revision => {}
        Some(_) => return Err("ai_search.changed".to_string()),
        None => return Err("ai_search.unavailable".to_string()),
    }
    writable
        .search(query, &reply.vector, cancel)
        .map_err(code)
}

#[tauri::command]
pub async fn ai_semantic_search_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AiSemanticState>,
    request_id: String,
    query: SemanticQuery,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let state = state.inner().clone();
    ensure_query_allowed(&state, &query)?;
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let store = state.open_store()?;
        let page = store_search(&state, &store, &query, context.token())?;
        serde_json::to_value(page).map_err(|_| "ai_search.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn ai_semantic_status(
    window: WebviewWindow,
    state: State<'_, AiSemanticState>,
) -> Result<SemanticStatus, String> {
    ensure_main(window.label())?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = state.open_store()?;
        let mut status = store.status().map_err(code)?;
        let policy = state.policy();
        if policy.paused {
            status.paused = true;
            if status.reason_code.is_none() {
                status.reason_code = policy.reason_code.clone();
            }
        }
        // Status must state the truth: with no embedder at all, semantic
        // modes are unavailable rather than showing an empty index as ready.
        let text_missing = state
            .embedder()
            .model_identity(crate::ai_search_types::SemanticVectorKind::Text)
            .is_err();
        let image_missing = state
            .embedder()
            .model_identity(crate::ai_search_types::SemanticVectorKind::Image)
            .is_err();
        if text_missing && image_missing {
            status.paused = true;
            status.reason_code = Some("ai_search.unavailable".to_string());
        }
        Ok(status)
    })
    .await
    .map_err(|_| "ai_search.failed".to_string())?
}

#[tauri::command]
pub async fn ai_semantic_rebuild_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AiSemanticState>,
    request_id: String,
    root_ids: Vec<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let state = state.inner().clone();
    let policy = state.policy();
    crate::ai_semantic_jobs::validate_policy_roots(&policy, &root_ids)?;
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let status = run_rebuild(&state, &root_ids, context)?;
        serde_json::to_value(status).map_err(|_| "ai_search.failed".to_string())
    });
    Ok(())
}

/// Not a browser command: 09k's native sensitive dialog issues one grant.
pub fn issue_sensitive_consent(
    state: &AiSemanticState,
    consent_id: String,
    input: crate::local_ai_types::AiInputRef,
) -> Result<(), String> {
    state.consents().issue(consent_id, input)
}

pub fn clear_sensitive_consents(state: &AiSemanticState) {
    state.consents().clear();
}

/// Shared validation used by tests and by native callers before a job starts.
pub fn validate_query_for_policy(
    state: &AiSemanticState,
    query: &SemanticQuery,
) -> AiSearchResult<()> {
    query.validate()?;
    ensure_query_allowed(state, query).map_err(|_| AiSearchError::Denied)
}
