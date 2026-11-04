//! Limited preserved-package editor, using the shared Office controller port.
use crate::office_edit_basic::{BasicItem, BasicPage};
use crate::{
    engine_types::OfficeFormat,
    office_edit_items::{OfficeFormatting, OfficeItemKind, OfficeItemPage},
    office_edit_sessions::OfficeEditCommandEngine,
    office_edit_types::*,
    office_edit_values::OfficeSelection,
    office_edit_worker_protocol::{WorkerCommand, WorkerPayload, MAX_WORKER_ARCHIVE},
    office_ooxml_worker::OfficeWorker,
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub struct BasicSession {
    pub state: OfficeSessionState,
    pub worker: OfficeWorker,
    pub targets: HashMap<Uuid, BasicItem>,
    pub sections: HashMap<usize, Uuid>,
    pub undo: Vec<Uuid>,
    pub redo: Vec<Uuid>,
    original: Arc<Vec<u8>>,
    _input: Arc<AuthorizedOfficeInput>,
}

pub struct BasicOfficeEngine {
    root: PathBuf,
    sessions: Mutex<HashMap<Uuid, Arc<Mutex<BasicSession>>>>,
}

impl BasicOfficeEngine {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            sessions: Mutex::new(HashMap::new()),
        }
    }
    fn session(&self, id: Uuid) -> Result<Arc<Mutex<BasicSession>>, OfficeEditError> {
        self.sessions
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .get(&id)
            .cloned()
            .ok_or(OfficeEditError::Invalid)
    }
}

impl BasicSession {
    pub fn check(&self, expected: u64) -> Result<(), OfficeEditError> {
        if self.state.revision != expected {
            return Err(OfficeEditError::Changed);
        }
        if self.state.revision >= crate::office_edit_values::MAX_SAFE_INTEGER {
            return Err(OfficeEditError::TooLarge);
        }
        Ok(())
    }
    fn changed(&mut self, content_id: Uuid) {
        self.state.revision += 1;
        self.state.content_id = content_id;
        self.state.dirty = content_id != self.state.saved_content_id;
        self.state.can_undo = !self.undo.is_empty();
        self.state.can_redo = !self.redo.is_empty();
        self.state.selection = None;
        self.targets.clear();
    }
    fn receipt(&self, id: Uuid) -> OfficeTransactionResult {
        OfficeTransactionResult {
            transaction_id: id,
            state: self.state.clone(),
            changed: true,
            affected_ids: vec![],
            warnings: vec![],
        }
    }
}

pub fn kind(format: OfficeFormat) -> Result<&'static str, OfficeEditError> {
    match format {
        OfficeFormat::Docx => Ok("docx"),
        OfficeFormat::Xlsx => Ok("xlsx"),
        OfficeFormat::Pptx => Ok("pptx"),
        _ => Err(OfficeEditError::Unsupported),
    }
}

impl OfficeEditCommandEngine for BasicOfficeEngine {
    fn open(
        &self,
        input: Arc<AuthorizedOfficeInput>,
        family: OfficeFamily,
        policy: &OfficeSecurityPolicy,
    ) -> Result<BindingSession, OfficeEditError> {
        if input.sensitive {
            return Err(OfficeEditError::SensitiveUnsupported);
        }
        if !input.is_valid()
            || !policy.is_valid()
            || crate::office_edit_validation::family_of(input.format) != family
        {
            return Err(OfficeEditError::Invalid);
        }
        let ext = kind(input.format)?;
        if input.backing.granted().length() > MAX_WORKER_ARCHIVE {
            return Err(OfficeEditError::TooLarge);
        }
        let mut bytes = Vec::new();
        input
            .backing
            .granted()
            .reader()
            .take(MAX_WORKER_ARCHIVE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| OfficeEditError::Changed)?;
        if bytes.len() as u64 != input.backing.granted().length() {
            return Err(OfficeEditError::Changed);
        }
        let mut worker = OfficeWorker::open(&self.root, ext, &bytes)?;
        let id = Uuid::new_v4();
        let sheet_count = if family == OfficeFamily::Sheet {
            let WorkerPayload::Sheets(meta) = worker.request(&WorkerCommand::Sheets {})? else {
                return Err(OfficeEditError::Failed);
            };
            meta.items.len() as u32
        } else {
            0
        };
        let state = crate::office_ooxml_state::initial(id, &input, family, sheet_count);
        let session = BasicSession {
            state: state.clone(),
            worker,
            targets: HashMap::new(),
            sections: HashMap::new(),
            undo: vec![],
            redo: vec![],
            original: Arc::new(bytes),
            _input: input,
        };
        let mut sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
        if sessions.len() >= 4 {
            return Err(OfficeEditError::Busy);
        }
        sessions.insert(id, Arc::new(Mutex::new(session)));
        Ok(BindingSession {
            session_id: id,
            initial_state: state,
        })
    }
    fn close(&self, id: Uuid) -> Result<(), OfficeEditError> {
        self.sessions
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .remove(&id);
        Ok(())
    }
    fn state(&self, id: Uuid) -> Result<OfficeSessionState, OfficeEditError> {
        Ok(self
            .session(id)?
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .state
            .clone())
    }
    fn basic_page(
        &self,
        id: Uuid,
        expected: u64,
        section: usize,
        start: usize,
    ) -> Result<BasicPage, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.check(expected)?;
        let WorkerPayload::Targets(page) = session.worker.request(&WorkerCommand::List {
            section_index: section,
            start,
        })?
        else {
            return Err(OfficeEditError::Failed);
        };
        let section_id = *session.sections.entry(section).or_insert_with(Uuid::new_v4);
        let items: Vec<_> = page
            .items
            .into_iter()
            .map(|item| BasicItem {
                id: item.id,
                text: item.text,
                address: item.address,
                section_id,
            })
            .collect();
        for item in &items {
            session.targets.insert(item.id, item.clone());
        }
        Ok(BasicPage {
            revision: expected,
            section_id,
            section_index: section,
            next_start: page.next_start,
            has_next_section: page.has_next_section,
            items,
        })
    }
    fn transact(
        &self,
        id: Uuid,
        transaction: &OfficeTransaction,
    ) -> Result<OfficeTransactionResult, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.check(transaction.expected_revision)?;
        if session.state.mode != OfficeMode::Editing {
            return Err(OfficeEditError::ReadOnly);
        }
        let edits = crate::office_ooxml_operations::translate(&session, transaction)?;
        session
            .worker
            .request(&WorkerCommand::Edit { operations: edits })?;
        let old = session.state.content_id;
        if session.undo.len() == 3 {
            session.undo.remove(0);
        }
        session.undo.push(old);
        session.redo.clear();
        session.changed(Uuid::new_v4());
        Ok(session.receipt(transaction.transaction_id))
    }
    fn undo(
        &self,
        id: Uuid,
        expected: u64,
        transaction_id: Uuid,
    ) -> Result<OfficeTransactionResult, OfficeEditError> {
        self.history(id, expected, transaction_id, false)
    }
    fn redo(
        &self,
        id: Uuid,
        expected: u64,
        transaction_id: Uuid,
    ) -> Result<OfficeTransactionResult, OfficeEditError> {
        self.history(id, expected, transaction_id, true)
    }
    fn set_mode(&self, id: Uuid, mode: OfficeMode) -> Result<OfficeSessionState, OfficeEditError> {
        if mode == OfficeMode::Reviewing {
            return Err(OfficeEditError::Unsupported);
        }
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.state.mode = mode;
        Ok(session.state.clone())
    }
    fn discard_saved(
        &self,
        id: Uuid,
        saved: Uuid,
        expected: u64,
        content: Uuid,
    ) -> Result<OfficeDiscardSavedResult, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.check(expected)?;
        if session.state.content_id != content || session.state.saved_content_id != saved {
            return Err(OfficeEditError::Changed);
        }
        if !session.state.dirty {
            return Ok(OfficeDiscardSavedResult {
                state: session.state.clone(),
                changed: false,
            });
        }
        let worker =
            OfficeWorker::open(&self.root, kind(session.state.format)?, &session.original)?;
        session.worker = worker;
        session.undo.clear();
        session.redo.clear();
        session.changed(saved);
        Ok(OfficeDiscardSavedResult {
            state: session.state.clone(),
            changed: true,
        })
    }
    fn items(
        &self,
        id: Uuid,
        kind: OfficeItemKind,
        cursor: Option<&str>,
    ) -> Result<OfficeItemPage, OfficeEditError> {
        if kind != OfficeItemKind::Sheets || cursor.is_some() {
            return Err(OfficeEditError::Unsupported);
        }
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        crate::office_ooxml_sheets::items(&mut session)
    }
    fn cell_window(
        &self,
        id: Uuid,
        range: &crate::office_edit_values::CellRange,
    ) -> Result<crate::office_edit_items::OfficeCellWindow, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        crate::office_ooxml_sheets::window(&mut session, range)
    }
    fn formatting(
        &self,
        _: Uuid,
        _: &OfficeSelection,
    ) -> Result<OfficeFormatting, OfficeEditError> {
        Err(OfficeEditError::Unsupported)
    }
    fn capture(
        &self,
        id: Uuid,
        expected: u64,
        output: &mut dyn Write,
    ) -> Result<EncodedOfficeInfo, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.check(expected)?;
        let byte_len = session.worker.capture(output)?;
        let mime = match session.state.family {
            OfficeFamily::Document => {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            }
            OfficeFamily::Sheet => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            OfficeFamily::Deck => {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            }
        };
        Ok(EncodedOfficeInfo {
            mime: mime.to_owned(),
            byte_len,
            format: session.state.format,
            source_revision: expected,
            content_id: session.state.content_id,
            preserved_features: vec!["untouched_ooxml_parts".to_owned()],
            compatibility: session.state.compatibility.clone(),
        })
    }
}

impl BasicOfficeEngine {
    fn history(
        &self,
        id: Uuid,
        expected: u64,
        transaction_id: Uuid,
        redo: bool,
    ) -> Result<OfficeTransactionResult, OfficeEditError> {
        let session = self.session(id)?;
        let mut session = session.lock().map_err(|_| OfficeEditError::Failed)?;
        session.check(expected)?;
        if session.state.mode != OfficeMode::Editing {
            return Err(OfficeEditError::ReadOnly);
        }
        let content = *(if redo { &session.redo } else { &session.undo })
            .last()
            .ok_or(OfficeEditError::Unsupported)?;
        session.worker.request(&if redo {
            WorkerCommand::Redo {}
        } else {
            WorkerCommand::Undo {}
        })?;
        let previous = session.state.content_id;
        if redo {
            session.redo.pop();
            session.undo.push(previous);
        } else {
            session.undo.pop();
            session.redo.push(previous);
        }
        session.changed(content);
        Ok(session.receipt(transaction_id))
    }
}
