//! Opaque, bounded page cursors. A cursor belongs to one normalized query,
//! root set, generation and sort; it expires after 60 seconds.

use std::collections::HashMap;
#[cfg(test)]
use std::time::Duration;
use std::time::Instant;

use crate::limits::{CURSOR_TTL, MAX_CURSORS};
use crate::types::SearchQuery;
use crate::SearchError;

#[derive(Debug, Clone)]
pub struct CursorData {
    pub query: SearchQuery,
    pub generation: u64,
    pub offset: usize,
    created: Instant,
    /// Insertion order, so the oldest cursor is evicted even when two
    /// cursors share the same clock tick.
    sequence: u64,
}

pub struct CursorStore {
    max: usize,
    entries: HashMap<String, CursorData>,
    next_sequence: u64,
}

impl Default for CursorStore {
    fn default() -> Self {
        Self::new(MAX_CURSORS)
    }
}

impl CursorStore {
    pub fn new(max: usize) -> Self {
        Self {
            max: max.max(1),
            entries: HashMap::new(),
            next_sequence: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn insert(
        &mut self,
        query: &SearchQuery,
        generation: u64,
        offset: usize,
    ) -> Result<String, SearchError> {
        self.insert_at(query, generation, offset, Instant::now())
    }

    fn insert_at(
        &mut self,
        query: &SearchQuery,
        generation: u64,
        offset: usize,
        created: Instant,
    ) -> Result<String, SearchError> {
        self.purge_expired();
        if self.entries.len() >= self.max {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, cursor)| cursor.sequence)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                self.entries.remove(&id);
            }
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let id = uuid::Uuid::new_v4().to_string();
        self.entries.insert(
            id.clone(),
            CursorData {
                query: query.captured(),
                generation,
                offset,
                created,
                sequence,
            },
        );
        Ok(id)
    }

    /// Remove and return one cursor. A missing or expired cursor is
    /// `search.changed`; the UI then reloads the first page.
    pub fn take(&mut self, id: &str) -> Result<CursorData, SearchError> {
        let Some(cursor) = self.entries.remove(id) else {
            return Err(SearchError::Changed);
        };
        if cursor.created.elapsed() > CURSOR_TTL {
            return Err(SearchError::Changed);
        }
        Ok(cursor)
    }

    pub fn purge_expired(&mut self) {
        self.entries
            .retain(|_, cursor| cursor.created.elapsed() <= CURSOR_TTL);
    }

    #[cfg(test)]
    pub(crate) fn insert_for_test(
        &mut self,
        query: &SearchQuery,
        generation: u64,
        offset: usize,
        age: Duration,
    ) -> String {
        let created = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
        self.insert_at(query, generation, offset, created)
            .expect("test cursor")
    }
}

/// A cursor is usable only for the same captured query and index generation.
pub fn validate_cursor(
    cursor: &CursorData,
    query: &SearchQuery,
    generation: u64,
) -> Result<(), SearchError> {
    if cursor.generation != generation || cursor.query != query.captured() {
        return Err(SearchError::Changed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CursorStore;
    use crate::types::{SearchMode, SearchQuery};
    use std::time::Duration;

    fn query(text: &str) -> SearchQuery {
        SearchQuery {
            mode: SearchMode::Name,
            text: text.to_string(),
            ..SearchQuery::default()
        }
    }

    #[test]
    fn a_cursor_expires_after_sixty_seconds() {
        let mut store = CursorStore::default();
        let id = store.insert_for_test(&query("port"), 1, 50, Duration::from_secs(61));
        assert_eq!(store.take(&id).unwrap_err(), crate::SearchError::Changed);
    }

    #[test]
    fn only_sixteen_cursors_exist() {
        let mut store = CursorStore::new(16);
        let mut ids = Vec::new();
        for index in 0..17 {
            ids.push(
                store
                    .insert(&query(&format!("q{index}")), 1, index)
                    .unwrap(),
            );
        }
        assert_eq!(store.len(), 16);
        assert!(store.take(&ids[0]).is_err());
        assert!(store.take(&ids[16]).is_ok());
    }

    #[test]
    fn the_query_and_generation_are_bound_to_the_cursor() {
        let mut store = CursorStore::default();
        let id = store.insert(&query("port"), 7, 50).unwrap();
        let cursor = store.take(&id).unwrap();
        assert_eq!(cursor.generation, 7);
        assert_eq!(cursor.query, query("port"));
        assert_eq!(cursor.offset, 50);
    }
}
