#![allow(clippy::assertions_on_constants, clippy::bool_assert_comparison)]

use super::*;
use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize, Ordering};

use uuid::Uuid;

use crate::assistant_approvals::{
    apply_from_text, item_ids_for, operation_hash, ApprovalStore,
};
use crate::assistant_approvals::FinalApproval;
use crate::assistant_recycle::{
    execute_two_confirmations, path_precheck_enables_recycle, RecycleExecutor,
    ASSISTANT_RECYCLE_SAFE,
};
use crate::assistant_types::{
    AssistantDraft, AssistantOperation, AssistantPreviewRow, AssistantRenameItem,
};

fn draft(operation: AssistantOperation) -> AssistantDraft {
    let hash = operation_hash(&operation, &[], &item_ids_for(&operation), &[], &[], &[]).unwrap();
    AssistantDraft {
        id: Uuid::new_v4(),
        chat_id: Uuid::new_v4(),
        revision: 1,
        operation,
        source_ids: Vec::new(),
        preview_rows: vec![AssistantPreviewRow {
            input_id: None,
            source_label: Some("source".to_string()),
            destination_label: Some("destination".to_string()),
            before_excerpt: None,
            after_excerpt: Some("after".to_string()),
            operation_key: "test".to_string(),
        }],
        warnings: Vec::new(),
        accepted_warning_codes: Vec::new(),
        accepted_losses: Vec::new(),
        draft_sha256: hash,
        expires_unix: 200,
        risk: "change".to_string(),
    }
}

fn create_file() -> AssistantDraft {
    draft(AssistantOperation::CreateFile {
        parent_root_id: Uuid::new_v4(),
        name: "notes.txt".to_string(),
        format: "text".to_string(),
        content: "Meeting at 10.".to_string(),
    })
}

fn rename_three() -> AssistantDraft {
    draft(AssistantOperation::RenameItems {
        items: vec![
            AssistantRenameItem {
                input_id: Uuid::new_v4(),
                new_name: "a.txt".to_string(),
            },
            AssistantRenameItem {
                input_id: Uuid::new_v4(),
                new_name: "b.txt".to_string(),
            },
            AssistantRenameItem {
                input_id: Uuid::new_v4(),
                new_name: "c.txt".to_string(),
            },
        ],
    })
}

fn approved_change(store: &ApprovalStore, draft: &AssistantDraft) -> FinalApproval {
    store.register(draft.clone(), Vec::new()).unwrap();
    store.approve_change(draft.id, true, 100).unwrap()
}

fn approved_recycle(store: &ApprovalStore, draft: &AssistantDraft) -> (Uuid, FinalApproval) {
    store.register(draft.clone(), Vec::new()).unwrap();
    let stage1 = store.stage1(draft.id, true, 100).unwrap();
    let final_approval = store.stage2(draft.id, stage1.id, true, 101).unwrap();
    (stage1.id, final_approval)
}

#[test]
fn generated_apply_text_no_effect() {
    let executed = AtomicUsize::new(0);
    assert_eq!(
        apply_from_text("Apply this change").unwrap_err(),
        "assistant.confirmation_required"
    );
    assert_eq!(executed.load(Ordering::SeqCst), 0);
}

#[test]
fn stage2_without_stage1_refused() {
    let store = ApprovalStore::default();
    let draft = draft(AssistantOperation::RecycleItems {
        input_ids: vec![Uuid::new_v4()],
    });
    store.register(draft.clone(), Vec::new()).unwrap();
    assert_eq!(
        store
            .stage2(draft.id, Uuid::new_v4(), true, 100)
            .unwrap_err(),
        "assistant.confirmation_required"
    );
}

#[test]
fn first_and_second_distinct_nonce() {
    let store = ApprovalStore::default();
    let draft = draft(AssistantOperation::RecycleItems {
        input_ids: vec![Uuid::new_v4()],
    });
    let (stage1_id, final_approval) = approved_recycle(&store, &draft);
    assert_ne!(stage1_id, final_approval.id);
}

#[test]
fn count_or_list_changed_invalidatesboth() {
    let store = ApprovalStore::default();
    let draft = draft(AssistantOperation::RecycleItems {
        input_ids: vec![Uuid::new_v4()],
    });
    let (stage1_id, _final_approval) = approved_recycle(&store, &draft);
    let changed_items = vec![Uuid::new_v4()];
    assert_eq!(
        store
            .ensure_unchanged(draft.id, &draft.draft_sha256, &changed_items, &[])
            .unwrap_err(),
        "assistant.changed"
    );
    assert_eq!(
        store.stage2(draft.id, stage1_id, true, 102).unwrap_err(),
        "assistant.confirmation_required"
    );
}

#[test]
fn approval_replay_refused() {
    let store = ApprovalStore::default();
    let draft = create_file();
    approved_change(&store, &draft);
    assert!(store.consume(draft.id, 102).is_ok());
    assert_eq!(
        store.consume(draft.id, 102).unwrap_err(),
        "assistant.confirmation_required"
    );
}

struct FakeRecycle {
    calls: AtomicUsize,
}

impl RecycleExecutor for FakeRecycle {
    fn recycle(&self, _input_ids: &[Uuid]) -> Result<Vec<Uuid>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
}

#[test]
fn recycle_capfalse_zero_disk_effects() {
    let store = ApprovalStore::default();
    let draft = draft(AssistantOperation::RecycleItems {
        input_ids: vec![Uuid::new_v4(), Uuid::new_v4()],
    });
    let (stage1_id, final_approval) = approved_recycle(&store, &draft);
    let executor = FakeRecycle {
        calls: AtomicUsize::new(0),
    };
    assert!(!ASSISTANT_RECYCLE_SAFE);
    assert_eq!(
        execute_two_confirmations(&store, &draft, stage1_id, &final_approval, &executor)
            .unwrap_err(),
        "assistant.recycle_unavailable"
    );
    assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn path_precheck_does_not_enable_recycle() {
    assert!(!path_precheck_enables_recycle(true));
    assert!(!path_precheck_enables_recycle(false));
    assert!(!ASSISTANT_RECYCLE_SAFE);
}

#[test]
fn contentchange_versionhook_beforecommit() {
    let store = ApprovalStore::default();
    let draft = create_file();
    approved_change(&store, &draft);
    let final_approval = store.consume(draft.id, 102).unwrap();
    let order = RefCell::new(Vec::new());
    let hooks = ActionHooks {
        version_hook: &|_op| {
            order.borrow_mut().push("version");
            Ok(())
        },
        destination_probe: &|_op| Ok(DestinationState { foreign_exists: false }),
        execute: &|_op| {
            order.borrow_mut().push("execute");
            Ok(vec![ExecutedItem {
                input_id: Uuid::new_v4(),
                status: "done".to_string(),
                output_label: "notes.txt".to_string(),
            }])
        },
    };
    let result = execute_approved(&draft, &final_approval, &hooks).unwrap();
    assert_eq!(*order.borrow(), vec!["version", "execute"]);
    assert_eq!(result.state, "completed");
}

#[test]
fn foreign_destination_never_replaced() {
    let store = ApprovalStore::default();
    let draft = create_file();
    approved_change(&store, &draft);
    let final_approval = store.consume(draft.id, 102).unwrap();
    let executes = AtomicUsize::new(0);
    let hooks = ActionHooks {
        version_hook: &|_op| Ok(()),
        destination_probe: &|_op| Ok(DestinationState { foreign_exists: true }),
        execute: &|_op| {
            executes.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        },
    };
    assert_eq!(
        execute_approved(&draft, &final_approval, &hooks).unwrap_err(),
        "assistant.changed"
    );
    assert_eq!(executes.load(Ordering::SeqCst), 0);
}

#[test]
fn partial_batch_records_actualonly() {
    let store = ApprovalStore::default();
    let draft = rename_three();
    approved_change(&store, &draft);
    let final_approval = store.consume(draft.id, 102).unwrap();
    let items = match &draft.operation {
        AssistantOperation::RenameItems { items } => items.clone(),
        _ => unreachable!(),
    };
    let executed = vec![
        ExecutedItem {
            input_id: items[0].input_id,
            status: "done".to_string(),
            output_label: items[0].new_name.clone(),
        },
        ExecutedItem {
            input_id: items[1].input_id,
            status: "done".to_string(),
            output_label: items[1].new_name.clone(),
        },
    ];
    let hooks = ActionHooks {
        version_hook: &|_op| Ok(()),
        destination_probe: &|_op| Ok(DestinationState { foreign_exists: false }),
        execute: &|_op| Ok(executed.clone()),
    };
    let result = execute_approved(&draft, &final_approval, &hooks).unwrap();
    assert_eq!(result.state, "partial");
    assert_eq!(result.actual_input_ids.len(), 2);
    assert!(result.actual_input_ids.contains(&items[0].input_id));
    assert!(result.actual_input_ids.contains(&items[1].input_id));
    assert!(!result.actual_input_ids.contains(&items[2].input_id));
}
