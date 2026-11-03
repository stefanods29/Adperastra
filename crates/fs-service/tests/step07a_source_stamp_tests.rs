use fs_service::source_stamp::{
    attributes_are_online_only, capture_file_identity, capture_source_stamp, path_key_of,
    MAX_STAMP_PATH_UTF16,
};

#[test]
fn attributes_report_cloud_placeholders() {
    assert!(attributes_are_online_only(0x0000_1000));
    assert!(attributes_are_online_only(0x0004_0000));
    assert!(attributes_are_online_only(0x0040_0000));
    assert!(!attributes_are_online_only(0x0000_0020));
}

#[test]
fn path_keys_are_normalized_and_bounded() {
    assert_eq!(
        path_key_of(std::path::Path::new(r"\\?\C:\Pictures\A.PNG")).unwrap(),
        r"c:\pictures\a.png"
    );
    assert_eq!(
        path_key_of(std::path::Path::new("C:/Pictures/")).unwrap(),
        r"c:\pictures"
    );
    let long = format!("C:\\{}", "a".repeat(MAX_STAMP_PATH_UTF16));
    assert!(path_key_of(std::path::Path::new(&long)).is_err());
}

#[cfg(windows)]
#[test]
fn stamps_and_identities_use_fixed_width_ids() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("photo.png");
    std::fs::write(&path, b"picture").unwrap();
    let stamp = capture_source_stamp(&path).unwrap();
    assert_eq!(stamp.volume_id.len(), 8);
    assert_eq!(stamp.file_id.len(), 16);
    assert_eq!(stamp.size_bytes, 7);
    assert!(stamp.validate().is_ok());
    let identity = capture_file_identity(&path).unwrap();
    assert_eq!(identity.path_key, stamp.path_key);
    assert_eq!(identity.volume_id, stamp.volume_id);
    assert_eq!(identity.file_id, stamp.file_id);
    assert!(identity.stable);
}

#[cfg(windows)]
#[test]
fn a_subsecond_change_changes_the_stamp() {
    use std::time::{Duration, UNIX_EPOCH};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("changing.txt");
    std::fs::write(&path, b"one").unwrap();
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123))
        .unwrap();
    let first = capture_source_stamp(&path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_millis(1_700_000_000_124))
        .unwrap();
    let second = capture_source_stamp(&path).unwrap();
    assert_ne!(first.modified_ticks, second.modified_ticks);
    assert_eq!(first.path_key, second.path_key);
    assert_eq!(first.size_bytes, second.size_bytes);
}

#[cfg(windows)]
#[test]
fn directory_identity_uses_an_attribute_only_handle() {
    let dir = tempfile::tempdir().unwrap();
    let identity = capture_file_identity(dir.path()).unwrap();
    assert!(!identity.path_key.is_empty());
    assert_eq!(identity.volume_id.len(), 8);
    assert_eq!(identity.file_id.len(), 16);
    assert!(
        capture_source_stamp(dir.path()).is_err(),
        "directories are identities, not file-content stamps"
    );
}
#[test]
fn path_keys_preserve_root_and_unc_and_refuse_devices() {
    assert_eq!(path_key_of(std::path::Path::new("C:\\")).unwrap(), "c:\\");
    assert_eq!(
        path_key_of(std::path::Path::new(r"\\?\UNC\server\share\a.txt")).unwrap(),
        r"\\server\share\a.txt"
    );
    for path in [
        "relative.txt",
        "C:relative",
        r"\\.\pipe\adperastra",
        "C:\\bad\0name",
    ] {
        assert!(path_key_of(std::path::Path::new(path)).is_err());
    }
}

#[cfg(windows)]
#[test]
fn background_guard_refuses_offline_attributes_without_changing_foreground_open() {
    use fs_service::owned_io::{PinnedSource, SourceIdentity};
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_OFFLINE},
    };
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("offline.txt");
    std::fs::write(&path, b"local fixture, no cloud provider").unwrap();
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: a zero-terminated fixture path remains live for the whole call.
    unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_OFFLINE) }.unwrap();
    let expected = SourceIdentity::capture(&path).unwrap();
    assert_ne!(expected.attributes & FILE_ATTRIBUTE_OFFLINE.0, 0);
    assert!(PinnedSource::open_background(&path, &expected).is_err());
    let foreground = PinnedSource::open(&path, &expected).unwrap();
    assert_eq!(foreground.file().metadata().unwrap().len(), 32);
}
