//! Pure lock/lifecycle rules (Step 09k D10-D12). The native session uses
//! these exact decisions; no timer or close path invents its own answer.

use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockDecision {
    Locked,
    LockPending,
}

pub fn idle_deadline(last_input: SystemTime, auto_lock_minutes: u32) -> Option<SystemTime> {
    if auto_lock_minutes == 0 {
        return None;
    }
    last_input.checked_add(Duration::from_secs(auto_lock_minutes as u64 * 60))
}

pub fn idle_due(last_input: SystemTime, auto_lock_minutes: u32, now: SystemTime) -> bool {
    idle_deadline(last_input, auto_lock_minutes).is_some_and(|deadline| now >= deadline)
}

/// A dirty session locks only after a verified current pending generation
/// exists, unless the user explicitly chose Discard. A failed persist is
/// never reported as `locked = true`.
pub fn lock_decision(
    dirty: bool,
    discard_dirty: bool,
    verified_current_pending: bool,
) -> LockDecision {
    if !dirty || discard_dirty || verified_current_pending {
        LockDecision::Locked
    } else {
        LockDecision::LockPending
    }
}

/// Auto-lock never discards dirty bytes just because a timer fired.
pub fn auto_lock_decision(dirty: bool, verified_current_pending: bool) -> LockDecision {
    lock_decision(dirty, false, verified_current_pending)
}

/// A Save encrypted copy leaves the source session and its dirty model
/// untouched; this is the invariant the native result and the UI both use.
pub fn save_copy_keeps_original(dirty_before: bool, dirty_after: bool) -> bool {
    dirty_before == dirty_after
}

/// The close policy accepts Keep recovery only after every current content
/// identity has a verified pending receipt.
pub fn keep_recovery_allows_close(
    current_content_ids: &[String],
    receipt_content_ids: &[String],
) -> bool {
    if current_content_ids.is_empty() {
        return true;
    }
    let mut receipts = receipt_content_ids.to_vec();
    receipts.sort();
    receipts.dedup();
    let mut current = current_content_ids.to_vec();
    current.sort();
    current.dedup();
    // Extra earlier receipts do not keep the document open; every current
    // content identity must have one matching verified receipt.
    current.iter().all(|id| receipts.contains(id))
}
