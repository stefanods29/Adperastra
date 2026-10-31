//! Regression coverage for completed snapshots, store coordination and restore identity.

use std::fs;
use std::sync::mpsc;
use std::time::{Duration, UNIX_EPOCH};

use tempfile::tempdir;
use version_store::{snapshot_to_pending, StoreError, VersionStore, MAX_SNAPSHOT_BYTES};

#[test]
fn interrupted_copies_are_never_imported_as_complete_versions() {
    let dir = tempdir().unwrap();
    let pending = dir.path().join("pending");
    fs::create_dir_all(&pending).unwrap();
    fs::write(pending.join("1-0.raw.partial"), b"incomplete").unwrap();
    fs::write(
        pending.join("1-0.json"),
        br#"{"path":"C:\\a.txt","reason":"save","created_unix":1,"file_modified_unix":1,"size":100}"#,
    )
    .unwrap();
    // A pre-publication-protocol crash may also leave a short .raw file.
    fs::write(pending.join("2-0.raw"), b"short").unwrap();
    fs::write(
        pending.join("2-0.json"),
        br#"{"path":"C:\\a.txt","reason":"save","created_unix":2,"file_modified_unix":1,"size":100}"#,
    )
    .unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    assert_eq!(store.import_pending(2), Ok(0));
    assert!(store.list(r"C:\a.txt").unwrap().is_empty());
}

#[test]
fn a_snapshot_without_a_completion_record_is_not_imported() {
    let dir = tempdir().unwrap();
    let pending = dir.path().join("pending");
    fs::create_dir_all(&pending).unwrap();
    fs::write(pending.join("1-0.raw"), b"partial legacy copy").unwrap();
    fs::write(
        pending.join("1-0.json"),
        br#"{"path":"C:\\a.txt","reason":"save","created_unix":1,"file_modified_unix":1}"#,
    )
    .unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    assert_eq!(store.import_pending(2), Ok(0));
    assert!(store.list(r"C:\a.txt").unwrap().is_empty());
}

#[test]
fn startup_cleans_abandoned_staging_but_preserves_uncertain_legacy_pairs() {
    let dir = tempdir().unwrap();
    let pending = dir.path().join("pending");
    fs::create_dir_all(&pending).unwrap();
    for name in ["1-0.raw.partial", "2-0.raw", "3-0.raw", "3-0.json"] {
        let path = pending.join(name);
        fs::write(&path, "incomplete or uncertain").unwrap();
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(1)))
            .unwrap();
    }
    let mut store = VersionStore::open(dir.path()).unwrap();
    assert_eq!(store.import_pending(200), Ok(0));
    assert!(!pending.join("1-0.raw.partial").exists());
    assert!(!pending.join("2-0.raw").exists());
    assert!(pending.join("3-0.raw").exists());
    assert!(pending.join("3-0.json").exists());
}

#[test]
fn delete_all_also_removes_copies_waiting_for_import() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "private old content").unwrap();
    snapshot_to_pending(dir.path(), &path, "save", 100).unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    store.delete_all().unwrap();
    assert_eq!(store.import_pending(200), Ok(0));
    assert!(store.list(&path.to_string_lossy()).unwrap().is_empty());
    assert_eq!(fs::read_dir(dir.path().join("pending")).unwrap().count(), 0);
    assert_eq!(fs::read_to_string(path).unwrap(), "private old content");
}

#[test]
fn an_open_store_does_not_deadlock_standalone_snapshot_publication() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    assert_eq!(
        snapshot_to_pending(dir.path(), &path, "save", 100),
        Ok(true)
    );
    assert_eq!(store.import_pending(200), Ok(1));
}

#[cfg(windows)]
#[test]
fn delete_all_removes_read_only_extracted_copies() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    let opened = dir.path().join("open").join(format!("{id}-a.txt"));
    store.extract(id, &opened).unwrap();
    let mut permissions = fs::metadata(&opened).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&opened, permissions).unwrap();
    store.delete_all().unwrap();
    assert!(!opened.exists());
}

#[test]
fn version_ids_are_not_reused_after_delete_all_or_trim() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let first = store
        .snapshot_current(&path, "restore", 100)
        .unwrap()
        .unwrap();
    store.delete_all().unwrap();
    fs::write(&path, "two").unwrap();
    let second = store.snapshot_current(&path, "save", 101).unwrap().unwrap();
    assert!(second > first);
    assert_eq!(store.read_bytes(first), Err(StoreError::NotFound));
    store.trim(0, 0, 102).unwrap();
    fs::write(&path, "three").unwrap();
    let third = store.snapshot_current(&path, "save", 103).unwrap().unwrap();
    assert!(third > second);
    assert_eq!(store.read_bytes(second), Err(StoreError::NotFound));
}

#[test]
fn a_restore_id_cannot_be_used_for_another_path() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    let other = user.path().join("b.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    assert_eq!(
        store
            .read_bytes_for_path(id, &path.to_string_lossy())
            .unwrap(),
        b"one"
    );
    assert_eq!(
        store.read_bytes_for_path(id, &other.to_string_lossy()),
        Err(StoreError::NotFound)
    );
}

#[test]
fn exact_snapshot_id_survives_deduplication_against_a_save_row() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let saved = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    let undo = store
        .snapshot_current(&path, "restore", 101)
        .unwrap()
        .unwrap();
    assert_eq!(undo, saved);
    assert_eq!(store.read_bytes(undo).unwrap(), b"one");
    assert_eq!(store.list(&path.to_string_lossy()).unwrap().len(), 1);
}

#[test]
fn skipped_snapshots_do_not_return_an_older_restore_id() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    store.snapshot_current(&path, "restore", 100).unwrap();
    fs::remove_file(&path).unwrap();
    assert_eq!(store.snapshot_current(&path, "restore", 101), Ok(None));
    fs::File::create(&path)
        .unwrap()
        .set_len(MAX_SNAPSHOT_BYTES + 1)
        .unwrap();
    assert_eq!(
        store.snapshot_current(&path, "restore", 102),
        Err(StoreError::TooLarge)
    );
}

#[test]
fn importer_and_delete_all_cannot_run_inside_another_store_session() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    snapshot_to_pending(dir.path(), &path, "save", 100).unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let mut session = store.session().unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (finished_tx, finished_rx) = mpsc::channel();
    let store_path = dir.path().to_path_buf();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        let mut other = VersionStore::open(&store_path).unwrap();
        other.import_pending(200).unwrap();
        other.delete_all().unwrap();
        finished_tx.send(()).unwrap();
    });
    started_rx.recv().unwrap();
    assert!(finished_rx
        .recv_timeout(Duration::from_millis(100))
        .is_err());
    session.delete_all().unwrap();
    drop(session);
    drop(store);
    finished_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    worker.join().unwrap();
    let store = VersionStore::open(dir.path()).unwrap();
    assert!(store.list(&path.to_string_lossy()).unwrap().is_empty());
}

#[test]
fn standalone_snapshots_do_not_wait_for_a_compression_session() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let mut session = store.session().unwrap();
    let (tx, rx) = mpsc::channel();
    let store_path = dir.path().to_path_buf();
    let source = path.clone();
    let worker = std::thread::spawn(move || {
        snapshot_to_pending(&store_path, &source, "save", 100).unwrap();
        tx.send(()).unwrap();
    });
    rx.recv_timeout(Duration::from_secs(5)).unwrap();
    session.delete_all().unwrap();
    drop(session);
    drop(store);
    worker.join().unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    assert_eq!(store.import_pending(200), Ok(0));
    assert_eq!(fs::read_to_string(&path).unwrap(), "one");
}
