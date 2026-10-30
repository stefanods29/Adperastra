//! Bounded in-memory plans for exact transfer Undo/Redo. File paths never
//! travel back through IPC: the UI holds an opaque job ID instead.
use fs_service::ops::{transfer_bytes, TransferEffect, MAX_TRANSFER_BYTES};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

const MAX_HISTORY_BYTES: usize = 128 * 1024 * 1024;
// One UI entry can group many individual conflict jobs.
const MAX_PLANS: usize = 1024;

struct StoredPlan {
    effects: Arc<Vec<TransferEffect>>,
    bytes: usize,
    delivered: bool,
    acknowledged: bool,
}

#[derive(Default)]
pub struct TransferHistory {
    plans: HashMap<String, StoredPlan>,
    reservations: HashSet<String>,
    used_bytes: usize,
}

impl TransferHistory {
    /// Reserve before any mutation. Retention is acknowledged by the UI;
    /// unpolled results and running reservations must never be discarded.
    pub fn reserve(&mut self, id: &str, retained: Option<&[String]>) -> Result<(), String> {
        if id.is_empty() || self.plans.contains_key(id) || self.reservations.contains(id) {
            return Err("ops.invalid_request".into());
        }
        if let Some(retained) = retained {
            if retained.len() > MAX_PLANS {
                return Err("ops.undo_limit".into());
            }
            let retained: HashSet<&str> = retained.iter().map(String::as_str).collect();
            self.plans.retain(|key, plan| {
                let keep = retained.contains(key.as_str());
                plan.acknowledged |= keep;
                !plan.delivered || !plan.acknowledged || keep
            });
            self.used_bytes = self.plans.values().map(|plan| plan.bytes).sum();
        }
        let reserved = self.reservations.len().saturating_mul(MAX_TRANSFER_BYTES);
        if self.plans.len() + self.reservations.len() >= MAX_PLANS
            || self
                .used_bytes
                .saturating_add(reserved)
                .saturating_add(MAX_TRANSFER_BYTES)
                > MAX_HISTORY_BYTES
        {
            return Err("ops.undo_limit".into());
        }
        self.reservations.insert(id.to_string());
        Ok(())
    }

    pub fn finish(
        &mut self,
        id: &str,
        effects: Vec<TransferEffect>,
    ) -> Result<Option<String>, String> {
        if !self.reservations.remove(id) {
            return Err("ops.invalid_request".into());
        }
        if effects.is_empty() {
            return Ok(None);
        }
        let bytes = transfer_bytes(&effects);
        // fs-service enforces the same per-job budget before any writes.
        if bytes > MAX_TRANSFER_BYTES || self.used_bytes.saturating_add(bytes) > MAX_HISTORY_BYTES {
            return Err("ops.undo_limit".into());
        }
        self.used_bytes += bytes;
        self.plans.insert(
            id.to_string(),
            StoredPlan {
                effects: Arc::new(effects),
                bytes,
                delivered: false,
                acknowledged: false,
            },
        );
        Ok(Some(id.to_string()))
    }

    pub fn abort(&mut self, id: &str) {
        self.reservations.remove(id);
    }

    pub fn delivered(&mut self, id: &str) {
        if let Some(plan) = self.plans.get_mut(id) {
            plan.delivered = true;
        }
    }

    pub fn get(&self, id: &str) -> Result<Arc<Vec<TransferEffect>>, String> {
        self.plans
            .get(id)
            .map(|plan| Arc::clone(&plan.effects))
            .ok_or_else(|| "ops.undo_expired".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::ops::TransferKind;

    fn effects() -> Vec<TransferEffect> {
        vec![TransferEffect {
            from: "C:\\source\\note.txt".into(),
            to: "C:\\target\\note.txt".into(),
            kind: TransferKind::File,
            source_removed: false,
            destination_created: true,
        }]
    }

    #[test]
    fn history_retains_unpolled_and_client_referenced_plans() {
        let mut history = TransferHistory::default();
        history.reserve("a", None).unwrap();
        assert_eq!(history.finish("a", effects()).unwrap(), Some("a".into()));
        history.delivered("a");
        // A request sent before the poll reply arrives has no new ID yet.
        history.reserve("b", Some(&[])).unwrap();
        assert!(history.get("a").is_ok());
        history.abort("b");
        history.delivered("a");
        history.reserve("c", Some(&["a".into()])).unwrap();
        assert!(history.get("a").is_ok());
        history.abort("c");
        history.reserve("d", Some(&[])).unwrap();
        assert_eq!(history.get("a").unwrap_err(), "ops.undo_expired");
    }

    #[test]
    fn history_reserves_before_work_and_refunds_cancelled_empty_jobs() {
        let mut history = TransferHistory::default();
        for id in ["a", "b", "c", "d"] {
            history.reserve(id, None).unwrap();
        }
        assert_eq!(history.reserve("e", None).unwrap_err(), "ops.undo_limit");
        assert_eq!(history.finish("a", vec![]).unwrap(), None);
        history.reserve("e", None).unwrap();
        history.abort("e");
        history.reserve("f", None).unwrap();
    }

    #[test]
    fn history_rejects_duplicate_ids_without_losing_original_plan() {
        let mut history = TransferHistory::default();
        history.reserve("a", None).unwrap();
        history.finish("a", effects()).unwrap();
        assert_eq!(
            history.reserve("a", Some(&[])).unwrap_err(),
            "ops.invalid_request"
        );
        assert_eq!(history.get("a").unwrap().len(), 1);
    }
}
