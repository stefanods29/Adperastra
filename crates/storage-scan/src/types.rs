//! Canonical storage-scan DTOs (Step 11c, `storage-scan-1`).
//!
//! A native `StorageNode` is one metadata record, never a recursive tree:
//! the UI receives at most 256 nodes per page. Counts and byte sizes are
//! checked nonnegative `u64` values that fit the JSON safe integer range;
//! identifiers cross IPC as UUID strings. File identities are the canonical
//! `FileIdentityKey` from `fs-service` (Step 07a E9), never a second type.

use fs_service::FileIdentityKey;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};
use thiserror::Error;

use crate::limits::{MAX_ENTRIES, MAX_SAFE_INTEGER, MAX_SCAN_PATH_UTF16};

/// A scan request from the UI. Paths are validated again in every command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageScanRequest {
    /// Absolute folder or drive root.
    pub root: String,
    /// A network root is refused unless the user explicitly allowed it.
    #[serde(default)]
    pub allow_network: bool,
    /// Follow the View setting; hidden entries are omitted when false.
    #[serde(default)]
    pub include_hidden: bool,
    /// Fixed at 1,000,000. No caller may raise it.
    #[serde(default = "default_max_entries")]
    pub max_entries: u32,
}

fn default_max_entries() -> u32 {
    MAX_ENTRIES
}

impl Default for StorageScanRequest {
    fn default() -> Self {
        Self {
            root: String::new(),
            allow_network: false,
            include_hidden: false,
            max_entries: MAX_ENTRIES,
        }
    }
}

impl StorageScanRequest {
    /// Strict validation shared by the command and the scanner.
    pub fn validate(&self) -> Result<(), StorageError> {
        if self.root.is_empty()
            || self.root.encode_utf16().count() > MAX_SCAN_PATH_UTF16
            || self.root.len() > MAX_SCAN_PATH_UTF16
        {
            return Err(StorageError::Invalid);
        }
        let path = Path::new(&self.root);
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(StorageError::Invalid);
        }
        if self.max_entries != MAX_ENTRIES {
            return Err(StorageError::Invalid);
        }
        Ok(())
    }

    /// The validated option part of the cache key. Never a raw JSON blob.
    pub fn options_key(&self) -> String {
        format!(
            "allow_network={};include_hidden={};max_entries={}",
            self.allow_network, self.include_hidden, self.max_entries
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageNodeKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    Complete,
    Partial,
}

impl Coverage {
    pub fn is_complete(self) -> bool {
        matches!(self, Coverage::Complete)
    }

    pub fn partial_if(incomplete: bool) -> Self {
        if incomplete {
            Coverage::Partial
        } else {
            Coverage::Complete
        }
    }
}

/// One item in the bounded storage tree. `item_count` counts every
/// descendant entry (files and folders); `children_count` counts the direct
/// children. Folders carry the logical total of their descendants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub key: FileIdentityKey,
    pub path: String,
    pub name: String,
    pub kind: StorageNodeKind,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub item_count: u32,
    pub online_only: bool,
    pub coverage: Coverage,
    pub children_count: u32,
}

/// The summary of one scan. `stale` means the shown page comes from a cached
/// scan while a refresh is still running; it is never reported as current.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageSummary {
    pub scan_id: String,
    pub root: String,
    pub logical_bytes: u64,
    pub allocated_unique_bytes: Option<u64>,
    pub unknown_allocated_count: u32,
    pub files_count: u32,
    pub folders_count: u32,
    pub link_count: u32,
    pub skipped_count: u32,
    pub coverage: Coverage,
    pub cancelled: bool,
    pub stale: bool,
    pub generation: u64,
    pub calculated_unix: u64,
    pub reason_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TypeBreakdown {
    pub kind: String,
    pub count: u32,
    pub logical_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoragePage {
    pub summary: StorageSummary,
    pub nodes: Vec<StorageNode>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub typed_breakdown: Vec<TypeBreakdown>,
}

/// Duplicate review request (Step 11c E2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateRequest {
    /// 1 to 32 absolute folders.
    pub roots: Vec<String>,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub allow_network: bool,
    #[serde(default)]
    pub minimum_bytes: u64,
}

impl DuplicateRequest {
    pub fn validate(&self) -> Result<(), StorageError> {
        if self.roots.is_empty() || self.roots.len() > crate::limits::MAX_DUPLICATE_ROOTS {
            return Err(StorageError::Invalid);
        }
        if self.minimum_bytes > MAX_SAFE_INTEGER {
            return Err(StorageError::Invalid);
        }
        for root in &self.roots {
            if root.is_empty()
                || root.encode_utf16().count() > MAX_SCAN_PATH_UTF16
                || root.len() > MAX_SCAN_PATH_UTF16
            {
                return Err(StorageError::Invalid);
            }
            let path = Path::new(root);
            if !path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, Component::ParentDir))
            {
                return Err(StorageError::Invalid);
            }
        }
        Ok(())
    }
}

/// One physical file of a duplicate group. Hard-link aliases are collapsed
/// into `paths`, which is why this is a physical member and not a path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateMember {
    pub key: FileIdentityKey,
    pub source: fs_service::SourceStamp,
    /// 1 to 256 hard-link aliases of the same physical file.
    pub paths: Vec<String>,
    /// Lower-case hex BLAKE3 of the whole file.
    pub full_hash: String,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub modified_unix: u64,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateGroup {
    pub id: String,
    pub members: Vec<DuplicateMember>,
    pub member_count: u32,
    pub members_page_complete: bool,
    pub verified: bool,
    pub reclaimable_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicatePage {
    pub scan_id: String,
    pub groups: Vec<DuplicateGroup>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub skipped_count: u32,
    pub coverage: Coverage,
    /// False until an exact approved-object recycle operation is proved.
    pub cleanup_available: bool,
}

/// One native plan binding. Stamps and hashes stay in the native plan and
/// are never serialized to the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanBinding {
    pub key: FileIdentityKey,
    pub source: fs_service::SourceStamp,
    pub full_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateCleanupPlan {
    pub plan_id: String,
    pub scan_id: String,
    pub generation: u64,
    pub selected: Vec<FileIdentityKey>,
    pub keepers: Vec<FileIdentityKey>,
    pub expires_unix: u64,
    /// Native-only expectations; never serialized.
    #[serde(skip)]
    pub expected_selected: Vec<PlanBinding>,
    #[serde(skip)]
    pub expected_keepers: Vec<PlanBinding>,
}

/// The canonical failure codes of this area. Rust never returns display
/// text (rules R-LANG-7).
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("invalid storage request")]
    Invalid,
    #[error("storage limit reached")]
    Limit,
    #[error("the storage source changed")]
    Changed,
    #[error("the storage location is unavailable")]
    Unavailable,
    #[error("the storage task failed: {0}")]
    Failed(String),
}

impl StorageError {
    pub fn code(&self) -> &'static str {
        match self {
            StorageError::Invalid => "storage.invalid",
            StorageError::Limit => "storage.limit",
            StorageError::Changed => "storage.changed",
            StorageError::Unavailable => "storage.unavailable",
            StorageError::Failed(_) => "storage.failed",
        }
    }
}

/// Check a serialized count/byte value before it crosses the JSON wire.
pub fn checked_safe(value: u64) -> Result<u64, StorageError> {
    if value <= MAX_SAFE_INTEGER {
        Ok(value)
    } else {
        Err(StorageError::Invalid)
    }
}
