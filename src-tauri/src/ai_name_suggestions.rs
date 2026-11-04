//! Content-based file-name suggestions (Step 17c T5).
//!
//! At most 100 explicitly selected inputs, no background content read. The
//! model returns a stem only; the extension stays an app-owned value and the
//! result is never a rename request until 09e previews it.

use std::collections::HashSet;

use serde::Deserialize;
use uuid::Uuid;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::ai_search_types::{
    is_canonical_uuid, AiNameSuggestion, AiNamingPattern, AiSearchError, AiSearchResult,
    MAX_AI_NAME_INPUTS, MAX_AI_NAME_STEM_SCALARS, SEARCH_NAMES_SCHEMA_ID,
};
use crate::ai_semantic_jobs::AiSemanticState;
use crate::jobs::{spawn_job, Jobs};
use crate::local_ai_types::{AiCitation, AiInputRef};
use crate::{ensure_main, valid_request_id};

const MAX_MODEL_BYTES: usize = 262_144;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawNames {
    suggestions: Vec<RawSuggestion>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSuggestion {
    input_index: u32,
    proposed_stem: String,
    reason: String,
    confidence: f64,
    citations: Vec<AiCitation>,
}

fn invalid() -> String {
    "ai_search.invalid".to_string()
}

fn reserved(stem: &str) -> bool {
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    )
}

/// Visible normalization: invalid characters become `_`, trailing spaces and
/// dots disappear, empty/reserved stems are refused rather than blanked.
pub fn normalize_stem(value: &str) -> AiSearchResult<String> {
    let mut stem = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            stem.push('_');
        } else {
            stem.push(character);
        }
    }
    let stem = stem.trim_end_matches([' ', '.']).to_string();
    if stem.is_empty() || stem.chars().count() > MAX_AI_NAME_STEM_SCALARS || reserved(&stem) {
        return Err(AiSearchError::Invalid);
    }
    Ok(stem)
}

fn validate_inputs(inputs: &[AiInputRef]) -> AiSearchResult<()> {
    if inputs.is_empty() || inputs.len() > MAX_AI_NAME_INPUTS {
        return Err(AiSearchError::TooLarge);
    }
    let mut ids: HashSet<Uuid> = HashSet::new();
    for input in inputs {
        if input.id.is_nil() || !ids.insert(input.id) {
            return Err(AiSearchError::Invalid);
        }
        if input.expected_revision == 0 {
            return Err(AiSearchError::Invalid);
        }
    }
    Ok(())
}

pub fn build_suggestions(
    raw_json: &str,
    inputs: &[AiInputRef],
    state: &AiSemanticState,
) -> Result<Vec<AiNameSuggestion>, String> {
    if raw_json.len() > MAX_MODEL_BYTES {
        return Err("ai_search.too_large".to_string());
    }
    let raw: RawNames = serde_json::from_str(raw_json).map_err(|_| invalid())?;
    if raw.suggestions.len() > inputs.len() {
        return Err(invalid());
    }
    let authorizer = state.authorizer();
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(raw.suggestions.len());
    for suggestion in raw.suggestions {
        let index = usize::try_from(suggestion.input_index).map_err(|_| invalid())?;
        let input = inputs.get(index).ok_or_else(invalid)?;
        if !seen.insert(index) {
            return Err(invalid());
        }
        let proposed_stem = normalize_stem(&suggestion.proposed_stem).map_err(|error| error.code().to_string())?;
        if suggestion.reason.chars().count() > 512
            || !suggestion.confidence.is_finite()
            || !(0.0..=1.0).contains(&suggestion.confidence)
            || suggestion.citations.len() > 8
        {
            return Err(invalid());
        }
        let source_stamp = authorizer.stamp_for(input).map_err(|error| {
            if error.starts_with("ai_search.") {
                error
            } else {
                "ai_search.changed".to_string()
            }
        })?;
        let output = AiNameSuggestion {
            source: input.clone(),
            source_stamp,
            proposed_stem,
            reason: suggestion.reason,
            confidence: suggestion.confidence,
            citations: suggestion.citations,
        };
        output
            .validate()
            .map_err(|error| error.code().to_string())?;
        result.push(output);
    }
    Ok(result)
}

pub fn user_payload(inputs: &[AiInputRef], pattern: &AiNamingPattern) -> Result<String, String> {
    serde_json::to_string(&serde_json::json!({
        "inputs": inputs.iter().map(|input| serde_json::json!({
            "input_id": input.id,
            "revision": input.expected_revision,
        })).collect::<Vec<_>>(),
        "pattern": pattern,
    }))
    .map_err(|_| invalid())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_names_suggest_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AiSemanticState>,
    request_id: String,
    inputs: Vec<AiInputRef>,
    pattern: AiNamingPattern,
    prepared_id: String,
    outbound_consent_id: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    validate_inputs(&inputs)
        .map_err(|error: AiSearchError| error.code().to_string())?;
    pattern
        .validate()
        .map_err(|error: AiSearchError| error.code().to_string())?;
    if !is_canonical_uuid(&prepared_id)
        || outbound_consent_id
            .as_deref()
            .is_some_and(|id| !is_canonical_uuid(id))
    {
        return Err(invalid());
    }
    let state = state.inner().clone();
    if !state.policy().settings.rename {
        return Err("ai_search.unavailable".to_string());
    }
    // Every selected source must still be an authorized live document before
    // any excerpt is prepared or sent.
    let authorizer = state.authorizer();
    for input in &inputs {
        authorizer.stamp_for(input).map_err(|error| {
            if error.starts_with("ai_search.") {
                error
            } else {
                "ai_search.changed".to_string()
            }
        })?;
    }
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let payload = user_payload(&inputs, &pattern)?;
        let raw = state.gateway().complete(
            SEARCH_NAMES_SCHEMA_ID,
            &payload,
            &prepared_id,
            outbound_consent_id.as_deref(),
            context.token(),
        )?;
        let suggestions = build_suggestions(&raw, &inputs, &state)?;
        serde_json::to_value(suggestions).map_err(|_| "ai_search.failed".to_string())
    });
    Ok(())
}
