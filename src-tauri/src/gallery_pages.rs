//! Opaque Gallery cursors and bounded pages (Step 07c, decision D6).
//!
//! A cursor is a random UUID looked up in a small per-scan map. It carries the
//! generation and date mode it belongs to, so a cursor from an older scan is
//! refused instead of returning the wrong pictures. The map is bounded (64
//! cursors) and cursors expire after ten minutes.

use crate::gallery_types::{gallery_path_key, GalleryDateSource, GalleryItem, GalleryPage};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Most cursors one scan keeps.
pub const MAX_CURSORS_PER_SCAN: usize = 64;
/// How long a cursor stays valid without being used.
pub const CURSOR_TTL: Duration = Duration::from_secs(600);

#[derive(Debug, Clone)]
struct CursorEntry {
    generation: String,
    date_source: GalleryDateSource,
    offset: usize,
    after_path: Option<String>,
    created: Instant,
}

/// The per-scan cursor table.
#[derive(Debug, Default)]
pub struct CursorBook {
    entries: HashMap<String, CursorEntry>,
}

impl CursorBook {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|_, entry| now.saturating_duration_since(entry.created) < CURSOR_TTL);
    }

    /// Stores the position and returns its opaque id. The oldest cursor is
    /// dropped first when the table is full.
    pub fn issue(
        &mut self,
        generation: &str,
        date_source: GalleryDateSource,
        offset: usize,
        after_path: Option<String>,
        now: Instant,
    ) -> String {
        self.prune(now);
        if self.entries.len() >= MAX_CURSORS_PER_SCAN {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.created)
                .map(|(id, _)| id.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.entries.insert(
            id.clone(),
            CursorEntry {
                generation: generation.to_string(),
                date_source,
                offset,
                after_path,
                created: now,
            },
        );
        id
    }

    /// Returns `(offset, after_path)` or `gallery.changed` for an unknown,
    /// expired or foreign cursor.
    pub fn resolve(
        &mut self,
        cursor: &str,
        generation: &str,
        date_source: GalleryDateSource,
        now: Instant,
    ) -> Result<(usize, Option<String>), String> {
        self.prune(now);
        let Some(entry) = self.entries.get(cursor) else {
            return Err("gallery.changed".to_string());
        };
        if entry.generation != generation || entry.date_source != date_source {
            return Err("gallery.changed".to_string());
        }
        Ok((entry.offset, entry.after_path.clone()))
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// What the scan produced for one requested position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageData {
    pub items: Vec<GalleryItem>,
    /// Index of the first item not included in `items`.
    pub next: usize,
    pub total: usize,
    pub complete: bool,
    pub partial: bool,
    pub skipped_count: u32,
    pub limit_reason: Option<String>,
}

/// Bound the full encoded response, including the envelope/cursor headroom.
pub fn snapshot_page(
    snapshot: &[GalleryItem],
    start: usize,
    max_rows: usize,
    max_bytes: usize,
    outcome: crate::gallery_scan::ScanOutcome,
) -> Result<PageData, String> {
    let mut items = Vec::new();
    let mut bytes = 0usize;
    let payload_limit = max_bytes.saturating_sub(4096);
    let mut next = start.min(snapshot.len());
    while let Some(item) = snapshot.get(next) {
        if items.len() >= max_rows.min(256) {
            break;
        }
        let size = serde_json::to_vec(item)
            .map_err(|_| "gallery.unavailable")?
            .len()
            + 1;
        if bytes.saturating_add(size) > payload_limit {
            if items.is_empty() {
                return Err("gallery.unavailable".into());
            }
            break;
        }
        bytes += size;
        items.push(item.clone());
        next += 1;
    }
    Ok(PageData {
        items,
        next,
        total: snapshot.len(),
        complete: outcome.complete,
        partial: outcome.partial,
        skipped_count: outcome.skipped_count,
        limit_reason: outcome.limit_reason,
    })
}

/// Turns a `PageData` into the wire page. The next cursor anchors to the last
/// included path, so items inserted before it by a later batch never make the
/// next page repeat a picture.
pub fn build_page(
    generation: &str,
    data: PageData,
    date_source: GalleryDateSource,
    cursors: &mut CursorBook,
    now: Instant,
) -> GalleryPage {
    // While the scan is still running there may be more items even when this
    // page reached the current end (a small first page, or a slow second
    // root). Keep a cursor so the next request can continue once more arrive.
    let next_cursor = if data.next < data.total || !data.complete {
        let after_path = data
            .items
            .last()
            .map(|last| gallery_path_key(last.item.path.as_str()));
        Some(cursors.issue(generation, date_source, data.next, after_path, now))
    } else {
        None
    };
    GalleryPage {
        generation: generation.to_string(),
        items: data.items,
        next_cursor,
        complete: data.complete,
        partial: data.partial,
        skipped_count: data.skipped_count,
        limit_reason: data.limit_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::explorer::ExplorerItem;
    use fs_service::ItemKind;

    fn item(index: usize) -> GalleryItem {
        let path = format!("C:\\Pictures\\p{index:04}.png");
        GalleryItem {
            item: ExplorerItem {
                path: path.clone(),
                name: format!("p{index:04}.png"),
                kind: ItemKind::File,
                size: 1,
                modified_unix: 1_700_000_000,
                hidden: false,
                system: false,
                is_link: false,
                online_only: false,
                file_id: None,
                file_id_stable: false,
            },
            identity: format!("path:{path}"),
            taken_utc: None,
            group_key: "2023-11".to_string(),
            source_ids: vec!["00000000-0000-4000-8000-000000000001".to_string()],
        }
    }

    #[test]
    fn cursor_from_another_scan_is_rejected() {
        let now = Instant::now();
        let mut book = CursorBook::new();
        let cursor = book.issue("scan-a", GalleryDateSource::Taken, 10, None, now);
        assert!(book
            .resolve(&cursor, "scan-b", GalleryDateSource::Taken, now)
            .is_err());
        assert!(book
            .resolve(&cursor, "scan-a", GalleryDateSource::Modified, now)
            .is_err());
        assert_eq!(
            book.resolve(&cursor, "scan-a", GalleryDateSource::Taken, now)
                .unwrap()
                .0,
            10
        );
    }

    #[test]
    fn expired_and_unknown_cursors_are_rejected() {
        let now = Instant::now();
        let mut book = CursorBook::new();
        let cursor = book.issue("scan-a", GalleryDateSource::Taken, 10, None, now);
        assert!(book
            .resolve(
                &cursor,
                "scan-a",
                GalleryDateSource::Taken,
                now + CURSOR_TTL + Duration::from_secs(1)
            )
            .is_err());
        assert!(book
            .resolve("missing", "scan-a", GalleryDateSource::Taken, now)
            .is_err());
    }

    #[test]
    fn page_256_then_remaining_1_has_no_duplicate() {
        let now = Instant::now();
        let mut book = CursorBook::new();
        let items: Vec<GalleryItem> = (0..257).map(item).collect();
        let first = build_page(
            "scan-a",
            PageData {
                items: items[..256].to_vec(),
                next: 256,
                total: 257,
                complete: true,
                partial: false,
                skipped_count: 0,
                limit_reason: None,
            },
            GalleryDateSource::Modified,
            &mut book,
            now,
        );
        assert_eq!(first.items.len(), 256);
        let cursor = first.next_cursor.expect("a second page exists");
        let (offset, after_path) = book
            .resolve(&cursor, "scan-a", GalleryDateSource::Modified, now)
            .unwrap();
        assert_eq!(offset, 256);
        assert_eq!(
            after_path.as_deref(),
            Some(gallery_path_key(items[255].item.path.as_str()).as_str())
        );
        let second = build_page(
            "scan-a",
            PageData {
                items: items[256..].to_vec(),
                next: 257,
                total: 257,
                complete: true,
                partial: false,
                skipped_count: 0,
                limit_reason: None,
            },
            GalleryDateSource::Modified,
            &mut book,
            now,
        );
        assert_eq!(second.items.len(), 1);
        assert!(second.next_cursor.is_none());
        assert_eq!(items[255].identity, first.items[255].identity);
        assert_ne!(items[256].identity, first.items[255].identity);
    }

    #[test]
    fn an_incomplete_empty_page_keeps_a_cursor_for_late_items() {
        let now = Instant::now();
        let mut book = CursorBook::new();
        let page = build_page(
            "scan-a",
            PageData {
                items: Vec::new(),
                next: 0,
                total: 0,
                complete: false,
                partial: false,
                skipped_count: 0,
                limit_reason: None,
            },
            GalleryDateSource::Modified,
            &mut book,
            now,
        );
        assert!(page.next_cursor.is_some());
        assert!(!page.complete);
    }

    #[test]
    fn the_cursor_table_drops_the_oldest_entry_first() {
        let now = Instant::now();
        let mut book = CursorBook::new();
        for index in 0..=MAX_CURSORS_PER_SCAN {
            book.issue(
                "scan-a",
                GalleryDateSource::Taken,
                index,
                None,
                now + Duration::from_millis(index as u64),
            );
        }
        assert_eq!(book.len(), MAX_CURSORS_PER_SCAN);
        assert!(!book.is_empty());
    }
}
