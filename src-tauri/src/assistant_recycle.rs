//! Assistant recycle gate (Step 17a T5/D11).
//!
//! Recycling needs two different native human confirmations and a proven
//! object-bound recycle operation. 09f currently proves neither the replace
//! nor the object-bound recycle; therefore the capability is false and this
//! module refuses before any disk effect. A path precheck is not a proof.
#![allow(dead_code)]


use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::assistant::AssistantService;
use crate::assistant_actions::{validate_current, AssistantActionState};
use crate::assistant_approvals::{ApprovalStore, FinalApproval};
use crate::assistant_types::AssistantDraft;
use crate::ensure_main;

/// Fixed until 09f supplies a separately reviewed native identity receipt.
pub const ASSISTANT_RECYCLE_SAFE: bool = false;

pub trait RecycleExecutor {
    /// The producer may implement this only after the native identity proof.
    fn recycle(&self, input_ids: &[Uuid]) -> Result<Vec<Uuid>, String>;
}

/// Two distinct confirmations still cannot enable an unproven operation.
pub fn execute_two_confirmations(
    _store: &ApprovalStore,
    draft: &AssistantDraft,
    _stage1_id: Uuid,
    _final_approval: &FinalApproval,
    executor: &dyn RecycleExecutor,
) -> Result<Vec<Uuid>, String> {
    if !ASSISTANT_RECYCLE_SAFE {
        return Err("assistant.recycle_unavailable".to_string());
    }
    let ids = match &draft.operation {
        crate::assistant_types::AssistantOperation::RecycleItems { input_ids } => input_ids,
        _ => return Err("assistant.invalid".to_string()),
    };
    executor.recycle(ids)
}

/// The exact two-dialog text is app-owned. The count comes from the frozen
/// list, never from a later recomputation.
pub fn recycle_list_count(item_count: usize) -> Result<usize, String> {
    if item_count == 0 || item_count > 100 {
        return Err("assistant.invalid".to_string());
    }
    Ok(item_count)
}

/// A path precheck cannot turn the capability on.
pub fn path_precheck_enables_recycle(_precheck_ok: bool) -> bool {
    false
}

/// Permanent deletion is not representable; this helper is a compile-time
/// guard for callers.
pub fn permanent_delete_available() -> bool {
    false
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Native recycle confirmation. `ASSISTANT_RECYCLE_SAFE` is false, so this
/// command fails with `assistant.recycle_unavailable` before any dialog or
/// approval state change. If the capability is ever proven, stage 1 and
/// stage 2 remain two distinct native confirmations: stage 2 must consume the
/// unused challenge created by stage 1, and nothing executes here.
#[tauri::command]
pub fn assistant_recycle_confirm(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    actions: State<'_, AssistantActionState>,
    draft_id: String,
    stage: u8,
) -> Result<serde_json::Value, String> {
    ensure_main(window.label())?;
    if stage != 1 && stage != 2 {
        return Err("assistant.invalid".to_string());
    }
    let draft_id = Uuid::parse_str(&draft_id).map_err(|_| "assistant.invalid".to_string())?;
    if !ASSISTANT_RECYCLE_SAFE {
        return Err("assistant.recycle_unavailable".to_string());
    }
    let draft = actions.approvals.get(draft_id)?;
    if draft.operation.tool_id() != "recycle_items" || draft.risk != "recycle" {
        return Err("assistant.invalid".to_string());
    }
    // Both confirmations bind the exact previewed item list and scope; a
    // revoke or source change invalidates them before any dialog.
    let scope = service
        .scope_by_chat(draft.chat_id)
        .map_err(|_| "assistant.changed".to_string())?;
    validate_current(&actions.approvals, &scope, &draft)?;
    if !actions.confirm_recycle(&draft, stage)? {
        return Err("assistant.confirmation_required".to_string());
    }
    let now = now_unix();
    match stage {
        1 => {
            actions.approvals.stage1(draft.id, true, now)?;
            Ok(serde_json::json!({ "stage": 1, "ready": false }))
        }
        2 => {
            // Stage 2 names the exact unused stage1 challenge; it cannot be
            // manufactured from a second click alone.
            let first = actions.approvals.pending_stage1(draft.id)?;
            actions.approvals.stage2(draft.id, first.id, true, now)?;
            Ok(serde_json::json!({ "stage": 2, "ready": true }))
        }
        _ => Err("assistant.invalid".to_string()),
    }
}
