//! Shared initial state for the limited first-party Office engine.
use crate::office_edit_types::*;
use uuid::Uuid;
pub fn initial(
    id: Uuid,
    input: &AuthorizedOfficeInput,
    family: OfficeFamily,
    sheet_count: u32,
) -> OfficeSessionState {
    let text_capability = match family {
        OfficeFamily::Document => OfficeCapability::DocumentText,
        OfficeFamily::Sheet => OfficeCapability::SheetCells,
        OfficeFamily::Deck => OfficeCapability::DeckShapes,
    };
    OfficeSessionState {
        session_id: id,
        document_id: input.document_id,
        family,
        format: input.format,
        revision: input.initial_revision,
        saved_revision: input.initial_revision,
        content_id: input.initial_content_id,
        saved_content_id: input.initial_content_id,
        ready: true,
        mode: OfficeMode::Viewing,
        dirty: false,
        can_undo: false,
        can_redo: false,
        capabilities: vec![
            text_capability,
            OfficeCapability::PreserveUnknown,
            OfficeCapability::SaveCopy,
        ],
        selection: None,
        compatibility: CompatibilityReport {
            format: input.format.as_str().to_owned(),
            entries: vec![],
            next_cursor: None,
            can_preserve_unknown: true,
            blocks_save: false,
        },
        page_count: 0,
        sheet_count,
        slide_count: 0,
        busy: false,
        status_key: Some("office.basicEditing".to_owned()),
    }
}
