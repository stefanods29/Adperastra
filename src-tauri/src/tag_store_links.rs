//! Membership operations of the tag store (Step 11b, T1).
//!
//! A membership batch is one SQLite transaction and one Undo entry. The
//! identity of every stable item is re-read from its path with the
//! metadata-only Step 07a capture before anything is written; a path that no
//! longer resolves to the same volume/file is skipped, never re-attached.

use fs_service::FileIdentityKey;
use rusqlite::{params, TransactionBehavior};

use crate::tag_store::{
    read_assignment, read_catalog, write_assignment, HistoryReservation, PendingMirror, TagStore,
};
use crate::tag_transactions::{IdentitySource, NO_HISTORY_ID};
use crate::tag_types::{
    assignment_lookup, is_uuid, is_valid_identity_key, validate_mutation, TagAssignment,
    TagMutation, TagMutationResult, TagSkipped, TagStateSnapshot, MAX_ASSIGNMENT_KEYS,
    MAX_ASSIGNMENT_TAGS, MAX_LINKS,
};

/// Most skipped rows one result may carry.
const MAX_SKIPPED_PAGE: usize = 256;
/// Every native response stays under 768 KiB (11b response bound).
const MAX_RESPONSE_BYTES: usize = 768 * 1024;
/// The skipped part of a mutation result keeps this much for paths/codes.
const MAX_SKIPPED_BYTES: usize = 512 * 1024;

impl TagStore {
    /// Tags of the given identities, in the same order. An item without a
    /// record answers an empty list at revision 0.
    pub fn assignments(&self, keys: &[FileIdentityKey]) -> Result<Vec<TagAssignment>, String> {
        if keys.len() > MAX_ASSIGNMENT_KEYS {
            return Err("tags.invalid".to_string());
        }
        for key in keys {
            if !is_valid_identity_key(key) {
                return Err("tags.invalid".to_string());
            }
        }
        let conn = self.lock()?;
        let mut out = Vec::with_capacity(keys.len());
        for key in keys {
            match read_assignment(&conn, key)? {
                Some(assignment) => out.push(assignment),
                None => out.push(TagAssignment {
                    key: key.clone(),
                    display_path: key.path_key.clone(),
                    tag_ids: Vec::new(),
                    revision: 0,
                }),
            }
        }
        // 256 keys with 1,000 tag ids and long display paths can exceed the
        // wire bound. Refuse the oversized read; the caller can request a
        // smaller selection instead of receiving a truncated order.
        if serde_json::to_vec(&out)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX)
            > MAX_RESPONSE_BYTES
        {
            return Err("tags.limit".to_string());
        }
        Ok(out)
    }

    /// Apply one add/remove batch. Returns the result and queues the durable
    /// mirror updates for the search bridge.
    ///
    /// The Undo state of the whole batch is reserved before the first write.
    /// A cancelled batch writes nothing and returns `complete: false`.
    pub fn mutate(
        &self,
        request: &TagMutation,
        source: &dyn IdentitySource,
        history: &dyn HistoryReservation,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<TagMutationResult, String> {
        validate_mutation(request)?;
        // Phase 1: revalidate every stable identity with the metadata-only
        // capture before the database lock is taken. A slow or sleeping drive
        // must never block another tag read while this batch waits for it.
        let mut verified_keys: Vec<Option<FileIdentityKey>> =
            Vec::with_capacity(request.keys.len());
        let mut skipped: Vec<TagSkipped> = Vec::new();
        for index in 0..request.keys.len() {
            if index % 64 == 0 && cancelled() {
                return Ok(TagMutationResult {
                    changed_count: 0,
                    skipped: Vec::new(),
                    next_cursor: None,
                    history_id: NO_HISTORY_ID.to_string(),
                    complete: false,
                });
            }
            let requested = &request.keys[index];
            let path = &request.paths[index];
            let verified = if requested.stable {
                match source.resolve(path) {
                    Ok(identity)
                        if identity.stable
                            && identity.volume_id == requested.volume_id
                            && identity.file_id == requested.file_id =>
                    {
                        Some(identity)
                    }
                    // The path now names a different file: never move tags
                    // onto it by path.
                    Ok(_) => {
                        skipped.push(TagSkipped {
                            path: path.clone(),
                            code: "tags.import_identity".to_string(),
                        });
                        None
                    }
                    Err(_) => {
                        skipped.push(TagSkipped {
                            path: path.clone(),
                            code: "tags.io".to_string(),
                        });
                        None
                    }
                }
            } else {
                // An unstable capture has no verifiable identity; it stays a
                // path fallback and the UI shows `tags.unstable`.
                Some(requested.clone())
            };
            verified_keys.push(verified);
        }
        if cancelled() {
            return Ok(TagMutationResult {
                changed_count: 0,
                skipped: Vec::new(),
                next_cursor: None,
                history_id: NO_HISTORY_ID.to_string(),
                complete: false,
            });
        }
        // Phase 2: the short database transaction. No path is opened here.
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        let catalog = read_catalog(&transaction)?;
        for id in request.add.iter().chain(request.remove.iter()) {
            if !is_uuid(id) || !catalog.tags.iter().any(|tag| tag.id == *id) {
                return Err("tags.invalid".to_string());
            }
        }
        let mut before_rows: Vec<TagAssignment> = Vec::new();
        let mut after_rows: Vec<TagAssignment> = Vec::new();
        let mut new_rows: usize = 0;
        for (index, verified) in verified_keys.iter().enumerate() {
            let Some(verified) = verified.clone() else {
                continue;
            };
            let path = &request.paths[index];
            let current = read_assignment(&transaction, &verified)?;
            let current_revision = current
                .as_ref()
                .map(|assignment| assignment.revision)
                .unwrap_or(0);
            if current_revision != request.expected_revisions[index] {
                skipped.push(TagSkipped {
                    path: path.clone(),
                    code: "tags.changed".to_string(),
                });
                continue;
            }
            let before_ids = current
                .as_ref()
                .map(|assignment| assignment.tag_ids.clone())
                .unwrap_or_default();
            let mut tag_ids = before_ids.clone();
            for id in &request.add {
                if !tag_ids.iter().any(|candidate| candidate == id) {
                    tag_ids.push(id.clone());
                }
            }
            tag_ids.retain(|id| !request.remove.iter().any(|removed| removed == id));
            tag_ids.sort();
            tag_ids.dedup();
            if tag_ids.len() > MAX_ASSIGNMENT_TAGS {
                skipped.push(TagSkipped {
                    path: path.clone(),
                    code: "tags.limit".to_string(),
                });
                continue;
            }
            if tag_ids == before_ids {
                continue;
            }
            let revision = current_revision.saturating_add(1);
            match current {
                Some(assignment) => before_rows.push(assignment),
                None => {
                    new_rows += 1;
                    before_rows.push(TagAssignment {
                        key: verified.clone(),
                        display_path: path.clone(),
                        tag_ids: Vec::new(),
                        revision: 0,
                    });
                }
            }
            after_rows.push(TagAssignment {
                key: verified,
                display_path: path.clone(),
                tag_ids,
                revision,
            });
        }
        if after_rows.is_empty() {
            let (complete, next_cursor, skipped) = split_skipped(skipped);
            return Ok(TagMutationResult {
                changed_count: 0,
                skipped,
                next_cursor,
                history_id: NO_HISTORY_ID.to_string(),
                complete,
            });
        }
        let links = TagStore::count_links(&transaction)?.saturating_add(new_rows as u64);
        if links > MAX_LINKS {
            return Err("tags.limit".to_string());
        }
        let before = TagStateSnapshot {
            catalog: catalog.clone(),
            assignments: before_rows,
        };
        let after = TagStateSnapshot {
            catalog,
            assignments: after_rows.clone(),
        };
        let history_id = history.reserve(&before, &after)?;
        for row in &after_rows {
            if row.tag_ids.is_empty() {
                transaction
                    .execute(
                        "DELETE FROM assignments WHERE lookup = ?1",
                        params![assignment_lookup(&row.key)],
                    )
                    .map_err(|_| "tags.io".to_string())?;
            } else {
                write_assignment(
                    &transaction,
                    &row.key,
                    &row.display_path,
                    &row.tag_ids,
                    row.revision,
                )?;
            }
        }
        let links = TagStore::count_links(&transaction)?;
        if links > MAX_LINKS {
            history.discard(&history_id);
            return Err("tags.limit".to_string());
        }
        if let Err(error) = self.check_physical_limit(&transaction) {
            history.discard(&history_id);
            return Err(error);
        }
        let mirror_revision = TagStore::bump_mirror_revision(&transaction)?;
        let pending: Vec<PendingMirror> = after_rows
            .iter()
            .map(|row| PendingMirror {
                key: row.key.clone(),
                tag_ids: row.tag_ids.clone(),
                deleted: row.tag_ids.is_empty(),
                revision: mirror_revision,
            })
            .collect();
        if transaction.commit().is_err() {
            history.discard(&history_id);
            return Err("tags.io".to_string());
        }
        history.commit(&history_id);
        if let Ok(mut queue) = self.pending.lock() {
            queue.extend(pending);
        }
        let (complete, next_cursor, skipped) = split_skipped(skipped);
        Ok(TagMutationResult {
            changed_count: after_rows.len() as u32,
            skipped,
            next_cursor,
            history_id,
            complete,
        })
    }

    /// Put one reserved state back (Undo/Redo of the native tag history).
    /// The state lists exactly the assignment rows it touched; rows absent
    /// from it are not affected.
    pub fn restore_state(&self, state: &TagStateSnapshot) -> Result<(), String> {
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        transaction
            .execute("DELETE FROM tags", [])
            .map_err(|_| "tags.io".to_string())?;
        for tag in &state.catalog.tags {
            transaction
                .execute(
                    "INSERT INTO tags (id, name, name_fold, color, icon_id, created_unix, modified_unix, revision)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        tag.id,
                        tag.name,
                        crate::tag_types::tag_name_fold(&tag.name),
                        tag.color,
                        tag.icon_id,
                        tag.created_unix as i64,
                        tag.modified_unix as i64,
                        tag.revision as i64
                    ],
                )
                .map_err(|_| "tags.io".to_string())?;
        }
        transaction
            .execute(
                "UPDATE meta SET value = ?1 WHERE key = 'catalog_revision'",
                params![state.catalog.revision.to_string()],
            )
            .map_err(|_| "tags.io".to_string())?;
        for assignment in &state.assignments {
            if assignment.tag_ids.is_empty() {
                transaction
                    .execute(
                        "DELETE FROM assignments WHERE lookup = ?1",
                        params![assignment_lookup(&assignment.key)],
                    )
                    .map_err(|_| "tags.io".to_string())?;
            } else {
                write_assignment(
                    &transaction,
                    &assignment.key,
                    &assignment.display_path,
                    &assignment.tag_ids,
                    assignment.revision,
                )?;
            }
        }
        self.check_physical_limit(&transaction)?;
        let mirror_revision = TagStore::bump_mirror_revision(&transaction)?;
        let pending: Vec<PendingMirror> = state
            .assignments
            .iter()
            .map(|assignment| PendingMirror {
                key: assignment.key.clone(),
                tag_ids: assignment.tag_ids.clone(),
                deleted: assignment.tag_ids.is_empty(),
                revision: mirror_revision,
            })
            .collect();
        transaction.commit().map_err(|_| "tags.io".to_string())?;
        if let Ok(mut queue) = self.pending.lock() {
            queue.extend(pending);
        }
        Ok(())
    }
}

/// Keep at most one page of skipped rows. The batch is already committed for
/// the rows that succeeded; `complete: false` tells the caller that more rows
/// were skipped than this result can list. There is deliberately no cursor:
/// replaying the same batch is the only way to see them again, and the caller
/// must not treat an uninspectable cursor as a resumable page.
fn split_skipped(skipped: Vec<TagSkipped>) -> (bool, Option<String>, Vec<TagSkipped>) {
    let mut kept: Vec<TagSkipped> = Vec::new();
    let mut bytes = 0usize;
    for row in skipped {
        let size = row.path.len().saturating_add(row.code.len()).saturating_add(64);
        if kept.len() >= MAX_SKIPPED_PAGE || bytes.saturating_add(size) > MAX_SKIPPED_BYTES {
            return (false, None, kept);
        }
        bytes = bytes.saturating_add(size);
        kept.push(row);
    }
    (true, None, kept)
}
