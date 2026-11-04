//! Approved action execution ports (Step 17a T5).
//!
//! This module performs no file-system work. It validates the immutable draft
//! against the final approval, refuses any foreign existing destination, runs
//! the producer's normal operation through injected ports, and reports only
//! the items that actually completed.
#![allow(dead_code)]


use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::assistant::AssistantService;
use crate::assistant_approvals::{
    item_ids_for, operation_hash, ApprovalStore, FinalApproval, APPROVAL_EXPIRY_SECS,
};
use crate::assistant_outbound::SourceRevision;
use crate::assistant_policy;
use crate::assistant_scope::ScopeRecord;
use crate::assistant_tools;
use crate::assistant_types::{
    AssistantActionResult, AssistantDraft, AssistantOperation, AssistantPreviewRow,
    AssistantToolArguments, AssistantToolRequest,
};
use crate::jobs::Jobs;
use crate::local_ai_types::AiInputRef;
use crate::{ensure_main, valid_request_id};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DestinationState {
    /// True when an item already exists that this operation did not create.
    pub foreign_exists: bool,
}

#[derive(Debug, Clone)]
pub struct ExecutedItem {
    pub input_id: Uuid,
    pub status: String,
    pub output_label: String,
}

/// Producer-owned hooks. `execute` calls the normal 08a/08c/09e/11b command
/// with the same previews, version hook and owned-output rules; it never
/// replaces an existing item because 09f's replace capability is false.
pub struct ActionHooks<'a> {
    pub version_hook: &'a dyn Fn(&AssistantOperation) -> Result<(), String>,
    pub destination_probe: &'a dyn Fn(&AssistantOperation) -> Result<DestinationState, String>,
    pub execute: &'a dyn Fn(&AssistantOperation) -> Result<Vec<ExecutedItem>, String>,
}

/// The native human confirmation. Model text and WebView arguments cannot
/// implement this trait; only a native dialog can return `true`.
pub trait ActionApproval: Send + Sync {
    fn approve_change(&self, draft: &AssistantDraft) -> Result<bool, String>;
    fn confirm_recycle(&self, draft: &AssistantDraft, stage: u8) -> Result<bool, String>;
}

/// Producer-owned execution port. `version_hook` and `execute` must invoke
/// the same normal 08a/08c/09e/11b command, version and undo path as any app
/// action. The assistant never gets a second, silent write path.
pub trait ActionExecutor: Send + Sync {
    fn version_hook(&self, operation: &AssistantOperation) -> Result<(), String>;
    fn destination_probe(
        &self,
        operation: &AssistantOperation,
    ) -> Result<DestinationState, String>;
    fn execute(&self, operation: &AssistantOperation) -> Result<Vec<ExecutedItem>, String>;

    /// The undo entry the producer's normal command created for this batch.
    fn undo_entry_id(&self, _operation: &AssistantOperation) -> Option<Uuid> {
        None
    }
}

/// Managed state for preview drafts and their one-use approvals.
///
/// Both ports are `None` in the current build: no native confirmation dialog
/// and no producer execution adapter are registered yet, so Apply fails
/// closed with `assistant.confirmation_required`/`assistant.failed` instead
/// of inventing a write. Preview and Cancel remain usable.
#[derive(Default)]
pub struct AssistantActionState {
    pub approvals: ApprovalStore,
    pub approval_dialog: Option<Arc<dyn ActionApproval>>,
    pub executor: Option<Arc<dyn ActionExecutor>>,
}


impl AssistantActionState {
    pub fn new(
        approval_dialog: Option<Arc<dyn ActionApproval>>,
        executor: Option<Arc<dyn ActionExecutor>>,
    ) -> Self {
        Self {
            approvals: ApprovalStore::default(),
            approval_dialog,
            executor,
        }
    }

    /// One native confirmation for a change draft. Without a registered
    /// dialog this fails closed instead of treating the click as approval.
    pub fn approve_change(&self, draft: &AssistantDraft) -> Result<bool, String> {
        self.approval_dialog
            .as_ref()
            .ok_or_else(|| "assistant.confirmation_required".to_string())?
            .approve_change(draft)
    }

    /// One distinct native confirmation per recycle stage.
    pub fn confirm_recycle(
        &self,
        draft: &AssistantDraft,
        stage: u8,
    ) -> Result<bool, String> {
        self.approval_dialog
            .as_ref()
            .ok_or_else(|| "assistant.confirmation_required".to_string())?
            .confirm_recycle(draft, stage)
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn state_for(items: &[ExecutedItem], requested: usize) -> &'static str {
    if items.is_empty() {
        "failed"
    } else if items.len() < requested {
        "partial"
    } else {
        "completed"
    }
}

/// Execute exactly one approved draft. The approval is already consumed by
/// the caller; this function rechecks its hash and refuses any foreign target.
pub fn execute_approved(
    draft: &AssistantDraft,
    approval: &FinalApproval,
    hooks: &ActionHooks<'_>,
) -> Result<AssistantActionResult, String> {
    if !approval.consumed || !approval.one_use {
        return Err("assistant.confirmation_required".to_string());
    }
    if approval.draft_id != draft.id || approval.draft_sha256 != draft.draft_sha256 {
        return Err("assistant.changed".to_string());
    }
    if draft.operation.tool_id() == "recycle_items" {
        return Err("assistant.recycle_unavailable".to_string());
    }
    let destination = (hooks.destination_probe)(&draft.operation)?;
    if destination.foreign_exists {
        return Err("assistant.changed".to_string());
    }
    // The content-change version hook runs before any commit.
    (hooks.version_hook)(&draft.operation)?;
    let items = (hooks.execute)(&draft.operation)?;
    let requested = crate::assistant_approvals::item_ids_for(&draft.operation).len();
    let actual_input_ids = items.iter().map(|item| item.input_id).collect::<Vec<_>>();
    let output_labels = items.iter().map(|item| item.output_label.clone()).collect();
    Ok(AssistantActionResult {
        draft_id: draft.id,
        state: state_for(&items, requested.max(1)).to_string(),
        actual_input_ids,
        output_labels,
        undo_entry_id: None,
        error_code: None,
    })
}

/// A preview row never becomes a write by itself.
pub fn rows_are_preview_only(rows: &[AssistantPreviewRow]) -> bool {
    !rows.is_empty() && rows.len() <= 100
}

/// Apply is only the native approval path; no web view/model argument can
/// request this function with a boolean.
pub fn require_native_apply(approved: bool) -> Result<(), String> {
    if approved {
        Ok(())
    } else {
        Err("assistant.confirmation_required".to_string())
    }
}

/// The approval store is the only source of a consumed approval.
pub fn consume_for_execution(
    store: &ApprovalStore,
    draft_id: Uuid,
    now: u64,
) -> Result<FinalApproval, String> {
    store.consume(draft_id, now)
}

fn operation_from_arguments(
    arguments: &AssistantToolArguments,
) -> Result<AssistantOperation, String> {
    match arguments {
        AssistantToolArguments::CreateFile {
            parent_root_id,
            name,
            format,
            content,
        } => Ok(AssistantOperation::CreateFile {
            parent_root_id: *parent_root_id,
            name: name.clone(),
            format: format.clone(),
            content: content.clone(),
        }),
        AssistantToolArguments::CreateFolder {
            parent_root_id,
            name,
        } => Ok(AssistantOperation::CreateFolder {
            parent_root_id: *parent_root_id,
            name: name.clone(),
        }),
        AssistantToolArguments::CreateFromTemplate {
            parent_root_id,
            name,
            template_id,
        } => Ok(AssistantOperation::CreateFromTemplate {
            parent_root_id: *parent_root_id,
            name: name.clone(),
            template_id: *template_id,
        }),
        AssistantToolArguments::RenameItems { items } => Ok(AssistantOperation::RenameItems {
            items: items.clone(),
        }),
        AssistantToolArguments::MoveItems {
            input_ids,
            target_root_id,
            conflict,
        } => Ok(AssistantOperation::MoveItems {
            input_ids: input_ids.clone(),
            target_root_id: *target_root_id,
            conflict: conflict.clone(),
        }),
        AssistantToolArguments::CopyItems {
            input_ids,
            target_root_id,
            conflict,
        } => Ok(AssistantOperation::CopyItems {
            input_ids: input_ids.clone(),
            target_root_id: *target_root_id,
            conflict: conflict.clone(),
        }),
        AssistantToolArguments::Convert {
            input_ids,
            converter_id,
            format,
            options,
            target_root_id,
            accepted_losses,
            accepted_warning_codes,
        } => Ok(AssistantOperation::Convert {
            input_ids: input_ids.clone(),
            converter_id: converter_id.clone(),
            format: format.clone(),
            options: options.clone(),
            target_root_id: *target_root_id,
            accepted_losses: accepted_losses.clone(),
            accepted_warning_codes: accepted_warning_codes.clone(),
        }),
        AssistantToolArguments::TagItems {
            input_ids,
            add_tag_ids,
            remove_tag_ids,
        } => Ok(AssistantOperation::TagItems {
            input_ids: input_ids.clone(),
            add_tag_ids: add_tag_ids.clone(),
            remove_tag_ids: remove_tag_ids.clone(),
        }),
        AssistantToolArguments::PrivacyClean {
            input_ids,
            categories,
            target_root_id,
        } => Ok(AssistantOperation::PrivacyClean {
            input_ids: input_ids.clone(),
            categories: categories.clone(),
            target_root_id: *target_root_id,
        }),
        AssistantToolArguments::RecycleItems { input_ids } => {
            Ok(AssistantOperation::RecycleItems {
                input_ids: input_ids.clone(),
            })
        }
        _ => Err("assistant.invalid".to_string()),
    }
}

/// Bind every referenced input to the exact immutable scope reference. A
/// create operation has no source files; every item operation must name the
/// current grant or the preview/apply is refused.
fn bind_sources(
    scope: &ScopeRecord,
    operation: &AssistantOperation,
    missing: &str,
) -> Result<(Vec<AiInputRef>, Vec<SourceRevision>), String> {
    let mut source_ids = Vec::new();
    for input_id in item_ids_for(operation) {
        let file = scope
            .files
            .iter()
            .find(|file| file.id == input_id && !file.id.is_nil() && file.expected_revision >= 1)
            .cloned()
            .ok_or_else(|| missing.to_string())?;
        source_ids.push(file);
    }
    let source_revisions = source_ids
        .iter()
        .map(|file| SourceRevision {
            input_id: file.id,
            revision: file.expected_revision,
        })
        .collect();
    Ok((source_ids, source_revisions))
}

fn draft_hash(draft: &AssistantDraft, sources: &[SourceRevision]) -> Result<String, String> {
    operation_hash(
        &draft.operation,
        sources,
        &item_ids_for(&draft.operation),
        &draft.warnings,
        &draft.accepted_warning_codes,
        &draft.accepted_losses,
    )
}

fn operation_roots(operation: &AssistantOperation) -> Vec<Uuid> {
    match operation {
        AssistantOperation::CreateFile { parent_root_id, .. }
        | AssistantOperation::CreateFolder { parent_root_id, .. }
        | AssistantOperation::CreateFromTemplate { parent_root_id, .. } => vec![*parent_root_id],
        AssistantOperation::MoveItems {
            target_root_id, ..
        }
        | AssistantOperation::CopyItems {
            target_root_id, ..
        }
        | AssistantOperation::Convert {
            target_root_id, ..
        }
        | AssistantOperation::PrivacyClean {
            target_root_id, ..
        } => vec![*target_root_id],
        AssistantOperation::RenameItems { .. }
        | AssistantOperation::TagItems { .. }
        | AssistantOperation::RecycleItems { .. } => Vec::new(),
    }
}

/// Re-read the scope and the draft hash immediately before approval and
/// consumption. Any count/list/hash/source/root/generation change invalidates
/// the pending confirmations.
pub(crate) fn validate_current(
    store: &ApprovalStore,
    scope: &ScopeRecord,
    draft: &AssistantDraft,
) -> Result<(), String> {
    if draft.revision != scope.generation.max(1) {
        return Err("assistant.changed".to_string());
    }
    if operation_roots(&draft.operation)
        .iter()
        .any(|root_id| scope.roots.iter().all(|root| root.root_id != *root_id))
    {
        return Err("assistant.changed".to_string());
    }
    let (source_ids, sources) = bind_sources(scope, &draft.operation, "assistant.changed")?;
    if source_ids != draft.source_ids {
        return Err("assistant.changed".to_string());
    }
    let hash = draft_hash(draft, &sources)?;
    store.ensure_unchanged(
        draft.id,
        &hash,
        &item_ids_for(&draft.operation),
        &sources,
    )
}

fn preview_rows(operation: &AssistantOperation) -> Vec<AssistantPreviewRow> {
    let operation_key = operation.tool_id().to_string();
    match operation {
        AssistantOperation::CreateFile {
            parent_root_id,
            name,
            content,
            ..
        } => vec![AssistantPreviewRow {
            input_id: None,
            source_label: Some(parent_root_id.to_string()),
            destination_label: Some(name.clone()),
            before_excerpt: None,
            after_excerpt: Some(content.chars().take(200).collect()),
            operation_key,
        }],
        AssistantOperation::CreateFolder {
            parent_root_id,
            name,
        } => vec![AssistantPreviewRow {
            input_id: None,
            source_label: Some(parent_root_id.to_string()),
            destination_label: Some(name.clone()),
            before_excerpt: None,
            after_excerpt: None,
            operation_key,
        }],
        AssistantOperation::CreateFromTemplate {
            parent_root_id,
            name,
            template_id,
        } => vec![AssistantPreviewRow {
            input_id: None,
            source_label: Some(parent_root_id.to_string()),
            destination_label: Some(name.clone()),
            before_excerpt: None,
            after_excerpt: Some(template_id.to_string()),
            operation_key,
        }],
        AssistantOperation::RenameItems { items } => items
            .iter()
            .map(|item| AssistantPreviewRow {
                input_id: Some(item.input_id),
                source_label: Some(item.input_id.to_string()),
                destination_label: Some(item.new_name.clone()),
                before_excerpt: None,
                after_excerpt: None,
                operation_key: operation_key.clone(),
            })
            .collect(),
        AssistantOperation::MoveItems {
            input_ids,
            target_root_id,
            ..
        }
        | AssistantOperation::CopyItems {
            input_ids,
            target_root_id,
            ..
        }
        | AssistantOperation::PrivacyClean {
            input_ids,
            target_root_id,
            ..
        } => input_ids
            .iter()
            .map(|input_id| AssistantPreviewRow {
                input_id: Some(*input_id),
                source_label: Some(input_id.to_string()),
                destination_label: Some(target_root_id.to_string()),
                before_excerpt: None,
                after_excerpt: None,
                operation_key: operation_key.clone(),
            })
            .collect(),
        AssistantOperation::Convert {
            input_ids,
            format,
            ..
        } => input_ids
            .iter()
            .map(|input_id| AssistantPreviewRow {
                input_id: Some(*input_id),
                source_label: Some(input_id.to_string()),
                destination_label: Some(format.clone()),
                before_excerpt: None,
                after_excerpt: None,
                operation_key: operation_key.clone(),
            })
            .collect(),
        AssistantOperation::TagItems {
            input_ids,
            add_tag_ids,
            remove_tag_ids,
        } => input_ids
            .iter()
            .map(|input_id| AssistantPreviewRow {
                input_id: Some(*input_id),
                source_label: Some(input_id.to_string()),
                destination_label: None,
                before_excerpt: None,
                after_excerpt: Some(format!(
                    "+{} -{}",
                    add_tag_ids.len(),
                    remove_tag_ids.len()
                )),
                operation_key: operation_key.clone(),
            })
            .collect(),
        AssistantOperation::RecycleItems { input_ids } => input_ids
            .iter()
            .map(|input_id| AssistantPreviewRow {
                input_id: Some(*input_id),
                source_label: Some(input_id.to_string()),
                destination_label: None,
                before_excerpt: None,
                after_excerpt: None,
                operation_key: operation_key.clone(),
            })
            .collect(),
    }
}

/// Build an immutable draft from a typed request. This reads scope data only:
/// it never creates, renames or touches a file.
#[tauri::command]
pub fn assistant_action_preview(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    actions: State<'_, AssistantActionState>,
    chat_id: String,
    request: AssistantToolRequest,
) -> Result<AssistantDraft, String> {
    ensure_main(window.label())?;
    let chat_id = Uuid::parse_str(&chat_id).map_err(|_| "assistant.invalid".to_string())?;
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    if request.source_message_id.is_nil() {
        return Err("assistant.invalid".to_string());
    }
    if !assistant_policy::requires_human_apply(&request.tool_id) {
        return Err("assistant.invalid".to_string());
    }
    let operation = operation_from_arguments(&request.arguments)?;
    let scope = service.scope_by_chat(chat_id)?;
    let capabilities = assistant_policy::capabilities_for_scope(
        scope.files.len(),
        scope.roots.len(),
        scope.read_contents && settings.allow_read_contents,
        false,
        false,
    );
    assistant_tools::validate_request(&request, &capabilities, false)?;
    let scope_view = assistant_policy::ScopeGrantView {
        files: scope.files.clone(),
        root_ids: scope.roots.iter().map(|root| root.root_id).collect(),
        read_contents: scope.read_contents && settings.allow_read_contents,
        denied_count: scope.denied.len(),
    };
    assistant_policy::validate_scope_membership(&request.arguments, &scope_view)?;
    let (source_ids, source_revisions) =
        bind_sources(&scope, &operation, "assistant.scope_denied")?;
    let (accepted_warning_codes, accepted_losses) = match &operation {
        AssistantOperation::Convert {
            accepted_warning_codes,
            accepted_losses,
            ..
        } => (accepted_warning_codes.clone(), accepted_losses.clone()),
        _ => (Vec::new(), Vec::new()),
    };
    let warnings: Vec<String> = Vec::new();
    let rows = preview_rows(&operation);
    let draft_sha256 = operation_hash(
        &operation,
        &source_revisions,
        &item_ids_for(&operation),
        &warnings,
        &accepted_warning_codes,
        &accepted_losses,
    )?;
    let risk = match &operation {
        AssistantOperation::RecycleItems { .. } => "recycle",
        _ => "change",
    }
    .to_string();
    let draft = AssistantDraft {
        id: Uuid::new_v4(),
        chat_id,
        revision: scope.generation.max(1),
        operation,
        source_ids,
        preview_rows: rows,
        warnings,
        accepted_warning_codes,
        accepted_losses,
        draft_sha256,
        expires_unix: now_unix() + APPROVAL_EXPIRY_SECS,
        risk,
    };
    actions.approvals.register(draft.clone(), source_revisions)?;
    Ok(draft)
}

/// Apply an immutable change draft. A native dialog must approve the exact
/// draft; execution runs as a shared job through the producer's normal
/// command/version/undo path. Recycle drafts never reach this path.
#[tauri::command]
pub fn assistant_action_apply(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, AssistantService>,
    actions: State<'_, AssistantActionState>,
    jobs: State<'_, Jobs>,
    request_id: String,
    draft_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "assistant.invalid".to_string())?;
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    let draft_id = Uuid::parse_str(&draft_id).map_err(|_| "assistant.invalid".to_string())?;
    let draft = actions.approvals.get(draft_id)?;
    if draft.operation.tool_id() == "recycle_items" || draft.risk == "recycle" {
        return Err("assistant.recycle_unavailable".to_string());
    }
    let scope = service
        .scope_by_chat(draft.chat_id)
        .map_err(|_| "assistant.changed".to_string())?;
    validate_current(&actions.approvals, &scope, &draft)?;
    let now = now_unix();
    if now > draft.expires_unix {
        return Err("assistant.changed".to_string());
    }
    let executor = actions
        .executor
        .clone()
        .ok_or_else(|| "assistant.failed".to_string())?;
    if !actions.approve_change(&draft)? {
        return Err("assistant.confirmation_required".to_string());
    }
    actions.approvals.approve_change(draft.id, true, now)?;
    if let Err(error) = jobs.begin(&request_id, 1) {
        let _ = actions.approvals.cancel(draft.id);
        return Err(error);
    }
    let app_handle = app.clone();
    let job_id = request_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let action_state = app_handle.state::<AssistantActionState>();
        let service = app_handle.state::<AssistantService>();
        let outcome = execute_apply(
            action_state.inner(),
            service.inner(),
            draft_id,
            executor.as_ref(),
        )
        .and_then(|result| {
            serde_json::to_value(result).map_err(|_| "assistant.failed".to_string())
        });
        app_handle.state::<Jobs>().finish(&job_id, outcome);
    });
    Ok(())
}

fn execute_apply(
    actions: &AssistantActionState,
    service: &AssistantService,
    draft_id: Uuid,
    executor: &dyn ActionExecutor,
) -> Result<AssistantActionResult, String> {
    let draft = actions.approvals.get(draft_id)?;
    if draft.operation.tool_id() == "recycle_items" || draft.risk == "recycle" {
        return Err("assistant.recycle_unavailable".to_string());
    }
    let scope = service
        .scope_by_chat(draft.chat_id)
        .map_err(|_| "assistant.changed".to_string())?;
    validate_current(&actions.approvals, &scope, &draft)?;
    let approval = consume_for_execution(&actions.approvals, draft.id, now_unix())?;
    let version_hook = |operation: &AssistantOperation| executor.version_hook(operation);
    let destination_probe = |operation: &AssistantOperation| executor.destination_probe(operation);
    let execute = |operation: &AssistantOperation| executor.execute(operation);
    let hooks = ActionHooks {
        version_hook: &version_hook,
        destination_probe: &destination_probe,
        execute: &execute,
    };
    let mut result = execute_approved(&draft, &approval, &hooks)?;
    result.undo_entry_id = executor.undo_entry_id(&draft.operation);
    Ok(result)
}

/// Cancel any pending confirmations for one draft. The draft itself stays
/// frozen and unapplied; a later Apply must ask again.
#[tauri::command]
pub fn assistant_action_cancel(
    window: WebviewWindow,
    actions: State<'_, AssistantActionState>,
    draft_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let draft_id = Uuid::parse_str(&draft_id).map_err(|_| "assistant.invalid".to_string())?;
    actions.approvals.cancel(draft_id)
}

#[cfg(test)]
#[path = "assistant_actions_step17a_tests.rs"]
mod step17a_tests;
