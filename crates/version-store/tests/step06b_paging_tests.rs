//! Cursor pages preserve the existing date/id order without duplicates.

use std::collections::HashSet;
use std::fs;

use tempfile::tempdir;
use version_store::{StoreError, VersionStore};

#[test]
fn pages_preserve_date_then_id_order_including_equal_timestamps() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    let mut store = VersionStore::open(dir.path()).unwrap();
    for (index, created) in [100, 300, 200, 300, 50].into_iter().enumerate() {
        fs::write(&path, format!("version {index}")).unwrap();
        store.snapshot_current(&path, "save", created).unwrap();
    }
    let expected = store.list(&path.to_string_lossy()).unwrap();
    assert_eq!(
        expected
            .iter()
            .map(|version| version.created_unix)
            .collect::<Vec<_>>(),
        [300, 300, 200, 100, 50]
    );
    let mut collected = Vec::new();
    let mut cursor = None;
    loop {
        let page = store.list_page(&path.to_string_lossy(), cursor, 2).unwrap();
        assert!(page.len() <= 2);
        if page.is_empty() {
            break;
        }
        cursor = page.last().map(|version| version.id);
        collected.extend(page);
    }
    assert_eq!(collected, expected);
    assert_eq!(
        collected
            .iter()
            .map(|version| version.id)
            .collect::<HashSet<_>>()
            .len(),
        5
    );
    assert!(store
        .list_page(&path.to_string_lossy(), None, 0)
        .unwrap()
        .is_empty());
}

#[test]
fn a_page_cursor_must_belong_to_the_requested_file() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    let other = user.path().join("b.txt");
    let mut store = VersionStore::open(dir.path()).unwrap();
    fs::write(&path, "one").unwrap();
    let id = store.snapshot_current(&path, "save", 100).unwrap().unwrap();
    assert_eq!(
        store.list_page(&other.to_string_lossy(), Some(id), 2),
        Err(StoreError::NotFound)
    );
    assert_eq!(
        store.list_page(&path.to_string_lossy(), Some(0), 2),
        Err(StoreError::NotFound)
    );
    assert_eq!(
        store.list_page(&path.to_string_lossy(), Some(-1), 2),
        Err(StoreError::NotFound)
    );
}

#[test]
fn newer_snapshots_between_pages_do_not_duplicate_an_older_page() {
    let dir = tempdir().unwrap();
    let user = tempdir().unwrap();
    let path = user.path().join("a.txt");
    let mut store = VersionStore::open(dir.path()).unwrap();
    for created in 100..104 {
        fs::write(&path, format!("version {created}")).unwrap();
        store.snapshot_current(&path, "save", created).unwrap();
    }
    let original = store.list(&path.to_string_lossy()).unwrap();
    let first = store.list_page(&path.to_string_lossy(), None, 2).unwrap();
    fs::write(&path, "newest").unwrap();
    store.snapshot_current(&path, "save", 200).unwrap();
    let second = store
        .list_page(&path.to_string_lossy(), first.last().map(|row| row.id), 2)
        .unwrap();
    assert_eq!([first, second].concat(), original);
}
