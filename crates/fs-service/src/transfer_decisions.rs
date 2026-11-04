//! Pause, resume, skip, retry and answer validation (Step 09f D8).
//!
//! A running transfer has exactly one worker. It asks this module between
//! chunks whether it may continue, and this module is what `Pause`,
//! `Resume`, `Skip file` and `Cancel` change. Nothing here touches a file:
//! when a pause is requested the worker simply stops asking for the next
//! chunk, so the owned handles and the staging file stay exactly as they
//! were and no byte is written twice.
//!
//! The gate waits on a condition variable with a short timeout *and* looks
//! at the job's cancellation token on every wake-up, so `Cancel` never
//! leaves the worker sleeping.

use std::sync::{Condvar, Mutex};
use std::time::Duration;

use crate::{CancellationToken, SourceStamp};

/// A worker that is paused still looks at its token this often, so Cancel
/// and a dying tab are noticed well inside the 100 ms budget.
pub const WAIT_SLICE: Duration = Duration::from_millis(50);

/// How many times one item may be retried after a read/access/in-use error.
pub const MAX_RETRIES_PER_ITEM: u8 = 3;

/// What the worker should do at this checkpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Checkpoint {
    /// Keep going.
    Continue,
    /// The user asked to skip *this* item: dispose its own partial, report
    /// it, continue with the next item.
    SkipItem,
    /// Stop the whole job. Completed items stay.
    Cancel,
}

#[derive(Debug, Clone, Copy, Default)]
struct GateState {
    paused: bool,
    cancel: bool,
    skip: bool,
    generation: u64,
}

/// The pause/skip/cancel handshake of one running job.
#[derive(Debug)]
pub struct TransferGate {
    state: Mutex<GateState>,
    wake: Condvar,
}

impl Default for TransferGate {
    fn default() -> Self {
        Self::new()
    }
}

impl TransferGate {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(GateState::default()),
            wake: Condvar::new(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, GateState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The current generation; every accepted control grows it so a stale
    /// answer from the window can be recognised.
    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub fn pause(&self) -> u64 {
        let mut state = self.lock();
        state.paused = true;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        drop(state);
        self.wake.notify_all();
        generation
    }

    pub fn resume(&self) -> u64 {
        let mut state = self.lock();
        state.paused = false;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        drop(state);
        self.wake.notify_all();
        generation
    }

    /// Ask for the current item to be skipped. The worker notices at its
    /// next chunk boundary.
    pub fn skip_current(&self) -> u64 {
        let mut state = self.lock();
        state.skip = true;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        drop(state);
        self.wake.notify_all();
        generation
    }

    pub fn cancel(&self) -> u64 {
        let mut state = self.lock();
        state.cancel = true;
        state.paused = false;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        drop(state);
        self.wake.notify_all();
        generation
    }

    pub fn is_cancelled(&self) -> bool {
        self.lock().cancel
    }

    pub fn is_paused(&self) -> bool {
        self.lock().paused
    }

    /// The checkpoint the worker must obey between two chunks.
    ///
    /// While paused this blocks (no spinning, no extra bytes). A cancellation
    /// token set from outside — `job_cancel`, a closed window — also ends the
    /// wait.
    pub fn checkpoint(&self, token: &CancellationToken) -> Checkpoint {
        let mut state = self.lock();
        loop {
            if state.cancel || token.load(std::sync::atomic::Ordering::Relaxed) {
                return Checkpoint::Cancel;
            }
            if state.skip {
                state.skip = false;
                return Checkpoint::SkipItem;
            }
            if !state.paused {
                return Checkpoint::Continue;
            }
            let (next, _) = self
                .wake
                .wait_timeout(state, WAIT_SLICE)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next;
        }
    }

    /// Drop a skip that was meant for an item which already finished.
    pub fn clear_pending_skip(&self) {
        self.lock().skip = false;
    }
}

/// Why an answer was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionError {
    /// The window answered a conflict that is no longer the current one.
    Stale,
    /// The action is not offered for this kind of conflict.
    NotAllowed,
    /// This item already used its three retries.
    RetriesExhausted,
    /// The answer is not one of the four actions.
    Invalid,
}

impl DecisionError {
    pub fn code(self) -> &'static str {
        match self {
            DecisionError::Stale => "ops.decision_stale",
            DecisionError::NotAllowed | DecisionError::Invalid => "ops.invalid_request",
            DecisionError::RetriesExhausted => "ops.in_use",
        }
    }
}

/// The four actions a user can take on a paused item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionAction {
    Skip,
    KeepBoth,
    Merge,
    Retry,
    Cancel,
}

impl DecisionAction {
    pub fn as_code(self) -> &'static str {
        match self {
            DecisionAction::Skip => "skip",
            DecisionAction::KeepBoth => "keepBoth",
            DecisionAction::Merge => "merge",
            DecisionAction::Retry => "retry",
            DecisionAction::Cancel => "cancel",
        }
    }

    pub fn parse(code: &str) -> Result<Self, DecisionError> {
        match code {
            "skip" => Ok(DecisionAction::Skip),
            "keepBoth" | "keepboth" => Ok(DecisionAction::KeepBoth),
            "merge" => Ok(DecisionAction::Merge),
            "retry" => Ok(DecisionAction::Retry),
            "cancel" => Ok(DecisionAction::Cancel),
            _ => Err(DecisionError::Invalid),
        }
    }
}

/// The two kinds of paused item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingKind {
    /// A name is already in use.
    Name,
    /// The item could not be read, is in use, or hit an I/O error.
    Error,
}

impl PendingKind {
    pub fn as_code(self) -> &'static str {
        match self {
            PendingKind::Name => "conflict",
            PendingKind::Error => "error",
        }
    }
}

/// The actions offered for one paused item, in display order. Cancel is last
/// and never the initial focus.
pub fn allowed_actions(
    kind: PendingKind,
    merge_allowed: bool,
    retries_used: u8,
) -> Vec<DecisionAction> {
    match kind {
        PendingKind::Name => {
            let mut actions = vec![DecisionAction::Skip, DecisionAction::KeepBoth];
            if merge_allowed {
                actions.push(DecisionAction::Merge);
            }
            actions.push(DecisionAction::Cancel);
            actions
        }
        PendingKind::Error => {
            let mut actions = Vec::new();
            if retries_used < MAX_RETRIES_PER_ITEM {
                actions.push(DecisionAction::Retry);
            }
            actions.push(DecisionAction::Skip);
            actions.push(DecisionAction::Cancel);
            actions
        }
    }
}

/// Per-item retry budget. The user chooses every retry; nothing retries by
/// itself, so a broken file cannot loop forever.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RetryCounter {
    used: u8,
}

impl RetryCounter {
    pub fn used(&self) -> u8 {
        self.used
    }

    pub fn can_retry(&self) -> bool {
        self.used < MAX_RETRIES_PER_ITEM
    }

    /// Take one retry; the third success is the last one.
    pub fn retry(&mut self) -> Result<u8, DecisionError> {
        if !self.can_retry() {
            return Err(DecisionError::RetriesExhausted);
        }
        self.used += 1;
        Ok(self.used)
    }
}

/// A decision the user is answering, bound to the exact objects it showed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionTicket {
    pub decision_id: uuid::Uuid,
    pub item_id: uuid::Uuid,
    pub generation: u64,
    pub source: SourceStamp,
    pub target: Option<SourceStamp>,
}

impl DecisionTicket {
    /// True when this answer belongs to the question currently on screen.
    pub fn accepts(&self, decision_id: uuid::Uuid, generation: u64) -> bool {
        self.decision_id == decision_id && self.generation == generation
    }

    /// True when the source is still the object the user reviewed. Anything
    /// else needs a fresh preview and a fresh answer (`ops.source_changed`).
    pub fn source_unchanged(&self, current: &SourceStamp) -> bool {
        self.source == *current
    }

    /// True when the destination is still the object the user reviewed. A
    /// destination that appeared, changed or vanished is a stale conflict.
    pub fn target_unchanged(&self, current: Option<&SourceStamp>) -> bool {
        match (&self.target, current) {
            (None, None) => true,
            (Some(expected), Some(current)) => expected == current,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_stop_after_three() {
        let mut counter = RetryCounter::default();
        assert_eq!(counter.retry(), Ok(1));
        assert_eq!(counter.retry(), Ok(2));
        assert_eq!(counter.retry(), Ok(3));
        assert!(!counter.can_retry());
        assert_eq!(counter.retry(), Err(DecisionError::RetriesExhausted));
    }

    #[test]
    fn merge_is_offered_only_for_two_folders() {
        let with = allowed_actions(PendingKind::Name, true, 0);
        assert!(with.contains(&DecisionAction::Merge));
        let without = allowed_actions(PendingKind::Name, false, 0);
        assert!(!without.contains(&DecisionAction::Merge));
        assert_eq!(without.first(), Some(&DecisionAction::Skip));
        assert_eq!(without.last(), Some(&DecisionAction::Cancel));
    }

    #[test]
    fn error_actions_drop_retry_when_the_budget_is_used() {
        assert_eq!(
            allowed_actions(PendingKind::Error, false, 3),
            vec![DecisionAction::Skip, DecisionAction::Cancel]
        );
    }

    fn stamp(key: &str) -> SourceStamp {
        SourceStamp {
            path_key: key.to_string(),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "00000000000000ff".to_string(),
            modified_ticks: "133500000000000000".to_string(),
            size_bytes: 4,
        }
    }

    #[test]
    fn a_ticket_only_accepts_its_own_question_and_objects() {
        let ticket = DecisionTicket {
            decision_id: uuid::Uuid::new_v4(),
            item_id: uuid::Uuid::new_v4(),
            generation: 7,
            source: stamp(r"C:\A\b.txt"),
            target: Some(stamp(r"C:\B\b.txt")),
        };
        assert!(ticket.accepts(ticket.decision_id, 7));
        assert!(!ticket.accepts(ticket.decision_id, 8));
        assert!(!ticket.accepts(uuid::Uuid::new_v4(), 7));
        assert!(ticket.source_unchanged(&stamp(r"C:\A\b.txt")));
        assert!(!ticket.source_unchanged(&stamp(r"C:\A\b.txt ")));
        assert!(ticket.target_unchanged(Some(&stamp(r"C:\B\b.txt"))));
        assert!(!ticket.target_unchanged(None));
    }
}
