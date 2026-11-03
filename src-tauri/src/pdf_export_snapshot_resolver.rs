//! The concrete PDF snapshot resolver (Step 08a T2, 07d E9).
//!
//! 07d owns the resolver boundary and the PDF session; this module binds an
//! immutable 08a snapshot to it. It never reloads the saved file, never
//! invents a SourceStamp and never copies memory to a temporary disk file.

use std::sync::Arc;

use uuid::Uuid;

use crate::export_snapshot_types::StoragePolicy;
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::pdf_snapshot_resolver::{
    PdfSnapshotResolver, PdfSnapshotRetention, ResolvedPdfSnapshot,
};
use crate::pdf_types::{PdfSnapshotRef, PdfSourceIdentity};

pub struct NativePdfSnapshotResolver {
    snapshots: Arc<ExportSnapshots>,
}

impl NativePdfSnapshotResolver {
    /// The coordinator installs exactly one of these after the managed
    /// registries exist.
    pub fn new(snapshots: Arc<ExportSnapshots>) -> Self {
        Self { snapshots }
    }
}

impl PdfSnapshotResolver for NativePdfSnapshotResolver {
    fn resolve(&self, reference: &PdfSnapshotRef) -> Result<ResolvedPdfSnapshot, String> {
        let snapshot_id = reference.snapshot_id.to_string();
        let document_id = reference.document_id.to_string();
        let content_id = reference.content_id.to_string();
        let lease = self.snapshots.resolve_exact(
            &snapshot_id,
            &document_id,
            reference.revision,
            &content_id,
        )?;
        if lease.snapshot.mime != "application/pdf" {
            return Err("pdf.snapshot_unavailable".to_string());
        }
        if lease.snapshot.byte_len > crate::export_snapshot_types::MAX_SNAPSHOT_BYTES {
            return Err("pdf.snapshot_unavailable".to_string());
        }
        let content =
            Uuid::parse_str(&content_id).map_err(|_| "pdf.snapshot_unavailable".to_string())?;
        let sensitive = lease.snapshot.storage_policy == StoragePolicy::Sensitive;
        let identity = PdfSourceIdentity::Snapshot {
            document_id: document_id.clone(),
            revision: reference.revision,
            content_id: content,
            sensitive,
        };
        Ok(ResolvedPdfSnapshot {
            backing: lease.backing.clone(),
            identity,
            mime: "application/pdf".to_string(),
            byte_len: lease.snapshot.byte_len,
            retain: Arc::new(PdfLeaseRetention { _lease: lease }),
        })
    }
}

/// Owns the 08a lease for exactly as long as the PDF session owns the
/// resolved snapshot.
struct PdfLeaseRetention {
    _lease: SnapshotLease,
}

impl PdfSnapshotRetention for PdfLeaseRetention {}
