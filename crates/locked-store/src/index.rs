//! The authenticated index (Step 09k D5): bounded JSON, deterministic order
//! and paged children. Names are decrypted only after the age final tag.

use std::cmp::Ordering;

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{LockedError, LockedResult};
use crate::limits::{Limits, MAX_INDEX_PLAIN_BYTES};
use crate::types::{LockedChunk, LockedEntry, LockedIndex};
use crate::validation::validate_index;

/// Most entries one page may carry.
pub const MAX_PAGE_ENTRIES: usize = 256;

pub fn build_index(
    container_id: Uuid,
    revision: u64,
    mut entries: Vec<LockedEntry>,
    mut chunk_records: Vec<LockedChunk>,
) -> LockedIndex {
    entries.sort_by(compare_entries);
    chunk_records.sort_by_key(|chunk| chunk.id);
    LockedIndex {
        schema_version: crate::limits::CONTAINER_SCHEMA_VERSION,
        container_id,
        revision,
        entries,
        chunk_records,
    }
}

pub fn encode_index(index: &LockedIndex, limits: &Limits) -> LockedResult<Zeroizing<Vec<u8>>> {
    validate_index(index, limits)?;
    let bytes = Zeroizing::new(serde_json::to_vec(index).map_err(|_| LockedError::Invalid)?);
    if bytes.len() as u64 > limits.max_index_plain_bytes
        || bytes.len() as u64 > MAX_INDEX_PLAIN_BYTES
    {
        return Err(LockedError::TooLarge);
    }
    Ok(bytes)
}

pub fn decode_index(bytes: &[u8], limits: &Limits) -> LockedResult<LockedIndex> {
    if bytes.len() as u64 > limits.max_index_plain_bytes {
        return Err(LockedError::TooLarge);
    }
    let index: LockedIndex =
        serde_json::from_slice(bytes).map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    validate_index(&index, limits)?;
    Ok(index)
}

pub fn compare_entries(left: &LockedEntry, right: &LockedEntry) -> Ordering {
    left.name
        .to_lowercase()
        .cmp(&right.name.to_lowercase())
        .then_with(|| left.name.cmp(&right.name))
        .then_with(|| left.id.cmp(&right.id))
}

pub fn entry(index: &LockedIndex, id: Uuid) -> Option<&LockedEntry> {
    index.entries.iter().find(|item| item.id == id)
}

pub fn entry_mut(index: &mut LockedIndex, id: Uuid) -> Option<&mut LockedEntry> {
    index.entries.iter_mut().find(|item| item.id == id)
}

/// One page of direct children, sorted by name and then id. `cursor` is the
/// last id already shown; an unknown cursor is refused rather than guessed.
pub fn children_page(
    index: &LockedIndex,
    parent_id: Option<Uuid>,
    cursor: Option<Uuid>,
) -> LockedResult<(Vec<LockedEntry>, Option<Uuid>, bool)> {
    if let Some(parent) = parent_id {
        let parent_entry = entry(index, parent).ok_or(LockedError::Invalid)?;
        if !parent_entry.is_folder() {
            return Err(LockedError::Invalid);
        }
    }
    let mut items: Vec<&LockedEntry> = index
        .entries
        .iter()
        .filter(|item| item.parent_id == parent_id)
        .collect();
    items.sort_by(|left, right| compare_entries(left, right));
    let start = match cursor {
        Some(id) => items
            .iter()
            .position(|item| item.id == id)
            .map(|position| position + 1)
            .ok_or(LockedError::Invalid)?,
        None => 0,
    };
    let end = (start + MAX_PAGE_ENTRIES).min(items.len());
    let page = items[start..end]
        .iter()
        .map(|item| (**item).clone())
        .collect::<Vec<_>>();
    let next_cursor = if end < items.len() {
        page.last().map(|item| item.id)
    } else {
        None
    };
    Ok((page, next_cursor, next_cursor.is_none()))
}

pub fn entry_count(index: &LockedIndex) -> u32 {
    u32::try_from(index.entries.len()).unwrap_or(u32::MAX)
}

/// Replace one entry's bytes in the index: new chunk ids in content order and
/// the exact length. The caller supplies already encrypted chunks.
pub fn set_entry_content(
    index: &mut LockedIndex,
    id: Uuid,
    chunks: Vec<Uuid>,
    size: u64,
    modified_unix: u64,
) -> LockedResult<()> {
    let target = entry_mut(index, id).ok_or(LockedError::Invalid)?;
    if !target.is_file() {
        return Err(LockedError::Invalid);
    }
    target.chunks = chunks;
    target.size = size;
    target.modified_unix = modified_unix;
    Ok(())
}

/// Remove records no entry references any more (used by pending copies).
pub fn trim_unused_chunks(index: &mut LockedIndex) {
    let used: std::collections::HashSet<Uuid> = index
        .entries
        .iter()
        .flat_map(|entry| entry.chunks.iter().copied())
        .collect();
    index.chunk_records.retain(|chunk| used.contains(&chunk.id));
    index.chunk_records.sort_by_key(|chunk| chunk.id);
}
