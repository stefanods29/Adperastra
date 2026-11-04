//! Step 12a H04 tests: the helper accepts only app-owned paths, checks the
//! complete archive hash before ZIP parsing and leaves no outside file.

use std::collections::BTreeMap;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use pack_store::types::{PackDescriptor, PackFile, PackId};
use pack_store::validation::sha256_hex;

use super::{
    check_reply, run_helper_with, PackHelperRequest, PackHelperReply, FRAME_ERROR, FRAME_EXTRACTED,
    FRAME_REQUEST, MAX_REPLY_BYTES, REPLY_SCHEMA_VERSION,
};
use crate::helper_frames::{encode_frame, read_frame, HelperFrameEvent};

const README: &[u8] = b"Adperastra pack fixture";

fn descriptor(archive: &[u8]) -> PackDescriptor {
    let mut entrypoints = BTreeMap::new();
    entrypoints.insert("run".to_string(), "README.txt".to_string());
    PackDescriptor {
        id: PackId::Media,
        version: "1.0.0".to_string(),
        name_key: "packs.media.name".to_string(),
        description_key: "packs.media.description".to_string(),
        download_url: "https://packs.example.com/media-1.0.0.zip".to_string(),
        download_bytes: archive.len() as u64,
        install_bytes: README.len() as u64,
        sha256: sha256_hex(archive),
        licenses: vec!["MIT".to_string()],
        source_urls: vec!["https://example.com/source".to_string()],
        files: vec![PackFile {
            path: "README.txt".to_string(),
            size: README.len() as u64,
            sha256: sha256_hex(README),
            executable: false,
        }],
        dependencies: Vec::new(),
        enables: Vec::new(),
        entrypoints,
        catalog_revision: 1,
    }
}

fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = std::fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

struct Fixture {
    _temporary: tempfile::TempDir,
    root: PathBuf,
    archive: PathBuf,
    staging: PathBuf,
    descriptor: PackDescriptor,
}

fn fixture(entries: &[(&str, &[u8])]) -> Fixture {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let downloads = root.join("downloads");
    let staging_root = root.join("staging");
    std::fs::create_dir_all(&downloads).unwrap();
    std::fs::create_dir_all(&staging_root).unwrap();
    let archive = downloads.join(format!("{}.part", uuid::Uuid::new_v4()));
    write_zip(&archive, entries);
    let staging = staging_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir(&staging).unwrap();
    let bytes = std::fs::read(&archive).unwrap();
    Fixture {
        _temporary: temporary,
        root,
        archive,
        staging,
        descriptor: descriptor(&bytes),
    }
}

fn request(fixture: &Fixture) -> PackHelperRequest {
    PackHelperRequest {
        schema_version: 1,
        id: fixture.descriptor.id,
        version: fixture.descriptor.version.clone(),
        packs_root: fixture.root.to_string_lossy().into_owned(),
        archive_path: fixture.archive.to_string_lossy().into_owned(),
        staging_path: fixture.staging.to_string_lossy().into_owned(),
        descriptor: fixture.descriptor.clone(),
    }
}

fn run(request: &PackHelperRequest) -> (i32, HelperFrameEvent) {
    let body = serde_json::to_vec(request).unwrap();
    let mut input = Cursor::new(encode_frame(FRAME_REQUEST, &body).unwrap());
    let mut output = Vec::new();
    let code = run_helper_with(&mut input, &mut output);
    let frame = read_frame(&mut Cursor::new(output), MAX_REPLY_BYTES);
    (code, frame)
}

#[test]
fn valid_archive_extracts_inside_owned_staging() {
    let fixture = fixture(&[("README.txt", README)]);
    let (code, frame) = run(&request(&fixture));
    assert_eq!(code, 0);
    let reply: PackHelperReply = match frame {
        HelperFrameEvent::Frame {
            kind: FRAME_EXTRACTED,
            body,
        } => serde_json::from_slice(&body).unwrap(),
        other => panic!("unexpected helper answer: {other:?}"),
    };
    assert_eq!(reply.schema_version, REPLY_SCHEMA_VERSION);
    assert_eq!(reply.archive_sha256, fixture.descriptor.sha256);
    assert_eq!(reply.descriptor_digest, fixture.descriptor.digest());
    assert_eq!(reply.file_count, 1);
    assert_eq!(reply.total_bytes, README.len() as u64);
    assert_eq!(
        std::fs::read(fixture.staging.join("README.txt")).unwrap(),
        README
    );
}

#[test]
fn one_changed_archive_byte_is_refused_before_extraction() {
    let fixture = fixture(&[("README.txt", README)]);
    let mut bytes = std::fs::read(&fixture.archive).unwrap();
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0x01;
    std::fs::write(&fixture.archive, &bytes).unwrap();
    let (code, frame) = run(&request(&fixture));
    assert_eq!(code, 0);
    assert_eq!(
        frame,
        HelperFrameEvent::Frame {
            kind: FRAME_ERROR,
            body: b"packs.bad_hash".to_vec()
        }
    );
    assert!(std::fs::read_dir(&fixture.staging).unwrap().next().is_none());
}

#[test]
fn traversal_entry_never_writes_outside_staging() {
    let fixture = fixture(&[("README.txt", README), ("../outside.txt", b"escaped")]);
    let (code, frame) = run(&request(&fixture));
    assert_eq!(code, 0);
    assert_eq!(
        frame,
        HelperFrameEvent::Frame {
            kind: FRAME_ERROR,
            body: b"packs.bad_request".to_vec()
        }
    );
    assert!(!fixture.root.join("staging").join("outside.txt").exists());
    assert!(!fixture.root.join("outside.txt").exists());
}

#[test]
fn an_archive_outside_the_owned_downloads_folder_is_refused() {
    let fixture = fixture(&[("README.txt", README)]);
    let foreign = fixture.root.join("foreign.part");
    std::fs::write(&foreign, std::fs::read(&fixture.archive).unwrap()).unwrap();
    let mut request = request(&fixture);
    request.archive_path = foreign.to_string_lossy().into_owned();
    let (code, frame) = run(&request);
    assert_eq!(code, 0);
    assert_eq!(
        frame,
        HelperFrameEvent::Frame {
            kind: FRAME_ERROR,
            body: b"packs.bad_request".to_vec()
        }
    );
}

#[test]
fn a_wrong_file_count_in_the_answer_is_changed() {
    let fixture = fixture(&[("README.txt", README)]);
    let reply = PackHelperReply {
        schema_version: REPLY_SCHEMA_VERSION,
        archive_sha256: fixture.descriptor.sha256.clone(),
        descriptor_digest: fixture.descriptor.digest(),
        file_count: 2,
        total_bytes: README.len() as u64,
    };
    assert_eq!(check_reply(&reply, &fixture.descriptor), Err("packs.changed".to_string()));
}
