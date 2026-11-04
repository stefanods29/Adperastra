//! Native draft and human approval gates (Step 17a T5/D10-D11).
//!
//! A draft is immutable: its hash binds the operation, source identities,
//! rows and accepted warnings. Apply is a native dialog; model text can never
//! set an approval flag. Recycle has two distinct human confirmations and is
//! unavailable while 09f's object-bound recycle is unproven.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use uuid::Uuid;

use convert::MetadataCategory;

use crate::assistant_outbound::{sha256_hex, SourceRevision};
use crate::assistant_types::{AssistantDraft, AssistantOperation};

pub const APPROVAL_EXPIRY_SECS: u64 = 120;

#[derive(Debug, Clone)]
pub struct Stage1 {
    pub id: Uuid,
    pub draft_id: Uuid,
    pub draft_sha256: String,
    pub item_ids: Vec<Uuid>,
    pub source_revisions: Vec<SourceRevision>,
    pub created_unix: u64,
    pub expires_unix: u64,
    pub used: bool,
}

#[derive(Debug, Clone)]
pub struct FinalApproval {
    pub id: Uuid,
    pub draft_id: Uuid,
    pub draft_sha256: String,
    pub stage1_id: Uuid,
    pub created_unix: u64,
    pub expires_unix: u64,
    pub one_use: bool,
    pub used: bool,
    /// True only on the value returned by `consume`; the executor requires it.
    pub consumed: bool,
}

#[derive(Debug, Clone)]
struct DraftRecord {
    draft: AssistantDraft,
    source_revisions: Vec<SourceRevision>,
    stage1: Option<Stage1>,
    approval: Option<FinalApproval>,
    applied: bool,
}

#[derive(Default)]
pub struct ApprovalStore {
    drafts: Mutex<HashMap<Uuid, DraftRecord>>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|_| "assistant.failed".to_string())
}

pub fn operation_hash(
    operation: &AssistantOperation,
    source_revisions: &[SourceRevision],
    item_ids: &[Uuid],
    warnings: &[String],
    accepted_warning_codes: &[String],
    accepted_losses: &[MetadataCategory],
) -> Result<String, String> {
    let canonical = serde_json::json!({
        "operation": operation,
        "sources": source_revisions,
        "items": item_ids,
        "warnings": warnings,
        "accepted_warning_codes": accepted_warning_codes,
        "accepted_losses": accepted_losses
    });
    let bytes = serde_json::to_vec(&canonical).map_err(|_| "assistant.invalid".to_string())?;
    Ok(sha256_hex(&bytes))
}

pub fn item_ids_for(operation: &AssistantOperation) -> Vec<Uuid> {
    match operation {
        AssistantOperation::CreateFile { .. }
        | AssistantOperation::CreateFolder { .. }
        | AssistantOperation::CreateFromTemplate { .. } => Vec::new(),
        AssistantOperation::RenameItems { items } => items.iter().map(|item| item.input_id).collect(),
        AssistantOperation::MoveItems { input_ids, .. }
        | AssistantOperation::CopyItems { input_ids, .. }
        | AssistantOperation::Convert { input_ids, .. }
        | AssistantOperation::TagItems { input_ids, .. }
        | AssistantOperation::PrivacyClean { input_ids, .. }
        | AssistantOperation::RecycleItems { input_ids } => input_ids.clone(),
    }
}

impl ApprovalStore {
    /// Register an immutable draft. No operation runs here.
    pub fn register(
        &self,
        draft: AssistantDraft,
        source_revisions: Vec<SourceRevision>,
    ) -> Result<(), String> {
        if draft.preview_rows.is_empty() || draft.preview_rows.len() > 100 {
            return Err("assistant.invalid".to_string());
        }
        if draft.source_ids.len() > 100
            || draft.warnings.len() > 64
            || draft.accepted_warning_codes.len() > 64
            || draft.accepted_losses.len() > 64
            || (draft.risk != "change" && draft.risk != "recycle")
            || draft.expires_unix == 0
        {
            return Err("assistant.invalid".to_string());
        }
        if draft.draft_sha256.len() != 64 || !draft.draft_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("assistant.invalid".to_string());
        }
        let expected = operation_hash(
            &draft.operation,
            &source_revisions,
            &item_ids_for(&draft.operation),
            &draft.warnings,
            &draft.accepted_warning_codes,
            &draft.accepted_losses,
        )?;
        if expected != draft.draft_sha256 {
            return Err("assistant.changed".to_string());
        }
        lock(&self.drafts)?.insert(
            draft.id,
            DraftRecord {
                draft,
                source_revisions,
                stage1: None,
                approval: None,
                applied: false,
            },
        );
        Ok(())
    }

    /// One explicit native Apply click for a normal change draft. Recycle
    /// drafts must use the two distinct stage1/stage2 confirmations.
    pub fn approve_change(
        &self,
        draft_id: Uuid,
        approved: bool,
        now: u64,
    ) -> Result<FinalApproval, String> {
        if !approved {
            return Err("assistant.confirmation_required".to_string());
        }
        let mut drafts = lock(&self.drafts)?;
        let record = drafts
            .get_mut(&draft_id)
            .ok_or_else(|| "assistant.changed".to_string())?;
        if record.applied {
            return Err("assistant.changed".to_string());
        }
        if record.draft.operation.tool_id() == "recycle_items" {
            return Err("assistant.confirmation_required".to_string());
        }
        if now > record.draft.expires_unix {
            return Err("assistant.changed".to_string());
        }
        let approval = FinalApproval {
            id: Uuid::new_v4(),
            draft_id,
            draft_sha256: record.draft.draft_sha256.clone(),
            stage1_id: Uuid::nil(),
            created_unix: now,
            expires_unix: now + APPROVAL_EXPIRY_SECS,
            one_use: true,
            used: false,
            consumed: false,
        };
        record.stage1 = None;
        record.approval = Some(approval.clone());
        Ok(approval)
    }

    /// First explicit Apply click. Creates a one-use stage1 challenge bound to
    /// the exact draft hash, item list and source revisions.
    pub fn stage1(&self, draft_id: Uuid, approved: bool, now: u64) -> Result<Stage1, String> {
        if !approved {
            return Err("assistant.confirmation_required".to_string());
        }
        let mut drafts = lock(&self.drafts)?;
        let record = drafts
            .get_mut(&draft_id)
            .ok_or_else(|| "assistant.changed".to_string())?;
        if record.applied {
            return Err("assistant.changed".to_string());
        }
        if now > record.draft.expires_unix {
            return Err("assistant.changed".to_string());
        }
        let stage = Stage1 {
            id: Uuid::new_v4(),
            draft_id,
            draft_sha256: record.draft.draft_sha256.clone(),
            item_ids: item_ids_for(&record.draft.operation),
            source_revisions: record.source_revisions.clone(),
            created_unix: now,
            expires_unix: now + APPROVAL_EXPIRY_SECS,
            used: false,
        };
        record.stage1 = Some(stage.clone());
        record.approval = None;
        Ok(stage)
    }

    /// Second distinct native click. Refuses without a stage1 challenge.
    pub fn stage2(
        &self,
        draft_id: Uuid,
        stage1_id: Uuid,
        approved: bool,
        now: u64,
    ) -> Result<FinalApproval, String> {
        if !approved {
            return Err("assistant.confirmation_required".to_string());
        }
        let mut drafts = lock(&self.drafts)?;
        let record = drafts
            .get_mut(&draft_id)
            .ok_or_else(|| "assistant.changed".to_string())?;
        let stage = record
            .stage1
            .as_ref()
            .ok_or_else(|| "assistant.confirmation_required".to_string())?;
        if stage.id != stage1_id || stage.used {
            return Err("assistant.confirmation_required".to_string());
        }
        if now > stage.expires_unix || now > record.draft.expires_unix {
            return Err("assistant.outbound_expired".to_string());
        }
        let approval = FinalApproval {
            id: Uuid::new_v4(),
            draft_id,
            draft_sha256: stage.draft_sha256.clone(),
            stage1_id: stage.id,
            created_unix: now,
            expires_unix: now + APPROVAL_EXPIRY_SECS,
            one_use: true,
            used: false,
            consumed: false,
        };
        if record.stage1.as_ref().map(|s| s.id) == Some(approval.stage1_id) {
            if let Some(stage) = record.stage1.as_mut() {
                stage.used = true;
            }
        }
        record.approval = Some(approval.clone());
        Ok(approval)
    }

    /// The unused stage1 challenge of a draft. Stage 2 must name this exact
    /// challenge, so a second click cannot be manufactured without the first.
    pub fn pending_stage1(&self, draft_id: Uuid) -> Result<Stage1, String> {
        let drafts = lock(&self.drafts)?;
        let record = drafts
            .get(&draft_id)
            .ok_or_else(|| "assistant.confirmation_required".to_string())?;
        record
            .stage1
            .clone()
            .filter(|stage| !stage.used)
            .ok_or_else(|| "assistant.confirmation_required".to_string())
    }

    /// Consume the final approval exactly once, immediately before execution.
    pub fn consume(&self, draft_id: Uuid, now: u64) -> Result<FinalApproval, String> {
        let mut drafts = lock(&self.drafts)?;
        let record = drafts
            .get_mut(&draft_id)
            .ok_or_else(|| "assistant.confirmation_required".to_string())?;
        let approval = record
            .approval
            .as_ref()
            .ok_or_else(|| "assistant.confirmation_required".to_string())?;
        if approval.used || record.applied {
            return Err("assistant.confirmation_required".to_string());
        }
        if now > approval.expires_unix {
            return Err("assistant.outbound_expired".to_string());
        }
        let mut approval = approval.clone();
        approval.used = true;
        approval.consumed = true;
        if let Some(stored) = record.approval.as_mut() {
            stored.used = true;
        }
        record.applied = true;
        Ok(approval)
    }

    /// Any count/list/hash/source change invalidates both confirmations.
    pub fn ensure_unchanged(
        &self,
        draft_id: Uuid,
        current_hash: &str,
        current_items: &[Uuid],
        current_sources: &[SourceRevision],
    ) -> Result<(), String> {
        let mut drafts = lock(&self.drafts)?;
        let record = drafts
            .get_mut(&draft_id)
            .ok_or_else(|| "assistant.changed".to_string())?;
        let changed = record.draft.draft_sha256 != current_hash
            || item_ids_for(&record.draft.operation) != current_items
            || record.source_revisions != current_sources;
        if changed {
            record.stage1 = None;
            record.approval = None;
            return Err("assistant.changed".to_string());
        }
        Ok(())
    }

    pub fn get(&self, draft_id: Uuid) -> Result<AssistantDraft, String> {
        lock(&self.drafts)?
            .get(&draft_id)
            .map(|record| record.draft.clone())
            .ok_or_else(|| "assistant.changed".to_string())
    }

    pub fn cancel(&self, draft_id: Uuid) -> Result<(), String> {
        if let Some(record) = lock(&self.drafts)?.get_mut(&draft_id) {
            record.stage1 = None;
            record.approval = None;
        }
        Ok(())
    }
}

/// Model output is text, never an Apply call. This function exists to make
/// the refusal explicit and testable.
pub fn apply_from_text(_model_text: &str) -> Result<(), String> {
    Err("assistant.confirmation_required".to_string())
}

/// A path precheck is not an object-bound recycle proof. It never enables the
/// assistant recycle capability.
pub fn recycle_capability(path_precheck_ok: bool) -> bool {
    let _ = path_precheck_ok;
    false
}
