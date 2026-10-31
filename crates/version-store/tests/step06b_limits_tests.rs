//! Step 06b: the store keeps within its time and size limits.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;
use version_store::{snapshot_to_pending, VersionStore};

const NOW: u64 = 1_700_000_000;
const DAY: u64 = 86_400;

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

fn user_file(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, text).unwrap();
    path
}

fn content(index: usize) -> String {
    format!("{index:0<100}")
}

#[test]
fn trim_removes_versions_older_than_the_limit() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_dir.path().join("a.txt");
    for (index, days) in [1u64, 10, 40].into_iter().enumerate() {
        fs::write(&a, content(index)).unwrap();
        snapshot_to_pending(store_dir.path(), &a, "save", NOW - days * DAY).unwrap();
    }
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(NOW).unwrap();

    assert_eq!(store.trim(30, u64::MAX, NOW), Ok(1));
    let versions = store.list(&a.to_string_lossy()).unwrap();
    assert_eq!(versions.len(), 2);
    assert!(versions
        .iter()
        .all(|version| version.created_unix >= NOW - 30 * DAY));
}

#[test]
fn trim_keeps_the_size_within_the_limit() {
    let contents = [content(1), content(2), content(3)];
    let sizes: Vec<u64> = contents
        .iter()
        .map(|text| {
            let single_dir = tempdir().unwrap();
            let single_user = tempdir().unwrap();
            let file = user_file(single_user.path(), "a.txt", text);
            snapshot_to_pending(single_dir.path(), &file, "save", 100).unwrap();
            let mut store = VersionStore::open(single_dir.path()).unwrap();
            store.import_pending(200).unwrap();
            store.stored_bytes().unwrap()
        })
        .collect();

    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_dir.path().join("a.txt");
    for (index, text) in contents.iter().enumerate() {
        fs::write(&a, text).unwrap();
        snapshot_to_pending(store_dir.path(), &a, "save", NOW - 3 + index as u64).unwrap();
    }
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(NOW).unwrap();
    assert_eq!(store.stored_bytes().unwrap(), sizes.iter().sum::<u64>());

    assert_eq!(store.trim(365, sizes[1] + sizes[2], NOW), Ok(1));
    assert!(store.stored_bytes().unwrap() <= sizes[1] + sizes[2]);
    assert_eq!(store.list(&a.to_string_lossy()).unwrap().len(), 2);
}

#[test]
fn shared_content_stays_until_its_last_version_goes() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "same");
    let b = user_file(user_dir.path(), "b.txt", "same");
    snapshot_to_pending(store_dir.path(), &a, "save", NOW - 40 * DAY).unwrap();
    snapshot_to_pending(store_dir.path(), &b, "save", NOW - DAY).unwrap();
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(NOW).unwrap();
    let b_id = store.list(&b.to_string_lossy()).unwrap()[0].id;

    assert_eq!(store.trim(30, u64::MAX, NOW), Ok(1));
    assert!(store.list(&a.to_string_lossy()).unwrap().is_empty());
    assert_eq!(store.list(&b.to_string_lossy()).unwrap().len(), 1);
    assert!(store.stored_bytes().unwrap() > 0);
    assert_eq!(store.read_bytes(b_id).unwrap(), b"same");
    assert_eq!(files_under(&store_dir.path().join("blobs")), 1);
}

#[test]
fn delete_all_empties_the_store() {
    let store_dir = tempdir().unwrap();
    let user_dir = tempdir().unwrap();
    let a = user_file(user_dir.path(), "a.txt", "one");
    snapshot_to_pending(store_dir.path(), &a, "save", 100).unwrap();
    let mut store = VersionStore::open(store_dir.path()).unwrap();
    store.import_pending(200).unwrap();
    let id = store.list(&a.to_string_lossy()).unwrap()[0].id;
    store
        .extract(
            id,
            &store_dir.path().join("open").join(format!("{id}-a.txt")),
        )
        .unwrap();

    store.delete_all().unwrap();
    assert!(store.list(&a.to_string_lossy()).unwrap().is_empty());
    assert_eq!(store.stored_bytes().unwrap(), 0);
    assert_eq!(files_under(&store_dir.path().join("blobs")), 0);
    assert_eq!(files_under(&store_dir.path().join("open")), 0);
}
