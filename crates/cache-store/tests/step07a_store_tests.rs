use std::fs::{File, OpenOptions};
use std::path::Path;

use cache_store::{CacheError, CacheKey, CacheKind, CacheStore, SourceStamp};

fn key(name: &str) -> CacheKey {
    CacheKey {
        source: SourceStamp {
            path_key: format!(r"c:\pictures\{name}"),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "0020000000000001".to_string(),
            modified_ticks: "133000000000000010".to_string(),
            size_bytes: 60,
        },
        kind: CacheKind::Thumbnail,
        handler_id: "wic".to_string(),
        handler_version: 1,
        options_key: "edge=64".to_string(),
    }
}

fn prepared(dir: &Path, name: &str, size: usize) -> File {
    let path = dir.join(name);
    std::fs::write(&path, vec![7u8; size]).unwrap();
    File::open(path).unwrap()
}

fn blob_of(store: &CacheStore, record: &cache_store::CacheRecord) -> std::path::PathBuf {
    store
        .root()
        .join("blobs")
        .join(format!("{}.png", record.blob_id))
}

#[test]
fn a_small_budget_evicts_the_oldest_unleased_blob() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 2 * 1024 * 1024).unwrap();
    let first = prepared(dir.path(), "first.bin", 1024 * 1024);
    let old = store
        .publish(&key("old.png"), &first, "image/png", Some(8), Some(8))
        .unwrap();
    // The explicit timestamps distinguish access order without sleeping.
    rusqlite::Connection::open(store.root().join("index.sqlite3"))
        .unwrap()
        .execute("UPDATE entries SET used_unix=0", [])
        .unwrap();
    let second = prepared(dir.path(), "second.bin", 1024 * 1024);
    let new = store
        .publish(&key("new.png"), &second, "image/png", Some(8), Some(8))
        .unwrap();

    assert_eq!(store.lookup(&key("old.png")).unwrap(), None);
    assert_eq!(
        store.lookup(&key("new.png")).unwrap().map(|r| r.blob_id),
        Some(new.blob_id.clone())
    );
    assert!(!blob_of(&store, &old).exists());
    let usage = store.usage().unwrap();
    assert!(
        usage.disk_bytes >= new.byte_len,
        "index and blob bytes are accounted"
    );
    assert!(
        usage.disk_bytes <= usage.limit_bytes,
        "the physical cap is never a content-only budget"
    );
    assert_eq!(usage.entry_count, 1);
}

#[test]
fn a_lease_keeps_the_old_blob_and_refuses_admission() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 2 * 1024 * 1024).unwrap();
    let first = prepared(dir.path(), "first.bin", 1024 * 1024);
    let old = store
        .publish(&key("old.png"), &first, "image/png", Some(8), Some(8))
        .unwrap();

    // Same share mode the lease service uses: readers keep the blob alive.
    let _lease = open_reading(&blob_of(&store, &old));
    let second = prepared(dir.path(), "second.bin", 1024 * 1024);
    assert_eq!(
        store.publish(&key("new.png"), &second, "image/png", Some(8), Some(8)),
        Err(CacheError::Busy)
    );
    assert!(store.lookup(&key("old.png")).unwrap().is_some());
    assert_eq!(store.lookup(&key("new.png")).unwrap(), None);
    let usage = store.usage().unwrap();
    assert_eq!(usage.leased_count, 1);

    // Clear cannot break the reader; the bytes stay accounted.
    let cleared = store.clear(None).unwrap();
    assert!(cleared.pending_delete_bytes >= 60);
    assert!(blob_of(&store, &old).exists());
}

#[test]
fn clear_leaves_foreign_files_alone() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(dir.path(), 10 * 1024 * 1024).unwrap();
    let foreign = store.root().join("blobs").join("foreign.bin");
    std::fs::write(&foreign, b"not ours").unwrap();
    let note = store.root().join("note.txt");
    std::fs::write(&note, b"keep me").unwrap();
    let source = prepared(dir.path(), "source.bin", 60);
    store
        .publish(&key("a.png"), &source, "image/png", None, None)
        .unwrap();

    store.clear(None).unwrap();
    assert_eq!(std::fs::read(&foreign).unwrap(), b"not ours");
    assert_eq!(std::fs::read(&note).unwrap(), b"keep me");
}

#[test]
fn an_interrupted_publication_is_never_a_hit() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(dir.path(), 10 * 1024 * 1024).unwrap();
    let source = prepared(dir.path(), "prepared.bin", 60);
    let record = store
        .publish(&key("old.png"), &source, "image/png", None, None)
        .unwrap();
    let root = store.root().to_path_buf();
    let blob = blob_of(&store, &record);
    drop(store);
    {
        let connection = rusqlite::Connection::open(root.join("index.sqlite3")).unwrap();
        // Model a crash at the commit boundary while retaining the real
        // native ownership receipt established by exclusive creation.
        connection
            .execute("DELETE FROM entries WHERE key_hash=?1", [&record.key_hash])
            .unwrap();
        connection
            .execute(
                "INSERT INTO pending(blob_id,key_hash,expected_len,state)
            VALUES (?1,?2,60,'published')",
                rusqlite::params![record.blob_id, record.key_hash],
            )
            .unwrap();
    }

    let store = CacheStore::open(&root, 10 * 1024 * 1024).unwrap();
    assert_eq!(store.lookup(&key("old.png")).unwrap(), None);
    store.clear(None).unwrap();
    assert!(!blob.exists(), "an uncommitted owned blob is cleaned up");
}

#[cfg(windows)]
fn open_reading(path: &Path) -> File {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
    OpenOptions::new()
        .access_mode(GENERIC_READ.0)
        .share_mode(FILE_SHARE_READ.0)
        .open(path)
        .unwrap()
}

#[cfg(not(windows))]
fn open_reading(path: &Path) -> File {
    File::open(path).unwrap()
}

#[test]
fn a_recent_hit_is_retained_before_an_untouched_entry() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 2 * 1024 * 1024).unwrap();
    let source = prepared(dir.path(), "prepared.bin", 512 * 1024);
    let first = store
        .publish(&key("recent.png"), &source, "image/png", None, None)
        .unwrap();
    let second = store
        .publish(&key("untouched.png"), &source, "image/png", None, None)
        .unwrap();
    let connection = rusqlite::Connection::open(store.root().join("index.sqlite3")).unwrap();
    connection
        .execute(
            "UPDATE entries SET used_unix=0 WHERE key_hash=?1",
            [&first.key_hash],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE entries SET used_unix=1 WHERE key_hash=?1",
            [&second.key_hash],
        )
        .unwrap();
    drop(connection);
    assert!(store.lookup(&key("recent.png")).unwrap().is_some());
    store
        .publish(&key("third.png"), &source, "image/png", None, None)
        .unwrap();
    assert!(store.lookup(&key("recent.png")).unwrap().is_some());
    assert!(store.lookup(&key("untouched.png")).unwrap().is_none());
    assert!(store.lookup(&key("third.png")).unwrap().is_some());
    assert!(store.usage().unwrap().disk_bytes <= store.limit_bytes());
}
