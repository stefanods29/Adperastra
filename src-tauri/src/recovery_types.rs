//! Wire types and bounds for encrypted recovery records (Step 09h,
//! interface revision `recovery-1`). Nothing in this module touches the
//! disk; `recovery_store` owns the encrypted store and `recovery_open` owns
//! the reviewed plaintext copies.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use fs_service::SourceStamp;

use crate::document_types::DocumentRef;

/// Version of the public recovery metadata and of one stored record.
pub const RECOVERY_VERSION: u32 = 1;
/// Version of the on-disk catalog (opaque rows only).
pub const CATALOG_VERSION: u32 = 1;

/// DPAPI-authenticated metadata may not exceed this size.
pub const MAX_METADATA_BYTES: usize = 65_536;
/// One encoded recovered revision.
pub const MAX_RECORD_BYTES: u64 = 67_108_864;
/// How many records the store keeps.
pub const MAX_RECORDS: usize = 32;
/// Everything the recovery store may hold, including pending records.
pub const MAX_TOTAL_BYTES: u64 = 1_073_741_824;
/// One list answer.
pub const MAX_LIST_PAGE: usize = 100;
/// Records are stored under and discarded from this many ids at once.
pub const MAX_DISCARD_IDS: usize = 100;
/// A verified clean record is retained for a week before cleanup.
pub const CLEAN_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60;
/// JavaScript numbers must stay exact.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// `ADPREC1` starts every encrypted record.
pub const ENVELOPE_MAGIC: &[u8; 7] = b"ADPREC1";
/// The envelope version written by this build.
pub const ENVELOPE_VERSION: u32 = 1;
/// magic + version + record id + metadata length + content length.
pub const ENVELOPE_HEADER_LEN: usize = 7 + 4 + 16 + 4 + 8;
/// The authenticated prefix before the encoded bytes (Step 09h decision 6).
pub const CONTENT_PREFIX_LEN: usize = 16 + 16 + 8 + 16 + 8 + 32;
/// DPAPI grows a blob by a few dozen bytes; this is the accepted overhead.
pub const DPAPI_OVERHEAD: u64 = 65_536;

fn default_version() -> u32 {
    RECOVERY_VERSION
}

/// What one captured revision is, enough to list and to open it later.
/// The metadata blob repeats this identity; the catalog never holds it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryMetadata {
    #[serde(default = "default_version")]
    pub version: u32,
    pub record_id: Uuid,
    pub document_id: Uuid,
    pub source: DocumentRef,
    #[serde(default)]
    pub source_stamp: Option<SourceStamp>,
    pub name: String,
    pub mime: String,
    pub handler_id: String,
    pub captured_revision: u64,
    pub content_id: Uuid,
    pub captured_unix: u64,
    pub byte_len: u64,
    #[serde(default)]
    pub from_internet: bool,
    /// Locked-folder contents never enter the ordinary store.
    #[serde(default)]
    pub sensitive: bool,
}

/// One row of the recovery dialog, built only from authenticated metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryCandidate {
    pub record_id: Uuid,
    pub name: String,
    #[serde(default)]
    pub source_path: Option<String>,
    pub captured_unix: u64,
    pub revision: u64,
    pub byte_len: u64,
    pub status: RecoveryStatus,
    #[serde(default)]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryStatus {
    Available,
    Unsupported,
    Corrupt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryListPage {
    pub items: Vec<RecoveryCandidate>,
    #[serde(default)]
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub unclean_exit: bool,
    pub safe_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryOpenResult {
    pub record_id: Uuid,
    pub copy_path: String,
    pub from_internet: bool,
}

/// What one save job reports back through the shared job table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoverySaveResult {
    pub record_id: Uuid,
    pub captured_revision: u64,
}

/// One catalog row: opaque ids, times and lengths only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryCatalogRecord {
    pub record_id: Uuid,
    pub document_id: Uuid,
    /// Opaque content identity: allows a verified save to mark exactly the
    /// recovered revision clean without storing any name or path.
    pub content_id: Uuid,
    pub revision: u64,
    pub captured_unix: u64,
    pub byte_len: u64,
    pub state: RecoveryRecordState,
    #[serde(default)]
    pub error_code: Option<String>,
    /// When a verified save made this record clean. Retention counts from
    /// here, so `captured_unix` stays the authenticated capture time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clean_unix: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryRecordState {
    Pending,
    Available,
    Unsupported,
    Corrupt,
    Clean,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryCatalog {
    pub schema_version: u32,
    pub records: Vec<RecoveryCatalogRecord>,
}

impl Default for RecoveryCatalog {
    fn default() -> Self {
        Self {
            schema_version: CATALOG_VERSION,
            records: Vec::new(),
        }
    }
}

impl RecoveryCatalog {
    /// Every record's encoded length; pending records count before they are
    /// published so a reservation cannot be overtaken.
    pub fn total_bytes(&self) -> u64 {
        self.records.iter().fold(0u64, |total, record| {
            total.saturating_add(record.byte_len)
        })
    }

    pub fn get(&self, id: Uuid) -> Option<&RecoveryCatalogRecord> {
        self.records.iter().find(|record| record.record_id == id)
    }
}

impl RecoveryCatalogRecord {
    /// Retention counts from the verified-clean moment when there is one,
    /// otherwise from the capture time of an older catalog row.
    pub fn retention_unix(&self) -> u64 {
        self.clean_unix.unwrap_or(self.captured_unix)
    }
}

impl RecoveryMetadata {
    /// The original OS path, when the source has one. The canonical tagged
    /// `DocumentRef` carries it; virtual and draft sources have none.
    pub fn original_path(&self) -> Option<String> {
        source_path(&self.source)
    }
}

/// Build a disk source from the one canonical `DocumentRef` definition.
pub fn disk_source(path: &str) -> Result<DocumentRef, String> {
    Ok(DocumentRef::Disk {
        path: path.to_string(),
    })
}

/// Read the original path from the canonical source descriptor.
pub fn source_path(source: &DocumentRef) -> Option<String> {
    match source {
        DocumentRef::Disk { path } => Some(path.clone()),
        DocumentRef::Virtual { .. } | DocumentRef::Draft { .. } => None,
    }
}

/// The source kind from the same canonical descriptor: `disk`, `virtual`
/// (locked) or `draft`.
pub fn source_kind(source: &DocumentRef) -> Option<&'static str> {
    match source {
        DocumentRef::Disk { .. } => Some("disk"),
        DocumentRef::Virtual { .. } => Some("virtual"),
        DocumentRef::Draft { .. } => Some("draft"),
    }
}

/// Validate every metadata field before a byte is protected or written.
/// Errors are the stable `recovery.*` codes of recovery-1.
pub fn validate_metadata(metadata: &RecoveryMetadata) -> Result<(), String> {
    if metadata.version != RECOVERY_VERSION
        || metadata.record_id.is_nil()
        || metadata.document_id.is_nil()
        || metadata.content_id.is_nil()
    {
        return Err("recovery.invalid".to_string());
    }
    if metadata.sensitive {
        return Err("recovery.locked".to_string());
    }
    let kind = source_kind(&metadata.source).ok_or_else(|| "recovery.invalid".to_string())?;
    match kind {
        "disk" => {
            let path = metadata
                .original_path()
                .ok_or_else(|| "recovery.invalid".to_string())?;
            crate::validate_absolute_path(&path).map_err(|_| "recovery.invalid".to_string())?;
        }
        // Locked containers own their encrypted recovery (Step 09k).
        "virtual" => return Err("recovery.locked".to_string()),
        // A draft source has no OS path and is ordinary unless sensitive.
        "draft" => {
            metadata
                .source
                .validate()
                .map_err(|_| "recovery.invalid".to_string())?;
        }
        _ => return Err("recovery.invalid".to_string()),
    }
    if let Some(stamp) = &metadata.source_stamp {
        stamp
            .validate()
            .map_err(|_| "recovery.invalid".to_string())?;
        if kind != "disk" {
            return Err("recovery.invalid".to_string());
        }
        let path = metadata
            .original_path()
            .ok_or_else(|| "recovery.invalid".to_string())?;
        let key =
            fs_service::path_key_of(std::path::Path::new(&path)).map_err(|_| "recovery.invalid".to_string())?;
        if key != stamp.path_key {
            return Err("recovery.invalid".to_string());
        }
    }
    if metadata.name.is_empty()
        || metadata.name.encode_utf16().count() > 255
        || fs_service::validate_new_name(&metadata.name).is_err()
    {
        return Err("recovery.invalid".to_string());
    }
    if metadata.mime.is_empty()
        || metadata.mime.chars().count() > 128
        || !metadata
            .mime
            .chars()
            .all(|character| character.is_ascii_graphic() || character == ' ')
    {
        return Err("recovery.invalid".to_string());
    }
    if metadata.handler_id.is_empty()
        || metadata.handler_id.chars().count() > 64
        || !metadata
            .handler_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("recovery.invalid".to_string());
    }
    if metadata.captured_revision == 0
        || metadata.captured_revision > MAX_SAFE_INTEGER
        || metadata.captured_unix > MAX_SAFE_INTEGER
        || metadata.byte_len > MAX_SAFE_INTEGER
    {
        return Err("recovery.invalid".to_string());
    }
    if metadata.byte_len > MAX_RECORD_BYTES {
        return Err("recovery.too_large".to_string());
    }
    Ok(())
}

/// Split one canonical record path into the identity a catalog row may keep.
pub fn record_file_name(id: Uuid) -> String {
    format!("{id}.adprec")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk_metadata(name: &str) -> RecoveryMetadata {
        RecoveryMetadata {
            version: 1,
            record_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            source: disk_source("C:\\Work\\notes.txt").unwrap(),
            source_stamp: None,
            name: name.to_string(),
            mime: "text/plain".to_string(),
            handler_id: "text".to_string(),
            captured_revision: 3,
            content_id: Uuid::new_v4(),
            captured_unix: 1_700_000_000,
            byte_len: 10,
            from_internet: false,
            sensitive: false,
        }
    }

    #[test]
    fn accepts_a_bounded_ordinary_record() {
        validate_metadata(&disk_metadata("notes.txt")).unwrap();
    }

    #[test]
    fn refuses_a_sensitive_or_traversing_record() {
        let mut metadata = disk_metadata("notes.txt");
        metadata.sensitive = true;
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.locked");

        let mut metadata = disk_metadata("notes.txt");
        metadata.source = disk_source("C:\\Work\\..\\secret.txt").unwrap();
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.invalid");

        let mut metadata = disk_metadata("a/b.txt");
        metadata.name = "a/b.txt".to_string();
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.invalid");
    }

    #[test]
    fn refuses_a_locked_virtual_source() {
        let mut metadata = disk_metadata("notes.txt");
        metadata.source = DocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\Vault\\box.adpbox".to_string(),
            entry_id: Uuid::new_v4().to_string(),
        };
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.locked");
    }

    #[test]
    fn refuses_more_than_the_record_cap() {
        let mut metadata = disk_metadata("notes.txt");
        metadata.byte_len = MAX_RECORD_BYTES + 1;
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.too_large");
    }

    #[test]
    fn refuses_a_name_windows_cannot_create() {
        for name in ["CON.txt", "notes. ", "a\u{0}b.txt", "a:b.txt"] {
            let mut metadata = disk_metadata(name);
            metadata.name = name.to_string();
            assert_eq!(
                validate_metadata(&metadata).unwrap_err(),
                "recovery.invalid",
                "{name:?}"
            );
        }
    }

    fn stamp(path_key: &str) -> SourceStamp {
        SourceStamp {
            path_key: path_key.to_string(),
            volume_id: "00000000".to_string(),
            file_id: "0000000000000000".to_string(),
            modified_ticks: "1".to_string(),
            size_bytes: 1,
        }
    }

    #[test]
    fn a_source_stamp_must_describe_the_source_path() {
        let mut metadata = disk_metadata("notes.txt");
        metadata.source_stamp = Some(stamp("c:\\work\\notes.txt"));
        validate_metadata(&metadata).unwrap();

        metadata.source_stamp = Some(stamp("c:\\work\\other.txt"));
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.invalid");

        metadata.source_stamp = Some(stamp("c:\\work\\notes.txt"));
        metadata.source = DocumentRef::Draft {
            draft_id: Uuid::new_v4().to_string(),
        };
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.invalid");
    }

    #[test]
    fn a_draft_source_needs_a_uuid() {
        let mut metadata = disk_metadata("notes.txt");
        metadata.source = DocumentRef::Draft {
            draft_id: "not-a-uuid".to_string(),
        };
        assert_eq!(validate_metadata(&metadata).unwrap_err(), "recovery.invalid");
        metadata.source = DocumentRef::Draft {
            draft_id: Uuid::new_v4().to_string(),
        };
        validate_metadata(&metadata).unwrap();
    }

    #[test]
    fn path_and_kind_come_from_the_canonical_descriptor() {
        let metadata = disk_metadata("notes.txt");
        assert_eq!(metadata.original_path().as_deref(), Some("C:\\Work\\notes.txt"));
        assert_eq!(source_kind(&metadata.source), Some("disk"));
    }
}
