//! Durable tag membership mirror for the Step 11a search index (Step 11b
//! T2, U4).
//!
//! The tag store queues one `PendingMirror` per changed record after its
//! SQLite commit. This module drains that queue in batches of at most 256
//! and hands each update to `search_index::search_tags`. There is no IPC
//! command that accepts a caller-chosen membership row: only this bridge,
//! fed by the authoritative store, can change the index.
//!
//! Each update carries the full membership of the record plus the store's
//! durable mirror revision. The revision only grows (also through Undo and
//! restarts), so the index's staleness gate accepts the newest state and a
//! delayed older batch can never overwrite it.

use std::collections::{HashMap, VecDeque};

use search_index::store::SearchStore;
use search_index::types::TagSearchUpdate;

use crate::tag_store::{PendingMirror, TagStore};
use crate::tag_types::assignment_lookup;

/// The most updates one index transaction may carry (Step 11a bound).
pub const MIRROR_BATCH: usize = 256;

/// Convert one durable mirror into the canonical index update.
pub fn to_update(mirror: &PendingMirror) -> TagSearchUpdate {
    TagSearchUpdate {
        key: mirror.key.clone(),
        tag_ids: mirror.tag_ids.clone(),
        deleted: mirror.deleted,
        revision: mirror.revision,
    }
}

/// Keep only the newest update per record. Equal or older revisions that
/// were queued before a newer state are dropped instead of replayed.
pub fn latest_per_key(mirrors: Vec<PendingMirror>) -> Vec<PendingMirror> {
    let mut chosen: HashMap<String, usize> = HashMap::new();
    for (index, mirror) in mirrors.iter().enumerate() {
        let lookup = assignment_lookup(&mirror.key);
        match chosen.get(&lookup) {
            Some(&existing) if mirrors[existing].revision >= mirror.revision => {}
            _ => {
                chosen.insert(lookup, index);
            }
        }
    }
    let mut indices: Vec<usize> = chosen.into_values().collect();
    indices.sort_unstable();
    indices
        .into_iter()
        .filter_map(|index| mirrors.get(index).cloned())
        .collect()
}

/// Split the queued mirrors into index-sized batches. The order of the
/// first appearance of each record is kept, so a later generation never
/// overtakes an earlier one for a different record.
pub fn batches(mirrors: Vec<PendingMirror>) -> Vec<Vec<PendingMirror>> {
    let latest = latest_per_key(mirrors);
    latest.chunks(MIRROR_BATCH).map(|chunk| chunk.to_vec()).collect()
}

/// Send every queued mirror to the index. Returns how many updates the
/// index accepted. A failed batch is put back in front of the queue (with
/// the batches after it), so the next flush retries the same committed
/// states instead of losing them.
pub fn flush(store: &TagStore, index: &mut SearchStore) -> Result<usize, String> {
    let mut sent = 0usize;
    let mut pending = batches(store.take_search_updates()).into_iter();
    while let Some(batch) = pending.next() {
        let updates: Vec<TagSearchUpdate> = batch.iter().map(to_update).collect();
        if let Err(error) = search_index::search_tags::apply_tag_search_updates(&updates, index) {
            let mut retry: VecDeque<PendingMirror> = batch.into_iter().collect();
            retry.extend(pending.flatten());
            if let Ok(mut queue) = store.queued() {
                retry.extend(queue.drain(..));
                *queue = retry;
            }
            return Err(error);
        }
        sent = sent.saturating_add(updates.len());
    }
    Ok(sent)
}

/// Flush after one committed tag write. Coordinator wiring calls this after
/// every tag command that committed, including `tag_identity_apply`; it
/// requires the additive `SearchIndexState::with_store_mut` described in
/// `handoff/step-11b/edits/shared-edits.md` §2.5.
/// Best effort: a failure leaves the states queued for the next commit.
pub fn flush_after_commit(app: &tauri::AppHandle) -> Result<usize, String> {
    use tauri::Manager;
    let Some(store) = app.try_state::<TagStore>() else {
        return Ok(0);
    };
    let Some(index) = app.try_state::<crate::search_index::SearchIndexState>() else {
        // The search index is an optional provider in this build; tags stay
        // authoritative on their own.
        return Ok(0);
    };
    index.with_store_mut(app, |search| flush(store.inner(), search))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tag_store::TagStore;
    use crate::tag_transactions::{IdentitySource, TagHistory, TagTransaction};
    use crate::tag_types::{Tag, TagMutation, DEFAULT_TAG_IDS};
    use fs_service::FileIdentityKey;

    fn key(file: &str, path: &str) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: "1a2b3c4d".to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable: true,
        }
    }

    fn mirror(file: &str, revision: u64, tags: &[&str]) -> PendingMirror {
        PendingMirror {
            key: key(file, "C:\\A\\a.txt"),
            tag_ids: tags.iter().map(|id| id.to_string()).collect(),
            deleted: tags.is_empty(),
            revision,
        }
    }

    struct FixedSource;

    impl IdentitySource for FixedSource {
        fn resolve(&self, path: &str) -> Result<FileIdentityKey, String> {
            Ok(key("0011223344556677", path))
        }
    }

    #[test]
    fn stale_index_revision_is_ignored() {
        let batches = batches(vec![
            mirror("0011223344556677", 5, &[DEFAULT_TAG_IDS[0]]),
            mirror("0011223344556677", 4, &[DEFAULT_TAG_IDS[1]]),
        ]);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].len(), 1);
        assert_eq!(batches[0][0].revision, 5);
        assert_eq!(batches[0][0].tag_ids, vec![DEFAULT_TAG_IDS[0]]);
    }

    #[test]
    fn batches_hold_at_most_256_updates() {
        let mirrors: Vec<PendingMirror> = (0..600)
            .map(|index| mirror(&format!("{index:016x}"), 1, &[DEFAULT_TAG_IDS[0]]))
            .collect();
        let batches = batches(mirrors);
        assert_eq!(batches.len(), 3);
        assert!(batches.iter().all(|batch| batch.len() <= MIRROR_BATCH));
        assert_eq!(batches.iter().map(Vec::len).sum::<usize>(), 600);
    }

    #[test]
    fn an_update_replaces_the_whole_membership() {
        let update = to_update(&mirror("0011223344556677", 7, &[DEFAULT_TAG_IDS[2]]));
        assert!(!update.deleted);
        assert_eq!(update.revision, 7);
        assert_eq!(update.tag_ids, vec![DEFAULT_TAG_IDS[2]]);
        let cleared = to_update(&mirror("0011223344556677", 8, &[]));
        assert!(cleared.deleted);
        assert!(cleared.tag_ids.is_empty());
    }

    #[test]
    fn an_undo_is_a_newer_revision_with_the_restored_membership() {
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let tag = Tag {
            id: DEFAULT_TAG_IDS[0].to_string(),
            name: "Red".to_string(),
            color: "#D32F2F".to_string(),
            icon_id: "tag".to_string(),
            created_unix: 1,
            modified_unix: 1,
            revision: 0,
        };
        store.save_tag(&tag, 0, &history).unwrap();
        store.take_search_updates();
        let request = TagMutation {
            keys: vec![key("0011223344556677", "C:\\A\\a.txt")],
            paths: vec!["C:\\A\\a.txt".to_string()],
            add: vec![tag.id.clone()],
            remove: Vec::new(),
            expected_revisions: vec![0],
        };
        let result = TagTransaction::execute(&store, &history, &FixedSource, &request).unwrap();
        history.apply(&store, &result.history_id, true).unwrap();
        let batches = batches(store.take_search_updates());
        assert_eq!(batches.len(), 1);
        let update = &batches[0][0];
        assert_eq!(update.revision, 2);
        assert!(update.deleted);
        assert!(update.tag_ids.is_empty());
    }
}
