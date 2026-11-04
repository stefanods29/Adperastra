//! Bounded decoding and accounting of every file the version store keeps.

use std::fs;
use std::path::Path;

use tempfile::tempdir;
use version_store::{snapshot_to_pending, StoreError, VersionStore, MAX_SNAPSHOT_BYTES};

fn file_bytes(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.is_dir() {
                file_bytes(&path)
            } else {
                metadata.len()
            }
        })
        .sum()
}

#[test]
fn disk_bytes_includes_pending_open_and_sqlite_files() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    let content = "history content".repeat(100);
    fs::write(&path, &content).unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let before_pending = store.disk_bytes().unwrap();
    snapshot_to_pending(dir.path(), &path, "save", 100).unwrap();
    assert!(store.disk_bytes().unwrap() >= before_pending + content.len() as u64);
    store.import_pending(200).unwrap();
    let id = store.list(&path.to_string_lossy()).unwrap()[0].id;
    let compressed = store.stored_bytes().unwrap();
    let before_open = store.disk_bytes().unwrap();
    store.extract_open(id, "a.txt").unwrap();
    assert!(store.disk_bytes().unwrap() >= before_open + content.len() as u64);
    assert_eq!(store.stored_bytes().unwrap(), compressed);
    assert_eq!(store.disk_bytes().unwrap(), file_bytes(dir.path()));
}

#[test]
fn corrupt_compressed_output_is_bounded_and_never_published() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    let hash = blake3::hash(b"one").to_string();
    let blob = dir
        .path()
        .join("blobs")
        .join(&hash[..2])
        .join(format!("{hash}.zst"));
    fs::write(blob, zstd::encode_all(&vec![b'x'; 100_000][..], 3).unwrap()).unwrap();
    let output = user.path().join("out.txt");
    assert!(store.extract(id, &output).is_err());
    assert!(!output.exists());
    assert!(store.read_bytes(id).is_err());
    assert_eq!(fs::read_dir(user.path()).unwrap().count(), 1);
}

#[test]
fn an_oversize_declared_snapshot_is_refused_before_extraction() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    fs::write(&path, "one").unwrap();
    let mut store = VersionStore::open(dir.path()).unwrap();
    let id = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    let connection = rusqlite::Connection::open(dir.path().join("index.sqlite3")).unwrap();
    connection
        .execute(
            "UPDATE versions SET size = ?1 WHERE id = ?2",
            rusqlite::params![(MAX_SNAPSHOT_BYTES + 1) as i64, id],
        )
        .unwrap();
    drop(connection);
    let output = user.path().join("out.txt");
    assert_eq!(store.extract(id, &output), Err(StoreError::TooLarge));
    assert!(!output.exists());
}
