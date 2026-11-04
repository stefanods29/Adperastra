//! Step 17b T1: typed actions, capability gating and suggestion results.
//!
//! Included by `ai_actions.rs` as
//! `#[cfg(test)] #[path = "ai_actions_step17b_tests.rs"] mod step17b_tests;`.
//! These are written tests only; the coordinator runs them.

use ai_runtime::{AiInputKind, AiInputRef};
use serde_json::json;
use uuid::Uuid;

use crate::ai_action_results::{
    result_tab_descriptor, validate_result_tab_id, AiActionResult, AiActionResultStore,
    AiActionPayload, AiSuggestionBlock, AiSuggestionKind,
};
use crate::ai_action_types::{
    parse_options, parse_request, AiActionId, AiActionsSettings, ERR_INVALID, ERR_SOURCE_CHANGED,
};
use crate::ai_actions::{capability_error, prepare_start, AiCapabilityRow};

fn input() -> AiInputRef {
    AiInputRef {
        kind: AiInputKind::Document,
        id: Uuid::new_v4(),
        expected_revision: 1,
    }
}

fn enabled(action: AiActionId) -> AiActionsSettings {
    let mut settings = AiActionsSettings::default();
    settings.enabled.insert(action.as_str().to_string(), true);
    settings
}

fn row(capability: &str, available: bool, reason: Option<&str>) -> AiCapabilityRow {
    AiCapabilityRow {
        id: capability.to_string(),
        available,
        reason: reason.map(str::to_string),
        pack_id: None,
    }
}

fn suggestion() -> AiActionResult {
    AiActionResult {
        id: Uuid::new_v4(),
        action: AiActionId::Summarize,
        inputs: vec![input()],
        payload: AiActionPayload::Text {
            blocks: vec![AiSuggestionBlock {
                id: Uuid::new_v4(),
                kind: AiSuggestionKind::Paragraph,
                plain_text: "Budget 120.".to_string(),
                citations: vec![],
            }],
        },
        backend: "local".to_string(),
        provider_id: None,
        model_id: "qwen".to_string(),
        model_revision: "1".to_string(),
        citations: vec![],
        warnings: vec![],
        sensitive: false,
        created_unix: 10,
        expires_unix: 100,
        generation: 1,
    }
}

#[test]
fn missingpack_disabled_reason() {
    let action = AiActionId::RemoveBackground;
    assert_eq!(
        capability_error(action, &enabled(action), &[]).as_deref(),
        Some("unavailable")
    );
    let rows = vec![row("ai.foreground_mask", false, Some("pack_missing"))];
    assert_eq!(
        capability_error(action, &enabled(action), &rows).as_deref(),
        Some("pack_missing")
    );
    let ready = vec![row("ai.foreground_mask", true, None)];
    assert!(capability_error(action, &enabled(action), &ready).is_none());
}

#[test]
fn copytext_no_ai_pack() {
    assert!(capability_error(AiActionId::CopyText, &AiActionsSettings::default(), &[]).is_none());
    let request = json!({
        "action": "copy_text",
        "inputs": [{
            "kind": "document",
            "id": Uuid::new_v4(),
            "expected_revision": 1
        }],
        "options": {"kind": "copy_text", "language": "auto"},
        "request_revision": 1,
        "expected_content_id": null,
        "scope_id": null,
        "outbound_consent_id": null
    });
    let parsed = parse_request(&request).expect("copy_text is a valid request");
    assert!(prepare_start(&parsed, &AiActionsSettings::default(), &[]).is_ok());
}

#[test]
fn foreign_result_id_refused() {
    let store = AiActionResultStore::new();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let result = suggestion();
    let id = result.id;
    store.insert(result, owner, 1_024).expect("valid result");
    assert!(store.get(id, owner).is_ok());
    assert_eq!(store.get(id, other).unwrap_err(), ERR_SOURCE_CHANGED);
}

#[test]
fn result_close_revokes_new_reads() {
    let store = AiActionResultStore::new();
    let profile = Uuid::new_v4();
    let result = suggestion();
    let id = result.id;
    store.insert(result, profile, 1_024).expect("valid result");
    let lease = store.acquire(id, profile).expect("first read grants a lease");
    assert_eq!(lease.action, AiActionId::Summarize);
    store.close(id, profile).expect("close");
    assert_eq!(store.get(id, profile).unwrap_err(), ERR_SOURCE_CHANGED);
    assert_eq!(store.retained(), 1, "an open lease keeps the bytes alive");
    store.release_lease(id);
    assert_eq!(store.retained(), 0);
}

#[test]
fn unknown_action_options_refused() {
    let value = json!({"kind": "summarize", "extra": true});
    assert_eq!(parse_options(AiActionId::Summarize, &value).unwrap_err(), ERR_INVALID);
    let wrong_kind = json!({"kind": "translate", "target_language": "es"});
    assert_eq!(parse_options(AiActionId::Summarize, &wrong_kind).unwrap_err(), ERR_INVALID);
    let request = json!({
        "action": "summarize",
        "inputs": [{"kind": "document", "id": Uuid::new_v4(), "expected_revision": 1}],
        "options": {"kind": "summarize"},
        "request_revision": 1,
        "expected_content_id": null,
        "scope_id": null,
        "outbound_consent_id": null,
        "unexpected": 1
    });
    assert_eq!(parse_request(&request).unwrap_err(), ERR_INVALID);
}

#[test]
fn resulttab_never_fake_path() {
    let id = Uuid::new_v4();
    let tab = result_tab_descriptor(id).expect("descriptor");
    assert_eq!(tab.tab_kind, "ai_result");
    assert_eq!(tab.result_id, id);
    assert!(validate_result_tab_id(&format!("ai-result:{id}")).is_ok());
    assert!(validate_result_tab_id("C:\\Users\\someone\\report.txt").is_err());
    assert!(validate_result_tab_id("..\\..\\report.txt").is_err());
    assert!(validate_result_tab_id("ai-result:not-a-uuid").is_ok(), "shape check only; ids are validated by parse");
}
