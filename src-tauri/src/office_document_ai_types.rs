//! ai-document-1 standalone value DTOs. Not an IPC or authorization boundary.
//! Request/context/proposal DTOs await coordinator clarification; do not
//! substitute these values for the native E20-E22 authority.
#![allow(dead_code)]

use crate::local_ai_types::AiCitation;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentAiAction {
    Rewrite, Shorten, Expand, Simplify, Grammar, Tone, Translate, AltText, Draft, Continue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentAiTone { Formal, Friendly, Persuasive, Neutral }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentAiLocale {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "es")]
    Es,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentAiOptions {
    pub action: DocumentAiAction,
    pub tone: Option<DocumentAiTone>,
    pub target_language: Option<String>,
    pub topic: Option<String>,
    pub locale: DocumentAiLocale,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentAiParagraph {
    pub source_run_ids: Vec<String>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentAiSchema {
    #[serde(rename = "document.action.v1")]
    V1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentAiCaution { ProtectedTokenChanged, MeaningUncertain, UnverifiedDraft }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentAiOutput {
    pub schema_id: DocumentAiSchema,
    pub action: DocumentAiAction,
    pub paragraphs: Vec<DocumentAiParagraph>,
    pub alt: Option<String>,
    pub citations: Vec<AiCitation>,
    pub cautions: Vec<DocumentAiCaution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedTokenCategory { Number, Date, Name, Url, Identifier, Quotation }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedTokenChange {
    pub id: String,
    pub before: String,
    pub after: Option<String>,
    pub source_run_id: String,
    pub category: ProtectedTokenCategory,
    #[serde(default)]
    pub user_acknowledged: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentAiSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub experimental_actions: Vec<DocumentAiAction>,
}

pub const MAX_SOURCE_SCALARS: usize = 4_000;
pub const MAX_CONTEXT_SCALARS_EACH_SIDE: usize = 1_000;
pub const MAX_OUTPUT_SCALARS: usize = 8_000;
pub const MAX_OUTPUT_PARAGRAPHS: usize = 32;
pub const MAX_SOURCE_RUNS_PER_PARAGRAPH: usize = 128;
pub const MAX_ALT_SCALARS: usize = 4_096;
pub const MAX_TOPIC_SCALARS: usize = 1_000;
pub const MAX_CITATIONS: usize = 16;
pub const MAX_CAUTIONS: usize = 16;
pub const MAX_PROTECTED_CHANGES: usize = 64;
pub const MAX_PROTECTED_TOKEN_SCALARS: usize = 512;
pub const LIFETIME_SECONDS: u64 = 300;

// Serde deserialization alone does NOT enforce the limits above. This module
// remains unregistered until coordinator native schema validation is complete.
