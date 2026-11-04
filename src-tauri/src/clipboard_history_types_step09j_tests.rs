//! Contract tests for `clipboard_history_types` (Step 09j T4/T5).

use super::{
    ClipboardHistoryPatch, ClipboardHistorySettings, ClipboardHistorySource, HistoryItem,
    HistoryPayload, MAX_HISTORY_BYTES, MAX_PINNED_ITEMS,
};
use uuid::Uuid;

#[test]
fn settings_default_to_memory_only() {
    let settings = ClipboardHistorySettings::default();
    assert!(settings.enabled);
    assert!(!settings.capture_windows);
    assert!(!settings.persist);
    assert_eq!(settings.effective_items(), 100);
    assert_eq!(settings.effective_bytes(), MAX_HISTORY_BYTES);
    assert!(settings.validate().is_ok());
}

#[test]
fn settings_ranges_refuse_unsafe_values() {
    for items in [0u16, 9, 101, 1_000] {
        let settings = ClipboardHistorySettings {
            max_items: items,
            ..ClipboardHistorySettings::default()
        };
        assert_eq!(
            settings.validate(),
            Err("clipboard_history.invalid".to_string())
        );
    }
    for mib in [0u16, 7, 65, 512] {
        let settings = ClipboardHistorySettings {
            max_mib: mib,
            ..ClipboardHistorySettings::default()
        };
        assert_eq!(
            settings.validate(),
            Err("clipboard_history.invalid".to_string())
        );
    }
    assert_eq!(MAX_PINNED_ITEMS, 20);
}

#[test]
fn patch_variants_carry_the_expected_generation() {
    let pin: ClipboardHistoryPatch = serde_json::from_str(
        r#"{"kind":"pin","id":"6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a","pinned":true,"expected_generation":7}"#,
    )
    .unwrap();
    assert_eq!(pin.expected_generation(), 7);
    let clear: ClipboardHistoryPatch =
        serde_json::from_str(r#"{"kind":"clear","expected_generation":9}"#).unwrap();
    assert_eq!(clear.expected_generation(), 9);
    match clear {
        ClipboardHistoryPatch::Clear { include_pinned, .. } => assert!(!include_pinned),
        _ => panic!("clear expected"),
    }
    let remove: ClipboardHistoryPatch = serde_json::from_str(
        r#"{"kind":"remove","ids":[],"expected_generation":2}"#,
    )
    .unwrap();
    assert_eq!(remove.expected_generation(), 2);
    assert!(serde_json::from_str::<ClipboardHistoryPatch>(
        r#"{"kind":"clear","expected_generation":9,"unexpected":1}"#
    )
    .is_err());
}

#[test]
fn item_wire_has_no_payload_bytes() {
    let item = HistoryItem {
        id: Uuid::new_v4(),
        kind: super::ClipboardHistoryKind::Image,
        created_unix: 10,
        source: ClipboardHistorySource::Windows,
        source_label: None,
        preview: String::new(),
        byte_len: 1024,
        pinned: false,
        missing: false,
        sensitive: false,
        content_hash: "00".repeat(32),
        payload: HistoryPayload::image(
            "image/png".to_string(),
            2,
            2,
            vec![1, 2, 3, 4],
        ),
    };
    let value = serde_json::to_value(item.to_wire()).unwrap();
    assert!(value.get("payload").is_none());
    assert!(value.get("bytes").is_none());
    assert!(value.get("preview").is_some());
    assert_eq!(value["kind"], "image");
    assert_eq!(value["source"], "windows");
}
