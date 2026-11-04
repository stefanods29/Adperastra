//! Native inspection registry and paging (Step 08c D3/T2).
//!
//! An inspection ID authorizes inspection results only. Cleaning revalidates
//! source identity; it never treats an ID as mutation authorization.
#![allow(dead_code)]


use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use fs_service::SourceStamp;
use privacy::{PrivacyField, PrivacyInspection, PrivacyInspectionPage};
use serde::{Deserialize, Serialize};

pub const MAX_INSPECTIONS: usize = 10_000;
pub const MAX_PAGE_ROWS: usize = 256;
pub const MAX_PAGE_BYTES: usize = 768 * 1024;
pub const INSPECTION_LIFETIME_SECS: u64 = 300;
pub const MAX_PAGE_CURSORS: usize = 10_000;

/// One stored inspection plus provenance the UI never receives.
#[derive(Debug, Clone)]
pub struct StoredInspection {
    pub inspection: PrivacyInspection,
    pub fields: Vec<PrivacyField>,
    pub source: Option<SourceStamp>,
    pub input_name: String,
    /// Hash of the exact bytes that were inspected. Cleaning refuses a source
    /// whose current bytes do not match, even when its stamp looks unchanged.
    pub content_hash: [u8; 32],
    /// The adapter chosen at inspection time; cleaning never re-derives it
    /// from a possibly renamed path or a different MIME source.
    pub adapter: String,
    /// Position in the original inspection batch, used by the shared report.
    pub input_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageCursor {
    pub ids: Vec<String>,
    pub inspection_index: usize,
    pub field_index: usize,
    pub expires_unix: u64,
}

#[derive(Default)]
struct Inner {
    inspections: HashMap<String, StoredInspection>,
    order: VecDeque<String>,
    cursors: HashMap<String, PageCursor>,
    cursor_order: VecDeque<String>,
}

#[derive(Default)]
pub struct PrivacySessions {
    inner: Mutex<Inner>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

impl PrivacySessions {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "privacy.sessions_lock".to_string())
    }

    /// Store one inspection; the oldest entries are dropped first.
    #[allow(clippy::too_many_arguments)]
    pub fn store(
        &self,
        mut inspection: PrivacyInspection,
        fields: Vec<PrivacyField>,
        source: Option<SourceStamp>,
        input_name: String,
        content_hash: [u8; 32],
        adapter: String,
        input_index: u32,
    ) -> Result<(), String> {
        let mut inner = self.lock()?;
        let now = now_unix();
        inspection.expires_unix = now.saturating_add(INSPECTION_LIFETIME_SECS);
        while inner.inspections.len() >= MAX_INSPECTIONS {
            if let Some(oldest) = inner.order.pop_front() {
                inner.inspections.remove(&oldest);
            } else {
                break;
            }
        }
        inner.order.push_back(inspection.inspection_id.clone());
        inner.inspections.insert(
            inspection.inspection_id.clone(),
            StoredInspection {
                inspection,
                fields,
                source,
                input_name,
                content_hash,
                adapter,
                input_index,
            },
        );
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<StoredInspection, String> {
        let mut inner = self.lock()?;
        let now = now_unix();
        let expired = inner
            .inspections
            .get(id)
            .map(|stored| stored.inspection.expires_unix <= now)
            .unwrap_or(false);
        if expired {
            inner.inspections.remove(id);
            inner.order.retain(|value| value != id);
            return Err("privacy.changed".to_string());
        }
        inner
            .inspections
            .get(id)
            .cloned()
            .ok_or_else(|| "privacy.changed".to_string())
    }

    /// Idempotent release; an unknown or already released ID is not an error.
    pub fn release(&self, id: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.inspections.remove(id);
            inner.order.retain(|value| value != id);
            inner.cursors.retain(|_, cursor| !cursor.ids.iter().any(|value| value == id));
        }
    }

    /// First page across the listed inspections, with a native cursor.
    pub fn first_page(&self, ids: &[String]) -> Result<PrivacyInspectionPage, String> {
        self.page_from(ids, 0, 0)
    }

    fn page_from(
        &self,
        ids: &[String],
        mut inspection_index: usize,
        mut field_index: usize,
    ) -> Result<PrivacyInspectionPage, String> {
        let inner = self.lock()?;
        let now = now_unix();
        let mut items = Vec::new();
        let mut used = 2usize;
        let mut rows = 0usize;
        while inspection_index < ids.len() && rows < MAX_PAGE_ROWS {
            let Some(stored) = inner.inspections.get(&ids[inspection_index]) else {
                inspection_index += 1;
                field_index = 0;
                continue;
            };
            if stored.inspection.expires_unix <= now {
                inspection_index += 1;
                field_index = 0;
                continue;
            }
            if field_index >= stored.fields.len() {
                inspection_index += 1;
                field_index = 0;
                continue;
            }
            let remaining_rows = MAX_PAGE_ROWS - rows;
            let remaining_bytes = MAX_PAGE_BYTES.saturating_sub(used);
            let (fields, next_index) =
                catalog_page(&stored.fields, field_index, remaining_rows, remaining_bytes)?;
            let size = serde_json::to_vec(&fields)
                .map_err(|_| "privacy.serialize".to_string())?
                .len();
            used = used.saturating_add(size);
            rows = rows.saturating_add(fields.len());
            let mut inspection = stored.inspection.clone();
            inspection.fields = fields;
            inspection.next_cursor = None;
            inspection.complete = next_index.is_none();
            items.push(inspection);
            if let Some(index) = next_index {
                field_index = index;
            } else {
                inspection_index += 1;
                field_index = 0;
            }
        }
        let complete = inspection_index >= ids.len();
        let next_cursor = if complete {
            None
        } else {
            Some(uuid::Uuid::new_v4().to_string())
        };
        drop(inner);
        if let Some(cursor) = &next_cursor {
            let mut inner = self.lock()?;
            while inner.cursors.len() >= MAX_PAGE_CURSORS {
                if let Some(oldest) = inner.cursor_order.pop_front() {
                    inner.cursors.remove(&oldest);
                } else {
                    break;
                }
            }
            inner.cursor_order.push_back(cursor.clone());
            inner.cursors.insert(
                cursor.clone(),
                PageCursor {
                    ids: ids.to_vec(),
                    inspection_index,
                    field_index,
                    expires_unix: now.saturating_add(INSPECTION_LIFETIME_SECS),
                },
            );
        }
        Ok(PrivacyInspectionPage {
            items,
            next_cursor,
            complete,
        })
    }

    pub fn next_page(&self, cursor: &str) -> Result<PrivacyInspectionPage, String> {
        let stored = {
            let mut inner = self.lock()?;
            let id = cursor.to_string();
            let cursor = inner
                .cursors
                .remove(&id)
                .ok_or_else(|| "privacy.bad_request".to_string())?;
            inner.cursor_order.retain(|value| value != &id);
            if cursor.expires_unix <= now_unix() {
                return Err("privacy.changed".to_string());
            }
            cursor
        };
        self.page_from(&stored.ids, stored.inspection_index, stored.field_index)
    }

    pub fn retain_only(&self, keep: &[String]) -> Result<(), String> {
        let mut inner = self.lock()?;
        inner
            .inspections
            .retain(|id, _| keep.iter().any(|value| value == id));
        inner.order.retain(|id| keep.iter().any(|value| value == id));
        Ok(())
    }
}

/// A bounded page of fields, shared by sessions and the paging test.
pub fn catalog_page(
    fields: &[PrivacyField],
    start: usize,
    max_rows: usize,
    max_bytes: usize,
) -> Result<(Vec<PrivacyField>, Option<usize>), String> {
    if start > fields.len() {
        return Err("privacy.bad_request".to_string());
    }
    let mut page = Vec::new();
    let mut used = 2usize;
    let mut index = start;
    while index < fields.len() && page.len() < max_rows {
        let size = serde_json::to_vec(&fields[index])
            .map_err(|_| "privacy.serialize".to_string())?
            .len();
        if !page.is_empty() && used + size > max_bytes {
            break;
        }
        used += size;
        page.push(fields[index].clone());
        index += 1;
    }
    Ok((page, (index < fields.len()).then_some(index)))
}

#[cfg(test)]
mod tests {
    use super::{catalog_page, MAX_PAGE_ROWS};
    use privacy::{Coverage, MetadataCategory, MetadataContainer, PrivacyField};

    fn field(index: usize) -> PrivacyField {
        PrivacyField {
            category: MetadataCategory::Author,
            containers: vec![MetadataContainer::Exif],
            related_categories: Vec::new(),
            field_id: format!("test.{index}"),
            label_key: "privacy.author".to_string(),
            preview: String::new(),
            count: 1,
            content_affecting: false,
            coverage: Coverage::Complete,
        }
    }

    #[test]
    fn two_hundred_fifty_seven_fields_page_instead_of_truncating() {
        let fields: Vec<PrivacyField> = (0..257).map(field).collect();
        let (first, next) = catalog_page(&fields, 0, MAX_PAGE_ROWS, 768 * 1024).unwrap();
        assert_eq!(first.len(), 256);
        assert_eq!(next, Some(256));
        let (second, next) = catalog_page(&fields, next.unwrap(), MAX_PAGE_ROWS, 768 * 1024).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(next, None);
    }
}
