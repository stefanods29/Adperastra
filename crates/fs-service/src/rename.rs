//! Rename in place (Step 03a). A rename never replaces an existing item:
//! on Windows the move is made without `MOVEFILE_REPLACE_EXISTING`, so a
//! name clash fails cleanly instead of overwriting the other file.

use crate::list::validate_new_name;
use crate::{FsError, Result};
use std::path::{Path, PathBuf};

/// Rename `path` to `new_name` inside the same folder and return the new
/// path (in the same form as `path`). Renaming to the current name is a
/// no-op; a case-only change (`notes.txt` to `Notes.txt`) is allowed.
pub fn rename_in_place(path: &Path, new_name: &str) -> Result<PathBuf> {
    validate_new_name(new_name)?;
    if !path.is_absolute() {
        return Err(FsError::Validation("path must be absolute".to_string()));
    }
    let (Some(parent), Some(old_name)) = (path.parent(), path.file_name()) else {
        return Err(FsError::Validation(
            "a drive or share root cannot be renamed".to_string(),
        ));
    };
    if old_name.to_string_lossy() == new_name {
        return Ok(path.to_path_buf());
    }
    let target = parent.join(new_name);
    move_without_replacing(path, &target)?;
    Ok(target)
}

#[cfg(windows)]
fn move_without_replacing(from: &Path, to: &Path) -> Result<()> {
    use crate::winpath::{long_path_wide, win32_error};
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

    let from_wide = long_path_wide(from);
    let to_wide = long_path_wide(to);
    // SAFETY: both buffers are NUL-terminated and outlive the call. No
    // flags: the move fails if the target exists, and never copies.
    unsafe {
        MoveFileExW(
            PCWSTR(from_wide.as_ptr()),
            PCWSTR(to_wide.as_ptr()),
            MOVE_FILE_FLAGS(0),
        )
    }
    .map_err(win32_error)
}

#[cfg(not(windows))]
fn move_without_replacing(from: &Path, to: &Path) -> Result<()> {
    if to.symlink_metadata().is_ok() {
        return Err(FsError::Io(std::io::Error::from(
            std::io::ErrorKind::AlreadyExists,
        )));
    }
    Ok(std::fs::rename(from, to)?)
}

/// Short, stable reason for a failed rename; the UI turns it into a
/// translated message (`errors.rename.<reason>`).
pub fn rename_error_reason(error: &FsError) -> &'static str {
    match error {
        FsError::Validation(_) => "invalid_name",
        FsError::Io(io) => match io.raw_os_error() {
            // ERROR_FILE_EXISTS, ERROR_ALREADY_EXISTS
            Some(80) | Some(183) => "exists",
            // ERROR_ACCESS_DENIED
            Some(5) => "access_denied",
            // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
            Some(32) | Some(33) => "in_use",
            // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND
            Some(2) | Some(3) => "not_found",
            // ERROR_FILENAME_EXCED_RANGE
            Some(206) => "too_long",
            _ if io.kind() == std::io::ErrorKind::AlreadyExists => "exists",
            _ => "other",
        },
        _ => "other",
    }
}
