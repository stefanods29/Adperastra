//! Step 06a: safe replace of a file's content.

use std::path::Path;
use std::time::Duration;

use fs_service::{replace_contents, write_new_file, SaveError, SaveExpect};

fn expect_of(path: &Path) -> SaveExpect {
    let meta = std::fs::metadata(path).unwrap();
    SaveExpect {
        modified_unix: meta
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        size: meta.len(),
    }
}

/// The folder holds exactly these names: no staging file was left behind.
fn assert_only_entries(folder: &Path, expected: &[&str]) {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, expected);
}

#[test]
fn replaces_the_content_and_leaves_no_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let expect = expect_of(&target);

    let saved = replace_contents(&target, b"new", Some(expect)).unwrap();

    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
    assert_eq!(saved.size, 3);
    assert_only_entries(dir.path(), &["a.txt"]);
}

#[test]
fn refuses_when_the_file_changed_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let expect = SaveExpect {
        modified_unix: 0,
        size: 999,
    };

    assert_eq!(
        replace_contents(&target, b"new", Some(expect)),
        Err(SaveError::ChangedOnDisk)
    );
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
}

#[test]
fn refuses_a_read_only_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&target, permissions).unwrap();

    let result = replace_contents(&target, b"new", None);

    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    // Only undoes this test's own read-only mark on its temporary file.
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&target, permissions).unwrap();

    assert_eq!(result, Err(SaveError::ReadOnly));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
}

#[test]
fn writes_a_file_that_was_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");

    let saved = replace_contents(&target, b"new", None).unwrap();

    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
    assert_eq!(saved.size, 3);
    assert_only_entries(dir.path(), &["a.txt"]);
}

#[test]
fn reports_a_missing_folder() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("missing").join("a.txt");

    assert_eq!(
        replace_contents(&target, b"new", None),
        Err(SaveError::FolderMissing)
    );
}

#[test]
fn write_new_file_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();

    assert_eq!(
        write_new_file(&target, b"new"),
        Err(SaveError::TargetExists)
    );
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");

    let fresh = dir.path().join("b.txt");
    assert_eq!(write_new_file(&fresh, b"new").unwrap().size, 3);
    assert_eq!(std::fs::read_to_string(&fresh).unwrap(), "new");
}

#[test]
fn keeps_the_creation_time() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let created = std::fs::metadata(&target).unwrap().created().unwrap();
    let expect = expect_of(&target);
    std::thread::sleep(Duration::from_millis(1100));

    replace_contents(&target, b"new", Some(expect)).unwrap();

    let after = std::fs::metadata(&target).unwrap().created().unwrap();
    assert_eq!(created, after);
}

#[test]
fn a_foreign_partial_file_is_never_truncated_or_removed() {
    let dir = tempfile::tempdir().unwrap();
    let foreign = dir.path().join("~a.txt.partial");
    std::fs::write(&foreign, "someone else's").unwrap();
    let target = dir.path().join("a.txt");

    // A new file, a save over it, and a refused save.
    write_new_file(&target, b"one").unwrap();
    replace_contents(&target, b"two", None).unwrap();
    assert_eq!(
        write_new_file(&target, b"three"),
        Err(SaveError::TargetExists)
    );

    assert_eq!(std::fs::read_to_string(&target).unwrap(), "two");
    assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "someone else's");
    assert_only_entries(dir.path(), &["a.txt", "~a.txt.partial"]);
}

#[cfg(windows)]
#[test]
fn a_save_refused_by_another_program_keeps_the_old_file_and_leaves_nothing() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&target)
        .unwrap();

    let result = replace_contents(&target, b"new", None);
    drop(held);

    assert_eq!(result, Err(SaveError::InUse));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
    assert_only_entries(dir.path(), &["a.txt"]);
}
