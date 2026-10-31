use super::*;
use tempfile::tempdir;

fn old_copy(open: &Path, name: &str, content: &[u8], time: u64) -> PathBuf {
    let path = open.join(name);
    std::fs::write(&path, content).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(time)),
        )
        .unwrap();
    path
}

#[test]
fn the_open_cache_has_a_fixed_one_gib_limit() {
    assert_eq!(MAX_OPEN_BYTES, 1_073_741_824);
}

#[test]
fn extracting_reclaims_the_oldest_owned_read_only_copy_first() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let source = user.path().join("a.txt");
    std::fs::write(&source, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store
        .snapshot_current(&source, "save", 100)
        .unwrap()
        .unwrap();
    let open = dir.path().join("open");
    let oldest = old_copy(&open, "900-old.txt", &[b'a'; 16], 1);
    let newer = old_copy(&open, "901-new.txt", &[b'b'; 16], 2);
    let mut permissions = std::fs::metadata(&oldest).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&oldest, permissions).unwrap();
    let _lock = StoreLock::acquire(dir.path()).unwrap();
    let extracted = store.extract_open_locked(id, "a.txt", 32).unwrap();
    assert!(!oldest.exists());
    assert!(newer.exists());
    assert_eq!(std::fs::read(extracted).unwrap(), b"one");
    assert!(disk_usage(&open).unwrap() <= 32);
}

#[test]
fn unowned_retained_files_prevent_extraction_instead_of_exceeding_the_limit() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let source = user.path().join("a.txt");
    std::fs::write(&source, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store
        .snapshot_current(&source, "save", 100)
        .unwrap()
        .unwrap();
    let open = dir.path().join("open");
    let retained = old_copy(&open, "keep.bin", &[b'a'; 32], 1);
    let _lock = StoreLock::acquire(dir.path()).unwrap();
    assert!(store.extract_open_locked(id, "a.txt", 32).is_err());
    assert_eq!(std::fs::read(retained).unwrap(), [b'a'; 32]);
    assert_eq!(std::fs::read_dir(open).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn in_use_owned_copies_prevent_extraction_when_no_space_can_be_reclaimed() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let source = user.path().join("a.txt");
    std::fs::write(&source, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store
        .snapshot_current(&source, "save", 100)
        .unwrap()
        .unwrap();
    let open = dir.path().join("open");
    let retained = old_copy(&open, "900-locked.txt", &[b'a'; 32], 1);
    let file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&retained)
        .unwrap();
    let _lock = StoreLock::acquire(dir.path()).unwrap();
    assert!(store.extract_open_locked(id, "a.txt", 32).is_err());
    assert_eq!(file.metadata().unwrap().len(), 32);
    assert_eq!(std::fs::read_dir(open).unwrap().count(), 1);
}
