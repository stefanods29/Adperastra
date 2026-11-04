//! Native document wire types (Step 09a, tabs-documents-1).
//!
//! The mirror of `src/documents/types.ts`. Errors are stable codes; Rust
//! never returns display text.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

/// Why a document operation failed. The UI translates `code()` under
/// `errors.documents.<reason>`, with `errors.documents.other` as fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentError {
    Invalid,
    ProviderMissing,
    EditorConflict,
    ReadOnly,
    Changed,
    TooLarge,
    TooManyOpen,
    SensitiveCopyRequired,
    RebindFailed,
    Io,
}

impl DocumentError {
    pub fn code(&self) -> &'static str {
        match self {
            DocumentError::Invalid => "documents.invalid",
            DocumentError::ProviderMissing => "documents.provider_missing",
            DocumentError::EditorConflict => "documents.editor_conflict",
            DocumentError::ReadOnly => "documents.read_only",
            DocumentError::Changed => "documents.changed",
            DocumentError::TooLarge => "documents.too_large",
            DocumentError::TooManyOpen => "documents.too_many_open",
            DocumentError::SensitiveCopyRequired => "documents.sensitive_copy_required",
            DocumentError::RebindFailed => "documents.rebind_failed",
            DocumentError::Io => "documents.io",
        }
    }
}

impl From<DocumentError> for String {
    fn from(error: DocumentError) -> String {
        error.code().to_string()
    }
}

/// Where a document's bytes come from. Disk paths are absolute; virtual
/// references carry only an opaque entry id (no plain inner file name,
/// content or key); draft ids are issued natively and reserved until
/// Step 20a registers a creator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DocumentRef {
    Disk { path: String },
    Virtual {
        provider: String,
        container_path: String,
        entry_id: String,
    },
    Draft { draft_id: String },
}

impl DocumentRef {
    /// Validate one reference from the UI. Unknown virtual providers are
    /// refused: only `locked` exists, and only once Step 09k registers it.
    pub fn validate(&self) -> Result<(), DocumentError> {
        match self {
            DocumentRef::Disk { path } => {
                validate_absolute_path(path).map_err(|_| DocumentError::Invalid)
            }
            DocumentRef::Virtual {
                provider,
                container_path,
                entry_id,
            } => {
                if provider != "locked" {
                    return Err(DocumentError::ProviderMissing);
                }
                validate_absolute_path(container_path).map_err(|_| DocumentError::Invalid)?;
                uuid::Uuid::try_parse(entry_id).map_err(|_| DocumentError::Invalid)?;
                Ok(())
            }
            DocumentRef::Draft { draft_id } => {
                uuid::Uuid::try_parse(draft_id).map_err(|_| DocumentError::Invalid)?;
                Ok(())
            }
        }
    }

    /// The provider that must serve this source.
    pub fn provider_id(&self) -> &'static str {
        match self {
            DocumentRef::Disk { .. } => "disk",
            DocumentRef::Virtual { .. } => "locked",
            DocumentRef::Draft { .. } => "draft",
        }
    }
}

fn validate_absolute_path(path: &str) -> Result<(), ()> {
    crate::validate_absolute_path(path).map_err(|_| ())
}

/// Facts about an opened document. `disk_path` is present only for disk
/// sources; virtual and draft sources never fabricate an OS path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub document_id: String,
    pub source: DocumentRef,
    pub name: String,
    pub ext: String,
    pub mime: String,
    pub size: u64,
    pub modified_unix: u64,
    pub read_only: bool,
    pub from_internet: bool,
    pub sensitive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_path: Option<String>,
}

impl DocumentInfo {
    pub fn validate(&self) -> Result<(), DocumentError> {
        if uuid::Uuid::try_parse(&self.document_id).is_err()
            || self.name.is_empty()
            || self.name.chars().count() > 255
            || self.ext.chars().count() > 32
            || self.mime.is_empty()
            || self.mime.chars().count() > 128
        {
            return Err(DocumentError::Invalid);
        }
        self.source.validate()?;
        match (&self.source, &self.disk_path) {
            (DocumentRef::Disk { path }, Some(disk_path)) if path == disk_path => Ok(()),
            (DocumentRef::Disk { .. }, None) => Ok(()),
            (DocumentRef::Disk { .. }, Some(_)) => Err(DocumentError::Invalid),
            (_, Some(_)) => Err(DocumentError::Invalid),
            (_, None) => Ok(()),
        }
    }
}

/// What `document_open` returns: the document's identity plus a read
/// grant token (exactly 32 lower-case hex characters).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenDocumentResult {
    pub document_id: String,
    pub info: DocumentInfo,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_stamp: Option<fs_service::SourceStamp>,
}

/// A token is exactly 32 lower-case hex characters, never a hyphenated
/// UUID.
pub fn is_document_token(token: &str) -> bool {
    token.len() == 32
        && token
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyphenated_uuid_token_is_refused() {
        assert!(!is_document_token(&uuid::Uuid::new_v4().to_string()));
        assert!(is_document_token(&uuid::Uuid::new_v4().simple().to_string()));
    }

    #[test]
    fn unknown_virtual_provider_is_refused() {
        let source = DocumentRef::Virtual {
            provider: "other".to_string(),
            container_path: "C:\\vault".to_string(),
            entry_id: uuid::Uuid::new_v4().to_string(),
        };
        assert_eq!(source.validate(), Err(DocumentError::ProviderMissing));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(DocumentError::SensitiveCopyRequired.code(), "documents.sensitive_copy_required");
        assert_eq!(DocumentError::RebindFailed.code(), "documents.rebind_failed");
    }
}
