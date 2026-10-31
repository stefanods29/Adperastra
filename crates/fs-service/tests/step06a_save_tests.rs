//! Step 06a: safe replace of a file's content.

use std::path::Path;
use std::time::Duration;

use fs_service::{partial_path, replace_contents, write_new_file, SaveError, SaveExpect};

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

#[test]
fn replaces_the_content_and_leaves_no_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.txt");
    std::fs::write(&target, "old").unwrap();
    let expect = expect_of(&target);

    let saved = replace_contents(&target, b"new", Some(expect)).unwrap();

    assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
    assert_eq!(saved.size, 3);
    assert!(!dir.path().join("~a.txt.partial").exists());
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
    assert!(!dir.path().join("~a.txt.partial").exists());
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
fn partial_path_sits_next_to_the_target() {
    assert_eq!(
        partial_path(Path::new(r"C:\x\a.txt")),
        Path::new(r"C:\x\~a.txt.partial")
    );
}
