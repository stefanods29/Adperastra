//! bzip2 reading and the new owned extraction route (Step 06e T3).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use archive::{
    detect_format, extract_with_options, extract_with_zone, list, ArchiveFormat,
    ArchiveReadOptions, ExtractEvents, ExtractReport, ExtractRequest, Limits, ZoneWriter,
};
use bzip2::write::BzEncoder;
use bzip2::Compression;
use fs_service::{new_cancellation_token, OpProgress};

fn bz2(data: &[u8]) -> Vec<u8> {
    let mut encoder = BzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

fn write_bz2(path: &Path, data: &[u8]) {
    std::fs::write(path, bz2(data)).unwrap();
}

fn raw_tar_entry(
    builder: &mut tar::Builder<BzEncoder<std::fs::File>>,
    name: &str,
    data: &[u8],
    kind: tar::EntryType,
    link: Option<&str>,
) {
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(kind);
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    let bytes = name.as_bytes();
    let name_field = &mut header.as_old_mut().name;
    name_field[..bytes.len()].copy_from_slice(bytes);
    if let Some(link) = link {
        let link_bytes = link.as_bytes();
        let link_field = &mut header.as_old_mut().linkname;
        link_field[..link_bytes.len()].copy_from_slice(link_bytes);
    }
    header.set_cksum();
    builder.append(&header, data).unwrap();
}

fn write_tar_bz2(path: &Path) {
    let file = std::fs::File::create(path).unwrap();
    let mut builder = tar::Builder::new(BzEncoder::new(file, Compression::best()));
    raw_tar_entry(
        &mut builder,
        "ok.txt",
        b"normal",
        tar::EntryType::Regular,
        None,
    );
    raw_tar_entry(
        &mut builder,
        "../evil.txt",
        b"evil",
        tar::EntryType::Regular,
        None,
    );
    raw_tar_entry(
        &mut builder,
        "link",
        b"",
        tar::EntryType::Symlink,
        Some("ok.txt"),
    );
    builder.into_inner().unwrap().finish().unwrap();
}

fn request(dest: &Path, archive: &Path) -> ExtractRequest {
    ExtractRequest {
        paths: Vec::new(),
        base: String::new(),
        dest_dir: dest.to_string_lossy().into_owned(),
        new_folder: None,
        expected_size: std::fs::metadata(archive).unwrap().len(),
        expected_modified: 0,
        single_file: false,
        zone: None,
    }
}

#[derive(Default)]
struct Events {
    created: Vec<String>,
}

impl ExtractEvents for Events {
    fn progress(&mut self, _progress: &OpProgress) {}

    fn created(&mut self, path: &Path) {
        self.created.push(path.to_string_lossy().into_owned());
    }
}

struct FailingZone;

impl ZoneWriter for FailingZone {
    fn write(&self, _target: &Path, _zone: &str) -> std::io::Result<()> {
        Err(std::io::Error::other("this file system keeps no streams"))
    }
}

#[test]
fn detects_bzip2_and_tar_bzip2_by_bytes() {
    let folder = tempfile::tempdir().unwrap();
    let stream = folder.path().join("plain.dat");
    write_bz2(&stream, b"hello");
    let tar = folder.path().join("bundle.dat");
    write_tar_bz2(&tar);

    assert_eq!(detect_format(&stream).unwrap(), ArchiveFormat::Bz2);
    assert_eq!(detect_format(&tar).unwrap(), ArchiveFormat::TarBz2);
}

#[test]
fn reads_concatenated_bzip2_members() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("data.dat");
    let mut members = bz2(b"abc");
    members.extend(bz2(b"def"));
    std::fs::write(&path, members).unwrap();

    let token = new_cancellation_token();
    let limits = Limits::default();
    let listing = list(&path, &limits, &token, &mut |_| {}).unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert_eq!(listing.entries[0].size, 6);

    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let mut events = Events::default();
    let report = extract_with_options(
        &path,
        &request(&dest, &path),
        &limits,
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
    )
    .unwrap();
    assert_eq!(report.files_written, 1);
    assert_eq!(std::fs::read(dest.join("data")).unwrap(), b"abcdef");
}

#[test]
fn bzip2_tar_names_use_existing_safety_rules() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("bundle.tar.bz2");
    write_tar_bz2(&path);
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();

    let token = new_cancellation_token();
    let limits = Limits::default();
    let mut events = Events::default();
    let report = extract_with_options(
        &path,
        &request(&dest, &path),
        &limits,
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
    )
    .unwrap();

    assert_eq!(report.files_written, 1);
    assert_eq!(std::fs::read(dest.join("ok.txt")).unwrap(), b"normal");
    assert!(
        !dest.join("evil.txt").exists(),
        "traversal is never written"
    );
    assert!(
        !folder.path().join("evil.txt").exists(),
        "nothing left the destination"
    );
    let reasons: Vec<&str> = report
        .skipped
        .iter()
        .map(|skip| skip.reason.as_str())
        .collect();
    assert!(reasons.contains(&"unsafe_path"));
    assert!(reasons.contains(&"link_entry"));
}

#[test]
fn bzip2_crc_failure_never_publishes_a_partial() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("data.bz2");
    let mut bytes = bz2(b"payload");
    // Damage the stream trailer: the CRC no longer matches.
    let last = bytes.len() - 1;
    bytes[last] ^= 0xFF;
    std::fs::write(&path, bytes).unwrap();

    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let foreign = dest.join("~data.partial");
    std::fs::write(&foreign, "someone else").unwrap();

    let token = new_cancellation_token();
    let limits = Limits::default();
    let mut events = Events::default();
    let result = extract_with_options(
        &path,
        &request(&dest, &path),
        &limits,
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
    );

    assert!(result.is_err(), "damaged data is reported");
    assert!(!dest.join("data").exists(), "nothing was published");
    assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "someone else");
}

#[test]
fn bzip2_stops_at_injected_size_and_ratio_limits() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("big.bz2");
    write_bz2(&path, &[b'a'; 100]);
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();

    let token = new_cancellation_token();
    let limits = Limits {
        max_total_bytes: 10,
        ..Limits::default()
    };
    let mut events = Events::default();
    let result = extract_with_options(
        &path,
        &request(&dest, &path),
        &limits,
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
    );
    assert!(result.is_err(), "the bomb is refused before output");

    // Cancellation before the first chunk leaves no owned partial.
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    let mut events = Events::default();
    let cancelled = extract_with_options(
        &path,
        &request(&dest, &path),
        &Limits::default(),
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
    );
    assert!(cancelled.is_err());
    assert!(std::fs::read_dir(&dest).unwrap().next().is_none());
}

#[test]
fn new_extraction_refuses_required_motw_loss() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("data.bz2");
    write_bz2(&path, b"marked");
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let mut extract_request = request(&dest, &path);
    extract_request.zone = Some("[ZoneTransfer]\r\nZoneId=3\r\n".to_string());

    let token = new_cancellation_token();
    let mut events = Events::default();
    let report: ExtractReport = extract_with_zone(
        &path,
        &extract_request,
        &Limits::default(),
        &token,
        &mut events,
        &ArchiveReadOptions::default(),
        &FailingZone,
    )
    .unwrap();

    assert_eq!(report.files_written, 0);
    assert!(report.created.is_empty());
    assert!(
        report.skipped.iter().any(|skip| skip.reason == "other"),
        "the lost mark is reported, not hidden"
    );
    assert!(
        !dest.join("data").exists(),
        "no unmarked file was published"
    );
    let leftovers: Vec<PathBuf> = std::fs::read_dir(&dest)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    assert!(leftovers.is_empty(), "the owned staging file was removed");
}
