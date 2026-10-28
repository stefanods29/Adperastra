use crate::item::{BackingKind, Item, ItemAttrs, ItemKind};
use crate::sort::{sort_items, SortSpec};
use crate::{FsError, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

/// Longest path string accepted from any caller (Windows long-path limit).
pub const MAX_PATH_INPUT: usize = 32767;
/// Largest single `read_range` result; parsers stream beyond this.
pub const MAX_READ_RANGE: usize = 8 * 1024 * 1024;

pub type CancellationToken = Arc<AtomicBool>;

pub fn new_cancellation_token() -> CancellationToken {
    Arc::new(AtomicBool::new(false))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListIssue {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Listing {
    pub path: PathBuf,
    pub items: Vec<Item>,
    /// Entries that could not be read (access denied, vanished mid-list).
    /// Listing continues past them (rules.md section 6).
    pub skipped: Vec<ListIssue>,
}

/// Reject empty or absurdly long path strings before any disk access.
/// Every path coming from the UI passes through here first.
pub fn validate_path_input(path: &str) -> Result<()> {
    if path.trim().is_empty() {
        return Err(FsError::Validation("path is empty".to_string()));
    }
    if path.chars().count() > MAX_PATH_INPUT {
        return Err(FsError::Validation("path is too long".to_string()));
    }
    Ok(())
}

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validate a name the app would create (rules.md section 6): rejects
/// Windows reserved device names, trailing dots/spaces, and separators.
pub fn validate_new_name(name: &str) -> Result<()> {
    if name.is_empty() || name.trim() != name {
        return Err(FsError::Validation(
            "name is empty or has surrounding spaces".to_string(),
        ));
    }
    if name.ends_with('.') {
        return Err(FsError::Validation(
            "name must not end with a dot".to_string(),
        ));
    }
    if name.chars().any(|c| {
        matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
    }) {
        return Err(FsError::Validation(
            "name contains a character Windows does not allow".to_string(),
        ));
    }
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED_NAMES.contains(&base.as_str()) {
        return Err(FsError::Validation(format!(
            "{base} is a reserved Windows name"
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn windows_attrs(metadata: &fs::Metadata) -> (u32, Option<u64>) {
    use std::os::windows::fs::MetadataExt;
    // `file_index()` is unstable in std; the stable file ID is filled in by
    // the Slice 2 stat command via GetFileInformationByHandle (foreground
    // only, so listing never opens files it does not need).
    (metadata.file_attributes(), None)
}

#[cfg(not(windows))]
fn windows_attrs(_metadata: &fs::Metadata) -> (u32, Option<u64>) {
    (0, None)
}

// Windows file-attribute bits that mean "bytes are not on this PC".
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;

pub fn item_from_metadata(path: &Path, metadata: &fs::Metadata) -> Item {
    let file_type = metadata.file_type();
    let kind = if file_type.is_dir() {
        ItemKind::Folder
    } else if file_type.is_file() {
        ItemKind::File
    } else {
        ItemKind::Other
    };
    let (raw_attrs, file_id) = windows_attrs(metadata);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    Item {
        path: path.to_path_buf(),
        name,
        kind,
        backing: BackingKind::Real,
        size: if kind == ItemKind::File {
            metadata.len()
        } else {
            0
        },
        modified_unix: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        attrs: ItemAttrs {
            hidden: raw_attrs & FILE_ATTRIBUTE_HIDDEN != 0,
            system: raw_attrs & FILE_ATTRIBUTE_SYSTEM != 0,
            is_link: file_type.is_symlink(),
            online_only: raw_attrs
                & (FILE_ATTRIBUTE_OFFLINE
                    | FILE_ATTRIBUTE_RECALL_ON_OPEN
                    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
                != 0,
            file_id,
            file_id_stable: false,
        },
    }
}

/// List one folder (never recursive, so link loops cannot form), sorted as
/// requested. Unreadable entries are reported in `skipped`, not fatal.
pub fn list_dir_std(path: &Path, sort: SortSpec) -> Result<Listing> {
    list_dir_std_inner(path, sort, None)
}

fn list_dir_std_inner(
    path: &Path,
    sort: SortSpec,
    token: Option<&CancellationToken>,
) -> Result<Listing> {
    validate_path_input(&path.to_string_lossy())?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Err(FsError::Validation(format!(
            "{} is not a folder",
            path.display()
        )));
    }
    let mut items = Vec::new();
    let mut skipped = Vec::new();
    let mut seen = 0usize;
    for entry in fs::read_dir(path)? {
        seen += 1;
        if seen % 512 == 0 {
            if let Some(token) = token {
                if token.load(Ordering::Relaxed) {
                    return Err(FsError::Cancelled);
                }
            }
        }
        match entry {
            Ok(entry) => match entry.metadata() {
                Ok(md) => items.push(item_from_metadata(&entry.path(), &md)),
                Err(e) => skipped.push(ListIssue {
                    path: entry.path(),
                    message: e.to_string(),
                }),
            },
            Err(e) => skipped.push(ListIssue {
                path: path.to_path_buf(),
                message: e.to_string(),
            }),
        }
    }
    sort_items(&mut items, sort);
    Ok(Listing {
        path: path.to_path_buf(),
        items,
        skipped,
    })
}

/// Whether a volume's file IDs can be trusted as stable keys: NTFS and
/// ReFS on local drives only. FAT generates IDs from directory-entry
/// offsets (they change after defragmentation), exFAT is similar, and
/// network drives answer for a file system we cannot verify - tags
/// (Step 11b) fall back to the path in all those cases.
/// Source: Microsoft Learn, FILE_ID_BOTH_DIR_INFO remarks
/// (https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_both_dir_info).
pub fn file_id_is_stable(filesystem: &str, is_remote: bool) -> bool {
    !is_remote
        && matches!(
            filesystem.trim().to_ascii_uppercase().as_str(),
            "NTFS" | "REFS"
        )
}

/// List one folder, filling file IDs from the directory enumeration
/// itself on Windows (`list_dir_with_ids`); falls back to `list_dir_std`
/// when the fast enumeration is unavailable on a volume.
pub fn list_dir(path: &Path, sort: SortSpec) -> Result<Listing> {
    match crate::winlist::list_dir_with_ids(path, sort) {
        Ok(listing) => Ok(listing),
        Err(_) => list_dir_std(path, sort),
    }
}

/// Like `list_dir`, but the enumeration itself honours the cancellation
/// token (checked between directory buffers/entries), so navigating away
/// stops the work instead of merely discarding its result. A cancelled
/// enumeration never falls back to a second full listing.
pub fn list_dir_cancellable(
    path: &Path,
    sort: SortSpec,
    token: &CancellationToken,
) -> Result<Listing> {
    match crate::winlist::list_dir_with_ids_cancellable(path, sort, token) {
        Ok(listing) => Ok(listing),
        Err(FsError::Cancelled) => Err(FsError::Cancelled),
        Err(_) => list_dir_std_inner(path, sort, Some(token)),
    }
}

/// List, then deliver the sorted items in batches, checking `token`
/// between batches. Slice 2 streams these batches to the UI.
pub fn list_dir_batched(
    path: &Path,
    sort: SortSpec,
    batch_size: usize,
    token: &CancellationToken,
    mut on_batch: impl FnMut(&[Item]),
) -> Result<Listing> {
    let listing = list_dir_cancellable(path, sort, token)?;
    let batch_size = batch_size.max(1);
    for chunk in listing.items.chunks(batch_size) {
        if token.load(Ordering::Relaxed) {
            return Err(FsError::Cancelled);
        }
        on_batch(chunk);
    }
    Ok(listing)
}

pub fn stat_path(path: &Path) -> Result<Item> {
    validate_path_input(&path.to_string_lossy())?;
    let metadata = fs::symlink_metadata(path)?;
    Ok(item_from_metadata(path, &metadata))
}

/// Read at most `MAX_READ_RANGE` bytes starting at `offset`. Never loads a
/// whole file to show a first screen (rules.md section 4, speed.md).
pub fn read_range(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>> {
    validate_path_input(&path.to_string_lossy())?;
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(FsError::Validation(format!(
            "{} is not a file",
            path.display()
        )));
    }
    let mut file = fs::File::open(&canonical)?;
    file.seek(SeekFrom::Start(offset))?;
    let capped = len.min(MAX_READ_RANGE) as u64;
    let mut buffer = Vec::with_capacity(capped.min(64 * 1024) as usize);
    file.take(capped).read_to_end(&mut buffer)?;
    Ok(buffer)
}
