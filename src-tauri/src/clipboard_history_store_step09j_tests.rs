//! Encrypted-store tests (Step 09j T5). DPAPI runs for real under the
//! current test account; the real second-user fixture is coordinator-run.

use super::{open_record, seal_record, ClipboardHistoryStore, KIND_CATALOG};
use crate::clipboard_history_payload::{build_item, persist_entry};
use crate::clipboard_history_types::{
    CapturedPayload, ClipboardHistorySource, HistoryPayload,
};
use uuid::Uuid;

fn text_entry(text: &str) -> crate::clipboard_history_payload::PersistEntry {
    let item = build_item(
        Uuid::new_v4(),
        CapturedPayload::Text(text.to_string()),
        ClipboardHistorySource::App,
        None,
        10,
    )
    .unwrap();
    persist_entry(&item)
}

fn files_entry(paths: &[&str]) -> crate::clipboard_history_payload::PersistEntry {
    let item = build_item(
        Uuid::new_v4(),
        CapturedPayload::Files(paths.iter().map(|path| path.to_string()).collect()),
        ClipboardHistorySource::App,
        None,
        11,
    )
    .unwrap();
    persist_entry(&item)
}

fn image_entry() -> crate::clipboard_history_payload::PersistEntry {
    let item = build_item(
        Uuid::new_v4(),
        CapturedPayload::Image {
            mime: "image/png".to_string(),
            width: 2,
            height: 2,
            bytes: vec![1, 2, 3, 4],
        },
        ClipboardHistorySource::Windows,
        None,
        12,
    )
    .unwrap();
    persist_entry(&item)
}

#[test]
fn nothing_is_written_until_persistence_is_enabled() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("clipboard-history");
    let store = ClipboardHistoryStore::new(root.clone());
    assert_eq!(store.usage(), 0);
    assert!(!root.exists());
    assert!(store.load().unwrap().0.is_empty());
}

#[test]
fn text_files_and_images_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    let entries = vec![
        text_entry("hello world"),
        files_entry(&[r"C:\Users\me\a.txt", r"D:\b.txt"]),
        image_entry(),
    ];
    store.write(&entries, 9).unwrap();
    let (items, generation) = store.load().unwrap();
    assert_eq!(generation, 9);
    assert_eq!(items.len(), 3);
    let text = items
        .iter()
        .find(|item| item.kind == crate::clipboard_history_types::ClipboardHistoryKind::Text)
        .unwrap();
    match &text.payload {
        HistoryPayload::Text(value) => assert_eq!(&**value, "hello world"),
        _ => panic!("text payload expected"),
    }
    let image = items
        .iter()
        .find(|item| item.kind == crate::clipboard_history_types::ClipboardHistoryKind::Image)
        .unwrap();
    match &image.payload {
        HistoryPayload::Image { bytes, width, .. } => {
            assert_eq!(&**bytes, [1, 2, 3, 4]);
            assert_eq!(*width, 2);
        }
        _ => panic!("image payload expected"),
    }
}

#[test]
fn metadata_and_payloads_are_not_stored_as_plaintext() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    store
        .write(
            &[
                text_entry("SECRET-SNIPPET"),
                files_entry(&[r"C:\Users\me\private-report.txt"]),
            ],
            2,
        )
        .unwrap();
    let catalog = std::fs::read(store.catalog_path()).unwrap();
    assert!(!contains(&catalog, b"SECRET-SNIPPET"));
    assert!(!contains(&catalog, b"private-report"));
    for entry in std::fs::read_dir(store.payload_dir()).unwrap().flatten() {
        let bytes = std::fs::read(entry.path()).unwrap();
        assert!(!contains(&bytes, b"SECRET-SNIPPET"));
        assert!(!contains(&bytes, b"private-report"));
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|part| part == needle)
}

#[test]
fn a_corrupt_catalog_is_never_parsed_as_plaintext() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    std::fs::create_dir_all(store.root()).unwrap();
    std::fs::write(
        store.catalog_path(),
        br#"{"schema":1,"generation":1,"items":[]}"#,
    )
    .unwrap();
    assert!(store.load().is_err());
    assert!(store.catalog_path().exists());
}

#[test]
fn a_newer_catalog_schema_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    std::fs::create_dir_all(store.root()).unwrap();
    let plain = br#"{"schema":2,"generation":3,"items":[]}"#;
    let sealed = seal_record(KIND_CATALOG, plain).unwrap();
    std::fs::write(store.catalog_path(), sealed).unwrap();
    assert!(store.load().is_err());
}

#[test]
fn dpapi_wrong_user_fails() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    store.write(&[text_entry("private")], 1).unwrap();
    let payload = std::fs::read_dir(store.payload_dir())
        .unwrap()
        .flatten()
        .next()
        .unwrap()
        .path();
    let mut bytes = std::fs::read(&payload).unwrap();
    // A record from another Windows account (or a tampered one) fails
    // DPAPI integrity; the real second-user blob is the coordinator
    // fixture named in the guide.
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    assert!(open_record(
        super::KIND_PAYLOAD,
        &bytes,
        super::MAX_STORED_PAYLOAD
    )
    .is_err());
}

#[test]
fn clear_removes_only_owned_history_and_keeps_foreign_files() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    let entry = text_entry("owned");
    let owned_id = entry.id;
    store.write(&[entry], 1).unwrap();
    std::fs::write(store.root().join("foreign.txt"), b"keep me").unwrap();
    std::fs::write(store.payload_dir().join("foreign.bin"), b"keep me too").unwrap();
    store.clear_owned().unwrap();
    assert!(!store.catalog_path().exists());
    assert!(!store.payload_path(owned_id).exists());
    assert!(store.root().join("foreign.txt").exists());
    assert!(store.payload_dir().join("foreign.bin").exists());
    assert!(store.load().unwrap().0.is_empty());
}

#[test]
fn an_unchanged_payload_is_not_encrypted_again() {
    let dir = tempfile::tempdir().unwrap();
    let store = ClipboardHistoryStore::new(dir.path().join("clipboard-history"));
    let entry = image_entry();
    let id = entry.id;
    store.write(std::slice::from_ref(&entry), 1).unwrap();
    let first = std::fs::read(store.payload_path(id)).unwrap();
    store.write(&[entry], 2).unwrap();
    let second = std::fs::read(store.payload_path(id)).unwrap();
    assert_eq!(first, second);
}
