//! Step 11c T2 native cache/page oracles. Written, not executed here.

use ::storage_scan::{
    Coverage, ScanSink, StorageNode, StorageNodeKind, StorageSummary,
};
use fs_service::FileIdentityKey;

use crate::storage_store::StorageStore;

fn identity(path: &str) -> FileIdentityKey {
    FileIdentityKey {
        volume_id: "00000001".to_string(),
        file_id: "0000000000000001".to_string(),
        path_key: path.to_lowercase(),
        stable: true,
    }
}

fn node(scan_id: &str, id: &str, parent: Option<&str>, name: &str, size: u64) -> StorageNode {
    let _ = scan_id;
    StorageNode {
        id: id.to_string(),
        parent_id: parent.map(str::to_string),
        key: identity(&format!("c:\\scan\\{name}")),
        path: format!("C:\\scan\\{name}"),
        name: name.to_string(),
        kind: StorageNodeKind::File,
        logical_bytes: size,
        allocated_bytes: Some(size),
        item_count: 0,
        online_only: false,
        coverage: Coverage::Complete,
        children_count: 0,
    }
}

fn summary(scan_id: &str, root: &str, generation: u64) -> StorageSummary {
    StorageSummary {
        scan_id: scan_id.to_string(),
        root: root.to_string(),
        logical_bytes: 10,
        allocated_unique_bytes: Some(10),
        unknown_allocated_count: 0,
        files_count: 1,
        folders_count: 1,
        link_count: 0,
        skipped_count: 0,
        coverage: Coverage::Complete,
        cancelled: false,
        stale: false,
        generation,
        calculated_unix: 1_700_000_000,
        reason_codes: Vec::new(),
    }
}

#[test]
fn database_and_wal_are_included_in_usage() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = StorageStore::open(dir.path()).unwrap();
    store
        .begin_scan("scan-a", "c:\\scan", 4, "options", 1_700_000_000)
        .unwrap();
    store.bind_scan("scan-a");
    store
        .record_node(node("scan-a", "root", None, "scan", 0))
        .unwrap();
    store
        .record_node(node("scan-a", "child", Some("root"), "a.bin", 10))
        .unwrap();
    store.finish_scan(&summary("scan-a", "C:\\scan", 4)).unwrap();
    let usage = store.usage().unwrap();
    let database = std::fs::metadata(dir.path().join("storage.sqlite"))
        .unwrap()
        .len();
    assert!(usage.disk_bytes >= database);
    assert_eq!(usage.scan_count, 1);
    let wal = dir.path().join("storage.sqlite-wal");
    let wal_bytes = std::fs::metadata(wal).map(|meta| meta.len()).unwrap_or(0);
    assert!(usage.disk_bytes >= database + wal_bytes);
}

#[test]
fn cached_first_paint_does_not_require_a_walk() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = StorageStore::open(dir.path()).unwrap();
    store
        .begin_scan("scan-a", "c:\\scan", 4, "options", 1_700_000_000)
        .unwrap();
    store.bind_scan("scan-a");
    store
        .record_node(node("scan-a", "root", None, "scan", 0))
        .unwrap();
    store
        .record_node(node("scan-a", "child", Some("root"), "a.bin", 10))
        .unwrap();
    store.finish_scan(&summary("scan-a", "C:\\scan", 4)).unwrap();

    // A refresh starts for the same key and has no summary yet.
    store
        .begin_scan("scan-b", "c:\\scan", 4, "options", 1_700_000_001)
        .unwrap();
    let cached = store
        .find_cached("c:\\scan", 4, "options", "scan-b")
        .unwrap()
        .expect("a cached page exists");
    assert_eq!(cached.scan_id, "scan-a");
    let page = store.page("scan-a", None, None, true).unwrap();
    assert!(page.summary.stale);
    assert_eq!(page.nodes.len(), 1);
    assert_eq!(page.nodes[0].name, "a.bin");
}

#[test]
fn a_page_never_exceeds_256_nodes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = StorageStore::open(dir.path()).unwrap();
    store
        .begin_scan("scan-a", "c:\\scan", 4, "options", 1_700_000_000)
        .unwrap();
    store.bind_scan("scan-a");
    store
        .record_node(node("scan-a", "root", None, "scan", 0))
        .unwrap();
    for index in 0..300 {
        store
            .record_node(node(
                "scan-a",
                &format!("node-{index}"),
                Some("root"),
                &format!("file-{index}.bin"),
                300 - index,
            ))
            .unwrap();
    }
    store.finish_scan(&summary("scan-a", "C:\\scan", 4)).unwrap();
    let page = store.page("scan-a", None, None, false).unwrap();
    assert_eq!(page.nodes.len(), 256);
    assert!(page.next_cursor.is_some());
    assert!(!page.complete);
    let second = store
        .page("scan-a", None, page.next_cursor.as_deref(), false)
        .unwrap();
    assert_eq!(second.nodes.len(), 44);
    assert!(second.complete);
}

#[test]
fn a_stale_generation_is_marked_not_deleted() {
    use crate::storage_watch::cached_summary_is_stale;
    assert!(cached_summary_is_stale(4, 5, false));
    assert!(cached_summary_is_stale(4, 4, true));
    assert!(!cached_summary_is_stale(4, 4, false));
}

#[test]
fn a_cached_hash_is_valid_only_for_the_same_stamp() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = StorageStore::open(dir.path()).unwrap();
    let path = dir.path().join("hash.bin");
    std::fs::write(&path, b"same").unwrap();
    let stamp = fs_service::capture_source_stamp(&path).unwrap();
    let key = identity(stamp.path_key.as_str());
    let hash = [9u8; 32];
    store.hash_cache_put(&key, &stamp, &hash, 1_700_000_000);
    assert_eq!(store.hash_cache_get(&key, &stamp), Some(hash));
    std::fs::write(&path, b"changed-size").unwrap();
    let changed = fs_service::capture_source_stamp(&path).unwrap();
    assert_eq!(store.hash_cache_get(&key, &changed), None);
}
