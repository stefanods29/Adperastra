//! Step 05a: remembered view per folder.

use fs_service::{is_view_mode, FolderView, FolderViews, MAX_FOLDER_VIEWS};
use std::fs;

#[test]
fn set_then_get_matches_every_form_of_the_path() {
    let mut views = FolderViews::default();
    assert!(views.set(r"C:\Photos", "largeIcons", 10));
    assert_eq!(views.get(r"c:\photos\"), Some("largeIcons"));
    assert_eq!(views.get(r"\\?\C:\Photos"), Some("largeIcons"));
    assert_eq!(views.get(r"C:\Photos"), Some("largeIcons"));
    assert_eq!(views.get(r"C:\Other"), None);
}

#[test]
fn set_replaces_the_old_entry_and_moves_it_first() {
    let mut views = FolderViews::default();
    views.set(r"C:\A", "largeIcons", 1);
    views.set(r"C:\B", "tiles", 2);
    assert!(views.set(r"c:\a", "content", 3));
    assert_eq!(views.folders.len(), 2);
    assert_eq!(views.folders[0].path, r"c:\a");
    assert_eq!(views.folders[0].mode, "content");
    assert_eq!(views.folders[0].used_unix, 3);
    assert_eq!(views.folders[1].path, r"C:\B");
}

#[test]
fn refuses_unknown_views_and_bad_paths() {
    let mut views = FolderViews::default();
    assert!(!views.set(r"C:\A", "huge", 1));
    assert!(!views.set("   ", "list", 1));
    let long = format!(r"C:\{}", "a".repeat(1100));
    assert!(!views.set(&long, "list", 1));
    assert!(views.folders.is_empty());
}

#[test]
fn keeps_at_most_the_newest_1000() {
    let mut views = FolderViews::default();
    for i in 0..=1000 {
        views.set(&format!(r"C:\F{i}"), "list", i);
    }
    assert_eq!(views.folders.len(), MAX_FOLDER_VIEWS);
    assert_eq!(views.get(r"C:\F0"), None);
    assert_eq!(views.get(r"C:\F1000"), Some("list"));
}

#[test]
fn saves_and_loads_the_same_list() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("folder-views.json");
    let mut views = FolderViews::default();
    views.set(r"C:\A", "tiles", 1);
    views.set(r"C:\B", "list", 2);
    views.save(&file).unwrap();
    let loaded = FolderViews::load(&file);
    assert_eq!(loaded, views);
}

#[test]
fn a_missing_or_corrupt_file_loads_empty() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("folder-views.json");
    assert_eq!(FolderViews::load(&missing), FolderViews::default());
    let corrupt = dir.path().join("corrupt.json");
    fs::write(&corrupt, "not json").unwrap();
    assert_eq!(FolderViews::load(&corrupt), FolderViews::default());
}

#[test]
fn load_drops_invalid_entries_and_keeps_the_newest_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("folder-views.json");
    let value = serde_json::json!({
        "schema_version": 1,
        "folders": [
            { "path": r"C:\A", "mode": "list", "used_unix": 5 },
            { "path": r"c:\a\", "mode": "tiles", "used_unix": 9 },
            { "path": r"C:\B", "mode": "giant", "used_unix": 7 }
        ]
    });
    fs::write(&file, serde_json::to_string(&value).unwrap()).unwrap();
    let loaded = FolderViews::load(&file);
    assert_eq!(loaded.schema_version, 1);
    assert_eq!(
        loaded.folders,
        vec![FolderView {
            path: r"c:\a\".to_string(),
            mode: "tiles".to_string(),
            used_unix: 9,
        }]
    );
}

#[test]
fn clear_forgets_everything() {
    let mut views = FolderViews::default();
    views.set(r"C:\A", "tiles", 1);
    views.clear();
    assert!(views.folders.is_empty());
    assert_eq!(views.get(r"C:\A"), None);
}

#[test]
fn view_mode_ids_are_exact() {
    assert!(is_view_mode("details"));
    assert!(!is_view_mode("Details"));
    assert!(!is_view_mode(""));
}
