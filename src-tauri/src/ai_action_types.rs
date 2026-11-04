//! Canonical AI-action wire types (Step 17b, revision `ai-actions-1`).
//!
//! The TypeScript mirror is `src/services/aiActionTypes.ts`. `AiInputRef`,
//! `AiCitation`, `AiSourceLocation` and `AiTaskOptions` come from 14c
//! (`ai-runtime-1`) and are never duplicated here.
//!
//! Every request is parsed from JSON with exact key checks: unknown fields
//! fail `ai_actions.invalid` instead of being silently ignored.
#![allow(dead_code)]


use ai_runtime::{AiCitation, AiInputKind, AiInputRef, AiSourceLocation, AiTaskOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

pub const MAX_ACTION_INPUTS: usize = 100;
pub const MAX_QUESTION_SCALARS: usize = 4_096;
pub const MAX_TARGET_LANGUAGE: usize = 35;
pub const MAX_QUERY_SCALARS: usize = 512;
pub const MAX_BLOCKS: usize = 64;
pub const MAX_PLAIN_TEXT: usize = 8_192;
pub const MAX_CITATIONS: usize = 256;
pub const MAX_WARNINGS: usize = 32;
pub const MAX_FAQ_PAIRS: usize = 12;
pub const MAX_TRANSLATION_PAIRS: usize = 32;
pub const MAX_ACTION_ITEMS: usize = 32;
pub const MAX_MOMENTS: usize = 20;
pub const MAX_COMPARISON_POINTS: usize = 32;
pub const MAX_MODEL_TEXT: usize = 96;
pub const MAX_MODEL_REVISION: usize = 96;
pub const CAPTION_WINDOW_SECONDS: u32 = 30;
pub const AI_ACTIONS_SETTINGS_SCHEMA: u32 = 45;

pub const ERR_INVALID: &str = "ai_actions.invalid";
pub const ERR_UNSUPPORTED: &str = "ai_actions.unsupported";
pub const ERR_TOO_LARGE: &str = "ai_actions.too_large";
pub const ERR_SOURCE_CHANGED: &str = "ai_actions.source_changed";
pub const ERR_EMPTY_MASK: &str = "ai_actions.empty_mask";
pub const ERR_MASK_TOO_LARGE: &str = "ai_actions.image_mask_too_large";
pub const ERR_NO_SOURCES: &str = "ai_actions.no_sources";
pub const ERR_LANGUAGE: &str = "ai_actions.language_unsupported";
pub const ERR_FAILED: &str = "ai_actions.failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiActionId {
    RemoveBackground,
    BlurBackground,
    EraseObject,
    CopyText,
    DescribeImage,
    AskImage,
    Upscale,
    Summarize,
    CreateFaq,
    Translate,
    KeyPoints,
    AskFile,
    Transcribe,
    SummarizeMedia,
    FindMoments,
    CompareDocuments,
    SummarizeFolder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiActionInputKind {
    Image,
    Document,
    Audio,
    Video,
    Multiple,
    Folder,
}

impl AiActionInputKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AiActionInputKind::Image => "image",
            AiActionInputKind::Document => "document",
            AiActionInputKind::Audio => "audio",
            AiActionInputKind::Video => "video",
            AiActionInputKind::Multiple => "multiple",
            AiActionInputKind::Folder => "folder",
        }
    }
}

impl AiActionId {
    pub const ALL: [AiActionId; 17] = [
        AiActionId::RemoveBackground,
        AiActionId::BlurBackground,
        AiActionId::EraseObject,
        AiActionId::CopyText,
        AiActionId::DescribeImage,
        AiActionId::AskImage,
        AiActionId::Upscale,
        AiActionId::Summarize,
        AiActionId::CreateFaq,
        AiActionId::Translate,
        AiActionId::KeyPoints,
        AiActionId::AskFile,
        AiActionId::Transcribe,
        AiActionId::SummarizeMedia,
        AiActionId::FindMoments,
        AiActionId::CompareDocuments,
        AiActionId::SummarizeFolder,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AiActionId::RemoveBackground => "remove_background",
            AiActionId::BlurBackground => "blur_background",
            AiActionId::EraseObject => "erase_object",
            AiActionId::CopyText => "copy_text",
            AiActionId::DescribeImage => "describe_image",
            AiActionId::AskImage => "ask_image",
            AiActionId::Upscale => "upscale",
            AiActionId::Summarize => "summarize",
            AiActionId::CreateFaq => "create_faq",
            AiActionId::Translate => "translate",
            AiActionId::KeyPoints => "key_points",
            AiActionId::AskFile => "ask_file",
            AiActionId::Transcribe => "transcribe",
            AiActionId::SummarizeMedia => "summarize_media",
            AiActionId::FindMoments => "find_moments",
            AiActionId::CompareDocuments => "compare_documents",
            AiActionId::SummarizeFolder => "summarize_folder",
        }
    }

    pub fn input_kind(self) -> AiActionInputKind {
        match self {
            AiActionId::RemoveBackground
            | AiActionId::BlurBackground
            | AiActionId::EraseObject
            | AiActionId::CopyText
            | AiActionId::DescribeImage
            | AiActionId::AskImage
            | AiActionId::Upscale => AiActionInputKind::Image,
            AiActionId::Summarize
            | AiActionId::CreateFaq
            | AiActionId::Translate
            | AiActionId::KeyPoints
            | AiActionId::AskFile => AiActionInputKind::Document,
            AiActionId::Transcribe | AiActionId::SummarizeMedia | AiActionId::FindMoments => {
                AiActionInputKind::Audio
            }
            AiActionId::CompareDocuments => AiActionInputKind::Multiple,
            AiActionId::SummarizeFolder => AiActionInputKind::Folder,
        }
    }

    pub fn min_inputs(self) -> usize {
        match self {
            AiActionId::CompareDocuments => 2,
            AiActionId::SummarizeFolder => 0,
            _ => 1,
        }
    }

    pub fn max_inputs(self) -> usize {
        match self {
            AiActionId::RemoveBackground
            | AiActionId::BlurBackground
            | AiActionId::EraseObject
            | AiActionId::CopyText
            | AiActionId::DescribeImage
            | AiActionId::AskImage
            | AiActionId::Upscale
            | AiActionId::Transcribe
            | AiActionId::SummarizeMedia
            | AiActionId::FindMoments => 1,
            AiActionId::CompareDocuments => 2,
            _ => MAX_ACTION_INPUTS,
        }
    }

    /// Image, OCR, speech and upscaling never leave this computer.
    pub fn local_only(self) -> bool {
        matches!(
            self,
            AiActionId::RemoveBackground
                | AiActionId::BlurBackground
                | AiActionId::EraseObject
                | AiActionId::CopyText
                | AiActionId::Upscale
                | AiActionId::Transcribe
        )
    }

    pub fn preview_required(self) -> bool {
        self != AiActionId::CopyText
    }

    /// Capability ids: 14c task names or the two 17a backend rows.
    pub fn required_capabilities(self) -> &'static [&'static str] {
        match self {
            AiActionId::RemoveBackground | AiActionId::BlurBackground => &["ai.foreground_mask"],
            AiActionId::EraseObject => &["ai.inpaint"],
            AiActionId::CopyText => &[],
            AiActionId::DescribeImage | AiActionId::AskImage => &["assistant.vision_answer"],
            AiActionId::Upscale => &["ai.upscale"],
            AiActionId::Transcribe => &["ai.transcribe"],
            _ => &["assistant.structured_text"],
        }
    }

    pub fn help_slug(self) -> &'static str {
        match self {
            AiActionId::RemoveBackground
            | AiActionId::BlurBackground
            | AiActionId::EraseObject
            | AiActionId::CopyText
            | AiActionId::DescribeImage
            | AiActionId::AskImage => "ai-actions-images",
            AiActionId::Upscale => "ai-upscaling",
            AiActionId::Summarize
            | AiActionId::CreateFaq
            | AiActionId::Translate
            | AiActionId::KeyPoints
            | AiActionId::AskFile => "ai-actions-documents",
            AiActionId::Transcribe | AiActionId::SummarizeMedia | AiActionId::FindMoments => {
                "ai-actions-media"
            }
            AiActionId::CompareDocuments | AiActionId::SummarizeFolder => "ai-actions-multiple",
        }
    }
}

impl std::str::FromStr for AiActionId {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        AiActionId::ALL
            .into_iter()
            .find(|candidate| candidate.as_str() == value)
            .ok_or_else(|| ERR_INVALID.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiSpeechLanguage {
    Auto,
    En,
    Es,
}

/// Options discriminated by action; unknown keys are refused.
#[derive(Debug, Clone, PartialEq)]
pub enum AiActionOptions {
    RemoveBackground,
    BlurBackground {
        radius: u8,
    },
    EraseObject {
        mask_artifact_id: Uuid,
    },
    CopyText {
        language: String,
    },
    DescribeImage {
        question: String,
    },
    AskImage {
        question: String,
    },
    Upscale {
        options: AiTaskOptions,
    },
    Summarize,
    CreateFaq,
    Translate {
        target_language: String,
    },
    KeyPoints,
    AskFile {
        question: String,
    },
    Transcribe {
        start_us: u64,
        end_us: Option<u64>,
        language: AiSpeechLanguage,
    },
    SummarizeMedia {
        start_us: u64,
        end_us: Option<u64>,
        language: AiSpeechLanguage,
    },
    FindMoments {
        query: String,
        start_us: u64,
        end_us: Option<u64>,
    },
    CompareDocuments,
    SummarizeFolder {
        root_id: Uuid,
        recursive: bool,
        include_contents: bool,
        approved_input_ids: Vec<Uuid>,
    },
}

impl AiActionOptions {
    pub fn kind(&self) -> AiActionId {
        match self {
            AiActionOptions::RemoveBackground => AiActionId::RemoveBackground,
            AiActionOptions::BlurBackground { .. } => AiActionId::BlurBackground,
            AiActionOptions::EraseObject { .. } => AiActionId::EraseObject,
            AiActionOptions::CopyText { .. } => AiActionId::CopyText,
            AiActionOptions::DescribeImage { .. } => AiActionId::DescribeImage,
            AiActionOptions::AskImage { .. } => AiActionId::AskImage,
            AiActionOptions::Upscale { .. } => AiActionId::Upscale,
            AiActionOptions::Summarize => AiActionId::Summarize,
            AiActionOptions::CreateFaq => AiActionId::CreateFaq,
            AiActionOptions::Translate { .. } => AiActionId::Translate,
            AiActionOptions::KeyPoints => AiActionId::KeyPoints,
            AiActionOptions::AskFile { .. } => AiActionId::AskFile,
            AiActionOptions::Transcribe { .. } => AiActionId::Transcribe,
            AiActionOptions::SummarizeMedia { .. } => AiActionId::SummarizeMedia,
            AiActionOptions::FindMoments { .. } => AiActionId::FindMoments,
            AiActionOptions::CompareDocuments => AiActionId::CompareDocuments,
            AiActionOptions::SummarizeFolder { .. } => AiActionId::SummarizeFolder,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiActionRequest {
    pub action: AiActionId,
    pub inputs: Vec<AiInputRef>,
    pub options: AiActionOptions,
    pub request_revision: u32,
    pub expected_content_id: Option<Uuid>,
    pub scope_id: Option<Uuid>,
    pub outbound_consent_id: Option<Uuid>,
}

/// Settings 44 -> 45; `copy_text` is governed by the 07e OCR preference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AiActionsSettings {
    pub enabled: BTreeMap<String, bool>,
    pub transcription_language: AiSpeechLanguage,
    pub caption_language: AiSpeechLanguage,
    pub caption_window_seconds: u32,
    pub dictation_language: String,
}

impl Default for AiActionsSettings {
    fn default() -> Self {
        Self::with_app_language("en")
    }
}

impl AiActionsSettings {
    pub fn with_app_language(app_language: &str) -> Self {
        let mut enabled = BTreeMap::new();
        for id in AiActionId::ALL {
            if id != AiActionId::CopyText {
                enabled.insert(id.as_str().to_string(), false);
            }
        }
        Self {
            enabled,
            transcription_language: AiSpeechLanguage::Auto,
            caption_language: AiSpeechLanguage::Auto,
            caption_window_seconds: CAPTION_WINDOW_SECONDS,
            dictation_language: if app_language == "es" { "es" } else { "en" }.to_string(),
        }
    }

    /// Missing keys become false; the fixed 30 s window never changes.
    pub fn normalize_with_app_language(value: Option<&Value>, app_language: &str) -> Self {
        let mut settings = Self::with_app_language(app_language);
        let Some(Value::Object(map)) = value else {
            return settings;
        };
        if let Some(Value::Object(entries)) = map.get("enabled") {
            for id in AiActionId::ALL {
                if id == AiActionId::CopyText {
                    continue;
                }
                if let Some(Value::Bool(flag)) = entries.get(id.as_str()) {
                    settings.enabled.insert(id.as_str().to_string(), *flag);
                }
            }
        }
        if let Some(Value::String(language)) = map.get("transcription_language") {
            if let Ok(parsed) = serde_json::from_value(Value::String(language.clone())) {
                settings.transcription_language = parsed;
            }
        }
        if let Some(Value::String(language)) = map.get("caption_language") {
            if let Ok(parsed) = serde_json::from_value(Value::String(language.clone())) {
                settings.caption_language = parsed;
            }
        }
        if let Some(Value::String(language)) = map.get("dictation_language") {
            if language == "en" || language == "es" {
                settings.dictation_language = language.clone();
            }
        }
        settings.caption_window_seconds = CAPTION_WINDOW_SECONDS;
        settings
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.caption_window_seconds != CAPTION_WINDOW_SECONDS
            || !matches!(self.dictation_language.as_str(), "en" | "es")
            || self.enabled.keys().any(|key| {
                !AiActionId::ALL
                    .iter()
                    .any(|id| *id != AiActionId::CopyText && id.as_str() == key)
            })
        {
            return Err(ERR_INVALID.to_string());
        }
        Ok(())
    }

    pub fn is_enabled(&self, id: AiActionId) -> bool {
        if id == AiActionId::CopyText {
            return true;
        }
        self.enabled.get(id.as_str()).copied().unwrap_or(false)
    }
}

fn object_keys(value: &Value) -> Result<(Vec<&str>, &serde_json::Map<String, Value>), String> {
    let Value::Object(map) = value else {
        return Err(ERR_INVALID.to_string());
    };
    Ok((map.keys().map(String::as_str).collect(), map))
}

fn only(keys: &[&str], allowed: &[&str]) -> Result<(), String> {
    if keys.iter().any(|key| !allowed.contains(key)) {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

fn scalars(value: &str) -> usize {
    value.chars().count()
}

fn string_of<'a>(map: &'a serde_json::Map<String, Value>, key: &str) -> Result<&'a str, String> {
    match map.get(key) {
        Some(Value::String(text)) => Ok(text),
        _ => Err(ERR_INVALID.to_string()),
    }
}

fn optional_uuid(map: &serde_json::Map<String, Value>, key: &str) -> Result<Option<Uuid>, String> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Uuid::parse_str(text).map(Some).map_err(|_| ERR_INVALID.to_string()),
        _ => Err(ERR_INVALID.to_string()),
    }
}

fn optional_time(map: &serde_json::Map<String, Value>, key: &str) -> Result<Option<u64>, String> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_u64()
            .map(Some)
            .ok_or_else(|| ERR_INVALID.to_string()),
        _ => Err(ERR_INVALID.to_string()),
    }
}

fn check_range(start: u64, end: Option<u64>) -> Result<(), String> {
    if matches!(end, Some(value) if value <= start) {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

fn language_of(map: &serde_json::Map<String, Value>) -> Result<AiSpeechLanguage, String> {
    match map.get("language") {
        None => Ok(AiSpeechLanguage::Auto),
        Some(Value::String(text)) => match text.as_str() {
            "auto" => Ok(AiSpeechLanguage::Auto),
            "en" => Ok(AiSpeechLanguage::En),
            "es" => Ok(AiSpeechLanguage::Es),
            _ => Err(ERR_INVALID.to_string()),
        },
        _ => Err(ERR_INVALID.to_string()),
    }
}

fn valid_language_tag(value: &str) -> bool {
    if value.is_empty() || value.chars().count() > MAX_TARGET_LANGUAGE {
        return false;
    }
    value.split('-').all(|part| {
        !part.is_empty()
            && part.len() <= 8
            && part.chars().all(|character| character.is_ascii_alphanumeric())
    })
}

/// Parses one `options` object with the exact keys of its action.
pub fn parse_options(action: AiActionId, value: &Value) -> Result<AiActionOptions, String> {
    let (keys, map) = object_keys(value)?;
    let mut without_kind = keys.clone();
    without_kind.retain(|key| *key != "kind");
    match map.get("kind").and_then(Value::as_str) {
        Some(kind) if kind == action.as_str() => {}
        _ => return Err(ERR_INVALID.to_string()),
    }
    if action == AiActionId::Upscale {
        only(&without_kind, &["options"])?;
        let options: AiTaskOptions = serde_json::from_value(
            map.get("options").cloned().ok_or_else(|| ERR_INVALID.to_string())?,
        )
        .map_err(|_| ERR_INVALID.to_string())?;
        if !matches!(options, AiTaskOptions::Upscale { .. }) {
            return Err(ERR_INVALID.to_string());
        }
        return Ok(AiActionOptions::Upscale { options });
    }
    match action {
        AiActionId::RemoveBackground => {
            only(&without_kind, &[])?;
            Ok(AiActionOptions::RemoveBackground)
        }
        AiActionId::BlurBackground => {
            only(&without_kind, &["radius"])?;
            let radius = match map.get("radius") {
                Some(Value::Number(number)) => number.as_u64().ok_or_else(|| ERR_INVALID.to_string())?,
                _ => return Err(ERR_INVALID.to_string()),
            };
            if !(1..=64).contains(&radius) {
                return Err(ERR_INVALID.to_string());
            }
            Ok(AiActionOptions::BlurBackground { radius: radius as u8 })
        }
        AiActionId::EraseObject => {
            only(&without_kind, &["mask_artifact_id"])?;
            let id = match map.get("mask_artifact_id") {
                Some(Value::String(text)) => Uuid::parse_str(text).map_err(|_| ERR_EMPTY_MASK.to_string())?,
                _ => return Err(ERR_EMPTY_MASK.to_string()),
            };
            Ok(AiActionOptions::EraseObject { mask_artifact_id: id })
        }
        AiActionId::CopyText => {
            only(&without_kind, &["language"])?;
            let language = match map.get("language") {
                None => "auto".to_string(),
                Some(Value::String(text)) if text == "auto" || valid_language_tag(text) => text.clone(),
                _ => return Err(ERR_INVALID.to_string()),
            };
            Ok(AiActionOptions::CopyText { language })
        }
        AiActionId::DescribeImage | AiActionId::AskImage | AiActionId::AskFile => {
            only(&without_kind, &["question"])?;
            let question = string_of(map, "question")?;
            if question.is_empty() || scalars(question) > MAX_QUESTION_SCALARS {
                return Err(ERR_INVALID.to_string());
            }
            Ok(match action {
                AiActionId::DescribeImage => AiActionOptions::DescribeImage { question: question.to_string() },
                AiActionId::AskImage => AiActionOptions::AskImage { question: question.to_string() },
                _ => AiActionOptions::AskFile { question: question.to_string() },
            })
        }
        AiActionId::Summarize => {
            only(&without_kind, &[])?;
            Ok(AiActionOptions::Summarize)
        }
        AiActionId::CreateFaq => {
            only(&without_kind, &[])?;
            Ok(AiActionOptions::CreateFaq)
        }
        AiActionId::Translate => {
            only(&without_kind, &["target_language"])?;
            let language = string_of(map, "target_language")?;
            if !valid_language_tag(language) {
                return Err(ERR_INVALID.to_string());
            }
            Ok(AiActionOptions::Translate { target_language: language.to_string() })
        }
        AiActionId::KeyPoints => {
            only(&without_kind, &[])?;
            Ok(AiActionOptions::KeyPoints)
        }
        AiActionId::Transcribe | AiActionId::SummarizeMedia => {
            only(&without_kind, &["start_us", "end_us", "language"])?;
            let start = optional_time(map, "start_us")?.unwrap_or(0);
            let end = optional_time(map, "end_us")?;
            check_range(start, end)?;
            let language = language_of(map)?;
            Ok(if action == AiActionId::Transcribe {
                AiActionOptions::Transcribe { start_us: start, end_us: end, language }
            } else {
                AiActionOptions::SummarizeMedia { start_us: start, end_us: end, language }
            })
        }
        AiActionId::FindMoments => {
            only(&without_kind, &["query", "start_us", "end_us"])?;
            let query = string_of(map, "query")?;
            if query.is_empty() || scalars(query) > MAX_QUERY_SCALARS {
                return Err(ERR_INVALID.to_string());
            }
            let start = optional_time(map, "start_us")?.unwrap_or(0);
            let end = optional_time(map, "end_us")?;
            check_range(start, end)?;
            Ok(AiActionOptions::FindMoments { query: query.to_string(), start_us: start, end_us: end })
        }
        AiActionId::CompareDocuments => {
            only(&without_kind, &[])?;
            Ok(AiActionOptions::CompareDocuments)
        }
        AiActionId::SummarizeFolder => {
            only(&without_kind, &["root_id", "recursive", "include_contents", "approved_input_ids"])?;
            let root_id = match map.get("root_id") {
                Some(Value::String(text)) => Uuid::parse_str(text).map_err(|_| ERR_INVALID.to_string())?,
                _ => return Err(ERR_INVALID.to_string()),
            };
            let recursive = matches!(map.get("recursive"), Some(Value::Bool(true)));
            let include_contents = matches!(map.get("include_contents"), Some(Value::Bool(true)));
            let approved = match map.get("approved_input_ids") {
                Some(Value::Array(items)) if items.len() <= MAX_ACTION_INPUTS => items,
                Some(Value::Array(_)) => return Err(ERR_TOO_LARGE.to_string()),
                _ => return Err(ERR_INVALID.to_string()),
            };
            let mut approved_input_ids = Vec::with_capacity(approved.len());
            for item in approved {
                let Value::String(text) = item else {
                    return Err(ERR_INVALID.to_string());
                };
                approved_input_ids.push(Uuid::parse_str(text).map_err(|_| ERR_INVALID.to_string())?);
            }
            Ok(AiActionOptions::SummarizeFolder {
                root_id,
                recursive,
                include_contents,
                approved_input_ids,
            })
        }
        AiActionId::Upscale => unreachable!("handled above"),
    }
}

/// Validates the input list against the action's documented bounds.
pub fn validate_inputs(action: AiActionId, inputs: &[AiInputRef]) -> Result<(), String> {
    if inputs.len() > MAX_ACTION_INPUTS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if inputs.len() < action.min_inputs() || inputs.len() > action.max_inputs() {
        return Err(ERR_INVALID.to_string());
    }
    for input in inputs {
        if input.expected_revision < 1 {
            return Err(ERR_INVALID.to_string());
        }
        if !matches!(input.kind, AiInputKind::Document | AiInputKind::Snapshot | AiInputKind::Artifact) {
            return Err(ERR_INVALID.to_string());
        }
    }
    if action == AiActionId::CompareDocuments && inputs.len() != 2 {
        return Err(ERR_INVALID.to_string());
    }
    if action == AiActionId::SummarizeFolder && !inputs.is_empty() {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

/// Parses one request; `inputs` are validated by `validate_inputs`.
pub fn parse_request(value: &Value) -> Result<AiActionRequest, String> {
    let (keys, map) = object_keys(value)?;
    only(
        &keys,
        &[
            "action",
            "inputs",
            "options",
            "request_revision",
            "expected_content_id",
            "scope_id",
            "outbound_consent_id",
        ],
    )?;
    let action: AiActionId = string_of(map, "action")?.parse()?;
    let inputs: Vec<AiInputRef> = match map.get("inputs") {
        Some(Value::Array(items)) => serde_json::from_value(Value::Array(items.clone()))
            .map_err(|_| ERR_INVALID.to_string())?,
        _ => return Err(ERR_INVALID.to_string()),
    };
    validate_inputs(action, &inputs)?;
    let options = parse_options(action, map.get("options").ok_or_else(|| ERR_INVALID.to_string())?)?;
    let request_revision = match map.get("request_revision") {
        Some(Value::Number(number)) => number.as_u64().ok_or_else(|| ERR_INVALID.to_string())?,
        _ => return Err(ERR_INVALID.to_string()),
    };
    if request_revision < 1 || request_revision > u32::MAX as u64 {
        return Err(ERR_INVALID.to_string());
    }
    Ok(AiActionRequest {
        action,
        inputs,
        options,
        request_revision: request_revision as u32,
        expected_content_id: optional_uuid(map, "expected_content_id")?,
        scope_id: optional_uuid(map, "scope_id")?,
        outbound_consent_id: optional_uuid(map, "outbound_consent_id")?,
    })
}

/// One quote/location provenance pair used by every typed payload.
pub fn citation_key(citation: &AiCitation) -> (Uuid, u64, String) {
    let location = match &citation.location {
        AiSourceLocation::Text { start, end } => format!("text:{start}:{end}"),
        AiSourceLocation::Page { page } => format!("page:{page}"),
        AiSourceLocation::Time { start_us, end_us } => format!("time:{start_us}:{end_us}"),
        AiSourceLocation::Sheet { sheet_id, range } => format!("sheet:{sheet_id}:{range}"),
        AiSourceLocation::Slide { slide_id } => format!("slide:{slide_id}"),
        AiSourceLocation::Image { region } => match region {
            Some(rect) => format!("image:{}:{}:{}:{}", rect.x, rect.y, rect.width, rect.height),
            None => "image".to_string(),
        },
    };
    (citation.input_id, citation.revision, location)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: AiInputKind, id: &str) -> AiInputRef {
        AiInputRef { kind, id: Uuid::parse_str(id).unwrap(), expected_revision: 1 }
    }

    #[test]
    fn every_action_has_bounded_capabilities() {
        for action in AiActionId::ALL {
            assert!(action.required_capabilities().len() <= 4);
            assert!(action.min_inputs() <= action.max_inputs());
            assert!(!action.help_slug().is_empty());
        }
    }

    #[test]
    fn copy_text_requires_no_capability() {
        assert!(AiActionId::CopyText.required_capabilities().is_empty());
        assert!(!AiActionId::CopyText.preview_required());
        assert!(AiActionId::CopyText.local_only());
    }

    #[test]
    fn settings_default_every_model_action_off() {
        let settings = AiActionsSettings::default();
        for action in AiActionId::ALL {
            if action != AiActionId::CopyText {
                assert!(!settings.is_enabled(action));
            }
        }
        assert!(settings.is_enabled(AiActionId::CopyText));
        assert_eq!(settings.caption_window_seconds, 30);
    }

    #[test]
    fn mask_option_without_uuid_is_empty_mask() {
        let value = serde_json::json!({"kind": "erase_object"});
        assert_eq!(parse_options(AiActionId::EraseObject, &value).unwrap_err(), ERR_EMPTY_MASK);
    }

    #[test]
    fn input_refs_keep_ai_runtime_shape() {
        let inputs = vec![input(AiInputKind::Document, "11111111-1111-4111-8111-111111111111")];
        assert!(validate_inputs(AiActionId::Summarize, &inputs).is_ok());
        assert!(validate_inputs(AiActionId::CompareDocuments, &inputs).is_err());
    }
}
