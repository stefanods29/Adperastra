use super::*;
use std::fs;
use tempfile::tempdir;

#[test]
fn saving_a_copy_refuses_an_existing_target_without_changing_it() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("a.txt");
    fs::write(&target, "original").unwrap();
    assert_eq!(
        save_copy(&target, b"version"),
        Err("versions.replace_unavailable".to_string())
    );
    assert_eq!(fs::read(&target).unwrap(), b"original");
}

#[test]
fn saving_a_copy_never_touches_an_existing_partial_file() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("a.txt");
    let sentinel = dir.path().join("~a.txt.partial");
    fs::write(&sentinel, "unrelated user file").unwrap();
    save_copy(&target, b"version").unwrap();
    assert_eq!(fs::read(target).unwrap(), b"version");
    assert_eq!(fs::read(sentinel).unwrap(), b"unrelated user file");
}

#[test]
fn failed_copy_staging_never_publishes_or_leaves_its_partial() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("a.txt");
    let result = save_copy_with(
        &target,
        |file| {
            file.write_all(b"half")?;
            Err(std::io::Error::other("injected staging failure"))
        },
        || {},
    );
    assert!(result.is_err());
    assert!(!target.exists());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn a_target_created_during_staging_is_never_overwritten() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("a.txt");
    let result = save_copy_with(
        &target,
        |file| file.write_all(b"version"),
        || fs::write(&target, "arrived while staging").unwrap(),
    );
    assert!(result.is_err());
    assert_eq!(fs::read(&target).unwrap(), b"arrived while staging");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn restore_returns_the_exact_current_snapshot_even_when_it_deduplicates() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let target = user.path().join("a.txt");
    let mut store = version_store::VersionStore::open(dir.path()).unwrap();
    fs::write(&target, "old").unwrap();
    let old = store
        .snapshot_current(&target, "save", 100)
        .unwrap()
        .unwrap();
    fs::write(&target, "current").unwrap();
    let current = store
        .snapshot_current(&target, "save", 101)
        .unwrap()
        .unwrap();
    // The restore helper intentionally has no enabled-history flag: preserving
    // its undo snapshot is required even when ordinary snapshots are disabled.
    let (previous, _) = restore_version(&mut store, &target, old, 102).unwrap();
    assert_eq!(previous, current);
    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(store.read_bytes(previous).unwrap(), b"current");
}

#[test]
fn restore_refuses_an_existing_file_that_cannot_have_an_undo_snapshot() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let target = user.path().join("a.txt");
    let mut store = version_store::VersionStore::open(dir.path()).unwrap();
    fs::write(&target, "old").unwrap();
    let old = store
        .snapshot_current(&target, "save", 100)
        .unwrap()
        .unwrap();
    fs::File::create(&target)
        .unwrap()
        .set_len(version_store::MAX_SNAPSHOT_BYTES + 1)
        .unwrap();
    assert_eq!(
        restore_version(&mut store, &target, old, 101),
        Err("versions.snapshot_failed".to_string())
    );
    assert_eq!(
        fs::metadata(&target).unwrap().len(),
        version_store::MAX_SNAPSHOT_BYTES + 1
    );
}

#[test]
fn stale_or_foreign_restore_ids_never_modify_the_target() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let target = user.path().join("a.txt");
    let other = user.path().join("b.txt");
    let mut store = version_store::VersionStore::open(dir.path()).unwrap();
    fs::write(&target, "old").unwrap();
    let old = store
        .snapshot_current(&target, "save", 100)
        .unwrap()
        .unwrap();
    store.delete_all().unwrap();
    fs::write(&other, "other").unwrap();
    let foreign = store
        .snapshot_current(&other, "save", 101)
        .unwrap()
        .unwrap();
    fs::write(&target, "current").unwrap();
    assert_eq!(
        restore_version(&mut store, &target, old, 102),
        Err("versions.not_found".to_string())
    );
    assert_eq!(
        restore_version(&mut store, &target, foreign, 102),
        Err("versions.not_found".to_string())
    );
    assert_eq!(fs::read(target).unwrap(), b"current");
}

#[cfg(windows)]
#[test]
fn restore_guard_prevents_source_writes_and_renames_until_commit() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("a.txt");
    fs::write(&target, "current").unwrap();
    let guard = RestoreTarget::open(&target).unwrap();
    assert!(fs::write(&target, "other").is_err());
    assert!(fs::rename(&target, dir.path().join("moved.txt")).is_err());
    guard.verify(&target).unwrap();
    assert_eq!(fs::read(target).unwrap(), b"current");
}
