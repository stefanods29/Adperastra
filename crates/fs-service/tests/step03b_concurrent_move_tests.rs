use fs_service::{
    new_cancellation_token,
    ops::{move_items, ConflictPolicy},
};
use std::fs;

#[test]
fn merged_move_does_not_delete_a_file_recreated_after_it_was_copied() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("folder")).unwrap();
    fs::create_dir(destination.path().join("folder")).unwrap();
    let first = source.path().join("folder/first.txt");
    fs::write(&first, b"original").unwrap();
    fs::write(source.path().join("folder/second.txt"), b"other").unwrap();
    let mut changed = false;
    let report = move_items(
        &[source.path().join("folder")],
        destination.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut |progress| {
            if !changed && progress.current.ends_with("first.txt") {
                fs::write(&first, b"new user data").unwrap();
                changed = true;
            }
        },
    )
    .unwrap();
    assert!(changed);
    assert_eq!(fs::read(&first).unwrap(), b"new user data", "{report:?}");
    assert_eq!(
        fs::read(destination.path().join("folder/first.txt")).unwrap(),
        b"original"
    );
}

#[cfg(windows)]
#[test]
fn merged_move_preserves_an_identical_replacement_created_during_the_job() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("folder")).unwrap();
    fs::create_dir(destination.path().join("folder")).unwrap();
    let first = source.path().join("folder/first.txt");
    fs::write(&first, b"same data").unwrap();
    let mut changed = false;
    move_items(
        &[source.path().join("folder")],
        destination.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut |progress| {
            if !changed && progress.current.ends_with("first.txt") {
                fs::remove_file(&first).unwrap();
                fs::write(&first, b"same data").unwrap();
                changed = true;
            }
        },
    )
    .unwrap();
    assert!(changed);
    assert_eq!(fs::read(&first).unwrap(), b"same data");
}

#[cfg(windows)]
#[test]
fn merged_move_preserves_source_when_its_attributes_change() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("folder")).unwrap();
    fs::create_dir(destination.path().join("folder")).unwrap();
    let file = source.path().join("folder/first.txt");
    fs::write(&file, b"data").unwrap();
    let original_permissions = fs::metadata(&file).unwrap().permissions();
    let mut changed = false;
    move_items(
        &[source.path().join("folder")],
        destination.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut |progress| {
            if !changed && progress.current.ends_with("first.txt") {
                let mut permissions = fs::metadata(&file).unwrap().permissions();
                permissions.set_readonly(true);
                fs::set_permissions(&file, permissions).unwrap();
                changed = true;
            }
        },
    )
    .unwrap();
    assert!(changed);
    assert_eq!(fs::read(&file).unwrap(), b"data");
    fs::set_permissions(file, original_permissions).unwrap();
}

#[cfg(windows)]
#[test]
fn merged_move_can_remove_a_readonly_source_when_it_is_unchanged() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("folder")).unwrap();
    fs::create_dir(destination.path().join("folder")).unwrap();
    let file = source.path().join("folder/readonly.txt");
    fs::write(&file, b"data").unwrap();
    let original_permissions = fs::metadata(&file).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&file, permissions).unwrap();
    let report = move_items(
        &[source.path().join("folder")],
        destination.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut |_| {},
    )
    .unwrap();
    assert!(!file.exists(), "{report:?}");
    assert_eq!(
        fs::read(destination.path().join("folder/readonly.txt")).unwrap(),
        b"data"
    );
    let target = destination.path().join("folder/readonly.txt");
    fs::set_permissions(target, original_permissions).unwrap();
}

#[cfg(windows)]
#[test]
fn merged_move_never_removes_files_through_a_directory_junction() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("folder")).unwrap();
    fs::create_dir(destination.path().join("folder")).unwrap();
    fs::write(outside.path().join("keep.txt"), b"outside").unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(source.path().join("folder").join("link"))
        .arg(outside.path())
        .status()
        .unwrap();
    assert!(status.success());
    let report = move_items(
        &[source.path().join("folder")],
        destination.path(),
        ConflictPolicy::Replace,
        &new_cancellation_token(),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(
        fs::read(outside.path().join("keep.txt")).unwrap(),
        b"outside",
        "{report:?}"
    );
}
