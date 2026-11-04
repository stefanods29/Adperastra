//! Native draft documents (Step 09a E12, reserved for Step 20a).
//!
//! Only a trusted native creator may register a draft; there is no
//! browser command accepting a backing or a `sensitive = false` claim.
//! Drafts use the same document and authority tables as every other
//! document, never a second registry. Step 09a defines the contract but
//! advertises no draft producer before Step 20a.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::document_types::{DocumentError, DocumentInfo, DocumentRef};
use crate::file_grant_backing::GrantedBacking;

/// Most live drafts.
pub const MAX_DRAFTS: usize = 32;

/// What a native draft registration returns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeDocumentRegistration {
    pub document_id: Uuid,
    pub info: DocumentInfo,
    /// Exactly 32 lower-case hex characters.
    pub token: String,
    pub sensitive: bool,
    pub source_generation: u64,
}

#[derive(Debug, Clone)]
struct DraftEntry {
    registration: NativeDocumentRegistration,
    backing: Arc<GrantedBacking>,
}

/// Native-issued draft ids and their documents.
#[derive(Default)]
pub struct DocumentDrafts {
    entries: Mutex<HashMap<Uuid, DraftEntry>>,
    issued: Mutex<HashMap<Uuid, Uuid>>,
}

impl DocumentDrafts {
    /// Mark one draft id as natively issued for one document. Only the
    /// trusted creator calls this, before registering the draft.
    pub fn issue_draft_id(&self, document_id: Uuid, draft_id: Uuid) -> Result<(), DocumentError> {
        let mut issued = self.issued.lock().map_err(|_| DocumentError::Io)?;
        if issued.contains_key(&draft_id) {
            return Err(DocumentError::EditorConflict);
        }
        issued.insert(draft_id, document_id);
        Ok(())
    }

    /// Look up a registered draft. An unregistered draft UUID resolves to
    /// `documents.provider_missing`, never to an empty success.
    pub fn resolve(&self, draft_id: Uuid) -> Result<NativeDocumentRegistration, DocumentError> {
        let entries = self.entries.lock().map_err(|_| DocumentError::Io)?;
        entries
            .values()
            .find(|entry| entry.registration.info.source == (DocumentRef::Draft { draft_id: draft_id.to_string() }))
            .map(|entry| entry.registration.clone())
            .ok_or(DocumentError::ProviderMissing)
    }

    pub fn count(&self) -> usize {
        self.entries.lock().map(|entries| entries.len()).unwrap_or(0)
    }
}

/// Register one natively created draft. Validates the native-issued ids,
/// the registered controller handler, the original backing classification
/// and the name/MIME bounds. The sensitivity of the backing is inherited;
/// it can never be downgraded by the caller.
#[allow(clippy::too_many_arguments)]
pub fn register_document_draft(
    drafts: &DocumentDrafts,
    document_id: Uuid,
    draft_id: Uuid,
    name: &str,
    mime: &str,
    initial_backing: Arc<GrantedBacking>,
    handler_id: &str,
    sensitive: bool,
    token: String,
    has_controller_factory: impl Fn(&str) -> bool,
) -> Result<NativeDocumentRegistration, DocumentError> {
    if name.is_empty() || name.chars().count() > 255 || mime.is_empty() || mime.chars().count() > 128 {
        return Err(DocumentError::Invalid);
    }
    if handler_id.is_empty() || !has_controller_factory(handler_id) {
        return Err(DocumentError::EditorConflict);
    }
    if !crate::document_types::is_document_token(&token) {
        return Err(DocumentError::Invalid);
    }
    {
        let issued = drafts.issued.lock().map_err(|_| DocumentError::Io)?;
        match issued.get(&draft_id) {
            Some(owner) if *owner == document_id => {}
            Some(_) => return Err(DocumentError::EditorConflict),
            None => return Err(DocumentError::ProviderMissing),
        }
    }
    let mut entries = drafts.entries.lock().map_err(|_| DocumentError::Io)?;
    if entries.contains_key(&document_id) {
        return Err(DocumentError::EditorConflict);
    }
    if entries.len() >= MAX_DRAFTS {
        return Err(DocumentError::TooManyOpen);
    }
    // The backing's own classification wins: a sensitive backing can
    // never be registered as an ordinary draft.
    let effective_sensitive = sensitive || initial_backing.is_sensitive();
    let info = DocumentInfo {
        document_id: document_id.to_string(),
        source: DocumentRef::Draft {
            draft_id: draft_id.to_string(),
        },
        name: name.to_string(),
        ext: crate::files::extension_of(name),
        mime: mime.to_string(),
        size: initial_backing.length(),
        modified_unix: 0,
        read_only: false,
        from_internet: false,
        sensitive: effective_sensitive,
        disk_path: None,
    };
    let registration = NativeDocumentRegistration {
        document_id,
        info,
        token,
        sensitive: effective_sensitive,
        source_generation: 0,
    };
    entries.insert(
        document_id,
        DraftEntry {
            registration: registration.clone(),
            backing: initial_backing,
        },
    );
    Ok(registration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;

    fn backing(sensitive: bool) -> Arc<GrantedBacking> {
        Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(b"draft".to_vec())),
            length: 5,
            sensitive,
        })
    }

    fn token() -> String {
        Uuid::new_v4().simple().to_string()
    }

    #[test]
    fn forged_draft_ref_refused() {
        let drafts = DocumentDrafts::default();
        let result = register_document_draft(
            &drafts,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "note.txt",
            "text/plain",
            backing(false),
            "text",
            false,
            token(),
            |_| true,
        );
        assert_eq!(result.unwrap_err(), DocumentError::ProviderMissing);
    }

    #[test]
    fn one_native_registration_per_document() {
        let drafts = DocumentDrafts::default();
        let document_id = Uuid::new_v4();
        let draft_id = Uuid::new_v4();
        drafts.issue_draft_id(document_id, draft_id).unwrap();
        let first = register_document_draft(
            &drafts, document_id, draft_id, "note.txt", "text/plain",
            backing(false), "text", false, token(), |_| true,
        );
        assert!(first.is_ok());
        let second = register_document_draft(
            &drafts, document_id, draft_id, "note.txt", "text/plain",
            backing(false), "text", false, token(), |_| true,
        );
        assert_eq!(second.unwrap_err(), DocumentError::EditorConflict);
    }

    #[test]
    fn source_sensitivity_not_downgraded() {
        let drafts = DocumentDrafts::default();
        let document_id = Uuid::new_v4();
        let draft_id = Uuid::new_v4();
        drafts.issue_draft_id(document_id, draft_id).unwrap();
        let registration = register_document_draft(
            &drafts, document_id, draft_id, "note.txt", "text/plain",
            backing(true), "text", false, token(), |_| true,
        )
        .unwrap();
        assert!(registration.sensitive);
        assert!(registration.info.sensitive);
        assert!(registration.info.disk_path.is_none());
    }

    #[test]
    fn unregistered_draft_resolves_provider_missing() {
        let drafts = DocumentDrafts::default();
        assert_eq!(
            drafts.resolve(Uuid::new_v4()).unwrap_err(),
            DocumentError::ProviderMissing
        );
    }
}
