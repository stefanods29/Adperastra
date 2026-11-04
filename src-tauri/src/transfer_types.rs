//! Content transfer wire types (Step 09c, `content-transfer-1`).
//!
//! The mirror of `src/transfer/types.ts`. A payload is opaque data from the
//! renderer: the native side validates every field again, derives
//! sensitivity from the source/snapshot instead of trusting the caller,
//! and never accepts bytes or a filesystem path for image/PDF content.

use crate::document_types::DocumentRef;
use crate::export_snapshot_types::{ExportSnapshot, StoragePolicy};
use serde::{Deserialize, Serialize};

/// Text limit shared by plain and rich payloads, in Unicode scalar values.
pub const MAX_TRANSFER_TEXT_SCALARS: usize = 1_048_576;
pub const MAX_TRANSFER_RICH_BLOCKS: usize = 10_000;
pub const MAX_TRANSFER_RICH_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TRANSFER_RUNS_PER_BLOCK: usize = 1_000;
pub const MAX_TRANSFER_MARKS_PER_RUN: usize = 8;
pub const MAX_TRANSFER_BLOCK_DEPTH: u8 = 8;
pub const MAX_TRANSFER_CELLS: usize = 100_000;
pub const MAX_TRANSFER_CELL_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TRANSFER_COLUMNS: u32 = 2_000;
pub const MAX_TRANSFER_CELL_TEXT_UTF16: usize = 32_767;
pub const MAX_TRANSFER_CELL_FORMAT: usize = 128;
pub const MAX_TRANSFER_FILE_SOURCES: usize = 1_000;
pub const MAX_TRANSFER_PDF_PAGES: usize = 100;
pub const MAX_TRANSFER_SOURCE_TAB_ID: usize = 128;
pub const MAX_TRANSFER_LOSSES: usize = 16;
pub const MAX_TRANSFER_LABEL_KEY: usize = 128;

/// Lease budgets (Step 09c D5/T2). The native registry owns the counting.
pub const MAX_TRANSFER_ACTIVE_LEASES: usize = 32;
pub const MAX_TRANSFER_LEASE_BYTES: u64 = 256 * 1024 * 1024;
pub const TRANSFER_LEASE_TTL_SECS: u64 = 60;
pub const TRANSFER_LEASE_MAX_SECS: u64 = 300;

/// Stable failures; the UI translates `code()` under `errors.transfer.*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferError {
    Invalid,
    TooLarge,
    Expired,
    Unsupported,
    ReadOnly,
    Changed,
    Sensitive,
    Failed,
}

impl TransferError {
    pub fn code(&self) -> &'static str {
        match self {
            TransferError::Invalid => "transfer.invalid",
            TransferError::TooLarge => "transfer.too_large",
            TransferError::Expired => "transfer.expired",
            TransferError::Unsupported => "transfer.unsupported",
            TransferError::ReadOnly => "transfer.read_only",
            TransferError::Changed => "transfer.changed",
            TransferError::Sensitive => "transfer.sensitive",
            TransferError::Failed => "transfer.failed",
        }
    }
}

impl From<TransferError> for String {
    fn from(error: TransferError) -> String {
        error.code().to_string()
    }
}

/// Wire mirror of the TypeScript kind union; the typed payload variants
/// carry the same information for native code.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferKind {
    Text,
    RichText,
    Cells,
    Image,
    PdfPages,
    Files,
}

/// One style mark. A foreground mark carries the exact four channels; no
/// CSS string, URL or font name exists in this type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TransferMark {
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Foreground { foreground_rgba: [u8; 4] },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferTextRun {
    pub text: String,
    pub marks: Vec<TransferMark>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferBlockKind {
    Paragraph,
    Heading,
    ListItem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferListOrder {
    Ordered,
    Unordered,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferBlock {
    pub kind: TransferBlockKind,
    pub runs: Vec<TransferTextRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list_order: Option<TransferListOrder>,
    pub depth: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferCellKind {
    Text,
    Number,
    Boolean,
    Blank,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferCellFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foreground_rgba: Option<[u8; 4]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_rgba: Option<[u8; 4]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferCell {
    pub kind: TransferCellKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boolean: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<TransferCellFormat>,
}

/// The payload variants. Image and PDF content travel as an 08a snapshot
/// identity; their bytes never enter this message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TransferPayload {
    Text {
        text: String,
    },
    RichText {
        blocks: Vec<TransferBlock>,
    },
    Cells {
        rows: Vec<Vec<TransferCell>>,
        row_count: u32,
        column_count: u32,
    },
    Image {
        snapshot: ExportSnapshot,
        width: u32,
        height: u32,
    },
    PdfPages {
        snapshot: ExportSnapshot,
        pages: Vec<u32>,
    },
    Files {
        sources: Vec<DocumentRef>,
    },
}

/// A transfer as the renderer sees it. `sensitive` is a hint only; native
/// validation ORs it with the authoritative source and snapshot policies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferEnvelope {
    pub transfer_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_revision: Option<u64>,
    pub sensitive: bool,
    pub payload: TransferPayload,
    pub expires_unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_tab_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferActionId {
    InsertText,
    InsertRichText,
    InsertCells,
    InsertImage,
    InsertPdfPages,
    InsertPageImages,
    AddLayers,
    AddClips,
    AttachFiles,
    OpenFiles,
    CopyFiles,
    MoveFiles,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferAction {
    pub id: TransferActionId,
    pub label_key: String,
    pub losses: Vec<String>,
    pub mutates: bool,
}

/// What a target proves after committing. There is deliberately no byte
/// field; image/PDF bytes stay behind their snapshot leases.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferReceipt {
    pub transaction_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    pub inserted_count: u32,
    pub losses: Vec<String>,
    pub complete: bool,
}

pub fn is_transfer_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}

/// A full translation key `transfer.<camelCase>`; anything else would
/// render untranslated and is refused.
pub fn valid_transfer_key(value: &str) -> bool {
    if value.chars().count() > MAX_TRANSFER_LABEL_KEY {
        return false;
    }
    let Some(rest) = value.strip_prefix("transfer.") else {
        return false;
    };
    let mut chars = rest.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
        && chars.all(|character| character.is_ascii_alphanumeric())
}

pub fn is_loss_key(value: &str) -> bool {
    matches!(value, "transfer.lossFormatting" | "transfer.lossFormula")
}

pub fn valid_source_tab_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_TRANSFER_SOURCE_TAB_ID
        && !value.chars().any(char::is_control)
}

/// A sensitive snapshot or a sensitive native source can only raise the
/// envelope's flag; a caller claiming `false` can never lower it.
pub fn effective_sensitive(caller_sensitive: bool, native_sensitive: bool, policy: StoragePolicy) -> bool {
    caller_sensitive || native_sensitive || policy == StoragePolicy::Sensitive
}
