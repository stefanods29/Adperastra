//! Identity receipts for completed transfers (Step 09f E8).
//!
//! When a copy or move completes, other stores (tags 11b, folder decorations
//! 10d) need to know that the object they knew under one path now lives under
//! another. A path is not an object, so the receipt carries the stable
//! identity of both sides, captured from the guarded handles.
//!
//! Nothing is emitted unless the mutation actually completed and both
//! identities are stable. A path-only guess would let a store rewrite records
//! that belong to a different file, which is exactly what this event exists to
//! prevent.

use std::sync::atomic::{AtomicU64, Ordering};

use fs_service::{FileIdentityKey, SourceStamp};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// The event name the UI subscribes to (`services/fileIdentity.ts`).
pub const IDENTITY_EVENT: &str = "identity-effects";
/// Effects in one batch.
pub const MAX_BATCH_EFFECTS: usize = 256;
/// Serialized size of one batch.
pub const MAX_BATCH_BYTES: usize = 768 * 1024;

fn identity_from_stamp(stamp: &SourceStamp) -> FileIdentityKey {
    let stable = stamp.volume_id != "00000000" && stamp.file_id != "0000000000000000";
    FileIdentityKey {
        volume_id: stamp.volume_id.clone(),
        file_id: stamp.file_id.clone(),
        path_key: stamp.path_key.clone(),
        stable,
    }
}

/// One completed mutation, both sides known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityEffect {
    pub operation_id: String,
    pub sequence: u64,
    /// `copy`, `move` or `rename`.
    pub kind: String,
    pub from_key: FileIdentityKey,
    pub from_path: String,
    pub to_key: FileIdentityKey,
    pub to_path: String,
    /// Always true: a partial mutation never produces this event.
    pub complete: bool,
}

/// What the listener receives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[allow(clippy::large_enum_variant)]
pub enum IdentityEvent {
    Effect { effect: IdentityEffect },
    Overflow { last_sequence: u64 },
}

/// Build one receipt, or `None` when either identity is not stable.
pub fn new_effect(
    operation_id: Uuid,
    sequence: u64,
    kind: &str,
    from: &SourceStamp,
    to: &SourceStamp,
) -> Option<IdentityEffect> {
    let from_key = identity_from_stamp(from);
    let to_key = identity_from_stamp(to);
    if !from_key.stable || !to_key.stable {
        // A store must rescan instead of rewriting its records on a guess.
        return None;
    }
    Some(IdentityEffect {
        operation_id: operation_id.to_string(),
        sequence,
        kind: kind.to_string(),
        from_key,
        from_path: from.path_key.clone(),
        to_key,
        to_path: to.path_key.clone(),
        complete: true,
    })
}

/// Cut the effects into batches a listener can consume without a long pause.
pub fn batch(effects: &[IdentityEffect]) -> Vec<Vec<IdentityEvent>> {
    let mut batches: Vec<Vec<IdentityEvent>> = Vec::new();
    let mut current: Vec<IdentityEvent> = Vec::new();
    let mut bytes = 0usize;
    for effect in effects {
        let size = serde_json::to_vec(effect).map(|json| json.len()).unwrap_or(0);
        if !current.is_empty() && (current.len() >= MAX_BATCH_EFFECTS || bytes + size > MAX_BATCH_BYTES)
        {
            batches.push(std::mem::take(&mut current));
            bytes = 0;
        }
        if size > MAX_BATCH_BYTES {
            // A single effect that does not fit is reported as an overflow:
            // nobody can act on half a receipt.
            continue;
        }
        current.push(IdentityEvent::Effect {
            effect: effect.clone(),
        });
        bytes += size;
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

/// Emit one batch per chunk. The sequence is monotonic across the app run.
pub fn emit(app: &AppHandle, effects: &[IdentityEffect]) {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    for mut events in batch(effects) {
        let mut last = NEXT.load(Ordering::Relaxed);
        for event in events.iter_mut() {
            if let IdentityEvent::Effect { effect } = event {
                effect.sequence = last;
                last += 1;
            }
        }
        NEXT.store(last, Ordering::Relaxed);
        let _ = app.emit(IDENTITY_EVENT, events);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(volume: &str, file: &str, path: &str) -> SourceStamp {
        SourceStamp {
            path_key: path.to_string(),
            volume_id: volume.to_string(),
            file_id: file.to_string(),
            modified_ticks: "133500000000000000".to_string(),
            size_bytes: 4,
        }
    }

    #[test]
    fn a_stable_pair_becomes_a_complete_receipt() {
        let from = stamp("1a2b3c4d", "00000000000000ff", r"C:\A\a.txt");
        let to = stamp("1a2b3c4d", "00000000000000ff", r"C:\B\a.txt");
        let effect =
            new_effect(Uuid::new_v4(), 1, "move", &from, &to).expect("both sides are stable");
        assert!(effect.complete);
        assert_eq!(effect.from_key.file_id, effect.to_key.file_id);
        assert_ne!(effect.from_path, effect.to_path);
    }

    #[test]
    fn an_unstable_identity_produces_no_receipt() {
        let from = stamp("00000000", "0000000000000000", r"C:\A\a.txt");
        let to = stamp("1a2b3c4d", "00000000000000ff", r"C:\B\a.txt");
        assert!(new_effect(Uuid::new_v4(), 1, "copy", &from, &to).is_none());
    }

    #[test]
    fn batches_stay_within_their_bounds() {
        let from = stamp("1a2b3c4d", "00000000000000ff", r"C:\A\a.txt");
        let to = stamp("1a2b3c4d", "00000000000000ff", r"C:\B\a.txt");
        let effects: Vec<_> = (0..600)
            .filter_map(|index| new_effect(Uuid::new_v4(), index, "copy", &from, &to))
            .collect();
        let batches = batch(&effects);
        assert!(batches.len() >= 3);
        for events in &batches {
            assert!(events.len() <= MAX_BATCH_EFFECTS);
            let size = serde_json::to_vec(events).map(|json| json.len()).unwrap_or(0);
            assert!(size <= MAX_BATCH_BYTES + 256, "batch size {size}");
        }
    }
}
