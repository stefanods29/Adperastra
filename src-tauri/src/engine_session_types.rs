//! Persistent confined Office read sessions (Step 12b E7, revision
//! `engine-session-1`).
//!
//! These are the native types of the Office read actor and the exact wire
//! envelopes the pack-owned bridge must speak (13 T3 implements the other
//! side). The wire never carries a user path, an `OwnedOutput` or a
//! destination: the parent copies validated private artifacts itself.
//!
//! Until a verified signed pack advertises the `office_read_bridge`
//! capability, `EngineHost::start_session` returns `engines.pack_missing` and
//! nothing is launched.
#![allow(dead_code)]


use convert::PageRange;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::engine_types::{
    valid_relative_basename, valid_section_id, EngineError, OfficeFormat, OfficeRenderTarget,
};

/// The only protocol this step speaks.
pub const SESSION_PROTOCOL: &str = "office_read_v1";
/// The protocol version every envelope carries.
pub const SESSION_PROTOCOL_VERSION: u32 = 1;
/// At most four read-only documents stay open in one actor.
pub const MAX_SESSION_DOCUMENTS: u8 = 4;
/// Idle expiry after the final document closes.
pub const SESSION_IDLE_SECONDS: u16 = 60;
/// Memory budget of one Office actor.
pub const SESSION_MEMORY_BYTES: u64 = 1024 * 1024 * 1024;
/// Startup deadline (E7).
pub const SESSION_START_TIMEOUT_MS: u64 = 60_000;
/// Heartbeat silence that fails a render.
pub const SESSION_HEARTBEAT_MS: u64 = 30_000;
/// Open-document deadline.
pub const OPEN_DOCUMENT_TIMEOUT_MS: u64 = 60_000;
/// Render deadline.
pub const RENDER_TIMEOUT_MS: u64 = 120_000;
/// Close-document deadline before the whole actor is terminated.
pub const CLOSE_DOCUMENT_TIMEOUT_MS: u64 = 5_000;
/// At most 32 queued commands.
pub const MAX_QUEUED_COMMANDS: usize = 32;
/// A control frame is at most 768 KiB of JSON.
pub const MAX_CONTROL_FRAME_BYTES: usize = 768 * 1024;
/// At most 256 sections per render call.
pub const MAX_SECTIONS_PER_RENDER: usize = 256;
/// At most 1000 page ranges per render call.
pub const MAX_RANGES_PER_RENDER: usize = 1000;
/// One artifact is at most 1 GiB.
pub const MAX_ARTIFACT_BYTES: u64 = 1024 * 1024 * 1024;
/// One render call writes at most 1 GiB in total.
pub const MAX_RENDER_BYTES: u64 = 1024 * 1024 * 1024;
/// At most 256 artifacts per call.
pub const MAX_RENDER_ARTIFACTS: usize = 256;
/// At most 1000 sections in one document.
pub const MAX_DOCUMENT_SECTIONS: usize = 1000;
/// A section name is at most 255 characters.
pub const MAX_SECTION_NAME: usize = 255;
/// How long a cancelled actor takes to die.
pub const ACTOR_KILL_GRACE_MS: u64 = 250;

/// The fixed start values of the one Office actor (E7). A trusted native
/// caller only; the wire does not accept paths or program arguments.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineSessionStart {
    pub protocol: SessionProtocol,
    pub max_documents: u8,
    pub idle_seconds: u16,
    pub memory_bytes: u64,
}

/// The only protocol ID a session may start with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionProtocol {
    OfficeReadV1,
}

impl SessionProtocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OfficeReadV1 => SESSION_PROTOCOL,
        }
    }
}

impl Default for EngineSessionStart {
    fn default() -> Self {
        Self {
            protocol: SessionProtocol::OfficeReadV1,
            max_documents: MAX_SESSION_DOCUMENTS,
            idle_seconds: SESSION_IDLE_SECONDS,
            memory_bytes: SESSION_MEMORY_BYTES,
        }
    }
}

impl EngineSessionStart {
    /// Every value is fixed; anything else is a caller bug, not a feature.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.protocol != SessionProtocol::OfficeReadV1
            || self.max_documents != MAX_SESSION_DOCUMENTS
            || self.idle_seconds != SESSION_IDLE_SECONDS
            || self.memory_bytes != SESSION_MEMORY_BYTES
        {
            return Err(EngineError::BadRequest);
        }
        Ok(())
    }
}

/// What one section of a source document is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineSectionKind {
    Document,
    Sheet,
    Slide,
}

impl EngineSectionKind {
    /// The exact ID prefix this kind uses (E7).
    pub fn id_prefix(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Sheet => "sheet",
            Self::Slide => "slide",
        }
    }

    /// Build the stable ID of the zero-based section `index`.
    pub fn section_id(self, index: u32) -> String {
        match self {
            // A Writer document keeps the bare `document` ID.
            Self::Document => Self::Document.id_prefix().to_string(),
            Self::Sheet => format!("sheet:{index}"),
            Self::Slide => format!("slide:{index}"),
        }
    }
}

/// One section the viewer can ask for.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineReadSection {
    pub id: String,
    pub name: String,
    pub kind: EngineSectionKind,
    pub index: u32,
    pub page_count: u32,
}

impl EngineReadSection {
    pub fn validate(&self) -> Result<(), EngineError> {
        if !valid_section_id(&self.id) {
            return Err(EngineError::Failed);
        }
        if self.name.len() > MAX_SECTION_NAME {
            return Err(EngineError::Failed);
        }
        if self.page_count > 10_000 {
            return Err(EngineError::Failed);
        }
        // The ID must name this exact section, not a different one.
        if self.id != self.kind.section_id(self.index) {
            return Err(EngineError::Failed);
        }
        Ok(())
    }
}

/// What the parent learned about one opened document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineReadDocument {
    pub document_id: Uuid,
    pub format: OfficeFormat,
    pub source_revision: u64,
    /// Present only for a snapshot source; a disk file has no content ID.
    pub source_content_id: Option<Uuid>,
    pub sections: Vec<EngineReadSection>,
    pub engine_version: String,
}

impl EngineReadDocument {
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.sections.is_empty() || self.sections.len() > MAX_DOCUMENT_SECTIONS {
            return Err(EngineError::Failed);
        }
        if self.engine_version.is_empty() || self.engine_version.len() > 64 {
            return Err(EngineError::Failed);
        }
        if self.source_revision >= (1u64 << 53) {
            return Err(EngineError::Failed);
        }
        for section in &self.sections {
            section.validate()?;
        }
        Ok(())
    }
}

/// A read-only render request against one open document. No source path and
/// no destination path: the actor still holds the copy it accepted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeSessionRenderRequest {
    pub document_id: Uuid,
    pub target: OfficeRenderTarget,
    pub section_ids: Vec<String>,
    pub ranges: Vec<PageRange>,
    pub include_comments: bool,
    /// Fixed `false` for the ordinary read-only viewer (13).
    pub include_notes: bool,
}

impl OfficeSessionRenderRequest {
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.section_ids.is_empty() || self.section_ids.len() > MAX_SECTIONS_PER_RENDER {
            return Err(EngineError::BadRequest);
        }
        if self.ranges.len() > MAX_RANGES_PER_RENDER {
            return Err(EngineError::BadRequest);
        }
        if self.include_notes {
            return Err(EngineError::BadRequest);
        }
        for id in &self.section_ids {
            if !valid_section_id(id) {
                return Err(EngineError::BadRequest);
            }
        }
        let mut total: u64 = 0;
        for range in &self.ranges {
            if range.first == 0 || range.last < range.first {
                return Err(EngineError::BadRequest);
            }
            total = total.saturating_add(u64::from(range.last - range.first) + 1);
        }
        if total > 10_000 {
            return Err(EngineError::BadRequest);
        }
        Ok(())
    }

    /// True when this request names only sections of `document`.
    pub fn selects_known_sections(&self, document: &EngineReadDocument) -> bool {
        self.section_ids.iter().all(|id| {
            document
                .sections
                .iter()
                .any(|section| &section.id == id)
        })
    }
}

/// One private artifact the actor wrote. Names and hashes only; the parent
/// copies the validated bytes into an `OwnedOutput` itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSessionArtifact {
    pub relative_name: String,
    pub section_id: String,
    pub format: OfficeRenderTarget,
    pub page_count: u32,
    pub mime: String,
    pub byte_len: u64,
    pub sha256: String,
}

impl EngineSessionArtifact {
    pub fn validate(&self) -> Result<(), EngineError> {
        if !valid_relative_basename(&self.relative_name) {
            return Err(EngineError::Failed);
        }
        if !valid_section_id(&self.section_id) {
            return Err(EngineError::Failed);
        }
        if self.page_count > 10_000 {
            return Err(EngineError::Failed);
        }
        if self.mime.is_empty() || self.mime.len() > 128 || self.mime != self.format.mime() {
            return Err(EngineError::Failed);
        }
        if self.byte_len > MAX_ARTIFACT_BYTES {
            return Err(EngineError::Failed);
        }
        if !crate::engine_types::is_sha256_hex(&self.sha256) {
            return Err(EngineError::Failed);
        }
        Ok(())
    }
}

/// One command the parent sends.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum EngineSessionCommand {
    Open {
        document_id: Uuid,
        /// A parent-owned private input copy under the fixed job input root.
        input_name: String,
        format: OfficeFormat,
        source_revision: u64,
        source_content_id: Option<Uuid>,
    },
    Render {
        request: OfficeSessionRenderRequest,
    },
    CloseDocument {
        document_id: Uuid,
    },
    Close {},
}

/// One framed request: kind 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSessionRequest {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub command: EngineSessionCommand,
}

/// One framed reply: kind 2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSessionReply {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub result: EngineSessionReplyResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum EngineSessionReplyResult {
    Opened { document: EngineReadDocument },
    Rendered { artifacts: Vec<EngineSessionArtifact> },
    Closed {},
    Error { code: EngineError },
}

/// One heartbeat: kind 3.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSessionHeartbeat {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub completed_units: u64,
    pub total_units: Option<u64>,
}

impl EngineSessionHeartbeat {
    pub fn validate(&self) -> Result<(), EngineError> {
        if let Some(total) = self.total_units {
            if total < self.completed_units {
                return Err(EngineError::Failed);
            }
        }
        Ok(())
    }
}

/// A cancel notice: kind 4. It carries no document mutation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSessionCancel {
    pub protocol_version: u32,
    pub request_id: Uuid,
}

impl EngineSessionRequest {
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.protocol_version != SESSION_PROTOCOL_VERSION {
            return Err(EngineError::BadRequest);
        }
        match &self.command {
            EngineSessionCommand::Open {
                input_name,
                source_revision,
                ..
            } => {
                if !valid_relative_basename(input_name) || *source_revision >= (1u64 << 53) {
                    return Err(EngineError::BadRequest);
                }
            }
            EngineSessionCommand::Render { request } => request.validate()?,
            EngineSessionCommand::CloseDocument { .. } | EngineSessionCommand::Close {} => {}
        }
        Ok(())
    }
}

impl EngineSessionReply {
    /// Check the envelope of a reply the child sent.
    pub fn validate(&self, request_id: Uuid) -> Result<(), EngineError> {
        if self.protocol_version != SESSION_PROTOCOL_VERSION || self.request_id != request_id {
            return Err(EngineError::Failed);
        }
        match &self.result {
            EngineSessionReplyResult::Opened { document } => document.validate()?,
            EngineSessionReplyResult::Rendered { artifacts } => {
                if artifacts.len() > MAX_RENDER_ARTIFACTS {
                    return Err(EngineError::Failed);
                }
                let mut total: u64 = 0;
                for artifact in artifacts {
                    artifact.validate()?;
                    total = total.saturating_add(artifact.byte_len);
                }
                if total > MAX_RENDER_BYTES {
                    return Err(EngineError::Failed);
                }
            }
            EngineSessionReplyResult::Closed {} => {}
            EngineSessionReplyResult::Error { .. } => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_ids_follow_the_fixed_shape() {
        assert_eq!(EngineSectionKind::Document.section_id(0), "document");
        assert_eq!(EngineSectionKind::Sheet.section_id(3), "sheet:3");
        assert_eq!(EngineSectionKind::Slide.section_id(0), "slide:0");
        let section = EngineReadSection {
            id: "sheet:3".to_string(),
            name: "Quarter 3".to_string(),
            kind: EngineSectionKind::Sheet,
            index: 3,
            page_count: 1,
        };
        assert!(section.validate().is_ok());
        let wrong = EngineReadSection {
            id: "sheet:4".to_string(),
            ..section
        };
        assert_eq!(wrong.validate(), Err(EngineError::Failed));
    }

    #[test]
    fn start_values_are_fixed() {
        assert!(EngineSessionStart::default().validate().is_ok());
        let wrong = EngineSessionStart {
            max_documents: 5,
            ..EngineSessionStart::default()
        };
        assert_eq!(wrong.validate(), Err(EngineError::BadRequest));
    }

    #[test]
    fn notes_are_never_requested_by_the_reader() {
        let request = OfficeSessionRenderRequest {
            document_id: Uuid::nil(),
            target: OfficeRenderTarget::Pdf,
            section_ids: vec!["document".to_string()],
            ranges: Vec::new(),
            include_comments: true,
            include_notes: true,
        };
        assert_eq!(request.validate(), Err(EngineError::BadRequest));
    }

    #[test]
    fn heartbeats_never_go_backwards() {
        let heartbeat = EngineSessionHeartbeat {
            protocol_version: SESSION_PROTOCOL_VERSION,
            request_id: Uuid::nil(),
            completed_units: 5,
            total_units: Some(4),
        };
        assert_eq!(heartbeat.validate(), Err(EngineError::Failed));
    }
}
