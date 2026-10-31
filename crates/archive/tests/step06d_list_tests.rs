//! Step 06d T3: listings for every format.

mod common;

use archive::{list, ArchiveEntry, ArchiveError, ArchiveFormat, EntryKind, Limits};
use fs_service::{new_cancellation_token, CancellationToken};
use std::fs;
use std::path::{Path, PathBuf};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "adperastra-test-06d-list-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn list_file(path: &Path, limits: &Limits) -> Result<archive::Listing, ArchiveError> {
    let token = new_cancellation_token();
    list(path, limits, &token, &mut |_| {})
}

fn list_with(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
) -> Result<archive::Listing, ArchiveError> {
    list(path, limits, token, &mut |_| {})
}

fn find<'a>(entries: &'a [ArchiveEntry], path: &str) -> &'a ArchiveEntry {
    entries
        .iter()
        .find(|entry| entry.path == path)
        .unwrap_or_else(|| {
            panic!(
                "no entry {path} in {:?}",
                entries.iter().map(|e| &e.path).collect::<Vec<_>>()
            )
        })
}

#[test]
fn lists_a_zip() {
    let dir = temp_dir("zip");
    let path = common::sample_zip(&dir);
    let listing = list_file(&path, &Limits::default()).unwrap();
    assert_eq!(listing.format, ArchiveFormat::Zip);
    assert_eq!(listing.entries.len(), 6);
    assert!(!listing.partial);

    let readme = find(&listing.entries, "README.txt");
    assert_eq!(readme.size, 5);
    assert_eq!(readme.kind, EntryKind::File);
    assert!(readme.problem.is_none());
    assert_eq!(find(&listing.entries, "docs").kind, EntryKind::Folder);
    assert_eq!(
        find(&listing.entries, "../evil.txt").problem.as_deref(),
        Some("unsafe_path")
    );
    assert_eq!(
        find(&listing.entries, "CON.txt").problem.as_deref(),
        Some("invalid_name")
    );
    for entry in &listing.entries {
        if entry.path != "../evil.txt" && entry.path != "CON.txt" {
            assert!(entry.problem.is_none(), "{}", entry.path);
        }
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn lists_a_7z() {
    let dir = temp_dir("sevenz");
    let path = common::sample_7z(&dir);
    let listing = list_file(&path, &Limits::default()).unwrap();
    assert_eq!(listing.format, ArchiveFormat::SevenZ);
    assert_eq!(find(&listing.entries, "README.txt").size, 5);
    assert_eq!(find(&listing.entries, "docs").kind, EntryKind::Folder);
    assert_eq!(find(&listing.entries, "docs/plan.md").size, 7);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn lists_tar_tar_gz_and_tar_xz_alike() {
    let dir = temp_dir("tar");
    let files = [
        (common::sample_tar(&dir), ArchiveFormat::Tar),
        (common::sample_tar_gz(&dir), ArchiveFormat::TarGz),
        (common::sample_tar_xz(&dir), ArchiveFormat::TarXz),
    ];
    let expected = ["README.txt", "docs", "docs/plan.md", "link", "../evil.txt"];
    for (path, format) in files {
        let listing = list_file(&path, &Limits::default()).unwrap();
        assert_eq!(listing.format, format, "{}", path.display());
        let paths: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        assert_eq!(paths, expected, "{}", path.display());
        assert_eq!(find(&listing.entries, "link").kind, EntryKind::Link);
        assert_eq!(
            find(&listing.entries, "../evil.txt").problem.as_deref(),
            Some("unsafe_path")
        );
        assert_eq!(
            find(&listing.entries, "README.txt").modified_unix,
            1_600_000_000
        );
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn lists_single_gz_and_xz_files() {
    let dir = temp_dir("stream");
    for (path, format) in [
        (common::sample_gz(&dir), ArchiveFormat::Gz),
        (common::sample_xz(&dir), ArchiveFormat::Xz),
    ] {
        let listing = list_file(&path, &Limits::default()).unwrap();
        assert_eq!(listing.format, format);
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].path, "notes.txt");
        assert_eq!(listing.entries[0].size, 1_000);
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn bsdtar_root_entries_are_left_out() {
    let dir = temp_dir("root");
    let path = dir.join("root.zip");
    let file = fs::File::create(&path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    writer.add_directory("./", options).unwrap();
    writer.start_file("./a.txt", options).unwrap();
    use std::io::Write;
    writer.write_all(b"a").unwrap();
    writer.finish().unwrap();

    let listing = list_file(&path, &Limits::default()).unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert_eq!(listing.entries[0].path, "a.txt");
    assert_eq!(listing.entries[0].index, 1);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_damaged_tar_is_partial() {
    let dir = temp_dir("damaged");
    let path = dir.join("damaged.tar");
    let bytes = common::sample_tar_bytes();
    let mut cut = bytes[..1_536].to_vec();
    cut.extend(std::iter::repeat_n(0u8, 100));
    fs::write(&path, cut).unwrap();
    let listing = list_file(&path, &Limits::default()).unwrap();
    assert!(listing.partial);
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "README.txt"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_truncated_zip_is_corrupt() {
    let dir = temp_dir("truncated");
    let path = common::sample_zip(&dir);
    let bytes = fs::read(&path).unwrap();
    fs::write(&path, &bytes[..100]).unwrap();
    assert!(matches!(
        list_file(&path, &Limits::default()),
        Err(ArchiveError::Corrupt)
    ));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn too_many_entries_is_refused() {
    let dir = temp_dir("many");
    let path = common::sample_zip(&dir);
    let limits = Limits {
        max_entries: 3,
        ..Limits::default()
    };
    assert!(matches!(
        list_file(&path, &limits),
        Err(ArchiveError::TooManyEntries)
    ));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn cancel_stops_listing() {
    let dir = temp_dir("cancel");
    let path = common::sample_zip(&dir);
    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(matches!(
        list_with(&path, &Limits::default(), &token),
        Err(ArchiveError::Cancelled)
    ));
    let _ = fs::remove_dir_all(&dir);
}
