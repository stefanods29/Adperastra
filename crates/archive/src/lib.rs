//! Archive reading for Adperastra (Step 06d): format detection, listings,
//! the browsing tree, extraction plans and safe extraction. Pure Rust, no
//! Tauri. Runs inside the archive helper process, never in the app itself.

pub mod entry;
pub mod error;
pub mod extract;
pub mod format;
pub mod limits;
pub mod list;
pub mod path;
pub mod plan;
mod read_7z;
mod read_bzip2;
pub mod read_options;
mod read_stream;
mod read_tar;
mod read_zip;
pub mod secure_extract;
mod secure_extract_7z;
mod secure_extract_paths;
mod secure_extract_readers;
mod secure_extract_zip;
pub mod time;
pub mod tree;
pub mod write;

pub use entry::{ArchiveEntry, ArchiveFormat, EntryKind, Listing, IMPLICIT_INDEX};
pub use error::ArchiveError;
pub use extract::{extract, extract_with_options, ExtractEvents, ExtractReport};
pub use format::detect_format;
pub use limits::{check_bomb, check_space, free_bytes, Limits, CHUNK_BYTES, MAX_SKIPPED_REPORT};
pub use list::{activity, list, list_with_options};
pub use path::{
    first_component, is_root_entry, name_of, normalize_inner_path, parent_of, relative_to,
};
pub use plan::{
    plan_extract, plan_extract_with_options, top_level_names, ArchiveFacts, ExtractPlan,
    ExtractRequest, PlannedEntry, SkippedEntry, MAX_EXTRACT_PATHS,
};
pub use read_options::ArchiveReadOptions;
pub use secure_extract::{extract_with_zone, needs_secure_route, FileZoneWriter, ZoneWriter};
pub use time::dos_local_to_unix;
pub use tree::{ArchiveTree, TreeStats};
pub use write::{write_entry, WriteFailure};
