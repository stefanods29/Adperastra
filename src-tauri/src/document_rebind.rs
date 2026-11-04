//! Save as new: native validation (Step 09a E12).
//!
//! The no-replace copy half is available through `document_commit`. The
//! rebind job stays fail-closed until one native transaction can also replace
//! the document's guarded read grant and snapshot-authority source. Updating
//! only the path descriptor would leave subsequent reads and captures bound
//! to the old file, so this module does not claim that partial operation.
#![allow(dead_code)]


use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::document_commit::DocumentCommitResult;
use crate::document_types::{DocumentError, DocumentRef};
use crate::documents::DocumentStore;
use crate::{ensure_main, validate_absolute_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSaveAsNewRequest {
    pub document_id: String,
    pub snapshot_id: String,
    pub captured_revision: u64,
    pub content_id: String,
    pub expected_source_generation: u64,
    pub dest_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRebindResult {
    pub commit: DocumentCommitResult,
    pub previous_source: DocumentRef,
    pub new_source: DocumentRef,
    pub source_generation: u64,
    pub rebound: bool,
    pub output_path: String,
}

/// Pure pre-write checks. `bound_document` is the document currently
/// bound to the destination, if any (a live editable document may not be
/// targeted). Runs before any byte is written.
pub fn validate_save_as_new(
    sensitive: bool,
    current_generation: u64,
    request: &DocumentSaveAsNewRequest,
    bound_document: Option<Uuid>,
    self_document: Uuid,
) -> Result<(), DocumentError> {
    if sensitive {
        return Err(DocumentError::SensitiveCopyRequired);
    }
    if request.expected_source_generation != current_generation {
        return Err(DocumentError::Changed);
    }
    if let Some(bound) = bound_document {
        if bound != self_document {
            return Err(DocumentError::EditorConflict);
        }
    }
    Ok(())
}

/// Refuse Save-as-new until its read grant and snapshot authority can be
/// rebound with the source descriptor. No job or output file is created.
#[tauri::command]
pub async fn document_save_as_new_start(
    window: WebviewWindow,
    _app: tauri::AppHandle,
    _documents: State<'_, Arc<DocumentStore>>,
    _jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: DocumentSaveAsNewRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if Uuid::try_parse(&request.document_id).is_err()
        || Uuid::try_parse(&request.snapshot_id).is_err()
        || Uuid::try_parse(&request.content_id).is_err()
        || request.captured_revision == 0
    {
        return Err(DocumentError::Invalid.code().to_string());
    }
    validate_absolute_path(&request.dest_path)
        .map_err(|_| DocumentError::Invalid.code().to_string())?;
    Err(DocumentError::ReadOnly.code().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(generation: u64) -> DocumentSaveAsNewRequest {
        DocumentSaveAsNewRequest {
            document_id: Uuid::new_v4().to_string(),
            snapshot_id: Uuid::new_v4().to_string(),
            captured_revision: 1,
            content_id: Uuid::new_v4().to_string(),
            expected_source_generation: generation,
            dest_path: "C:\\notes\\copy.txt".to_string(),
        }
    }

    #[test]
    fn sensitive_rebind_refused_before_write() {
        let error = validate_save_as_new(true, 0, &request(0), None, Uuid::new_v4()).unwrap_err();
        assert_eq!(error, DocumentError::SensitiveCopyRequired);
    }

    #[test]
    fn bound_destination_refused() {
        let owner = Uuid::new_v4();
        let other = Uuid::new_v4();
        let error = validate_save_as_new(false, 0, &request(0), Some(owner), other).unwrap_err();
        assert_eq!(error, DocumentError::EditorConflict);
    }

    #[test]
    fn stale_generation_is_a_change_not_a_write() {
        let error = validate_save_as_new(false, 2, &request(1), None, Uuid::new_v4()).unwrap_err();
        assert_eq!(error, DocumentError::Changed);
    }
}
