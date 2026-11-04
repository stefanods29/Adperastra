//! Read-back verification, rate estimates and byte accounting (step 09f T3).

use std::io::Write;

use fs_service::owned_io::{OwnedIoResult, OwnedOutput, PinnedDirectory};
use fs_service::transfer_rates::{CounterError, RateSampler, TransferCounters};
use fs_service::transfer_verify::{
    empty_hash, verify_before_publish, CopyHash, ReadBack, VerifiedHash, VerifyError,
    EMPTY_BLAKE3_HEX,
};
use fs_service::CancellationToken;

/// A staging file whose read-back returns the wrong digest while the length
/// is right: the exact shape of a disk that wrote other bytes.
struct Corrupting {
    output: OwnedOutput,
}

impl ReadBack for Corrupting {
    fn read_back_digest(&mut self, _token: &CancellationToken) -> OwnedIoResult<[u8; 32]> {
        Ok(*VerifiedHash::of(b"not what was copied").as_bytes())
    }

    fn staged_len(&mut self) -> u64 {
        self.output
            .file_mut()
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    }
}

#[test]
fn corrupted_readback_publishes_nothing_and_keeps_the_source() {
    let source_dir = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let source = source_dir.path().join("a.txt");
    std::fs::write(&source, b"the original bytes").unwrap();
    let directory = PinnedDirectory::open(destination.path()).unwrap();
    let mut output = OwnedOutput::create(&directory, "a.txt").unwrap();
    output.file_mut().write_all(b"the original bytes").unwrap();
    output.flush_sync().unwrap();
    let mut adapter = Corrupting { output };
    let token = fs_service::new_cancellation_token();
    let copy_hash = {
        let mut hash = CopyHash::new();
        hash.update(b"the original bytes");
        hash.finish().0
    };
    let result = verify_before_publish(&mut adapter, copy_hash, 18, &token);
    assert_eq!(result, Err(VerifyError::Mismatch));
    assert_eq!(VerifyError::Mismatch.code(), "ops.verify_failed");
    drop(adapter);
    // Nothing was published, and the source still holds its original bytes.
    assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 0);
    assert_eq!(std::fs::read(&source).unwrap(), b"the original bytes");
}

#[test]
fn an_empty_file_hash_is_known() {
    let (hash, bytes) = CopyHash::new().finish();
    assert_eq!(bytes, 0);
    assert_eq!(hash.to_hex(), EMPTY_BLAKE3_HEX);
    assert_eq!(hash, empty_hash());
}

#[test]
fn paused_time_is_excluded_from_the_estimate() {
    let mut sampler = RateSampler::new();
    for _ in 0..8 {
        sampler.record(262_144, 250_000_000);
    }
    let rate = sampler.bytes_per_second().unwrap();
    let eta = sampler.eta_seconds(2_000_000).unwrap();
    sampler.record_idle(600_000_000_000);
    assert_eq!(sampler.bytes_per_second().unwrap(), rate);
    assert_eq!(sampler.eta_seconds(2_000_000).unwrap(), eta);
    assert!(sampler.idle_nanos() > 0);
}

#[test]
fn a_zero_rate_has_no_estimate() {
    let mut sampler = RateSampler::new();
    sampler.record(0, 1_000_000_000);
    assert_eq!(sampler.bytes_per_second(), None);
    assert_eq!(sampler.eta_seconds(1_000), None);
    // No estimate before a whole second either.
    let mut fresh = RateSampler::new();
    fresh.record(1_000, 500_000_000);
    assert_eq!(fresh.eta_seconds(1_000), None);
}

#[test]
fn overflowing_counts_are_refused() {
    let mut counters = TransferCounters::new(u64::MAX, u64::MAX);
    assert_eq!(counters.add_bytes(u64::MAX), Ok(()));
    assert_eq!(counters.add_bytes(1), Err(CounterError::Overflow));
    let mut small = TransferCounters::new(1, 10);
    assert_eq!(small.add_bytes(11), Err(CounterError::BeyondTotal));
    assert_eq!(small.add_bytes(10), Ok(()));
    assert!(!small.is_complete(), "no item has finished yet");
}
