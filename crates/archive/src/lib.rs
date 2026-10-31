//! Archive reading for Adperastra (Step 06d): format detection, listings,
//! the browsing tree, extraction plans and safe extraction. Pure Rust, no
//! Tauri. Runs inside the archive helper process, never in the app itself.

pub mod entry;
pub mod error;
pub mod format;
pub mod limits;
pub mod path;
pub mod time;

pub use entry::{ArchiveEntry, ArchiveFormat, EntryKind, Listing, IMPLICIT_INDEX};
pub use error::ArchiveError;
pub use format::detect_format;
pub use limits::{check_bomb, check_space, free_bytes, Limits, CHUNK_BYTES, MAX_SKIPPED_REPORT};
pub use path::{
    first_component, is_root_entry, name_of, normalize_inner_path, parent_of, relative_to,
};
pub use time::dos_local_to_unix;
