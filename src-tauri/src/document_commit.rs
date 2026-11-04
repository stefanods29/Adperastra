//! Document commit jobs (Step 09a T2).
//!
//! A `copy` writes one finished snapshot to a new file without replacing
//! anything. A `save` onto the existing file stays refused until Step
//! 09f proves the approved-object contract (KI-069); no code path here
//! overwrites an original.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::document_types::{DocumentError, DocumentRef};
use crate::documents::DocumentStore;
use crate::{ensure_main, validate_absolute_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentCommitRequest {
    pub document_id: String,
    pub snapshot_id: String,
    pub captured_revision: u64,
    pub content_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_source: Option<fs_service::SourceStamp>,
    /// `save` or `copy`.
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dest_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentCommitResult {
    pub saved_revision: u64,
    pub content_id: String,
    pub new_source: fs_service::SourceStamp,
    pub output_path: String,
    pub mode: String,
}

/// Start a commit job; the result arrives through the shared
/// `job_poll` / `job_cancel` commands.
#[tauri::command]
pub async fn document_commit_start(
    window: WebviewWindow,
    app: tauri::AppHandle,
    documents: State<'_, Arc<DocumentStore>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: DocumentCommitRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let document_id = Uuid::try_parse(&request.document_id)
        .map_err(|_| DocumentError::Invalid.code().to_string())?;
    if Uuid::try_parse(&request.snapshot_id).is_err()
        || Uuid::try_parse(&request.content_id).is_err()
        || request.captured_revision == 0
    {
        return Err(DocumentError::Invalid.code().to_string());
    }
    let entry = documents.entry(document_id).map_err(String::from)?;
    let dest = match request.mode.as_str() {
        "copy" => {
            let dest = request
                .dest_path
                .clone()
                .ok_or_else(|| DocumentError::Invalid.code().to_string())?;
            validate_absolute_path(&dest).map_err(|_| DocumentError::Invalid.code().to_string())?;
            PathBuf::from(dest)
        }
        "save" => {
            // Sensitive sources and unproven in-place replacement both
            // stay unavailable; the caller offers Save copy instead.
            let _ = entry;
            return Err(DocumentError::ReadOnly.code().to_string());
        }
        _ => return Err(DocumentError::Invalid.code().to_string()),
    };
    let token = jobs.begin(&request_id, 1)?;
    let store: Arc<DocumentStore> = documents.inner().clone();
    let snapshot_id = request.snapshot_id.clone();
    let content_id = request.content_id.clone();
    let revision = request.captured_revision;
    let expected_source = request.expected_source.clone();
    let source_path = match &entry.info.source {
        DocumentRef::Disk { path } => Some(PathBuf::from(path)),
        _ => None,
    };
    crate::jobs::spawn_job(app, request_id, token, move |_context| {
        if let Some(expected) = expected_source {
            let path = source_path.ok_or_else(|| DocumentError::Changed.code().to_string())?;
            let current = fs_service::capture_source_stamp(&path)
                .map_err(|_| DocumentError::Changed.code().to_string())?;
            if current != expected {
                return Err(DocumentError::Changed.code().to_string());
            }
        }
        let published = store
            .commit_copy(document_id, &snapshot_id, revision, &content_id, &dest)
            .map_err(String::from)?;
        let stamp = fs_service::capture_source_stamp(&published)
            .map_err(|_| DocumentError::Io.code().to_string())?;
        let value = DocumentCommitResult {
            saved_revision: revision,
            content_id: content_id.clone(),
            new_source: stamp,
            output_path: published.to_string_lossy().into_owned(),
            mode: "copy".to_string(),
        };
        serde_json::to_value(value).map_err(|_| DocumentError::Io.code().to_string())
    });
    Ok(())
}
