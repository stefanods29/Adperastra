//! Encrypted locked-folder containers (Step 09k, `locked-container-1`).
//!
//! Standard age only: one X25519 content identity, one independent X25519
//! recovery identity, a separate scrypt password slot and a separate X25519
//! recovery slot. The outer `.adplock` file is a ZIP64 of stored entries with
//! fixed names; all original names and relationships live in the
//! authenticated encrypted index. Nothing here writes plaintext to disk.
//!
//! The crate never calls Tauri and never prints a secret. Native code owns
//! paths, tokens, window checks and user-facing codes.

pub mod chunks;
pub mod create;
pub mod crypto;
pub mod error;
pub mod format;
pub mod generations;
pub mod index;
pub mod keyslots;
pub mod lifecycle;
pub mod limits;
pub mod open;
pub mod pending;
pub mod recovery_key;
pub mod sources;
pub mod types;
pub mod validation;
pub mod verify;

pub use age::secrecy;
pub use create::{create_locked_copy, create_locked_copy_with_limits, CreateDeps};
pub use error::{LockedError, LockedResult};
pub use format::{ContainerFile, ContainerParts, StreamingContainer};
pub use generations::{write_generation, ChangeSet, Generation};
pub use limits::Limits;
pub use open::{unlock_with_password, unlock_with_recovery, OpenedContainer};
pub use pending::{PendingCapture, PendingRecord, PendingStore};
pub use types::*;

/// Pinned dependency metadata, checked by `step09k_metadata_tests`.
pub const AGE_VERSION: &str = "0.12.1";
pub const AGE_LICENSE: &str = "MIT OR Apache-2.0";
pub const ZEROIZE_VERSION: &str = "1.9.1";
pub const ZEROIZE_LICENSE: &str = "MIT OR Apache-2.0";
pub const FORMAT_DOCUMENT: &str = "docs/formats/locked-container-v1.md";
pub const INTERFACE_REVISION: &str = "locked-container-1";
