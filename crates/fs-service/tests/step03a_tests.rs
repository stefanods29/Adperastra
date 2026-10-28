//! Step 03a: item details, rename in place, favorites.

use fs_service::{
    attribute_names, filetime_to_unix, item_details, rename_error_reason, rename_in_place,
    validate_new_name, ExplorerState, ItemKind,
};
use std::fs;

#[test]
fn rename_changes_the_name_inside_the_same_folder() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("draft.txt");
    fs::write(&old, b"hello").unwrap();
    let new = rename_in_place(&old, "final.txt").unwrap();
    assert_eq!(new, dir.path().join("final.txt"));
    assert!(!old.exists());
    assert_eq!(fs::read(&new).unwrap(), b"hello");
}

#[test]
fn rename_never_overwrites_an_existing_item() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.txt");
    let b = dir.path().join("b.txt");
    fs::write(&a, b"A").unwrap();
    fs::write(&b, b"B").unwrap();
    let error = rename_in_place(&a, "b.txt").unwrap_err();
    assert_eq!(rename_error_reason(&error), "exists");
    assert_eq!(fs::read(&a).unwrap(), b"A");
    assert_eq!(fs::read(&b).unwrap(), b"B");
}

#[test]
fn rename_allows_a_case_only_change_and_folders() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("notes.txt");
    fs::write(&file, b"x").unwrap();
    let renamed = rename_in_place(&file, "Notes.txt").unwrap();
    let names: Vec<String> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["Notes.txt".to_string()]);
    assert_eq!(fs::read(&renamed).unwrap(), b"x");

    let folder = dir.path().join("Old folder");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("inside.txt"), b"kept").unwrap();
    let moved = rename_in_place(&folder, "New folder").unwrap();
    assert_eq!(fs::read(moved.join("inside.txt")).unwrap(), b"kept");
}

#[test]
fn rename_rejects_bad_names_and_keeps_the_item() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("keep.txt");
    fs::write(&file, b"x").unwrap();
    for bad in ["", "a/b.txt", r"..\escape.txt", "CON", "name.", "what?.txt"] {
        let error = rename_in_place(&file, bad).unwrap_err();
        assert_eq!(rename_error_reason(&error), "invalid_name", "{bad:?}");
    }
    assert!(file.exists());
    // Same name: nothing to do, not an error.
    assert_eq!(rename_in_place(&file, "keep.txt").unwrap(), file);
    // Too long for NTFS (255 UTF-16 units).
    assert!(validate_new_name(&"a".repeat(256)).is_err());
    assert!(validate_new_name(&"a".repeat(255)).is_ok());
}

#[test]
fn rename_of_a_missing_item_reports_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let error = rename_in_place(&dir.path().join("gone.txt"), "x.txt").unwrap_err();
    assert_eq!(rename_error_reason(&error), "not_found");
}

#[test]
fn details_report_size_kind_and_times() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("data.bin");
    fs::write(&file, vec![0u8; 1234]).unwrap();
    let details = item_details(&file).unwrap();
    assert_eq!(details.kind, ItemKind::File);
    assert_eq!(details.size, 1234);
    assert!(details.modified_unix > 1_600_000_000);
    assert!(details.created_unix > 1_600_000_000);

    let folder = item_details(dir.path()).unwrap();
    assert_eq!(folder.kind, ItemKind::Folder);
    assert_eq!(folder.size, 0);
    assert!(item_details(&dir.path().join("missing")).is_err());
}

#[cfg(windows)]
#[test]
fn details_list_windows_attributes() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("secret.txt");
    // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_READONLY
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .attributes(0x2 | 0x1)
        .open(&file)
        .unwrap();
    let details = item_details(&file).unwrap();
    assert!(details.attributes.contains(&"hidden".to_string()));
    assert!(details.attributes.contains(&"read_only".to_string()));
    // Clear read-only so the temp dir can be removed.
    let mut permissions = fs::metadata(&file).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&file, permissions).unwrap();
}

#[test]
fn attribute_names_and_filetime_conversion() {
    assert_eq!(attribute_names(0x1 | 0x20), vec!["read_only", "archive"]);
    assert_eq!(attribute_names(0x0040_0000), vec!["online_only"]);
    assert!(attribute_names(0).is_empty());
    // 2026-01-01T00:00:00Z
    assert_eq!(filetime_to_unix(134_116_992_000_000_000), 1_767_225_600);
    assert_eq!(filetime_to_unix(0), 0);
}

#[test]
fn favorites_add_remove_and_survive_a_save() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("explorer-state.json");
    let mut state = ExplorerState::default();
    state.add_favorite(r"C:\Users\me\report.docx".to_string());
    state.add_favorite(r"\\?\C:\Users\me\report.docx".to_string()); // same item
    state.add_favorite(r"D:\Photos".to_string());
    assert_eq!(state.favorites.len(), 2);
    assert!(state.is_favorite(r"c:\users\me\REPORT.docx"));
    state.save(&path).unwrap();
    let loaded = ExplorerState::load(&path);
    assert_eq!(loaded.favorites, state.favorites);
    assert_eq!(loaded.schema_version, 2);

    state.remove_favorite(r"d:\photos");
    assert_eq!(
        state.favorites,
        vec![r"C:\Users\me\report.docx".to_string()]
    );
}

#[test]
fn favorites_follow_a_rename_of_the_item_or_its_folder() {
    let mut state = ExplorerState::default();
    state.add_favorite(r"C:\Work\Draft.docx".to_string());
    state.add_favorite(r"C:\Work\Photos\Beach.jpg".to_string());
    state.add_favorite(r"C:\Other\keep.txt".to_string());
    state.move_favorites(r"c:\work\draft.docx", r"C:\Work\Final.docx");
    assert!(state.is_favorite(r"C:\Work\Final.docx"));
    assert!(!state.is_favorite(r"C:\Work\Draft.docx"));
    state.move_favorites(r"C:\Work", r"C:\Projects");
    assert_eq!(
        state.favorites,
        vec![
            r"C:\Projects\Final.docx".to_string(),
            r"C:\Projects\Photos\Beach.jpg".to_string(),
            r"C:\Other\keep.txt".to_string(),
        ]
    );
}

#[test]
fn moving_favorites_never_splits_a_character() {
    // "İ" becomes two characters when lowercased; this must not panic.
    let mut state = ExplorerState::default();
    state.add_favorite("C:\\İstanbul\\plan.txt".to_string());
    state.add_favorite("C:\\Ünïcode\\a.txt".to_string());
    state.move_favorites("C:\\İstanbul", "C:\\Istanbul");
    state.move_favorites("C:\\İ", "C:\\X");
    assert_eq!(state.favorites[0], "C:\\Istanbul\\plan.txt");
    assert_eq!(state.favorites[1], "C:\\Ünïcode\\a.txt");
}

#[test]
fn schema_1_state_files_load_without_favorites() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("explorer-state.json");
    fs::write(
        &path,
        r#"{"schema_version":1,"pinned_folders":["C:\\Work"],"recent_folders":[]}"#,
    )
    .unwrap();
    let loaded = ExplorerState::load(&path);
    assert_eq!(loaded.pinned_folders, vec![r"C:\Work".to_string()]);
    assert!(loaded.favorites.is_empty());
    assert_eq!(loaded.schema_version, 2);
}
