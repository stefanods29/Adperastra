//! Exact file-transfer effects used by the in-memory Undo history.

use super::{
    copy_times, exists, is_drive_root, op_error_reason, remove_file_forced, unique_destination,
    CompletedItem, OpProgress, OpReport, SkippedItem, CHUNK,
};
use crate::{CancellationToken, FsError, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

pub const MAX_TRANSFER_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    File,
    Directory,
    /// A complete same-volume rename, including a directory's children.
    Tree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferEffect {
    pub from: PathBuf,
    pub to: PathBuf,
    pub kind: TransferKind,
    pub source_removed: bool,
    pub destination_created: bool,
}

/// Conservative in-memory accounting, independent of JSON encoding.
pub fn transfer_bytes(effects: &[TransferEffect]) -> usize {
    effects.iter().fold(0usize, |total, effect| {
        total
            .saturating_add(effect.from.as_os_str().len())
            .saturating_add(effect.to.as_os_str().len())
            .saturating_add(128)
    })
}

fn cancelled(token: &CancellationToken) -> Result<()> {
    if token.load(Ordering::Relaxed) {
        Err(FsError::Cancelled)
    } else {
        Ok(())
    }
}

fn ensure_directory(path: &Path) -> Result<()> {
    if exists(path) {
        if path.is_dir() {
            return Ok(());
        }
        return Err(FsError::Io(std::io::ErrorKind::AlreadyExists.into()));
    }
    fs::create_dir_all(path)?;
    Ok(())
}

/// Replay the recorded changes, never the original top-level selection.
/// Stop on the first failure so the UI can keep the history cursor in place.
pub fn apply_transfer(
    effects: &[TransferEffect],
    reverse: bool,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<OpReport> {
    if effects.is_empty()
        || transfer_bytes(effects) > MAX_TRANSFER_BYTES
        || effects.iter().any(|effect| {
            !effect.from.is_absolute()
                || !effect.to.is_absolute()
                || is_drive_root(&effect.from)
                || is_drive_root(&effect.to)
        })
    {
        return Err(FsError::Validation("invalid transfer plan".to_string()));
    }
    let mut report = OpReport::default();
    let mut snapshot = OpProgress {
        items_done: 0,
        items_total: effects.len(),
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    };
    let mut directories: Vec<_> = effects
        .iter()
        .filter(|effect| effect.kind == TransferKind::Directory)
        .collect();
    directories.sort_by_key(|effect| {
        if reverse {
            effect.from.components().count()
        } else {
            effect.to.components().count()
        }
    });
    // Recreate scaffolds before moving their children. Existing directory
    // contents are preserved; a newly occupied file path is an error.
    for effect in &directories {
        let needed = if reverse {
            effect.source_removed
        } else {
            effect.destination_created
        };
        if needed {
            cancelled(token)?;
            let path = if reverse { &effect.from } else { &effect.to };
            if let Err(error) = ensure_directory(path) {
                report.skipped.push(SkippedItem {
                    path: path.clone(),
                    reason: op_error_reason(&error).to_string(),
                });
                return Ok(report);
            }
        }
    }
    for effect in effects
        .iter()
        .filter(|effect| effect.kind != TransferKind::Directory)
    {
        if token.load(Ordering::Relaxed) {
            report.cancelled = true;
            return Ok(report);
        }
        let (from, to) = if reverse {
            (&effect.to, &effect.from)
        } else {
            (&effect.from, &effect.to)
        };
        snapshot.current = from.to_string_lossy().into_owned();
        progress(&snapshot);
        let result = if effect.source_removed {
            move_exact(from, to, token, &mut snapshot, progress)
        } else if reverse {
            if !effect.destination_created {
                continue;
            }
            super::recycle_items(std::slice::from_ref(from), token, &mut |_| {}).and_then(
                |recycled| {
                    if recycled.cancelled {
                        return Err(FsError::Cancelled);
                    }
                    if let Some(skipped) = recycled.skipped.first() {
                        return Err(FsError::Io(
                            match skipped.reason.as_str() {
                                "not_found" => std::io::ErrorKind::NotFound,
                                "access_denied" => std::io::ErrorKind::PermissionDenied,
                                _ => std::io::ErrorKind::Other,
                            }
                            .into(),
                        ));
                    }
                    Ok(())
                },
            )
        } else {
            copy_new_file(from, to, token, &mut snapshot, progress)
        };
        match result {
            Ok(()) => {
                report.completed.push(CompletedItem {
                    from: from.clone(),
                    to: to.clone(),
                });
                snapshot.items_done += 1;
                progress(&snapshot);
            }
            Err(FsError::Cancelled) => {
                report.cancelled = true;
                return Ok(report);
            }
            Err(error) => {
                report.skipped.push(SkippedItem {
                    path: from.clone(),
                    reason: op_error_reason(&error).to_string(),
                });
                return Ok(report);
            }
        }
    }
    // Only remove empty scaffolds. A file added by another program is
    // never swept up while cleaning an Undo/Redo destination.
    directories.sort_by_key(|effect| {
        std::cmp::Reverse(if reverse {
            effect.to.components().count()
        } else {
            effect.from.components().count()
        })
    });
    for effect in directories {
        let cleanup = if reverse {
            effect.destination_created
        } else {
            effect.source_removed
        };
        if !cleanup {
            continue;
        }
        if token.load(Ordering::Relaxed) {
            report.cancelled = true;
            return Ok(report);
        }
        let path = if reverse { &effect.to } else { &effect.from };
        match fs::remove_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                report.skipped.push(SkippedItem {
                    path: path.clone(),
                    reason: op_error_reason(&FsError::from(error)).to_string(),
                });
                return Ok(report);
            }
        }
    }
    snapshot.items_done = snapshot.items_total;
    progress(&snapshot);
    Ok(report)
}

fn copy_new_file(
    from: &Path,
    to: &Path,
    token: &CancellationToken,
    snapshot: &mut OpProgress,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<()> {
    cancelled(token)?;
    if exists(to) {
        return Err(FsError::Io(std::io::ErrorKind::AlreadyExists.into()));
    }
    let parent = to
        .parent()
        .ok_or_else(|| FsError::Validation("missing parent".to_string()))?;
    ensure_directory(parent)?;
    let name = to
        .file_name()
        .ok_or_else(|| FsError::Validation("missing name".to_string()))?
        .to_string_lossy();
    let partial = unique_destination(parent, &format!("~{name}.partial"));
    let mut input = fs::File::open(from)?;
    let source_metadata = input.metadata()?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut buffer = vec![0u8; CHUNK];
    let result = (|| {
        let mut written = 0u64;
        loop {
            cancelled(token)?;
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read])?;
            written += read as u64;
            snapshot.bytes_done += read as u64;
            snapshot.bytes_total = snapshot.bytes_total.max(snapshot.bytes_done);
            progress(snapshot);
        }
        output.flush()?;
        output.sync_all()?;
        let after = input.metadata()?;
        if written != source_metadata.len()
            || after.len() != source_metadata.len()
            || after.modified().ok() != source_metadata.modified().ok()
        {
            return Err(FsError::Io(std::io::ErrorKind::Other.into()));
        }
        Ok(())
    })();
    drop(output);
    let result = result.and_then(|()| {
        copy_times(from, &partial);
        fs::set_permissions(&partial, source_metadata.permissions())?;
        rename_new(&partial, to)
    });
    if result.is_err() {
        let _ = remove_file_forced(&partial);
    }
    result
}

#[cfg(windows)]
fn rename_new(from: &Path, to: &Path) -> Result<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let from = crate::winpath::long_path_wide(from);
    let to = crate::winpath::long_path_wide(to);
    // No REPLACE_EXISTING flag: a concurrent new target must survive.
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(crate::winpath::win32_error)
}

#[cfg(not(windows))]
fn rename_new(from: &Path, to: &Path) -> Result<()> {
    fs::hard_link(from, to)?;
    fs::remove_file(from)?;
    Ok(())
}

#[cfg(windows)]
fn move_exact(
    from: &Path,
    to: &Path,
    token: &CancellationToken,
    snapshot: &mut OpProgress,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<()> {
    cancelled(token)?;
    if exists(to) {
        return Err(FsError::Io(std::io::ErrorKind::AlreadyExists.into()));
    }
    ensure_directory(
        to.parent()
            .ok_or_else(|| FsError::Validation("missing parent".to_string()))?,
    )?;
    match rename_new(from, to) {
        Ok(()) => Ok(()),
        Err(FsError::Io(error)) if error.raw_os_error() == Some(17) => {
            copy_move_exact(from, to, token, snapshot, progress)
        }
        Err(error) => Err(error),
    }
}

/// Cross-volume path, factored so its safety checks can also be tested on
/// a PC with a single volume. No source removal until the copy is flushed.
#[cfg(windows)]
fn copy_move_exact(
    from: &Path,
    to: &Path,
    token: &CancellationToken,
    snapshot: &mut OpProgress,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{GENERIC_READ, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        FileDispositionInfo, SetFileInformationByHandle, DELETE, FILE_DISPOSITION_INFO,
        FILE_SHARE_READ,
    };
    // Across volumes hold the original file against writes/renames/deletes.
    // Delete by this exact handle so a concurrent replacement cannot go.
    let source = fs::OpenOptions::new()
        .read(true)
        .access_mode(GENERIC_READ.0 | DELETE.0)
        .share_mode(FILE_SHARE_READ.0)
        .open(from)?;
    copy_new_file(from, to, token, snapshot, progress)?;
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    let result = unsafe {
        SetFileInformationByHandle(
            HANDLE(source.as_raw_handle()),
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    }
    .map_err(crate::winpath::win32_error);
    if result.is_err() {
        // The original is still intact. Preserve any changes to our new copy
        // in the Recycle Bin and report the failed move without losing data.
        trash::delete(to).map_err(|_| FsError::Io(std::io::ErrorKind::Other.into()))?;
    }
    result
}

#[cfg(not(windows))]
fn move_exact(
    from: &Path,
    to: &Path,
    token: &CancellationToken,
    snapshot: &mut OpProgress,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<()> {
    cancelled(token)?;
    if exists(to) {
        return Err(FsError::Io(std::io::ErrorKind::AlreadyExists.into()));
    }
    ensure_directory(
        to.parent()
            .ok_or_else(|| FsError::Validation("missing parent".to_string()))?,
    )?;
    if from.is_dir() {
        fs::rename(from, to)?;
        return Ok(());
    }
    copy_new_file(from, to, token, snapshot, progress)?;
    fs::remove_file(from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::new_cancellation_token;
    use crate::ops::{copy_items, move_items, ConflictPolicy};

    fn no_progress(_: &OpProgress) {}
    fn apply(effects: &[TransferEffect], reverse: bool) -> OpReport {
        let report = apply_transfer(
            effects,
            reverse,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        assert!(!report.cancelled, "{report:?}");
        assert!(report.skipped.is_empty(), "{report:?}");
        report
    }

    #[test]
    fn cancelled_move_undoes_retained_copies_and_redoes_only_written_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::create_dir(src.path().join("A")).unwrap();
        fs::create_dir(dst.path().join("A")).unwrap();
        fs::write(src.path().join("A/01-first.txt"), b"first").unwrap();
        fs::write(src.path().join("A/02-later.txt"), b"later").unwrap();
        fs::write(dst.path().join("A/mine.txt"), b"mine").unwrap();
        let token = new_cancellation_token();
        let report = move_items(
            &[src.path().join("A")],
            dst.path(),
            ConflictPolicy::Replace,
            &token,
            &mut |p| {
                if p.current.ends_with("01-first.txt") {
                    token.store(true, Ordering::Relaxed);
                }
            },
        )
        .unwrap();
        assert!(report.cancelled);
        assert!(report.completed.is_empty());
        assert!(dst.path().join("A/01-first.txt").is_file());
        assert!(!dst.path().join("A/02-later.txt").exists());
        assert!(report
            .transfer
            .iter()
            .any(|effect| effect.kind == TransferKind::File && !effect.source_removed));
        apply(&report.transfer, true);
        assert_eq!(
            fs::read(src.path().join("A/01-first.txt")).unwrap(),
            b"first"
        );
        assert_eq!(
            fs::read(src.path().join("A/02-later.txt")).unwrap(),
            b"later"
        );
        assert_eq!(fs::read(dst.path().join("A/mine.txt")).unwrap(), b"mine");
        assert!(!dst.path().join("A/01-first.txt").exists());
        apply(&report.transfer, false);
        assert_eq!(
            fs::read(dst.path().join("A/01-first.txt")).unwrap(),
            b"first"
        );
        assert!(!dst.path().join("A/02-later.txt").exists());
        assert!(src.path().join("A/01-first.txt").is_file());
    }

    #[test]
    fn merged_move_recreates_removed_source_parents_and_empty_directories() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("A/empty")).unwrap();
        fs::create_dir(dst.path().join("A")).unwrap();
        fs::write(src.path().join("A/new.txt"), b"new").unwrap();
        fs::write(dst.path().join("A/mine.txt"), b"mine").unwrap();
        let report = move_items(
            &[src.path().join("A")],
            dst.path(),
            ConflictPolicy::Replace,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        assert!(report.skipped.is_empty(), "{report:?}");
        assert!(!src.path().join("A").exists());
        apply(&report.transfer, true);
        assert_eq!(fs::read(src.path().join("A/new.txt")).unwrap(), b"new");
        assert!(src.path().join("A/empty").is_dir());
        assert_eq!(fs::read(dst.path().join("A/mine.txt")).unwrap(), b"mine");
        assert!(!dst.path().join("A/new.txt").exists());
        apply(&report.transfer, false);
        assert!(!src.path().join("A").exists());
        assert_eq!(fs::read(dst.path().join("A/new.txt")).unwrap(), b"new");
        assert!(dst.path().join("A/empty").is_dir());
        assert_eq!(fs::read(dst.path().join("A/mine.txt")).unwrap(), b"mine");
    }

    #[cfg(windows)]
    #[test]
    fn partial_move_deletion_failure_separates_moved_files_from_retained_copies() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::create_dir(src.path().join("A")).unwrap();
        fs::create_dir(dst.path().join("A")).unwrap();
        fs::write(src.path().join("A/01-moved.txt"), b"moved").unwrap();
        fs::write(src.path().join("A/02-retained.txt"), b"retained").unwrap();
        fs::write(dst.path().join("A/mine.txt"), b"mine").unwrap();
        let _guard = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .open(src.path().join("A/02-retained.txt"))
            .unwrap();
        let report = move_items(
            &[src.path().join("A")],
            dst.path(),
            ConflictPolicy::Replace,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        assert!(report.completed.is_empty(), "{report:?}");
        assert!(!src.path().join("A/01-moved.txt").exists());
        assert!(src.path().join("A/02-retained.txt").exists());
        assert!(report
            .transfer
            .iter()
            .any(|effect| effect.from.ends_with("01-moved.txt") && effect.source_removed));
        assert!(report
            .transfer
            .iter()
            .any(|effect| effect.from.ends_with("02-retained.txt") && !effect.source_removed));
        apply(&report.transfer, true);
        assert_eq!(
            fs::read(src.path().join("A/01-moved.txt")).unwrap(),
            b"moved"
        );
        assert_eq!(
            fs::read(src.path().join("A/02-retained.txt")).unwrap(),
            b"retained"
        );
        assert!(!dst.path().join("A/01-moved.txt").exists());
        assert!(!dst.path().join("A/02-retained.txt").exists());
        assert_eq!(fs::read(dst.path().join("A/mine.txt")).unwrap(), b"mine");
        apply(&report.transfer, false);
        assert!(!src.path().join("A/01-moved.txt").exists());
        assert_eq!(
            fs::read(src.path().join("A/02-retained.txt")).unwrap(),
            b"retained"
        );
        assert_eq!(
            fs::read(dst.path().join("A/01-moved.txt")).unwrap(),
            b"moved"
        );
        assert_eq!(
            fs::read(dst.path().join("A/02-retained.txt")).unwrap(),
            b"retained"
        );
    }

    #[test]
    fn undo_never_overwrites_a_new_item_at_the_original_path() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::write(src.path().join("a.txt"), b"original").unwrap();
        let report = move_items(
            &[src.path().join("a.txt")],
            dst.path(),
            ConflictPolicy::Skip,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        fs::write(src.path().join("a.txt"), b"new arrival").unwrap();
        let undo = apply_transfer(
            &report.transfer,
            true,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        assert_eq!(undo.skipped[0].reason, "exists");
        assert_eq!(fs::read(src.path().join("a.txt")).unwrap(), b"new arrival");
        assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"original");
    }

    #[test]
    fn undo_preserves_a_new_file_inside_a_created_directory() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::create_dir(src.path().join("A")).unwrap();
        fs::write(src.path().join("A/a.txt"), b"original").unwrap();
        let report = copy_items(
            &[src.path().join("A")],
            dst.path(),
            ConflictPolicy::Skip,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        fs::write(dst.path().join("A/new.txt"), b"new arrival").unwrap();
        let undo = apply_transfer(
            &report.transfer,
            true,
            &new_cancellation_token(),
            &mut no_progress,
        )
        .unwrap();
        assert!(!undo.skipped.is_empty());
        assert_eq!(
            fs::read(dst.path().join("A/new.txt")).unwrap(),
            b"new arrival"
        );
        assert!(src.path().join("A/a.txt").is_file());
    }

    #[test]
    fn effect_arrays_never_cross_the_ui_serialization_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let mut report = OpReport::default();
        report.transfer.push(TransferEffect {
            from: dir.path().join("source"),
            to: dir.path().join("target"),
            kind: TransferKind::File,
            source_removed: false,
            destination_created: true,
        });
        report.transfer_id = Some("op-history".to_string());
        let value = serde_json::to_value(report).unwrap();
        assert!(value.get("transfer").is_none());
        assert_eq!(value["transfer_id"], "op-history");
    }

    #[test]
    fn a_history_budget_failure_happens_before_any_destination_write() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("a.txt"), b"source").unwrap();
        let enormous = src.path().join("z".repeat(MAX_TRANSFER_BYTES));
        let result = copy_items(
            &[src.path().join("a.txt")],
            &enormous,
            ConflictPolicy::Skip,
            &new_cancellation_token(),
            &mut no_progress,
        );
        assert!(matches!(result, Err(FsError::UndoLimit)));
        assert_eq!(fs::read(src.path().join("a.txt")).unwrap(), b"source");
        assert_eq!(fs::read_dir(src.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    fn snapshot() -> OpProgress {
        OpProgress {
            items_done: 0,
            items_total: 1,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        }
    }

    #[cfg(windows)]
    #[test]
    fn cross_volume_path_flushes_then_deletes_the_exact_source_handle() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let from = src.path().join("a.txt");
        let to = dst.path().join("a.txt");
        fs::write(&from, vec![42u8; CHUNK + 7]).unwrap();
        let mut blocked = false;
        copy_move_exact(
            &from,
            &to,
            &new_cancellation_token(),
            &mut snapshot(),
            &mut |_| {
                blocked |= fs::write(&from, b"concurrent change").is_err();
            },
        )
        .unwrap();
        assert!(
            blocked,
            "the source was not protected against concurrent writes"
        );
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), vec![42u8; CHUNK + 7]);
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn cancelling_the_cross_volume_path_keeps_source_and_removes_partial() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let from = src.path().join("a.txt");
        let to = dst.path().join("a.txt");
        let bytes = vec![42u8; CHUNK * 2];
        fs::write(&from, &bytes).unwrap();
        let token = new_cancellation_token();
        let result = copy_move_exact(&from, &to, &token, &mut snapshot(), &mut |_| {
            token.store(true, Ordering::Relaxed)
        });
        assert!(matches!(result, Err(FsError::Cancelled)));
        assert_eq!(fs::read(&from).unwrap(), bytes);
        assert!(!to.exists());
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_concurrent_target_is_never_overwritten_in_the_cross_volume_path() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let from = src.path().join("a.txt");
        let to = dst.path().join("a.txt");
        fs::write(&from, b"source").unwrap();
        let result = copy_move_exact(
            &from,
            &to,
            &new_cancellation_token(),
            &mut snapshot(),
            &mut |_| {
                fs::write(&to, b"new arrival").unwrap();
            },
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&from).unwrap(), b"source");
        assert_eq!(fs::read(&to).unwrap(), b"new arrival");
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 1);
    }

    #[test]
    fn history_budget_failures_have_a_distinct_translated_reason() {
        assert_eq!(op_error_reason(&FsError::UndoLimit), "undo_limit");
    }
}
