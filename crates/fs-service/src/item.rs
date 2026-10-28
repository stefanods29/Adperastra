use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Which backing store an item lives in (contract 8). Only `Real` exists in
/// Step 02; archives (06c) and encrypted containers (09e) plug in later
/// without changing `Item`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackingKind {
    Real,
    Archive,
    Container,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Folder,
    File,
    Drive,
    Other,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemAttrs {
    pub hidden: bool,
    pub system: bool,
    pub is_link: bool,
    /// Windows recall-on-data-access / offline attribute: background work
    /// must never read these files (it would trigger a cloud download).
    pub online_only: bool,
    /// Windows file ID from the directory enumeration, when the volume
    /// provides one. Only meaningful together with `file_id_stable`.
    pub file_id: Option<u64>,
    /// True only when `file_id` can be trusted across renames and time:
    /// NTFS/ReFS on a local drive. FAT/exFAT and network drives report
    /// false and callers (tags, Step 11b) must fall back to the path.
    pub file_id_stable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub path: PathBuf,
    pub name: String,
    pub kind: ItemKind,
    pub backing: BackingKind,
    /// File size in bytes; 0 for folders.
    pub size: u64,
    /// Seconds since the Unix epoch; 0 when unavailable.
    pub modified_unix: u64,
    pub attrs: ItemAttrs,
}
