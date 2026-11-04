//! Office edit session registry and engine port (Step 20a T2).
//!
//! One session belongs to exactly one live document, profile and immutable
//! authorized input. The registry keeps only bounded DTO state in memory; no
//! document text, path, token or engine handle is serialized or written to
//! disk. Without an installed approved binding every engine-dependent command
//! returns `office_edit.engine_missing`; nothing is simulated.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use convert::PageRange;
use uuid::Uuid;

use crate::file_grant_backing::GrantedBacking;
use crate::office_edit_items::{
    DocumentStatistics, OfficeCellWindow, OfficeFindMatch, OfficeFindRequest, OfficeFormatting,
    OfficeFormulaLocale, OfficeFunction, OfficeItemKind, OfficeItemPage, OfficeSpellingIssue,
    ParsedOfficeFormula, SheetPrintSettings,
};
use crate::office_edit_transactions::TransactionCache;
use crate::office_edit_types::{
    AuthorizedOfficeInput, BindingSession, EncodedOfficeInfo, OfficeDiscardSavedResult,
    OfficeEditError, OfficeExportFormat, OfficeFamily, OfficeMode, OfficeRenderPage,
    OfficeResultPage, OfficeSecurityPolicy, OfficeSessionState, OfficeTransaction,
    OfficeTransactionResult,
};
use crate::office_edit_values::{CellRange, OfficeViewport, TextSpan};
use crate::office_edit_validation::{valid_profile_id, validate_initial_state};

/// D4: at most four live edit sessions, shared by every editor tab.
pub const MAX_OFFICE_EDIT_SESSIONS: usize = 4;

/// The native integration port a later approved binding installs.
///
/// This is deliberately narrower than the frozen E10 SPI: the installed
/// adapter owns its engine context, cancellation and confinement. A missing
/// adapter is not replaced by a fake implementation.
pub trait OfficeEditCommandEngine: Send + Sync {
    fn basic_page(&self, _id: Uuid, _expected: u64, _section: usize, _start: usize) -> Result<crate::office_edit_basic::BasicPage, OfficeEditError> { Err(OfficeEditError::Unsupported) }
    fn open(
        &self,
        input: Arc<AuthorizedOfficeInput>,
        family: OfficeFamily,
        policy: &OfficeSecurityPolicy,
    ) -> Result<BindingSession, OfficeEditError>;
    fn close(&self, session_id: Uuid) -> Result<(), OfficeEditError>;
    fn state(&self, session_id: Uuid) -> Result<OfficeSessionState, OfficeEditError>;
    fn transact(
        &self,
        session_id: Uuid,
        transaction: &OfficeTransaction,
    ) -> Result<OfficeTransactionResult, OfficeEditError>;
    fn undo(
        &self,
        session_id: Uuid,
        expected_revision: u64,
        transaction_id: Uuid,
    ) -> Result<OfficeTransactionResult, OfficeEditError>;
    fn redo(
        &self,
        session_id: Uuid,
        expected_revision: u64,
        transaction_id: Uuid,
    ) -> Result<OfficeTransactionResult, OfficeEditError>;
    fn set_mode(
        &self,
        session_id: Uuid,
        mode: OfficeMode,
    ) -> Result<OfficeSessionState, OfficeEditError>;
    fn discard_saved(
        &self,
        session_id: Uuid,
        saved_content_id: Uuid,
        expected_revision: u64,
        expected_content_id: Uuid,
    ) -> Result<OfficeDiscardSavedResult, OfficeEditError>;
    fn items(
        &self,
        session_id: Uuid,
        kind: OfficeItemKind,
        cursor: Option<&str>,
    ) -> Result<OfficeItemPage, OfficeEditError>;
    fn formatting(
        &self,
        session_id: Uuid,
        selection: &crate::office_edit_values::OfficeSelection,
    ) -> Result<OfficeFormatting, OfficeEditError>;

    // The E7/E12/E13/E14 read-only queries below are additive. An installed
    // binding overrides the ones its approved engine proves; an unimplemented
    // method stays `engine_missing` and never returns a fabricated answer.
    /// E7 canonical/display formula translation, owned by the engine AST.
    fn formula_parse(
        &self,
        _session_id: Uuid,
        _text: &str,
        _locale: OfficeFormulaLocale,
    ) -> Result<ParsedOfficeFormula, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E7 canonical AST to the locale display notation.
    fn formula_format(
        &self,
        _session_id: Uuid,
        _canonical: &str,
        _locale: OfficeFormulaLocale,
    ) -> Result<String, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E7 bounded document search (no regular-expression mode).
    fn find(
        &self,
        _session_id: Uuid,
        _request: &OfficeFindRequest,
        _cursor: Option<&str>,
    ) -> Result<OfficeResultPage<OfficeFindMatch>, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E12 local spelling only; no grammar, style, AI or network checker.
    fn spelling(
        &self,
        _session_id: Uuid,
        _span: &TextSpan,
        _cursor: Option<&str>,
    ) -> Result<OfficeResultPage<OfficeSpellingIssue>, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E13 bounded whole-document statistics.
    fn document_stats(&self, _session_id: Uuid) -> Result<DocumentStatistics, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E14 bounded visible-cell window (500 rows / 2,000 cells / 768 KiB).
    fn cell_window(
        &self,
        _session_id: Uuid,
        _range: &CellRange,
    ) -> Result<OfficeCellWindow, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E17 approved local function catalogue for the current session, paginated
    /// with the shared bounded result page. Unknown functions are never invented.
    fn functions(
        &self,
        _session_id: Uuid,
        _locale: OfficeFormulaLocale,
        _cursor: Option<&str>,
    ) -> Result<OfficeResultPage<OfficeFunction>, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E4 bounded render of the current model. The implementation registers
    /// every returned image lease through `office_edit_leases` before it
    /// returns; the command proves ownership and session sensitivity again.
    fn render(
        &self,
        _session_id: Uuid,
        _viewport: &OfficeViewport,
    ) -> Result<OfficeResultPage<OfficeRenderPage>, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E5 immutable capture of the exact current editable Office format.
    /// Output goes through the caller's bounded writer, never a UI path.
    fn capture(
        &self,
        _session_id: Uuid,
        _expected_revision: u64,
        _output: &mut dyn std::io::Write,
    ) -> Result<EncodedOfficeInfo, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E5 PDF/image export of the frozen revision. One image page per call.
    fn export(
        &self,
        _session_id: Uuid,
        _expected_revision: u64,
        _format: OfficeExportFormat,
        _ranges: &[PageRange],
        _output: &mut dyn std::io::Write,
    ) -> Result<EncodedOfficeInfo, OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }

    /// E19 system print of the exact frozen revision through the renderer the
    /// installed binding proves. The engine owns its print dialog; no output
    /// path or silent-print mode is accepted.
    fn print(
        &self,
        _session_id: Uuid,
        _expected_revision: u64,
        _ranges: &[PageRange],
        _settings: Option<&SheetPrintSettings>,
    ) -> Result<(), OfficeEditError> {
        Err(OfficeEditError::EngineMissing)
    }
}

pub struct OfficeEditSession {
    state: Mutex<OfficeSessionState>,
    pub(crate) profile_id: String,
    sensitive: bool,
    /// Retained for the complete session, as required by E10/U1.
    #[allow(dead_code)]
    input: Arc<AuthorizedOfficeInput>,
    mutation: Mutex<()>,
    transactions: Mutex<TransactionCache>,
}

impl OfficeEditSession {
    fn new(
        state: OfficeSessionState,
        profile_id: String,
        sensitive: bool,
        input: Arc<AuthorizedOfficeInput>,
    ) -> Self {
        Self {
            state: Mutex::new(state),
            profile_id,
            sensitive,
            input,
            mutation: Mutex::new(()),
            transactions: Mutex::new(TransactionCache::default()),
        }
    }

    pub fn snapshot(&self) -> Result<OfficeSessionState, OfficeEditError> {
        self.state
            .lock()
            .map(|state| state.clone())
            .map_err(|_| OfficeEditError::Failed)
    }

    /// Native input classification retained for the whole session.
    pub fn is_sensitive(&self) -> bool {
        self.sensitive
    }

    pub fn lock_mutation(&self) -> Result<MutexGuard<'_, ()>, OfficeEditError> {
        self.mutation.lock().map_err(|_| OfficeEditError::Failed)
    }

    pub fn commit(
        &self,
        expected_revision: u64,
        next: OfficeSessionState,
    ) -> Result<(), OfficeEditError> {
        let mut current = self.state.lock().map_err(|_| OfficeEditError::Failed)?;
        if current.revision != expected_revision
            || next.session_id != current.session_id
            || next.document_id != current.document_id
            || next.family != current.family
            || next.revision < current.revision
            || !next.is_valid()
        {
            return Err(OfficeEditError::Changed);
        }
        *current = next;
        Ok(())
    }

    pub fn lookup_transaction(
        &self,
        transaction_id: Uuid,
        fingerprint: &str,
    ) -> Result<Option<OfficeTransactionResult>, OfficeEditError> {
        self.transactions
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .lookup(transaction_id, fingerprint)
    }

    pub fn retain_transaction(
        &self,
        transaction_id: Uuid,
        fingerprint: String,
        result: OfficeTransactionResult,
    ) -> Result<(), OfficeEditError> {
        self.transactions
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .retain(transaction_id, fingerprint, result);
        Ok(())
    }
}

#[allow(clippy::large_enum_variant)]
enum OpenStart {
    New,
    Existing(OfficeSessionState),
}

/// Managed app state. `new` is the constructor `main.rs` uses with the active
/// profile id; `install_engine` is called only by the approved binding task.
pub struct OfficeEditState {
    pub(crate) profile: Mutex<Option<String>>,
    pub(crate) sessions: Mutex<HashMap<Uuid, Arc<OfficeEditSession>>>,
    pub(crate) pending: Mutex<HashSet<Uuid>>,
    pub(crate) engine: RwLock<Option<Arc<dyn OfficeEditCommandEngine>>>,
}

impl Default for OfficeEditState {
    fn default() -> Self {
        Self::without_profile()
    }
}

impl OfficeEditState {
    pub fn new(profile_id: &str) -> Self {
        Self {
            profile: Mutex::new(Some(profile_id.to_string())),
            sessions: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashSet::new()),
            engine: RwLock::new(None),
        }
    }

    pub fn without_profile() -> Self {
        Self {
            profile: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashSet::new()),
            engine: RwLock::new(None),
        }
    }

    pub fn install_engine(
        &self,
        engine: Arc<dyn OfficeEditCommandEngine>,
    ) -> Result<(), OfficeEditError> {
        let mut slot = self.engine.write().map_err(|_| OfficeEditError::Failed)?;
        if slot.is_some() {
            return Err(OfficeEditError::Busy);
        }
        *slot = Some(engine);
        Ok(())
    }

    pub fn has_engine(&self) -> bool {
        self.engine
            .read()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }

    pub fn engine(&self) -> Result<Arc<dyn OfficeEditCommandEngine>, OfficeEditError> {
        self.engine
            .read()
            .map_err(|_| OfficeEditError::Failed)?
            .clone()
            .ok_or(OfficeEditError::EngineMissing)
    }

    pub fn current_profile(&self) -> Result<String, OfficeEditError> {
        let profile = self
            .profile
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .clone()
            .ok_or(OfficeEditError::Failed)?;
        if !valid_profile_id(&profile) {
            return Err(OfficeEditError::Failed);
        }
        Ok(profile)
    }

    pub fn session(
        &self,
        session_id: Uuid,
    ) -> Result<Arc<OfficeEditSession>, OfficeEditError> {
        let profile = self.current_profile()?;
        let sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
        match sessions.get(&session_id) {
            Some(session) if session.profile_id == profile => Ok(Arc::clone(session)),
            // A foreign profile's session is indistinguishable from an
            // unknown one.
            Some(_) => Err(OfficeEditError::Invalid),
            None => Err(OfficeEditError::Invalid),
        }
    }

    fn begin_open(
        &self,
        document_id: Uuid,
        family: OfficeFamily,
        profile: &str,
    ) -> Result<OpenStart, OfficeEditError> {
        if document_id.is_nil() {
            return Err(OfficeEditError::Invalid);
        }
        let sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
        for session in sessions.values() {
            let state = session.snapshot()?;
            if state.document_id != document_id {
                continue;
            }
            if session.profile_id != profile || state.family != family {
                return Err(OfficeEditError::Invalid);
            }
            return Ok(OpenStart::Existing(state));
        }
        let mut pending = self.pending.lock().map_err(|_| OfficeEditError::Failed)?;
        if pending.contains(&document_id)
            || sessions.len() + pending.len() >= MAX_OFFICE_EDIT_SESSIONS
        {
            return Err(OfficeEditError::Busy);
        }
        pending.insert(document_id);
        Ok(OpenStart::New)
    }

    fn abort_open(&self, document_id: Uuid) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&document_id);
        }
    }

    fn finish_open(
        &self,
        session: Arc<OfficeEditSession>,
    ) -> Result<OfficeSessionState, OfficeEditError> {
        let state = session.snapshot()?;
        let mut sessions = self.sessions.lock().map_err(|_| OfficeEditError::Failed)?;
        let mut pending = self.pending.lock().map_err(|_| OfficeEditError::Failed)?;
        pending.remove(&state.document_id);
        if sessions.values().any(|existing| {
            existing
                .snapshot()
                .map(|value| value.document_id == state.document_id)
                .unwrap_or(true)
        }) {
            return Err(OfficeEditError::Busy);
        }
        if sessions.len() >= MAX_OFFICE_EDIT_SESSIONS
            || sessions.contains_key(&state.session_id)
        {
            return Err(OfficeEditError::Busy);
        }
        sessions.insert(state.session_id, session);
        Ok(state)
    }

    pub fn open_session(
        &self,
        input: Arc<AuthorizedOfficeInput>,
        family: OfficeFamily,
    ) -> Result<OfficeSessionState, OfficeEditError> {
        let profile = self.current_profile()?;
        if !input.is_valid() {
            return Err(OfficeEditError::Invalid);
        }
        if input.backing.granted().is_sensitive() != input.sensitive {
            return Err(OfficeEditError::Changed);
        }
        if input.sensitive
            && matches!(input.backing.granted().as_ref(), GrantedBacking::Disk { .. })
        {
            return Err(OfficeEditError::SensitiveUnsupported);
        }
        let engine = self.engine()?;
        match self.begin_open(input.document_id, family, &profile)? {
            OpenStart::Existing(state) => return Ok(state),
            OpenStart::New => {}
        }
        let binding = match engine.open(
            Arc::clone(&input),
            family,
            &OfficeSecurityPolicy::default(),
        ) {
            Ok(binding) => binding,
            Err(error) => {
                self.abort_open(input.document_id);
                return Err(error);
            }
        };
        if let Err(error) = validate_initial_state(&input, family, &binding) {
            self.abort_open(input.document_id);
            let _ = engine.close(binding.session_id);
            return Err(error);
        }
        match self.current_profile() {
            Ok(current) if current == profile => {}
            Ok(_) => {
                self.abort_open(input.document_id);
                let _ = engine.close(binding.session_id);
                return Err(OfficeEditError::Changed);
            }
            Err(error) => {
                self.abort_open(input.document_id);
                let _ = engine.close(binding.session_id);
                return Err(error);
            }
        }
        let sensitive = input.sensitive;
        let session = Arc::new(OfficeEditSession::new(
            binding.initial_state.clone(),
            profile.clone(),
            sensitive,
            input,
        ));
        match self.finish_open(session) {
            Ok(state) => {
                if self.current_profile().ok().as_deref() == Some(profile.as_str()) {
                    Ok(state)
                } else {
                    self.discard_session(state.session_id);
                    Err(OfficeEditError::Changed)
                }
            }
            Err(error) => {
                let _ = engine.close(binding.session_id);
                Err(error)
            }
        }
    }

    pub fn refresh_state(
        &self,
        session: &OfficeEditSession,
    ) -> Result<OfficeSessionState, OfficeEditError> {
        let engine = self.engine()?;
        let _guard = session.lock_mutation()?;
        let current = session.snapshot()?;
        let next = engine.state(current.session_id)?;
        crate::office_edit_transactions::validate_same_content_state(&current, &next)?;
        session.commit(current.revision, next.clone())?;
        Ok(next)
    }
}
