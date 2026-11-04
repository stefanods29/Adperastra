//! Office AI context and proposal commands (Step 20a E20-E22, shared by
//! 20c/21b/22b).
//!
//! Seven commands form the only native AI boundary of an Office session:
//! bind an immutable bounded context (`office_ai_context_start`), continue it
//! with its own cursor, release it, evaluate typed operations on a native
//! clone (`office_ai_proposal_evaluate_start`), page/release that preview,
//! mint one explicit human grant (`office_ai_proposal_confirm`) and apply the
//! already bound typed operations in one atomic transaction
//! (`office_ai_proposal_apply`).
//!
//! Nothing here generates text, uploads a document, accepts a path, a
//! whole-document flag or a caller trust override. Every record is bounded,
//! expires (context/preview 300 s, grant 60 s), is profile scoped and is
//! re-checked against the live revision, content identity and family before
//! it is used. Without the approved proposal/generation provider every start
//! fails closed with `office_ai.engine_missing`; an intent, capability or
//! request shape outside the approved scope fails with
//! `office_ai.unsupported`, `office_ai.invalid` or `office_ai.changed`.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::export_snapshot_types::{now_unix, StoragePolicy};
use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_ai_types::{
    OfficeAiContext, OfficeAiContextRequest, OfficeAiImage, OfficeAiSlideSummary, OfficeAiTextRun,
    OfficeProposalApplyRequest, OfficeProposalCalculation, OfficeProposalDiff,
    OfficeProposalIntent, OfficeProposalPreview, OfficeProposalRequest, OfficeProposalWarning,
    MAX_AI_CONTEXT_SCALARS,
};
use crate::office_edit_items::OfficeDisplayCell;
use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_types::{
    OfficeCapability, OfficeEditError, OfficeFamily, OfficeOperation, OfficeRenderPage,
    OfficeSessionState, OfficeTransaction, OfficeTransactionResult,
};
use crate::office_edit_validation::{
    operation_family_matches, selection_family, valid_transaction_label,
};
use crate::office_edit_values::OfficeStoragePolicy;
use crate::{ensure_main, valid_request_id};

/// Exact names the coordinator adds to `generate_handler!` and `ALLOWED`.
pub const COMMANDS: &[&str] = &[
    "office_ai_context_start",
    "office_ai_context_release",
    "office_ai_proposal_evaluate_start",
    "office_ai_proposal_page",
    "office_ai_proposal_release",
    "office_ai_proposal_confirm",
    "office_ai_proposal_apply",
];

/// E20/E21a: a context or clone lives 300 s unless released earlier.
const AI_GRANT_SECS: u64 = 300;
/// E22: the human Apply grant lives 60 s and is single use.
const AI_CONFIRMATION_SECS: u64 = 60;
/// D4 parity: at most four live immutable contexts, process wide.
const MAX_LIVE_CONTEXTS: usize = 4;
/// E21: at most two clones process wide.
const MAX_LIVE_PREVIEWS: usize = 2;
/// E22: bounded outstanding Apply grants.
const MAX_LIVE_GRANTS: usize = 32;

/// One context page never exceeds these bounds.
const MAX_PAGE_ITEMS: usize = 128;
const MAX_PAGE_TEXT_RUNS: usize = 64;
const MAX_PAGE_CELLS: usize = 128;
const MAX_PAGE_SLIDES: usize = 10;
const MAX_PAGE_IMAGES: usize = 2;

/// One preview page never exceeds these bounds.
const MAX_PAGE_DIFFS: usize = 64;
const MAX_PAGE_CALCULATIONS: usize = 64;
const MAX_PAGE_RENDERS: usize = 2;

/// Per-record scalar and payload caps taken from office-ai-proposal-1.
const MAX_AI_RUN_SCALARS: usize = 16_384;
const MAX_AI_SLIDE_TITLE: usize = 512;
const MAX_AI_SLIDE_NOTES: usize = 8_192;
const MAX_AI_SUMMARY_SCALARS: usize = 1_024;
const MAX_AI_DIFF_SCALARS: usize = 16_384;
const MAX_AI_ALT_SCALARS: usize = 4_096;
const MAX_AI_MESSAGE_KEY: usize = 128;
const MAX_AI_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

/// Stable `office_ai.*` codes of this boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfficeAiError {
    Invalid,
    EngineMissing,
    Unsupported,
    Changed,
    TooLarge,
    Busy,
    Cancelled,
    Timeout,
    SensitiveUnsupported,
    ProposalExpired,
    ContextLimit,
    FormulaUnsafe,
    CalculationFailed,
    ConfirmationRequired,
    Failed,
}

impl OfficeAiError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "office_ai.invalid",
            Self::EngineMissing => "office_ai.engine_missing",
            Self::Unsupported => "office_ai.unsupported",
            Self::Changed => "office_ai.changed",
            Self::TooLarge => "office_ai.too_large",
            Self::Busy => "office_ai.busy",
            Self::Cancelled => "office_ai.cancelled",
            Self::Timeout => "office_ai.timeout",
            Self::SensitiveUnsupported => "office_ai.sensitive_unsupported",
            Self::ProposalExpired => "office_ai.proposal_expired",
            Self::ContextLimit => "office_ai.context_limit",
            Self::FormulaUnsafe => "office_ai.formula_unsafe",
            Self::CalculationFailed => "office_ai.calculation_failed",
            Self::ConfirmationRequired => "office_ai.confirmation_required",
            Self::Failed => "office_ai.failed",
        }
    }

    /// Keep one stable namespace for consumers while the shared editing codes
    /// stay `office_edit.*`.
    fn from_edit(error: OfficeEditError) -> Self {
        match error {
            OfficeEditError::Invalid => Self::Invalid,
            OfficeEditError::EngineMissing => Self::EngineMissing,
            OfficeEditError::Unsupported | OfficeEditError::ReadOnly => Self::Unsupported,
            OfficeEditError::Changed => Self::Changed,
            OfficeEditError::TooLarge => Self::TooLarge,
            OfficeEditError::Busy => Self::Busy,
            OfficeEditError::Cancelled => Self::Cancelled,
            OfficeEditError::Timeout => Self::Timeout,
            OfficeEditError::PreservationFailed => Self::Failed,
            OfficeEditError::SensitiveUnsupported => Self::SensitiveUnsupported,
            OfficeEditError::Failed => Self::Failed,
            OfficeEditError::ProposalExpired => Self::ProposalExpired,
            OfficeEditError::ContextLimit => Self::ContextLimit,
            OfficeEditError::FormulaUnsafe => Self::FormulaUnsafe,
            OfficeEditError::CalculationFailed => Self::CalculationFailed,
            OfficeEditError::ConfirmationRequired => Self::ConfirmationRequired,
        }
    }
}

fn code(error: OfficeAiError) -> String {
    error.code().to_string()
}

fn parse_id(value: &str) -> Result<Uuid, String> {
    let parsed = Uuid::parse_str(value).map_err(|_| code(OfficeAiError::Invalid))?;
    if parsed.is_nil() {
        return Err(code(OfficeAiError::Invalid));
    }
    Ok(parsed)
}

/// The approved Office AI proposal/generation adapter. There is no default
/// implementation and no in-process fake: while `OfficeAiState` holds no
/// provider every AI start fails closed with `office_ai.engine_missing`.
///
/// The adapter owns its clone, formula calculation and render work. The
/// release hooks let it destroy clones and leases when the native record is
/// released, expires or is applied; they must never touch the live session.
pub trait OfficeAiProposalProvider: Send + Sync {
    /// E20: exact immutable bounded context of one live session.
    fn capture_context(
        &self,
        session_id: Uuid,
        state: &OfficeSessionState,
        request: &OfficeAiContextRequest,
    ) -> Result<OfficeAiContext, OfficeEditError>;

    /// E21: evaluate typed operations on a clone of the bound context.
    fn evaluate(
        &self,
        context: &OfficeAiContext,
        request: &OfficeProposalRequest,
    ) -> Result<OfficeProposalPreview, OfficeEditError>;

    /// E21a: destroy the clone/leases of one released context.
    fn release_context(&self, _context_id: Uuid) {}

    /// E21a: destroy the clone/leases of one released or applied preview.
    fn release_preview(&self, _preview_id: Uuid) {}
}

struct ContextRecord {
    profile_id: String,
    /// The complete bounded capture; pages are slices of it.
    context: OfficeAiContext,
    next_offset: usize,
    cursor: Option<Uuid>,
    max_scalars: u32,
    include_images: bool,
}

struct PreviewRecord {
    profile_id: String,
    session_id: Uuid,
    family: OfficeFamily,
    revision: u64,
    content_id: Uuid,
    intent: OfficeProposalIntent,
    operations: Vec<OfficeOperation>,
    label_key: String,
    diffs: Vec<OfficeProposalDiff>,
    calculations: Vec<OfficeProposalCalculation>,
    renders: Vec<OfficeRenderPage>,
    /// Identity, warnings and expiry shared by every page of this preview.
    preview: OfficeProposalPreview,
    next_offset: usize,
    cursor: Option<Uuid>,
}

struct GrantRecord {
    preview_id: Uuid,
    session_id: Uuid,
    revision: u64,
    content_id: Uuid,
    expires_unix: u64,
    used: bool,
}

/// Native confirmation grant returned to the reviewed Apply gesture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiConfirmation {
    pub human_confirmation_id: Uuid,
    pub expires_unix: u64,
}

/// Managed app state. `main.rs` registers `Default`; only the approved binding
/// task calls `install_provider`.
pub struct OfficeAiState {
    provider: RwLock<Option<Arc<dyn OfficeAiProposalProvider>>>,
    contexts: Mutex<HashMap<Uuid, ContextRecord>>,
    previews: Mutex<HashMap<Uuid, PreviewRecord>>,
    grants: Mutex<HashMap<Uuid, GrantRecord>>,
}

impl Default for OfficeAiState {
    fn default() -> Self {
        Self::new()
    }
}

impl OfficeAiState {
    pub fn new() -> Self {
        Self {
            provider: RwLock::new(None),
            contexts: Mutex::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
            grants: Mutex::new(HashMap::new()),
        }
    }

    pub fn install_provider(
        &self,
        provider: Arc<dyn OfficeAiProposalProvider>,
    ) -> Result<(), OfficeAiError> {
        let mut slot = self.provider.write().map_err(|_| OfficeAiError::Failed)?;
        if slot.is_some() {
            return Err(OfficeAiError::Busy);
        }
        *slot = Some(provider);
        Ok(())
    }

    pub fn has_provider(&self) -> bool {
        self.provider
            .read()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }

    fn provider(&self) -> Result<Arc<dyn OfficeAiProposalProvider>, OfficeAiError> {
        self.provider
            .read()
            .map_err(|_| OfficeAiError::Failed)?
            .clone()
            .ok_or(OfficeAiError::EngineMissing)
    }

    fn remove_grants_for(&self, preview_id: Uuid) {
        if let Ok(mut grants) = self.grants.lock() {
            grants.retain(|_, grant| grant.preview_id != preview_id);
        }
    }

    /// Forget the grants and let the provider destroy the clone/leases of one
    /// preview that is being applied, released or evicted.
    fn release_clone(&self, preview_id: Uuid) {
        self.remove_grants_for(preview_id);
        if let Ok(provider) = self.provider() {
            provider.release_preview(preview_id);
        }
    }

    /// Drop every expired record and let the provider destroy its clones.
    fn purge(&self, now: u64) {
        let mut expired_contexts = Vec::new();
        let mut expired_previews = Vec::new();
        if let Ok(mut contexts) = self.contexts.lock() {
            let expired: Vec<Uuid> = contexts
                .iter()
                .filter(|(_, record)| record.context.expires_unix <= now)
                .map(|(id, _)| *id)
                .collect();
            for id in expired {
                contexts.remove(&id);
                expired_contexts.push(id);
            }
        }
        if let Ok(mut previews) = self.previews.lock() {
            let expired: Vec<Uuid> = previews
                .iter()
                .filter(|(_, record)| record.preview.expires_unix <= now)
                .map(|(id, _)| *id)
                .collect();
            for id in expired {
                previews.remove(&id);
                expired_previews.push(id);
            }
        }
        if let Ok(mut grants) = self.grants.lock() {
            grants.retain(|_, grant| grant.expires_unix > now && !grant.used);
        }
        if let Ok(provider) = self.provider() {
            for id in expired_contexts {
                provider.release_context(id);
            }
            for id in expired_previews {
                self.remove_grants_for(id);
                provider.release_preview(id);
            }
        }
    }

    /// E20: capture or continue one immutable bounded context.
    fn capture(
        &self,
        profile: &str,
        session_id: Uuid,
        sensitive: bool,
        state: &OfficeSessionState,
        request: &OfficeAiContextRequest,
    ) -> Result<OfficeAiContext, OfficeAiError> {
        let now = now_unix();
        self.purge(now);
        if request.cursor.is_some() {
            return self.continue_context(profile, session_id, state, request, now);
        }
        let provider = self.provider()?;
        let mut context = provider
            .capture_context(session_id, state, request)
            .map_err(OfficeAiError::from_edit)?;
        validate_context(&context, state, session_id, sensitive, request, now)?;
        context.expires_unix = now + AI_GRANT_SECS;
        // The retained record is the complete capture; pages carry the cursor.
        context.next_cursor = None;
        context.complete = true;
        let context_id = context.context_id;
        let mut contexts = self.contexts.lock().map_err(|_| OfficeAiError::Failed)?;
        if contexts.contains_key(&context_id) {
            return Err(OfficeAiError::Invalid);
        }
        let mut evicted = Vec::new();
        while contexts.len() >= MAX_LIVE_CONTEXTS {
            let oldest = contexts
                .iter()
                .min_by_key(|(_, record)| record.context.expires_unix)
                .map(|(id, _)| *id);
            match oldest {
                Some(id) => {
                    contexts.remove(&id);
                    evicted.push(id);
                }
                None => break,
            }
        }
        contexts.insert(
            context_id,
            ContextRecord {
                profile_id: profile.to_string(),
                context,
                next_offset: 0,
                cursor: None,
                max_scalars: request.max_scalars,
                include_images: request.include_images,
            },
        );
        let page = {
            let record = contexts
                .get_mut(&context_id)
                .ok_or(OfficeAiError::Failed)?;
            context_page(record)?
        };
        drop(contexts);
        if let Ok(provider) = self.provider() {
            for id in evicted {
                provider.release_context(id);
            }
        }
        Ok(page)
    }

    fn continue_context(
        &self,
        profile: &str,
        session_id: Uuid,
        state: &OfficeSessionState,
        request: &OfficeAiContextRequest,
        now: u64,
    ) -> Result<OfficeAiContext, OfficeAiError> {
        let cursor = request.cursor.ok_or(OfficeAiError::Invalid)?;
        let mut contexts = self.contexts.lock().map_err(|_| OfficeAiError::Failed)?;
        let record = contexts
            .values_mut()
            .find(|record| record.cursor == Some(cursor))
            .ok_or(OfficeAiError::Invalid)?;
        if record.profile_id != profile
            || record.context.session_id != session_id
            || record.context.session_id != state.session_id
            || record.context.revision != state.revision
            || record.context.content_id != state.content_id
            || record.context.selection != request.selection
            || record.context.family != state.family
            || record.max_scalars != request.max_scalars
            || record.include_images != request.include_images
        {
            return Err(OfficeAiError::Changed);
        }
        if now > record.context.expires_unix {
            return Err(OfficeAiError::ProposalExpired);
        }
        context_page(record)
    }

    /// E21: evaluate typed operations on the bound context.
    fn evaluate(
        &self,
        profile: &str,
        session_id: Uuid,
        sensitive: bool,
        state: &OfficeSessionState,
        request: &OfficeProposalRequest,
    ) -> Result<OfficeProposalPreview, OfficeAiError> {
        let now = now_unix();
        self.purge(now);
        proposal_scope_matches(state, request)?;
        let context = {
            let contexts = self.contexts.lock().map_err(|_| OfficeAiError::Failed)?;
            let record = contexts
                .get(&request.context_id)
                .ok_or(OfficeAiError::Invalid)?;
            if record.profile_id != profile
                || record.context.session_id != session_id
                || record.context.session_id != state.session_id
                || record.context.family != state.family
            {
                return Err(OfficeAiError::Invalid);
            }
            if now > record.context.expires_unix {
                return Err(OfficeAiError::ProposalExpired);
            }
            if record.context.revision != request.expected_revision
                || record.context.content_id != request.expected_content_id
                || selection_family(&record.context.selection) != family_of_intent(request.intent)
            {
                return Err(OfficeAiError::Changed);
            }
            record.context.clone()
        };
        let provider = self.provider()?;
        let mut preview = provider
            .evaluate(&context, request)
            .map_err(OfficeAiError::from_edit)?;
        validate_preview(&preview, &context, request, sensitive)?;
        preview.preview_id = Uuid::new_v4();
        preview.expires_unix = now + AI_GRANT_SECS;
        preview.next_cursor = None;
        preview.complete = true;
        let preview_id = preview.preview_id;
        let evicted = {
            let mut previews = self.previews.lock().map_err(|_| OfficeAiError::Failed)?;
            if previews.contains_key(&preview_id) {
                return Err(OfficeAiError::Invalid);
            }
            if previews.len() >= MAX_LIVE_PREVIEWS {
                let oldest = previews
                    .iter()
                    .min_by_key(|(_, record)| record.preview.expires_unix)
                    .map(|(id, _)| *id);
                match oldest {
                    Some(id) => {
                        previews.remove(&id);
                        Some(id)
                    }
                    None => None,
                }
            } else {
                None
            }
        };
        if let Some(id) = evicted {
            self.release_clone(id);
        }
        let mut base = preview.clone();
        base.diffs = Vec::new();
        base.calculations = Vec::new();
        base.renders = Vec::new();
        let record = PreviewRecord {
            profile_id: profile.to_string(),
            session_id,
            family: state.family,
            revision: request.expected_revision,
            content_id: request.expected_content_id,
            intent: request.intent,
            operations: request.operations.clone(),
            label_key: request.label_key.clone(),
            diffs: preview.diffs,
            calculations: preview.calculations,
            renders: preview.renders,
            preview: base,
            next_offset: 0,
            cursor: None,
        };
        let mut previews = self.previews.lock().map_err(|_| OfficeAiError::Failed)?;
        if previews.len() >= MAX_LIVE_PREVIEWS {
            return Err(OfficeAiError::Busy);
        }
        previews.insert(preview_id, record);
        let record = previews.get_mut(&preview_id).ok_or(OfficeAiError::Failed)?;
        preview_page(record)
    }

    /// E21a: one bounded, sequential page of the retained preview.
    fn page(
        &self,
        profile: &str,
        preview_id: Uuid,
        cursor: Uuid,
    ) -> Result<OfficeProposalPreview, OfficeAiError> {
        let now = now_unix();
        self.purge(now);
        let mut previews = self.previews.lock().map_err(|_| OfficeAiError::Failed)?;
        let record = previews.get_mut(&preview_id).ok_or(OfficeAiError::Invalid)?;
        if record.profile_id != profile {
            return Err(OfficeAiError::Invalid);
        }
        if now > record.preview.expires_unix {
            return Err(OfficeAiError::ProposalExpired);
        }
        if record.cursor != Some(cursor) {
            return Err(OfficeAiError::Invalid);
        }
        preview_page(record)
    }

    /// E22: mint one single-use human grant for a fully reviewed preview.
    fn confirm(
        &self,
        profile: &str,
        preview_id: Uuid,
    ) -> Result<OfficeAiConfirmation, OfficeAiError> {
        let now = now_unix();
        self.purge(now);
        let (session_id, revision, content_id) = {
            let previews = self.previews.lock().map_err(|_| OfficeAiError::Failed)?;
            let record = previews.get(&preview_id).ok_or(OfficeAiError::Invalid)?;
            if record.profile_id != profile {
                return Err(OfficeAiError::Invalid);
            }
            if now > record.preview.expires_unix {
                return Err(OfficeAiError::ProposalExpired);
            }
            // Apply needs the review to have reached the last page.
            if record.cursor.is_some() || !record.preview.can_apply {
                return Err(OfficeAiError::ConfirmationRequired);
            }
            if record.preview.warnings.iter().any(is_stale) {
                return Err(OfficeAiError::Changed);
            }
            (record.session_id, record.revision, record.content_id)
        };
        let human_confirmation_id = Uuid::new_v4();
        let expires_unix = now + AI_CONFIRMATION_SECS;
        let mut grants = self.grants.lock().map_err(|_| OfficeAiError::Failed)?;
        grants.retain(|_, grant| grant.expires_unix > now && !grant.used);
        if grants.len() >= MAX_LIVE_GRANTS {
            return Err(OfficeAiError::Busy);
        }
        grants.insert(
            human_confirmation_id,
            GrantRecord {
                preview_id,
                session_id,
                revision,
                content_id,
                expires_unix,
                used: false,
            },
        );
        Ok(OfficeAiConfirmation {
            human_confirmation_id,
            expires_unix,
        })
    }

    /// E22: commit the bound typed operations in one atomic transaction.
    fn apply(
        &self,
        profile: &str,
        edit: &OfficeEditState,
        request: &OfficeProposalApplyRequest,
    ) -> Result<OfficeTransactionResult, OfficeAiError> {
        request
            .validate()
            .map_err(OfficeAiError::from_edit)?;
        let now = now_unix();
        self.purge(now);
        let (session_id, family, revision, content_id, operations, label_key) = {
            let previews = self.previews.lock().map_err(|_| OfficeAiError::Failed)?;
            let record = previews
                .get(&request.preview_id)
                .ok_or(OfficeAiError::Invalid)?;
            if record.profile_id != profile {
                return Err(OfficeAiError::Invalid);
            }
            if now > record.preview.expires_unix {
                return Err(OfficeAiError::ProposalExpired);
            }
            if record.revision != request.expected_revision
                || record.content_id != request.expected_content_id
            {
                return Err(OfficeAiError::Changed);
            }
            if record.cursor.is_some() || !record.preview.can_apply {
                return Err(OfficeAiError::ConfirmationRequired);
            }
            if record.preview.warnings.iter().any(is_stale) {
                return Err(OfficeAiError::Changed);
            }
            let mut acknowledged = request.acknowledged_warning_ids.clone();
            acknowledged.sort();
            acknowledged.dedup();
            let mut expected: Vec<Uuid> =
                record.preview.warnings.iter().map(warning_id).collect();
            expected.sort();
            expected.dedup();
            if acknowledged != expected {
                return Err(OfficeAiError::ConfirmationRequired);
            }
            (
                record.session_id,
                record.family,
                record.revision,
                record.content_id,
                record.operations.clone(),
                record.label_key.clone(),
            )
        };
        let transaction = OfficeTransaction {
            transaction_id: request.transaction_id,
            expected_revision: revision,
            operations,
            selection_after: None,
            label_key,
        };
        transaction.validate().map_err(OfficeAiError::from_edit)?;
        let session = edit
            .session(session_id)
            .map_err(OfficeAiError::from_edit)?;
        let current = session.snapshot().map_err(OfficeAiError::from_edit)?;
        if current.busy {
            return Err(OfficeAiError::Busy);
        }
        if !current.ready
            || current.session_id != session_id
            || current.family != family
        {
            return Err(OfficeAiError::Changed);
        }
        if current.revision != revision || current.content_id != content_id {
            return Err(OfficeAiError::Changed);
        }
        if !current
            .capabilities
            .contains(&OfficeCapability::ProposalApply)
        {
            return Err(OfficeAiError::Unsupported);
        }
        let fingerprint = crate::office_edit_transactions::transaction_fingerprint(
            session_id,
            &transaction,
        )
        .map_err(OfficeAiError::from_edit)?;
        // A duplicate transaction id with the identical intent replays the
        // retained receipt and never reapplies anything.
        if let Some(receipt) = session
            .lookup_transaction(request.transaction_id, &fingerprint)
            .map_err(OfficeAiError::from_edit)?
        {
            return Ok(receipt);
        }
        {
            let mut grants = self.grants.lock().map_err(|_| OfficeAiError::Failed)?;
            let expired = grants
                .get(&request.human_confirmation_id)
                .is_some_and(|grant| now > grant.expires_unix);
            if expired {
                grants.remove(&request.human_confirmation_id);
                return Err(OfficeAiError::ConfirmationRequired);
            }
            let grant = grants
                .get(&request.human_confirmation_id)
                .ok_or(OfficeAiError::ConfirmationRequired)?;
            if grant.preview_id != request.preview_id
                || grant.session_id != session_id
                || grant.revision != revision
                || grant.content_id != content_id
                || grant.used
            {
                return Err(OfficeAiError::ConfirmationRequired);
            }
            if let Some(grant) = grants.get_mut(&request.human_confirmation_id) {
                grant.used = true;
            }
        }
        let result = crate::office_edit_dispatch::transact(edit, session_id, transaction)
            .map_err(OfficeAiError::from_edit)?;
        // The clone/leases and the grant are gone; the bounded reviewed
        // metadata stays until expiry or release so an identical duplicate
        // transaction id can still replay the retained receipt.
        self.release_clone(request.preview_id);
        Ok(result)
    }

    /// Idempotent release of one context; a foreign profile is unknown.
    fn release_context(&self, profile: &str, context_id: Uuid) {
        let owned = match self.contexts.lock() {
            Ok(contexts) => contexts
                .get(&context_id)
                .is_some_and(|record| record.profile_id == profile),
            Err(_) => return,
        };
        if !owned {
            return;
        }
        match self.contexts.lock() {
            Ok(mut contexts) => {
                contexts.remove(&context_id);
            }
            Err(_) => return,
        }
        if let Ok(provider) = self.provider() {
            provider.release_context(context_id);
        }
    }

    /// Idempotent release of one preview and its grants.
    fn release_preview(&self, profile: &str, preview_id: Uuid) {
        let owned = match self.previews.lock() {
            Ok(previews) => previews
                .get(&preview_id)
                .is_some_and(|record| record.profile_id == profile),
            Err(_) => return,
        };
        if !owned {
            return;
        }
        match self.previews.lock() {
            Ok(mut previews) => {
                previews.remove(&preview_id);
            }
            Err(_) => return,
        }
        self.release_clone(preview_id);
    }
}

fn family_of_intent(intent: OfficeProposalIntent) -> OfficeFamily {
    match intent {
        OfficeProposalIntent::DocumentRewrite
        | OfficeProposalIntent::DocumentInsert
        | OfficeProposalIntent::ImageAlt => OfficeFamily::Document,
        OfficeProposalIntent::SheetFormula
        | OfficeProposalIntent::SheetClean
        | OfficeProposalIntent::SheetChart => OfficeFamily::Sheet,
        OfficeProposalIntent::DeckCreate
        | OfficeProposalIntent::DeckAdd
        | OfficeProposalIntent::DeckShorten
        | OfficeProposalIntent::DeckNotes
        | OfficeProposalIntent::DeckLayout => OfficeFamily::Deck,
    }
}

fn context_selection_family(context: &OfficeAiContext) -> OfficeFamily {
    selection_family(&context.selection)
}

fn is_stale(warning: &OfficeProposalWarning) -> bool {
    matches!(warning, OfficeProposalWarning::Stale { .. })
}

fn warning_id(warning: &OfficeProposalWarning) -> Uuid {
    match warning {
        OfficeProposalWarning::Overflow { id, .. }
        | OfficeProposalWarning::FormattingLoss { id, .. }
        | OfficeProposalWarning::Unsupported { id, .. }
        | OfficeProposalWarning::TruncatedContext { id, .. }
        | OfficeProposalWarning::FormulaError { id, .. }
        | OfficeProposalWarning::Stale { id, .. } => *id,
    }
}

fn warning_key(warning: &OfficeProposalWarning) -> &str {
    match warning {
        OfficeProposalWarning::Overflow { message_key, .. }
        | OfficeProposalWarning::FormattingLoss { message_key, .. }
        | OfficeProposalWarning::Unsupported { message_key, .. }
        | OfficeProposalWarning::TruncatedContext { message_key, .. }
        | OfficeProposalWarning::FormulaError { message_key, .. }
        | OfficeProposalWarning::Stale { message_key, .. } => message_key,
    }
}

fn valid_message_key(key: &str) -> bool {
    !key.is_empty() && key.chars().count() <= MAX_AI_MESSAGE_KEY
}

fn require_capability(
    state: &OfficeSessionState,
    capability: OfficeCapability,
) -> Result<(), String> {
    if !state.capabilities.contains(&capability) {
        return Err(code(OfficeAiError::Unsupported));
    }
    Ok(())
}

fn context_scope_matches(
    state: &OfficeSessionState,
    session_id: Uuid,
    request: &OfficeAiContextRequest,
) -> Result<(), OfficeAiError> {
    if state.session_id != session_id || !state.ready {
        return Err(OfficeAiError::Changed);
    }
    if state.revision != request.expected_revision
        || state.content_id != request.expected_content_id
    {
        return Err(OfficeAiError::Changed);
    }
    if selection_family(&request.selection) != state.family {
        return Err(OfficeAiError::Invalid);
    }
    Ok(())
}

fn proposal_scope_matches(
    state: &OfficeSessionState,
    request: &OfficeProposalRequest,
) -> Result<(), OfficeAiError> {
    if !state.ready {
        return Err(OfficeAiError::Changed);
    }
    if state.revision != request.expected_revision
        || state.content_id != request.expected_content_id
    {
        return Err(OfficeAiError::Changed);
    }
    if family_of_intent(request.intent) != state.family
        || request
            .operations
            .iter()
            .any(|operation| !operation_family_matches(operation, state.family))
    {
        return Err(OfficeAiError::Invalid);
    }
    Ok(())
}

fn validate_context_cell(cell: &OfficeDisplayCell) -> Result<(), OfficeAiError> {
    if !cell.address.is_valid()
        || cell.display.encode_utf16().count() > 32_767
        || !cell.input.is_valid()
        || (!cell.format.is_empty() && !cell.format.is_valid())
        || cell
            .merged_range
            .as_ref()
            .is_some_and(|merged| !merged.is_valid())
        || cell
            .error_code
            .as_deref()
            .is_some_and(|value| value.is_empty() || value.len() > 64)
    {
        return Err(OfficeAiError::Invalid);
    }
    Ok(())
}

/// E20: every value of one capture is bounded and belongs to the exact bound
/// revision, content identity, selection and family.
fn validate_context(
    context: &OfficeAiContext,
    state: &OfficeSessionState,
    session_id: Uuid,
    sensitive: bool,
    request: &OfficeAiContextRequest,
    now: u64,
) -> Result<(), OfficeAiError> {
    if !context.is_valid() {
        return Err(OfficeAiError::Invalid);
    }
    if context.session_id != session_id
        || context.session_id != state.session_id
        || context.revision != state.revision
        || context.revision != request.expected_revision
        || context.content_id != state.content_id
        || context.content_id != request.expected_content_id
        || context.selection != request.selection
        || context.family != state.family
    {
        return Err(OfficeAiError::Changed);
    }
    if selection_family(&context.selection) != context.family {
        return Err(OfficeAiError::Invalid);
    }
    if context.expires_unix > now + AI_GRANT_SECS {
        return Err(OfficeAiError::TooLarge);
    }
    // Family-inapplicable arrays stay empty.
    match context.family {
        OfficeFamily::Document => {
            if !context.cells.is_empty() || !context.slides.is_empty() {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeFamily::Sheet => {
            if !context.text_runs.is_empty()
                || !context.slides.is_empty()
                || !context.images.is_empty()
            {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeFamily::Deck => {
            if !context.cells.is_empty() {
                return Err(OfficeAiError::Invalid);
            }
        }
    }
    let mut scalars = 0usize;
    for run in &context.text_runs {
        if run.id.is_nil()
            || !run.span.is_current(context.revision)
            || !run.format.is_valid()
            || !run.paragraph.is_valid()
            || run.style_id.is_some_and(|id| id.is_nil())
            || run.text.chars().count() > MAX_AI_RUN_SCALARS
            || run.text.chars().any(char::is_control)
        {
            return Err(OfficeAiError::Invalid);
        }
        scalars = scalars.saturating_add(run.text.chars().count());
    }
    if scalars > request.max_scalars as usize || scalars > MAX_AI_CONTEXT_SCALARS as usize {
        return Err(OfficeAiError::ContextLimit);
    }
    for cell in &context.cells {
        validate_context_cell(cell)?;
    }
    for slide in &context.slides {
        if slide.slide_id.is_nil()
            || slide.layout_id.is_nil()
            || slide.title.chars().count() > MAX_AI_SLIDE_TITLE
            || slide.notes.chars().count() > MAX_AI_SLIDE_NOTES
        {
            return Err(OfficeAiError::Invalid);
        }
    }
    for image in &context.images {
        if image.id.is_nil()
            || !image.selection.is_valid()
            || selection_family(&image.selection) != context.family
            || image.alt.chars().count() > MAX_AI_ALT_SCALARS
            || image.width_pt <= 0.0
            || image.height_pt <= 0.0
        {
            return Err(OfficeAiError::Invalid);
        }
        let snapshot = &image.snapshot;
        let document_id = Uuid::parse_str(&snapshot.document_id)
            .map_err(|_| OfficeAiError::Invalid)?;
        if document_id != state.document_id {
            return Err(OfficeAiError::Changed);
        }
        if snapshot.revision != context.revision || snapshot.content_id != context.content_id {
            return Err(OfficeAiError::Changed);
        }
        if !snapshot.mime.starts_with("image/")
            || snapshot.byte_len == 0
            || snapshot.byte_len > MAX_AI_IMAGE_BYTES
        {
            return Err(OfficeAiError::Invalid);
        }
        // A path or source stamp never enters the AI context.
        if snapshot.source.is_some() {
            return Err(OfficeAiError::Unsupported);
        }
        if snapshot.expires_unix <= now {
            return Err(OfficeAiError::ProposalExpired);
        }
        let expected = if sensitive {
            StoragePolicy::Sensitive
        } else {
            StoragePolicy::Ordinary
        };
        if snapshot.storage_policy != expected {
            return Err(OfficeAiError::SensitiveUnsupported);
        }
    }
    Ok(())
}

fn validate_diff(
    diff: &OfficeProposalDiff,
    revision: u64,
) -> Result<(), OfficeAiError> {
    match diff {
        OfficeProposalDiff::Text {
            span, before, after, ..
        } => {
            if !span.is_current(revision)
                || before.chars().count() > MAX_AI_DIFF_SCALARS
                || after.chars().count() > MAX_AI_DIFF_SCALARS
                || before.chars().any(char::is_control)
                || after.chars().any(char::is_control)
            {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalDiff::ImageAlt {
            image_id,
            before,
            after,
        } => {
            if image_id.is_nil()
                || before.chars().count() > MAX_AI_ALT_SCALARS
                || after.chars().count() > MAX_AI_ALT_SCALARS
                || before.chars().any(char::is_control)
                || after.chars().any(char::is_control)
            {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalDiff::Cell {
            address,
            before,
            after,
            before_display,
            after_display,
        } => {
            if !address.is_valid()
                || !before.is_valid()
                || !after.is_valid()
                || before_display.encode_utf16().count() > 32_767
                || after_display.encode_utf16().count() > 32_767
            {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalDiff::Slide {
            slide_id,
            before_summary,
            after_summary,
            ..
        } => {
            if slide_id.is_nil()
                || before_summary.chars().count() > MAX_AI_SUMMARY_SCALARS
                || after_summary.chars().count() > MAX_AI_SUMMARY_SCALARS
            {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalDiff::Chart {
            chart_id, source, ..
        } => {
            if chart_id.is_nil() || !source.is_valid() {
                return Err(OfficeAiError::Invalid);
            }
        }
    }
    Ok(())
}

fn validate_warning(warning: &OfficeProposalWarning) -> Result<(), OfficeAiError> {
    if warning_id(warning).is_nil() || !valid_message_key(warning_key(warning)) {
        return Err(OfficeAiError::Invalid);
    }
    match warning {
        OfficeProposalWarning::Overflow { object_id, .. }
        | OfficeProposalWarning::FormattingLoss { object_id, .. } => {
            if object_id.is_nil() {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalWarning::Unsupported { feature_id, .. } => {
            if feature_id.is_empty() || feature_id.chars().count() > 128 {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalWarning::FormulaError { address, .. } => {
            if !address.is_valid() {
                return Err(OfficeAiError::Invalid);
            }
        }
        OfficeProposalWarning::Stale { .. }
        | OfficeProposalWarning::TruncatedContext { .. } => {}
    }
    Ok(())
}

/// E21: only actual engine diffs, calculations and renders of the exact bound
/// context reach the browser.
fn validate_preview(
    preview: &OfficeProposalPreview,
    context: &OfficeAiContext,
    request: &OfficeProposalRequest,
    sensitive: bool,
) -> Result<(), OfficeAiError> {
    if !preview.is_valid() {
        return Err(OfficeAiError::Invalid);
    }
    if preview.context_id != context.context_id
        || preview.session_id != context.session_id
        || preview.revision != context.revision
        || preview.revision != request.expected_revision
        || preview.content_id != context.content_id
        || preview.content_id != request.expected_content_id
        || preview.intent != request.intent
        || context_selection_family(context) != family_of_intent(request.intent)
    {
        return Err(OfficeAiError::Changed);
    }
    let mut warning_ids = Vec::with_capacity(preview.warnings.len());
    for warning in &preview.warnings {
        validate_warning(warning)?;
        let id = warning_id(warning);
        if warning_ids.contains(&id) {
            return Err(OfficeAiError::Invalid);
        }
        warning_ids.push(id);
    }
    for diff in &preview.diffs {
        validate_diff(diff, preview.revision)?;
    }
    for calculation in &preview.calculations {
        if !calculation.is_valid() {
            return Err(OfficeAiError::Invalid);
        }
    }
    for render in &preview.renders {
        if !render.is_valid() || render.session_id != preview.session_id {
            return Err(OfficeAiError::Invalid);
        }
        if sensitive && render.image.storage_policy != OfficeStoragePolicy::Sensitive {
            return Err(OfficeAiError::SensitiveUnsupported);
        }
    }
    Ok(())
}

/// One bounded, sequential context page. `record.cursor` is the only valid
/// continuation token, so a caller can never re-read an earlier page.
fn context_page(record: &mut ContextRecord) -> Result<OfficeAiContext, OfficeAiError> {
    let base = &record.context;
    let total =
        base.text_runs.len() + base.cells.len() + base.slides.len() + base.images.len();
    let offset = record.next_offset;
    if offset > total {
        return Err(OfficeAiError::Failed);
    }
    let mut cursor = offset;
    let mut budget = MAX_PAGE_ITEMS;
    let mut text_runs: Vec<OfficeAiTextRun> = Vec::new();
    while cursor < base.text_runs.len() && text_runs.len() < MAX_PAGE_TEXT_RUNS && budget > 0 {
        text_runs.push(base.text_runs[cursor].clone());
        cursor += 1;
        budget -= 1;
    }
    let cell_start = base.text_runs.len();
    let mut cell_index = cursor.saturating_sub(cell_start);
    let mut cells: Vec<OfficeDisplayCell> = Vec::new();
    while cursor >= cell_start && cell_index < base.cells.len() && cells.len() < MAX_PAGE_CELLS && budget > 0
    {
        cells.push(base.cells[cell_index].clone());
        cursor += 1;
        cell_index += 1;
        budget -= 1;
    }
    let slide_start = cell_start + base.cells.len();
    let mut slide_index = cursor.saturating_sub(slide_start);
    let mut slides: Vec<OfficeAiSlideSummary> = Vec::new();
    while cursor >= slide_start && slide_index < base.slides.len() && slides.len() < MAX_PAGE_SLIDES && budget > 0
    {
        slides.push(base.slides[slide_index].clone());
        cursor += 1;
        slide_index += 1;
        budget -= 1;
    }
    let image_start = slide_start + base.slides.len();
    let mut image_index = cursor.saturating_sub(image_start);
    let mut images: Vec<OfficeAiImage> = Vec::new();
    while cursor >= image_start && image_index < base.images.len() && images.len() < MAX_PAGE_IMAGES && budget > 0
    {
        images.push(base.images[image_index].clone());
        cursor += 1;
        image_index += 1;
        budget -= 1;
    }
    let complete = cursor >= total;
    let next_cursor = if complete { None } else { Some(Uuid::new_v4()) };
    let page = OfficeAiContext {
        text_runs,
        cells,
        slides,
        images,
        next_cursor,
        complete,
        ..base.clone()
    };
    if !page.is_valid() {
        return Err(OfficeAiError::Failed);
    }
    record.next_offset = cursor;
    record.cursor = next_cursor;
    Ok(page)
}

/// One bounded, sequential preview page; diffs, calculations and renders are
/// paged independently and never truncated below their per-page caps.
fn preview_page(record: &mut PreviewRecord) -> Result<OfficeProposalPreview, OfficeAiError> {
    let total = record.diffs.len() + record.calculations.len() + record.renders.len();
    let offset = record.next_offset;
    if offset > total {
        return Err(OfficeAiError::Failed);
    }
    let mut cursor = offset;
    let mut budget = MAX_PAGE_ITEMS;
    let mut diffs: Vec<OfficeProposalDiff> = Vec::new();
    while cursor < record.diffs.len() && diffs.len() < MAX_PAGE_DIFFS && budget > 0 {
        diffs.push(record.diffs[cursor].clone());
        cursor += 1;
        budget -= 1;
    }
    let calculation_start = record.diffs.len();
    let mut calculation_index = cursor.saturating_sub(calculation_start);
    let mut calculations: Vec<OfficeProposalCalculation> = Vec::new();
    while cursor >= calculation_start
        && calculation_index < record.calculations.len()
        && calculations.len() < MAX_PAGE_CALCULATIONS
        && budget > 0
    {
        calculations.push(record.calculations[calculation_index].clone());
        cursor += 1;
        calculation_index += 1;
        budget -= 1;
    }
    let render_start = calculation_start + record.calculations.len();
    let mut render_index = cursor.saturating_sub(render_start);
    let mut renders: Vec<OfficeRenderPage> = Vec::new();
    while cursor >= render_start
        && render_index < record.renders.len()
        && renders.len() < MAX_PAGE_RENDERS
        && budget > 0
    {
        renders.push(record.renders[render_index].clone());
        cursor += 1;
        render_index += 1;
        budget -= 1;
    }
    let complete = cursor >= total;
    let next_cursor = if complete { None } else { Some(Uuid::new_v4()) };
    let page = OfficeProposalPreview {
        diffs,
        calculations,
        renders,
        next_cursor,
        complete,
        ..record.preview.clone()
    };
    if !page.is_valid() {
        return Err(OfficeAiError::Failed);
    }
    record.next_offset = cursor;
    record.cursor = next_cursor;
    Ok(page)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_ai_context_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    request_id: String,
    session_id: String,
    request: OfficeAiContextRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeAiError::Invalid))?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let session_id = parse_id(&session_id)?;
    request
        .validate()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let session = edit
        .session(session_id)
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let current = session
        .snapshot()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    context_scope_matches(&current, session_id, &request).map_err(code)?;
    require_capability(&current, OfficeCapability::AiContext)?;
    // Fail before a job exists when no approved provider is installed.
    ai.provider().map_err(code)?;
    let sensitive = session.is_sensitive();
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| code(OfficeAiError::Busy))?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let edit = context.app().state::<OfficeEditState>();
        let ai = context.app().state::<OfficeAiState>();
        let profile_now = edit
            .current_profile()
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        if profile_now != profile {
            return Err(code(OfficeAiError::Changed));
        }
        let session = edit
            .session(session_id)
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        let current = session
            .snapshot()
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        if current.busy {
            return Err(code(OfficeAiError::Busy));
        }
        context_scope_matches(&current, session_id, &request).map_err(code)?;
        require_capability(&current, OfficeCapability::AiContext)?;
        if session.is_sensitive() != sensitive {
            return Err(code(OfficeAiError::Changed));
        }
        let captured = ai
            .capture(&profile, session_id, sensitive, &current, &request)
            .map_err(code)?;
        serde_json::to_value(captured).map_err(|_| code(OfficeAiError::Failed))
    });
    Ok(())
}

#[tauri::command]
pub fn office_ai_context_release(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    context_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let context_id = parse_id(&context_id)?;
    ai.release_context(&profile, context_id);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_ai_proposal_evaluate_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    request_id: String,
    session_id: String,
    request: OfficeProposalRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeAiError::Invalid))?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let session_id = parse_id(&session_id)?;
    request
        .validate()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    if !valid_transaction_label(&request.label_key) {
        return Err(code(OfficeAiError::Invalid));
    }
    let session = edit
        .session(session_id)
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let current = session
        .snapshot()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    proposal_scope_matches(&current, &request).map_err(code)?;
    require_capability(&current, OfficeCapability::ProposalClone)?;
    ai.provider().map_err(code)?;
    let sensitive = session.is_sensitive();
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| code(OfficeAiError::Busy))?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let edit = context.app().state::<OfficeEditState>();
        let ai = context.app().state::<OfficeAiState>();
        let profile_now = edit
            .current_profile()
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        if profile_now != profile {
            return Err(code(OfficeAiError::Changed));
        }
        let session = edit
            .session(session_id)
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        let current = session
            .snapshot()
            .map_err(|error| code(OfficeAiError::from_edit(error)))?;
        if current.busy {
            return Err(code(OfficeAiError::Busy));
        }
        proposal_scope_matches(&current, &request).map_err(code)?;
        require_capability(&current, OfficeCapability::ProposalClone)?;
        if session.is_sensitive() != sensitive {
            return Err(code(OfficeAiError::Changed));
        }
        let preview = ai
            .evaluate(&profile, session_id, sensitive, &current, &request)
            .map_err(code)?;
        serde_json::to_value(preview).map_err(|_| code(OfficeAiError::Failed))
    });
    Ok(())
}

#[tauri::command]
pub fn office_ai_proposal_page(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    preview_id: String,
    cursor: String,
) -> Result<OfficeProposalPreview, String> {
    ensure_main(window.label())?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let preview_id = parse_id(&preview_id)?;
    let cursor = parse_id(&cursor)?;
    ai.page(&profile, preview_id, cursor).map_err(code)
}

#[tauri::command]
pub fn office_ai_proposal_release(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    preview_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let preview_id = parse_id(&preview_id)?;
    ai.release_preview(&profile, preview_id);
    Ok(())
}

#[tauri::command]
pub fn office_ai_proposal_confirm(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    preview_id: String,
) -> Result<OfficeAiConfirmation, String> {
    ensure_main(window.label())?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    let preview_id = parse_id(&preview_id)?;
    ai.confirm(&profile, preview_id).map_err(code)
}

#[tauri::command]
pub fn office_ai_proposal_apply(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    ai: State<'_, OfficeAiState>,
    request: OfficeProposalApplyRequest,
) -> Result<OfficeTransactionResult, String> {
    ensure_main(window.label())?;
    let profile = edit
        .current_profile()
        .map_err(|error| code(OfficeAiError::from_edit(error)))?;
    ai.apply(&profile, edit.inner(), &request).map_err(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_codes_keep_their_own_namespace() {
        assert_eq!(OfficeAiError::EngineMissing.code(), "office_ai.engine_missing");
        assert_eq!(OfficeAiError::Unsupported.code(), "office_ai.unsupported");
        assert_eq!(
            OfficeAiError::from_edit(OfficeEditError::EngineMissing).code(),
            "office_ai.engine_missing"
        );
        assert_eq!(
            OfficeAiError::from_edit(OfficeEditError::Changed).code(),
            "office_ai.changed"
        );
    }

    #[test]
    fn intent_families_are_fixed() {
        assert_eq!(
            family_of_intent(OfficeProposalIntent::ImageAlt),
            OfficeFamily::Document
        );
        assert_eq!(
            family_of_intent(OfficeProposalIntent::SheetChart),
            OfficeFamily::Sheet
        );
        assert_eq!(
            family_of_intent(OfficeProposalIntent::DeckNotes),
            OfficeFamily::Deck
        );
    }
}
