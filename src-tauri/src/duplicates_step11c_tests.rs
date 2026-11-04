//! Step 11c T4/T5 native oracles. Synthetic temp folders only; no user file
//! is read or changed.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use ::storage_scan::{Coverage, DuplicateGroup, DuplicateMember, DuplicateRequest};
use fs_service::owned_io::SourceIdentity;
use fs_service::{capture_source_stamp, new_cancellation_token, CancellationToken, FileIdentityKey};

use crate::duplicate_candidates::{group_candidates, CandidateFile};
use crate::duplicate_cleanup::{
    build_plan, validate_bindings, DuplicateCleanupService,
};
use crate::duplicate_hash::{full_hash_guarded, partial_hash, partial_hash_reader};
use crate::duplicate_compare::verify_group;
use crate::duplicates::collect_groups;

fn candidate(path: &Path) -> CandidateFile {
    let stamp = capture_source_stamp(path).unwrap();
    CandidateFile {
        paths: vec![path.to_string_lossy().into_owned()],
        key: FileIdentityKey {
            volume_id: stamp.volume_id.clone(),
            file_id: stamp.file_id.clone(),
            path_key: stamp.path_key.clone(),
            stable: true,
        },
        source: stamp,
        identity: SourceIdentity::capture(path).unwrap(),
        logical_bytes: std::fs::metadata(path).unwrap().len(),
        allocated_bytes: None,
        modified_unix: 0,
    }
}

fn request(root: &Path) -> DuplicateRequest {
    DuplicateRequest {
        roots: vec![root.to_string_lossy().into_owned()],
        include_hidden: true,
        allow_network: false,
        minimum_bytes: 0,
    }
}

fn group_for(left: &Path, right: &Path) -> (DuplicateGroup, Vec<CandidateFile>) {
    let left_candidate = candidate(left);
    let right_candidate = candidate(right);
    let hash = *blake3::hash(&std::fs::read(left).unwrap()).as_bytes();
    let member = |candidate: &CandidateFile| DuplicateMember {
        key: candidate.key.clone(),
        source: candidate.source.clone(),
        paths: candidate.paths.clone(),
        full_hash: crate::duplicate_cleanup::hex(&hash),
        logical_bytes: candidate.logical_bytes,
        allocated_bytes: candidate.allocated_bytes,
        modified_unix: candidate.modified_unix,
        verified: true,
    };
    (
        DuplicateGroup {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            members: vec![member(&left_candidate), member(&right_candidate)],
            member_count: 2,
            members_page_complete: true,
            verified: true,
            reclaimable_bytes: Some(0),
        },
        vec![left_candidate, right_candidate],
    )
}

#[test]
fn same_size_unequal_bytes_are_not_verified() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("left.bin");
    let right = dir.path().join("right.bin");
    std::fs::write(&left, b"aaaa").unwrap();
    std::fs::write(&right, b"aaab").unwrap();
    let cancel = new_cancellation_token();
    let scan = collect_groups(&request(dir.path()), &cancel, &mut |_| {}, None).unwrap();
    assert!(scan.groups.is_empty());
    assert_eq!(scan.coverage, Coverage::Complete);
    let _ = (left, right);
}

#[test]
fn a_partial_hash_collision_fails_the_full_compare() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("left.bin");
    let right = dir.path().join("right.bin");
    let mut left_bytes = vec![b'A'; 140_000];
    let mut right_bytes = vec![b'A'; 140_000];
    left_bytes[70_000] = b'X';
    right_bytes[70_000] = b'Y';
    std::fs::write(&left, &left_bytes).unwrap();
    std::fs::write(&right, &right_bytes).unwrap();
    let left_candidate = candidate(&left);
    let right_candidate = candidate(&right);
    let cancel = new_cancellation_token();
    let left_partial = partial_hash(&left_candidate, &cancel).unwrap();
    let right_partial = partial_hash(&right_candidate, &cancel).unwrap();
    assert_eq!(left_partial, right_partial);
    let left_full = full_hash_guarded(&left_candidate, &cancel, &mut |_| {}).unwrap();
    let right_full = full_hash_guarded(&right_candidate, &cancel, &mut |_| {}).unwrap();
    assert_ne!(left_full, right_full);
    let members = vec![left_candidate, right_candidate];
    assert!(!verify_group(&members, &[left_full, right_full], &cancel).unwrap());
    let scan = collect_groups(&request(dir.path()), &cancel, &mut |_| {}, None).unwrap();
    assert!(scan.groups.is_empty());
}

#[test]
fn hardlink_aliases_collapse_to_one_physical_member() {
    let dir = tempfile::tempdir().unwrap();
    let first = dir.path().join("first.bin");
    std::fs::write(&first, b"same-bytes").unwrap();
    let second = dir.path().join("second.bin");
    std::fs::hard_link(&first, &second).unwrap();
    let records = ::storage_scan::walk::enumerate_files(
        &::storage_scan::FsScanIo,
        &[dir.path().to_path_buf()],
        true,
        false,
        &new_cancellation_token(),
        &mut |_| {},
    )
    .unwrap()
    .0;
    let (groups, skipped) = group_candidates(records, 0);
    assert!(groups.is_empty());
    assert_eq!(skipped, 0);
    let _ = (first, second);
}

#[test]
fn a_changed_stamp_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("changing.bin");
    std::fs::write(&path, b"original").unwrap();
    let captured = candidate(&path);
    std::fs::write(&path, b"changed-content").unwrap();
    let cancel = new_cancellation_token();
    let error = full_hash_guarded(&captured, &cancel, &mut |_| {}).unwrap_err();
    assert_eq!(error, "duplicates.changed");
}

#[test]
fn files_at_most_128_kib_are_read_once() {
    struct CountingReader {
        inner: std::io::Cursor<Vec<u8>>,
        reads: usize,
    }
    impl std::io::Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads += 1;
            self.inner.read(buffer)
        }
    }
    impl std::io::Seek for CountingReader {
        fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(position)
        }
    }
    let mut reader = CountingReader {
        inner: std::io::Cursor::new(vec![1u8; 64]),
        reads: 0,
    };
    let cancel = new_cancellation_token();
    partial_hash_reader(&mut reader, 64, &cancel).unwrap();
    assert_eq!(reader.reads, 1);
}

#[test]
fn cancel_makes_no_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keep.bin");
    std::fs::write(&path, b"keep me").unwrap();
    let before = std::fs::read(&path).unwrap();
    let captured = candidate(&path);
    let cancel: CancellationToken = Arc::new(AtomicBool::new(true));
    assert_eq!(
        full_hash_guarded(&captured, &cancel, &mut |_| {}).unwrap_err(),
        "ops.cancelled"
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn empty_files_group_is_verified() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), b"").unwrap();
    std::fs::write(dir.path().join("b.txt"), b"").unwrap();
    let cancel = new_cancellation_token();
    let scan = collect_groups(&request(dir.path()), &cancel, &mut |_| {}, None).unwrap();
    assert_eq!(scan.groups.len(), 1);
    assert!(scan.groups[0].verified);
    assert_eq!(scan.groups[0].members.len(), 2);
}

#[test]
fn capability_false_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("left.bin");
    let right = dir.path().join("right.bin");
    std::fs::write(&left, b"same").unwrap();
    std::fs::write(&right, b"same").unwrap();
    let (group, members) = group_for(&left, &right);
    let cleanup = DuplicateCleanupService::new();
    let selected = vec![members[1].key.clone()];
    let keepers = vec![members[0].key.clone()];
    let prepare = cleanup.prepare(
        "scan",
        1,
        &[group],
        &selected,
        &keepers,
        1_700_000_000,
    );
    assert_eq!(prepare.unwrap_err(), "storage.cleanup_unavailable");
    assert_eq!(
        cleanup
            .execute("11111111-1111-4111-8111-111111111111", 1_700_000_000)
            .unwrap_err(),
        "storage.cleanup_unavailable"
    );
    assert_eq!(cleanup.history_reservations(), 0);
    assert!(left.exists());
    assert!(right.exists());
}

#[test]
fn a_stale_keeper_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("left.bin");
    let right = dir.path().join("right.bin");
    std::fs::write(&left, b"same").unwrap();
    std::fs::write(&right, b"same").unwrap();
    let (group, members) = group_for(&left, &right);
    let plan = build_plan(
        "scan",
        1,
        &[group],
        &[members[1].key.clone()],
        &[members[0].key.clone()],
        1_700_000_000,
    )
    .unwrap();
    std::fs::write(&left, b"changed").unwrap();
    let error = validate_bindings(&plan, 1_700_000_001).unwrap_err();
    assert_eq!(error, "duplicates.changed");
}


