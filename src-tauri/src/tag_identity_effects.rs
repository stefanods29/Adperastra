//! Tag records follow verified identity effects (Step 11b T2, U2).
//!
//! The Step 09f `IdentityEvent` batch is the only source of movement: a
//! record is re-keyed only when the receipt is complete and both sides carry
//! a stable identity. A copy leaves the source record in place and gives the
//! destination the same tags; a move or rename carries the record with the
//! object. An overflow asks for reconciliation (the search mirror is rebuilt
//! from the store) and never infers a move that was not received.
//!
//! These updates are identity bookkeeping, not user edits: they do not add
//! entries to the tag Undo history. Undo keeps restoring tag membership, not
//! the file system location where the app followed a file.

use std::sync::Mutex;

use rusqlite::{params, TransactionBehavior};
use serde::Serialize;
use tauri::{Manager, WebviewWindow};

// Step 09f E8 uses 07a E9's canonical identity type. If an older 09f build
// still declares a private mirror, the coordinator replaces it with
// `pub use fs_service::FileIdentityKey;` as the producer handoff instructs.
use crate::identity_effects::{IdentityEffect, IdentityEvent};
use crate::tag_store::{
    assignment_rows, read_assignment, write_assignment, PendingMirror, TagStore,
};
use crate::tag_types::{assignment_lookup, is_valid_identity_key, MAX_LINKS};

/// The most effects one received batch may carry (Step 09f bound).
const MAX_EFFECTS: usize = 256;

/// What one batch changed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct IdentityApplySummary {
    /// Effects that changed at least one record.
    pub applied: u32,
    pub copies: u32,
    pub moves: u32,
    /// Receipts that were refused, stale or unproved.
    pub ignored: u32,
    /// An overflow arrived: the mirror was rebuilt from the store.
    pub reconciled: bool,
}

enum Applied {
    Copy,
    Move,
    Unchanged,
}

/// The listener state of Step 11b T2 (managed Tauri state). The sequence
/// makes a replayed or out-of-order receipt a no-op.
pub struct TagIdentityEffects {
    last_sequence: Mutex<u64>,
}

impl Default for TagIdentityEffects {
    fn default() -> Self {
        Self::new()
    }
}

impl TagIdentityEffects {
    pub fn new() -> Self {
        Self {
            last_sequence: Mutex::new(0),
        }
    }

    /// Apply one `identity-effects` batch. A store error aborts the batch;
    /// a refused receipt is counted and skipped.
    pub fn apply(
        &self,
        store: &TagStore,
        events: &[IdentityEvent],
    ) -> Result<IdentityApplySummary, String> {
        let mut summary = IdentityApplySummary::default();
        if events.len() > MAX_EFFECTS {
            return Err("tags.invalid".to_string());
        }
        for event in events {
            match event {
                IdentityEvent::Overflow { last_sequence } => {
                    self.advance(*last_sequence)?;
                    reconcile_mirrors(store)?;
                    summary.reconciled = true;
                }
                IdentityEvent::Effect { effect } => {
                    // The sequence lock is held only for this comparison. The
                    // store work below is the slow part and must not keep it.
                    if effect.sequence <= self.last_sequence()? {
                        summary.ignored = summary.ignored.saturating_add(1);
                        continue;
                    }
                    match apply_effect(store, effect)? {
                        Applied::Copy => {
                            self.advance(effect.sequence)?;
                            summary.applied = summary.applied.saturating_add(1);
                            summary.copies = summary.copies.saturating_add(1);
                        }
                        Applied::Move => {
                            self.advance(effect.sequence)?;
                            summary.applied = summary.applied.saturating_add(1);
                            summary.moves = summary.moves.saturating_add(1);
                        }
                        Applied::Unchanged => {
                            // A refused receipt changes nothing; advancing the
                            // sequence keeps a retry from re-evaluating it.
                            self.advance(effect.sequence)?;
                            summary.ignored = summary.ignored.saturating_add(1);
                        }
                    }
                }
            }
        }
        Ok(summary)
    }

    fn last_sequence(&self) -> Result<u64, String> {
        self.last_sequence
            .lock()
            .map(|value| *value)
            .map_err(|_| "tags.io".to_string())
    }

    fn advance(&self, sequence: u64) -> Result<(), String> {
        let mut last = self
            .last_sequence
            .lock()
            .map_err(|_| "tags.io".to_string())?;
        if *last < sequence {
            *last = sequence;
        }
        Ok(())
    }
}

/// Forward the 09f `identity-effects` batch to the store. The window-side
/// listener in `src/services/tags.ts` is the only caller; a batch that fails
/// leaves the store untouched and the next read is authoritative.
#[tauri::command]
pub async fn tag_identity_apply(
    window: WebviewWindow,
    app: tauri::AppHandle,
    events: Vec<IdentityEvent>,
) -> Result<IdentityApplySummary, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<TagStore>();
        let summary = store.effects.apply(&store, &events)?;
        let _ = crate::tag_search_bridge::flush_after_commit(&app);
        Ok(summary)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Re-queue the full membership of every record for the search bridge. Safe
/// on overflow: no record is moved or dropped here.
pub fn reconcile_mirrors(store: &TagStore) -> Result<u64, String> {
    let mut conn = store
        .conn
        .lock()
        .map_err(|_| "tags.io".to_string())?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "tags.io".to_string())?;
    let rows = assignment_rows(&transaction, None)?;
    let revision = TagStore::bump_mirror_revision(&transaction)?;
    let pending: Vec<PendingMirror> = rows
        .iter()
        .map(|row| PendingMirror {
            key: row.key.clone(),
            tag_ids: row.tag_ids.clone(),
            deleted: row.tag_ids.is_empty(),
            revision,
        })
        .collect();
    transaction
        .commit()
        .map_err(|_| "tags.io".to_string())?;
    let count = pending.len() as u64;
    if let Ok(mut queue) = store.pending.lock() {
        queue.extend(pending);
    }
    Ok(count)
}

fn apply_effect(store: &TagStore, effect: &IdentityEffect) -> Result<Applied, String> {
    if !effect.complete || !matches!(effect.kind.as_str(), "copy" | "move" | "rename") {
        return Ok(Applied::Unchanged);
    }
    let from_key = effect.from_key.clone();
    let to_key = effect.to_key.clone();
    if !from_key.stable
        || !to_key.stable
        || !is_valid_identity_key(&from_key)
        || !is_valid_identity_key(&to_key)
    {
        return Ok(Applied::Unchanged);
    }
    if crate::validate_absolute_path(&effect.to_path).is_err() {
        return Ok(Applied::Unchanged);
    }
    let from_lookup = assignment_lookup(&from_key);
    let to_lookup = assignment_lookup(&to_key);
    let mut conn = store
        .conn
        .lock()
        .map_err(|_| "tags.io".to_string())?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "tags.io".to_string())?;
    let Some(source) = read_assignment(&transaction, &from_key)? else {
        return Ok(Applied::Unchanged);
    };
    if source.tag_ids.is_empty() {
        return Ok(Applied::Unchanged);
    }
    let destination = read_assignment(&transaction, &to_key)?;
    if effect.kind == "copy" {
        if destination
            .as_ref()
            .is_some_and(|row| !row.tag_ids.is_empty())
        {
            // Never merge an unrelated record that already lives here.
            return Ok(Applied::Unchanged);
        }
        if destination.is_none() && TagStore::count_links(&transaction)? >= MAX_LINKS {
            return Err("tags.limit".to_string());
        }
        let revision = destination
            .as_ref()
            .map(|row| row.revision)
            .unwrap_or(0)
            .saturating_add(1);
        write_assignment(
            &transaction,
            &to_key,
            &effect.to_path,
            &source.tag_ids,
            revision,
        )?;
        return finish(store, transaction, Applied::Copy, vec![PendingMirror {
            key: to_key,
            tag_ids: source.tag_ids,
            deleted: false,
            revision: 0,
        }]);
    }
    // A move or rename. A hard link reports the same identity: the record
    // stays one row and only its last known path changes.
    if from_lookup == to_lookup {
        let revision = source.revision.saturating_add(1);
        write_assignment(
            &transaction,
            &to_key,
            &effect.to_path,
            &source.tag_ids,
            revision,
        )?;
        return finish(store, transaction, Applied::Move, vec![PendingMirror {
            key: to_key,
            tag_ids: source.tag_ids,
            deleted: false,
            revision: 0,
        }]);
    }
    if destination.is_some() {
        // Never unite two histories by path coincidence. The source record
        // remains exactly as it was.
        return Ok(Applied::Unchanged);
    }
    let revision = source.revision.saturating_add(1);
    write_assignment(
        &transaction,
        &to_key,
        &effect.to_path,
        &source.tag_ids,
        revision,
    )?;
    transaction
        .execute(
            "DELETE FROM assignments WHERE lookup = ?1",
            params![from_lookup],
        )
        .map_err(|_| "tags.io".to_string())?;
    let mut mirrors = vec![PendingMirror {
        key: to_key,
        tag_ids: source.tag_ids.clone(),
        deleted: false,
        revision: 0,
    }];
    mirrors.push(PendingMirror {
        key: from_key,
        tag_ids: Vec::new(),
        deleted: true,
        revision: 0,
    });
    finish(store, transaction, Applied::Move, mirrors)
}

/// Give every mirror the durable revision, check the size bound, commit and
/// only then publish the updates to the bridge queue.
fn finish(
    store: &TagStore,
    transaction: rusqlite::Transaction<'_>,
    applied: Applied,
    mut mirrors: Vec<PendingMirror>,
) -> Result<Applied, String> {
    let revision = TagStore::bump_mirror_revision(&transaction)?;
    for mirror in &mut mirrors {
        mirror.revision = revision;
    }
    store.check_physical_limit(&transaction)?;
    if transaction.commit().is_err() {
        return Err("tags.io".to_string());
    }
    if let Ok(mut queue) = store.pending.lock() {
        queue.extend(mirrors);
    }
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tag_store::read_catalog;
    use crate::tag_transactions::{IdentitySource, TagHistory, TagTransaction};
    use crate::tag_types::{Tag, TagMutation, DEFAULT_TAG_IDS};
    use fs_service::FileIdentityKey;

    fn effect_key(volume: &str, file: &str, path: &str) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: volume.to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable: true,
        }
    }

    fn store_key(volume: &str, file: &str, path: &str) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: volume.to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable: true,
        }
    }

    fn effect(
        kind: &str,
        sequence: u64,
        from: FileIdentityKey,
        to: FileIdentityKey,
        complete: bool,
    ) -> IdentityEffect {
        IdentityEffect {
            operation_id: "00000000-0000-4000-8000-000000000001".to_string(),
            sequence,
            kind: kind.to_string(),
            from_path: from.path_key.clone(),
            to_path: to.path_key.clone(),
            from_key: from,
            to_key: to,
            complete,
        }
    }

    struct FixedSource(Vec<(String, FileIdentityKey)>);

    impl IdentitySource for FixedSource {
        fn resolve(&self, path: &str) -> Result<FileIdentityKey, String> {
            self.0
                .iter()
                .find(|(candidate, _)| candidate == path)
                .map(|(_, key)| key.clone())
                .ok_or_else(|| "tags.io".to_string())
        }
    }

    fn tagged_store(volume: &str, file: &str, path: &str) -> TagStore {
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
        let source = FixedSource(vec![(
            path.to_string(),
            store_key(volume, file, path),
        )]);
        let request = TagMutation {
            keys: vec![store_key(volume, file, path)],
            paths: vec![path.to_string()],
            add: vec![tag.id],
            remove: Vec::new(),
            expected_revisions: vec![0],
        };
        TagTransaction::execute(&store, &history, &source, &request).unwrap();
        store.take_search_updates();
        store
    }

    #[test]
    fn cross_volume_move_changes_the_exact_key() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        let summary = listener
            .apply(
                &store,
                &[IdentityEvent::Effect {
                    effect: effect(
                        "move",
                        1,
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
                        effect_key("99aabbcc", "8899aabbccddeeff", "D:\\B\\a.txt"),
                        true,
                    ),
                }],
            )
            .unwrap();
        assert_eq!(summary.applied, 1);
        assert_eq!(summary.moves, 1);
        let old = store_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let new = store_key("99aabbcc", "8899aabbccddeeff", "D:\\B\\a.txt");
        assert!(store.assignments(&[old]).unwrap()[0].tag_ids.is_empty());
        assert_eq!(
            store.assignments(&[new]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
        let mirrors = store.take_search_updates();
        assert_eq!(mirrors.len(), 2);
        assert!(mirrors.iter().any(|mirror| mirror.deleted));
        assert!(mirrors
            .iter()
            .all(|mirror| mirror.revision == mirrors[0].revision));
    }

    #[test]
    fn copy_keeps_the_source_and_inherits() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        let summary = listener
            .apply(
                &store,
                &[IdentityEvent::Effect {
                    effect: effect(
                        "copy",
                        1,
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
                        effect_key("1a2b3c4d", "ffeeddccbbaa9988", "C:\\A\\a (copy).txt"),
                        true,
                    ),
                }],
            )
            .unwrap();
        assert_eq!(summary.copies, 1);
        let source = store_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let copy = store_key("1a2b3c4d", "ffeeddccbbaa9988", "C:\\A\\a (copy).txt");
        assert_eq!(
            store.assignments(&[source]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
        assert_eq!(
            store.assignments(&[copy]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
    }

    #[test]
    fn an_unproved_receipt_is_ignored() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        let summary = listener
            .apply(
                &store,
                &[IdentityEvent::Effect {
                    effect: effect(
                        "move",
                        1,
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
                        effect_key("99aabbcc", "8899aabbccddeeff", "D:\\B\\a.txt"),
                        false,
                    ),
                }],
            )
            .unwrap();
        assert_eq!(summary.applied, 0);
        assert_eq!(summary.ignored, 1);
        let source = store_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        assert_eq!(
            store.assignments(&[source]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
        assert!(store.take_search_updates().is_empty());
    }

    #[test]
    fn a_hard_link_path_update_keeps_one_record() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        listener
            .apply(
                &store,
                &[IdentityEvent::Effect {
                    effect: effect(
                        "move",
                        1,
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\Links\\a.txt"),
                        true,
                    ),
                }],
            )
            .unwrap();
        let linked = store_key("1a2b3c4d", "0011223344556677", "C:\\Links\\a.txt");
        let assignment = &store.assignments(&[linked]).unwrap()[0];
        assert_eq!(assignment.tag_ids, vec![DEFAULT_TAG_IDS[0]]);
        assert_eq!(assignment.display_path, "C:\\Links\\a.txt");
        assert_eq!(TagStore::count_links(&store.conn.lock().unwrap()).unwrap(), 1);
    }

    #[test]
    fn a_stale_sequence_is_ignored() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        let newer = effect(
            "copy",
            9,
            effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
            effect_key("1a2b3c4d", "0000000000000001", "C:\\A\\copy.txt"),
            true,
        );
        let older = effect(
            "copy",
            8,
            effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
            effect_key("1a2b3c4d", "0000000000000002", "C:\\A\\older.txt"),
            true,
        );
        listener
            .apply(&store, &[IdentityEvent::Effect { effect: newer }])
            .unwrap();
        let summary = listener
            .apply(&store, &[IdentityEvent::Effect { effect: older }])
            .unwrap();
        assert_eq!(summary.ignored, 1);
        let older_key = store_key("1a2b3c4d", "0000000000000002", "C:\\A\\older.txt");
        assert!(store.assignments(&[older_key]).unwrap()[0]
            .tag_ids
            .is_empty());
    }

    #[test]
    fn overflow_reconciles_without_guessing() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let listener = TagIdentityEffects::new();
        let summary = listener
            .apply(
                &store,
                &[IdentityEvent::Overflow { last_sequence: 5 }],
            )
            .unwrap();
        assert!(summary.reconciled);
        let source = store_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        assert_eq!(
            store.assignments(&[source]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
        let mirrors = store.take_search_updates();
        assert_eq!(mirrors.len(), 1);
        assert_eq!(mirrors[0].tag_ids, vec![DEFAULT_TAG_IDS[0]]);
    }

    #[test]
    fn a_move_onto_a_tagged_record_is_not_merged() {
        let store = tagged_store("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        let history = TagHistory::default();
        let second = Tag {
            id: "10000000-0000-4000-8000-000000000002".to_string(),
            name: "Work".to_string(),
            color: "#1565C0".to_string(),
            icon_id: "tag".to_string(),
            created_unix: 2,
            modified_unix: 2,
            revision: 0,
        };
        let catalog = read_catalog(&store.conn.lock().unwrap()).unwrap();
        store.save_tag(&second, catalog.revision, &history).unwrap();
        let destination_path = "C:\\B\\b.txt";
        let destination_key = store_key("1a2b3c4d", "0011223344556678", destination_path);
        let source = FixedSource(vec![(
            destination_path.to_string(),
            destination_key.clone(),
        )]);
        let request = TagMutation {
            keys: vec![destination_key.clone()],
            paths: vec![destination_path.to_string()],
            add: vec![second.id.clone()],
            remove: Vec::new(),
            expected_revisions: vec![0],
        };
        TagTransaction::execute(&store, &history, &source, &request).unwrap();
        let listener = TagIdentityEffects::new();
        let summary = listener
            .apply(
                &store,
                &[IdentityEvent::Effect {
                    effect: effect(
                        "move",
                        1,
                        effect_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt"),
                        effect_key("1a2b3c4d", "0011223344556678", destination_path),
                        true,
                    ),
                }],
            )
            .unwrap();
        assert_eq!(summary.applied, 0);
        assert_eq!(summary.ignored, 1);
        assert_eq!(
            store.assignments(&[destination_key]).unwrap()[0].tag_ids,
            vec![second.id]
        );
        let source_key = store_key("1a2b3c4d", "0011223344556677", "C:\\A\\a.txt");
        assert_eq!(
            store.assignments(&[source_key]).unwrap()[0].tag_ids,
            vec![DEFAULT_TAG_IDS[0]]
        );
    }
}
