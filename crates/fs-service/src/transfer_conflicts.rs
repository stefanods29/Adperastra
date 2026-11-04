//! Conflict records and the naming rules a copy uses when it must not
//! overwrite anything (Step 09f D6).
//!
//! A conflict record always carries *both* sides: the source the user chose
//! and the item that already sits at the destination, each with its full
//! source stamp. A later decision is only valid for those exact objects,
//! which is why every record carries the item id the UI echoes back.
//!
//! Keep both never publishes over a name. The name search below only
//! *proposes*; the actual publication is a no-replace rename, and a name
//! that arrives in between makes the engine choose the next one. That is the
//! difference between "we looked and it was free" and "it was free when we
//! took it".

use std::path::{Path, PathBuf};

use crate::SourceStamp;

/// Naming a copy takes at most this many probes, like the rest of the app.
pub const MAX_KEEP_BOTH_ATTEMPTS: u32 = 10_000;

/// Why a conflict could not be described.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictError {
    /// The conflict is not something this build can offer a choice for.
    Invalid,
    /// Every numbered name up to the limit is taken.
    Exhausted,
}

impl ConflictError {
    pub fn code(self) -> &'static str {
        match self {
            ConflictError::Invalid => "ops.invalid_request",
            ConflictError::Exhausted => "ops.exists",
        }
    }
}

/// What sits at a path: nothing is followed, a link is never a folder here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Folder,
}

impl EntryKind {
    pub fn as_code(self) -> &'static str {
        match self {
            EntryKind::File => "file",
            EntryKind::Folder => "folder",
        }
    }
}

/// The thumbnail state shown next to one side of a conflict.
///
/// The conflict window is read-only and never asks for a preview of an
/// online-only file, so a placeholder stays a placeholder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailState {
    /// No thumbnail provider claimed the file.
    Unavailable,
    /// A ready preview exists in the cache.
    Ready,
    /// The item is only in the cloud; showing it would download it.
    OnlineOnly,
}

impl ThumbnailState {
    pub fn as_code(self) -> &'static str {
        match self {
            ThumbnailState::Unavailable => "unavailable",
            ThumbnailState::Ready => "ready",
            ThumbnailState::OnlineOnly => "online_only",
        }
    }
}

/// One side of a conflict, as it was when the record was made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictSide {
    pub path: PathBuf,
    pub kind: EntryKind,
    /// Full-precision identity; the decision is bound to it (07a E9).
    pub stamp: SourceStamp,
    pub readonly: bool,
    pub thumbnail: ThumbnailState,
}

/// A name clash the user has to answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictRecord {
    /// The item this decision belongs to; the UI sends it back verbatim.
    pub item_id: uuid::Uuid,
    pub source: ConflictSide,
    pub target: ConflictSide,
    /// The default when the user just closes the window.
    pub default_choice: crate::conflict_policy::ConflictChoice,
    /// True only when both sides are folders; the UI offers Merge then.
    pub merge_allowed: bool,
}

/// True when the destination name is taken, using metadata only.
pub fn is_taken(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

/// Read what is at `path` without following a link or touching content.
pub fn entry_kind_at(path: &Path) -> Result<EntryKind, ConflictError> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| ConflictError::Invalid)?;
    if metadata.is_dir() {
        Ok(EntryKind::Folder)
    } else {
        Ok(EntryKind::File)
    }
}

/// Split `notes.tar.gz` into `("notes.tar", ".gz")`, like the engine does;
/// a leading dot is part of the name, not an extension.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    }
}

/// The numbered form the rest of the app uses for a new item:
/// `report (1).txt`, `report (2).txt`, ...
pub fn numbered_name(name: &str, number: u32) -> String {
    let (base, extension) = split_name(name);
    format!("{base} ({number}){extension}")
}

/// The first free name for a "keep both" copy, or `Exhausted`.
///
/// The answer is a proposal: publication is a no-replace rename, and a
/// collision then calls this again from the next number.
pub fn next_keep_both_name(
    directory: &Path,
    name: &str,
    from_number: u32,
) -> Result<String, ConflictError> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err(ConflictError::Invalid);
    }
    if from_number == 0 && !is_taken(&directory.join(name)) {
        return Ok(name.to_string());
    }
    let start = from_number.max(1);
    for number in start..start.saturating_add(MAX_KEEP_BOTH_ATTEMPTS) {
        let candidate = numbered_name(name, number);
        if !is_taken(&directory.join(&candidate)) {
            return Ok(candidate);
        }
    }
    Err(ConflictError::Exhausted)
}

/// What a merge does with one child whose name already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeChild {
    /// The name is free: copy the item (or create the folder).
    Copy,
    /// Both are folders: descend and merge their contents.
    RecurseFolder,
    /// Same name, not both folders: keep what is already there.
    SkipSameNamed,
    /// A file and a folder with the same name cannot be combined.
    SkipKindMismatch,
}

/// Merge never replaces a child. This is the only permitted outcome per
/// child name.
pub fn merge_child_action(
    target_exists: bool,
    source_is_folder: bool,
    target_is_folder: bool,
) -> MergeChild {
    if !target_exists {
        return MergeChild::Copy;
    }
    if source_is_folder && target_is_folder {
        MergeChild::RecurseFolder
    } else if source_is_folder == target_is_folder {
        MergeChild::SkipSameNamed
    } else {
        MergeChild::SkipKindMismatch
    }
}

/// A chosen name was taken between the probe and the no-replace publish.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishCollision {
    /// Keep both: try the next number; the existing item stays untouched.
    ChooseNextName,
    /// Skip and Merge keep what is already there and report the item.
    SkipItem,
}

/// The only reaction to a name that appeared underneath us. Nothing here
/// recycles, replaces or deletes the item that won the race.
pub fn on_publish_collision(choice: crate::conflict_policy::ConflictChoice) -> PublishCollision {
    match choice {
        crate::conflict_policy::ConflictChoice::KeepBoth => PublishCollision::ChooseNextName,
        crate::conflict_policy::ConflictChoice::Skip
        | crate::conflict_policy::ConflictChoice::Merge => PublishCollision::SkipItem,
    }
}

/// True when a stamp still names the item at `path`.
///
/// The engine uses it before acting on a decision; a mismatch is
/// `decision_stale` and the user reviews the conflict again.
pub fn stamp_matches_path(stamp: &SourceStamp, path: &Path) -> bool {
    let display = path.to_string_lossy();
    let trimmed = display.trim_start_matches(r"\\?\");
    normalize_key(&stamp.path_key) == normalize_key(trimmed)
}

/// Case-insensitive, separator-normalized comparison key. Stored path keys
/// and paths the UI shows differ only in those two ways.
pub fn normalize_key(text: &str) -> String {
    text.trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}

/// How many conflict previews one window may build, so a folder with a
/// million entries cannot fill memory before the user answers anything.
pub const MAX_CONFLICT_PREVIEWS: usize = 200;
/// Bytes of one conflict preview that may be held at once (one copy chunk).
pub const MAX_CONFLICT_PREVIEW_BYTES: usize = 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(key: &str) -> SourceStamp {
        SourceStamp {
            path_key: key.to_string(),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "00000000000000ff".to_string(),
            modified_ticks: "133500000000000000".to_string(),
            size_bytes: 4,
        }
    }

    #[test]
    fn numbered_names_match_the_rest_of_the_app() {
        assert_eq!(numbered_name("report.txt", 1), "report (1).txt");
        assert_eq!(numbered_name("report.tar.gz", 2), "report.tar (2).gz");
        assert_eq!(numbered_name(".gitignore", 1), ".gitignore (1)");
    }

    #[test]
    fn merge_never_replaces_a_same_named_child() {
        assert_eq!(merge_child_action(false, false, false), MergeChild::Copy);
        assert_eq!(
            merge_child_action(true, true, true),
            MergeChild::RecurseFolder
        );
        assert_eq!(
            merge_child_action(true, false, false),
            MergeChild::SkipSameNamed
        );
        assert_eq!(
            merge_child_action(true, true, false),
            MergeChild::SkipKindMismatch
        );
        assert_eq!(
            merge_child_action(true, false, true),
            MergeChild::SkipKindMismatch
        );
    }

    #[test]
    fn a_new_foreign_item_wins_and_is_never_replaced() {
        assert_eq!(
            on_publish_collision(crate::conflict_policy::ConflictChoice::KeepBoth),
            PublishCollision::ChooseNextName
        );
        assert_eq!(
            on_publish_collision(crate::conflict_policy::ConflictChoice::Merge),
            PublishCollision::SkipItem
        );
    }

    #[test]
    fn stamps_compare_after_path_normalization() {
        assert!(stamp_matches_path(
            &stamp(r"\\?\C:\A\b.txt"),
            Path::new("c:/a/B.txt")
        ));
        assert!(!stamp_matches_path(
            &stamp(r"C:\A\b.txt"),
            Path::new(r"C:\A\c.txt")
        ));
    }
}
