//! Bounded in-memory history rules (Step 09j T4).
//!
//! Kept separate from the managed service so the eviction, pin, dedup,
//! search and page rules stay readable and independently tested.
#![allow(dead_code)]


use uuid::Uuid;

use crate::clipboard_history_payload::{
    any_file_missing, persist_entry, PersistEntry,
};
use crate::clipboard_history_types::{
    ClipboardHistoryItem, ClipboardHistoryKind, ClipboardHistoryPage, ClipboardHistoryPatch,
    HistoryItem, HistoryPayload, MAX_HISTORY_BYTES, MAX_HISTORY_ITEMS, MAX_PAGE_ITEMS,
    MAX_PINNED_ITEMS, MAX_REMOVE_IDS, MAX_SEARCH_CHARS,
};

/// The bounded memory history. Every mutation is all-or-nothing.
pub struct History {
    pub(crate) items: Vec<HistoryItem>,
    used_bytes: u64,
    generation: u64,
    max_items: usize,
    max_bytes: u64,
}

impl History {
    pub fn new(max_items: usize, max_bytes: u64) -> Self {
        History {
            items: Vec::new(),
            used_bytes: 0,
            generation: 1,
            max_items: max_items.clamp(1, MAX_HISTORY_ITEMS),
            max_bytes: max_bytes.min(MAX_HISTORY_BYTES),
        }
    }

    pub fn configure(&mut self, max_items: usize, max_bytes: u64) {
        self.max_items = max_items.clamp(1, MAX_HISTORY_ITEMS);
        self.max_bytes = max_bytes.min(MAX_HISTORY_BYTES);
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn used_bytes(&self) -> u64 {
        self.used_bytes
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn pinned_count(&self) -> usize {
        self.items.iter().filter(|item| item.pinned).count()
    }

    pub fn get(&self, id: &str) -> Option<&HistoryItem> {
        self.items.iter().find(|item| item.id.to_string() == id)
    }

    /// Load persisted entries in their saved order. Pinned entries stay
    /// pinned; the caps are applied again so a foreign oversized catalog
    /// cannot exceed them.
    pub fn restore(&mut self, mut items: Vec<HistoryItem>, generation: u64) {
        items.sort_by_key(|item| std::cmp::Reverse(item.created_unix));
        let mut pinned = 0usize;
        let mut bytes = 0u64;
        let mut kept = Vec::new();
        for mut item in items {
            if item.pinned {
                if pinned >= MAX_PINNED_ITEMS {
                    item.pinned = false;
                } else {
                    pinned += 1;
                }
            }
            bytes = bytes.saturating_add(item.byte_len);
            kept.push(item);
            if kept.len() >= self.max_items {
                break;
            }
        }
        while bytes > self.max_bytes {
            let Some(index) = kept.iter().rposition(|item| !item.pinned) else {
                break;
            };
            bytes = bytes.saturating_sub(kept[index].byte_len);
            kept.remove(index);
        }
        self.items = kept;
        self.used_bytes = bytes;
        self.generation = generation.max(1);
    }

    /// Insert one validated item. A duplicate moves to the top and keeps
    /// its pinned state; old unpinned entries are dropped first, and a
    /// full pinned budget refuses the new item without dropping anything.
    pub fn insert(&mut self, item: HistoryItem) -> Result<u64, String> {
        let mut next = self.items.clone();
        let mut inserted = item;
        if let Some(index) = next.iter().position(|existing| {
            existing.kind == inserted.kind
                && existing.content_hash == inserted.content_hash
                && same_file_list(existing, &inserted)
        }) {
            let existing = next.remove(index);
            // The item keeps its identity so a live image authority and
            // pinned state survive the duplicate copy.
            inserted.id = existing.id;
            inserted.pinned = existing.pinned;
            inserted.sensitive = existing.sensitive;
        }
        next.insert(0, inserted);
        let mut bytes: u64 = next.iter().map(|entry| entry.byte_len).sum();
        while next.len() > self.max_items || bytes > self.max_bytes {
            let Some(index) = next.iter().rposition(|entry| !entry.pinned) else {
                return Err("clipboard_history.full".to_string());
            };
            bytes = bytes.saturating_sub(next[index].byte_len);
            next.remove(index);
        }
        self.items = next;
        self.used_bytes = bytes;
        self.generation = self.generation.wrapping_add(1);
        Ok(self.generation)
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) -> Result<(), String> {
        let index = self
            .items
            .iter()
            .position(|item| item.id.to_string() == id)
            .ok_or_else(|| "clipboard_history.invalid".to_string())?;
        if pinned && !self.items[index].pinned && self.pinned_count() >= MAX_PINNED_ITEMS {
            return Err("clipboard_history.full".to_string());
        }
        if self.items[index].pinned != pinned {
            self.items[index].pinned = pinned;
            self.generation = self.generation.wrapping_add(1);
        }
        Ok(())
    }

    pub fn remove(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() || ids.len() > MAX_REMOVE_IDS {
            return Err("clipboard_history.invalid".to_string());
        }
        let mut parsed = Vec::new();
        for id in ids {
            let uuid = Uuid::parse_str(id).map_err(|_| "clipboard_history.invalid".to_string())?;
            if !self.items.iter().any(|item| item.id == uuid) {
                return Err("clipboard_history.invalid".to_string());
            }
            parsed.push(uuid);
        }
        self.items.retain(|item| !parsed.contains(&item.id));
        self.recount();
        self.generation = self.generation.wrapping_add(1);
        Ok(())
    }

    pub fn clear(&mut self, include_pinned: bool) {
        let before = self.items.len();
        if include_pinned {
            self.items.clear();
        } else {
            self.items.retain(|item| item.pinned);
        }
        if self.items.len() != before {
            self.recount();
            self.generation = self.generation.wrapping_add(1);
        }
    }

    fn recount(&mut self) {
        self.used_bytes = self.items.iter().map(|item| item.byte_len).sum();
    }

    pub fn apply_patch(&mut self, patch: &ClipboardHistoryPatch) -> Result<(), String> {
        if patch.expected_generation() != self.generation {
            return Err("clipboard_history.changed".to_string());
        }
        match patch {
            ClipboardHistoryPatch::Pin { id, pinned, .. } => self.set_pinned(id, *pinned),
            ClipboardHistoryPatch::Remove { ids, .. } => self.remove(ids),
            ClipboardHistoryPatch::Clear { include_pinned, .. } => {
                self.clear(*include_pinned);
                Ok(())
            }
        }
    }

    /// First page of the literal, case-folded search. `cursor` is the id
    /// of the last item of the previous page.
    pub fn page(
        &mut self,
        query: &str,
        cursor: Option<&str>,
    ) -> Result<ClipboardHistoryPage, String> {
        if query.chars().count() > MAX_SEARCH_CHARS {
            return Err("clipboard_history.invalid".to_string());
        }
        let needle = query.to_lowercase();
        let matching: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| matches(item, &needle))
            .map(|(index, _)| index)
            .collect();
        let start = match cursor {
            None => 0,
            Some(cursor) => {
                let uuid = Uuid::parse_str(cursor)
                    .map_err(|_| "clipboard_history.changed".to_string())?;
                let position = matching
                    .iter()
                    .position(|index| self.items[*index].id == uuid)
                    .ok_or_else(|| "clipboard_history.changed".to_string())?;
                position + 1
            }
        };
        let end = (start + MAX_PAGE_ITEMS).min(matching.len());
        self.refresh_missing(&matching[start..end]);
        let items: Vec<ClipboardHistoryItem> = matching[start..end]
            .iter()
            .map(|index| self.items[*index].to_wire())
            .collect();
        let next_cursor = if end < matching.len() {
            items.last().map(|item| item.id.clone())
        } else {
            None
        };
        Ok(ClipboardHistoryPage {
            items,
            next_cursor,
            complete: end >= matching.len(),
            total: matching.len().min(u32::MAX as usize) as u32,
            used_bytes: self.used_bytes,
            generation: self.generation,
        })
    }

    /// Bounded existence check for the visible file rows only.
    fn refresh_missing(&mut self, indices: &[usize]) {
        let mut checked = 0usize;
        for index in indices {
            if checked >= 20 {
                break;
            }
            let Some(item) = self.items.get_mut(*index) else {
                continue;
            };
            if let HistoryPayload::Files(paths) = &item.payload {
                checked += 1;
                item.missing = any_file_missing(paths);
            }
        }
    }

    pub fn persist_entries(&self) -> Vec<PersistEntry> {
        self.items
            .iter()
            .filter(|item| !item.sensitive)
            .map(persist_entry)
            .collect()
    }

    pub fn ids_of_kind(&self, kind: ClipboardHistoryKind) -> Vec<Uuid> {
        self.items
            .iter()
            .filter(|item| item.kind == kind)
            .map(|item| item.id)
            .collect()
    }
}

fn matches(item: &HistoryItem, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    if item.preview.to_lowercase().contains(needle) {
        return true;
    }
    if let HistoryPayload::Files(paths) = &item.payload {
        return paths
            .iter()
            .any(|path| path.to_lowercase().contains(needle));
    }
    false
}

fn same_file_list(a: &HistoryItem, b: &HistoryItem) -> bool {
    match (&a.payload, &b.payload) {
        (HistoryPayload::Files(left), HistoryPayload::Files(right)) => {
            let mut left: Vec<String> = left
                .iter()
                .map(|path| crate::clipboard_history_payload::normalized_file(path))
                .collect();
            let mut right: Vec<String> = right
                .iter()
                .map(|path| crate::clipboard_history_payload::normalized_file(path))
                .collect();
            left.sort();
            right.sort();
            left == right
        }
        _ => true,
    }
}

#[cfg(test)]
#[path = "clipboard_history_step09j_tests.rs"]
mod step09j_tests;
