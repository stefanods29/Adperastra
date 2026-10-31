//! Step 06d T5: safe extraction.

mod common;

use archive::{
    extract, write_entry, ArchiveError, ExtractEvents, ExtractReport, ExtractRequest, Limits,
    WriteFailure,
};
use fs_service::{new_cancellation_token, CancellationToken, OpProgress};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, UNIX_EPOCH};

#[derive(Default)]
struct RecordingEvents {
    created: Vec<PathBuf>,
}

impl ExtractEvents for RecordingEvents {
    fn progress(&mut self, _progress: &OpProgress) {}
    fn created(&mut self, path: &Path) {
        self.created.push(path.to_path_buf());
    }
}

/// Events that ask for a cancel the first time something is created.
#[derive(Default)]
struct CancellingEvents {
    token: Option<CancellationToken>,
    created: Vec<PathBuf>,
}

impl ExtractEvents for CancellingEvents {
    fn progress(&mut self, _progress: &OpProgress) {}
    fn created(&mut self, path: &Path) {
        self.created.push(path.to_path_buf());
        if let Some(token) = &self.token {
            token.store(true, Ordering::Relaxed);
        }
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "adperastra-test-06d-extract-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A destination folder inside `dir`.
fn dest_dir(dir: &Path, name: &str) -> PathBuf {
    let dest = dir.join(name);
    fs::create_dir_all(&dest).unwrap();
    dest
}

fn request_for(
    archive: &Path,
    dest: &Path,
    paths: &[&str],
    base: &str,
    new_folder: Option<&str>,
    single_file: bool,
    zone: Option<&str>,
) -> ExtractRequest {
    let metadata = fs::metadata(archive).unwrap();
    ExtractRequest {
        paths: paths.iter().map(|path| (*path).to_string()).collect(),
        base: base.to_string(),
        dest_dir: dest.to_string_lossy().into_owned(),
        new_folder: new_folder.map(str::to_string),
        expected_size: metadata.len(),
        expected_modified: 0,
        single_file,
        zone: zone.map(str::to_string),
    }
}

#[allow(clippy::too_many_arguments)]
fn run(
    archive: &Path,
    dest: &Path,
    paths: &[&str],
    base: &str,
    new_folder: Option<&str>,
    single_file: bool,
    zone: Option<&str>,
    limits: &Limits,
    token: &CancellationToken,
    events: &mut dyn ExtractEvents,
) -> Result<ExtractReport, ArchiveError> {
    let request = request_for(archive, dest, paths, base, new_folder, single_file, zone);
    extract(archive, &request, limits, token, events)
}

fn extract_all(
    archive: &Path,
    dest: &Path,
    new_folder: Option<&str>,
    events: &mut dyn ExtractEvents,
) -> ExtractReport {
    let token = new_cancellation_token();
    run(
        archive,
        dest,
        &[],
        "",
        new_folder,
        false,
        None,
        &Limits::default(),
        &token,
        events,
    )
    .unwrap()
}

/// Every file or folder whose name starts with `~` (an unfinished write).
fn partial_files(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    collect_partials(dir, &mut found);
    found
}

fn collect_partials(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('~') {
            found.push(entry.path());
        }
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            collect_partials(&entry.path(), found);
        }
    }
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn skipped_reasons(report: &ExtractReport) -> Vec<(&str, &str)> {
    report
        .skipped
        .iter()
        .map(|skip| (skip.path.as_str(), skip.reason.as_str()))
        .collect()
}

#[test]
fn extracts_a_zip_into_a_new_folder() {
    let dir = temp_dir("zip-new-folder");
    let archive = common::sample_zip(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let mut events = RecordingEvents::default();
    let report = extract_all(&archive, &dest, Some("sample"), &mut events);

    let target = canonical.join("sample");
    assert_eq!(
        fs::read_to_string(target.join("README.txt")).unwrap(),
        "hello"
    );
    assert_eq!(
        fs::read_to_string(target.join("docs").join("plan.md")).unwrap(),
        "# Plan\n"
    );
    assert_eq!(
        fs::metadata(target.join("images").join("logo.png"))
            .unwrap()
            .len(),
        100
    );
    assert_eq!(report.created, [target.to_string_lossy().into_owned()]);
    assert_eq!(events.created, std::slice::from_ref(&target));
    assert_eq!(report.files_written, 3);
    assert_eq!(
        skipped_reasons(&report),
        [("../evil.txt", "unsafe_path"), ("CON.txt", "invalid_name"),]
    );
    assert_eq!(file_names(&dir), ["dest", "sample.zip"]);
    assert!(partial_files(&dir).is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn extracting_twice_keeps_both() {
    let dir = temp_dir("zip-twice");
    let archive = common::sample_zip(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let mut first_events = RecordingEvents::default();
    extract_all(&archive, &dest, None, &mut first_events);

    let readme = canonical.join("README.txt");
    let plan = canonical.join("docs").join("plan.md");
    let before = (
        fs::read_to_string(&readme).unwrap(),
        fs::metadata(&readme).unwrap().modified().unwrap(),
        fs::read_to_string(&plan).unwrap(),
        fs::metadata(&plan).unwrap().modified().unwrap(),
    );

    let mut events = RecordingEvents::default();
    let report = extract_all(&archive, &dest, None, &mut events);

    assert_eq!(fs::read_to_string(&readme).unwrap(), before.0);
    assert_eq!(fs::metadata(&readme).unwrap().modified().unwrap(), before.1);
    assert_eq!(fs::read_to_string(&plan).unwrap(), before.2);
    assert_eq!(fs::metadata(&plan).unwrap().modified().unwrap(), before.3);

    let mut created: Vec<String> = report.created.clone();
    created.sort();
    let mut expected = vec![
        canonical
            .join("README (1).txt")
            .to_string_lossy()
            .into_owned(),
        canonical.join("docs (1)").to_string_lossy().into_owned(),
        canonical.join("images (1)").to_string_lossy().into_owned(),
    ];
    expected.sort();
    assert_eq!(created, expected);
    assert_eq!(
        fs::read_to_string(canonical.join("README (1).txt")).unwrap(),
        "hello"
    );
    assert_eq!(
        fs::read_to_string(canonical.join("docs (1)").join("plan.md")).unwrap(),
        "# Plan\n"
    );
    assert!(canonical.join("images (1)").join("logo.png").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn extracts_every_format() {
    let dir = temp_dir("formats");

    let seven = common::sample_7z(&dir);
    let dest = dest_dir(&dir, "seven");
    let canonical = fs::canonicalize(&dest).unwrap();
    let mut events = RecordingEvents::default();
    extract_all(&seven, &dest, None, &mut events);
    assert_eq!(
        fs::read_to_string(canonical.join("README.txt")).unwrap(),
        "hello"
    );
    assert_eq!(
        fs::read_to_string(canonical.join("docs").join("plan.md")).unwrap(),
        "# Plan\n"
    );

    for (archive, name) in [
        (common::sample_tar(&dir), "tar"),
        (common::sample_tar_gz(&dir), "tar_gz"),
        (common::sample_tar_xz(&dir), "tar_xz"),
    ] {
        let dest = dest_dir(&dir, name);
        let canonical = fs::canonicalize(&dest).unwrap();
        let mut events = RecordingEvents::default();
        let report = extract_all(&archive, &dest, None, &mut events);
        assert_eq!(
            fs::read_to_string(canonical.join("README.txt")).unwrap(),
            "hello",
            "{name}"
        );
        assert_eq!(
            fs::read_to_string(canonical.join("docs").join("plan.md")).unwrap(),
            "# Plan\n",
            "{name}"
        );
        assert!(!canonical.join("link").exists(), "{name}");
        assert!(
            report
                .skipped
                .iter()
                .any(|skip| skip.reason == "link_entry"),
            "{name}"
        );
    }

    for (archive, name) in [
        (common::sample_gz(&dir), "gz"),
        (common::sample_xz(&dir), "xz"),
    ] {
        let dest = dest_dir(&dir, name);
        let canonical = fs::canonicalize(&dest).unwrap();
        let mut events = RecordingEvents::default();
        extract_all(&archive, &dest, None, &mut events);
        let bytes = fs::read(canonical.join("notes.txt")).unwrap();
        assert_eq!(bytes.len(), 1_000, "{name}");
        assert!(bytes.iter().all(|byte| *byte == b'a'), "{name}");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn keeps_modified_times() {
    let dir = temp_dir("times");
    let archive = common::sample_tar(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let mut events = RecordingEvents::default();
    extract_all(&archive, &dest, None, &mut events);
    let metadata = fs::metadata(canonical.join("README.txt")).unwrap();
    let modified = metadata.modified().unwrap();
    let seconds = modified.duration_since(UNIX_EPOCH).unwrap().as_secs();
    assert!(
        seconds.abs_diff(1_600_000_000) <= 1,
        "modified time was {seconds}"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copies_the_internet_mark() {
    let dir = temp_dir("zone");
    let archive = common::sample_zip(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let zone = "[ZoneTransfer]\r\nZoneId=3\r\n";
    let token = new_cancellation_token();
    let mut events = RecordingEvents::default();
    run(
        &archive,
        &dest,
        &[],
        "",
        None,
        false,
        Some(zone),
        &Limits::default(),
        &token,
        &mut events,
    )
    .unwrap();
    let stream = canonical.join("README.txt:Zone.Identifier");
    assert_eq!(fs::read_to_string(stream).unwrap(), zone);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn opens_one_file() {
    let dir = temp_dir("open-one");
    let archive = common::sample_zip(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let token = new_cancellation_token();
    let mut events = RecordingEvents::default();
    let report = run(
        &archive,
        &dest,
        &["docs/plan.md"],
        "docs",
        None,
        true,
        None,
        &Limits::default(),
        &token,
        &mut events,
    )
    .unwrap();
    assert_eq!(
        report.opened,
        Some(canonical.join("plan.md").to_string_lossy().into_owned())
    );
    assert_eq!(file_names(&canonical), ["plan.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn cancel_leaves_no_partial_file() {
    let dir = temp_dir("cancel");
    let archive = common::sample_tar(&dir);
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let token = new_cancellation_token();
    let mut events = CancellingEvents {
        token: Some(token.clone()),
        created: Vec::new(),
    };
    let report = run(
        &archive,
        &dest,
        &[],
        "",
        None,
        false,
        None,
        &Limits::default(),
        &token,
        &mut events,
    )
    .unwrap();
    assert!(report.cancelled);
    assert!(partial_files(&dir).is_empty());
    for name in file_names(&canonical) {
        assert!(!name.starts_with('~'), "{name}");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn bombs_are_refused_before_writing() {
    let dir = temp_dir("bomb");
    let archive = dir.join("bomb.gz");
    let mut encoder = flate2::write::GzEncoder::new(
        fs::File::create(&archive).unwrap(),
        flate2::Compression::default(),
    );
    use std::io::Write;
    encoder.write_all(&vec![0u8; 100_000]).unwrap();
    encoder.finish().unwrap();
    let dest = dest_dir(&dir, "dest");
    let canonical = fs::canonicalize(&dest).unwrap();
    let limits = Limits {
        ratio_floor_bytes: 1_000,
        max_ratio: 10,
        ..Limits::default()
    };
    let token = new_cancellation_token();
    let mut events = RecordingEvents::default();
    let result = run(
        &archive,
        &dest,
        &[],
        "",
        None,
        false,
        None,
        &limits,
        &token,
        &mut events,
    );
    assert!(matches!(result, Err(ArchiveError::Bomb)));
    assert!(file_names(&canonical).is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_changed_archive_is_refused() {
    let dir = temp_dir("changed");
    let archive = common::sample_zip(&dir);
    let dest = dest_dir(&dir, "dest");
    let token = new_cancellation_token();
    let mut events = RecordingEvents::default();
    let mut request = request_for(&archive, &dest, &[], "", None, false, None);
    request.expected_size += 1;
    let result = extract(&archive, &request, &Limits::default(), &token, &mut events);
    assert!(matches!(result, Err(ArchiveError::Changed)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_entry_counts_bytes() {
    let dir = temp_dir("write-entry");
    let token = new_cancellation_token();

    let target = dir.join("hello.txt");
    write_entry(
        &target,
        &mut Cursor::new(b"hello".to_vec()),
        5,
        0,
        None,
        &token,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "hello");

    // Ten bytes into a five-byte entry: stopped, nothing left behind.
    let too_big = dir.join("too-big.txt");
    let result = write_entry(
        &too_big,
        &mut Cursor::new(vec![b'x'; 10]),
        5,
        0,
        None,
        &token,
        &mut |_| {},
    );
    assert_eq!(result, Err(WriteFailure::Skip("size_mismatch")));
    assert!(!too_big.exists());
    assert!(!fs_service::partial_path(&too_big).exists());

    // Three bytes for a five-byte entry: stopped, nothing left behind.
    let short = dir.join("short.txt");
    let result = write_entry(
        &short,
        &mut Cursor::new(b"abc".to_vec()),
        5,
        0,
        None,
        &token,
        &mut |_| {},
    );
    assert_eq!(result, Err(WriteFailure::Skip("size_mismatch")));
    assert!(!short.exists());
    assert!(!fs_service::partial_path(&short).exists());

    // An existing file is never replaced.
    let taken = dir.join("taken.txt");
    fs::write(&taken, "old").unwrap();
    let result = write_entry(
        &taken,
        &mut Cursor::new(b"hello".to_vec()),
        5,
        0,
        None,
        &token,
        &mut |_| {},
    );
    assert_eq!(result, Err(WriteFailure::Skip("name_taken")));
    assert_eq!(fs::read_to_string(&taken).unwrap(), "old");

    // A cancel before the first byte leaves nothing.
    let cancelled_token = new_cancellation_token();
    cancelled_token.store(true, Ordering::Relaxed);
    let cancelled = dir.join("cancelled.txt");
    let result = write_entry(
        &cancelled,
        &mut Cursor::new(b"hello".to_vec()),
        5,
        0,
        None,
        &cancelled_token,
        &mut |_| {},
    );
    assert_eq!(result, Err(WriteFailure::Cancelled));
    assert!(!cancelled.exists());
    assert!(!fs_service::partial_path(&cancelled).exists());

    // The entry's date is kept.
    let dated = dir.join("dated.txt");
    write_entry(
        &dated,
        &mut Cursor::new(b"hello".to_vec()),
        5,
        1_600_000_000,
        None,
        &token,
        &mut |_| {},
    )
    .unwrap();
    let modified = fs::metadata(&dated).unwrap().modified().unwrap();
    assert_eq!(
        modified.duration_since(UNIX_EPOCH).unwrap(),
        Duration::from_secs(1_600_000_000)
    );
    let _ = fs::remove_dir_all(&dir);
}
