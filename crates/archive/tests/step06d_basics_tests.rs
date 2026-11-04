//! Step 06d T2: inner paths, limits, zip dates, format detection and the
//! error codes.

use archive::{
    check_bomb, check_space, detect_format, dos_local_to_unix, first_component, is_root_entry,
    name_of, normalize_inner_path, parent_of, relative_to, ArchiveError, ArchiveFormat, Limits,
};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "adperastra-test-06d-basics-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn normalizes_good_paths() {
    let limits = Limits::default();
    for raw in ["docs/plan.md", "docs\\plan.md", "./docs//plan.md"] {
        assert_eq!(
            normalize_inner_path(raw, &limits),
            Ok("docs/plan.md".to_string()),
            "{}",
            raw
        );
    }
    assert_eq!(
        normalize_inner_path("docs/", &limits),
        Ok("docs".to_string())
    );
    assert_eq!(
        normalize_inner_path("ünïcödé/файл.txt", &limits),
        Ok("ünïcödé/файл.txt".to_string())
    );
}

#[test]
fn refuses_paths_that_leave_the_folder() {
    let limits = Limits::default();
    for raw in [
        "/etc/passwd",
        "\\\\server\\share\\x",
        "C:/Windows/x.dll",
        "C:x.txt",
        "a/../../evil.txt",
        "a/../b.txt",
    ] {
        assert_eq!(
            normalize_inner_path(raw, &limits),
            Err("unsafe_path"),
            "{}",
            raw
        );
    }
}

#[test]
fn refuses_names_windows_does_not_allow() {
    let limits = Limits::default();
    let deep = vec!["a"; 65].join("/");
    let long = "x".repeat(1_025);
    for raw in [
        "CON/x.txt",
        "notes.txt:evil",
        "folder./x.txt",
        "",
        ".",
        deep.as_str(),
        long.as_str(),
    ] {
        assert_eq!(
            normalize_inner_path(raw, &limits),
            Err("invalid_name"),
            "{}",
            &raw[..raw.len().min(40)]
        );
    }
}

#[test]
fn recognizes_root_entries() {
    assert!(is_root_entry("./"));
    assert!(is_root_entry("/"));
    assert!(is_root_entry("."));
    assert!(!is_root_entry("./a"));
}

#[test]
fn splits_inner_paths() {
    assert_eq!(parent_of("docs/a/b.txt"), "docs/a");
    assert_eq!(parent_of("b.txt"), "");
    assert_eq!(name_of("docs/a/b.txt"), "b.txt");
    assert_eq!(relative_to("docs/a/b.txt", "docs"), Some("a/b.txt"));
    assert_eq!(relative_to("docs2/x", "docs"), None);
    assert_eq!(relative_to("docs", "docs"), None);
    assert_eq!(relative_to("x", ""), Some("x"));
    assert_eq!(first_component("a/b/c"), "a");
}

#[test]
fn bomb_rule() {
    let limits = Limits::default();
    const MIB: u64 = 1_048_576;
    const GIB: u64 = 1_073_741_824;
    const TIB: u64 = 1_099_511_627_776;
    // 500 MiB out of 1 KiB is under the 1 GiB floor, so the ratio is not used.
    assert!(check_bomb(500 * MIB, 1_024, &limits).is_ok());
    // 2 GiB out of 1 MiB is over 500 times its size.
    assert!(matches!(
        check_bomb(2 * GIB, MIB, &limits),
        Err(ArchiveError::Bomb)
    ));
    // 2 GiB out of 8 MiB is 256 times: fine.
    assert!(check_bomb(2 * GIB, 8 * MIB, &limits).is_ok());
    // More than 1 TiB in total is always refused.
    assert!(matches!(
        check_bomb(2 * TIB, TIB, &limits),
        Err(ArchiveError::Bomb)
    ));
}

#[test]
fn space_rule() {
    let limits = Limits::default();
    const MIB: u64 = 1_048_576;
    assert!(matches!(
        check_space(13, Some(10), &limits),
        Err(ArchiveError::NoSpace)
    ));
    assert!(check_space(13, Some(100 * MIB), &limits).is_ok());
    assert!(check_space(13, None, &limits).is_ok());
}

#[test]
fn dos_time_uses_the_local_zone() {
    let unix = dos_local_to_unix(2024, 1, 15, 12, 0, 0);
    let noon_utc = 1_705_320_000u64;
    assert!(unix > 0, "the date was converted");
    assert!(
        unix.abs_diff(noon_utc) <= 14 * 3_600,
        "within 14 hours: {unix}"
    );
}

#[test]
fn dos_time_refuses_impossible_dates() {
    assert_eq!(dos_local_to_unix(1979, 1, 1, 0, 0, 0), 0);
    assert_eq!(dos_local_to_unix(2024, 13, 1, 0, 0, 0), 0);
    assert_eq!(dos_local_to_unix(2024, 2, 30, 0, 0, 0), 0);
}

fn write_zip(path: &std::path::Path) {
    let file = fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("README.txt", options).unwrap();
    writer.write_all(b"hello").unwrap();
    writer.finish().unwrap();
}

fn tar_bytes() -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(5);
    header.set_mode(0o644);
    header.set_mtime(1_600_000_000);
    header.set_cksum();
    builder
        .append_data(&mut header, "README.txt", &b"hello"[..])
        .unwrap();
    builder.into_inner().unwrap()
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

#[test]
fn detects_formats_by_content() {
    let dir = temp_dir("formats");

    let named_7z = dir.join("photo.7z");
    write_zip(&named_7z);
    assert_eq!(detect_format(&named_7z).unwrap(), ArchiveFormat::Zip);

    let fake = dir.join("fake.zip");
    fs::write(&fake, "this is not an archive").unwrap();
    assert!(matches!(
        detect_format(&fake),
        Err(ArchiveError::Unsupported)
    ));

    let empty = dir.join("empty.zip");
    fs::write(&empty, "").unwrap();
    assert!(matches!(
        detect_format(&empty),
        Err(ArchiveError::Unsupported)
    ));

    let tar = dir.join("data.bin");
    fs::write(&tar, tar_bytes()).unwrap();
    assert_eq!(detect_format(&tar).unwrap(), ArchiveFormat::Tar);

    let tar_gz = dir.join("x.gz");
    fs::write(&tar_gz, gzip(&tar_bytes())).unwrap();
    assert_eq!(detect_format(&tar_gz).unwrap(), ArchiveFormat::TarGz);

    let notes = dir.join("notes.txt.gz");
    fs::write(&notes, gzip(b"a plain text file")).unwrap();
    assert_eq!(detect_format(&notes).unwrap(), ArchiveFormat::Gz);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn error_codes() {
    let cases: Vec<(ArchiveError, &str)> = vec![
        (ArchiveError::NotFound, "archive.not_found"),
        (ArchiveError::Unsupported, "archive.unsupported"),
        (ArchiveError::Corrupt, "archive.corrupt"),
        (ArchiveError::PasswordRequired, "archive.password_required"),
        (ArchiveError::TooManyEntries, "archive.too_many_entries"),
        (ArchiveError::Bomb, "archive.bomb"),
        (ArchiveError::NoSpace, "archive.no_space"),
        (ArchiveError::Changed, "archive.changed"),
        (ArchiveError::Cancelled, "archive.cancelled"),
        (ArchiveError::BadRequest, "archive.bad_request"),
        (ArchiveError::NotAFile, "archive.not_a_file"),
        (ArchiveError::DestMissing, "archive.dest_missing"),
        (ArchiveError::AccessDenied, "archive.access_denied"),
        (
            ArchiveError::Io(std::io::Error::other("disk")),
            "archive.other",
        ),
    ];
    for (error, code) in cases {
        assert_eq!(error.code(), code);
    }
    // An io error without its own meaning keeps its detail.
    let missing: ArchiveError = std::io::Error::from(std::io::ErrorKind::NotFound).into();
    assert_eq!(missing.code(), "archive.not_found");
    let denied: ArchiveError = std::io::Error::from(std::io::ErrorKind::PermissionDenied).into();
    assert_eq!(denied.code(), "archive.access_denied");
}
