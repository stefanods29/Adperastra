//! The bounded read-only RAR adapter (Step 06e T7). No 7-Zip is installed
//! here: every case uses a fake runner whose arguments and stdin are
//! recorded, so the transport rules are checked exactly.

use std::cell::RefCell;
use std::path::Path;
use std::sync::atomic::Ordering;

use archive::{
    detect_format, extract_rar_file, list_rar, parse_listing, verify_candidate, ArchiveError,
    ArchiveReadOptions, Captured, Limits, RarRecord, SevenZipRunner, Streamed,
};
use fs_service::new_cancellation_token;

const SECRET: &str = "synthetic phrase ñ with spaces";

type RecordedCall = (Vec<String>, Option<Vec<u8>>);

struct FakeRunner {
    full: Vec<u8>,
    exact: Vec<u8>,
    stream: Vec<u8>,
    stream_success: bool,
    calls: RefCell<Vec<RecordedCall>>,
}

impl FakeRunner {
    fn new(full: &str, exact: &str, stream: &[u8]) -> Self {
        Self {
            full: full.as_bytes().to_vec(),
            exact: exact.as_bytes().to_vec(),
            stream: stream.to_vec(),
            stream_success: true,
            calls: RefCell::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<RecordedCall> {
        self.calls.borrow().clone()
    }
}

impl SevenZipRunner for FakeRunner {
    fn probe(&self) -> Result<String, ArchiveError> {
        Ok("23.01".to_string())
    }

    fn capture(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        _max_stdout: usize,
    ) -> Result<Captured, ArchiveError> {
        self.calls
            .borrow_mut()
            .push((args.to_vec(), stdin.map(|value| value.to_vec())));
        let stdout = if args.iter().any(|arg| arg == "-spd") {
            self.exact.clone()
        } else {
            self.full.clone()
        };
        Ok(Captured {
            success: true,
            timed_out: false,
            stdout,
            stderr: Vec::new(),
        })
    }

    fn stream(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        _max_bytes: u64,
        sink: &mut dyn FnMut(&[u8]) -> Result<(), ArchiveError>,
    ) -> Result<Streamed, ArchiveError> {
        self.calls
            .borrow_mut()
            .push((args.to_vec(), stdin.map(|value| value.to_vec())));
        for chunk in self.stream.chunks(7) {
            sink(chunk)?;
        }
        Ok(Streamed {
            success: self.stream_success,
            timed_out: false,
            written: self.stream.len() as u64,
        })
    }
}

fn header(size: u64) -> String {
    format!(
        "7-Zip 23.01 (x64) : Copyright\nListing archive: C:\\test.rar\n--\nPath = C:\\test.rar\nType = Rar\nPhysical Size = {size}\n\n----------\n"
    )
}

fn full_listing(entries: &str, size: u64) -> String {
    format!("{}{entries}", header(size))
}

fn entry(name: &str, size: u64) -> String {
    format!(
        "Path = {name}\nSize = {size}\nPacked Size = {size}\nModified = 2024-01-02 03:04:05 UTC\nEncrypted = -\nAttributes = A\n\n"
    )
}

fn dummy_archive(folder: &Path) -> std::path::PathBuf {
    let path = folder.join("test.rar");
    // A RAR5 signature is enough for detection and for the read guard.
    std::fs::write(
        &path,
        [b"Rar!\x1A\x07\x01\x00".as_slice(), &[0u8; 32]].concat(),
    )
    .unwrap();
    path
}

#[test]
fn rar_values_split_only_the_first_delimiter() {
    let text = full_listing(&entry("a = b.txt", 4), 100);
    let listing = parse_listing(text.as_bytes()).unwrap();
    assert_eq!(listing.records.len(), 1);
    assert_eq!(listing.records[0].path, "a = b.txt");
    assert_eq!(listing.records[0].size, 4);
    assert_eq!(listing.records[0].modified_unix, 1_704_164_645);
}

#[test]
fn rar_duplicate_keys_and_record_injection_are_rejected() {
    let duplicate = "Path = a.txt\nSize = 4\nSize = 5\n";
    assert!(matches!(
        parse_listing(full_listing(duplicate, 100).as_bytes()),
        Err(ArchiveError::AmbiguousRar)
    ));
    let injection = "Path = a.txt\nSize = 4\nthis line is not a property\n";
    assert!(matches!(
        parse_listing(full_listing(injection, 100).as_bytes()),
        Err(ArchiveError::AmbiguousRar)
    ));
    let duplicate_path = "Path = a.txt\nPath = b.txt\nSize = 4\n";
    assert!(matches!(
        parse_listing(full_listing(duplicate_path, 100).as_bytes()),
        Err(ArchiveError::AmbiguousRar)
    ));
}

#[test]
fn rar_lossy_name_needs_exact_second_selection() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    // 7-Zip printed the CR/LF-normalized name; the exact listing finds none.
    let runner = FakeRunner::new(&full_listing(&entry("a_b.txt", 0), 100), &header(100), b"");
    let token = new_cancellation_token();
    let listing = list_rar(
        &archive,
        &Limits::default(),
        &token,
        &ArchiveReadOptions::default(),
        &runner,
    )
    .unwrap();
    let record = RarRecord {
        path: "a_b.txt".to_string(),
        size: 0,
        packed_size: 0,
        modified_unix: 0,
        encrypted: false,
        is_folder: false,
        is_link: false,
        is_stream: false,
    };
    assert_eq!(listing.entries.len(), 1);
    let result = verify_candidate(&archive, &record, &ArchiveReadOptions::default(), &runner);
    assert!(
        matches!(result, Err(ArchiveError::AmbiguousRar)),
        "{result:?}"
    );
}

#[test]
fn rar_real_underscore_and_at_names_are_literal() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    let names = ["@literal.txt", "a_b.txt"];
    let mut entries = String::new();
    for name in names {
        entries.push_str(&entry(name, 3));
    }
    let runner = FakeRunner::new(
        &full_listing(&entries, 100),
        &full_listing(&entry("@literal.txt", 3), 100),
        b"abc",
    );
    let token = new_cancellation_token();
    let listing = list_rar(
        &archive,
        &Limits::default(),
        &token,
        &ArchiveReadOptions::default(),
        &runner,
    )
    .unwrap();
    let record = listing
        .entries
        .iter()
        .find(|entry| entry.path == "@literal.txt")
        .unwrap();
    let record = RarRecord {
        path: record.path.clone(),
        size: record.size,
        packed_size: record.packed_size,
        modified_unix: record.modified_unix,
        encrypted: record.encrypted,
        is_folder: false,
        is_link: false,
        is_stream: false,
    };
    let mut output = Vec::new();
    let written = extract_rar_file(
        &archive,
        &record,
        &ArchiveReadOptions::default(),
        &runner,
        &token,
        &mut output,
    )
    .unwrap();
    assert_eq!(written, 3);
    assert_eq!(output, b"abc");
    let calls = runner.calls();
    let stream_call = calls.last().unwrap();
    assert!(stream_call.0.contains(&"-spd".to_string()));
    assert!(stream_call.0.contains(&"-ssc".to_string()));
    assert!(stream_call.0.contains(&"-r-".to_string()));
    let separator = stream_call.0.iter().position(|arg| arg == "--").unwrap();
    assert_eq!(stream_call.0.last().unwrap(), "@literal.txt");
    assert!(separator < stream_call.0.len() - 1);
}

#[test]
fn rar_duplicate_case_or_normalized_names_are_refused() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    let mut entries = String::new();
    entries.push_str(&entry("A.TXT", 1));
    entries.push_str(&entry("a.txt", 1));
    let runner = FakeRunner::new(&full_listing(&entries, 100), &header(100), b"");
    let token = new_cancellation_token();
    let result = list_rar(
        &archive,
        &Limits::default(),
        &token,
        &ArchiveReadOptions::default(),
        &runner,
    );
    assert!(
        matches!(result, Err(ArchiveError::AmbiguousRar)),
        "{result:?}"
    );
    assert!(runner.calls().len() == 1, "no extraction command was run");
}

#[test]
fn rar_volume_links_streams_and_sfx_are_refused() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    let token = new_cancellation_token();

    let mut volumes = header(100);
    volumes = volumes.replace("Type = Rar", "Type = Rar\nVolumes = 2");
    volumes.push_str(&entry("a.txt", 1));
    let runner = FakeRunner::new(&volumes, &header(100), b"");
    assert!(matches!(
        list_rar(
            &archive,
            &Limits::default(),
            &token,
            &ArchiveReadOptions::default(),
            &runner
        ),
        Err(ArchiveError::MultiVolume)
    ));

    let link = full_listing("Path = link\nSymbolic Link = a.txt\nSize = 0\n\n", 100);
    let runner = FakeRunner::new(&link, &header(100), b"");
    assert!(matches!(
        list_rar(
            &archive,
            &Limits::default(),
            &token,
            &ArchiveReadOptions::default(),
            &runner
        ),
        Err(ArchiveError::AmbiguousRar)
    ));

    let stream = full_listing("Path = a.txt\nSize = 1\nAlternate Stream = +\n\n", 100);
    let runner = FakeRunner::new(&stream, &header(100), b"");
    assert!(matches!(
        list_rar(
            &archive,
            &Limits::default(),
            &token,
            &ArchiveReadOptions::default(),
            &runner
        ),
        Err(ArchiveError::AmbiguousRar)
    ));

    // A self-extracting prefix is never scanned for a RAR signature.
    let sfx = folder.path().join("setup.exe");
    std::fs::write(
        &sfx,
        [b"MZ".as_slice(), &[0u8; 64], b"Rar!\x1A\x07\x00"].concat(),
    )
    .unwrap();
    assert!(
        detect_format(&sfx).is_err(),
        "a self-extracting prefix is never scanned for a signature"
    );
}

#[test]
fn rar_password_is_only_on_stdin() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    let listing = full_listing(&entry("a.txt", 3), 100);
    let exact = full_listing(&entry("a.txt", 3), 100);
    let runner = FakeRunner::new(&listing, &exact, b"abc");
    let token = new_cancellation_token();
    let options = ArchiveReadOptions::with_password(Some(SECRET.to_string()));

    let listed = list_rar(&archive, &Limits::default(), &token, &options, &runner).unwrap();
    let record = RarRecord {
        path: "a.txt".to_string(),
        size: listed.entries[0].size,
        packed_size: 0,
        modified_unix: 0,
        encrypted: false,
        is_folder: false,
        is_link: false,
        is_stream: false,
    };
    let mut output = Vec::new();
    extract_rar_file(&archive, &record, &options, &runner, &token, &mut output).unwrap();

    let calls = runner.calls();
    assert!(calls.len() >= 3);
    for (args, stdin) in &calls {
        for arg in args {
            assert!(!arg.contains(SECRET), "no argument contains the secret");
            assert!(!arg.contains('ñ'));
        }
        assert!(
            stdin.as_deref() == Some(format!("{SECRET}\n").as_bytes()),
            "the secret travels once, as UTF-8 plus a newline, on stdin"
        );
    }

    // Without a password stdin is closed immediately.
    let runner = FakeRunner::new(&listing, &exact, b"abc");
    list_rar(
        &archive,
        &Limits::default(),
        &token,
        &ArchiveReadOptions::default(),
        &runner,
    )
    .unwrap();
    for (_, stdin) in runner.calls() {
        assert!(stdin.is_none(), "no password means no stdin data");
    }
}

#[test]
fn rar_failed_or_oversized_stream_never_publishes() {
    let folder = tempfile::tempdir().unwrap();
    let archive = dummy_archive(folder.path());
    let listing = full_listing(&entry("a.txt", 3), 100);
    let record = RarRecord {
        path: "a.txt".to_string(),
        size: 3,
        packed_size: 3,
        modified_unix: 0,
        encrypted: false,
        is_folder: false,
        is_link: false,
        is_stream: false,
    };
    let token = new_cancellation_token();

    // A child that fails writes nothing to the destination.
    let mut failing = FakeRunner::new(&listing, &listing, b"abc");
    failing.stream_success = false;
    let dest = folder.path().join("published.txt");
    let mut output = Vec::new();
    let result = extract_rar_file(
        &archive,
        &record,
        &ArchiveReadOptions::default(),
        &failing,
        &token,
        &mut output,
    );
    assert!(result.is_err());
    assert!(!dest.exists());

    // Extra bytes beyond the declared size are refused.
    let oversized = FakeRunner::new(&listing, &listing, b"abcdef");
    let mut output = Vec::new();
    let result = extract_rar_file(
        &archive,
        &record,
        &ArchiveReadOptions::default(),
        &oversized,
        &token,
        &mut output,
    );
    assert!(
        matches!(result, Err(ArchiveError::OutputChanged)),
        "{result:?}"
    );

    // A short stream is refused too.
    let short = FakeRunner::new(&listing, &listing, b"ab");
    let mut output = Vec::new();
    let result = extract_rar_file(
        &archive,
        &record,
        &ArchiveReadOptions::default(),
        &short,
        &token,
        &mut output,
    );
    assert!(
        matches!(result, Err(ArchiveError::OutputChanged)),
        "{result:?}"
    );

    // Cancellation stops the copy before publication.
    let runner = FakeRunner::new(&listing, &listing, b"abc");
    token.store(true, Ordering::Relaxed);
    let mut output = Vec::new();
    let result = extract_rar_file(
        &archive,
        &record,
        &ArchiveReadOptions::default(),
        &runner,
        &token,
        &mut output,
    );
    assert!(matches!(result, Err(ArchiveError::Cancelled)), "{result:?}");
}
