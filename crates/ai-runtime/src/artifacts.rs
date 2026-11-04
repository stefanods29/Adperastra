//! Bounded, profile-bound artifact and input leases (T2, D6-D7, U3/U4).
//!
//! Ordinary artifacts live under the 1 GiB normal store; sensitive artifacts
//! share a 256 MiB memory-only budget. An artifact lease keeps its immutable
//! bytes alive after the public id is released. No function here touches disk.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use uuid::Uuid;

use crate::types::ProfileId;
use crate::types_ui::{AiArtifactInfo, AiArtifactKind};

pub const ARTIFACT_IDLE_EXPIRY_SECONDS: u64 = 300;
pub const ORDINARY_ARTIFACT_LIMIT_BYTES: u64 = 1_073_741_824;
pub const SENSITIVE_ARTIFACT_LIMIT_BYTES: u64 = 268_435_456;

const BAD_REQUEST: &str = "ai.bad_request";
const EXPIRED: &str = "ai.expired";
const MEMORY_LIMIT: &str = "ai.memory_limit";

struct Charge {
    ordinary: Arc<AtomicU64>,
    sensitive: Arc<AtomicU64>,
    len: u64,
    sensitive_entry: bool,
}

impl Drop for Charge {
    fn drop(&mut self) {
        let counter = if self.sensitive_entry {
            &self.sensitive
        } else {
            &self.ordinary
        };
        counter.fetch_sub(self.len, Ordering::AcqRel);
    }
}

/// Reserve `len` bytes in one budget. A compare-and-swap loop is required:
/// two concurrent publishes must never both observe the same free space.
fn reserve_budget(counter: &AtomicU64, limit: u64, len: u64) -> Result<(), String> {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        let next = current.checked_add(len).ok_or(MEMORY_LIMIT)?;
        if next > limit {
            return Err(MEMORY_LIMIT.into());
        }
        match counter.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return Ok(()),
            Err(actual) => current = actual,
        }
    }
}

struct ArtifactEntry {
    info: AiArtifactInfo,
    profile: ProfileId,
    bytes: Vec<u8>,
    leased: AtomicUsize,
    _charge: Charge,
}

struct ArtifactInner {
    entries: BTreeMap<Uuid, Arc<ArtifactEntry>>,
}

/// In-memory artifact registry. Sensitive bytes never reach a cache or temp file.
pub struct AiArtifacts {
    inner: Mutex<ArtifactInner>,
    ordinary: Arc<AtomicU64>,
    sensitive: Arc<AtomicU64>,
}

/// An immutable lease; `Drop` releases only this reader, not the bytes if
/// another reader or the public id still holds them.
pub struct AiArtifactLease {
    entry: Arc<ArtifactEntry>,
}

impl AiArtifactLease {
    pub fn info(&self) -> &AiArtifactInfo {
        &self.entry.info
    }

    pub fn bytes(&self) -> &[u8] {
        &self.entry.bytes
    }

    /// A bounded range; offsets and lengths are checked by the caller too.
    pub fn read(&self, offset: u64, length: u64) -> Result<&[u8], String> {
        let start = usize::try_from(offset).map_err(|_| BAD_REQUEST)?;
        let len = usize::try_from(length).map_err(|_| BAD_REQUEST)?;
        let end = start.checked_add(len).ok_or(BAD_REQUEST)?;
        if end > self.entry.bytes.len() {
            return Err(BAD_REQUEST.into());
        }
        Ok(&self.entry.bytes[start..end])
    }

    pub fn is_sensitive(&self) -> bool {
        self.entry.info.sensitive
    }
}

impl Drop for AiArtifactLease {
    fn drop(&mut self) {
        self.entry.leased.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Default for AiArtifacts {
    fn default() -> Self {
        Self::new()
    }
}

impl AiArtifacts {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ArtifactInner {
                entries: BTreeMap::new(),
            }),
            ordinary: Arc::new(AtomicU64::new(0)),
            sensitive: Arc::new(AtomicU64::new(0)),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, ArtifactInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "ai-artifacts lock poisoned".to_string())
    }

    /// Publish immutable bytes. Same id twice is refused; over-budget is
    /// `ai.memory_limit` before any byte is retained.
    pub fn publish(
        &self,
        profile: ProfileId,
        kind: AiArtifactKind,
        bytes: Vec<u8>,
        sensitive: bool,
        now_unix: u64,
    ) -> Result<AiArtifactInfo, String> {
        let len = bytes.len() as u64;
        if len == 0 {
            return Err(BAD_REQUEST.into());
        }
        let counter = if sensitive {
            &self.sensitive
        } else {
            &self.ordinary
        };
        let limit = if sensitive {
            SENSITIVE_ARTIFACT_LIMIT_BYTES
        } else {
            ORDINARY_ARTIFACT_LIMIT_BYTES
        };
        reserve_budget(counter, limit, len)?;
        let id = Uuid::new_v4();
        let info = AiArtifactInfo {
            id,
            kind,
            byte_len: len,
            expires_unix: now_unix.saturating_add(ARTIFACT_IDLE_EXPIRY_SECONDS),
            sensitive,
        };
        let entry = Arc::new(ArtifactEntry {
            info: info.clone(),
            profile,
            bytes,
            leased: AtomicUsize::new(0),
            _charge: Charge {
                ordinary: self.ordinary.clone(),
                sensitive: self.sensitive.clone(),
                len,
                sensitive_entry: sensitive,
            },
        });
        let mut inner = self.lock()?;
        if inner.entries.contains_key(&id) {
            // Dropping `entry` releases the reservation exactly once through
            // `Charge::drop`; subtracting here as well would underflow the
            // shared budget.
            return Err(BAD_REQUEST.into());
        }
        inner.entries.insert(id, entry);
        Ok(info)
    }

    /// New readers are refused after release; existing leases keep their bytes.
    pub fn release(&self, id: Uuid) -> Result<(), String> {
        let mut inner = self.lock()?;
        inner.entries.remove(&id);
        Ok(())
    }

    /// Metadata without leasing bytes. Foreign profiles are refused.
    pub fn describe(
        &self,
        id: Uuid,
        profile: ProfileId,
        now_unix: u64,
    ) -> Result<AiArtifactInfo, String> {
        let inner = self.lock()?;
        let entry = inner.entries.get(&id).ok_or(EXPIRED)?;
        if entry.profile != profile {
            return Err(BAD_REQUEST.into());
        }
        if now_unix >= entry.info.expires_unix {
            return Err(EXPIRED.into());
        }
        Ok(entry.info.clone())
    }

    /// E5 exact signature: expiry is checked against the current clock.
    pub fn resolve(
        &self,
        id: Uuid,
        expected_kind: AiArtifactKind,
        profile: ProfileId,
    ) -> Result<AiArtifactLease, String> {
        self.resolve_at(id, expected_kind, profile, unix_now())
    }

    pub fn resolve_at(
        &self,
        id: Uuid,
        expected_kind: AiArtifactKind,
        profile: ProfileId,
        now_unix: u64,
    ) -> Result<AiArtifactLease, String> {
        let mut inner = self.lock()?;
        let entry = inner.entries.get(&id).cloned().ok_or(EXPIRED)?;
        if entry.profile != profile {
            return Err(BAD_REQUEST.into());
        }
        if entry.info.kind != expected_kind {
            return Err(BAD_REQUEST.into());
        }
        if now_unix >= entry.info.expires_unix {
            if entry.leased.load(Ordering::Acquire) == 0 {
                inner.entries.remove(&id);
            }
            return Err(EXPIRED.into());
        }
        entry.leased.fetch_add(1, Ordering::AcqRel);
        Ok(AiArtifactLease { entry })
    }

    /// Drop idle expired entries. Leased entries are never evicted.
    pub fn sweep(&self, now_unix: u64) -> Result<usize, String> {
        let mut inner = self.lock()?;
        let before = inner.entries.len();
        inner.entries.retain(|_, entry| {
            now_unix < entry.info.expires_unix || entry.leased.load(Ordering::Acquire) > 0
        });
        Ok(before - inner.entries.len())
    }

    pub fn ordinary_bytes(&self) -> u64 {
        self.ordinary.load(Ordering::Acquire)
    }

    pub fn sensitive_bytes(&self) -> u64 {
        self.sensitive.load(Ordering::Acquire)
    }

    /// Profile switch/unload: release every public id. Live leases finish.
    pub fn clear_profile(&self, profile: ProfileId) -> Result<(), String> {
        let mut inner = self.lock()?;
        inner.entries.retain(|_, entry| entry.profile != profile);
        Ok(())
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// One immutable source binding handed to a job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputRecord {
    pub kind: crate::types::AiInputKind,
    pub id: Uuid,
    pub content_id: Uuid,
    pub revision: u64,
    pub profile: ProfileId,
}

struct InputEntry {
    record: Arc<InputRecord>,
}

/// Native input bindings. A `document` binding is the original opened
/// backing at revision 1 only; unsaved bytes must arrive as a snapshot.
pub struct InputLeases {
    entries: Mutex<BTreeMap<Uuid, InputEntry>>,
    live: Arc<AtomicUsize>,
}

pub struct InputLease {
    record: Arc<InputRecord>,
    live: Arc<AtomicUsize>,
}

impl InputLease {
    pub fn record(&self) -> &InputRecord {
        &self.record
    }

    pub fn content_id(&self) -> Uuid {
        self.record.content_id
    }

    pub fn revision(&self) -> u64 {
        self.record.revision
    }
}

impl Drop for InputLease {
    fn drop(&mut self) {
        self.live.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Default for InputLeases {
    fn default() -> Self {
        Self::new()
    }
}

impl InputLeases {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(BTreeMap::new()),
            live: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<Uuid, InputEntry>>, String> {
        self.entries
            .lock()
            .map_err(|_| "ai-inputs lock poisoned".to_string())
    }

    pub fn register(&self, record: InputRecord) -> Result<(), String> {
        if record.revision < 1 || record.id.is_nil() {
            return Err(BAD_REQUEST.into());
        }
        if record.kind == crate::types::AiInputKind::Document && record.revision != 1 {
            return Err(BAD_REQUEST.into());
        }
        let mut entries = self.lock()?;
        if entries.contains_key(&record.id) {
            return Err(BAD_REQUEST.into());
        }
        entries.insert(
            record.id,
            InputEntry {
                record: Arc::new(record),
            },
        );
        Ok(())
    }

    /// Resolve one job's expected revision. A mismatch is `ai.source_changed`.
    pub fn resolve(
        &self,
        id: Uuid,
        expected_revision: u64,
        profile: ProfileId,
    ) -> Result<InputLease, String> {
        let entries = self.lock()?;
        let entry = entries.get(&id).ok_or(EXPIRED)?;
        if entry.record.profile != profile {
            return Err(BAD_REQUEST.into());
        }
        if entry.record.revision != expected_revision {
            return Err("ai.source_changed".into());
        }
        self.live.fetch_add(1, Ordering::AcqRel);
        Ok(InputLease {
            record: entry.record.clone(),
            live: self.live.clone(),
        })
    }

    /// New jobs cannot resolve this id; a live job's lease stays valid.
    pub fn release(&self, id: Uuid) -> Result<(), String> {
        let mut entries = self.lock()?;
        entries.remove(&id);
        Ok(())
    }

    /// Leases currently held by running jobs or readers.
    pub fn live_count(&self) -> usize {
        self.live.load(Ordering::Acquire)
    }

    pub fn clear_profile(&self, profile: ProfileId) -> Result<(), String> {
        let mut entries = self.lock()?;
        entries.retain(|_, entry| entry.record.profile != profile);
        Ok(())
    }
}
