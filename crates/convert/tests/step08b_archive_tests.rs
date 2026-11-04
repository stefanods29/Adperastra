//! Step 08b guarded ZIP/7z conversion (D7/T5). Written, not run by the worker.

use std::io::{Cursor, Write};
use std::path::Path;
use std::sync::atomic::Ordering;

use archive::{
    create_spool, extract, plan_create, CreateEncryption, CreateFormat, CreateLimits,
    CreateOptions, ExtractEvents, ExtractRequest, Limits,
};
use convert::archive_adapter::ArchiveConverter;
use convert::error::ConvertError;
use convert::types::{ConvertOptions, OutputDraft, OutputMetadata, PreparedOutput};
use convert::{ConvertContext, ConvertOutputSink, ConvertSource, Converter};
use fs_service::{new_cancellation_token, OpProgress};
use tempfile::tempdir;

struct Sink {
    begins: u32,
    bytes: Vec<u8>,
    metadata: Vec<OutputMetadata>,
}

impl Sink {
    fn new() -> Self {
        Self {
            begins: 0,
            bytes: Vec::new(),
            metadata: Vec::new(),
        }
    }
}

impl ConvertOutputSink for Sink {
    fn begin(&mut self, _draft: OutputDraft) -> Result<u32, ConvertError> {
        self.begins += 1;
        Ok(0)
    }

    fn write(&mut self, _output_index: u32, bytes: &[u8]) -> Result<(), ConvertError> {
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    fn finish(&mut self, _output_index: u32, metadata: OutputMetadata) -> Result<(), ConvertError> {
        self.metadata.push(metadata);
        Ok(())
    }

    fn abort(&mut self, _output_index: u32) -> Result<(), ConvertError> {
        self.bytes.clear();
        Ok(())
    }
}

struct NoEvents;

impl ExtractEvents for NoEvents {
    fn progress(&mut self, _progress: &OpProgress) {}
    fn created(&mut self, _path: &Path) {}
}

fn create_options(format: CreateFormat, password: Option<&str>) -> CreateOptions {
    serde_json::from_value(serde_json::json!({
        "format": format,
        "encryption": if password.is_some() { CreateEncryption::Aes256 } else { CreateEncryption::None },
        "password": password,
        "encrypt_names": false,
        "include_hidden": true
    }))
    .unwrap()
}

fn make_archive(root: &Path, format: CreateFormat, password: Option<&str>) -> Vec<u8> {
    let files = root.join("files");
    std::fs::create_dir_all(files.join("folder")).unwrap();
    std::fs::write(files.join("a.txt"), b"alpha").unwrap();
    std::fs::write(files.join("b.txt"), b"bravo").unwrap();
    std::fs::write(files.join("folder").join("c.txt"), b"charlie").unwrap();
    let sources = vec![
        files.join("a.txt").to_string_lossy().into_owned(),
        files.join("b.txt").to_string_lossy().into_owned(),
        files.join("folder").to_string_lossy().into_owned(),
    ];
    let token = new_cancellation_token();
    let plan = plan_create(
        &sources,
        true,
        &CreateLimits::default(),
        &token,
        &mut |_| {},
    )
    .unwrap();
    let extension = match format {
        CreateFormat::Zip => "zip",
        CreateFormat::SevenZ => "7z",
    };
    let spool = root.join(format!("fixture.{extension}"));
    create_spool(
        &plan,
        &create_options(format, password),
        &spool,
        &CreateLimits::default(),
        &token,
        &mut |_| {},
    )
    .unwrap();
    std::fs::read(spool).unwrap()
}

fn options(source_password: Option<&str>, target: &str) -> ConvertOptions {
    serde_json::from_value(serde_json::json!({
        "kind": "archive",
        "value": {
            "format": target,
            "level": 6,
            "password": null,
            "source_password": source_password,
            "encrypt_names": false,
            "preserve_timestamps": true
        }
    }))
    .unwrap()
}

fn source(name: &str, bytes: Vec<u8>) -> ConvertSource {
    ConvertSource {
        input_index: 0,
        name: name.to_string(),
        mime: "application/zip".to_string(),
        byte_len: bytes.len() as u64,
        source_stamp: None,
        reader: Box::new(Cursor::new(bytes)),
    }
}

fn context() -> ConvertContext {
    ConvertContext {
        cancel: new_cancellation_token(),
        progress: Box::new(|_| Ok(())),
        max_output_bytes: 64 * 1024 * 1024,
    }
}

fn convert(
    root: &Path,
    bytes: Vec<u8>,
    options: ConvertOptions,
) -> Result<(Sink, PreparedOutput), ConvertError> {
    let work = root.join("work");
    std::fs::create_dir_all(&work).unwrap();
    let converter = ArchiveConverter::new("zip/seven_z", work).unwrap();
    let mut input = [source("fixture.zip", bytes)];
    let mut sink = Sink::new();
    let mut context = context();
    let prepared = converter.convert(&mut input, &options, &mut sink, &mut context)?;
    Ok((sink, prepared))
}

#[test]
fn names_and_entry_hashes_roundtrip() {
    let dir = tempdir().unwrap();
    let zip = make_archive(dir.path(), CreateFormat::Zip, None);
    let (sink, prepared) = convert(dir.path(), zip, options(None, "seven_z")).unwrap();
    assert_eq!(sink.begins, 1);
    assert_eq!(prepared.outputs_count, 1);
    assert!(serde_json::to_string(&prepared.metadata_lost)
        .unwrap()
        .contains("comments"));
    let out = dir.path().join("out.7z");
    std::fs::write(&out, &sink.bytes).unwrap();
    let listing = archive::list(
        &out,
        &Limits::default(),
        &new_cancellation_token(),
        &mut |_| {},
    )
    .unwrap();
    let names: Vec<&str> = listing
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    assert!(names.contains(&"a.txt"));
    assert!(names.contains(&"b.txt"));
    assert!(names.contains(&"folder/c.txt"));

    let dest = dir.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let metadata = std::fs::metadata(&out).unwrap();
    let request = ExtractRequest {
        paths: Vec::new(),
        base: String::new(),
        dest_dir: dest.to_string_lossy().into_owned(),
        new_folder: None,
        expected_size: metadata.len(),
        expected_modified: 0,
        single_file: false,
        zone: None,
    };
    let mut events = NoEvents;
    extract(
        &out,
        &request,
        &Limits::default(),
        &new_cancellation_token(),
        &mut events,
    )
    .unwrap();
    assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"alpha");
    assert_eq!(
        std::fs::read(dest.join("folder").join("c.txt")).unwrap(),
        b"charlie"
    );
}

#[test]
fn traversal_is_refused_before_output() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("evil.zip");
    {
        let file = std::fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../escape.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"escape").unwrap();
        writer.finish().unwrap();
    }
    let bytes = std::fs::read(path).unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let converter = ArchiveConverter::new("zip/seven_z", work).unwrap();
    let mut input = [source("evil.zip", bytes)];
    let mut sink = Sink::new();
    let mut context = context();
    assert!(converter
        .convert(
            &mut input,
            &options(None, "seven_z"),
            &mut sink,
            &mut context
        )
        .is_err());
    assert_eq!(sink.begins, 0);
}

#[test]
fn malformed_archive_publishes_nothing() {
    let dir = tempdir().unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let converter = ArchiveConverter::new("zip/seven_z", work).unwrap();
    let mut input = [source("broken.zip", b"not an archive".to_vec())];
    let mut sink = Sink::new();
    let mut context = context();
    assert!(converter
        .convert(
            &mut input,
            &options(None, "seven_z"),
            &mut sink,
            &mut context
        )
        .is_err());
    assert_eq!(sink.begins, 0);
}

#[test]
fn wrong_source_password_publishes_nothing() {
    let dir = tempdir().unwrap();
    let zip = make_archive(dir.path(), CreateFormat::Zip, Some("right"));
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let converter = ArchiveConverter::new("zip/seven_z", work).unwrap();
    let mut input = [source("locked.zip", zip)];
    let mut sink = Sink::new();
    let mut context = context();
    assert!(converter
        .convert(
            &mut input,
            &options(Some("wrong"), "seven_z"),
            &mut sink,
            &mut context
        )
        .is_err());
    assert_eq!(sink.begins, 0);
}

#[test]
fn foreign_intermediate_is_not_removed() {
    let dir = tempdir().unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let foreign = work.join("foreign.txt");
    std::fs::write(&foreign, b"keep me").unwrap();
    let zip = make_archive(dir.path(), CreateFormat::Zip, None);
    let converter = ArchiveConverter::new("zip/seven_z", work.clone()).unwrap();
    let mut input = [source("fixture.zip", zip)];
    let mut sink = Sink::new();
    let mut context = context();
    converter
        .convert(
            &mut input,
            &options(None, "seven_z"),
            &mut sink,
            &mut context,
        )
        .unwrap();
    assert_eq!(std::fs::read(foreign).unwrap(), b"keep me");
}

#[test]
fn cancellation_keeps_source_and_publishes_nothing() {
    let dir = tempdir().unwrap();
    let zip = make_archive(dir.path(), CreateFormat::Zip, None);
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let converter = ArchiveConverter::new("zip/seven_z", work).unwrap();
    let source_hash = blake3::hash(&zip);
    let mut input = [source("fixture.zip", zip.clone())];
    let mut sink = Sink::new();
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    let mut context = ConvertContext {
        cancel: token,
        progress: Box::new(|_| Ok(())),
        max_output_bytes: 64 * 1024 * 1024,
    };
    let result = converter.convert(
        &mut input,
        &options(None, "seven_z"),
        &mut sink,
        &mut context,
    );
    assert!(result.is_err());
    assert_eq!(sink.begins, 0);
    assert_eq!(blake3::hash(&zip), source_hash);
}
