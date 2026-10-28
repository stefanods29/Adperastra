//! File-system service core for Adperastra (Step 02, contract 8).
//!
//! Pure logic only: listing, sorting, path validation, folder watching and
//! Explorer state. The Tauri app (Slice 2) wraps these in validated
//! commands; later backing stores (archives 06c, containers 09e) reuse the
//! same `Item` shape through `BackingKind`.

pub mod details;
pub mod item;
pub mod list;
pub mod ops;
pub mod rename;
pub mod sort;
pub mod state;
pub mod watch;
pub mod winlist;
#[cfg(windows)]
mod winpath;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("operation cancelled")]
    Cancelled,
}

pub type Result<T> = std::result::Result<T, FsError>;

pub use details::{attribute_names, filetime_to_unix, item_details, ItemDetails};
pub use item::{BackingKind, Item, ItemAttrs, ItemKind};
pub use list::{
    file_id_is_stable, list_dir, list_dir_batched, list_dir_cancellable, list_dir_std,
    new_cancellation_token, read_range, stat_path, validate_new_name, validate_path_input,
    CancellationToken, ListIssue, Listing, MAX_PATH_INPUT, MAX_READ_RANGE,
};
pub use ops::{
    check_conflicts, copy_items, create_item, delete_permanently, move_items, op_error_reason,
    recycle_items, restore_bin_items, restore_items, unique_destination, CompletedItem,
    ConflictPolicy, CreateKind, OpProgress, OpReport, ReplacedItem, SkippedItem,
};
pub use rename::{rename_error_reason, rename_in_place};
pub use sort::{natural_cmp, sort_items, SortDirection, SortKey, SortSpec};
pub use state::{atomic_write, ExplorerState};
pub use watch::{coalesce_events, FsEvent, FsEventKind, FsWatcher, MAX_WATCH_BATCH};
pub use winlist::list_dir_with_ids;
