//! Native inline-suggestion validation (Step 17d T6, `ai-inline-1`).
//!
//! The WebView editor owns the only mutable text model; native code validates
//! the exact document revision/content identity, the bounded context and the
//! single-paragraph answer. A completion is never a mutation: accepting it is
//! one ordinary editor transaction on the WebView side.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const INLINE_PAUSE_MS: u32 = 750;
pub const INLINE_MAX_BEFORE: usize = 2048;
pub const INLINE_MAX_AFTER: usize = 512;
pub const INLINE_MAX_SUGGESTION: usize = 256;
pub const INLINE_MAX_LANGUAGE: usize = 32;
pub const INLINE_TTL_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InlineFileType {
    Text,
    Markdown,
    Code,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineCompletionRequest {
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub cursor_utf16: u64,
    pub before: String,
    pub after: String,
    pub file_type: InlineFileType,
    pub language: String,
    pub generation: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineCompletion {
    pub generation: u32,
    pub revision: u64,
    pub content_id: Uuid,
    pub cursor_utf16: u64,
    pub text: String,
    pub expires_unix: u64,
}

/// The owning document and the selected backend, supplied by the native
/// document grant. Never trusted from the WebView request itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineDocumentState {
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    /// Highest valid UTF-16 cursor position in the current revision.
    pub cursor_max: u64,
    pub file_type: InlineFileType,
    pub editing_enabled: bool,
    pub locked: bool,
    pub local_backend: bool,
}

fn scalars(value: &str) -> usize {
    value.chars().count()
}

fn utf16(value: &str) -> usize {
    value.encode_utf16().count()
}

/// The request must belong to the current revision and Local AI (D8).
pub fn validate_request(
    request: &InlineCompletionRequest,
    current: &InlineDocumentState,
) -> Result<(), String> {
    if request.document_id != current.document_id {
        return Err("ai_inline.changed".to_string());
    }
    if !current.editing_enabled || current.locked {
        return Err("ai_inline.unavailable".to_string());
    }
    if !current.local_backend {
        // A typing pause can never authorize an outbound upload.
        return Err("ai_inline.unavailable".to_string());
    }
    if request.revision != current.revision || request.content_id != current.content_id {
        return Err("ai_inline.changed".to_string());
    }
    if request.file_type != current.file_type {
        return Err("ai_inline.unavailable".to_string());
    }
    if request.cursor_utf16 > current.cursor_max {
        return Err("ai_inline.changed".to_string());
    }
    if utf16(&request.before) > INLINE_MAX_BEFORE * 2 + 2
        || utf16(&request.after) > INLINE_MAX_AFTER * 2 + 2
        || scalars(&request.before) > INLINE_MAX_BEFORE
        || scalars(&request.after) > INLINE_MAX_AFTER
    {
        return Err("ai_inline.unavailable".to_string());
    }
    if request.cursor_utf16 < utf16(&request.before) as u64 {
        return Err("ai_inline.unavailable".to_string());
    }
    if request.language.is_empty() || request.language.len() > INLINE_MAX_LANGUAGE {
        return Err("ai_inline.unavailable".to_string());
    }
    Ok(())
}

/// Plain single-paragraph text of at most 256 scalars; control characters and
/// newlines are refused rather than executed or formatted.
pub fn sanitize_completion(text: &str) -> Result<String, String> {
    if text.is_empty() || scalars(text) > INLINE_MAX_SUGGESTION {
        return Err("ai_inline.changed".to_string());
    }
    if text
        .chars()
        .any(|character| character == '\r' || character == '\n' || character.is_control())
    {
        return Err("ai_inline.changed".to_string());
    }
    Ok(text.to_string())
}

/// A late result for another generation, revision, content or cursor is
/// dropped, never shown.
pub fn validate_completion(
    completion: &InlineCompletion,
    request: &InlineCompletionRequest,
) -> Result<(), String> {
    if completion.generation != request.generation
        || completion.revision != request.revision
        || completion.content_id != request.content_id
        || completion.cursor_utf16 != request.cursor_utf16
    {
        return Err("ai_inline.changed".to_string());
    }
    sanitize_completion(&completion.text).map(|_| ())
}

#[cfg(test)]
#[path = "ai_inline_tests.rs"]
mod tests;
