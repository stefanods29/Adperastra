//! Immutable assisted-source capture (Step 17a T2).
//!
//! Every source is captured from an already authorized backing and kept as
//! bounded in-memory text. Sensitive sources never spool to disk. The source
//! text is wrapped in app-built delimiters before it reaches a prompt.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::assistant_policy::{detect_source_injection, escape_source_delimiters};
use crate::assistant_types::AssistantRisk;
use crate::local_ai_types::AiSourceLocation;

pub const MAX_SOURCE_FILE_BYTES: usize = 64 * 1024;
pub const MAX_SOURCE_TURN_BYTES: usize = 128 * 1024;
pub const MAX_EVIDENCE_CHUNKS: usize = 512;
pub const CHUNK_SCALARS: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Text,
    Pdf,
    Ocr,
    OfficeReadonly,
    Table,
    Image,
}

#[derive(Debug, Clone)]
pub struct AuthorizedText {
    pub input_id: Uuid,
    pub revision: u64,
    pub label: String,
    pub mime: String,
    pub kind: SourceKind,
    /// Native immutable identity, never an OS path.
    pub source_identity: String,
    pub location: AiSourceLocation,
    pub text: String,
    pub sensitive: bool,
    pub online_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceChunk {
    pub input_id: Uuid,
    pub revision: u64,
    pub label: String,
    pub location: AiSourceLocation,
    pub start: u64,
    pub end: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSource {
    pub input_id: Uuid,
    pub revision: u64,
    pub label: String,
    pub mime: String,
    pub kind: SourceKind,
    pub source_identity: String,
    pub byte_len: u64,
    pub text: String,
    pub chunks: Vec<EvidenceChunk>,
    pub sensitive: bool,
    pub injection_warning: bool,
}

fn scalar_chars(text: &str) -> Vec<char> {
    text.chars().collect()
}

pub fn normalize_quote(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn location_at(base: &AiSourceLocation, offset: u64) -> AiSourceLocation {
    match base {
        AiSourceLocation::Text { start, end } => AiSourceLocation::Text {
            start: start.saturating_add(offset),
            end: end.saturating_add(offset),
        },
        other => other.clone(),
    }
}

/// Split into bounded chunks with scalar offsets and the captured location.
pub fn chunk_source(input: &AuthorizedText) -> Vec<EvidenceChunk> {
    let chars = scalar_chars(&input.text);
    let mut chunks = Vec::new();
    let mut offset = 0usize;
    while offset < chars.len() && chunks.len() < MAX_EVIDENCE_CHUNKS {
        let mut end = (offset + CHUNK_SCALARS).min(chars.len());
        if end < chars.len() {
            let boundary = chars[offset..end]
                .iter()
                .rposition(|character| *character == '\n');
            if let Some(boundary) = boundary {
                if boundary > CHUNK_SCALARS / 2 {
                    end = offset + boundary + 1;
                }
            }
        }
        let text: String = chars[offset..end].iter().collect();
        chunks.push(EvidenceChunk {
            input_id: input.input_id,
            revision: input.revision,
            label: input.label.clone(),
            location: location_at(&input.location, offset as u64),
            start: offset as u64,
            end: end as u64,
            text,
        });
        offset = end;
    }
    chunks
}

/// Capture an authorized text source. No path is opened here and no file is
/// written; a sensitive source stays in this structure only.
pub fn extract_text_source(input: &AuthorizedText) -> Result<ExtractedSource, String> {
    if input.online_only {
        return Err("assistant.scope_denied".to_string());
    }
    if input.source_identity.is_empty() {
        return Err("assistant.scope_denied".to_string());
    }
    if input.text.is_empty() && input.kind != SourceKind::Image {
        return Err("assistant.extractor_unavailable".to_string());
    }
    if input.text.len() > MAX_SOURCE_FILE_BYTES {
        return Err("assistant.source_too_large".to_string());
    }
    Ok(ExtractedSource {
        input_id: input.input_id,
        revision: input.revision,
        label: input.label.clone(),
        mime: input.mime.clone(),
        kind: input.kind,
        source_identity: input.source_identity.clone(),
        byte_len: input.text.len() as u64,
        text: input.text.clone(),
        chunks: chunk_source(input),
        sensitive: input.sensitive,
        injection_warning: detect_source_injection(&input.text),
    })
}

/// A source block is app-built and closed; file text cannot forge its end.
pub fn wrap_source_block(source: &ExtractedSource) -> String {
    let label = escape_source_delimiters(&source.label).replace('"', "&quot;");
    format!(
        "<<<ADP-SOURCE id=\"{}\" revision=\"{}\" label=\"{}\">>>\n{}\n<<<ADP-SOURCE-END>>>",
        source.input_id,
        source.revision,
        label,
        escape_source_delimiters(&source.text)
    )
}

/// Assemble a turn's sources with the per-file and per-turn caps.
pub fn sources_block(sources: &[ExtractedSource]) -> Result<String, String> {
    let mut total = 0usize;
    let mut blocks = Vec::with_capacity(sources.len());
    for source in sources {
        if source.text.len() > MAX_SOURCE_FILE_BYTES {
            return Err("assistant.source_too_large".to_string());
        }
        total = total.saturating_add(source.text.len());
        if total > MAX_SOURCE_TURN_BYTES {
            return Err("assistant.source_too_large".to_string());
        }
        blocks.push(wrap_source_block(source));
    }
    Ok(blocks.join("\n\n"))
}

/// The API gateway refuses before a consent dialog when a source is sensitive.
pub fn require_api_eligible(sources: &[ExtractedSource]) -> Result<(), String> {
    if sources.iter().any(|source| source.sensitive) {
        return Err("assistant.sensitive_api".to_string());
    }
    Ok(())
}

/// 07d's text adapter is supplied by the coordinator. Without it, the tool
/// reports the real missing capability instead of inventing text.
pub trait PdfTextSource {
    fn page_text(&self, input_id: Uuid, revision: u64, page: u32) -> Result<String, String>;
}

pub fn read_pdf_page(
    provider: Option<&dyn PdfTextSource>,
    input_id: Uuid,
    revision: u64,
    page: u32,
) -> Result<String, String> {
    if page == 0 {
        return Err("assistant.invalid_arguments".to_string());
    }
    let provider = provider.ok_or_else(|| "assistant.extractor_unavailable".to_string())?;
    provider.page_text(input_id, revision, page)
}

/// 07e's OCR output adapter, same fail-closed rule.
pub trait OcrTextSource {
    fn page_text(&self, input_id: Uuid, revision: u64, page: u32) -> Result<String, String>;
}

pub fn read_ocr_page(
    provider: Option<&dyn OcrTextSource>,
    input_id: Uuid,
    revision: u64,
    page: u32,
) -> Result<String, String> {
    let provider = provider.ok_or_else(|| "assistant.extractor_unavailable".to_string())?;
    provider.page_text(input_id, revision, page)
}

/// A captured source is still current only when the immutable identity and
/// revision match. A changed file invalidates every citation at once.
pub fn source_is_current(source: &ExtractedSource, identity: &str, revision: u64) -> bool {
    source.source_identity == identity && source.revision == revision
}

/// Only an ordinary read-only source may become API payload bytes.
pub fn api_source_risk(source: &ExtractedSource) -> AssistantRisk {
    if source.sensitive {
        AssistantRisk::Irreversible
    } else {
        AssistantRisk::ReadOnly
    }
}

#[cfg(test)]
#[path = "assistant_sources_step17a_tests.rs"]
mod step17a_tests;
