//! Bounded history tests (Step 09j T4).

use super::History;
use crate::clipboard_history_payload::build_item;
use crate::clipboard_history_types::{
    CapturedPayload, ClipboardHistoryPatch, ClipboardHistorySource, MAX_HISTORY_BYTES,
    MAX_HISTORY_ITEMS, MAX_PINNED_ITEMS,
};
use uuid::Uuid;

fn text_item(text: &str, created: u64) -> crate::clipboard_history_types::HistoryItem {
    build_item(
        Uuid::new_v4(),
        CapturedPayload::Text(text.to_string()),
        ClipboardHistorySource::App,
        None,
        created,
    )
    .unwrap()
}

fn files_item(paths: &[&str]) -> crate::clipboard_history_types::HistoryItem {
    build_item(
        Uuid::new_v4(),
        CapturedPayload::Files(paths.iter().map(|path| path.to_string()).collect()),
        ClipboardHistorySource::App,
        None,
        1,
    )
    .unwrap()
}

fn history() -> History {
    History::new(MAX_HISTORY_ITEMS, MAX_HISTORY_BYTES)
}

#[test]
fn the_hundred_and_first_item_evicts_the_oldest_unpinned() {
    let mut history = history();
    let mut pinned = None;
    for index in 0..100u64 {
        let item = text_item(&format!("item {index}"), index + 1);
        if index == 0 {
            pinned = Some(item.id);
        }
        history.insert(item).unwrap();
    }
    let pinned = pinned.unwrap();
    history.set_pinned(&pinned.to_string(), true).unwrap();
    let oldest_unpinned = history
        .items
        .iter()
        .rfind(|item| !item.pinned)
        .unwrap()
        .id;
    history.insert(text_item("newest", 500)).unwrap();
    assert_eq!(history.len(), 100);
    assert!(history.get(&pinned.to_string()).is_some());
    assert!(history.get(&oldest_unpinned.to_string()).is_none());
}

#[test]
fn a_twenty_first_pin_is_refused_without_dropping_anything() {
    let mut history = history();
    let mut ids = Vec::new();
    for index in 0..=MAX_PINNED_ITEMS {
        let item = text_item(&format!("item {index}"), index as u64 + 1);
        ids.push(item.id);
        history.insert(item).unwrap();
    }
    for id in ids.iter().take(MAX_PINNED_ITEMS) {
        history.set_pinned(&id.to_string(), true).unwrap();
    }
    assert_eq!(history.pinned_count(), MAX_PINNED_ITEMS);
    assert_eq!(
        history.set_pinned(&ids[MAX_PINNED_ITEMS].to_string(), true),
        Err("clipboard_history.full".to_string())
    );
    assert_eq!(history.pinned_count(), MAX_PINNED_ITEMS);
    assert_eq!(history.len(), MAX_PINNED_ITEMS + 1);
}

#[test]
fn a_duplicate_moves_to_the_top_and_keeps_its_pin() {
    let mut history = history();
    let item = text_item("same text", 1);
    let id = item.id;
    history.insert(item).unwrap();
    history.set_pinned(&id.to_string(), true).unwrap();
    history.insert(text_item("other", 2)).unwrap();
    let generation = history.generation();
    history.insert(text_item("same text", 3)).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history.items[0].id, id);
    assert!(history.items[0].pinned);
    assert_eq!(history.generation(), generation + 1);
}

#[test]
fn clear_keeps_pinned_items_unless_asked() {
    let mut history = history();
    let pinned = text_item("pinned", 1);
    let pinned_id = pinned.id;
    history.insert(pinned).unwrap();
    history.insert(text_item("plain", 2)).unwrap();
    history.set_pinned(&pinned_id.to_string(), true).unwrap();
    history.clear(false);
    assert_eq!(history.len(), 1);
    assert_eq!(history.items[0].id, pinned_id);
    history.clear(true);
    assert!(history.is_empty());
}

#[test]
fn a_stale_generation_never_changes_history() {
    let mut history = history();
    history.insert(text_item("one", 1)).unwrap();
    let generation = history.generation();
    let patch = ClipboardHistoryPatch::Clear {
        include_pinned: true,
        expected_generation: generation + 1,
    };
    assert_eq!(
        history.apply_patch(&patch),
        Err("clipboard_history.changed".to_string())
    );
    assert_eq!(history.len(), 1);
}

#[test]
fn search_is_literal_casefolded_and_paged() {
    let mut history = History::new(100, MAX_HISTORY_BYTES);
    for index in 0..60 {
        history
            .insert(text_item(&format!("Report {index}"), index + 1))
            .unwrap();
    }
    history.insert(text_item("unrelated", 100)).unwrap();
    let page = history.page("report", None).unwrap();
    assert_eq!(page.items.len(), 50);
    assert_eq!(page.total, 60);
    assert!(!page.complete);
    let cursor = page.next_cursor.unwrap();
    let second = history.page("report", Some(&cursor)).unwrap();
    assert_eq!(second.items.len(), 10);
    assert!(second.complete);
    assert!(second.next_cursor.is_none());
    assert_eq!(
        history.page("report", Some("6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a")),
        Err("clipboard_history.changed".to_string())
    );
    assert_eq!(
        history.page(&"x".repeat(257), None),
        Err("clipboard_history.invalid".to_string())
    );
}

#[test]
fn file_deduplication_uses_the_normalized_list() {
    let mut history = history();
    history
        .insert(files_item(&[r"C:\a.txt", r"D:\b.txt"]))
        .unwrap();
    history
        .insert(files_item(&[r"d:\B.TXT", r"c:\A.TXT"]))
        .unwrap();
    assert_eq!(history.len(), 1);
}

#[test]
fn removing_an_unknown_id_is_refused() {
    let mut history = history();
    history.insert(text_item("one", 1)).unwrap();
    assert_eq!(
        history.remove(&["6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string()]),
        Err("clipboard_history.invalid".to_string())
    );
    assert_eq!(history.len(), 1);
}
