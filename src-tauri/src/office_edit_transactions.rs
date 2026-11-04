//! Office transaction identity, idempotency and result checks (Step 20a T2).
//!
//! The last 128 transaction receipts of one session are retained in memory.
//! A duplicate transaction id with the same intent returns the stored receipt;
//! the same id with a different intent is refused. An engine result is only
//! cached after its session, revision and content identity were checked, so a
//! buggy or stale binding can never advance the local session by accident.

use std::collections::VecDeque;

use uuid::Uuid;

use crate::office_edit_types::{
    OfficeEditError, OfficeSessionState, OfficeTransaction, OfficeTransactionResult,
    MAX_DTO_BYTES,
};

pub const MAX_TRANSACTION_RESULTS: usize = 128;
pub const MAX_AFFECTED_IDS: usize = 1_000;
pub const MAX_RESULT_WARNINGS: usize = 32;
pub const MAX_WARNING_KEY: usize = 128;

#[derive(Debug, Clone)]
struct CachedTransaction {
    fingerprint: String,
    result: OfficeTransactionResult,
}

/// Bounded, per-session receipt ledger.
#[derive(Default)]
pub struct TransactionCache {
    entries: VecDeque<CachedTransaction>,
}

impl TransactionCache {
    /// `Some` for a duplicate with the identical intent, `Err(Invalid)` when
    /// the same transaction id was already used for a different intent.
    pub fn lookup(
        &self,
        transaction_id: Uuid,
        fingerprint: &str,
    ) -> Result<Option<OfficeTransactionResult>, OfficeEditError> {
        match self
            .entries
            .iter()
            .find(|entry| entry.result.transaction_id == transaction_id)
        {
            Some(entry) if entry.fingerprint == fingerprint => Ok(Some(entry.result.clone())),
            Some(_) => Err(OfficeEditError::Invalid),
            None => Ok(None),
        }
    }

    /// Retain one successful receipt. Re-inserting the same id replaces the
    /// old record; the ledger never grows past the contract limit.
    pub fn retain(&mut self, transaction_id: Uuid, fingerprint: String, result: OfficeTransactionResult) {
        self.entries
            .retain(|entry| entry.result.transaction_id != transaction_id);
        self.entries.push_back(CachedTransaction {
            fingerprint,
            result,
        });
        while self.entries.len() > MAX_TRANSACTION_RESULTS {
            self.entries.pop_front();
        }
    }
}

fn hash_parts(parts: &[&[u8]]) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().to_hex().to_string()
}

/// Stable fingerprint of one content transaction (including its id).
pub fn transaction_fingerprint(
    session_id: Uuid,
    transaction: &OfficeTransaction,
) -> Result<String, OfficeEditError> {
    let encoded = serde_json::to_vec(transaction).map_err(|_| OfficeEditError::Invalid)?;
    if encoded.len() > MAX_DTO_BYTES {
        return Err(OfficeEditError::TooLarge);
    }
    Ok(hash_parts(&[
        b"transact",
        session_id.as_bytes(),
        &encoded,
    ]))
}

/// Stable fingerprint of one Undo/Redo intent. The id is issued once per
/// intent, so the same id with another expected revision is a different
/// request and is refused rather than replayed.
pub fn history_fingerprint(
    session_id: Uuid,
    redo: bool,
    expected_revision: u64,
    transaction_id: Uuid,
) -> String {
    let action: &[u8] = if redo { b"redo" } else { b"undo" };
    hash_parts(&[
        action,
        session_id.as_bytes(),
        &expected_revision.to_le_bytes(),
        transaction_id.as_bytes(),
    ])
}

fn same_session(current: &OfficeSessionState, next: &OfficeSessionState) -> bool {
    next.session_id == current.session_id
        && next.document_id == current.document_id
        && next.family == current.family
        && next.format == current.format
}

fn valid_receipt(result: &OfficeTransactionResult) -> bool {
    result.affected_ids.len() <= MAX_AFFECTED_IDS
        && result.affected_ids.iter().all(|id| !id.is_nil())
        && result.warnings.len() <= MAX_RESULT_WARNINGS
        && result
            .warnings
            .iter()
            .all(|key| !key.is_empty() && key.chars().count() <= MAX_WARNING_KEY)
}

/// A content transaction either changes nothing or advances exactly one
/// public revision and one content identity (D6). Undo/Redo must change.
pub fn validate_mutation_result(
    current: &OfficeSessionState,
    requested_id: Uuid,
    result: &OfficeTransactionResult,
    require_change: bool,
) -> Result<(), OfficeEditError> {
    if result.transaction_id != requested_id
        || !result.state.is_valid()
        || !same_session(current, &result.state)
        || !valid_receipt(result)
    {
        return Err(OfficeEditError::Failed);
    }
    if result.changed {
        let next_revision = current
            .revision
            .checked_add(1)
            .ok_or(OfficeEditError::TooLarge)?;
        if result.state.revision != next_revision
            || result.state.content_id == current.content_id
        {
            return Err(OfficeEditError::Changed);
        }
    } else if require_change
        || result.state.revision != current.revision
        || result.state.content_id != current.content_id
    {
        return Err(OfficeEditError::Changed);
    }
    Ok(())
}

/// Mode changes and other metadata-only state transitions never replace the
/// content identity and never decrease the public revision.
pub fn validate_same_content_state(
    current: &OfficeSessionState,
    next: &OfficeSessionState,
) -> Result<(), OfficeEditError> {
    if !next.is_valid() || !same_session(current, next) {
        return Err(OfficeEditError::Failed);
    }
    if next.revision < current.revision
        || next.content_id != current.content_id
        || next.saved_content_id != current.saved_content_id
    {
        return Err(OfficeEditError::Changed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::office_edit_types::{CompatibilityReport, OfficeCapability, OfficeFamily, OfficeMode};
    use crate::engine_types::OfficeFormat;

    fn state(revision: u64, content_id: Uuid) -> OfficeSessionState {
        OfficeSessionState {
            session_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            family: OfficeFamily::Document,
            format: OfficeFormat::Docx,
            revision,
            saved_revision: 1,
            content_id,
            saved_content_id: content_id,
            ready: true,
            mode: OfficeMode::Editing,
            dirty: false,
            can_undo: false,
            can_redo: false,
            capabilities: vec![OfficeCapability::DocumentText],
            selection: None,
            compatibility: CompatibilityReport {
                format: "docx".to_string(),
                entries: Vec::new(),
                next_cursor: None,
                can_preserve_unknown: false,
                blocks_save: false,
            },
            page_count: 1,
            sheet_count: 0,
            slide_count: 0,
            busy: false,
            status_key: None,
        }
    }

    fn result(
        current: &OfficeSessionState,
        id: Uuid,
        changed: bool,
        revision: u64,
        content_id: Uuid,
    ) -> OfficeTransactionResult {
        let mut next = state(revision, content_id);
        next.session_id = current.session_id;
        next.document_id = current.document_id;
        next.family = current.family;
        next.format = current.format;
        next.saved_revision = current.saved_revision;
        OfficeTransactionResult {
            transaction_id: id,
            state: next,
            changed,
            affected_ids: vec![Uuid::new_v4()],
            warnings: Vec::new(),
        }
    }

    #[test]
    fn duplicate_receipt_replays_and_conflicting_payload_fails() {
        let id = Uuid::new_v4();
        let current = state(1, Uuid::new_v4());
        let next = result(&current, id, true, 2, Uuid::new_v4());
        let mut cache = TransactionCache::default();
        cache.retain(id, "a".to_string(), next.clone());
        assert_eq!(cache.lookup(id, "a").unwrap(), Some(next));
        assert_eq!(cache.lookup(id, "b").unwrap_err(), OfficeEditError::Invalid);
        assert_eq!(cache.lookup(Uuid::new_v4(), "a").unwrap(), None);
    }

    #[test]
    fn a_changed_transaction_must_advance_one_revision_and_identity() {
        let id = Uuid::new_v4();
        let current = state(1, Uuid::new_v4());
        let same_content = result(&current, id, true, 2, current.content_id);
        assert_eq!(
            validate_mutation_result(&current, id, &same_content, false).unwrap_err(),
            OfficeEditError::Changed
        );
        let skipped = result(&current, id, true, 3, Uuid::new_v4());
        assert_eq!(
            validate_mutation_result(&current, id, &skipped, false).unwrap_err(),
            OfficeEditError::Changed
        );
        let good = result(&current, id, true, 2, Uuid::new_v4());
        validate_mutation_result(&current, id, &good, true).unwrap();
    }

    #[test]
    fn unchanged_receipt_cannot_claim_a_new_content_identity() {
        let id = Uuid::new_v4();
        let current = state(1, Uuid::new_v4());
        let changed_identity = result(&current, id, false, 1, Uuid::new_v4());
        assert_eq!(
            validate_mutation_result(&current, id, &changed_identity, false).unwrap_err(),
            OfficeEditError::Changed
        );
        let unchanged = result(&current, id, false, 1, current.content_id);
        validate_mutation_result(&current, id, &unchanged, false).unwrap();
    }
}
