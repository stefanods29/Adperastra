//! Step 11a T3: rename identity, overflow rescans and subscription lifetime.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use fs_service::new_cancellation_token;
use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use fs_service::ItemKind;
use search_index::index_watch::{WatchAction, WatchEvent, WatchKind, WatchRouter};
use search_index::store::SearchStore;
use search_index::types::{IndexRoot, ScannedFile, SearchMode, SearchQuery};

fn scanned(path: &std::path::Path, index: u64) -> ScannedFile {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let file_id = format!("{index:016x}");
    ScannedFile {
        identity: FileIdentityKey {
            volume_id: "00000001".to_string(),
            file_id: file_id.clone(),
            path_key: path.to_string_lossy().to_lowercase(),
            stable: true,
        },
        stamp: SourceStamp {
            path_key: path.to_string_lossy().to_lowercase(),
            volume_id: "00000001".to_string(),
            file_id,
            modified_ticks: "1".to_string(),
            size_bytes: 10,
        },
        path: path.to_path_buf(),
        name,
        extension: "txt".to_string(),
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

fn event(
    subscription_id: &str,
    generation: u64,
    kind: WatchKind,
    path: Option<&str>,
    old_path: Option<&str>,
) -> WatchEvent {
    WatchEvent {
        subscription_id: subscription_id.to_string(),
        root_id: "root".to_string(),
        root: PathBuf::from(r"C:\Docs"),
        generation,
        kind,
        path: path.map(PathBuf::from),
        old_path: old_path.map(PathBuf::from),
        error_code: None,
    }
}

#[test]
fn a_paired_rename_keeps_identity_and_updates_the_path() {
    let directory = tempfile::tempdir().unwrap();
    let mut store =
        SearchStore::open(&directory.path().join("index.sqlite3"), 64 * 1024 * 1024).unwrap();
    let root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    store.set_roots(std::slice::from_ref(&root)).unwrap();
    let old = directory.path().join("old.txt");
    let file = scanned(&old, 1);
    store
        .apply_batch(&root.id, &[(file.clone(), None)])
        .unwrap();
    let new = directory.path().join("new.txt");
    store
        .rename_path(
            &root.id,
            &old.to_string_lossy(),
            &new.to_string_lossy(),
            &file.identity,
            &file.stamp,
        )
        .unwrap();
    assert_eq!(store.file_count().unwrap(), 1);
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: "new".to_string(),
        ..SearchQuery::default()
    };
    let page = store
        .search(
            &query,
            0,
            50,
            Instant::now() + Duration::from_secs(2),
            &new_cancellation_token(),
        )
        .unwrap();
    assert_eq!(page.results.len(), 1);
    assert_eq!(page.results[0].item.path, new.to_string_lossy().to_string());
}

#[test]
fn an_overflow_rescans_and_rotates_the_generation() {
    let mut router = WatchRouter::new();
    let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
    let before = router.generation();
    let action = router.route(&event(
        &subscription.subscription_id,
        subscription.generation,
        WatchKind::Overflow,
        None,
        None,
    ));
    assert!(matches!(action, WatchAction::Rescan { .. }));
    assert!(router.generation() > before);
}

#[test]
fn one_unsubscribe_leaves_the_other_subscription() {
    let mut router = WatchRouter::new();
    let first = router.subscribe("one", std::path::Path::new(r"C:\One"));
    let second = router.subscribe("two", std::path::Path::new(r"C:\Two"));
    assert!(router.unsubscribe(&first.subscription_id));
    let action = router.route(&event(
        &second.subscription_id,
        second.generation,
        WatchKind::Change,
        Some(r"C:\Two\a.txt"),
        None,
    ));
    assert!(matches!(action, WatchAction::Upsert { .. }));
}

#[test]
fn a_stale_generation_is_ignored() {
    let mut router = WatchRouter::new();
    let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
    let stale = subscription.generation;
    router.rotate();
    let action = router.route(&event(
        &subscription.subscription_id,
        stale,
        WatchKind::Change,
        Some(r"C:\Docs\a.txt"),
        None,
    ));
    assert_eq!(action, WatchAction::Ignore);
}
