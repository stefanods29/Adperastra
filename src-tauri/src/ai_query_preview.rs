//! Natural language -> editable 11a filters (Step 17c T4).
//!
//! The model output is a bounded typed shape, never SQL, regex, shell text or
//! a path. Units resolve with MiB = 1,048,576 bytes and date intervals are
//! kept half-open internally, then converted once to 11a's inclusive bounds.

use serde::Deserialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::ai_query_dates::{parse_date, resolve_preset};
use crate::ai_search_types::{
    is_canonical_uuid, AiSearchError, NaturalQueryPreview, NaturalQueryRequest, PREVIEW_TTL_SECONDS,
    SEARCH_QUERY_SCHEMA_ID,
};
use crate::ai_semantic_jobs::AiSemanticState;
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

const MAX_MODEL_BYTES: usize = 262_144;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOutput {
    status: String,
    query: Option<RawQuery>,
    explanation: String,
    unsupported: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawQuery {
    text: String,
    roots: Vec<String>,
    filter: Option<RawFilter>,
    sort: Option<RawSort>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSort {
    key: String,
    direction: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum RawFilter {
    All {
        clauses: Vec<RawFilter>,
    },
    Any {
        clauses: Vec<RawFilter>,
    },
    Not {
        clause: Box<RawFilter>,
    },
    String {
        field: String,
        op: String,
        value: String,
    },
    Number {
        field: String,
        op: String,
        value: f64,
        #[serde(default)]
        unit: Option<String>,
    },
    Date {
        field: String,
        #[serde(default)]
        preset: Option<String>,
        #[serde(default)]
        from: Option<String>,
        #[serde(default)]
        to: Option<String>,
    },
}

fn invalid() -> String {
    "ai_search.invalid".to_string()
}

/// The bounded vocabulary sent as user data. It contains root IDs/labels and
/// the allowed field/operator names; it never contains file contents.
pub fn build_vocabulary(request: &NaturalQueryRequest, state: &AiSemanticState) -> serde_json::Value {
    let policy = state.policy();
    let roots: Vec<serde_json::Value> = policy
        .index_roots
        .iter()
        .filter(|root| root.enabled && request.root_ids.iter().any(|id| id == &root.id))
        .take(32)
        .map(|root| {
            serde_json::json!({
                "root_id": root.id,
                "label": root.path,
            })
        })
        .collect();
    serde_json::json!({
        "request": request.text.chars().take(1024).collect::<String>(),
        "roots": roots,
        "fields": ["kind", "ext", "author", "size", "width", "height", "duration_ms", "pages", "modified", "created", "date_taken"],
        "string_ops": ["eq", "contains"],
        "number_ops": ["eq", "gte", "lte", "gt", "lt"],
        "number_units": ["B", "KiB", "MiB", "GiB"],
        "date_presets": ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year"],
        "sort_keys": ["name", "modified", "size", "kind"],
        "sort_directions": ["ascending", "descending"],
    })
}

pub fn build_preview(
    request: &NaturalQueryRequest,
    raw_json: &str,
    state: &AiSemanticState,
) -> Result<NaturalQueryPreview, String> {
    request
        .validate()
        .map_err(|error: AiSearchError| error.code().to_string())?;
    if raw_json.len() > MAX_MODEL_BYTES {
        return Err("ai_search.too_large".to_string());
    }
    let raw: RawOutput = serde_json::from_str(raw_json).map_err(|_| invalid())?;
    if raw.explanation.chars().count() > 1024
        || raw.unsupported.len() > 16
        || raw.unsupported.iter().any(|term| term.chars().count() > 128)
    {
        return Err("ai_search.too_large".to_string());
    }
    let now = request.now_unix;
    let preview_id = uuid::Uuid::new_v4().to_string();
    let expires = now.saturating_add(PREVIEW_TTL_SECONDS);
    let explanation = raw.explanation.clone();
    let base = |status: &str, query: Option<search_index::types::SearchQuery>, unsupported: Vec<String>| NaturalQueryPreview {
        id: preview_id.clone(),
        request_revision: request.request_revision,
        status: status.to_string(),
        query,
        explanation: explanation.clone(),
        unsupported,
        captured_now_unix: now,
        expires_unix: expires,
    };
    if raw.status == "clarify" {
        if raw.query.is_some() {
            return Err(invalid());
        }
        let preview = base("clarify", None, raw.unsupported.clone());
        preview.validate().map_err(|error| error.code().to_string())?;
        return Ok(preview);
    }
    if raw.status != "ready" {
        return Err(invalid());
    }
    if !raw.unsupported.is_empty() {
        return Ok(base("clarify", None, raw.unsupported.clone()));
    }
    let raw_query = raw.query.ok_or_else(invalid)?;
    if raw_query.text.chars().count() > 1024 || raw_query.roots.is_empty() || raw_query.roots.len() > 32 {
        return Err("ai_search.too_large".to_string());
    }
    let policy = state.policy();
    let enabled: Vec<&str> = policy
        .index_roots
        .iter()
        .filter(|root| root.enabled)
        .map(|root| root.id.as_str())
        .collect();
    for root in &raw_query.roots {
        if !is_canonical_uuid(root) || !request.root_ids.iter().any(|id| id == root) {
            return Err("ai_search.denied".to_string());
        }
        if !enabled.iter().any(|id| id == root) {
            return Err("ai_search.denied".to_string());
        }
    }
    if raw_query.roots.len() != raw_query.roots.iter().collect::<std::collections::HashSet<_>>().len() {
        return Err(invalid());
    }
    let filter = match raw_query.filter {
        Some(filter) => Some(convert_filter(filter, now, 1)?),
        None => None,
    };
    let sort = match raw_query.sort {
        Some(sort) => convert_sort(sort)?,
        None => search_index::types::SortSpec::default(),
    };
    let query = search_index::types::SearchQuery {
        mode: search_index::types::SearchMode::Filters,
        text: raw_query.text,
        roots: raw_query.roots,
        filter,
        regex_scope: search_index::types::RegexScope::Name,
        match_case: false,
        sort_date: None,
        sort,
    };
    crate::ai_search_types::validate_interpreted_query(&query)
        .map_err(|error| error.code().to_string())?;
    let preview = base("ready", Some(query), Vec::new());
    preview.validate().map_err(|error| error.code().to_string())?;
    Ok(preview)
}

fn convert_sort(sort: RawSort) -> Result<search_index::types::SortSpec, String> {
    let key = match sort.key.as_str() {
        "name" => search_index::types::SortKey::Name,
        "modified" => search_index::types::SortKey::Modified,
        "size" => search_index::types::SortKey::Size,
        "kind" => search_index::types::SortKey::Kind,
        _ => return Err(invalid()),
    };
    let direction = match sort.direction.as_str() {
        "ascending" => search_index::types::SortDirection::Ascending,
        "descending" => search_index::types::SortDirection::Descending,
        _ => return Err(invalid()),
    };
    Ok(search_index::types::SortSpec { key, direction })
}

fn convert_filter(filter: RawFilter, now: u64, depth: usize) -> Result<search_index::types::SearchFilter, String> {
    if depth > 4 {
        return Err("ai_search.too_large".to_string());
    }
    match filter {
        RawFilter::All { clauses } => convert_group(clauses, now, depth, true),
        RawFilter::Any { clauses } => convert_group(clauses, now, depth, false),
        RawFilter::Not { clause } => Ok(search_index::types::SearchFilter::Not {
            clause: Box::new(convert_filter(*clause, now, depth + 1)?),
        }),
        RawFilter::String { field, op, value } => {
            let field = match field.as_str() {
                "kind" => search_index::types::StringField::Kind,
                "ext" => search_index::types::StringField::Ext,
                "author" => search_index::types::StringField::Author,
                _ => return Err(invalid()),
            };
            let op = match op.as_str() {
                "eq" => search_index::types::StringOp::Eq,
                "contains" => search_index::types::StringOp::Contains,
                _ => return Err(invalid()),
            };
            if value.chars().count() > 256 {
                return Err("ai_search.too_large".to_string());
            }
            Ok(search_index::types::SearchFilter::String { field, op, value })
        }
        RawFilter::Number { field, op, value, unit } => {
            let field = match field.as_str() {
                "size" => search_index::types::NumberField::Size,
                "width" => search_index::types::NumberField::Width,
                "height" => search_index::types::NumberField::Height,
                "duration_ms" => search_index::types::NumberField::DurationMs,
                "pages" => search_index::types::NumberField::Pages,
                _ => return Err(invalid()),
            };
            let (op, value) = model_number(value, &op, unit.as_deref())?;
            Ok(search_index::types::SearchFilter::Number { field, op, value })
        }
        RawFilter::Date { field, preset, from, to } => {
            let field = match field.as_str() {
                "modified" => search_index::types::DateField::Modified,
                "created" => search_index::types::DateField::Created,
                "date_taken" => search_index::types::DateField::DateTaken,
                _ => return Err(invalid()),
            };
            let (from_unix, to_unix) = if let Some(preset) = preset {
                if from.is_some() || to.is_some() {
                    return Err(invalid());
                }
                resolve_preset(now, &preset)?
            } else {
                let from_unix = from.map(|value| parse_date(&value)).transpose()?;
                let to_unix = to.map(|value| parse_date(&value).map(|start| start + 86_399)).transpose()?;
                (from_unix, to_unix)
            };
            if from_unix.is_none() && to_unix.is_none() {
                return Err(invalid());
            }
            Ok(search_index::types::SearchFilter::Date { field, from_unix, to_unix })
        }
    }
}

/// `gt`/`lt` become `gte`/`lte` with one byte of adjustment. MiB is exactly
/// 1,048,576 bytes; "bigger than 5 MiB" is 5,242,881.
fn convert_group(
    clauses: Vec<RawFilter>,
    now: u64,
    depth: usize,
    all: bool,
) -> Result<search_index::types::SearchFilter, String> {
    if clauses.is_empty() || clauses.len() > 32 {
        return Err("ai_search.too_large".to_string());
    }
    let converted: Result<Vec<_>, _> = clauses
        .into_iter()
        .map(|clause| convert_filter(clause, now, depth + 1))
        .collect();
    let converted = converted?;
    Ok(if all {
        search_index::types::SearchFilter::All { clauses: converted }
    } else {
        search_index::types::SearchFilter::Any { clauses: converted }
    })
}

fn model_number(
    value: f64,
    op: &str,
    unit: Option<&str>,
) -> Result<(search_index::types::NumberOp, f64), String> {
    if !value.is_finite() || value < 0.0 {
        return Err(invalid());
    }
    let scale = match unit.unwrap_or("B") {
        "B" => 1f64,
        "KiB" => 1024f64,
        "MiB" => 1024f64 * 1024f64,
        "GiB" => 1024f64 * 1024f64 * 1024f64,
        _ => return Err(invalid()),
    };
    let bytes = (value * scale).ceil();
    if !bytes.is_finite() || bytes > 9_007_199_254_740_991f64 {
        return Err("ai_search.too_large".to_string());
    }
    let (op, bytes) = match op {
        "eq" => (search_index::types::NumberOp::Eq, bytes),
        "gte" => (search_index::types::NumberOp::Gte, bytes),
        "lte" => (search_index::types::NumberOp::Lte, bytes),
        "gt" => (search_index::types::NumberOp::Gte, bytes + 1.0),
        "lt" => (
            search_index::types::NumberOp::Lte,
            if bytes <= 0.0 { 0.0 } else { bytes - 1.0 },
        ),
        _ => return Err(invalid()),
    };
    if bytes > 9_007_199_254_740_991f64 {
        return Err("ai_search.too_large".to_string());
    }
    Ok((op, bytes))
}

#[tauri::command]
pub async fn ai_query_preview_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AiSemanticState>,
    request_id: String,
    request: NaturalQueryRequest,
    prepared_id: String,
    outbound_consent_id: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    request
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
    let policy = state.policy();
    if !policy.settings.natural_query {
        return Err("ai_search.unavailable".to_string());
    }
    // Preparation may disclose root labels; only enabled, non-sensitive
    // ordinary roots may reach that preview.
    for root in &request.root_ids {
        if policy.sensitive_root_ids.iter().any(|id| id == root) {
            return Err("ai_search.sensitive".to_string());
        }
        if !policy
            .index_roots
            .iter()
            .any(|candidate| candidate.id == *root && candidate.enabled)
        {
            return Err("ai_search.denied".to_string());
        }
    }
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let vocabulary = build_vocabulary(&request, &state);
        let user_json = serde_json::to_string(&vocabulary).map_err(|_| invalid())?;
        let raw = state.gateway().complete(
            SEARCH_QUERY_SCHEMA_ID,
            &user_json,
            &prepared_id,
            outbound_consent_id.as_deref(),
            context.token(),
        )?;
        let preview = build_preview(&request, &raw, &state)?;
        serde_json::to_value(preview).map_err(|_| "ai_search.failed".to_string())
    });
    Ok(())
}
