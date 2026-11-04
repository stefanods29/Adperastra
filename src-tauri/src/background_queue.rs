//! Bounded background admission (Step 07a, E10).
//!
//! At most two provider pipelines run at once and at most 256 wait. Visible
//! work goes before overscan, and a foreground `User` permit bypasses the
//! idle/AC policy but never the concurrency limit. A permit is RAII: dropping
//! it frees the slot. No disk work happens under the queue lock.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::Duration;

use fs_service::CancellationToken;
use uuid::Uuid;

use crate::background::BackgroundTaskKind;

/// The most provider pipelines that run at once (plan D5).
pub const MAX_ACTIVE: usize = 2;
/// The most pipelines that may wait for a slot (plan D5).
pub const MAX_WAITING: usize = 256;

/// Who the work is for. Lower ranks start first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackgroundPriority {
    /// A foreground action the user asked for.
    User,
    /// Rows on screen.
    Visible,
    /// Rows just outside the viewport. The grid uses it when overscan
    /// scheduling arrives; the policy and tests already rank it.
    Overscan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundError {
    Busy,
    Paused,
    Cancelled,
    Unavailable,
}

struct Waiter {
    id: u64,
    kind: BackgroundTaskKind,
    consumer: Uuid,
    priority: BackgroundPriority,
    token: CancellationToken,
}

struct Active {
    id: u64,
    kind: BackgroundTaskKind,
    consumer: Uuid,
    priority: BackgroundPriority,
    token: CancellationToken,
}

struct QueueState {
    next_id: u64,
    active: Vec<Active>,
    waiting: Vec<Waiter>,
    paused: bool,
}

/// The one scheduler every background provider shares.
pub struct BackgroundScheduler {
    state: Mutex<QueueState>,
    wake: Condvar,
    max_active: usize,
    max_waiting: usize,
    policy: Mutex<Option<Weak<crate::background::BackgroundPolicy>>>,
}

impl Default for BackgroundScheduler {
    fn default() -> Self {
        Self::with_limits(MAX_ACTIVE, MAX_WAITING)
    }
}

impl BackgroundScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limits(max_active: usize, max_waiting: usize) -> Self {
        Self {
            state: Mutex::new(QueueState {
                next_id: 1,
                active: Vec::new(),
                waiting: Vec::new(),
                paused: false,
            }),
            wake: Condvar::new(),
            max_active,
            max_waiting,
            policy: Mutex::new(None),
        }
    }

    pub fn set_policy(&self, policy: Weak<crate::background::BackgroundPolicy>) {
        if let Ok(mut current) = self.policy.lock() {
            *current = Some(policy);
        }
    }

    fn policy_eligible(&self, kind: BackgroundTaskKind, priority: BackgroundPriority) -> bool {
        if priority == BackgroundPriority::User {
            return true;
        }
        let Ok(policy) = self.policy.lock() else {
            return false;
        };
        match policy.as_ref() {
            None => true, // Standalone scheduler tests inject capacity only.
            Some(policy) => policy.upgrade().is_some_and(|policy| {
                let (idle, ac) = policy.samples();
                policy.eligible(kind, idle, ac)
            }),
        }
    }

    /// Wait for a slot. The caller can cancel while waiting; a cancelled or
    /// paused request never starts provider work.
    pub async fn acquire(
        self: &Arc<Self>,
        kind: BackgroundTaskKind,
        consumer_id: Uuid,
        priority: BackgroundPriority,
        cancel: CancellationToken,
    ) -> Result<BackgroundPermit, BackgroundError> {
        let scheduler = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            scheduler.wait(kind, consumer_id, priority, cancel)
        })
        .await
        .map_err(|_| BackgroundError::Unavailable)?
    }

    /// Cancel one consumer's wait or active token. A caller that released
    /// before its start finished never leaves a queued read behind.
    pub fn cancel_consumer(&self, consumer: &Uuid) {
        let Ok(mut state) = self.lock() else {
            return;
        };
        for waiter in &state.waiting {
            if &waiter.consumer == consumer {
                waiter.token.store(true, Ordering::Relaxed);
            }
        }
        state.waiting.retain(|waiter| &waiter.consumer != consumer);
        for active in &state.active {
            if &active.consumer == consumer {
                active.token.store(true, Ordering::Relaxed);
            }
        }
        self.wake.notify_all();
    }

    pub fn cancel_kind(&self, kind: BackgroundTaskKind) {
        let Ok(mut state) = self.lock() else {
            return;
        };
        for waiter in &state.waiting {
            if waiter.kind == kind && waiter.priority != BackgroundPriority::User {
                waiter.token.store(true, Ordering::Relaxed);
            }
        }
        state
            .waiting
            .retain(|waiter| waiter.kind != kind || waiter.priority == BackgroundPriority::User);
        for active in &state.active {
            if active.kind == kind && active.priority != BackgroundPriority::User {
                active.token.store(true, Ordering::Relaxed);
            }
        }
        self.wake.notify_all();
    }

    /// Pause every background unit. Foreground `User` permits are never
    /// touched: a file transfer must not stop because previews were paused.
    pub fn pause_all(&self) {
        let Ok(mut state) = self.lock() else {
            return;
        };
        state.paused = true;
        for waiter in &state.waiting {
            if waiter.priority != BackgroundPriority::User {
                waiter.token.store(true, Ordering::Relaxed);
            }
        }
        state
            .waiting
            .retain(|waiter| waiter.priority == BackgroundPriority::User);
        for active in &state.active {
            if active.priority != BackgroundPriority::User {
                active.token.store(true, Ordering::Relaxed);
            }
        }
        self.wake.notify_all();
    }

    pub fn resume(&self) {
        if let Ok(mut state) = self.lock() {
            state.paused = false;
            self.wake.notify_all();
        }
    }

    /// (running, queued) for the Settings status.
    pub fn counts(&self) -> (u32, u32) {
        match self.lock() {
            Ok(state) => (
                u32::try_from(state.active.len()).unwrap_or(u32::MAX),
                u32::try_from(state.waiting.len()).unwrap_or(u32::MAX),
            ),
            Err(_) => (0, 0),
        }
    }

    /// (running, queued) for one task kind, so the bounded task list can show
    /// per-task progress without a second scheduler.
    pub fn counts_for(&self, kind: BackgroundTaskKind) -> (u32, u32) {
        match self.lock() {
            Ok(state) => (
                u32::try_from(
                    state
                        .active
                        .iter()
                        .filter(|entry| entry.kind == kind)
                        .count(),
                )
                .unwrap_or(u32::MAX),
                u32::try_from(
                    state
                        .waiting
                        .iter()
                        .filter(|entry| entry.kind == kind)
                        .count(),
                )
                .unwrap_or(u32::MAX),
            ),
            Err(_) => (0, 0),
        }
    }

    fn wait(
        self: &Arc<Self>,
        kind: BackgroundTaskKind,
        consumer: Uuid,
        priority: BackgroundPriority,
        token: CancellationToken,
    ) -> Result<BackgroundPermit, BackgroundError> {
        let id = self.push_waiter(kind, consumer, priority, token.clone())?;
        let mut state = self.lock()?;
        loop {
            if token.load(Ordering::Relaxed) {
                state.waiting.retain(|waiter| waiter.id != id);
                self.wake.notify_all();
                return Err(BackgroundError::Cancelled);
            }
            if (state.paused && priority != BackgroundPriority::User)
                || !self.policy_eligible(kind, priority)
            {
                state.waiting.retain(|waiter| waiter.id != id);
                self.wake.notify_all();
                return Err(BackgroundError::Paused);
            }
            let best = state
                .waiting
                .iter()
                .min_by_key(|waiter| (waiter.priority, waiter.id))
                .map(|waiter| waiter.id);
            if state.active.len() < self.max_active && best == Some(id) {
                state.waiting.retain(|waiter| waiter.id != id);
                state.active.push(Active {
                    id,
                    kind,
                    consumer,
                    priority,
                    token: token.clone(),
                });
                return Ok(BackgroundPermit {
                    scheduler: Arc::clone(self),
                    id,
                });
            }
            let (next, _) = self
                .wake
                .wait_timeout(state, Duration::from_millis(100))
                .map_err(|_| BackgroundError::Unavailable)?;
            state = next;
        }
    }

    fn push_waiter(
        &self,
        kind: BackgroundTaskKind,
        consumer: Uuid,
        priority: BackgroundPriority,
        token: CancellationToken,
    ) -> Result<u64, BackgroundError> {
        let mut state = self.lock()?;
        if (state.paused && priority != BackgroundPriority::User)
            || !self.policy_eligible(kind, priority)
        {
            return Err(BackgroundError::Paused);
        }
        if state.waiting.len() >= self.max_waiting {
            return Err(BackgroundError::Busy);
        }
        let id = state.next_id;
        state.next_id = state.next_id.wrapping_add(1).max(1);
        state.waiting.push(Waiter {
            id,
            kind,
            consumer,
            priority,
            token,
        });
        self.wake.notify_all();
        Ok(id)
    }

    fn release(&self, id: u64) {
        if let Ok(mut state) = self.lock() {
            state.active.retain(|active| active.id != id);
            self.wake.notify_all();
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, QueueState>, BackgroundError> {
        self.state.lock().map_err(|_| BackgroundError::Unavailable)
    }
}

/// RAII slot: dropping it lets the next waiter start.
pub struct BackgroundPermit {
    scheduler: Arc<BackgroundScheduler>,
    id: u64,
}

impl Drop for BackgroundPermit {
    fn drop(&mut self) {
        self.scheduler.release(self.id);
    }
}

#[cfg(test)]
impl BackgroundScheduler {
    fn force_active(
        self: &Arc<Self>,
        kind: BackgroundTaskKind,
        consumer: Uuid,
        priority: BackgroundPriority,
        priority_token: CancellationToken,
    ) -> BackgroundPermit {
        let mut state = self.state.lock().unwrap();
        let id = state.next_id;
        state.next_id += 1;
        state.active.push(Active {
            id,
            kind,
            consumer,
            priority,
            token: priority_token,
        });
        drop(state);
        BackgroundPermit {
            scheduler: Arc::clone(self),
            id,
        }
    }

    fn enqueue_waiting(
        &self,
        kind: BackgroundTaskKind,
        consumer: Uuid,
        priority: BackgroundPriority,
        token: CancellationToken,
    ) -> Result<u64, BackgroundError> {
        self.push_waiter(kind, consumer, priority, token)
    }
}

#[cfg(test)]
#[path = "background_queue_tests.rs"]
mod tests;
