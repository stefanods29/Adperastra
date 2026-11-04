//! Native session, transaction and security contracts for Office editing
//! (Step 20a E1-E10/E13/E18/E24, office-edit-1).
//!
//! Every wire struct uses snake_case and denies unknown fields. No record here
//! carries a source path, output path, raw engine command or executable script.
#![allow(dead_code)]


use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::engine_types::OfficeFormat;
use crate::export_snapshots::SnapshotLease;
use crate::file_grant_backing::GrantedBacking;
use crate::office_edit_deck::DeckOperation;
use crate::office_edit_document::DocumentOperation;
use crate::office_edit_sheet::SheetOperation;
use crate::office_edit_values::{
    OfficeBinaryLease, OfficeRect, OfficeSelection, TextSpan, MAX_SAFE_INTEGER,
};

pub const MAX_TRANSACTION_OPERATIONS: usize = 1_000;
pub const MAX_DTO_BYTES: usize = 768 * 1024;

pub const OFFICE_MAX_SESSIONS: usize = 4;
pub const OFFICE_MAX_QUEUE: usize = 32;
pub const OFFICE_MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
pub const OFFICE_MAX_INPUT_BYTES: u64 = 512 * 1024 * 1024;
pub const OFFICE_MAX_EXPANDED_BYTES: u64 = 1024 * 1024 * 1024;
pub const OFFICE_MAX_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;
pub const OFFICE_MAX_PACKAGE_ENTRIES: u32 = 100_000;
pub const OFFICE_MAX_COMPRESSION_RATIO: u32 = 500;
pub const OFFICE_MAX_PACKAGE_DEPTH: u32 = 64;
pub const OFFICE_MAX_JOB_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const OFFICE_OPEN_TIMEOUT_SECS: u64 = 60;
pub const OFFICE_TRANSACTION_TIMEOUT_SECS: u64 = 10;
pub const OFFICE_EXPORT_TIMEOUT_SECS: u64 = 120;
pub const OFFICE_CANCEL_GRACE_MILLIS: u64 = 250;
pub const OFFICE_IDLE_MINUTES: u64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeFamily {
    Document,
    Sheet,
    Deck,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeMode {
    Viewing,
    Editing,
    Reviewing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeCapability {
    DocumentText,
    DocumentFormat,
    DocumentTables,
    DocumentImages,
    DocumentReferences,
    DocumentReview,
    DocumentComments,
    Spelling,
    SheetCells,
    SheetFormulas,
    SheetFormats,
    SheetValidation,
    SheetCharts,
    SheetPivots,
    SheetStructure,
    DeckSlides,
    DeckShapes,
    DeckMasters,
    DeckThemes,
    DeckTransitions,
    DeckAnimations,
    DeckPresent,
    DeckComments,
    PreserveUnknown,
    SaveExisting,
    SaveCopy,
    ExportPdf,
    ExportImages,
    Print,
    SensitiveMemory,
    AiContext,
    ProposalClone,
    ProposalApply,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompatibilityState {
    Editable,
    PreservedOnly,
    Unsupported,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompatibilityItem {
    pub feature_id: String,
    pub state: CompatibilityState,
    pub count: u32,
    pub message_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompatibilityReport {
    pub format: String,
    pub entries: Vec<CompatibilityItem>,
    pub next_cursor: Option<Uuid>,
    pub can_preserve_unknown: bool,
    pub blocks_save: bool,
}

impl CompatibilityReport {
    pub fn is_valid(&self) -> bool {
        !self.format.is_empty()
            && self.format.len() <= 32
            && self.entries.len() <= 256
            && self.entries.iter().all(|entry| {
                !entry.feature_id.is_empty()
                    && entry.feature_id.chars().count() <= 128
                    && !entry.message_key.is_empty()
                    && entry.message_key.chars().count() <= 128
            })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeSessionState {
    pub session_id: Uuid,
    pub document_id: Uuid,
    pub family: OfficeFamily,
    pub format: OfficeFormat,
    pub revision: u64,
    pub saved_revision: u64,
    pub content_id: Uuid,
    pub saved_content_id: Uuid,
    pub ready: bool,
    pub mode: OfficeMode,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub capabilities: Vec<OfficeCapability>,
    pub selection: Option<OfficeSelection>,
    pub compatibility: CompatibilityReport,
    pub page_count: u32,
    pub sheet_count: u32,
    pub slide_count: u32,
    pub busy: bool,
    pub status_key: Option<String>,
}

impl OfficeSessionState {
    pub fn is_valid(&self) -> bool {
        !self.session_id.is_nil()
            && !self.document_id.is_nil()
            && !self.content_id.is_nil()
            && !self.saved_content_id.is_nil()
            && self.revision >= 1
            && self.revision <= MAX_SAFE_INTEGER
            && self.saved_revision >= 1
            && self.saved_revision <= self.revision
            && self.capabilities.len() <= 33
            && self.selection.as_ref().is_none_or(OfficeSelection::is_valid)
            && self.compatibility.is_valid()
            && self.status_key.as_ref().is_none_or(|key| key.len() <= 128)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "family", content = "operation")]
pub enum OfficeOperation {
    #[serde(rename = "document")]
    Document(DocumentOperation),
    #[serde(rename = "sheet")]
    Sheet(SheetOperation),
    #[serde(rename = "deck")]
    Deck(DeckOperation),
}

impl OfficeOperation {
    pub fn validate(&self, current_revision: u64) -> Result<(), OfficeEditError> {
        match self {
            Self::Document(operation) => operation.validate(current_revision),
            Self::Sheet(operation) => operation.validate(),
            Self::Deck(operation) => operation.validate(current_revision),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeTransaction {
    pub transaction_id: Uuid,
    pub expected_revision: u64,
    pub operations: Vec<OfficeOperation>,
    pub selection_after: Option<OfficeSelection>,
    pub label_key: String,
}

impl OfficeTransaction {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        if self.transaction_id.is_nil()
            || self.expected_revision < 1
            || self.expected_revision > MAX_SAFE_INTEGER
            || self.operations.is_empty()
            || self.operations.len() > MAX_TRANSACTION_OPERATIONS
            || self.label_key.is_empty()
            || self.label_key.len() > 128
            || self.selection_after.as_ref().is_some_and(|s| !s.is_valid())
        {
            return Err(OfficeEditError::Invalid);
        }
        let encoded = serde_json::to_vec(self).map_err(|_| OfficeEditError::Invalid)?;
        if encoded.len() > MAX_DTO_BYTES {
            return Err(OfficeEditError::TooLarge);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeTransactionResult {
    pub transaction_id: Uuid,
    pub state: OfficeSessionState,
    pub changed: bool,
    pub affected_ids: Vec<Uuid>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeResultPage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeAccessibleRole {
    Document,
    Paragraph,
    Heading,
    Table,
    Row,
    Cell,
    Textbox,
    Image,
    Button,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAccessibleNode {
    pub id: Uuid,
    pub role: OfficeAccessibleRole,
    pub name: String,
    pub rect: OfficeRect,
    pub editable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck_text: Option<OfficeDeckTextTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_text: Option<OfficeDeckTextTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeDeckTextTarget {
    pub span: TextSpan,
    pub text: String,
}

impl OfficeDeckTextTarget {
    pub fn is_valid(&self) -> bool {
        let units = self.text.encode_utf16().count();
        units <= 4_096
            && self.span.is_valid()
            && self.span.anchor.block_id == self.span.focus.block_id
            && self.span.focus.offset_utf16.checked_sub(self.span.anchor.offset_utf16)
                == Some(units as u32)
    }
}

#[cfg(test)]
mod deck_text_target_tests {
    use super::*;
    use crate::office_edit_values::TextPosition;

    #[test]
    fn deck_text_target_requires_one_block_and_exact_utf16_length() {
        let block_id = Uuid::new_v4();
        let mut target = OfficeDeckTextTarget {
            text: "A🐴B".to_owned(),
            span: TextSpan {
                anchor: TextPosition { block_id, offset_utf16: 8 },
                focus: TextPosition { block_id, offset_utf16: 12 },
                revision: 1,
            },
        };
        assert!(target.is_valid());
        target.span.focus.offset_utf16 = 11;
        assert!(!target.is_valid());
        target.span.focus.offset_utf16 = 12;
        target.span.focus.block_id = Uuid::new_v4();
        assert!(!target.is_valid());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeRenderPage {
    pub session_id: Uuid,
    pub view_revision: u32,
    pub page_id: String,
    pub image: OfficeBinaryLease,
    pub rect: OfficeRect,
    pub accessibility: Vec<OfficeAccessibleNode>,
    pub next_cursor: Option<Uuid>,
}

impl OfficeRenderPage {
    pub fn is_valid(&self) -> bool {
        !self.session_id.is_nil()
            && !self.page_id.is_empty()
            && self.page_id.len() <= 128
            && self.image.is_valid()
            && self.rect.is_valid()
            && self.accessibility.len() <= 256
            && self.accessibility.iter().all(|node| {
                !node.id.is_nil()
                    && node.name.encode_utf16().count() <= 4_096
                    && node.rect.is_valid()
                    && node.deck_text.as_ref().is_none_or(|target| {
                        node.editable && node.role == OfficeAccessibleRole::Textbox && target.is_valid()
                    })
                    && node.document_text.as_ref().is_none_or(|target| {
                        node.editable
                            && matches!(node.role, OfficeAccessibleRole::Paragraph | OfficeAccessibleRole::Heading)
                            && target.span.anchor.block_id == node.id
                            && target.is_valid()
                    })
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeExportFormat {
    Pdf,
    Png,
    Jpeg,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfficeSecurityPolicy {
    pub allow_macros: bool,
    pub allow_external_links: bool,
    pub allow_dde: bool,
    pub allow_ole: bool,
    pub allow_network: bool,
    pub max_input_bytes: u64,
    pub max_expanded_bytes: u64,
    pub max_output_bytes: u64,
    pub max_package_entries: u32,
    pub max_compression_ratio: u32,
    pub max_package_depth: u32,
    pub max_queue: usize,
    pub max_dto_bytes: usize,
    pub max_chunk_bytes: usize,
    pub open_timeout_secs: u64,
    pub transaction_timeout_secs: u64,
    pub export_timeout_secs: u64,
    pub max_job_memory_bytes: u64,
}

impl Default for OfficeSecurityPolicy {
    fn default() -> Self {
        Self {
            allow_macros: false,
            allow_external_links: false,
            allow_dde: false,
            allow_ole: false,
            allow_network: false,
            max_input_bytes: OFFICE_MAX_INPUT_BYTES,
            max_expanded_bytes: OFFICE_MAX_EXPANDED_BYTES,
            max_output_bytes: OFFICE_MAX_OUTPUT_BYTES,
            max_package_entries: OFFICE_MAX_PACKAGE_ENTRIES,
            max_compression_ratio: OFFICE_MAX_COMPRESSION_RATIO,
            max_package_depth: OFFICE_MAX_PACKAGE_DEPTH,
            max_queue: OFFICE_MAX_QUEUE,
            max_dto_bytes: MAX_DTO_BYTES,
            max_chunk_bytes: OFFICE_MAX_CHUNK_BYTES,
            open_timeout_secs: OFFICE_OPEN_TIMEOUT_SECS,
            transaction_timeout_secs: OFFICE_TRANSACTION_TIMEOUT_SECS,
            export_timeout_secs: OFFICE_EXPORT_TIMEOUT_SECS,
            max_job_memory_bytes: OFFICE_MAX_JOB_MEMORY_BYTES,
        }
    }
}

impl OfficeSecurityPolicy {
    /// Security flags are never tunable at runtime.
    pub fn is_valid(&self) -> bool {
        !self.allow_macros
            && !self.allow_external_links
            && !self.allow_dde
            && !self.allow_ole
            && !self.allow_network
            && self.max_input_bytes > 0
            && self.max_input_bytes <= OFFICE_MAX_INPUT_BYTES
            && self.max_expanded_bytes > 0
            && self.max_expanded_bytes <= OFFICE_MAX_EXPANDED_BYTES
            && self.max_output_bytes > 0
            && self.max_output_bytes <= OFFICE_MAX_OUTPUT_BYTES
            && self.max_package_entries > 0
            && self.max_package_entries <= OFFICE_MAX_PACKAGE_ENTRIES
            && self.max_compression_ratio > 0
            && self.max_compression_ratio <= OFFICE_MAX_COMPRESSION_RATIO
            && self.max_package_depth > 0
            && self.max_package_depth <= OFFICE_MAX_PACKAGE_DEPTH
            && self.max_queue > 0
            && self.max_queue <= OFFICE_MAX_QUEUE
            && self.max_dto_bytes > 0
            && self.max_dto_bytes <= MAX_DTO_BYTES
            && self.max_chunk_bytes > 0
            && self.max_chunk_bytes <= OFFICE_MAX_CHUNK_BYTES
            && self.open_timeout_secs > 0
            && self.transaction_timeout_secs > 0
            && self.export_timeout_secs > 0
            && self.max_job_memory_bytes > 0
            && self.max_job_memory_bytes <= OFFICE_MAX_JOB_MEMORY_BYTES
    }
}

#[derive(Clone)]
pub enum OfficeInputBacking {
    Original(Arc<GrantedBacking>),
    Snapshot(Arc<SnapshotLease>),
}

impl OfficeInputBacking {
    pub fn granted(&self) -> &Arc<GrantedBacking> {
        match self {
            Self::Original(backing) => backing,
            Self::Snapshot(lease) => &lease.backing,
        }
    }
}

#[derive(Clone)]
pub struct AuthorizedOfficeInput {
    pub document_id: Uuid,
    pub initial_revision: u64,
    pub initial_content_id: Uuid,
    pub backing: OfficeInputBacking,
    pub format: OfficeFormat,
    pub source: Option<fs_service::SourceStamp>,
    pub sensitive: bool,
}

impl AuthorizedOfficeInput {
    /// Structural check only; the binding still verifies the live document.
    pub fn is_valid(&self) -> bool {
        !self.document_id.is_nil()
            && self.initial_revision >= 1
            && self.initial_revision <= MAX_SAFE_INTEGER
            && !self.initial_content_id.is_nil()
            && self.backing.granted().is_consistent()
            && self.backing.granted().is_sensitive() == self.sensitive
    }
}

pub struct OfficeCallContext<'a> {
    pub request_id: String,
    pub cancel: fs_service::CancellationToken,
    pub deadline: Instant,
    pub progress: &'a mut dyn FnMut(&fs_service::OpProgress),
}

impl OfficeCallContext<'_> {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        if self.request_id.is_empty()
            || self.request_id.len() > 64
            || !self.request_id.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(OfficeEditError::Invalid);
        }
        Ok(())
    }

    pub fn check(&self) -> Result<(), OfficeEditError> {
        self.validate()?;
        if self
            .cancel
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err(OfficeEditError::Cancelled);
        }
        if Instant::now() >= self.deadline {
            return Err(OfficeEditError::Timeout);
        }
        Ok(())
    }

    pub fn report(&mut self, progress: &fs_service::OpProgress) {
        (self.progress)(progress);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfficeEditError {
    Invalid,
    EngineMissing,
    Unsupported,
    ReadOnly,
    Changed,
    TooLarge,
    Busy,
    Cancelled,
    Timeout,
    PreservationFailed,
    SensitiveUnsupported,
    Failed,
    ProposalExpired,
    ContextLimit,
    FormulaUnsafe,
    CalculationFailed,
    ConfirmationRequired,
}

impl OfficeEditError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "office_edit.invalid",
            Self::EngineMissing => "office_edit.engine_missing",
            Self::Unsupported => "office_edit.unsupported",
            Self::ReadOnly => "office_edit.read_only",
            Self::Changed => "office_edit.changed",
            Self::TooLarge => "office_edit.too_large",
            Self::Busy => "office_edit.busy",
            Self::Cancelled => "office_edit.cancelled",
            Self::Timeout => "office_edit.timeout",
            Self::PreservationFailed => "office_edit.preservation_failed",
            Self::SensitiveUnsupported => "office_edit.sensitive_unsupported",
            Self::Failed => "office_edit.failed",
            Self::ProposalExpired => "office_edit.proposal_expired",
            Self::ContextLimit => "office_edit.context_limit",
            Self::FormulaUnsafe => "office_edit.formula_unsafe",
            Self::CalculationFailed => "office_edit.calculation_failed",
            Self::ConfirmationRequired => "office_edit.confirmation_required",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindingSession {
    pub session_id: Uuid,
    pub initial_state: OfficeSessionState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncodedOfficeInfo {
    pub mime: String,
    pub byte_len: u64,
    pub format: OfficeFormat,
    pub source_revision: u64,
    pub content_id: Uuid,
    pub preserved_features: Vec<String>,
    pub compatibility: CompatibilityReport,
}

/// Canonical item/lookup records live beside their paged contracts; re-export
/// them here so binding code has one stable `office_edit_types` import.
pub use crate::office_edit_items::OfficeDiscardSavedResult;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::office_edit_values::{TextPosition, TextSpan};

    #[test]
    fn unknown_operation_rejected() {
        let value = serde_json::json!({
            "family": "document",
            "operation": { "kind": "raw_engine_command" }
        });
        assert!(serde_json::from_value::<OfficeOperation>(value).is_err());
    }

    #[test]
    fn transaction_wire_uses_snake_case() {
        let block = Uuid::new_v4();
        let transaction = OfficeTransaction {
            transaction_id: Uuid::new_v4(),
            expected_revision: 1,
            operations: vec![OfficeOperation::Document(DocumentOperation::DeleteText {
                span: TextSpan {
                    anchor: TextPosition {
                        block_id: block,
                        offset_utf16: 0,
                    },
                    focus: TextPosition {
                        block_id: block,
                        offset_utf16: 0,
                    },
                    revision: 1,
                },
            })],
            selection_after: None,
            label_key: "office.transaction".to_string(),
        };
        let json = serde_json::to_value(&transaction).unwrap();
        assert!(json.get("transaction_id").is_some());
        assert!(json.get("expected_revision").is_some());
        assert!(json.get("selection_after").is_some());
        assert!(json.get("selectionAfter").is_none());
    }
}
