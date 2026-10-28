//! Item details for the Details pane (Step 03a): size, times, and
//! attributes read from the directory entry with `GetFileAttributesExW`.
//! The file itself is never opened, so selecting an online-only
//! placeholder never downloads it (rules.md section 6).

use crate::item::ItemKind;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemDetails {
    pub kind: ItemKind,
    /// Bytes for files; 0 for folders (folder sizes come in Step 11c).
    pub size: u64,
    pub created_unix: u64,
    pub modified_unix: u64,
    pub accessed_unix: u64,
    /// Stable attribute ids the UI translates (see `attribute_names`).
    pub attributes: Vec<String>,
}

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const ATTRIBUTE_NAMES: &[(u32, &str)] = &[
    (0x0000_0001, "read_only"),
    (0x0000_0002, "hidden"),
    (0x0000_0004, "system"),
    (0x0000_0020, "archive"),
    (0x0000_0100, "temporary"),
    (0x0000_0200, "sparse"),
    (0x0000_0400, "link"),
    (0x0000_0800, "compressed"),
    (0x0000_2000, "not_indexed"),
    (0x0000_4000, "encrypted"),
    (0x0008_0000, "always_available"),
];
/// Offline, recall-on-open, and recall-on-data-access: the bytes are not
/// on this PC.
const ONLINE_ONLY_MASK: u32 = 0x0000_1000 | 0x0004_0000 | 0x0040_0000;

/// Attribute ids in a fixed order, so the UI can list them predictably.
pub fn attribute_names(attributes: u32) -> Vec<String> {
    let mut names: Vec<String> = ATTRIBUTE_NAMES
        .iter()
        .filter(|(bit, _)| attributes & bit != 0)
        .map(|(_, name)| (*name).to_string())
        .collect();
    if attributes & ONLINE_ONLY_MASK != 0 {
        names.push("online_only".to_string());
    }
    names
}

/// Windows FILETIME (100 ns ticks since 1601) to Unix seconds; 0 when the
/// time is unset or earlier than 1970.
pub fn filetime_to_unix(ticks: u64) -> u64 {
    const UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
    ticks.saturating_sub(UNIX_EPOCH_TICKS) / 10_000_000
}

#[cfg(windows)]
pub fn item_details(path: &Path) -> Result<ItemDetails> {
    use crate::winpath::{long_path_wide, win32_error};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::Storage::FileSystem::{
        GetFileAttributesExW, GetFileExInfoStandard, WIN32_FILE_ATTRIBUTE_DATA,
    };

    let wide = long_path_wide(path);
    let mut data = WIN32_FILE_ATTRIBUTE_DATA::default();
    // SAFETY: `wide` is NUL-terminated and outlives the call; `data` is a
    // local of exactly the type GetFileExInfoStandard writes.
    unsafe {
        GetFileAttributesExW(
            PCWSTR(wide.as_ptr()),
            GetFileExInfoStandard,
            (&mut data as *mut WIN32_FILE_ATTRIBUTE_DATA).cast(),
        )
    }
    .map_err(win32_error)?;
    let ticks =
        |time: FILETIME| (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
    let attributes = data.dwFileAttributes;
    let is_dir = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    Ok(ItemDetails {
        kind: if is_dir {
            ItemKind::Folder
        } else {
            ItemKind::File
        },
        size: if is_dir {
            0
        } else {
            (u64::from(data.nFileSizeHigh) << 32) | u64::from(data.nFileSizeLow)
        },
        created_unix: filetime_to_unix(ticks(data.ftCreationTime)),
        modified_unix: filetime_to_unix(ticks(data.ftLastWriteTime)),
        accessed_unix: filetime_to_unix(ticks(data.ftLastAccessTime)),
        attributes: attribute_names(attributes),
    })
}

#[cfg(not(windows))]
pub fn item_details(path: &Path) -> Result<ItemDetails> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let metadata = std::fs::symlink_metadata(path)?;
    let unix = |time: std::io::Result<SystemTime>| {
        time.ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0)
    };
    let is_dir = metadata.is_dir();
    Ok(ItemDetails {
        kind: if is_dir {
            ItemKind::Folder
        } else {
            ItemKind::File
        },
        size: if is_dir { 0 } else { metadata.len() },
        created_unix: unix(metadata.created()),
        modified_unix: unix(metadata.modified()),
        accessed_unix: unix(metadata.accessed()),
        attributes: Vec::new(),
    })
}
