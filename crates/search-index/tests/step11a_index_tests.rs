//! Step 11a T2: bounded roots, deduplication, limits and partial failure.

use std::path::Path;
use std::time::{Duration, Instant};

use fs_service::new_cancellation_token;
use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use fs_service::ItemKind;
use search_index::limits::{physical_bytes, MAX_INDEX_RECORDS};
use search_index::scan::first_visit;
use search_index::store::SearchStore;
use search_index::types::{IndexRoot, ScannedFile, SearchMode, SearchQuery};

fn scanned(path: &Path, index: u64, stable: bool) -> ScannedFile {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.txt".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let file_id = format!("{index:016x}");
    ScannedFile {
        identity: FileIdentityKey {
            volume_id: "00000001".to_string(),
            file_id: file_id.clone(),
            path_key: path.to_string_lossy().to_lowercase(),
            stable,
        },
        stamp: SourceStamp {
            path_key: path.to_string_lossy().to_lowercase(),
            volume_id: "00000001".to_string(),
            file_id,
            modified_ticks: format!("{index}"),
            size_bytes: 10,
        },
        path: path.to_path_buf(),
        name,
        extension,
        kind: ItemKind::File,
        size: 10,
        modified_unix: 1_700_000_000,
        created_unix: 1_600_000_000,
        date_taken_unix: None,
        width: None,
        height: None,
        duration_ms: None,
        pages: None,
        author: None,
        hidden: false,
        system: false,
        is_link: false,
        online_only: false,
    }
}

fn store(directory: &tempfile::TempDir) -> SearchStore {
    SearchStore::open(&directory.path().join("index.sqlite3"), 64 * 1024 * 1024).unwrap()
}

fn search_name(store: &SearchStore, text: &str) -> usize {
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: text.to_string(),
        ..SearchQuery::default()
    };
    store
        .search(
            &query,
            0,
            50,
            Instant::now() + Duration::from_secs(2),
            &new_cancellation_token(),
        )
        .unwrap()
        .results
        .len()
}

#[test]
fn overlapping_roots_index_one_file_once() {
    let directory = tempfile::tempdir().unwrap();
    let file_path = directory.path().join("report.txt");
    std::fs::write(&file_path, b"report").unwrap();
    let first_root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    let second_root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    let mut store = store(&directory);
    store
        .set_roots(&[first_root.clone(), second_root.clone()])
        .unwrap();
    let file = scanned(&file_path, 1, true);
    store
        .apply_batch(&first_root.id, &[(file.clone(), None)])
        .unwrap();
    let second = store
        .apply_batch(&second_root.id, &[(file.clone(), None)])
        .unwrap();
    assert_eq!(second.unchanged, 1);
    assert_eq!(store.file_count().unwrap(), 1);
    assert_eq!(
        store
            .root_member_count("00000001:0000000000000001")
            .unwrap(),
        2
    );
    assert_eq!(search_name(&store, "report"), 1);
}

#[test]
fn a_loop_identity_is_visited_once() {
    let mut visited = std::collections::HashSet::new();
    let identity = FileIdentityKey {
        volume_id: "00000001".to_string(),
        file_id: "0000000000000002".to_string(),
        path_key: r"c:\docs\loop".to_string(),
        stable: true,
    };
    assert!(first_visit(&mut visited, &identity));
    assert!(!first_visit(&mut visited, &identity));
}

#[test]
fn the_cap_plus_one_pauses_and_keeps_valid_rows() {
    let directory = tempfile::tempdir().unwrap();
    let db = directory.path().join("index.sqlite3");
    let mut store = SearchStore::open_with_caps(&db, 64 * 1024 * 1024, 3).unwrap();
    let root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    store.set_roots(std::slice::from_ref(&root)).unwrap();
    let entries: Vec<_> = (1..=4)
        .map(|index| {
            let file = scanned(
                &directory.path().join(format!("file{index}.txt")),
                index,
                true,
            );
            (file, None)
        })
        .collect();
    let report = store.apply_batch(&root.id, &entries).unwrap();
    assert!(report.limit_reached);
    assert_eq!(store.file_count().unwrap(), 3);
    let status = store.status().unwrap();
    assert!(status.limit_reached);
    assert!(status.paused);
}

#[test]
fn a_narrow_budget_pauses_on_physical_bytes_including_wal() {
    let directory = tempfile::tempdir().unwrap();
    let db = directory.path().join("index.sqlite3");
    let mut store = SearchStore::open_with_caps(&db, 1, 100).unwrap();
    let root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    store.set_roots(std::slice::from_ref(&root)).unwrap();
    let file = scanned(&directory.path().join("a.txt"), 1, true);
    store.apply_batch(&root.id, &[(file, None)]).unwrap();
    let status = store.status().unwrap();
    assert!(status.paused);
    assert!(status.disk_bytes > 1);
    assert_eq!(status.disk_bytes, physical_bytes(&db));
}

#[test]
fn a_skipped_entry_is_partial_not_empty() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = store(&directory);
    let root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    store.set_roots(std::slice::from_ref(&root)).unwrap();
    let file = scanned(&directory.path().join("a.txt"), 1, true);
    store.apply_batch(&root.id, &[(file, None)]).unwrap();
    store.set_skipped(2).unwrap();
    let status = store.status().unwrap();
    assert_eq!(status.files_count, 1);
    assert_eq!(status.skipped_count, 2);
    assert_eq!(
        status.coverage,
        search_index::types::SearchCoverage::Partial
    );
}

#[test]
fn the_documented_cap_is_one_million_rows() {
    assert_eq!(MAX_INDEX_RECORDS, 1_000_000);
}
