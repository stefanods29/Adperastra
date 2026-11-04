//! Safe save of a file's new content (Step 06a): an owned staging file with a
//! random name, flush, then replace. Never writes the target halfway and never
//! touches a file this save did not create (R-SAFE-3).

use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::owned_io::{ClosedOutput, OwnedIoError, OwnedOutput, PinnedDirectory};

/// `ReplaceFileW` could not remove the old file: both files are unchanged.
const ERROR_UNABLE_TO_REMOVE_REPLACED: i32 = 1175;
/// `ReplaceFileW` moved the old file to an internal name and could not move
/// the new one: the staging file must stay, nothing can be put back from here.
const ERROR_UNABLE_TO_MOVE_REPLACEMENT_2: i32 = 1177;

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
    Io(String),
}

/// The target's size and modified time after a successful save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedInfo {
    pub size: u64,
    pub modified_unix: u64,
}

/// Replace a file's content: write a staging file, flush it, then swap it in.
/// When the target is missing the staging file is published under its name,
/// and a file that arrived in the meantime is never replaced.
pub fn replace_contents(
    target: &Path,
    bytes: &[u8],
    expect: Option<SaveExpect>,
) -> Result<SavedInfo, SaveError> {
    let exists = target.try_exists().unwrap_or(false);
    if exists {
        check_existing(target, expect)?;
    }
    let (pin, name) = pin_parent(target)?;
    let mut output = stage(&pin, name, bytes)?;
    if exists {
        // Writing took time: look again just before the swap.
        check_existing(target, expect)?;
        replace_staged(&pin.path().join(name), output)?;
    } else {
        output.publish_name(name).map_err(|error| match error {
            OwnedIoError::TargetExists => SaveError::ChangedOnDisk,
            other => owned_error(other),
        })?;
        drop(output);
    }
    saved_info(target)
}

/// Write a brand-new file (Save as). Never overwrites: an existing target is
/// refused, including one that arrives while the file is being written.
pub fn write_new_file(target: &Path, bytes: &[u8]) -> Result<SavedInfo, SaveError> {
    if target.symlink_metadata().is_ok() {
        return Err(SaveError::TargetExists);
    }
    let (pin, name) = pin_parent(target)?;
    let mut output = stage(&pin, name, bytes)?;
    output.publish_name(name).map_err(owned_error)?;
    drop(output);
    saved_info(target)
}

fn check_existing(target: &Path, expect: Option<SaveExpect>) -> Result<(), SaveError> {
    let meta = std::fs::metadata(target).map_err(io_error)?;
    if meta.permissions().readonly() {
        return Err(SaveError::ReadOnly);
    }
    if let Some(expect) = expect {
        if modified_unix(&meta) != expect.modified_unix || meta.len() != expect.size {
            return Err(SaveError::ChangedOnDisk);
        }
    }
    Ok(())
}

/// Pin the target's folder for the whole save, and split off the file name.
fn pin_parent(target: &Path) -> Result<(PinnedDirectory, &str), SaveError> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(SaveError::FolderMissing);
    }
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| SaveError::Io("the file name is not valid".to_string()))?;
    let pin = PinnedDirectory::open(parent).map_err(owned_error)?;
    Ok((pin, name))
}

/// A new staging file with the content, flushed to the disk. A failure removes
/// it through its own handle when the output is dropped.
fn stage(pin: &PinnedDirectory, name: &str, bytes: &[u8]) -> Result<OwnedOutput, SaveError> {
    let mut output = OwnedOutput::create(pin, name).map_err(owned_error)?;
    output.file_mut().write_all(bytes).map_err(io_error)?;
    output.flush_sync().map_err(owned_error)?;
    Ok(output)
}

/// Swap the staging file in. `ReplaceFileW` opens it itself, so its handle
/// closes first.
fn replace_staged(target: &Path, output: OwnedOutput) -> Result<(), SaveError> {
    let closed = output.close();
    match replace_file(target, closed.path()) {
        Ok(()) => Ok(()),
        Err(error) => after_failed_replace(target, closed, error),
    }
}

/// Some `ReplaceFileW` failures happen after the old file left its name, so
/// the staging file can hold the only copy of the content. It is removed only
/// when the old file is known to still be in place.
fn after_failed_replace(
    target: &Path,
    closed: ClosedOutput,
    error: std::io::Error,
) -> Result<(), SaveError> {
    let code = error.raw_os_error();
    if code == Some(ERROR_UNABLE_TO_MOVE_REPLACEMENT_2) {
        return Err(io_error(error));
    }
    if target.symlink_metadata().is_err() {
        return closed.publish_to(target).map_err(owned_error);
    }
    let _ = closed.dispose();
    if code == Some(ERROR_UNABLE_TO_REMOVE_REPLACED) {
        return Err(SaveError::InUse);
    }
    Err(io_error(error))
}

fn owned_error(error: OwnedIoError) -> SaveError {
    match error {
        OwnedIoError::Io(io) => io_error(io),
        OwnedIoError::TargetExists => SaveError::TargetExists,
        other => SaveError::Io(other.to_string()),
    }
}

fn saved_info(target: &Path) -> Result<SavedInfo, SaveError> {
    let meta = std::fs::metadata(target).map_err(io_error)?;
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

/// Swap the staging file in with `ReplaceFileW`, so the target keeps its
/// creation time, attributes and permissions.
#[cfg(windows)]
fn replace_file(target: &Path, partial: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};

    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    let partial_wide: Vec<u16> = partial.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: both wide strings live until the call returns; the target
    // exists (checked by the caller) and the replacement is the flushed
    // staging file. No backup file is requested.
    unsafe {
        ReplaceFileW(
            PCWSTR(target_wide.as_ptr()),
            PCWSTR(partial_wide.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            None,
            None,
        )
    }
    .map_err(|error| std::io::Error::from_raw_os_error((error.code().0 as u32 & 0xFFFF) as i32))
}

/// Other systems: a rename replaces the target in one step.
#[cfg(not(windows))]
fn replace_file(target: &Path, partial: &Path) -> std::io::Result<()> {
    std::fs::rename(partial, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn staged(folder: &Path, bytes: &[u8]) -> (PinnedDirectory, ClosedOutput) {
        let pin = PinnedDirectory::open(folder).unwrap();
        let closed = stage(&pin, "a.txt", bytes).unwrap().close();
        (pin, closed)
    }

    fn os_error(code: i32) -> std::io::Error {
        std::io::Error::from_raw_os_error(code)
    }

    #[test]
    fn a_failed_swap_with_the_old_file_in_place_removes_only_the_staging_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.txt");
        std::fs::write(&target, "old").unwrap();
        let (_pin, closed) = staged(dir.path(), b"new");
        let staging = closed.path().to_path_buf();

        let result = after_failed_replace(&target, closed, os_error(32));

        assert_eq!(result, Err(SaveError::InUse));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        assert!(!staging.exists());
    }

    #[test]
    fn a_failed_swap_that_removed_the_old_file_publishes_the_new_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.txt");
        let (_pin, closed) = staged(dir.path(), b"new");
        let staging = closed.path().to_path_buf();

        // ERROR_UNABLE_TO_MOVE_REPLACEMENT: Windows removed the old file.
        after_failed_replace(&target, closed, os_error(1176)).unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
        assert!(!staging.exists());
    }

    #[test]
    fn a_failed_swap_that_moved_the_old_file_keeps_the_new_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.txt");
        let (_pin, closed) = staged(dir.path(), b"new");
        let staging = closed.path().to_path_buf();

        let result = after_failed_replace(&target, closed, os_error(1177));

        assert!(matches!(result, Err(SaveError::Io(_))));
        assert_eq!(std::fs::read_to_string(&staging).unwrap(), "new");
    }

    #[test]
    fn a_target_that_arrives_during_the_write_is_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.txt");
        let pin = PinnedDirectory::open(dir.path()).unwrap();
        let mut output = stage(&pin, "a.txt", b"new").unwrap();
        std::fs::write(&target, "arrived").unwrap();

        let result = output.publish_name("a.txt").map_err(owned_error);
        drop(output);

        assert_eq!(result.map(|_| ()), Err(SaveError::TargetExists));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "arrived");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
