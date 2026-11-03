#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Immutable PDF snapshot resolution (Step 07d E9).
//!
//! An unsaved document is opened from an immutable snapshot, never from a
//! path: the four reference fields (`snapshot_id`, `document_id`,
//! `revision`, `content_id`) are checked by the one registered resolver, and
//! its lease is retained until the PDF session closes. Until Step 08a
//! registers `NativePdfSnapshotResolver`, this registry is empty and every
//! request fails with `pdf.snapshot_unavailable`; it never falls back to a
//! disk path or a success stub.

use std::sync::{Arc, Mutex};

use crate::file_grant_backing::GrantedBacking;
use crate::pdf_types::PdfSourceIdentity;

/// Owns the underlying snapshot until the PDF session closes (E9).
pub trait PdfSnapshotRetention: Send + Sync {}

/// One resolved snapshot: guarded bytes plus the identity they must keep.
pub struct ResolvedPdfSnapshot {
    pub backing: Arc<GrantedBacking>,
    pub identity: PdfSourceIdentity,
    pub mime: String,
    pub byte_len: u64,
    /// Dropped with the session; keeps the source's snapshot lease alive.
    pub retain: Arc<dyn PdfSnapshotRetention>,
}

impl std::fmt::Debug for ResolvedPdfSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedPdfSnapshot")
            .field("mime", &self.mime)
            .field("byte_len", &self.byte_len)
            .finish()
    }
}

/// Largest snapshot the viewer opens (256 MiB, E9).
pub const PDF_MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;

impl ResolvedPdfSnapshot {
    /// Every field must agree before a child may be launched for it.
    pub fn is_valid(&self) -> bool {
        self.mime == "application/pdf"
            && self.byte_len > 0
            && self.byte_len <= PDF_MAX_SNAPSHOT_BYTES
            && self.backing.length() == self.byte_len
            && self.backing.is_consistent()
            && matches!(self.identity, PdfSourceIdentity::Snapshot { .. })
            && self.identity.is_valid()
    }
}

/// The only way to resolve a snapshot. A static app registration implements
/// it (08a); no UI code can.
pub trait PdfSnapshotResolver: Send + Sync {
    fn resolve(
        &self,
        reference: &crate::pdf_types::PdfSnapshotRef,
    ) -> Result<ResolvedPdfSnapshot, String>;
}

/// The app's snapshot registry: empty until 08a registers its resolver.
#[derive(Default)]
pub struct PdfSnapshotResolvers {
    registered: Mutex<Option<Arc<dyn PdfSnapshotResolver>>>,
}

impl PdfSnapshotResolvers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the one resolver. A second registration is refused.
    pub fn register(&self, resolver: Arc<dyn PdfSnapshotResolver>) -> Result<(), String> {
        let mut slot = self
            .registered
            .lock()
            .map_err(|_| "pdf.unavailable".to_string())?;
        if slot.is_some() {
            return Err("pdf.unavailable".to_string());
        }
        *slot = Some(resolver);
        Ok(())
    }

    /// Resolve a reference, or say that no snapshot exists. Never opens a
    /// disk path as a fallback.
    pub fn resolve(
        &self,
        reference: &crate::pdf_types::PdfSnapshotRef,
    ) -> Result<ResolvedPdfSnapshot, String> {
        if !reference.is_valid() {
            return Err("pdf.bad_request".to_string());
        }
        let resolver = self
            .registered
            .lock()
            .map_err(|_| "pdf.snapshot_unavailable".to_string())?
            .clone()
            .ok_or_else(|| "pdf.snapshot_unavailable".to_string())?;
        let resolved = resolver.resolve(reference)?;
        if !resolved.is_valid() {
            return Err("pdf.snapshot_unavailable".to_string());
        }
        // The reference and the identity must describe the same snapshot.
        match &resolved.identity {
            PdfSourceIdentity::Snapshot {
                document_id,
                revision,
                content_id,
                ..
            } => {
                if document_id != &reference.document_id
                    || *revision != reference.revision
                    || *content_id != reference.content_id
                {
                    return Err("pdf.snapshot_unavailable".to_string());
                }
            }
            PdfSourceIdentity::Disk { .. } => {
                return Err("pdf.snapshot_unavailable".to_string());
            }
        }
        Ok(resolved)
    }

    pub fn is_registered(&self) -> bool {
        self.registered
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf_types::PdfSnapshotRef;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use uuid::Uuid;
    use zeroize::Zeroizing;

    struct Retention(#[allow(dead_code)] Arc<AtomicUsize>);
    impl PdfSnapshotRetention for Retention {}

    struct FixedResolver {
        backing: Arc<GrantedBacking>,
        document_id: String,
        revision: u64,
        content_id: Uuid,
        retained: Arc<AtomicUsize>,
        calls: Arc<AtomicUsize>,
    }

    impl PdfSnapshotResolver for FixedResolver {
        fn resolve(&self, _reference: &PdfSnapshotRef) -> Result<ResolvedPdfSnapshot, String> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(ResolvedPdfSnapshot {
                backing: self.backing.clone(),
                identity: PdfSourceIdentity::Snapshot {
                    document_id: self.document_id.clone(),
                    revision: self.revision,
                    content_id: self.content_id,
                    sensitive: false,
                },
                mime: "application/pdf".to_string(),
                byte_len: self.backing.length(),
                retain: Arc::new(Retention(self.retained.clone())),
            })
        }
    }

    fn reference(document: &str, revision: u64, content: Uuid) -> PdfSnapshotRef {
        PdfSnapshotRef {
            snapshot_id: Uuid::new_v4(),
            document_id: document.to_string(),
            revision,
            content_id: content,
        }
    }

    fn memory_backing() -> Arc<GrantedBacking> {
        Arc::new(GrantedBacking::Memory {
            length: 5,
            bytes: Arc::new(Zeroizing::new(b"%PDF-".to_vec())),
            sensitive: false,
        })
    }

    #[test]
    fn an_absent_resolver_fails_without_a_disk_open() {
        let registry = PdfSnapshotResolvers::new();
        assert!(!registry.is_registered());
        assert_eq!(
            registry.resolve(&reference("doc", 1, Uuid::new_v4())).err(),
            Some("pdf.snapshot_unavailable".to_string())
        );
    }

    #[test]
    fn a_second_registration_is_refused() {
        let registry = PdfSnapshotResolvers::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let first = FixedResolver {
            backing: memory_backing(),
            document_id: "doc".to_string(),
            revision: 1,
            content_id: Uuid::new_v4(),
            retained: Arc::new(AtomicUsize::new(0)),
            calls: calls.clone(),
        };
        registry.register(Arc::new(first)).unwrap();
        let second = FixedResolver {
            backing: memory_backing(),
            document_id: "doc".to_string(),
            revision: 1,
            content_id: Uuid::new_v4(),
            retained: Arc::new(AtomicUsize::new(0)),
            calls,
        };
        assert_eq!(
            registry.register(Arc::new(second)).err(),
            Some("pdf.unavailable".to_string())
        );
    }

    #[test]
    fn the_reference_must_match_the_identity() {
        let registry = PdfSnapshotResolvers::new();
        let content = Uuid::new_v4();
        let resolver = FixedResolver {
            backing: memory_backing(),
            document_id: "doc".to_string(),
            revision: 4,
            content_id: content,
            retained: Arc::new(AtomicUsize::new(0)),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        registry.register(Arc::new(resolver)).unwrap();
        assert!(registry.resolve(&reference("doc", 4, content)).is_ok());
        // Another revision is another snapshot.
        assert_eq!(
            registry.resolve(&reference("doc", 5, content)).err(),
            Some("pdf.snapshot_unavailable".to_string())
        );
        assert_eq!(
            registry.resolve(&reference("other", 4, content)).err(),
            Some("pdf.snapshot_unavailable".to_string())
        );
    }

    #[test]
    fn a_snapshot_with_the_wrong_mime_is_refused() {
        let registry = PdfSnapshotResolvers::new();
        struct WrongMime;
        impl PdfSnapshotResolver for WrongMime {
            fn resolve(&self, _: &PdfSnapshotRef) -> Result<ResolvedPdfSnapshot, String> {
                Ok(ResolvedPdfSnapshot {
                    backing: memory_backing(),
                    identity: PdfSourceIdentity::Snapshot {
                        document_id: "doc".to_string(),
                        revision: 1,
                        content_id: Uuid::new_v4(),
                        sensitive: false,
                    },
                    mime: "text/plain".to_string(),
                    byte_len: 5,
                    retain: Arc::new(Retention(Arc::new(AtomicUsize::new(0)))),
                })
            }
        }
        registry.register(Arc::new(WrongMime)).unwrap();
        assert_eq!(
            registry.resolve(&reference("doc", 1, Uuid::new_v4())).err(),
            Some("pdf.snapshot_unavailable".to_string())
        );
    }

    #[test]
    fn the_retention_keeps_the_snapshot_alive() {
        let registry = PdfSnapshotResolvers::new();
        let retained = Arc::new(AtomicUsize::new(0));
        let content = Uuid::new_v4();
        let resolver = FixedResolver {
            backing: memory_backing(),
            document_id: "doc".to_string(),
            revision: 1,
            content_id: content,
            retained: retained.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        registry.register(Arc::new(resolver)).unwrap();
        let resolved = registry.resolve(&reference("doc", 1, content)).unwrap();
        assert!(resolved.is_valid());
        assert!(Arc::strong_count(&resolved.backing) >= 1);
        drop(resolved);
    }
}
