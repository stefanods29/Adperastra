//! Native IPC for extraction and inline suggestions (Step 17d T3/T5/T6).
//!
//! Provider registration and review state live in `ai_extraction_runtime.rs`.
//! Every command starts with `ensure_main`, validates request IDs and bounds,
//! and runs long work through the shared job table.

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::ai_extraction_requests::{
    ExtractionCorrection, ExtractionPublish, ExtractionRequest,
};
use crate::ai_extraction_runtime::AiExtractionRuntime;
use crate::ai_extraction_types::ExtractionReview;
use crate::ai_inline::{validate_completion, validate_request, InlineCompletionRequest};
use crate::jobs::Jobs;
use crate::{ensure_main, valid_request_id};

fn json<T: Serialize>(value: &T) -> Result<serde_json::Value, String> {
    serde_json::to_value(value).map_err(|_| "ai_extract.failed".to_string())
}

#[tauri::command]
pub async fn ai_extract_prepare_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    runtime: State<'_, AiExtractionRuntime>,
    request_id: String,
    request: ExtractionRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    crate::ai_extraction_validation::validate_request(&request)?;
    let backend = runtime.extraction()?;
    let token = jobs.begin(&request_id, request.inputs.len())?;
    let app: AppHandle = window.app_handle().clone();
    let store_app = app.clone();
    crate::jobs::spawn_job(app, request_id, token, move |_| {
        let prepared = backend.prepare(&request)?;
        // The prepared record binds the exact source revisions and expires
        // after five minutes; only DTOs are stored.
        store_app
            .state::<AiExtractionRuntime>()
            .store_prepared(prepared.clone())?;
        json(&prepared)
    });
    Ok(())
}

#[tauri::command]
pub async fn ai_extract_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    runtime: State<'_, AiExtractionRuntime>,
    request_id: String,
    request: ExtractionRequest,
    prepared_id: String,
    outbound_consent_id: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    crate::ai_extraction_validation::validate_request(&request)?;
    let prepared = runtime.take_prepared(
        Uuid::parse_str(&prepared_id).map_err(|_| "ai_extract.invalid".to_string())?,
    )?;
    if let Some(consent) = &outbound_consent_id {
        if consent.is_empty() || consent.len() > 128 {
            return Err("ai_extract.invalid".to_string());
        }
    }
    let backend = runtime.extraction()?;
    let token = jobs.begin(&request_id, prepared.sources.len())?;
    let app: AppHandle = window.app_handle().clone();
    let store_app = app.clone();
    crate::jobs::spawn_job(app, request_id, token, move |_| {
        let review = backend.extract(&request, &prepared, outbound_consent_id.as_deref())?;
        store_app
            .state::<AiExtractionRuntime>()
            .store_review(review.clone())?;
        json(&review)
    });
    Ok(())
}

#[tauri::command]
pub fn ai_extract_page(
    window: WebviewWindow,
    runtime: State<'_, AiExtractionRuntime>,
    review_id: String,
    cursor: String,
) -> Result<ExtractionReview, String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&review_id).map_err(|_| "ai_extract.invalid".to_string())?;
    runtime.page(id, &cursor)
}

#[tauri::command]
pub fn ai_extract_correct(
    window: WebviewWindow,
    runtime: State<'_, AiExtractionRuntime>,
    review_id: String,
    expected_revision: u64,
    corrections: Vec<ExtractionCorrection>,
) -> Result<ExtractionReview, String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&review_id).map_err(|_| "ai_extract.invalid".to_string())?;
    runtime.correct(id, expected_revision, &corrections)
}

#[tauri::command]
pub async fn ai_extract_capture_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    runtime: State<'_, AiExtractionRuntime>,
    request_id: String,
    request: ExtractionPublish,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    crate::ai_extraction_validation::validate_publish(&request)?;
    let sink = runtime.capture_sink()?;
    let review = runtime.review(request.review_id)?;
    let labels: Vec<String> = if request.include_source_labels && !review.sensitive {
        review
            .sources
            .iter()
            .map(|source| source.display_name.clone())
            .collect()
    } else {
        Vec::new()
    };
    let token = jobs.begin(&request_id, 1)?;
    let app: AppHandle = window.app_handle().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_| {
        if request.expected_revision != review.revision
            || request.expected_content_id != review.content_id
        {
            return Err("ai_extract.changed".to_string());
        }
        let bytes = crate::ai_extraction_capture::build_capture(&review, &request, &labels)?;
        let snapshot = sink.publish(&bytes, &request)?;
        json(&snapshot)
    });
    Ok(())
}

#[tauri::command]
pub fn ai_extract_release(
    window: WebviewWindow,
    runtime: State<'_, AiExtractionRuntime>,
    review_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if let Ok(id) = Uuid::parse_str(&review_id) {
        runtime.release(id);
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_inline_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    runtime: State<'_, AiExtractionRuntime>,
    request_id: String,
    request: InlineCompletionRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let current = runtime.inline_state(request.document_id)?;
    validate_request(&request, &current)?;
    let backend = runtime.inline_backend()?;
    let token = jobs.begin(&request_id, 1)?;
    let app: AppHandle = window.app_handle().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_| {
        let completion = backend.complete(&request, &current)?;
        validate_completion(&completion, &request)?;
        if completion.expires_unix == 0 {
            return Err("ai_inline.changed".to_string());
        }
        json(&completion)
    });
    Ok(())
}


