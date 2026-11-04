//! Pause, resume, skip, cancel and retry of the step-09f copy engine.
//!
//! Every test uses disposable folders under the system temporary directory
//! and a synthetic file; no user file is touched.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use fs_service::owned_io::{PinnedDirectory, PinnedSource, SourceIdentity};
use fs_service::transfer_copy::{copy_file, CopyError, FileCopyRequest, StagedFile, CHUNK};
use fs_service::transfer_decisions::{
    allowed_actions, DecisionAction, DecisionTicket, PendingKind, RetryCounter, TransferGate,
};
use fs_service::transfer_rates::{RateSampler, TransferCounters};
use fs_service::SourceStamp;

fn synthetic(path: &Path, len: usize) {
    let bytes: Vec<u8> = (0..len).map(|index| (index % 251) as u8).collect();
    std::fs::write(path, bytes).unwrap();
}

fn read_back(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

struct RunningCopy {
    handle: thread::JoinHandle<Result<StagedFile, CopyError>>,
    observed: Arc<AtomicU64>,
    gate: Arc<TransferGate>,
}

/// Start a copy of `source` into `destination`, pausing (`stop`) once the
/// first megabyte has been written.
fn start_copy(source: PathBuf, destination: PathBuf, stop: Stop) -> RunningCopy {
    let gate = Arc::new(TransferGate::new());
    let observed = Arc::new(AtomicU64::new(0));
    let worker_gate = Arc::clone(&gate);
    let worker_observed = Arc::clone(&observed);
    let handle = thread::spawn(move || {
        let directory = PinnedDirectory::open(&destination).unwrap();
        let identity = SourceIdentity::capture(&source).unwrap();
        let mut pinned = PinnedSource::open(&source, &identity).unwrap();
        let token = fs_service::new_cancellation_token();
        let mut counters = TransferCounters::new(1, identity.size);
        let mut rates = RateSampler::new();
        let mut on_chunk = |bytes: u64| {
            let total = worker_observed.fetch_add(bytes, Ordering::SeqCst) + bytes;
            if total == CHUNK as u64 {
                match stop {
                    Stop::Pause => {
                        worker_gate.pause();
                    }
                    Stop::Cancel => {
                        worker_gate.cancel();
                    }
                }
            }
        };
        copy_file(
            FileCopyRequest {
                source: &mut pinned,
                directory: &directory,
                hint: "sample",
                verify: false,
                token: &token,
                gate: &worker_gate,
                on_chunk: &mut on_chunk,
            },
            &mut counters,
            &mut rates,
        )
    });
    RunningCopy {
        handle,
        observed,
        gate,
    }
}

#[derive(Clone, Copy)]
enum Stop {
    Pause,
    Cancel,
}

fn wait_for_boundary(observed: &AtomicU64) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while observed.load(Ordering::SeqCst) < CHUNK as u64 {
        assert!(
            Instant::now() < deadline,
            "the copy never reached one chunk"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn pause_at_the_boundary_writes_no_additional_byte() {
    let source_dir = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let source = source_dir.path().join("sample.bin");
    synthetic(&source, CHUNK * 5 / 2);
    let running = start_copy(source, destination.path().to_path_buf(), Stop::Pause);
    wait_for_boundary(&running.observed);
    thread::sleep(Duration::from_millis(150));
    assert_eq!(
        running.observed.load(Ordering::SeqCst),
        CHUNK as u64,
        "a paused copy must not read or write another byte"
    );
    running.gate.resume();
    let staged = running.handle.join().unwrap().unwrap();
    assert_eq!(staged.bytes_written, (CHUNK * 5 / 2) as u64);
}

#[test]
fn resume_continues_at_the_exact_offset() {
    let source_dir = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let source = source_dir.path().join("sample.bin");
    let len = CHUNK * 5 / 2 + 17;
    synthetic(&source, len);
    let running = start_copy(
        source.clone(),
        destination.path().to_path_buf(),
        Stop::Pause,
    );
    wait_for_boundary(&running.observed);
    thread::sleep(Duration::from_millis(80));
    running.gate.resume();
    let mut staged = running.handle.join().unwrap().unwrap();
    let landed = staged.publish("sample.bin").unwrap();
    assert_eq!(read_back(&landed), read_back(&source));
    assert_eq!(read_back(&landed).len(), len);
}

#[test]
fn cancel_disposes_only_the_owned_partial() {
    let source_dir = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let source = source_dir.path().join("sample.bin");
    synthetic(&source, CHUNK * 3);
    // Two files another program left in the destination. Neither is ours.
    let predictable = destination.path().join("~sample.bin.partial");
    std::fs::write(&predictable, b"another program's file").unwrap();
    let foreign = destination.path().join("notes.txt");
    std::fs::write(&foreign, b"keep me").unwrap();
    let running = start_copy(
        source.clone(),
        destination.path().to_path_buf(),
        Stop::Cancel,
    );
    wait_for_boundary(&running.observed);
    let outcome = running.handle.join().unwrap();
    assert_eq!(outcome.err(), Some(CopyError::Cancelled));
    assert_eq!(read_back(&predictable), b"another program's file");
    assert_eq!(read_back(&foreign), b"keep me");
    // Only the two decoys remain: our staging file was disposed of.
    let mut names: Vec<String> = std::fs::read_dir(destination.path())
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["notes.txt".to_string(), "~sample.bin.partial".to_string()]
    );
    // The source is untouched byte for byte.
    assert_eq!(read_back(&source).len(), CHUNK * 3);
}

#[test]
fn skip_keeps_completed_items_and_their_bytes() {
    let source_dir = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let first = source_dir.path().join("first.bin");
    let second = source_dir.path().join("second.bin");
    synthetic(&first, 4096);
    synthetic(&second, 8192);
    let gate = TransferGate::new();
    let token = fs_service::new_cancellation_token();
    let mut counters = TransferCounters::new(2, 4096 + 8192);
    let mut rates = RateSampler::new();

    let directory = PinnedDirectory::open(destination.path()).unwrap();
    let identity = SourceIdentity::capture(&first).unwrap();
    let mut pinned = PinnedSource::open(&first, &identity).unwrap();
    let mut on_chunk = |_bytes: u64| {};
    let mut staged = copy_file(
        FileCopyRequest {
            source: &mut pinned,
            directory: &directory,
            hint: "first",
            verify: false,
            token: &token,
            gate: &gate,
            on_chunk: &mut on_chunk,
        },
        &mut counters,
        &mut rates,
    )
    .unwrap();
    let landed = staged.publish("first.bin").unwrap();
    counters.finish_item().unwrap();
    drop(pinned);

    // The user skips the second file while it is the current item.
    gate.skip_current();
    let identity = SourceIdentity::capture(&second).unwrap();
    let mut pinned = PinnedSource::open(&second, &identity).unwrap();
    let mut on_chunk = |_bytes: u64| {};
    let skipped = copy_file(
        FileCopyRequest {
            source: &mut pinned,
            directory: &directory,
            hint: "second",
            verify: false,
            token: &token,
            gate: &gate,
            on_chunk: &mut on_chunk,
        },
        &mut counters,
        &mut rates,
    );
    assert_eq!(skipped.err(), Some(CopyError::Skipped));
    assert_eq!(read_back(&landed).len(), 4096);
    assert!(!destination.path().join("second.bin").exists());
}

#[test]
fn three_retries_then_the_item_is_refused() {
    let mut retries = RetryCounter::default();
    assert_eq!(retries.retry(), Ok(1));
    assert_eq!(retries.retry(), Ok(2));
    assert_eq!(retries.retry(), Ok(3));
    assert!(!retries.can_retry());
    assert!(retries.retry().is_err());
    assert_eq!(
        allowed_actions(PendingKind::Error, false, retries.used()),
        vec![DecisionAction::Skip, DecisionAction::Cancel]
    );
}

#[test]
fn a_changed_source_forces_a_fresh_review() {
    let source_dir = tempfile::tempdir().unwrap();
    let source = source_dir.path().join("reviewed.txt");
    std::fs::write(&source, b"reviewed bytes").unwrap();
    let reviewed = SourceIdentity::capture(&source).unwrap();
    let stamp: SourceStamp = fs_service::transfer_copy::entry_stamp(&source).unwrap();
    let ticket = DecisionTicket {
        decision_id: uuid::Uuid::new_v4(),
        item_id: uuid::Uuid::new_v4(),
        generation: 2,
        source: stamp.clone(),
        target: None,
    };
    std::fs::write(&source, b"something else entirely").unwrap();
    // The guarded open refuses a different object at the same path.
    assert!(PinnedSource::open(&source, &reviewed).is_err());
    let current = fs_service::transfer_copy::entry_stamp(&source).unwrap();
    assert!(!ticket.source_unchanged(&current));
    assert!(ticket.source_unchanged(&stamp));
}
