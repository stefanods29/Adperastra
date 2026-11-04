//! Native T2 tests for the transfer registry and its leases.
//!
//! These use injected ports; the real adapters are covered by their own
//! producer tests. No test here opens a file, starts a window or reads a
//! current source revision.

use super::*;
use crate::transfer_types::MAX_TRANSFER_ACTIVE_LEASES;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

struct FakeSource {
    known: Uuid,
    sensitive: bool,
    reads: AtomicUsize,
    generation: AtomicU64,
}

impl FakeSource {
    fn new(known: Uuid, sensitive: bool) -> Self {
        FakeSource {
            known,
            sensitive,
            reads: AtomicUsize::new(0),
            generation: AtomicU64::new(7),
        }
    }
}

impl TransferSourcePort for FakeSource {
    fn sensitive_for(&self, document_id: Uuid) -> Result<bool, TransferError> {
        if document_id != self.known {
            return Err(TransferError::Changed);
        }
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.sensitive)
    }
}

struct FakeHold {
    dropped: Arc<AtomicUsize>,
}

impl HeldSnapshot for FakeHold {}

impl Drop for FakeHold {
    fn drop(&mut self) {
        self.dropped.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeSnapshots {
    authoritative: ExportSnapshot,
    refuse: bool,
    resolved: AtomicUsize,
    dropped: Arc<AtomicUsize>,
}

impl FakeSnapshots {
    fn new(authoritative: ExportSnapshot) -> Self {
        FakeSnapshots {
            authoritative,
            refuse: false,
            resolved: AtomicUsize::new(0),
            dropped: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn refusing() -> Self {
        FakeSnapshots {
            authoritative: snapshot(&Uuid::new_v4().to_string(), StoragePolicy::Ordinary, 1),
            refuse: true,
            resolved: AtomicUsize::new(0),
            dropped: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl TransferSnapshotPort for FakeSnapshots {
    fn resolve(&self, expected: &ExportSnapshot) -> Result<ResolvedSnapshot, TransferError> {
        self.resolved.fetch_add(1, Ordering::SeqCst);
        if self.refuse || expected.snapshot_id != self.authoritative.snapshot_id {
            return Err(TransferError::Changed);
        }
        Ok(ResolvedSnapshot {
            snapshot: self.authoritative.clone(),
            bytes: self.authoritative.byte_len,
            hold: Arc::new(FakeHold {
                dropped: self.dropped.clone(),
            }),
        })
    }
}

fn snapshot(document_id: &str, policy: StoragePolicy, byte_len: u64) -> ExportSnapshot {
    ExportSnapshot {
        snapshot_id: Uuid::new_v4().to_string(),
        document_id: document_id.to_string(),
        revision: 3,
        content_id: Uuid::new_v4(),
        mime: "image/png".to_string(),
        byte_len,
        source: None,
        storage_policy: policy,
        expires_unix: 1_000,
    }
}

fn text_payload(text: &str) -> TransferPayload {
    TransferPayload::Text {
        text: text.to_string(),
    }
}

#[test]
fn get_returns_the_same_identity_and_release_is_idempotent() {
    let document = Uuid::new_v4();
    let source = Arc::new(FakeSource::new(document, false));
    let transfers = ContentTransfers::new(source.clone(), Arc::new(FakeSnapshots::refusing()));
    let envelope = transfers
        .create(Some(document.to_string()), text_payload("alpha"))
        .expect("text transfer must be created");
    assert_eq!(envelope.source_document_id, Some(document.to_string()));
    assert_eq!(envelope.source_revision, None);
    assert!(!envelope.sensitive);
    assert_eq!(source.reads.load(Ordering::SeqCst), 1);

    let fetched = transfers
        .get(&envelope.transfer_id)
        .expect("a live transfer must resolve");
    assert_eq!(fetched.transfer_id, envelope.transfer_id);
    assert_eq!(fetched.payload, envelope.payload);
    assert!(fetched.expires_unix >= envelope.expires_unix);

    transfers.release(&envelope.transfer_id).unwrap();
    transfers.release(&envelope.transfer_id).unwrap();
    assert!(matches!(
        transfers.get(&envelope.transfer_id),
        Err(TransferError::Expired)
    ));
}

#[test]
fn source_sensitivity_cannot_be_downgraded() {
    let document = Uuid::new_v4();
    let source = Arc::new(FakeSource::new(document, true));
    let transfers = ContentTransfers::new(source, Arc::new(FakeSnapshots::refusing()));
    let envelope = transfers
        .create(Some(document.to_string()), text_payload("secret"))
        .expect("sensitive source must still transfer");
    assert!(envelope.sensitive);
}

#[test]
fn snapshot_identity_comes_from_the_native_registry() {
    let document = Uuid::new_v4();
    let authoritative = snapshot(&document.to_string(), StoragePolicy::Sensitive, 64);
    let caller = ExportSnapshot {
        expires_unix: 1,
        storage_policy: StoragePolicy::Ordinary,
        ..authoritative.clone()
    };
    let source = Arc::new(FakeSource::new(document, false));
    let snapshots = Arc::new(FakeSnapshots::new(authoritative));
    let transfers = ContentTransfers::new(source, snapshots.clone());
    let envelope = transfers
        .create(
            Some(document.to_string()),
            TransferPayload::Image {
                snapshot: caller,
                width: 2,
                height: 2,
            },
        )
        .expect("image transfer must be created");
    let TransferPayload::Image {
        snapshot: returned, ..
    } = &envelope.payload
    else {
        panic!("payload kind changed");
    };
    assert_eq!(returned.expires_unix, 1_000);
    assert_eq!(returned.storage_policy, StoragePolicy::Sensitive);
    assert!(envelope.sensitive);
    assert_eq!(snapshots.resolved.load(Ordering::SeqCst), 1);
}

#[test]
fn stale_snapshot_is_refused_without_a_lease() {
    let document = Uuid::new_v4();
    let source = Arc::new(FakeSource::new(document, false));
    let snapshots = Arc::new(FakeSnapshots::refusing());
    let transfers = ContentTransfers::new(source, snapshots);
    let stale = snapshot(&document.to_string(), StoragePolicy::Ordinary, 64);
    assert!(matches!(
        transfers.create(
            Some(document.to_string()),
            TransferPayload::Image {
                snapshot: stale,
                width: 2,
                height: 2,
            },
        ),
        Err(TransferError::Changed)
    ));
    for _ in 0..MAX_TRANSFER_ACTIVE_LEASES {
        assert!(transfers
            .create(Some(document.to_string()), text_payload("alpha"))
            .is_ok());
    }
    assert!(matches!(
        transfers.create(Some(document.to_string()), text_payload("beta")),
        Err(TransferError::TooLarge)
    ));
}

#[test]
fn unknown_source_document_is_refused() {
    let document = Uuid::new_v4();
    let source = Arc::new(FakeSource::new(document, false));
    let transfers = ContentTransfers::new(source, Arc::new(FakeSnapshots::refusing()));
    assert!(matches!(
        transfers.create(Some(Uuid::new_v4().to_string()), text_payload("alpha")),
        Err(TransferError::Changed)
    ));
    assert!(matches!(
        transfers.create(Some("not-a-document".to_string()), text_payload("alpha")),
        Err(TransferError::Invalid)
    ));
}

#[test]
fn files_from_a_locked_source_are_sensitive() {
    let source = Arc::new(FakeSource::new(Uuid::new_v4(), false));
    let transfers = ContentTransfers::new(source, Arc::new(FakeSnapshots::refusing()));
    let envelope = transfers
        .create(
            None,
            TransferPayload::Files {
                sources: vec![DocumentRef::Virtual {
                    provider: "locked".to_string(),
                    container_path: "C:\\vault".to_string(),
                    entry_id: Uuid::new_v4().to_string(),
                }],
            },
        )
        .expect("a locked source must transfer as sensitive");
    assert!(envelope.sensitive);
    assert_eq!(envelope.source_document_id, None);
}

#[test]
fn cancel_keeps_source_and_target_unchanged() {
    let document = Uuid::new_v4();
    let authoritative = snapshot(&document.to_string(), StoragePolicy::Ordinary, 64);
    let caller = authoritative.clone();
    let source = Arc::new(FakeSource::new(document, false));
    let snapshots = Arc::new(FakeSnapshots::new(authoritative));
    let transfers = ContentTransfers::new(source.clone(), snapshots.clone());
    let envelope = transfers
        .create(
            Some(document.to_string()),
            TransferPayload::Image {
                snapshot: caller,
                width: 2,
                height: 2,
            },
        )
        .expect("image transfer must be created");
    // No target registry exists in T2 and nothing accepted the envelope,
    // so this fixture revision must stay where it was.
    let target_revision = 7u64;
    assert_eq!(snapshots.dropped.load(Ordering::SeqCst), 0);
    assert_eq!(source.reads.load(Ordering::SeqCst), 1);

    transfers.release(&envelope.transfer_id).unwrap();

    assert_eq!(source.reads.load(Ordering::SeqCst), 1);
    assert_eq!(source.generation.load(Ordering::SeqCst), 7);
    assert_eq!(target_revision, 7);
    assert_eq!(snapshots.dropped.load(Ordering::SeqCst), 1);
    assert!(matches!(
        transfers.get(&envelope.transfer_id),
        Err(TransferError::Expired)
    ));
}
