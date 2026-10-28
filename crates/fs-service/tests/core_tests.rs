use fs_service::{
    coalesce_events, list_dir, natural_cmp, read_range, sort_items, stat_path, validate_new_name,
    validate_path_input, ExplorerState, FsEvent, FsEventKind, ItemKind, SortDirection, SortKey,
    SortSpec,
};
use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;

fn names(items: &[fs_service::Item]) -> Vec<String> {
    items.iter().map(|i| i.name.clone()).collect()
}

#[test]
fn natural_sort_orders_numbers_inside_names() {
    assert_eq!(natural_cmp("file2.txt", "file10.txt"), Ordering::Less);
    assert_eq!(natural_cmp("file10.txt", "file2.txt"), Ordering::Greater);
    assert_eq!(natural_cmp("a01", "a1"), Ordering::Equal);
    // Case-insensitive: Windows folders are not case-sensitive for users.
    assert_eq!(natural_cmp("Beta", "alpha"), Ordering::Greater);
    assert_eq!(natural_cmp("alpha", "Alpha"), Ordering::Equal);
}

#[test]
fn sort_items_puts_folders_first_then_natural_name() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("file10.txt"), b"x").unwrap();
    fs::write(dir.path().join("file2.txt"), b"x").unwrap();
    fs::create_dir(dir.path().join("Zoo")).unwrap();
    fs::create_dir(dir.path().join("apple")).unwrap();

    let listing = list_dir(dir.path(), SortSpec::default()).unwrap();
    assert_eq!(
        names(&listing.items),
        vec!["apple", "Zoo", "file2.txt", "file10.txt"]
    );
    assert!(listing.items[0].kind == ItemKind::Folder);
    assert!(listing.skipped.is_empty());
}

#[test]
fn sort_items_by_size_descending_keeps_folders_first() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("small.txt"), b"x").unwrap();
    fs::write(dir.path().join("big.txt"), b"0123456789").unwrap();
    fs::create_dir(dir.path().join("folder")).unwrap();

    let mut items = list_dir(dir.path(), SortSpec::default()).unwrap().items;
    sort_items(
        &mut items,
        SortSpec {
            key: SortKey::Size,
            direction: SortDirection::Descending,
        },
    );
    assert_eq!(names(&items), vec!["folder", "big.txt", "small.txt"]);
}

#[test]
fn list_stat_and_read_range_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("hello.txt");
    fs::write(&file, b"hello world").unwrap();

    let item = stat_path(&file).unwrap();
    assert_eq!(item.kind, ItemKind::File);
    assert_eq!(item.size, 11);
    assert!(
        !item.attrs.online_only,
        "a normal local file is not online-only"
    );
    assert!(!item.attrs.hidden);

    assert_eq!(read_range(&file, 0, 5).unwrap(), b"hello");
    assert_eq!(read_range(&file, 6, 100).unwrap(), b"world");
    // Range length is capped rather than allocating unbounded memory.
    assert!(read_range(&file, 0, usize::MAX).unwrap().len() <= 11);
    assert!(
        read_range(&file, u64::MAX, 4).is_err()
            || read_range(&file, u64::MAX, 4).unwrap().is_empty()
    );
}

#[test]
fn validate_new_name_rejects_reserved_and_tricky_names() {
    for bad in [
        "", " ", "CON", "con.txt", "NUL", "COM1", "LPT9", "name.", "name ", "a/b", "a\\b", "a:b",
        "..", ".",
    ] {
        assert!(
            validate_new_name(bad).is_err(),
            "expected {bad:?} to be rejected"
        );
    }
    for good in ["report.docx", "My folder", "file2.txt", "COM10", "console"] {
        assert!(
            validate_new_name(good).is_ok(),
            "expected {good:?} to be accepted"
        );
    }
}

#[test]
fn validate_path_input_rejects_empty_and_overlong() {
    assert!(validate_path_input("").is_err());
    assert!(validate_path_input("   ").is_err());
    assert!(validate_path_input(&"a".repeat(32768)).is_err());
    assert!(validate_path_input("C:\\Users").is_ok());
}

#[test]
fn explorer_state_round_trip_and_dedup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("explorer-state.json");
    let mut state = ExplorerState::default();
    state.pin(r"C:\Users\me\Desktop".to_string());
    state.pin(r"c:\users\me\desktop".to_string()); // same folder, different case
    state.pin(r"D:\Projects".to_string());
    assert_eq!(state.pinned_folders.len(), 2);
    state.record_recent(r"D:\Projects".to_string());
    state.record_recent(r"C:\Temp".to_string());
    state.record_recent(r"D:\Projects".to_string()); // moves to front, no duplicate
    assert_eq!(
        state.recent_folders,
        vec![r"D:\Projects".to_string(), r"C:\Temp".to_string()]
    );

    state.save(&path).unwrap();
    let loaded = ExplorerState::load(&path);
    assert_eq!(loaded, state);

    state.unpin(r"d:\projects");
    assert_eq!(
        state.pinned_folders,
        vec![r"C:\Users\me\Desktop".to_string()]
    );
    // A corrupt file loads as defaults instead of failing startup.
    fs::write(&path, b"{not json").unwrap();
    assert_eq!(ExplorerState::load(&path), ExplorerState::default());
    let missing: PathBuf = dir.path().join("missing.json");
    assert_eq!(ExplorerState::load(&missing), ExplorerState::default());
}

#[test]
fn coalesce_events_dedups_and_caps_with_rescan() {
    let mk = |kind: FsEventKind, p: &str| FsEvent {
        kind,
        path: PathBuf::from(p),
    };
    let input = vec![
        mk(FsEventKind::Created, "a.txt"),
        mk(FsEventKind::Created, "a.txt"),
        mk(FsEventKind::Modified, "a.txt"),
        mk(FsEventKind::Removed, "b.txt"),
        mk(FsEventKind::Modified, "a.txt"),
    ];
    let out = coalesce_events(input, 100);
    assert_eq!(out.len(), 3);
    assert!(out
        .iter()
        .any(|e| e.kind == FsEventKind::Created && e.path.ends_with("a.txt")));
    assert!(out.iter().any(|e| e.kind == FsEventKind::Removed));

    // A burst over the cap collapses to a single Rescan so the UI reloads once.
    let burst: Vec<FsEvent> = (0..50)
        .map(|i| mk(FsEventKind::Created, &format!("f{i}.txt")))
        .collect();
    let out = coalesce_events(burst, 4);
    assert_eq!(
        out,
        vec![FsEvent {
            kind: FsEventKind::Rescan,
            path: PathBuf::new()
        }]
    );
}

#[test]
fn list_missing_or_file_path_is_an_error_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    assert!(list_dir(&dir.path().join("nope"), SortSpec::default()).is_err());
    let file = dir.path().join("f.txt");
    fs::write(&file, b"x").unwrap();
    assert!(list_dir(&file, SortSpec::default()).is_err());
    assert!(stat_path(&dir.path().join("nope")).is_err());
}

#[test]
fn watcher_reports_a_new_file_and_stops_on_unwatch() {
    use fs_service::FsWatcher;
    use std::time::{Duration, Instant};

    let dir = tempfile::tempdir().unwrap();
    let mut watcher = FsWatcher::new().unwrap();
    watcher.watch(dir.path()).unwrap();
    assert_eq!(watcher.current(), Some(&dir.path().to_path_buf()));

    fs::write(dir.path().join("new.txt"), b"x").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut saw_created = false;
    while Instant::now() < deadline {
        let events = watcher.drain_batched();
        if events
            .iter()
            .any(|e| e.kind == FsEventKind::Created && e.path.ends_with("new.txt"))
        {
            saw_created = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(saw_created, "watcher did not report the new file within 5s");

    watcher.unwatch();
    assert_eq!(watcher.current(), None);
}
