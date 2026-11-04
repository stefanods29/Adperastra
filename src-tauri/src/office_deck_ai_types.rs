//! Native mirror of the deck AI contract (Step 22b T8, ai-deck-1).
//!
//! Model output is structured text only. Coordinates, fonts, colors, XML,
//! HTML and scripts are refused before any typed operation is built.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::local_ai_types::{AiCitation, AiInputRef};
use crate::office_edit_ai_types::{OfficeAiContext, OfficeProposalPreview};
use crate::office_edit_values::OfficeSelection;

pub const DECK_AI_SCHEMA_ID: &str = "deck.outline.v1";
pub const DECK_AI_SCHEMA_REVISION: u32 = 1;
pub const MAX_DECK_AI_SOURCE_SCALARS: usize = 24_000;
pub const MAX_DECK_AI_SLIDES: usize = 30;
pub const MAX_DECK_AI_OUTLINE_BYTES: usize = 128 * 1024;
pub const MAX_DECK_AI_WARNINGS: usize = 64;
pub const MAX_DECK_AI_PREVIEW_SECONDS: u64 = 300;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const BUILTIN_DECK_STYLE_IDS: [&str; 8] = [
    "220b0001-0000-4000-8000-000000000000",
    "220b0002-0000-4000-8000-000000000000",
    "220b0003-0000-4000-8000-000000000000",
    "220b0004-0000-4000-8000-000000000000",
    "220b0005-0000-4000-8000-000000000000",
    "220b0006-0000-4000-8000-000000000000",
    "220b0007-0000-4000-8000-000000000000",
    "220b0008-0000-4000-8000-000000000000",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckAiAction {
    Create,
    Add,
    Shorten,
    Notes,
    Layout,
    Style,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeckAiSource {
    Document {
        input: AiInputRef,
        selection: Option<OfficeSelection>,
    },
    Outline {
        text: String,
    },
    Notes {
        text: String,
    },
    SelectedSlides {
        session_id: Uuid,
        slide_ids: Vec<Uuid>,
        expected_revision: u64,
        expected_content_id: Uuid,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiRequest {
    pub action: DeckAiAction,
    pub source: DeckAiSource,
    pub style_id: Option<Uuid>,
    pub topic: String,
    pub locale: String,
    pub slide_count: u8,
    pub include_speaker_notes: bool,
    pub request_revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiImageSuggestion {
    pub id: Uuid,
    pub prompt: String,
    pub purpose: String,
    pub local_input_id: Option<Uuid>,
    pub alt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiSlide {
    pub outline_id: Uuid,
    pub layout_kind: String,
    pub title: String,
    pub bullets: Vec<String>,
    pub right_bullets: Vec<String>,
    pub caption: String,
    pub quote: String,
    pub speaker_notes: String,
    pub images: Vec<DeckAiImageSuggestion>,
    pub citations: Vec<AiCitation>,
    pub chart_data_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiLayoutChoice {
    pub slide_id: Uuid,
    pub layout_kind: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiOutline {
    pub schema_id: String,
    pub action: DeckAiAction,
    pub suggested_style_id: Option<Uuid>,
    pub rationale: String,
    pub slides: Vec<DeckAiSlide>,
    pub layout_choices: Vec<DeckAiLayoutChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiWarning {
    pub id: Uuid,
    pub kind: String,
    pub outline_id: Option<Uuid>,
    pub source_id: Option<Uuid>,
    pub text_key: String,
    pub argument: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAiSuggestion {
    pub id: Uuid,
    pub request: DeckAiRequest,
    pub source_context_id: Option<Uuid>,
    pub target_context: Option<OfficeAiContext>,
    pub outline: DeckAiOutline,
    pub warnings: Vec<DeckAiWarning>,
    pub preview: Option<OfficeProposalPreview>,
    pub draft_id: Option<Uuid>,
    pub model_id: String,
    pub model_revision: String,
    pub prompt_revision: u32,
    pub status: String,
    pub expires_unix: u64,
}

fn geometry_key(key: &str) -> bool {
    matches!(
        key,
        "x" | "y"
            | "x_pt"
            | "y_pt"
            | "width"
            | "height"
            | "width_pt"
            | "height_pt"
            | "rotation"
            | "rotation_deg"
            | "coordinates"
            | "xml"
            | "svg"
            | "html"
            | "script"
            | "style"
            | "css"
            | "color"
            | "font"
            | "font_family"
            | "font_size"
    )
}

/// Reject model-supplied layout geometry or code anywhere in the tree.
pub fn reject_geometry(value: &Value, depth: usize) -> Result<(), String> {
    if depth > 16 {
        return Err("deck_ai.invalid".to_string());
    }
    match value {
        Value::Array(items) => {
            for item in items {
                reject_geometry(item, depth + 1)?;
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                if geometry_key(&key.to_ascii_lowercase()) {
                    return Err("deck_ai.invalid".to_string());
                }
                reject_geometry(item, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_outline(value: &Value) -> Result<DeckAiOutline, String> {
    reject_geometry(value, 0)?;
    let outline: DeckAiOutline =
        serde_json::from_value(value.clone()).map_err(|_| "deck_ai.invalid".to_string())?;
    if outline.schema_id != DECK_AI_SCHEMA_ID {
        return Err("deck_ai.invalid".to_string());
    }
    if outline.slides.len() > MAX_DECK_AI_SLIDES || outline.layout_choices.len() > MAX_DECK_AI_SLIDES {
        return Err("deck_ai.too_large".to_string());
    }
    if let Some(style) = outline.suggested_style_id {
        if !BUILTIN_DECK_STYLE_IDS.contains(&style.to_string().as_str()) {
            return Err("deck_ai.invalid".to_string());
        }
    }
    let bytes = serde_json::to_vec(&outline).map_err(|_| "deck_ai.invalid".to_string())?;
    if bytes.len() > MAX_DECK_AI_OUTLINE_BYTES {
        return Err("deck_ai.too_large".to_string());
    }
    Ok(outline)
}

pub fn validate_request(value: &Value) -> Result<DeckAiRequest, String> {
    let request: DeckAiRequest =
        serde_json::from_value(value.clone()).map_err(|_| "deck_ai.invalid".to_string())?;
    if !matches!(request.locale.as_str(), "en" | "es") {
        return Err("deck_ai.invalid".to_string());
    }
    if request.slide_count < 1 || usize::from(request.slide_count) > MAX_DECK_AI_SLIDES {
        return Err("deck_ai.too_large".to_string());
    }
    if request.topic.chars().count() > 2000 {
        return Err("deck_ai.too_large".to_string());
    }
    match &request.source {
        DeckAiSource::Outline { text } | DeckAiSource::Notes { text } => {
            if text.is_empty() || text.chars().count() > MAX_DECK_AI_SOURCE_SCALARS {
                return Err("deck_ai.too_large".to_string());
            }
        }
        DeckAiSource::SelectedSlides { slide_ids, .. } => {
            if slide_ids.is_empty() || slide_ids.len() > 30 {
                return Err("deck_ai.too_large".to_string());
            }
        }
        DeckAiSource::Document { .. } => {}
    }
    if request.action == DeckAiAction::Style && request.style_id.is_some() {
        return Err("deck_ai.invalid".to_string());
    }
    if request.action != DeckAiAction::Style && request.style_id.is_none() {
        return Err("deck_ai.invalid".to_string());
    }
    if let Some(style) = request.style_id {
        if !BUILTIN_DECK_STYLE_IDS.contains(&style.to_string().as_str()) {
            return Err("deck_ai.invalid".to_string());
        }
    }
    Ok(request)
}
