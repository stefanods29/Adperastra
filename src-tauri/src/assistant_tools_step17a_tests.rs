use super::*;
use serde_json::json;
use uuid::Uuid;

fn id() -> Uuid {
    Uuid::new_v4()
}

#[test]
fn irreversible_never_listed() {
    assert!(specs().iter().all(|row| row.risk != AssistantRisk::Irreversible));
    let capabilities = vec![
        "assistant.tabs".to_string(),
        "assistant.recycle".to_string(),
    ];
    let listed = list_for_capabilities(&capabilities, true);
    assert!(listed.iter().all(|row| row.risk != AssistantRisk::Irreversible));
    assert!(listed.iter().any(|row| row.tool_id == "recycle_items"));
    assert!(spec("permanent_delete").is_none());
}

#[test]
fn unknown_tool_refused() {
    let raw = json!({ "tool_id": "permanent_delete", "input_ids": [id()] });
    assert_eq!(
        parse_arguments("permanent_delete", &raw).unwrap_err(),
        "assistant.invalid_tool"
    );
    let raw = json!({ "tool_id": "recycle_items", "input_ids": [id()], "confirmed": true });
    assert_eq!(
        parse_arguments("recycle_items", &raw).unwrap_err(),
        "assistant.invalid_arguments"
    );
    let raw = json!({ "tool_id": "switch_tab", "tab_id": "tab-1", "extra": "x" });
    assert!(parse_arguments("switch_tab", &raw).is_err());
}

#[test]
fn create_text_preview_not_write() {
    let temp = tempfile::tempdir().unwrap();
    let raw = json!({
        "tool_id": "create_file",
        "parent_root_id": id(),
        "name": "notes.txt",
        "format": "text",
        "content": "Meeting at 10."
    });
    let args = parse_arguments("create_file", &raw).unwrap();
    assert_eq!(args.tool_id(), "create_file");
    assert!(crate::assistant_policy::requires_human_apply("create_file"));
    assert!(!crate::assistant_policy::is_read_only("create_file"));
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn convert_missing_accepted_warning_codes_refused() {
    let input = id();
    let raw = json!({
        "tool_id": "convert",
        "input_ids": [input],
        "converter_id": "image/png",
        "format": "jpeg",
        "options": { "kind": "image" },
        "target_root_id": id(),
        "accepted_losses": []
    });
    assert_eq!(
        parse_arguments("convert", &raw).unwrap_err(),
        "assistant.invalid_arguments"
    );
    let raw = json!({
        "tool_id": "convert",
        "input_ids": [input],
        "converter_id": "image/png",
        "format": "jpeg",
        "options": { "kind": "image" },
        "target_root_id": id(),
        "accepted_losses": ["exif"],
        "accepted_warning_codes": ["transparency_loss"]
    });
    assert!(parse_arguments("convert", &raw).is_ok());
    let raw = json!({
        "tool_id": "convert",
        "input_ids": [input],
        "converter_id": "image/png",
        "format": "jpeg",
        "options": { "kind": "image" },
        "target_root_id": id(),
        "accepted_losses": ["not_a_category"],
        "accepted_warning_codes": ["transparency_loss"]
    });
    assert!(parse_arguments("convert", &raw).is_err());
}

#[test]
fn two_toolcalls_refused() {
    let first = json!({ "tool_id": "open_tab" });
    let second = json!({ "tool_id": "switch_tab" });
    assert!(one_tool_call(&[]).unwrap().is_none());
    assert!(one_tool_call(std::slice::from_ref(&first)).unwrap().is_some());
    assert_eq!(
        one_tool_call(&[first, second]).unwrap_err(),
        "assistant.invalid_arguments"
    );
}

#[test]
fn permanent_delete_not_representable() {
    assert!(!permanent_delete_representable());
    let parsed = parse_arguments(
        "recycle_items",
        &json!({ "tool_id": "recycle_items", "input_ids": [id()] }),
    )
    .unwrap();
    assert!(matches!(parsed, AssistantToolArguments::RecycleItems { .. }));
    assert_eq!(parsed.tool_id(), "recycle_items");
}
