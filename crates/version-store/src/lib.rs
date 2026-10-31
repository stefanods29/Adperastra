//! Local version store (contract 19, Step 06b).

mod cache;
mod coordination;
mod disk;
mod extraction;
mod listing;
mod pending;
mod retention;
mod session;
mod store;

pub use pending::snapshot_to_pending;
pub use session::VersionSession;
pub use store::VersionStore;

use serde::{Deserialize, Serialize};

/// Largest file a snapshot keeps, in bytes (256 MiB).
pub const MAX_SNAPSHOT_BYTES: u64 = 268_435_456;

/// Maximum uncompressed disk space kept in the read-only open-copy cache.
pub const MAX_OPEN_BYTES: u64 = 1_073_741_824;

/// Maximum disk space reserved by copies waiting for compression.
pub const MAX_PENDING_BYTES: u64 = 1_073_741_824;

/// Schema version of the store's index (`meta.schema_version`).
pub const STORE_SCHEMA: u32 = 1;

/// What can go wrong in the store. The UI translates each case.
#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    Sql(String),
    Io(String),
    NotFound,
    TooLarge,
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        StoreError::Sql(error.to_string())
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        StoreError::Io(error.to_string())
    }
}

/// One kept version of a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionInfo {
    pub id: i64,
    pub created_unix: u64,
    pub reason: String,
    pub size: u64,
    pub file_modified_unix: u64,
}

/// The key a file's versions are stored under: the display path without a
/// `\\?\` prefix, without trailing backslashes, in lower case.
pub fn path_key(path: &str) -> String {
    let trimmed = path.strip_prefix(r"\\?\").unwrap_or(path);
    trimmed.trim_end_matches('\\').to_lowercase()
}
