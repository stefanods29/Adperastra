//! Step 06b: snapshots, import, deduplication, extract and listing.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tempfile::tempdir;
use version_store::{path_key, snapshot_to_pending, StoreError, VersionStore, MAX_SNAPSHOT_BYTES};

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn files_under(dir: &Path) -> usize {
    match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    files_under(&path)
                } else {
                    1
                }
            })
            .sum(),
        Err(_) => 0,
    }
}

fn pending_count(store: &Path) -> usize {
    match fs::read_dir(store.join("pending")) {
        Ok(entries) => entries.count(),
        Err(_) => 0,
    }
}

fn user_file(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, text).unwrap();
    path
}

#[test]
fn snapshot_then_import_lists_one_version() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "one");

    assert_eq!(
        snapshot_to_pending(store_dir.path(), &a, "save", 100),
        Ok(true)
    );
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    assert_eq!(store.import_pending(200), Ok(1));

    let versions = store.list(&a.to_string_lossy()).unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].reason, "save");
    assert_eq!(versions[0].size, 3);
    assert_eq!(versions[0].created_unix, 100);
    assert_eq!(pending_count(store_dir.path()), 0);
}

#[test]
fn extract_gives_back_the_same_bytes() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "one");
    snapshot_to_pending(store_dir.path(), &a, "save", 100).unwrap();
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(200).unwrap();
    let id = store.list(&a.to_string_lossy()).unwrap()[0].id;

    let out = user_dir.path().join("out.txt");
    store.extract(id, &out).unwrap();
    assert_eq!(fs::read(&out).unwrap(), b"one");
    assert_eq!(store.read_bytes(id).unwrap(), b"one");
    assert!(!user_dir.path().join("out.txt.partial").exists());
}

#[test]
fn identical_content_is_stored_once() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "one");
    let b = user_file(user_dir.path(), "b.txt", "one");
    snapshot_to_pending(store_dir.path(), &a, "save", 100).unwrap();
    snapshot_to_pending(store_dir.path(), &b, "save", 100).unwrap();

    let mut store = VersionStore::open(store_dir.path()).unwrap();
    assert_eq!(store.import_pending(200), Ok(2));
    assert_eq!(store.list(&a.to_string_lossy()).unwrap().len(), 1);
    assert_eq!(store.list(&b.to_string_lossy()).unwrap().len(), 1);
    assert_eq!(files_under(&store_dir.path().join("blobs")), 1);
}

#[test]
fn an_unchanged_snapshot_adds_no_version() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "one");
    snapshot_to_pending(store_dir.path(), &a, "save", 100).unwrap();
    snapshot_to_pending(store_dir.path(), &a, "save", 101).unwrap();

    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(200).unwrap();
    assert_eq!(store.list(&a.to_string_lossy()).unwrap().len(), 1);
}

#[test]
fn missing_files_and_folders_are_skipped() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let missing = user_dir.path().join("gone.txt");

    assert_eq!(
        snapshot_to_pending(store_dir.path(), &missing, "save", 100),
        Ok(false)
    );
    assert_eq!(
        snapshot_to_pending(store_dir.path(), user_dir.path(), "save", 100),
        Ok(false)
    );
    assert_eq!(pending_count(store_dir.path()), 0);
}

#[test]
fn too_large_files_are_refused() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let big = user_dir.path().join("big.bin");
    let file = fs::File::create(&big).unwrap();
    file.set_len(MAX_SNAPSHOT_BYTES + 1).unwrap();

    assert_eq!(
        snapshot_to_pending(store_dir.path(), &big, "save", 100),
        Err(StoreError::TooLarge)
    );
    assert_eq!(pending_count(store_dir.path()), 0);
}

#[test]
fn path_key_ignores_case_and_prefix() {
    assert_eq!(path_key(r"C:\A\B.txt"), path_key(r"\\?\c:\a\b.TXT"));
    assert_eq!(path_key(r"C:\A\B.txt"), r"c:\a\b.txt");
    assert_eq!(path_key(r"C:\A\"), r"c:\a");
}

#[test]
fn a_lonely_sidecar_is_cleaned_after_a_minute() {
    let store_dir = tempdir().unwrap();
    let pending = store_dir.path().join("pending");
    fs::create_dir_all(&pending).unwrap();
    let sidecar = pending.join("1-0.json");
    fs::write(
        &sidecar,
        br#"{"path":"C:\\x\\a.txt","reason":"save","created_unix":1,"file_modified_unix":0}"#,
    )
    .unwrap();
    let old = SystemTime::now() - Duration::from_secs(61);
    let file = fs::File::options().write(true).open(&sidecar).unwrap();
    file.set_times(fs::FileTimes::new().set_modified(old))
        .unwrap();
    drop(file);

    let mut store = VersionStore::open(store_dir.path()).unwrap();
    assert_eq!(store.import_pending(now_unix()), Ok(0));
    assert!(!sidecar.exists());
}

#[test]
fn versions_are_listed_newest_first() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_dir.path().join("a.txt");
    for (text, created) in [("one", 100), ("two", 200), ("three", 300)] {
        fs::write(&a, text).unwrap();
        snapshot_to_pending(store_dir.path(), &a, "save", created).unwrap();
    }
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(400).unwrap();

    let created: Vec<u64> = store
        .list(&a.to_string_lossy())
        .unwrap()
        .iter()
        .map(|version| version.created_unix)
        .collect();
    assert_eq!(created, vec![300, 200, 100]);
}
