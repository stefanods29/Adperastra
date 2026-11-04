//! Engine-neutral draft authority contracts (Step 20a E23/E25).
//!
//! A draft is an unsaved native-memory document. The browser receives only
//! three live UUIDs; it never supplies bytes, a path, a template or a
//! sensitivity flag. An approved binding creates the backing and registers
//! the 09a draft authority, or fails with `office_edit.engine_missing`.
#![allow(dead_code)]


use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::document_drafts::{register_document_draft, DocumentDrafts};
use crate::document_types::DocumentError;
use crate::engine_types::OfficeFormat;
use crate::file_grant_backing::GrantedBacking;
use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_ai_types::{OfficeDraftSourceRef, MAX_AI_SOURCE_REFS};
use crate::office_edit_presentation::DeckTheme;
use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_types::{
    OfficeCallContext, OfficeCapability, OfficeEditError, OfficeFamily, OfficeSessionState,
    OFFICE_OPEN_TIMEOUT_SECS,
};
use crate::office_edit_values::OfficeStoragePolicy;
use crate::{ensure_main, valid_request_id};

#[derive(Clone)]
pub struct AuthorizedOfficeDraft {
    pub draft_id: Uuid,
    pub document_id: Uuid,
    pub initial_slide_id: Uuid,
    pub initial_state: OfficeSessionState,
    /// Bounded native-memory backing retained for the live draft only.
    pub backing: Arc<GrantedBacking>,
}

impl AuthorizedOfficeDraft {
    pub fn is_valid(&self) -> bool {
        !self.draft_id.is_nil()
            && !self.document_id.is_nil()
            && !self.initial_slide_id.is_nil()
            && self.initial_state.family == OfficeFamily::Deck
            && self.initial_state.revision == 1
            && self.initial_state.saved_revision == 1
            && self.initial_state.content_id == self.initial_state.saved_content_id
            && self.initial_state.slide_count == 1
            && !self.initial_state.dirty
            && !self
                .initial_state
                .capabilities
                .iter()
                .any(|capability| {
                    matches!(
                        capability,
                        crate::office_edit_types::OfficeCapability::SaveExisting
                    )
                })
            && self.backing.is_consistent()
            && matches!(&*self.backing, GrantedBacking::Memory { .. })
    }
}

#[derive(Clone)]
pub struct AuthorizedOfficeBlankDraft {
    pub draft_id: Uuid,
    pub document_id: Uuid,
    pub initial_state: OfficeSessionState,
    pub backing: Arc<GrantedBacking>,
}

impl AuthorizedOfficeBlankDraft {
    pub fn is_valid(&self) -> bool {
        !self.draft_id.is_nil()
            && !self.document_id.is_nil()
            && matches!(
                self.initial_state.family,
                OfficeFamily::Document | OfficeFamily::Sheet
            )
            && self.initial_state.revision == 1
            && self.initial_state.saved_revision == 1
            && self.initial_state.content_id == self.initial_state.saved_content_id
            && !self.initial_state.dirty
            && !self
                .initial_state
                .capabilities
                .iter()
                .any(|capability| {
                    matches!(
                        capability,
                        crate::office_edit_types::OfficeCapability::SaveExisting
                    )
                })
            && self.backing.is_consistent()
            && matches!(&*self.backing, GrantedBacking::Memory { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeDraftCreated {
    pub draft_id: Uuid,
    pub document_id: Uuid,
    pub initial_slide_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeBlankDraftCreated {
    pub draft_id: Uuid,
    pub document_id: Uuid,
}

/// Implemented by the coordinator's approved engine binding. There is no
/// default implementation and no in-process fake.
pub trait OfficeDraftBinding {
    fn create_deck(
        &mut self,
        theme: DeckTheme,
        storage_policy: OfficeStoragePolicy,
        context: &mut OfficeCallContext<'_>,
    ) -> Result<AuthorizedOfficeDraft, OfficeEditError>;

    fn create_blank(
        &mut self,
        family: OfficeFamily,
        context: &mut OfficeCallContext<'_>,
    ) -> Result<AuthorizedOfficeBlankDraft, OfficeEditError>;
}

/// Shared native validation before a draft creator is called.
pub fn validate_draft_request(
    family: OfficeFamily,
    theme: Option<&DeckTheme>,
    sources: &[OfficeDraftSourceRef],
) -> Result<(), OfficeEditError> {
    if sources.len() > MAX_AI_SOURCE_REFS || !sources.iter().all(OfficeDraftSourceRef::is_valid) {
        return Err(OfficeEditError::TooLarge);
    }
    match family {
        OfficeFamily::Deck => {
            let theme = theme.ok_or(OfficeEditError::Invalid)?;
            if !theme.is_valid() {
                return Err(OfficeEditError::Invalid);
            }
        }
        OfficeFamily::Document | OfficeFamily::Sheet => {
            if theme.is_some() || !sources.is_empty() {
                return Err(OfficeEditError::Invalid);
            }
        }
    }
    Ok(())
}

/// Optional approved creator. The default state has no binding, so every
/// draft start fails with `office_edit.engine_missing` instead of inventing
/// a document, a path or a saved revision.
#[derive(Default)]
pub struct OfficeDraftState {
    binding: Mutex<Option<Box<dyn OfficeDraftBinding + Send>>>,
}

impl OfficeDraftState {
    pub fn install_binding(
        &self,
        binding: Box<dyn OfficeDraftBinding + Send>,
    ) -> Result<(), OfficeEditError> {
        let mut slot = self.binding.lock().map_err(|_| OfficeEditError::Failed)?;
        if slot.is_some() {
            return Err(OfficeEditError::Busy);
        }
        *slot = Some(binding);
        Ok(())
    }

    pub fn has_binding(&self) -> bool {
        self.binding
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }

    fn with_binding<T>(
        &self,
        work: impl FnOnce(&mut (dyn OfficeDraftBinding + Send)) -> Result<T, OfficeEditError>,
    ) -> Result<T, OfficeEditError> {
        let mut slot = self.binding.lock().map_err(|_| OfficeEditError::Failed)?;
        let binding = slot.as_mut().ok_or(OfficeEditError::EngineMissing)?;
        work(binding.as_mut())
    }
}

fn code(error: OfficeEditError) -> String {
    error.code().to_string()
}

fn draft_format(family: OfficeFamily) -> Option<OfficeFormat> {
    Some(match family {
        OfficeFamily::Deck => OfficeFormat::Pptx,
        OfficeFamily::Document => OfficeFormat::Docx,
        OfficeFamily::Sheet => OfficeFormat::Xlsx,
    })
}

fn draft_handler(family: OfficeFamily) -> &'static str {
    match family {
        OfficeFamily::Deck => "office-slide",
        OfficeFamily::Document => "office-word",
        OfficeFamily::Sheet => "office-sheet",
    }
}

fn draft_mime(format: OfficeFormat) -> Option<&'static str> {
    Some(match format {
        OfficeFormat::Pptx => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        OfficeFormat::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        OfficeFormat::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => return None,
    })
}

/// Register exactly the natively created draft: the draft id is issued to
/// this document first, the family/format pair must be the canonical one
/// and the encoded backing must be non-empty memory. No caller-supplied
/// bytes, name, path or saved revision reach this table.
fn register_created_draft(
    drafts: &DocumentDrafts,
    family: OfficeFamily,
    draft_id: Uuid,
    document_id: Uuid,
    initial_state: &OfficeSessionState,
    backing: &Arc<GrantedBacking>,
) -> Result<(), OfficeEditError> {
    if initial_state.document_id != document_id || initial_state.family != family {
        return Err(OfficeEditError::Failed);
    }
    let format = draft_format(family).ok_or(OfficeEditError::Unsupported)?;
    if initial_state.format != format || format.is_template() {
        return Err(OfficeEditError::Unsupported);
    }
    if !backing.is_consistent() || backing.length() == 0 {
        return Err(OfficeEditError::Failed);
    }
    let handler = draft_handler(family);
    let mime = draft_mime(format).ok_or(OfficeEditError::Unsupported)?;
    drafts
        .issue_draft_id(document_id, draft_id)
        .map_err(|_| OfficeEditError::Failed)?;
    register_document_draft(
        drafts,
        document_id,
        draft_id,
        &format!("draft.{}", format.as_str()),
        mime,
        Arc::clone(backing),
        handler,
        backing.is_sensitive(),
        Uuid::new_v4().simple().to_string(),
        |candidate| candidate == handler,
    )
    .map_err(|error| match error {
        DocumentError::TooManyOpen => OfficeEditError::TooLarge,
        DocumentError::EditorConflict => OfficeEditError::Busy,
        _ => OfficeEditError::Failed,
    })?;
    Ok(())
}

fn cancelled(context: &crate::jobs::JobContext) -> bool {
    context.token().load(Ordering::Relaxed)
}

/// E23: create one themed deck draft. The browser supplies only the bounded
/// theme and native-issued source references; the approved binding returns
/// the draft ids, the initial state and the memory backing.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_draft_create_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    drafts: State<'_, OfficeDraftState>,
    request_id: String,
    family: OfficeFamily,
    theme: Option<DeckTheme>,
    source_references: Vec<OfficeDraftSourceRef>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    let profile = edit.current_profile().map_err(code)?;
    if family != OfficeFamily::Deck {
        return Err(code(OfficeEditError::Invalid));
    }
    validate_draft_request(family, theme.as_ref(), &source_references).map_err(code)?;
    let theme = theme.ok_or_else(|| code(OfficeEditError::Invalid))?;
    if !edit.has_engine() || !drafts.has_binding() {
        return Err(code(OfficeEditError::EngineMissing));
    }
    // Source-derived drafts are treated as sensitive: without a native
    // classification lookup the restrictive policy is the only safe one.
    let storage_policy = if source_references.is_empty() {
        OfficeStoragePolicy::Ordinary
    } else {
        OfficeStoragePolicy::Sensitive
    };
    let job_request_id = request_id.clone();
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let edit = context.app().state::<OfficeEditState>();
        if edit.current_profile().map_err(code)? != profile {
            return Err(code(OfficeEditError::Changed));
        }
        if cancelled(context) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let state = context.app().state::<OfficeDraftState>();
        let drafts = context.app().state::<Arc<DocumentDrafts>>();
        let mut progress = |_progress: &fs_service::OpProgress| {};
        let mut call = OfficeCallContext {
            request_id: job_request_id,
            cancel: context.token().clone(),
            deadline: Instant::now() + Duration::from_secs(OFFICE_OPEN_TIMEOUT_SECS),
            progress: &mut progress,
        };
        call.check().map_err(code)?;
        let created = state
            .with_binding(|binding| binding.create_deck(theme, storage_policy, &mut call))
            .map_err(code)?;
        if cancelled(context) {
            return Err(code(OfficeEditError::Cancelled));
        }
        if !created.is_valid() || created.initial_state.document_id != created.document_id {
            return Err(code(OfficeEditError::Failed));
        }
        if storage_policy == OfficeStoragePolicy::Sensitive
            && !created.initial_state.capabilities.contains(&OfficeCapability::SensitiveMemory)
        {
            return Err(code(OfficeEditError::SensitiveUnsupported));
        }
        register_created_draft(
            drafts.as_ref(),
            OfficeFamily::Deck,
            created.draft_id,
            created.document_id,
            &created.initial_state,
            &created.backing,
        )
        .map_err(code)?;
        serde_json::to_value(OfficeDraftCreated {
            draft_id: created.draft_id,
            document_id: created.document_id,
            initial_slide_id: created.initial_slide_id,
        })
        .map_err(|_| code(OfficeEditError::Failed))
    });
    Ok(())
}

/// E25: create one ordinary blank document or sheet draft.
#[tauri::command]
pub async fn office_blank_draft_create_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    drafts: State<'_, OfficeDraftState>,
    request_id: String,
    family: OfficeFamily,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    let profile = edit.current_profile().map_err(code)?;
    if !matches!(family, OfficeFamily::Document | OfficeFamily::Sheet) {
        return Err(code(OfficeEditError::Invalid));
    }
    if !edit.has_engine() || !drafts.has_binding() {
        return Err(code(OfficeEditError::EngineMissing));
    }
    let job_request_id = request_id.clone();
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let edit = context.app().state::<OfficeEditState>();
        if edit.current_profile().map_err(code)? != profile {
            return Err(code(OfficeEditError::Changed));
        }
        if cancelled(context) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let state = context.app().state::<OfficeDraftState>();
        let drafts = context.app().state::<Arc<DocumentDrafts>>();
        let mut progress = |_progress: &fs_service::OpProgress| {};
        let mut call = OfficeCallContext {
            request_id: job_request_id,
            cancel: context.token().clone(),
            deadline: Instant::now() + Duration::from_secs(OFFICE_OPEN_TIMEOUT_SECS),
            progress: &mut progress,
        };
        call.check().map_err(code)?;
        let created = state
            .with_binding(|binding| binding.create_blank(family, &mut call))
            .map_err(code)?;
        if cancelled(context) {
            return Err(code(OfficeEditError::Cancelled));
        }
        if !created.is_valid() || created.initial_state.document_id != created.document_id {
            return Err(code(OfficeEditError::Failed));
        }
        register_created_draft(
            drafts.as_ref(),
            family,
            created.draft_id,
            created.document_id,
            &created.initial_state,
            &created.backing,
        )
        .map_err(code)?;
        serde_json::to_value(OfficeBlankDraftCreated {
            draft_id: created.draft_id,
            document_id: created.document_id,
        })
        .map_err(|_| code(OfficeEditError::Failed))
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_references_are_bounded() {
        let sources = vec![
            OfficeDraftSourceRef::OfficeContext {
                context_id: Uuid::new_v4()
            };
            MAX_AI_SOURCE_REFS + 1
        ];
        assert_eq!(
            validate_draft_request(OfficeFamily::Deck, None, &sources).unwrap_err(),
            OfficeEditError::TooLarge
        );
    }
}
