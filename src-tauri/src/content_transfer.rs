//! Content-transfer registry and commands (Step 09c T2, E1).
//!
//! The renderer sends a typed payload; this module validates it again,
//! authorizes the source document, resolves the 08a snapshot identity,
//! derives sensitivity natively and keeps the snapshot lease alive until
//! the transfer is released. Nothing reads the current source file: the
//! payload is the revision captured by the editor.

use std::sync::Arc;

use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::document_types::DocumentRef;
use crate::documents::DocumentStore;
use crate::export_snapshot_types::{now_unix, ExportSnapshot, StoragePolicy};
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::transfer_leases::{HeldSnapshot, TransferLeases};
use crate::transfer_types::*;
use crate::transfer_validation::validate_transfer_envelope;

/// The authoritative facts about one open source document. 09a's
/// `DocumentStore` is the real implementation; an absent document means
/// the capture is stale.
pub trait TransferSourcePort: Send + Sync {
    fn sensitive_for(&self, document_id: Uuid) -> Result<bool, TransferError>;
}

impl TransferSourcePort for DocumentStore {
    fn sensitive_for(&self, document_id: Uuid) -> Result<bool, TransferError> {
        self.entry(document_id)
            .map(|entry| entry.info.sensitive)
            .map_err(|_| TransferError::Changed)
    }
}

/// One snapshot resolved natively. The hold keeps its bytes alive.
pub struct ResolvedSnapshot {
    pub snapshot: ExportSnapshot,
    pub bytes: u64,
    pub hold: Arc<dyn HeldSnapshot>,
}

pub trait TransferSnapshotPort: Send + Sync {
    fn resolve(&self, expected: &ExportSnapshot) -> Result<ResolvedSnapshot, TransferError>;
}

struct SnapshotLeaseHold {
    #[allow(dead_code)]
    _lease: SnapshotLease,
}

impl HeldSnapshot for SnapshotLeaseHold {}

impl TransferSnapshotPort for ExportSnapshots {
    fn resolve(&self, expected: &ExportSnapshot) -> Result<ResolvedSnapshot, TransferError> {
        let lease = self
            .resolve_exact(
                &expected.snapshot_id,
                &expected.document_id,
                expected.revision,
                &expected.content_id.to_string(),
            )
            .map_err(|_| TransferError::Changed)?;
        let authoritative = lease.snapshot.clone();
        // The registry, never the payload, decides the MIME and length.
        if authoritative.snapshot_id != expected.snapshot_id
            || authoritative.content_id != expected.content_id
            || !authoritative.mime.eq_ignore_ascii_case(&expected.mime)
            || authoritative.byte_len != expected.byte_len
        {
            return Err(TransferError::Changed);
        }
        Ok(ResolvedSnapshot {
            bytes: authoritative.byte_len,
            snapshot: authoritative,
            hold: Arc::new(SnapshotLeaseHold { _lease: lease }),
        })
    }
}

fn files_are_sensitive(payload: &TransferPayload) -> bool {
    match payload {
        TransferPayload::Files { sources } => sources
            .iter()
            .any(|source| !matches!(source, DocumentRef::Disk { .. })),
        _ => false,
    }
}

fn payload_bytes(payload: &TransferPayload) -> Result<u64, TransferError> {
    Ok(serde_json::to_vec(payload)
        .map_err(|_| TransferError::Invalid)?
        .len() as u64)
}

/// The managed transfer registry. One instance per main window session.
pub struct ContentTransfers {
    leases: TransferLeases,
    sources: Arc<dyn TransferSourcePort>,
    snapshots: Arc<dyn TransferSnapshotPort>,
}

impl ContentTransfers {
    pub fn new(
        sources: Arc<dyn TransferSourcePort>,
        snapshots: Arc<dyn TransferSnapshotPort>,
    ) -> Self {
        ContentTransfers {
            leases: TransferLeases::new(),
            sources,
            snapshots,
        }
    }

    /// Capture one bounded payload. Identity, expiry and sensitivity are
    /// decided here; the caller supplies only the source id and values.
    pub fn create(
        &self,
        source_document_id: Option<String>,
        payload: TransferPayload,
    ) -> Result<TransferEnvelope, TransferError> {
        let source_document = match source_document_id {
            Some(document_id) => {
                let parsed = Uuid::parse_str(&document_id).map_err(|_| TransferError::Invalid)?;
                Some((parsed.to_string(), parsed))
            }
            None => None,
        };
        let source_revision = match &payload {
            TransferPayload::Image { snapshot, .. } | TransferPayload::PdfPages { snapshot, .. } => {
                Some(snapshot.revision)
            }
            _ => None,
        };
        let envelope = TransferEnvelope {
            transfer_id: Uuid::new_v4().to_string(),
            source_document_id: source_document
                .as_ref()
                .map(|(document_id, _)| document_id.clone()),
            source_revision,
            sensitive: false,
            payload,
            expires_unix: now_unix().saturating_add(TRANSFER_LEASE_TTL_SECS),
            source_tab_id: None,
        };
        let mut native_sensitive = match &source_document {
            Some((_, document_id)) => self.sources.sensitive_for(*document_id)?,
            None => false,
        };
        if files_are_sensitive(&envelope.payload) {
            native_sensitive = true;
        }
        let mut envelope = validate_transfer_envelope(envelope, native_sensitive)?;
        let (hold, bytes, policy_sensitive) = match &mut envelope.payload {
            TransferPayload::Image { snapshot, .. } | TransferPayload::PdfPages { snapshot, .. } => {
                let resolved = self.snapshots.resolve(snapshot)?;
                let policy_sensitive =
                    resolved.snapshot.storage_policy == StoragePolicy::Sensitive;
                *snapshot = resolved.snapshot;
                (Some(resolved.hold), resolved.bytes, policy_sensitive)
            }
            other => (None, payload_bytes(other)?, false),
        };
        envelope.sensitive |= policy_sensitive;
        self.leases.insert(envelope.clone(), bytes, hold)?;
        Ok(envelope)
    }

    /// Resolve one live token and extend its idle TTL. The returned
    /// expiry is the authoritative one the renderer must show.
    pub fn get(&self, transfer_id: &str) -> Result<TransferEnvelope, TransferError> {
        let leased = self.leases.get(transfer_id)?;
        let mut envelope = leased.envelope;
        let mut seconds = leased.remaining.as_secs();
        if leased.remaining.subsec_nanos() > 0 {
            seconds = seconds.saturating_add(1);
        }
        envelope.expires_unix = now_unix().saturating_add(seconds.max(1));
        Ok(envelope)
    }

    /// End one transfer. Idempotent for a well-formed token.
    pub fn release(&self, transfer_id: &str) -> Result<(), TransferError> {
        self.leases.release(transfer_id)
    }
}

#[tauri::command]
pub fn transfer_create(
    window: WebviewWindow,
    transfers: State<'_, Arc<ContentTransfers>>,
    source_document_id: Option<String>,
    payload: TransferPayload,
) -> Result<TransferEnvelope, String> {
    crate::ensure_main(window.label())?;
    transfers
        .create(source_document_id, payload)
        .map_err(String::from)
}

#[tauri::command]
pub fn transfer_get(
    window: WebviewWindow,
    transfers: State<'_, Arc<ContentTransfers>>,
    transfer_id: String,
) -> Result<TransferEnvelope, String> {
    crate::ensure_main(window.label())?;
    if transfer_id.chars().count() > 64 {
        return Err(TransferError::Invalid.code().to_string());
    }
    transfers.get(&transfer_id).map_err(String::from)
}

#[tauri::command]
pub fn transfer_release(
    window: WebviewWindow,
    transfers: State<'_, Arc<ContentTransfers>>,
    transfer_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if transfer_id.chars().count() > 64 {
        return Err(TransferError::Invalid.code().to_string());
    }
    transfers.release(&transfer_id).map_err(String::from)
}

#[cfg(test)]
#[path = "content_transfer_step09c_tests.rs"]
mod content_transfer_step09c_tests;
