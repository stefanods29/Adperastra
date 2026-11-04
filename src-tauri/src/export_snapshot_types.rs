//! Wire types for immutable editor snapshots (Step 08a T2,
//! `export-snapshot-2`). The TypeScript mirror is
//! `src/services/exportSnapshots.ts`.

use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Largest one snapshot may become.
pub const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
/// Shared budget across live snapshots and their leases.
pub const MAX_SNAPSHOT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// Largest accepted upload chunk.
pub const MAX_SNAPSHOT_CHUNK: usize = 1024 * 1024;
/// Longest document display name, in UTF-16 units.
pub const MAX_SNAPSHOT_NAME: usize = 255;
/// Longest MIME string.
pub const MAX_SNAPSHOT_MIME: usize = 128;
/// Most capture MIME types granted to one authority.
pub const MAX_CAPTURE_MIMES: usize = 16;
/// Live authorities the native registry keeps.
pub const MAX_SNAPSHOT_AUTHORITIES: usize = 200;
/// An upload with no append for this long is refused.
pub const SNAPSHOT_UPLOAD_IDLE_SECS: u64 = 300;
/// A snapshot with no lease for this long is cleaned up.
pub const SNAPSHOT_LEASE_IDLE_SECS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoragePolicy {
    Ordinary,
    Sensitive,
}

/// The authority a view receives before it captures anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotAuthority {
    pub document_id: Uuid,
    pub name: String,
    pub mime: String,
    pub storage_policy: StoragePolicy,
}

/// What an editor asks the native parent to start receiving.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotBeginRequest {
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub mime: String,
    pub byte_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceStamp>,
}

/// The upload token and ID for one bounded capture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotBeginReply {
    pub snapshot_id: String,
    pub upload_token: String,
}

/// One finalized immutable capture. There is no path or raw byte field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportSnapshot {
    pub snapshot_id: String,
    pub document_id: String,
    pub revision: u64,
    pub content_id: Uuid,
    pub mime: String,
    pub byte_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceStamp>,
    pub storage_policy: StoragePolicy,
    pub expires_unix: u64,
}

/// A name the native provider may issue: one to 255 UTF-16 units, no
/// control characters, no path separator and no reserved device name.
pub fn valid_snapshot_name(name: &str) -> bool {
    let units = name.encode_utf16().count();
    if units == 0 || units > MAX_SNAPSHOT_NAME {
        return false;
    }
    if name
        .chars()
        .any(|character| character.is_control() || matches!(character, '/' | '\\' | ':'))
    {
        return false;
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return false;
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    !matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// A MIME is 1 to 128 printable ASCII characters.
pub fn valid_snapshot_mime(mime: &str) -> bool {
    !mime.is_empty()
        && mime.len() <= MAX_SNAPSHOT_MIME
        && mime
            .bytes()
            .all(|byte| byte.is_ascii() && !byte.is_ascii_control())
}

/// A token is exactly 32 lower-case hex characters.
pub fn valid_upload_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Seconds since the Unix epoch.
pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}
