//! Canonical locked-container data shapes (Step 09k, `locked-container-1`).
//! The TypeScript mirror is `src/services/lockedFolders.ts`.
//!
//! A container entry carries no OS path. Names, parents and chunk identities
//! live only in the authenticated encrypted index; the outer ZIP exposes
//! only UUIDs, fixed entry names and approximate sizes.

use age::secrecy::SecretString;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

pub use crate::error::{LockedError, LockedResult};
pub use crate::limits::CONTAINER_SCHEMA_VERSION;

fn default_schema() -> u32 {
    crate::limits::CONTAINER_SCHEMA_VERSION
}

/// A secret string on the wire: readable only through the explicit serde
/// field helpers, redacted by `Debug`, zeroized on drop.
pub fn deserialize_secret_string<'de, D>(deserializer: D) -> Result<SecretString, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    Ok(SecretString::from(value))
}

mod secret_string {
    use super::*;
    use age::secrecy::ExposeSecret;

    pub fn serialize<S>(value: &SecretString, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(value.expose_secret())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<SecretString, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(SecretString::from(String::deserialize(deserializer)?))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LockedEntryKind {
    File,
    Folder,
}

/// One file or folder inside the encrypted index. `name` is a single
/// Windows component; `parent_id` `None` is the single implicit root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedEntry {
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub kind: LockedEntryKind,
    pub mime: String,
    pub size: u64,
    pub modified_unix: u64,
    #[serde(default)]
    pub chunks: Vec<Uuid>,
    #[serde(default)]
    pub from_internet: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub system: bool,
    #[serde(default)]
    pub read_only: bool,
}

impl LockedEntry {
    pub fn is_file(&self) -> bool {
        self.kind == LockedEntryKind::File
    }

    pub fn is_folder(&self) -> bool {
        self.kind == LockedEntryKind::Folder
    }

    /// An entry can enter the editable memory model only below this size.
    pub fn editable(&self) -> bool {
        self.is_file() && self.size <= crate::limits::MAX_EDITABLE_ENTRY_BYTES
    }
}

/// One encrypted chunk. Hashes are structural hints and are checked again
/// next to the age final tag; they never replace authentication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedChunk {
    pub id: Uuid,
    pub cipher_sha256: String,
    pub plain_sha256: String,
    pub plain_len: u32,
}

/// The encrypted index plaintext.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedIndex {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    pub container_id: Uuid,
    pub revision: u64,
    pub entries: Vec<LockedEntry>,
    pub chunk_records: Vec<LockedChunk>,
}

impl LockedIndex {
    pub fn empty(container_id: Uuid, revision: u64) -> Self {
        Self {
            schema_version: crate::limits::CONTAINER_SCHEMA_VERSION,
            container_id,
            revision,
            entries: Vec::new(),
            chunk_records: Vec::new(),
        }
    }
}

/// The plain outer header. It names no original file and no secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedHeader {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    pub container_id: Uuid,
    pub content_recipient: String,
    pub created_unix: u64,
    pub chunk_count: u32,
    pub index_cipher_sha256: String,
    pub password_slot_sha256: String,
    pub recovery_slot_sha256: String,
}

/// What both key slots encrypt (each in its own standard age file).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedKeySlotPayload {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    pub container_id: Uuid,
    pub content_recipient: String,
    #[serde(with = "secret_string")]
    pub container_secret: SecretString,
}

/// The explicit, separately stored recovery file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedRecoveryFile {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    pub container_id: Uuid,
    #[serde(with = "secret_string")]
    pub recovery_secret: SecretString,
    pub recovery_recipient: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockedSessionState {
    Unlocked,
    Saving,
    LockPending,
    Locked,
}

/// What every UI session shows. `can_save_existing` is fixed false while
/// Step 09f has no object-bound recycle-first replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedSession {
    pub session_id: Uuid,
    pub container_path: String,
    pub container_id: Uuid,
    pub revision: u64,
    pub entry_count: u32,
    pub dirty: bool,
    pub state: LockedSessionState,
    pub pending_recovery: bool,
    pub can_save_existing: bool,
    pub can_save_copy: bool,
}

impl LockedSession {
    pub fn unlocked(
        session_id: Uuid,
        container_path: String,
        container_id: Uuid,
        revision: u64,
        entry_count: u32,
    ) -> Self {
        Self {
            session_id,
            container_path,
            container_id,
            revision,
            entry_count,
            dirty: false,
            state: LockedSessionState::Unlocked,
            pending_recovery: false,
            can_save_existing: false,
            can_save_copy: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedEntryPage {
    pub entries: Vec<LockedEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub session_id: Uuid,
    pub revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LockedCreateRequest {
    pub source_dir: String,
    pub dest_path: String,
    #[serde(deserialize_with = "deserialize_secret_string")]
    pub password: SecretString,
    pub recovery_dest_path: String,
    pub keep_original: bool,
    pub confirm_original_unprotected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LockedCredential {
    Password {
        #[serde(deserialize_with = "deserialize_secret_string")]
        value: SecretString,
    },
    Recovery {
        recovery_path: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct LockedUnlockRequest {
    pub path: String,
    pub credential: LockedCredential,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedCreateResult {
    pub path: String,
    pub container_id: Uuid,
    pub recovery_path: String,
    pub original_kept: bool,
    /// Entries the source walk refused (links, cloud placeholders, denied
    /// items). `0` means the whole folder was included.
    #[serde(default)]
    pub skipped: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedCopyRequest {
    pub session_id: Uuid,
    pub dest_path: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedCopyResult {
    pub path: String,
    pub container_id: Uuid,
    pub revision: u64,
    pub original_kept: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockRequestMode {
    Normal,
    Idle,
    Workstation,
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockRequest {
    pub session_id: Uuid,
    pub mode: LockRequestMode,
    #[serde(default)]
    pub discard_dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockResult {
    pub locked: bool,
    pub state: LockedSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedPersistRequest {
    pub session_id: Uuid,
    pub entry_id: Uuid,
    pub snapshot_id: Uuid,
    pub expected_container_revision: u64,
    pub captured_revision: u64,
    pub content_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedPersistResult {
    pub session_id: Uuid,
    pub entry_id: Uuid,
    pub container_revision: u64,
    pub captured_revision: u64,
    pub content_id: Uuid,
    pub pending_id: Uuid,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedGrantReply {
    pub token: String,
    pub length: u64,
    pub mime: String,
    pub name: String,
    pub size: u64,
    pub modified_unix: u64,
    pub from_internet: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedRecoveryItem {
    pub id: Uuid,
    pub revision: u64,
    pub created_unix: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockedRecoveryAction {
    Recover,
    UseOriginal,
    Later,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedSettings {
    #[serde(default = "default_auto_lock_minutes")]
    pub auto_lock_minutes: u32,
    #[serde(default = "default_true")]
    pub lock_on_workstation: bool,
}

fn default_auto_lock_minutes() -> u32 {
    5
}

fn default_true() -> bool {
    true
}

impl Default for LockedSettings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: default_auto_lock_minutes(),
            lock_on_workstation: true,
        }
    }
}

impl LockedSettings {
    pub fn validate(&self) -> LockedResult<()> {
        if !matches!(self.auto_lock_minutes, 0 | 1 | 5 | 15 | 30) {
            return Err(LockedError::Invalid);
        }
        Ok(())
    }
}

/// A deterministic, non-cryptographic content identity for the JS model is
/// not part of this crate; native content ids arrive as UUIDs from 09a.
pub fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
