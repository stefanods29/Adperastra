use super::*;

#[test]
fn lang_falls_back_to_english() {
    assert_eq!(template_lang("es"), "es");
    assert_eq!(template_lang("en"), "en");
    assert_eq!(template_lang("pseudo"), "en");
    assert_eq!(template_lang("fr"), "en");
}

#[test]
fn is_inside_needs_a_real_child() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let sibling = temp.path().join("sibling");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&sibling).unwrap();
    let child = root.join("a.txt");
    fs::write(&child, b"x").unwrap();
    assert!(is_inside(&root, &child));
    assert!(!is_inside(&root, &root));
    assert!(!is_inside(&root, &sibling));
    assert!(!is_inside(&root, &root.join("..").join("sibling")));
}

#[test]
fn copy_template_never_overwrites() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("t.docx");
    fs::write(&source, b"template bytes").unwrap();
    let dest = temp.path().join("dest");
    fs::create_dir(&dest).unwrap();
    let first = copy_template(&source, &dest, "Letter.docx").unwrap();
    let second = copy_template(&source, &dest, "Letter.docx").unwrap();
    assert_eq!(first.file_name().unwrap(), "Letter.docx");
    assert_eq!(second.file_name().unwrap(), "Letter (1).docx");
    assert_eq!(fs::read(&first).unwrap(), b"template bytes");
    assert_eq!(fs::read(&second).unwrap(), b"template bytes");
    let partial_left = fs::read_dir(&dest)
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().ends_with(".partial"));
    assert!(!partial_left);
}

#[test]
fn copy_template_clears_read_only() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("t.docx");
    fs::write(&source, b"template bytes").unwrap();
    let mut permissions = fs::metadata(&source).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&source, permissions).unwrap();
    let dest = temp.path().join("dest");
    fs::create_dir(&dest).unwrap();
    let copy = copy_template(&source, &dest, "Letter.docx").unwrap();
    assert!(!fs::metadata(&copy).unwrap().permissions().readonly());
    // The template itself stays as it was.
    assert!(fs::metadata(&source).unwrap().permissions().readonly());
}

#[test]
fn user_templates_skip_hidden_files_and_folders() {
    use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("mine");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("a.txt"), b"a").unwrap();
    fs::write(folder.join("B.docx"), b"b").unwrap();
    fs::create_dir(folder.join("sub")).unwrap();
    let hidden = folder.join("h.txt");
    fs::write(&hidden, b"h").unwrap();
    let wide: Vec<u16> = hidden
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    // SAFETY: the test owns this path; wide is terminated and outlives the call.
    unsafe {
        SetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_HIDDEN).unwrap()
    };
    let listed = list_user_templates(&folder).unwrap();
    let names: Vec<&str> = listed.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(names, ["a.txt", "B.docx"]);
}

#[test]
fn unreadable_template_folders_report_an_error_instead_of_an_empty_success() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("templates");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("a.txt"), b"a").unwrap();
    // Deny other handles without changing the machine's users or ACLs.
    let _exclusive = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(&folder)
        .unwrap();
    let (user, missing, error, skipped) = user_template_state(&folder.to_string_lossy());
    assert!(user.is_empty());
    assert!(!missing);
    assert_eq!(error.as_deref(), Some("templates.other"));
    assert_eq!(skipped, 0);
}

#[test]
fn user_templates_preserve_the_number_of_unreadable_entries() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join("a.txt"), b"a").unwrap();
    let mut listing =
        fs_service::list_dir_std(temp.path(), fs_service::SortSpec::default()).unwrap();
    listing.skipped.push(fs_service::ListIssue {
        path: temp.path().join("unreadable.txt"),
        message: "access denied".to_string(),
    });
    let (user, skipped) = user_templates_from_listing(listing);
    assert_eq!(user.len(), 1);
    assert_eq!(user[0].name, "a.txt");
    assert_eq!(skipped, 1);
}

#[test]
fn a_missing_template_folder_is_distinct_from_a_listing_error() {
    let temp = tempfile::tempdir().unwrap();
    let missing_path = temp.path().join("missing");
    let (user, missing, error, skipped) = user_template_state(&missing_path.to_string_lossy());
    assert!(user.is_empty());
    assert!(missing);
    assert!(error.is_none());
    assert_eq!(skipped, 0);
    assert_eq!(
        template_copy::copy_error(&std::io::ErrorKind::PermissionDenied.into()),
        "templates.access_denied"
    );
}
