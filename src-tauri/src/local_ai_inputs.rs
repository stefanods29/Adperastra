//! Profile-bound AI inputs (T2, E3/U3/U4).
//!
//! A document id never authorizes an arbitrary path. The coordinator wires the
//! 09a document provider through `AiDocumentAccess`; a snapshot is resolved by
//! 08a `ExportSnapshots` and keeps its lease until the job and readers end.
#![allow(dead_code)]


use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use uuid::Uuid;

use ai_runtime::artifacts::{InputLease, InputLeases, InputRecord};
use ai_runtime::types::{AiInputKind, AiInputRef, ProfileId};

const BAD_REQUEST: &str = "ai.bad_request";

/// Bounded reader over the authorized immutable bytes of one input.
pub trait AiSourceReader: Send + Sync {
    fn byte_len(&self) -> u64;
    fn read_range(&self, offset: u64, length: u64) -> Result<Vec<u8>, String>;
}

/// One finalized 08a snapshot, already authorized for this task.
#[derive(Clone)]
pub struct SnapshotAiSource {
    pub content_id: Uuid,
    pub sensitive: bool,
    pub reader: Arc<dyn AiSourceReader>,
    pub retention: Arc<dyn Send + Sync>,
}

/// Coordinator implementation using 08a `ExportSnapshots.resolve`.
pub trait AiSnapshotAccess: Send + Sync {
    fn resolve_for_ai(
        &self,
        snapshot_id: Uuid,
        document_id: &str,
        revision: u64,
    ) -> Result<SnapshotAiSource, String>;
}

/// Immutable original content of one opened document (09a provider).
#[derive(Clone)]
pub struct DocumentAiSource {
    pub document_id: String,
    pub content_id: Uuid,
    pub revision: u64,
    pub sensitive: bool,
    pub reader: Arc<dyn AiSourceReader>,
}

/// Additive native seam implemented by the coordinator with 09a's registry.
/// It returns only the original opened backing at revision 1; unsaved live
/// bytes are never reachable through this trait.
pub trait AiDocumentAccess: Send + Sync {
    fn original_for_ai(&self, document_id: &str) -> Result<DocumentAiSource, String>;
}

struct RegisteredInput {
    record: InputRecord,
    sensitive: bool,
    reader: Arc<dyn AiSourceReader>,
    /// Snapshot/pack/backing retention held for the whole job and its readers.
    _retention: Vec<Arc<dyn Send + Sync>>,
}

/// One bounded read of an already-authorized input for local extraction.
///
/// The bytes belong to the caller; no reader, path or lease escapes this
/// structure, and `truncated` means the source was longer than the budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedInput {
    pub revision: u64,
    pub sensitive: bool,
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

/// Native input registry. The pure crate enforces revision/profile equality;
/// this layer holds the provider retention.
pub struct AiInputRegistry {
    leases: InputLeases,
    entries: Mutex<BTreeMap<Uuid, RegisteredInput>>,
    documents: Mutex<Option<Arc<dyn AiDocumentAccess>>>,
}

impl Default for AiInputRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AiInputRegistry {
    pub fn new() -> Self {
        Self {
            leases: InputLeases::new(),
            entries: Mutex::new(BTreeMap::new()),
            documents: Mutex::new(None),
        }
    }

    pub fn install_document_access(&self, access: Arc<dyn AiDocumentAccess>) -> Result<(), String> {
        *self
            .documents
            .lock()
            .map_err(|_| "ai-document access lock poisoned".to_string())? = Some(access);
        Ok(())
    }

    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<Uuid, RegisteredInput>>, String> {
        self.entries
            .lock()
            .map_err(|_| "ai-inputs lock poisoned".to_string())
    }

    pub fn leases(&self) -> &InputLeases {
        &self.leases
    }

    /// Acquire an opened document's original revision 1.
    pub fn acquire_document(
        &self,
        profile: ProfileId,
        document_id: &str,
    ) -> Result<AiInputRef, String> {
        let access = self
            .documents
            .lock()
            .map_err(|_| "ai-document access lock poisoned".to_string())?
            .clone()
            .ok_or(BAD_REQUEST)?;
        let source = access.original_for_ai(document_id)?;
        if source.document_id != document_id || source.revision != 1 {
            return Err("ai.source_changed".into());
        }
        let id = Uuid::new_v4();
        self.register(
            InputRecord {
                kind: AiInputKind::Document,
                id,
                content_id: source.content_id,
                revision: 1,
                profile,
            },
            source.sensitive,
            source.reader,
            Vec::new(),
        )?;
        Ok(AiInputRef {
            kind: AiInputKind::Document,
            id,
            expected_revision: 1,
        })
    }

    /// Register a finalized 08a snapshot; its lease is held by the entry.
    #[allow(clippy::too_many_arguments)]
    pub fn acquire_snapshot(
        &self,
        profile: ProfileId,
        snapshot_id: Uuid,
        content_id: Uuid,
        revision: u64,
        sensitive: bool,
        reader: Arc<dyn AiSourceReader>,
        retention: Arc<dyn Send + Sync>,
    ) -> Result<AiInputRef, String> {
        if revision < 1 {
            return Err(BAD_REQUEST.into());
        }
        let id = Uuid::new_v4();
        self.register(
            InputRecord {
                kind: AiInputKind::Snapshot,
                id,
                content_id: if content_id.is_nil() {
                    snapshot_id
                } else {
                    content_id
                },
                revision,
                profile,
            },
            sensitive,
            reader,
            vec![retention],
        )?;
        Ok(AiInputRef {
            kind: AiInputKind::Snapshot,
            id,
            expected_revision: revision,
        })
    }

    fn register(
        &self,
        record: InputRecord,
        sensitive: bool,
        reader: Arc<dyn AiSourceReader>,
        retention: Vec<Arc<dyn Send + Sync>>,
    ) -> Result<(), String> {
        self.leases.register(record.clone())?;
        let mut entries = self.lock()?;
        entries.insert(
            record.id,
            RegisteredInput {
                record,
                sensitive,
                reader,
                _retention: retention,
            },
        );
        Ok(())
    }

    pub fn source_len(&self, id: Uuid) -> Result<u64, String> {
        let entries = self.lock()?;
        entries
            .get(&id)
            .map(|entry| entry.reader.byte_len())
            .ok_or_else(|| "ai.expired".to_string())
    }

    /// Read a bounded range from the registered immutable source.
    pub fn read(
        &self,
        id: Uuid,
        expected_revision: u64,
        profile: ProfileId,
        offset: u64,
        length: u64,
    ) -> Result<Vec<u8>, String> {
        let lease = self.resolve(id, expected_revision, profile)?;
        let reader = {
            let entries = self.lock()?;
            entries.get(&id).map(|entry| entry.reader.clone())
        }
        .ok_or("ai.expired")?;
        if reader.byte_len() < offset.saturating_add(length) {
            return Err(BAD_REQUEST.into());
        }
        let bytes = reader.read_range(offset, length)?;
        drop(lease);
        if bytes.len() as u64 != length {
            return Err("ai.source_changed".into());
        }
        Ok(bytes)
    }

    /// Read at most `max_bytes` from one registered input after checking the
    /// exact kind, revision and profile. A longer source is truncated and
    /// reported, never returned whole.
    pub fn read_bounded(
        &self,
        profile: ProfileId,
        input: &AiInputRef,
        max_bytes: usize,
    ) -> Result<BoundedInput, String> {
        if max_bytes == 0 {
            return Err(BAD_REQUEST.into());
        }
        let lease = self.resolve(input.id, input.expected_revision, profile)?;
        if lease.record().kind != input.kind {
            return Err(BAD_REQUEST.into());
        }
        let revision = lease.revision();
        drop(lease);
        let length = self.source_len(input.id)?;
        let take = length.min(max_bytes as u64);
        let bytes = if take == 0 {
            Vec::new()
        } else {
            self.read(input.id, revision, profile, 0, take)?
        };
        Ok(BoundedInput {
            revision,
            sensitive: self.is_sensitive(input.id),
            bytes,
            truncated: length > take,
        })
    }

    pub fn resolve(
        &self,
        id: Uuid,
        expected_revision: u64,
        profile: ProfileId,
    ) -> Result<InputLease, String> {
        self.leases.resolve(id, expected_revision, profile)
    }

    pub fn is_sensitive(&self, id: Uuid) -> bool {
        self.lock()
            .ok()
            .and_then(|entries| entries.get(&id).map(|entry| entry.sensitive))
            .unwrap_or(true)
    }

    pub fn release(&self, id: Uuid) -> Result<(), String> {
        self.leases.release(id)?;
        let mut entries = self.lock()?;
        entries.remove(&id);
        Ok(())
    }

    pub fn release_all_for_profile(&self, profile: ProfileId) -> Result<(), String> {
        self.leases.clear_profile(profile)?;
        let mut entries = self.lock()?;
        entries.retain(|_, entry| entry.record.profile != profile);
        Ok(())
    }

}
