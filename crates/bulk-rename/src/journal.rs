//! Durable intent data. A storage adapter must flush before acknowledging save.
use crate::operations::RenameResult;
use crate::types::{RenameEffect, MAX_PLAN_BYTES};
use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

pub const MAX_UNFINISHED_JOURNALS: usize = 100;
pub const MAX_JOURNAL_TOTAL_BYTES: usize = 128 * 1024 * 1024;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JournalState {
    Prepared,
    Renaming,
    Committed,
    RolledBack,
    RecoveryRequired,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentState {
    Intent,
    Completed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameIntent {
    pub sequence: u32,
    pub input_index: u32,
    pub old_path: String,
    pub new_path: String,
    pub volume_id: String,
    pub file_id: String,
    pub state: IntentState,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameJournal {
    pub schema_version: u32,
    pub receipt_id: Uuid,
    pub state: JournalState,
    pub effects: Vec<RenameEffect>,
    pub intents: Vec<RenameIntent>,
}

/// Native owner serializes reservation + atomic replacement across processes.
/// reserve must reserve MAX_PLAN_BYTES before the first source mutation, enforce
/// 100 unfinished / 128 MiB physical total, and retain unfinished reservations.
/// save must atomically replace owned app-state data and sync it to disk.
/// A save of Committed or RolledBack is terminal and may release the reservation;
/// RecoveryRequired keeps it until recovery has settled the source identities.
/// This trait provides no filesystem mutation implementation or fake success.
pub trait JournalStore {
    fn reserve(&mut self, receipt: Uuid, bytes: usize) -> RenameResult<()>;
    fn save(&mut self, journal: &RenameJournal, bytes: &[u8]) -> RenameResult<()>;
}
pub fn flush(store: &mut impl JournalStore, journal: &RenameJournal) -> RenameResult<()> {
    let bytes = serde_json::to_vec(journal).map_err(|_| "rename.journal_failed")?;
    if bytes.len() > MAX_PLAN_BYTES {
        return Err("rename.journal_failed".into());
    }
    store
        .save(journal, &bytes)
        .map_err(|_| "rename.journal_failed".into())
}

/// Refuse a predictably oversized journal BEFORE any rename. Include every
/// forward effect and its inverse, even though a failure usually uses fewer.
pub fn ensure_capacity(journal: &RenameJournal, intermediate: &[String]) -> RenameResult<()> {
    if intermediate.len() != journal.effects.len() {
        return Err("rename.bad_request".into());
    }
    let mut worst = journal.clone();
    worst.state = JournalState::RecoveryRequired;
    for (index, effect) in journal.effects.iter().enumerate() {
        let middle = &intermediate[index];
        for (old, new) in [
            (&effect.original_path, middle),
            (middle, &effect.target_path),
            (&effect.target_path, middle),
            (middle, &effect.original_path),
        ] {
            worst.intents.push(RenameIntent {
                sequence: u32::MAX,
                input_index: index as u32,
                old_path: old.clone(),
                new_path: new.clone(),
                volume_id: effect.source.volume_id.clone(),
                file_id: effect.source.file_id.clone(),
                state: IntentState::Completed,
            });
        }
        let current = [&effect.original_path, &effect.target_path, middle]
            .into_iter()
            .max_by_key(|path| {
                serde_json::to_string(path)
                    .map(|s| s.len())
                    .unwrap_or(usize::MAX)
            })
            .ok_or("rename.journal_failed")?;
        worst.effects[index].current_path = current.clone();
        worst.effects[index].status = crate::types::RenameEffectStatus::RecoveryRequired;
        worst.effects[index].reason = Some("rename.recovery_required".into());
    }
    if serde_json::to_vec(&worst)
        .map_err(|_| "rename.journal_failed")?
        .len()
        > MAX_PLAN_BYTES
    {
        return Err("rename.journal_failed".into());
    }
    Ok(())
}

/// Crash recovery probes only the recorded candidates and matches object IDs.
/// The adapter must open each candidate without following reparses/hydration.
/// A missing object is None; an inaccessible/ambiguous probe is an error.
/// A case-only rename makes both case-insensitive candidates resolve to the
/// same object, so the journal state decides which spelling to report; two
/// distinct paths with the same identity (for example hard links) remain
/// ambiguous and require recovery.
pub fn recover_candidate(
    intent: &RenameIntent,
    mut probe: impl FnMut(&str) -> RenameResult<Option<SourceStamp>>,
) -> RenameResult<String> {
    let candidates: Vec<&String> = if intent.old_path == intent.new_path {
        vec![&intent.old_path]
    } else {
        vec![&intent.old_path, &intent.new_path]
    };
    let mut found = Vec::new();
    for path in candidates {
        if let Some(stamp) = probe(path)? {
            if stamp.volume_id == intent.volume_id && stamp.file_id == intent.file_id {
                found.push(path.to_string());
            }
        }
    }
    if found.is_empty() {
        return Err("rename.recovery_required".into());
    }
    if found.len() == 1 {
        return Ok(found.remove(0));
    }
    if same_path_key(&intent.old_path, &intent.new_path) {
        return Ok(if intent.state == IntentState::Completed {
            intent.new_path.clone()
        } else {
            intent.old_path.clone()
        });
    }
    Err("rename.recovery_required".into())
}

fn same_path_key(left: &str, right: &str) -> bool {
    match (
        fs_service::path_key_of(Path::new(left)),
        fs_service::path_key_of(Path::new(right)),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}
