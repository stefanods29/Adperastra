//! Bounded, time-limited content-transfer leases (Step 09c T2, D5).
//!
//! The registry is content-agnostic: it counts bytes, enforces the 32
//! active leases / 256 MiB aggregate budgets and the 60 s idle TTL capped
//! at five minutes, and keeps an optional opaque hold alive so an 08a
//! snapshot outlives every renderer request until the transfer ends.
//! Unknown, forged and expired tokens are all reported as `Expired`, so a
//! caller cannot probe for live identities.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::transfer_types::{
    TransferEnvelope, TransferError, MAX_TRANSFER_ACTIVE_LEASES, MAX_TRANSFER_LEASE_BYTES,
    TRANSFER_LEASE_MAX_SECS, TRANSFER_LEASE_TTL_SECS,
};

/// Keeps a native resource (an 08a snapshot lease) alive while any clone
/// exists. The transfer registry drops its reference exactly once.
pub trait HeldSnapshot: Send + Sync {}

/// What a lookup returns. Dropping this value never ends the transfer;
/// only `release` or expiry does.
pub struct LeasedTransfer {
    pub envelope: TransferEnvelope,
    pub remaining: Duration,
}

struct LeaseEntry {
    envelope: TransferEnvelope,
    bytes: u64,
    hold: Option<Arc<dyn HeldSnapshot>>,
    created: Instant,
    expires: Instant,
}

#[derive(Default)]
struct LeaseState {
    entries: HashMap<uuid::Uuid, LeaseEntry>,
    bytes: u64,
}

/// The registry's monotonic clock, injectable for deterministic tests.
pub(crate) type LeaseClock = Arc<dyn Fn() -> Instant + Send + Sync>;

/// The process-wide transfer budget. One mutex guards identities and
/// byte accounting together, so insertion is all-or-nothing.
pub struct TransferLeases {
    state: Mutex<LeaseState>,
    clock: LeaseClock,
    ttl: Duration,
    max_ttl: Duration,
}

impl TransferLeases {
    pub fn new() -> Self {
        let clock: fn() -> Instant = Instant::now;
        Self::with_clock(
            Arc::new(clock),
            Duration::from_secs(TRANSFER_LEASE_TTL_SECS),
            Duration::from_secs(TRANSFER_LEASE_MAX_SECS),
        )
    }

    pub(crate) fn with_clock(clock: LeaseClock, ttl: Duration, max_ttl: Duration) -> Self {
        TransferLeases {
            state: Mutex::new(LeaseState::default()),
            clock,
            ttl,
            max_ttl,
        }
    }

    /// Store one transfer and its bytes. A duplicate identity is refused
    /// rather than replacing the existing hold. Expired entries are swept
    /// here so a stale lease never blocks a new one.
    #[allow(clippy::map_entry)]
    pub fn insert(
        &self,
        envelope: TransferEnvelope,
        bytes: u64,
        hold: Option<Arc<dyn HeldSnapshot>>,
    ) -> Result<(), TransferError> {
        let id = uuid::Uuid::parse_str(&envelope.transfer_id).map_err(|_| TransferError::Invalid)?;
        let now = (self.clock)();
        let (result, expired) = {
            let mut state = self.state.lock().map_err(|_| TransferError::Failed)?;
            let expired = take_expired(&mut state, now);
            let result = if state.entries.contains_key(&id) {
                Err(TransferError::Invalid)
            } else {
                let next_bytes = state.bytes.saturating_add(bytes);
                if state.entries.len() >= MAX_TRANSFER_ACTIVE_LEASES
                    || next_bytes > MAX_TRANSFER_LEASE_BYTES
                {
                    Err(TransferError::TooLarge)
                } else {
                    state.bytes = next_bytes;
                    state.entries.insert(
                        id,
                        LeaseEntry {
                            envelope,
                            bytes,
                            hold,
                            created: now,
                            expires: now + self.ttl,
                        },
                    );
                    Ok(())
                }
            };
            (result, expired)
        };
        // A dropped hold may delete its backing file; never do that under
        // the registry mutex.
        drop(expired);
        result
    }

    /// Resolve one token and extend its idle TTL, never past the lease's
    /// absolute ceiling. An expired entry is removed before the error is
    /// returned.
    pub fn get(&self, transfer_id: &str) -> Result<LeasedTransfer, TransferError> {
        let id = uuid::Uuid::parse_str(transfer_id).map_err(|_| TransferError::Invalid)?;
        let now = (self.clock)();
        let (result, expired) = {
            let mut state = self.state.lock().map_err(|_| TransferError::Failed)?;
            let expired = take_expired(&mut state, now);
            let result = match state.entries.get_mut(&id) {
                None => Err(TransferError::Expired),
                Some(entry) => {
                    let ceiling = entry.created + self.max_ttl;
                    let extended = std::cmp::min(now + self.ttl, ceiling);
                    if extended > entry.expires {
                        entry.expires = extended;
                    }
                    Ok(LeasedTransfer {
                        envelope: entry.envelope.clone(),
                        remaining: entry.expires.saturating_duration_since(now),
                    })
                }
            };
            (result, expired)
        };
        drop(expired);
        result
    }

    /// Idempotent for a well-formed token: releasing an unknown or already
    /// released transfer succeeds. A malformed token is refused.
    pub fn release(&self, transfer_id: &str) -> Result<(), TransferError> {
        let id = uuid::Uuid::parse_str(transfer_id).map_err(|_| TransferError::Invalid)?;
        let removed = {
            let mut state = self.state.lock().map_err(|_| TransferError::Failed)?;
            let removed = state.entries.remove(&id);
            if let Some(entry) = &removed {
                state.bytes = state.bytes.saturating_sub(entry.bytes);
            }
            removed
        };
        drop(removed);
        Ok(())
    }
}

impl Default for TransferLeases {
    fn default() -> Self {
        Self::new()
    }
}

/// Remove every expired entry, return it so the caller can drop holds
/// outside the mutex and keep the byte total exact.
fn take_expired(state: &mut LeaseState, now: Instant) -> Vec<LeaseEntry> {
    let expired_ids: Vec<uuid::Uuid> = state
        .entries
        .iter()
        .filter(|(_, entry)| now >= entry.expires)
        .map(|(id, _)| *id)
        .collect();
    let mut expired = Vec::with_capacity(expired_ids.len());
    for id in expired_ids {
        if let Some(entry) = state.entries.remove(&id) {
            state.bytes = state.bytes.saturating_sub(entry.bytes);
            expired.push(entry);
        }
    }
    expired
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer_types::TransferPayload;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Clone)]
    struct TestClock(Arc<Mutex<Instant>>);

    impl TestClock {
        fn new() -> Self {
            TestClock(Arc::new(Mutex::new(Instant::now())))
        }

        fn advance(&self, duration: Duration) {
            *self.0.lock().unwrap() += duration;
        }

        fn function(&self) -> LeaseClock {
            let clock = self.0.clone();
            Arc::new(move || *clock.lock().unwrap())
        }
    }

    struct FakeHold {
        dropped: Arc<AtomicUsize>,
    }

    impl HeldSnapshot for FakeHold {}

    impl Drop for FakeHold {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn envelope(text: &str) -> TransferEnvelope {
        TransferEnvelope {
            transfer_id: uuid::Uuid::new_v4().to_string(),
            source_document_id: None,
            source_revision: None,
            sensitive: false,
            payload: TransferPayload::Text {
                text: text.to_string(),
            },
            expires_unix: 1,
            source_tab_id: None,
        }
    }

    fn leases() -> TransferLeases {
        let clock: fn() -> Instant = Instant::now;
        TransferLeases::with_clock(
            Arc::new(clock),
            Duration::from_secs(60),
            Duration::from_secs(300),
        )
    }

    #[test]
    fn thirty_third_lease_refused() {
        let leases = leases();
        let mut ids = Vec::new();
        for _ in 0..MAX_TRANSFER_ACTIVE_LEASES {
            let next = envelope("alpha");
            ids.push(next.transfer_id.clone());
            assert!(leases.insert(next, 1, None).is_ok());
        }
        assert_eq!(
            leases.insert(envelope("beta"), 1, None),
            Err(TransferError::TooLarge)
        );
        leases.release(&ids[0]).unwrap();
        assert!(leases.insert(envelope("beta"), 1, None).is_ok());
    }

    #[test]
    fn combined_byte_budget_refused() {
        let leases = leases();
        assert!(leases
            .insert(envelope("alpha"), MAX_TRANSFER_LEASE_BYTES, None)
            .is_ok());
        assert_eq!(
            leases.insert(envelope("beta"), 1, None),
            Err(TransferError::TooLarge)
        );
    }

    #[test]
    fn expired_token_rejected() {
        let clock = TestClock::new();
        let leases = TransferLeases::with_clock(
            clock.function(),
            Duration::from_secs(60),
            Duration::from_secs(300),
        );
        let next = envelope("alpha");
        let id = next.transfer_id.clone();
        assert!(leases.insert(next, 1, None).is_ok());
        clock.advance(Duration::from_secs(60));
        assert!(matches!(leases.get(&id), Err(TransferError::Expired)));
        let state = leases.state.lock().unwrap();
        assert!(state.entries.is_empty());
        assert_eq!(state.bytes, 0);
    }

    #[test]
    fn ttl_is_extended_but_never_past_the_ceiling() {
        let clock = TestClock::new();
        let leases = TransferLeases::with_clock(
            clock.function(),
            Duration::from_secs(60),
            Duration::from_secs(300),
        );
        let next = envelope("alpha");
        let id = next.transfer_id.clone();
        assert!(leases.insert(next, 1, None).is_ok());
        for _ in 0..5 {
            clock.advance(Duration::from_secs(50));
            assert!(leases.get(&id).is_ok());
        }
        clock.advance(Duration::from_secs(49));
        assert!(leases.get(&id).is_ok());
        clock.advance(Duration::from_secs(1));
        assert!(matches!(leases.get(&id), Err(TransferError::Expired)));
    }

    #[test]
    fn last_release_drops_snapshot() {
        let dropped = Arc::new(AtomicUsize::new(0));
        let leases = leases();
        let next = envelope("alpha");
        let id = next.transfer_id.clone();
        let hold: Arc<dyn HeldSnapshot> = Arc::new(FakeHold {
            dropped: dropped.clone(),
        });
        assert!(leases.insert(next, 1, Some(hold)).is_ok());
        assert_eq!(dropped.load(Ordering::SeqCst), 0);
        leases.release(&id).unwrap();
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
        leases.release(&id).unwrap();
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
        assert!(matches!(leases.get(&id), Err(TransferError::Expired)));
    }

    #[test]
    fn forged_token_is_denied() {
        let leases = leases();
        let forged = uuid::Uuid::new_v4().to_string();
        assert!(matches!(leases.get(&forged), Err(TransferError::Expired)));
        assert!(leases.release(&forged).is_ok());
        assert!(matches!(leases.get("forged"), Err(TransferError::Invalid)));
        assert!(matches!(
            leases.release("forged"),
            Err(TransferError::Invalid)
        ));
    }

    #[test]
    fn duplicate_identity_keeps_the_first_hold() {
        let dropped = Arc::new(AtomicUsize::new(0));
        let leases = leases();
        let next = envelope("alpha");
        let id = next.transfer_id.clone();
        assert!(leases
            .insert(
                next,
                1,
                Some(Arc::new(FakeHold {
                    dropped: dropped.clone(),
                })),
            )
            .is_ok());
        let duplicate = TransferEnvelope {
            transfer_id: id.clone(),
            ..envelope("beta")
        };
        assert_eq!(
            leases.insert(duplicate, 1, None),
            Err(TransferError::Invalid)
        );
        leases.release(&id).unwrap();
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }
}
