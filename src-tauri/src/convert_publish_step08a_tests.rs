//! Output-publication tests for Step 08a T4. Real temporary folders, real
//! owned staging: no user file is ever named by these tests.

use std::fs;

use convert::{
    ConversionOutput, ConvertError, ConvertOutputSink, FormatId, OutputDraft, OutputMetadata,
    OutputNamePart, WorkItemResult, WorkItemStatus,
};
use fs_service::owned_io::PinnedDirectory;
use sha2::{Digest, Sha256};

use super::PublishSink;
use crate::convert_reports::StoredReport;

fn hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::new();
    for byte in digest.iter() {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

fn draft() -> OutputDraft {
    OutputDraft {
        name_hint: "photo.png".to_string(),
        name_part: OutputNamePart::None,
        mime: "image/png".to_string(),
        input_indices: vec![0],
    }
}

fn metadata(bytes: &[u8]) -> OutputMetadata {
    OutputMetadata {
        byte_len: bytes.len() as u64,
        width: Some(1),
        height: Some(1),
        metadata_lost: Vec::new(),
        warnings: Vec::new(),
        hash_sha256: hash(bytes),
    }
}

#[test]
fn pre_existing_output_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("photo.png");
    fs::write(&old, b"old contents").unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    sink.write(index, b"new file").unwrap();
    sink.finish(index, metadata(b"new file")).unwrap();
    assert_eq!(fs::read(&old).unwrap(), b"old contents");
    assert_eq!(sink.published().len(), 1);
    assert!(sink.published()[0].path.ends_with("photo (1).png"));
    assert_eq!(fs::read(&sink.published()[0].path).unwrap(), b"new file");
}

#[test]
fn arriving_destination_is_kept_and_the_numbered_name_is_used() {
    let dir = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    sink.write(index, b"ours").unwrap();
    // Another program wins the race for the plain name.
    let arrived = dir.path().join("photo.png");
    fs::write(&arrived, b"theirs").unwrap();
    sink.finish(index, metadata(b"ours")).unwrap();
    assert_eq!(fs::read(&arrived).unwrap(), b"theirs");
    assert!(sink.published()[0].path.ends_with("photo (1).png"));
    assert_eq!(fs::read(&sink.published()[0].path).unwrap(), b"ours");
}

#[test]
fn flush_failure_publishes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new_failing_flush(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    sink.write(index, b"partial").unwrap();
    let result = sink.finish(index, metadata(b"partial"));
    assert!(matches!(result, Err(ConvertError::Io(_))));
    assert!(sink.published().is_empty());
    let entries = fs::read_dir(dir.path()).unwrap().count();
    assert_eq!(entries, 0);
}

#[test]
fn cancel_keeps_the_source_and_a_foreign_partial() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    fs::write(&source, b"original bytes").unwrap();
    let foreign = dir
        .path()
        .join(format!("~adp-other-{}.partial", uuid::Uuid::new_v4()));
    fs::write(&foreign, b"not ours").unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    sink.write(index, b"unfinished").unwrap();
    sink.abort(index).unwrap();
    assert_eq!(fs::read(&source).unwrap(), b"original bytes");
    assert!(foreign.exists());
    assert_eq!(fs::read(&foreign).unwrap(), b"not ours");
    assert!(sink.published().is_empty());
    // Only the source and the foreign file remain; our staging is gone.
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn a_wrong_hash_is_refused_before_publication() {
    let dir = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    sink.write(index, b"bytes").unwrap();
    let mut bad = metadata(b"bytes");
    bad.hash_sha256 = "0".repeat(64);
    assert!(sink.finish(index, bad).is_err());
    assert!(sink.published().is_empty());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn a_second_open_output_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(dir.path()).unwrap();
    let mut sink = PublishSink::new(pinned, "photo".to_string(), FormatId::Png);
    let index = sink.begin(draft()).unwrap();
    assert_eq!(
        sink.begin(draft()).err().map(|error| error.code()),
        Some("convert.bad_request")
    );
    sink.abort(index).unwrap();
}

#[test]
fn partial_batch_done_2_failed_1_reports_three_exact() {
    let items = vec![
        WorkItemResult {
            input_index: 0,
            source_path: Some(r"C:\a.png".to_string()),
            output_count: 1,
            status: WorkItemStatus::Done,
            reason: None,
            metadata_lost: Vec::new(),
            bytes_written: 3,
        },
        WorkItemResult {
            input_index: 1,
            source_path: Some(r"C:\b.png".to_string()),
            output_count: 0,
            status: WorkItemStatus::Failed,
            reason: Some("unsupported".to_string()),
            metadata_lost: Vec::new(),
            bytes_written: 0,
        },
        WorkItemResult {
            input_index: 2,
            source_path: Some(r"C:\c.png".to_string()),
            output_count: 1,
            status: WorkItemStatus::Done,
            reason: None,
            metadata_lost: Vec::new(),
            bytes_written: 4,
        },
    ];
    let outputs = vec![
        ConversionOutput {
            output_id: uuid::Uuid::new_v4().to_string(),
            input_indices: vec![0],
            output_index: 0,
            path: r"C:\out\a.png".to_string(),
            byte_len: 3,
        },
        ConversionOutput {
            output_id: uuid::Uuid::new_v4().to_string(),
            input_indices: vec![2],
            output_index: 1,
            path: r"C:\out\c.png".to_string(),
            byte_len: 4,
        },
    ];
    let stored = StoredReport::new(items, outputs, false);
    assert_eq!(stored.input_total, 3);
    assert_eq!(stored.done_count, 2);
    assert_eq!(stored.failed_count, 1);
    assert_eq!(stored.outputs_created, 2);
    let reports = crate::convert_reports::ConversionReports::default();
    let page = reports.insert(stored).unwrap();
    assert_eq!(page.items.len(), 3);
    assert_eq!(page.outputs.len(), 2);
    assert_eq!(page.created_paths.len(), 2);
    assert!(page.complete);
    assert_eq!(page.failed_count, 1);
}
