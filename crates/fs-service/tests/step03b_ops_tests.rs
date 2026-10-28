//! Step 03b: the file-operation engine (create, copy, move, recycle,
//! restore, permanent delete) on real temp folders.

use fs_service::{
    check_conflicts, copy_items, create_item, delete_permanently, move_items,
    new_cancellation_token, recycle_items, restore_items, unique_destination, ConflictPolicy,
    CreateKind,
};
use std::fs;
use std::path::PathBuf;

fn no_progress(_: &fs_service::OpProgress) {}

fn tree(root: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            out.push(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn unique_destination_numbers_like_windows() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("notes.txt"), b"x").unwrap();
    assert_eq!(
        unique_destination(dir.path(), "notes.txt"),
        dir.path().join("notes (2).txt")
    );
    fs::write(dir.path().join("notes (2).txt"), b"x").unwrap();
    assert_eq!(
        unique_destination(dir.path(), "notes.txt"),
        dir.path().join("notes (3).txt")
    );
    fs::create_dir(dir.path().join("Trips")).unwrap();
    assert_eq!(
        unique_destination(dir.path(), "Trips"),
        dir.path().join("Trips (2)")
    );
}

#[test]
fn create_item_makes_unique_empty_items() {
    let dir = tempfile::tempdir().unwrap();
    let folder = create_item(dir.path(), "New folder", CreateKind::Folder).unwrap();
    assert!(folder.is_dir());
    let again = create_item(dir.path(), "New folder", CreateKind::Folder).unwrap();
    assert_eq!(again, dir.path().join("New folder (2)"));
    let file = create_item(dir.path(), "New text file.txt", CreateKind::File).unwrap();
    assert_eq!(fs::read(&file).unwrap(), Vec::<u8>::new());
    assert!(create_item(dir.path(), "a/b.txt", CreateKind::File).is_err());
}

#[test]
fn copy_copies_files_and_trees_and_reports_totals() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    fs::write(src.path().join("a.txt"), b"hello").unwrap();
    fs::create_dir(src.path().join("sub")).unwrap();
    fs::write(src.path().join("sub/b.bin"), vec![7u8; 1000]).unwrap();

    let mut last = None;
    let report = copy_items(
        &[src.path().join("a.txt"), src.path().join("sub")],
        dst.path(),
        ConflictPolicy::Skip,
        &new_cancellation_token(),
        &mut |p| last = Some(p.clone()),
    )
    .unwrap();
    assert!(!report.cancelled);
    assert_eq!(report.completed.len(), 2);
    assert!(report.skipped.is_empty());
    assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"hello");
    assert_eq!(fs::read(dst.path().join("sub/b.bin")).unwrap().len(), 1000);
    let progress = last.unwrap();
    assert_eq!(progress.items_total, 2);
    assert_eq!(progress.bytes_total, 1005);
    assert_eq!(progress.bytes_done, 1005);
}

#[test]
fn copy_never_overwrites_without_replace() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    fs::write(src.path().join("a.txt"), b"new").unwrap();
    fs::write(dst.path().join("a.txt"), b"old").unwrap();

    let skipped = copy_items(
        &[src.path().join("a.txt")],
        dst.path(),
        ConflictPolicy::Skip,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(skipped.completed.len(), 0);
    assert_eq!(skipped.skipped.len(), 1);
    assert_eq!(skipped.skipped[0].reason, "exists");
    assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"old");

    let kept = copy_items(
        &[src.path().join("a.txt")],
        dst.path(),
        ConflictPolicy::KeepBoth,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(kept.completed[0].to, dst.path().join("a (2).txt"));
    assert_eq!(fs::read(dst.path().join("a (2).txt")).unwrap(), b"new");

    let replaced = copy_items(
        &[src.path().join("a.txt")],
        dst.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(replaced.completed.len(), 1);
    assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"new");
}

#[test]
fn copy_into_the_same_folder_uses_the_copy_name() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.txt");
    fs::write(&file, b"data").unwrap();
    let report = copy_items(
        &[file],
        dir.path(),
        ConflictPolicy::KeepBoth,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(report.completed[0].to, dir.path().join("report - Copy.txt"));
    assert_eq!(
        fs::read(dir.path().join("report - Copy.txt")).unwrap(),
        b"data"
    );
}

#[test]
fn a_cancelled_copy_leaves_no_partial_file() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    let big = src.path().join("big.bin");
    fs::write(&big, vec![1u8; 4 * 1024 * 1024]).unwrap();
    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    let report = copy_items(
        &[big],
        dst.path(),
        ConflictPolicy::Skip,
        &token,
        &mut no_progress,
    )
    .unwrap();
    assert!(report.cancelled);
    assert!(report.completed.is_empty());
    assert_eq!(tree(dst.path()), Vec::<String>::new());
}

#[test]
fn move_renames_then_removes_the_source() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    fs::create_dir(src.path().join("folder")).unwrap();
    fs::write(src.path().join("folder/inner.txt"), b"in").unwrap();
    let report = move_items(
        &[src.path().join("folder")],
        dst.path(),
        ConflictPolicy::Skip,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(report.completed.len(), 1);
    assert!(!src.path().join("folder").exists());
    assert_eq!(
        fs::read(dst.path().join("folder/inner.txt")).unwrap(),
        b"in"
    );
}

#[test]
fn check_conflicts_lists_existing_targets_only() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    fs::write(src.path().join("here.txt"), b"1").unwrap();
    fs::write(src.path().join("gone.txt"), b"2").unwrap();
    fs::write(dst.path().join("here.txt"), b"old").unwrap();
    let conflicts = check_conflicts(
        &[src.path().join("here.txt"), src.path().join("gone.txt")],
        dst.path(),
    );
    assert_eq!(conflicts, vec![dst.path().join("here.txt")]);
}

#[test]
fn permanent_delete_removes_files_and_trees() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("tree")).unwrap();
    fs::write(dir.path().join("tree/leaf.txt"), b"x").unwrap();
    let report = delete_permanently(
        &[dir.path().join("tree")],
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(report.completed.len(), 1);
    assert!(!dir.path().join("tree").exists());
}

#[cfg(windows)]
#[test]
fn recycle_then_restore_brings_the_item_back() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("bring-me-back.txt");
    fs::write(&file, b"roundtrip").unwrap();
    let recycled = recycle_items(
        std::slice::from_ref(&file),
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(recycled.completed.len(), 1);
    assert!(!file.exists());

    let restored = restore_items(std::slice::from_ref(&file)).unwrap();
    assert_eq!(restored.completed.len(), 1);
    assert_eq!(fs::read(&file).unwrap(), b"roundtrip");

    // Leave nothing behind in the real Recycle Bin.
    let again = recycle_items(
        std::slice::from_ref(&file),
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(again.completed.len(), 1);
    let _ = delete_permanently_from_bin(&file);
}

#[cfg(windows)]
fn delete_permanently_from_bin(original: &std::path::Path) -> bool {
    // Restore once more and delete permanently so the test leaves the bin
    // as it found it.
    if restore_items(std::slice::from_ref(&original.to_path_buf())).is_ok() && original.exists() {
        delete_permanently(
            std::slice::from_ref(&original.to_path_buf()),
            &new_cancellation_token(),
            &mut no_progress,
        )
        .is_ok()
    } else {
        false
    }
}

#[test]
fn copying_a_folder_with_a_link_loop_terminates() {
    let dir = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("root")).unwrap();
    fs::write(dir.path().join("root/real.txt"), b"real").unwrap();
    // A directory link pointing at its own parent would loop forever if
    // followed. Creating one needs privileges on some PCs; skip then.
    #[cfg(windows)]
    let linked =
        std::os::windows::fs::symlink_dir(dir.path().join("root"), dir.path().join("root/loop"))
            .is_ok();
    #[cfg(not(windows))]
    let linked =
        std::os::unix::fs::symlink(dir.path().join("root"), dir.path().join("root/loop")).is_ok();
    if !linked {
        return;
    }
    let report = copy_items(
        &[dir.path().join("root")],
        dst.path(),
        ConflictPolicy::Skip,
        &new_cancellation_token(),
        &mut no_progress,
    )
    .unwrap();
    assert_eq!(fs::read(dst.path().join("root/real.txt")).unwrap(), b"real");
    assert!(report
        .skipped
        .iter()
        .any(|item| item.reason == "link_loop" || item.reason == "exists"));
    let _ = PathBuf::new();
}
