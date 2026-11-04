use super::*;
use std::fs;
use std::path::PathBuf;

#[test]
fn marker_activates_adjacent_data() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    write_marker(app.path()).unwrap();
    let location = locate_with(
        app.path(),
        installed.path(),
        None,
        &|_| true,
    )
    .unwrap();
    assert!(location.portable);
    assert!(location.writable);
    assert_eq!(location.data_dir, app.path().join(DATA_DIR_NAME));
    assert_eq!(
        fs::read_to_string(app.path().join(MARKER_FILE)).unwrap(),
        marker_contents()
    );
}

#[test]
fn without_marker_uses_the_installed_folder() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    let location = locate_with(app.path(), installed.path(), None, &|_| true).unwrap();
    assert!(!location.portable);
    assert_eq!(location.data_dir, installed.path());
}

#[test]
fn explicit_environment_path_wins() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    let explicit = tempfile::tempdir().unwrap();
    write_marker(app.path()).unwrap();
    let location = locate_with(
        app.path(),
        installed.path(),
        Some(explicit.path()),
        &|_| true,
    )
    .unwrap();
    assert!(!location.portable);
    assert_eq!(location.data_dir, explicit.path());
}

#[test]
fn invalid_markers_are_refused() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    for text in [
        "{\"enabled\":true,\"version\":2}",
        "{\"enabled\":true,\"version\":1,\"path\":\"C:\\\\Users\\\\me\"}",
        "not json",
    ] {
        fs::write(app.path().join(MARKER_FILE), text).unwrap();
        assert_eq!(
            locate_with(app.path(), installed.path(), None, &|_| true),
            Err("portable.marker_invalid".to_string())
        );
    }
}

#[test]
fn non_writable_portable_folder_offers_a_choice_without_writing() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    write_marker(app.path()).unwrap();
    let before = fs::read_dir(app.path()).unwrap().count();
    let location = locate_with(app.path(), installed.path(), None, &|_| false).unwrap();
    assert!(requires_data_choice(&location));
    assert!(!app.path().join(DATA_DIR_NAME).exists());
    assert_eq!(fs::read_dir(app.path()).unwrap().count(), before);
}

#[test]
fn cancelled_choice_preserves_the_old_location() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    write_marker(app.path()).unwrap();
    let location = locate_with(app.path(), installed.path(), None, &|_| false).unwrap();
    let chosen = apply_choice_with(
        location,
        installed.path(),
        PortableChoice::Cancel,
        &|_| false,
    )
    .unwrap();
    assert!(!chosen.portable);
    assert_eq!(chosen.data_dir, installed.path());
    assert!(!app.path().join(DATA_DIR_NAME).exists());
}

#[test]
fn chosen_folder_must_be_absolute_and_writable() {
    let app = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();
    write_marker(app.path()).unwrap();
    let location = locate_with(app.path(), installed.path(), None, &|_| false).unwrap();
    let chosen = tempfile::tempdir().unwrap();
    let accepted = apply_choice_with(
        location.clone(),
        installed.path(),
        PortableChoice::Choose(chosen.path().to_path_buf()),
        &|_| true,
    )
    .unwrap();
    assert!(accepted.portable);
    assert_eq!(accepted.data_dir, chosen.path());
    assert_eq!(
        apply_choice_with(
            location.clone(),
            installed.path(),
            PortableChoice::Choose(chosen.path().to_path_buf()),
            &|_| false,
        ),
        Err("portable.not_writable".to_string())
    );
    assert_eq!(
        apply_choice_with(
            location,
            installed.path(),
            PortableChoice::Choose(PathBuf::from("relative")),
            &|_| true,
        ),
        Err("portable.bad_path".to_string())
    );
}

#[test]
fn long_paths_are_preserved_without_truncation() {
    let explicit = PathBuf::from("C:\\")
        .join("a".repeat(150))
        .join("b".repeat(150));
    let app = PathBuf::from("C:\\app");
    let installed = PathBuf::from("C:\\data");
    assert!(explicit.to_string_lossy().len() > 260);
    let location =
        locate_with(&app, &installed, Some(&explicit), &|_| true).unwrap();
    assert_eq!(location.data_dir, explicit);
    assert!(location.data_dir.to_string_lossy().len() > 260);
}

#[test]
fn writable_preflight_leaves_no_probe_file() {
    let directory = tempfile::tempdir().unwrap();
    assert!(writable_preflight(directory.path()));
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}
