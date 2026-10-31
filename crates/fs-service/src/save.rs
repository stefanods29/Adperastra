//! Safe save of a file's new content (Step 06a): partial file, flush, then
//! replace. Never writes the target halfway (R-SAFE-3).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// What the caller last saw on disk: a save is refused when either value
/// changed (the file was edited by another program).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveExpect {
    pub modified_unix: u64,
    pub size: u64,
}

/// Why a save could not happen. The UI translates each one.
#[derive(Debug, PartialEq, Eq)]
pub enum SaveError {
    ChangedOnDisk,
    ReadOnly,
    InUse,
    FolderMissing,
    TargetExists,
    RecycleFailed,
    Io(String),
}

/// The target's size and modified time after a successful save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedInfo {
    pub size: u64,
    pub modified_unix: u64,
}

/// Send an existing target to the Recycle Bin (Save as over an existing
/// file, R-SAFE-2). A missing target is fine.
pub fn recycle_target(target: &Path) -> Result<(), SaveError> {
    match target.try_exists() {
        Ok(false) => Ok(()),
        Ok(true) => trash::delete(target).map_err(|_| SaveError::RecycleFailed),
        Err(_) => Err(SaveError::RecycleFailed),
    }
}

/// The temporary file written next to the target: `~name.partial`.
pub fn partial_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    target.with_file_name(format!("~{name}.partial"))
}

/// Replace a file's content: write the partial file, flush it, then swap it
/// in. When the target is missing it is written by renaming the partial
/// file into place.
pub fn replace_contents(
    target: &Path,
    bytes: &[u8],
    expect: Option<SaveExpect>,
) -> Result<SavedInfo, SaveError> {
    let exists = target.try_exists().unwrap_or(false);
    if exists {
        let meta = std::fs::metadata(target).map_err(|error| io_error(error))?;
        if meta.permissions().readonly() {
            return Err(SaveError::ReadOnly);
        }
        if let Some(expect) = expect {
            if modified_unix(&meta) != expect.modified_unix || meta.len() != expect.size {
                return Err(SaveError::ChangedOnDisk);
            }
        }
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(SaveError::FolderMissing);
    }
    let partial = partial_path(target);
    write_partial(&partial, bytes)?;
    if exists {
        replace_file(target, &partial)?;
    } else if let Err(error) = std::fs::rename(&partial, target) {
        let _ = std::fs::remove_file(&partial);
        return Err(io_error(error));
    }
    saved_info(target)
}

/// Write a brand-new file (Save as, after the old file went to the Recycle
/// Bin). Never overwrites: an existing target is refused.
pub fn write_new_file(target: &Path, bytes: &[u8]) -> Result<SavedInfo, SaveError> {
    if target.try_exists().unwrap_or(false) {
        return Err(SaveError::TargetExists);
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(SaveError::FolderMissing);
    }
    let partial = partial_path(target);
    write_partial(&partial, bytes)?;
    if let Err(error) = std::fs::rename(&partial, target) {
        let _ = std::fs::remove_file(&partial);
        return Err(io_error(error));
    }
    saved_info(target)
}

fn write_partial(partial: &Path, bytes: &[u8]) -> Result<(), SaveError> {
    let written = (|| {
        let mut file = std::fs::File::create(partial)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(partial);
        return Err(io_error(error));
    }
    Ok(())
}

fn saved_info(target: &Path) -> Result<SavedInfo, SaveError> {
    let meta = std::fs::metadata(target).map_err(|error| io_error(error))?;
    Ok(SavedInfo {
        size: meta.len(),
        modified_unix: modified_unix(&meta),
    })
}

fn modified_unix(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// A sharing violation (Windows error 32) means another program holds the
/// file; everything else is a plain I/O failure.
fn io_error(error: std::io::Error) -> SaveError {
    if error.raw_os_error() == Some(32) {
        SaveError::InUse
    } else {
        SaveError::Io(error.to_string())
    }
}

/// Swap the partial file in with `ReplaceFileW`, so the target keeps its
/// creation time, attributes and permissions.
#[cfg(windows)]
fn replace_file(target: &Path, partial: &Path) -> Result<(), SaveError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};

    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    let partial_wide: Vec<u16> = partial.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: both wide strings live until the call returns; the target
    // exists (checked by the caller) and the replacement is the flushed
    // partial file. No backup file is requested.
    let result = unsafe {
        ReplaceFileW(
            PCWSTR(target_wide.as_ptr()),
            PCWSTR(partial_wide.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            None,
            None,
        )
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(partial);
        let code = error.code().0 as u32 & 0xFFFF;
        if code == 32 {
            return Err(SaveError::InUse);
        }
        return Err(SaveError::Io(error.message()));
    }
    Ok(())
}

/// Other systems: a rename replaces the target in one step.
#[cfg(not(windows))]
fn replace_file(target: &Path, partial: &Path) -> Result<(), SaveError> {
    if let Err(error) = std::fs::rename(partial, target) {
        let _ = std::fs::remove_file(partial);
        return Err(io_error(error));
    }
    Ok(())
}
