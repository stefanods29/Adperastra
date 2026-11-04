//! Warm Office document leases (Step 13 T3).
//!
//! The pool keeps at most four read-only documents. A viewer holds one lease;
//! a render holds a temporary lease for its duration. A document whose lease
//! count reaches zero is still present until the actor confirms its close, so
//! no viewer ever sees a half-closed document.
//!
//! No user path, source stamp or engine handle is serialized here.
#![allow(dead_code)]


use std::collections::{HashMap, VecDeque};

use uuid::Uuid;

use crate::engine_session_types::EngineReadDocument;

/// The fixed pool size from 12b E7/13 D4.
pub const OFFICE_POOL_MAX_DOCUMENTS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    Admitted,
    /// Remove this unleased document first, then retry.
    NeedsEviction(Uuid),
    /// All four documents are retained by live viewers/renders.
    Busy,
}

#[derive(Debug)]
struct LeasedDocument {
    document: EngineReadDocument,
    leases: u32,
    last_used: u64,
}

/// The pool's bounded document table. It never starts an engine call.
#[derive(Debug)]
pub struct OfficeLeaseTable {
    max_documents: usize,
    documents: HashMap<Uuid, LeasedDocument>,
    order: VecDeque<Uuid>,
}

impl Default for OfficeLeaseTable {
    fn default() -> Self {
        Self::new(OFFICE_POOL_MAX_DOCUMENTS)
    }
}

impl OfficeLeaseTable {
    pub fn new(max_documents: usize) -> Self {
        Self {
            max_documents: max_documents.clamp(1, OFFICE_POOL_MAX_DOCUMENTS),
            documents: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.documents.len()
    }

    pub fn is_empty(&self) -> bool {
        self.documents.is_empty()
    }

    pub fn get(&self, document_id: Uuid) -> Option<&EngineReadDocument> {
        self.documents.get(&document_id).map(|entry| &entry.document)
    }

    pub fn leases(&self, document_id: Uuid) -> Option<u32> {
        self.documents.get(&document_id).map(|entry| entry.leases)
    }

    /// Ask whether one more document can be opened. The caller closes the
    /// returned unleased oldest document before calling `insert`.
    pub fn admission(&self) -> Admission {
        if self.documents.len() < self.max_documents {
            return Admission::Admitted;
        }
        match self.oldest_unleased() {
            Some(id) => Admission::NeedsEviction(id),
            None => Admission::Busy,
        }
    }

    pub fn insert(&mut self, document: EngineReadDocument, now: u64) -> Result<(), String> {
        if self.documents.len() >= self.max_documents {
            return Err("engines.busy".to_string());
        }
        let id = document.document_id;
        if self.documents.contains_key(&id) {
            return Err("office.bad_request".to_string());
        }
        self.order.push_back(id);
        self.documents.insert(
            id,
            LeasedDocument {
                document,
                leases: 1,
                last_used: now,
            },
        );
        Ok(())
    }

    pub fn retain(&mut self, document_id: Uuid, now: u64) -> Result<(), String> {
        let entry = self
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| "office.not_found".to_string())?;
        entry.leases = entry
            .leases
            .checked_add(1)
            .ok_or_else(|| "office.too_large".to_string())?;
        entry.last_used = now;
        self.touch_order(document_id);
        Ok(())
    }

    /// Returns true when the viewer lease dropped to zero. The document still
    /// remains until the actor close succeeds and `remove` is called.
    pub fn release(&mut self, document_id: Uuid, now: u64) -> Result<bool, String> {
        let entry = self
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| "office.not_found".to_string())?;
        entry.leases = entry.leases.saturating_sub(1);
        entry.last_used = now;
        Ok(entry.leases == 0)
    }

    pub fn remove(&mut self, document_id: Uuid) -> Option<EngineReadDocument> {
        self.order.retain(|id| *id != document_id);
        self.documents.remove(&document_id).map(|entry| entry.document)
    }

    pub fn oldest_unleased(&self) -> Option<Uuid> {
        self.order.iter().copied().find(|id| {
            self.documents
                .get(id)
                .map(|entry| entry.leases == 0)
                .unwrap_or(false)
        })
    }

    pub fn any_unleased(&self) -> bool {
        self.oldest_unleased().is_some()
    }

    pub fn ids(&self) -> Vec<Uuid> {
        self.order.iter().copied().collect()
    }

    /// Document identity that a derived PDF snapshot must use. The source
    /// revision/content ID come from 12b's read document, never from file
    /// modification time.
    pub fn source_identity(&self, document_id: Uuid) -> Option<(u64, Option<Uuid>)> {
        self.documents
            .get(&document_id)
            .map(|entry| (entry.document.source_revision, entry.document.source_content_id))
    }

    fn touch_order(&mut self, document_id: Uuid) {
        self.order.retain(|id| *id != document_id);
        self.order.push_back(document_id);
    }
}

/// The stable IDs the bridge owns. Kept in one place so a section DTO never
/// invents a localized label or a random source identity.
pub fn section_id(kind: &str, index: u32) -> Result<String, String> {
    let prefix = match kind {
        "document" => "document:",
        "sheet" => "sheet:",
        "slide" => "slide:",
        _ => return Err("office.bad_request".to_string()),
    };
    let id = format!("{prefix}{index}");
    if id.len() <= 64 {
        Ok(id)
    } else {
        Err("office.too_large".to_string())
    }
}

/// A PDF artifact's snapshot identity: the source revision/content ID are
/// retained exactly; an unedited disk source gets one immutable UUID at
/// open, never its modification time or a fake PDF stamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DerivedPdfIdentity {
    pub source_revision: u64,
    pub source_content_id: Uuid,
}

impl DerivedPdfIdentity {
    pub fn from_read_document(document: &EngineReadDocument, fallback_content_id: Uuid) -> Self {
        Self {
            source_revision: document.source_revision,
            source_content_id: document.source_content_id.unwrap_or(fallback_content_id),
        }
    }
}
