//! Bounded basic editor query; all mutations use existing typed transactions.
use crate::{office_edit_sessions::OfficeEditState, office_edit_types::OfficeEditError};
use serde::Serialize;
use tauri::{State, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct BasicItem {
    pub id: Uuid,
    pub section_id: Uuid,
    pub text: String,
    pub address: Option<String>,
}

#[derive(Serialize)]
pub struct BasicPage {
    pub revision: u64,
    pub section_id: Uuid,
    pub section_index: usize,
    pub next_start: Option<usize>,
    pub has_next_section: bool,
    pub items: Vec<BasicItem>,
}

#[tauri::command]
pub async fn office_edit_basic_page(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    expected_revision: u64,
    section_index: usize,
    start: usize,
) -> Result<BasicPage, String> {
    crate::ensure_main(window.label())?;
    edit.current_profile().map_err(|e| e.code().to_owned())?;
    let id = crate::office_edit_validation::parse_id(&session_id)?;
    if section_index > 4095 || start > 4 * 1024 * 1024 {
        return Err(OfficeEditError::Invalid.code().to_owned());
    }
    let session = edit.session(id).map_err(|e| e.code().to_owned())?;
    let engine = edit.engine().map_err(|e| e.code().to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = session.lock_mutation()?;
        let current = session.snapshot()?;
        if current.revision != expected_revision {
            return Err(OfficeEditError::Changed);
        }
        engine.basic_page(id, expected_revision, section_index, start)
    })
    .await
    .map_err(|_| OfficeEditError::Failed.code().to_owned())?
    .map_err(|e| e.code().to_owned())
}
