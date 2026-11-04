//! Native locked-folder sessions (Step 09k D10-D12, E4/E8). A session holds
//! the decrypted index and the container identity only while unlocked; a
//! lock takes and zeroizes both. Pending generations are complete verified
//! containers, never a plaintext fallback.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use fs_service::owned_io::{dispose_orphaned_staging, SourceIdentity};
use locked_store::secrecy::SecretString;
use locked_store::chunks::read_entry_range as read_range_from_index;
use locked_store::crypto::ContainerIdentity;
use locked_store::format::ContainerFile;
use locked_store::generations::{write_generation, ChangeSet, Generation};
use locked_store::index::{children_page, entry as index_entry};
use locked_store::lifecycle::{idle_due, lock_decision, LockDecision};
use locked_store::open::{unlock_with_password, unlock_with_recovery};
use locked_store::pending::{PendingCapture, PendingRecord, PendingStore};
use locked_store::types::{
    LockedCopyRequest, LockedCopyResult, LockedEntry, LockedEntryPage, LockedIndex,
    LockedPersistRequest, LockedPersistResult, LockedRecoveryAction, LockedRecoveryItem,
    LockedSession, LockedSessionState, LockedSettings, LockRequest,
};
use locked_store::verify::verify_generation;
use locked_store::{LockedError, LockedResult, Limits};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::files::FileGrants;

pub const MAX_INTERACTIVE_SESSIONS: usize = 32;
/// Most memory grants one unlocked session may keep alive at once. Each
/// grant is at most one 8 MiB wrapper request; the count and the shared
/// 1 GiB budget together bound decrypted bytes held by the protocol.
pub const MAX_GRANT_LEASES_PER_SESSION: usize = 32;

/// One live protocol grant. The map key is the token; the session that owns
/// the map is the only authority that can keep it alive, and the byte count
/// is charged to the shared open-memory budget until release or lock.
pub struct GrantLease {
    pub bytes: u64,
}

pub struct LockedRuntime {
    pub session: LockedSession,
    pub container: Option<ContainerFile>,
    pub index: Option<LockedIndex>,
    pub identity: Option<ContainerIdentity>,
    /// Identity of the container file that was opened for this session.
    /// A different file at the same path surfaces `locked.changed` instead
    /// of serving bytes from a container the user replaced.
    pub source_identity: Option<SourceIdentity>,
    pub last_input: SystemTime,
    pub grants: HashMap<String, GrantLease>,
    pub pending_changes: HashMap<Uuid, ChangeSet>,
    pub dirty_entries: std::collections::HashSet<Uuid>,
    /// One entry -> the immutable content identity and captured document
    /// revision whose encoded bytes are present in the latest verified
    /// pending generation. A new edit or an explicit discard removes
    /// exactly this entry's receipt.
    pub verified_captures: HashMap<Uuid, (Uuid, u64)>,
    pub pending_verified: bool,
    pub pending_id: Option<Uuid>,
    pub saving: bool,
}

impl LockedRuntime {
    pub fn identity(&self) -> LockedResult<&ContainerIdentity> {
        self.identity.as_ref().ok_or(LockedError::Locked)
    }

    pub fn index(&self) -> LockedResult<&LockedIndex> {
        self.index.as_ref().ok_or(LockedError::Locked)
    }

    pub fn container_mut(&mut self) -> LockedResult<&mut ContainerFile> {
        self.container.as_mut().ok_or(LockedError::Locked)
    }

    pub fn open_grant_bytes(&self) -> u64 {
        self.grants.values().map(|lease| lease.bytes).sum()
    }

    pub fn entry(&self, entry_id: Uuid) -> LockedResult<LockedEntry> {
        index_entry(self.index()?, entry_id)
            .cloned()
            .ok_or(LockedError::Invalid)
    }

    fn take_secrets(&mut self) {
        if let Some(mut index) = self.index.take() {
            for entry in &mut index.entries {
                entry.name.zeroize();
                entry.mime.zeroize();
            }
            for chunk in &mut index.chunk_records {
                chunk.cipher_sha256.zeroize();
                chunk.plain_sha256.zeroize();
            }
        }
        let _ = self.identity.take();
        let _ = self.container.take();
        self.source_identity = None;
        self.pending_changes.clear();
        self.verified_captures.clear();
        self.pending_verified = false;
        self.pending_id = None;
    }
}

pub struct LockedSessions {
    runtimes: Mutex<HashMap<Uuid, Arc<Mutex<LockedRuntime>>>>,
    pending: PendingStore,
    settings: Mutex<LockedSettings>,
    open_memory: std::sync::atomic::AtomicU64,
    /// Consecutive interactive failures per normalized container path. The
    /// fourth attempt within the delay window waits five seconds; this is
    /// never a permanent lockout and never blocks a correct password.
    unlock_failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl LockedSessions {
    pub fn new(pending_root: PathBuf, settings: LockedSettings) -> LockedResult<Self> {
        let pending = PendingStore::new(pending_root)?;
        // A previous crash may have left a `~adp-pending-*.partial` staging
        // file. Only files nobody holds are removed; a live writer keeps its
        // staging file open exclusively and is skipped by the helper.
        if let Ok(entries) = std::fs::read_dir(pending.root()) {
            for entry in entries.flatten().take(1024) {
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    let _ = dispose_orphaned_staging(&entry.path().join("pending"));
                }
            }
        }
        Ok(Self {
            runtimes: Mutex::new(HashMap::new()),
            pending,
            settings: Mutex::new(settings),
            open_memory: std::sync::atomic::AtomicU64::new(0),
            unlock_failures: Mutex::new(HashMap::new()),
        })
    }

    pub fn reserve_open_memory(&self, bytes: u64) -> LockedResult<()> {
        use std::sync::atomic::Ordering;
        let mut current = self.open_memory.load(Ordering::Relaxed);
        loop {
            let next = current.saturating_add(bytes);
            if next > locked_store::limits::MAX_GLOBAL_OPEN_MEMORY {
                return Err(LockedError::TooLarge);
            }
            match self.open_memory.compare_exchange_weak(
                current,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(()),
                Err(value) => current = value,
            }
        }
    }

    pub fn release_open_memory(&self, bytes: u64) {
        use std::sync::atomic::Ordering;
        let _ = self
            .open_memory
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(current.saturating_sub(bytes))
            });
    }

    pub fn settings(&self) -> LockedSettings {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn set_settings(&self, settings: LockedSettings) -> LockedResult<()> {
        settings.validate()?;
        let mut current = self
            .settings
            .lock()
            .map_err(|_| LockedError::Locked)?;
        *current = settings;
        Ok(())
    }

    fn lock_runtimes(
        &self,
    ) -> LockedResult<std::sync::MutexGuard<'_, HashMap<Uuid, Arc<Mutex<LockedRuntime>>>>> {
        self.runtimes.lock().map_err(|_| LockedError::Locked)
    }

    pub fn get(&self, session_id: Uuid) -> LockedResult<Arc<Mutex<LockedRuntime>>> {
        self.lock_runtimes()?
            .get(&session_id)
            .cloned()
            .ok_or(LockedError::Locked)
    }

    /// Case-insensitive, prefix-normalized key for one container path.
    fn path_key(path: &Path) -> String {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = text.strip_prefix("\\\\?\\").unwrap_or(&text);
        text.to_ascii_lowercase()
    }

    fn session_path_key(session: &LockedSession) -> String {
        Self::path_key(Path::new(&session.container_path))
    }

    /// The opened container must still be the same file as when it was
    /// unlocked. A replaced, moved or truncated container is reported as
    /// `locked.changed` so the UI can ask the user to reopen it; bytes from
    /// the old pinned handle are never presented as the new file.
    fn verify_runtime_source(runtime: &LockedRuntime) -> LockedResult<()> {
        let expected = runtime
            .source_identity
            .ok_or(LockedError::Locked)?;
        let current = SourceIdentity::capture(Path::new(&runtime.session.container_path))
            .map_err(|_| LockedError::Changed)?;
        if current != expected {
            return Err(LockedError::Changed);
        }
        runtime
            .container
            .as_ref()
            .ok_or(LockedError::Locked)?
            .verify_source()
    }

    /// Provider-side check for the commands that read the index directly.
    pub fn ensure_source_unchanged(&self, session_id: Uuid) -> LockedResult<()> {
        let runtime = self.get(session_id)?;
        let runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)
    }

    /// Remove secretless (locked) sessions oldest-first until there is room.
    /// A session that still holds keys is never dropped by capacity.
    fn free_session_slot(
        runtimes: &mut HashMap<Uuid, Arc<Mutex<LockedRuntime>>>,
    ) -> LockedResult<()> {
        while runtimes.len() >= MAX_INTERACTIVE_SESSIONS {
            let victim = runtimes
                .iter()
                .filter_map(|(id, handle)| {
                    let runtime = handle.lock().ok()?;
                    (runtime.session.state == LockedSessionState::Locked)
                        .then_some((*id, runtime.last_input))
                })
                .min_by_key(|(_, last_input)| *last_input)
                .map(|(id, _)| id);
            let Some(victim) = victim else {
                return Err(LockedError::TooLarge);
            };
            runtimes.remove(&victim);
        }
        Ok(())
    }

    fn failure_key(path: &Path) -> String {
        path.to_string_lossy().to_ascii_lowercase()
    }

    fn throttle_unlock(&self, key: &str) {
        let wait = {
            let Ok(failures) = self.unlock_failures.lock() else {
                return;
            };
            match failures.get(key) {
                Some((count, last)) if *count >= locked_store::limits::MAX_INTERACTIVE_FAILURES => {
                    let delay = Duration::from_millis(locked_store::limits::FAILURE_DELAY_MS);
                    delay.checked_sub(last.elapsed()).unwrap_or_default()
                }
                _ => Duration::ZERO,
            }
        };
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
    }

    fn note_unlock_failure(&self, key: &str) {
        let Ok(mut failures) = self.unlock_failures.lock() else {
            return;
        };
        if failures.len() >= 64 && !failures.contains_key(key) {
            failures.retain(|_, (_, last)| last.elapsed() < Duration::from_secs(3_600));
        }
        let record = failures.entry(key.to_string()).or_insert((0, Instant::now()));
        record.0 = record.0.saturating_add(1);
        record.1 = Instant::now();
    }

    fn clear_unlock_failure(&self, key: &str) {
        if let Ok(mut failures) = self.unlock_failures.lock() {
            failures.remove(key);
        }
    }

    pub fn unlock(
        &self,
        path: &Path,
        password: Option<&SecretString>,
        recovery_secret: Option<&str>,
    ) -> LockedResult<LockedSession> {
        let key = Self::failure_key(path);
        let path_key = Self::path_key(path);
        // A second unlock of an already unlocked container returns the one
        // shared session instead of decrypted twice. The file at the path
        // must still be the one that session opened.
        let existing = {
            let runtimes = self.lock_runtimes()?;
            runtimes.values().find_map(|handle| {
                let runtime = handle.lock().ok()?;
                (Self::session_path_key(&runtime.session) == path_key)
                    .then_some(handle.clone())
            })
        };
        if let Some(handle) = existing {
            let mut runtime = handle.lock().map_err(|_| LockedError::Locked)?;
            if runtime.session.state != LockedSessionState::Locked {
                Self::verify_runtime_source(&runtime)?;
                runtime.last_input = SystemTime::now();
                self.clear_unlock_failure(&key);
                return Ok(runtime.session.clone());
            }
        }
        self.throttle_unlock(&key);
        let opened = match (password, recovery_secret) {
            (Some(password), None) => unlock_with_password(path, password, Limits::default()),
            (None, Some(secret)) => unlock_with_recovery(path, secret, Limits::default()),
            _ => return Err(LockedError::Invalid),
        };
        let opened = match opened {
            Ok(opened) => {
                self.clear_unlock_failure(&key);
                opened
            }
            Err(error) => {
                if error == LockedError::BadPasswordOrCorrupt {
                    self.note_unlock_failure(&key);
                }
                return Err(error);
            }
        };
        let header_id = opened.file.header().container_id;
        let revision = opened.index.revision;
        // Capture the path identity while the pinned read handle is open;
        // a later replacement cannot slip between the two observations.
        let captured = SourceIdentity::capture(path).map_err(LockedError::from)?;
        let pending_recovery = !self.pending.list(header_id).is_empty();
        let mut runtimes = self.lock_runtimes()?;
        // A concurrent unlock may have won while this one was decrypting.
        let mut replace_locked = false;
        for handle in runtimes.values() {
            let Ok(runtime) = handle.lock() else {
                continue;
            };
            if Self::session_path_key(&runtime.session) != path_key {
                continue;
            }
            if runtime.session.state == LockedSessionState::Locked {
                replace_locked = true;
                continue;
            }
            if runtime.session.container_id != header_id
                || runtime.session.revision != revision
                || runtime.source_identity != Some(captured)
            {
                return Err(LockedError::Changed);
            }
            drop(runtime);
            let mut runtime = handle.lock().map_err(|_| LockedError::Locked)?;
            runtime.last_input = SystemTime::now();
            return Ok(runtime.session.clone());
        }
        if replace_locked {
            // Drop every secretless session for this path; the newly opened
            // container replaces them and there is one session per path.
            runtimes.retain(|_, handle| {
                handle.lock().is_ok_and(|runtime| {
                    !(Self::session_path_key(&runtime.session) == path_key
                        && runtime.session.state == LockedSessionState::Locked)
                })
            });
        }
        Self::free_session_slot(&mut runtimes)?;
        let session_id = Uuid::new_v4();
        let mut session = LockedSession::unlocked(
            session_id,
            path.to_string_lossy().into_owned(),
            header_id,
            revision,
            u32::try_from(opened.index.entries.len()).unwrap_or(u32::MAX),
        );
        session.pending_recovery = pending_recovery;
        let runtime = LockedRuntime {
            session: session.clone(),
            container: Some(opened.file),
            index: Some(opened.index),
            identity: Some(opened.identity),
            source_identity: Some(captured),
            last_input: SystemTime::now(),
            grants: HashMap::new(),
            pending_changes: HashMap::new(),
            dirty_entries: std::collections::HashSet::new(),
            verified_captures: HashMap::new(),
            pending_verified: false,
            pending_id: None,
            saving: false,
        };
        runtimes.insert(session_id, Arc::new(Mutex::new(runtime)));
        Ok(session)
    }

    /// True when this opaque document id is an entry in a live locked
    /// session. Used by the 09a commit guard before any save mutation.
    pub fn document_is_locked(&self, document_id: Uuid) -> bool {
        let Ok(runtimes) = self.lock_runtimes() else {
            return false;
        };
        runtimes.values().any(|runtime| {
            runtime.lock().is_ok_and(|runtime| {
                runtime
                    .index
                    .as_ref()
                    .is_some_and(|index| index.entries.iter().any(|entry| entry.id == document_id))
            })
        })
    }

    pub fn touch(&self, session_id: Uuid) -> LockedResult<()> {
        let runtime = self.get(session_id)?;
        let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        runtime.last_input = SystemTime::now();
        Ok(())
    }

    /// Track the provider's dirty flag for one entry. The native lock never
    /// relies on the UI to say "clean" when bytes changed.
    pub fn mark_dirty(
        &self,
        session_id: Uuid,
        entry_id: Uuid,
        dirty: bool,
    ) -> LockedResult<()> {
        let runtime = self.get(session_id)?;
        let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)?;
        let _ = runtime.entry(entry_id)?;
        if dirty {
            runtime.dirty_entries.insert(entry_id);
            // A new edit supersedes the receipt for this entry only. Other
            // entries keep their verified captures.
            runtime.verified_captures.remove(&entry_id);
        } else {
            runtime.dirty_entries.remove(&entry_id);
            runtime.pending_changes.remove(&entry_id);
            runtime.verified_captures.remove(&entry_id);
        }
        runtime.session.dirty = !runtime.dirty_entries.is_empty();
        runtime.pending_verified = runtime.session.dirty
            && runtime
                .dirty_entries
                .iter()
                .all(|id| runtime.verified_captures.contains_key(id));
        Ok(())
    }

    pub fn list(
        &self,
        session_id: Uuid,
        parent_id: Option<Uuid>,
        cursor: Option<Uuid>,
    ) -> LockedResult<LockedEntryPage> {
        let runtime = self.get(session_id)?;
        let runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)?;
        let index = runtime.index()?;
        let (mut page, next_cursor, complete) = children_page(index, parent_id, cursor)?;
        // The UI never needs a file's chunk-id list; omitting it keeps one
        // page well under the IPC response bound (P-10).
        for entry in &mut page {
            entry.chunks.clear();
        }
        Ok(LockedEntryPage {
            entries: page,
            next_cursor,
            complete,
            session_id,
            revision: index.revision,
        })
    }

    pub fn read_entry_range(
        &self,
        session_id: Uuid,
        entry_id: Uuid,
        offset: u64,
        length: u64,
    ) -> LockedResult<zeroize::Zeroizing<Vec<u8>>> {
        let runtime = self.get(session_id)?;
        let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)?;
        let runtime = &mut *runtime;
        let index = runtime.index.as_ref().ok_or(LockedError::Locked)?;
        let entry = index_entry(index, entry_id)
            .cloned()
            .ok_or(LockedError::Invalid)?;
        let identity = runtime.identity.as_ref().ok_or(LockedError::Locked)?;
        let container = runtime.container.as_mut().ok_or(LockedError::Locked)?;
        read_range_from_index(
            identity,
            &entry,
            &index.chunk_records,
            offset,
            length,
            |id| container.read_chunk(id),
        )
    }

    /// Persist one immutable capture as a complete verified pending
    /// generation. The original container is never changed.
    pub fn persist(
        &self,
        request: &LockedPersistRequest,
        snapshots: &crate::export_snapshots::ExportSnapshots,
        token: &fs_service::CancellationToken,
    ) -> LockedResult<LockedPersistResult> {
        let runtime = self.get(request.session_id)?;
        let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if !matches!(runtime.session.state, LockedSessionState::Unlocked | LockedSessionState::LockPending) {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)?;
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(LockedError::Cancelled);
        }
        if runtime.session.revision != request.expected_container_revision {
            return Err(LockedError::Changed);
        }
        let entry = runtime.entry(request.entry_id)?;
        if !entry.editable() {
            return Err(LockedError::TooLarge);
        }
        // A new capture invalidates only this entry's old receipt; the
        // generation is written before any receipt is reported again.
        runtime.pending_verified = false;
        runtime.verified_captures.remove(&request.entry_id);
        let lease = snapshots
            .resolve_exact(
                &request.snapshot_id.to_string(),
                &request.entry_id.to_string(),
                request.captured_revision,
                &request.content_id.to_string(),
            )
            .map_err(|_| LockedError::Changed)?;
        if lease.snapshot.storage_policy != crate::export_snapshot_types::StoragePolicy::Sensitive {
            return Err(LockedError::UnencryptedCopyRequired);
        }
        if lease.snapshot.byte_len > locked_store::limits::MAX_EDITABLE_ENTRY_BYTES {
            return Err(LockedError::TooLarge);
        }
        let length = usize::try_from(lease.snapshot.byte_len)
            .map_err(|_| LockedError::TooLarge)?;
        let mut bytes = zeroize::Zeroizing::new(Vec::with_capacity(length));
        let mut hasher = {
            use sha2::Digest;
            sha2::Sha256::new()
        };
        let mut offset = 0usize;
        while offset < length {
            let take = (length - offset).min(4 * 1024 * 1024);
            let chunk = lease
                .backing
                .read_range(offset as u64, take)
                .map_err(|_| LockedError::Changed)?;
            if chunk.len() != take {
                return Err(LockedError::Changed);
            }
            {
                use sha2::Digest;
                hasher.update(&chunk);
            }
            bytes.extend_from_slice(&chunk);
            offset += take;
        }
        {
            use sha2::Digest;
            let digest = hasher.finalize();
            let mut text = String::with_capacity(64);
            for byte in digest {
                text.push_str(&format!("{byte:02x}"));
            }
            if !text.eq_ignore_ascii_case(&lease.content_sha256) {
                return Err(LockedError::Changed);
            }
        }
        runtime.pending_changes.insert(
            request.entry_id,
            ChangeSet {
                entry_id: request.entry_id,
                bytes,
                modified_unix: crate::locked_sessions::now_unix(),
            },
        );
        let index = runtime.index()?.clone();
        let identity = runtime.identity()?.clone();
        let password_slot = runtime
            .container_mut()?
            .password_slot()
            .to_vec();
        let recovery_slot = runtime
            .container_mut()?
            .recovery_slot()
            .to_vec();
        let changes: Vec<ChangeSet> = runtime.pending_changes.values().cloned().collect();
        let pending_id = Uuid::new_v4();
        let output = self.pending.begin(index.container_id)?;
        let mut output = output;
        let (new_index, _header) = {
            let container = runtime.container_mut()?;
            write_generation(
                output.file_mut(),
                Generation {
                    source: container,
                    index: &index,
                    identity: &identity,
                    password_slot: &password_slot,
                    recovery_slot: &recovery_slot,
                    changes: &changes,
                    revision: index.revision.saturating_add(1),
                    limits: Limits::default(),
                },
            )?
        };
        output.flush_sync().map_err(LockedError::from)?;
        let closed = output.close();
        let size = std::fs::metadata(closed.path())
            .map(|metadata| metadata.len())
            .unwrap_or(u64::MAX);
        if !self.pending.fits(size) {
            let _ = closed.dispose();
            return Err(LockedError::TooLarge);
        }
        if let Err(error) = verify_generation(closed.path(), &new_index, &identity, Limits::default()) {
            let _ = closed.dispose();
            return Err(error);
        }
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = closed.dispose();
            return Err(LockedError::Cancelled);
        }
        let mut captures: Vec<PendingCapture> = runtime
            .verified_captures
            .iter()
            .map(|(entry_id, (content_id, captured_revision))| PendingCapture {
                entry_id: *entry_id,
                content_id: *content_id,
                captured_revision: *captured_revision,
            })
            .collect();
        captures.retain(|capture| capture.entry_id != request.entry_id);
        captures.push(PendingCapture {
            entry_id: request.entry_id,
            content_id: request.content_id,
            captured_revision: request.captured_revision,
        });
        let record = PendingRecord {
            pending_id,
            container_id: index.container_id,
            revision: new_index.revision,
            created_unix: now_unix(),
            captures,
        };
        self.pending.publish(closed, record)?;
        runtime
            .verified_captures
            .insert(request.entry_id, (request.content_id, request.captured_revision));
        runtime.pending_id = Some(pending_id);
        runtime.session.pending_recovery = true;
        runtime.dirty_entries.insert(request.entry_id);
        runtime.session.dirty = true;
        runtime.pending_verified = runtime
            .dirty_entries
            .iter()
            .all(|id| runtime.verified_captures.contains_key(id));
        Ok(LockedPersistResult {
            session_id: request.session_id,
            entry_id: request.entry_id,
            container_revision: index.revision,
            captured_revision: request.captured_revision,
            content_id: request.content_id,
            pending_id,
            verified: true,
        })
    }

    pub fn save_copy(
        &self,
        request: &LockedCopyRequest,
        token: &fs_service::CancellationToken,
    ) -> LockedResult<LockedCopyResult> {
        let dest = std::path::Path::new(&request.dest_path);
        let extension_ok = dest
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("adplock"));
        if !extension_ok {
            return Err(LockedError::Invalid);
        }
        let runtime = self.get(request.session_id)?;
        let (identity, container_id, source_path, source_revision) = {
            let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
            if !matches!(runtime.session.state, LockedSessionState::Unlocked | LockedSessionState::LockPending) {
                return Err(LockedError::Locked);
            }
            Self::verify_runtime_source(&runtime)?;
            if runtime.session.revision != request.expected_revision {
                return Err(LockedError::Changed);
            }
            let dirty = !runtime.dirty_entries.is_empty();
            let all_verified = dirty
                && runtime.pending_verified
                && runtime
                    .dirty_entries
                    .iter()
                    .all(|id| runtime.verified_captures.contains_key(id));
            if dirty && !all_verified {
                return Err(LockedError::RecoveryRequired);
            }
            let identity = runtime.identity()?.clone();
            let container_id = runtime.index()?.container_id;
            let (source_path, source_revision) = if dirty {
                let pending_id = runtime.pending_id.ok_or(LockedError::RecoveryRequired)?;
                let record = self
                    .pending
                    .record(container_id, pending_id)
                    .ok_or(LockedError::RecoveryRequired)?;
                for entry_id in &runtime.dirty_entries {
                    let (content_id, _) = runtime
                        .verified_captures
                        .get(entry_id)
                        .ok_or(LockedError::RecoveryRequired)?;
                    if !record
                        .captures
                        .iter()
                        .any(|capture| capture.entry_id == *entry_id && capture.content_id == *content_id)
                    {
                        return Err(LockedError::RecoveryRequired);
                    }
                }
                (
                    self.pending.path(container_id, pending_id),
                    record.revision,
                )
            } else {
                (
                    PathBuf::from(&runtime.session.container_path),
                    runtime.session.revision,
                )
            };
            if dest.exists() {
                return Err(LockedError::Changed);
            }
            runtime.saving = true;
            (identity, container_id, source_path, source_revision)
        };
        let _saving = SavingGuard {
            runtime: runtime.clone(),
        };
        let mut source_container = ContainerFile::open(&source_path, Limits::default())?;
        let pending_index = source_container.open_index(&identity)?;
        if pending_index.container_id != container_id || pending_index.revision != source_revision {
            return Err(LockedError::Changed);
        }
        verify_generation(&source_path, &pending_index, &identity, Limits::default())?;
        let parent = dest.parent().ok_or(LockedError::Invalid)?;
        let pin = fs_service::owned_io::PinnedDirectory::open(parent)
            .map_err(LockedError::from)?;
        let mut output = fs_service::owned_io::OwnedOutput::create(&pin, "locked-copy")
            .map_err(LockedError::from)?;
        let mut source = fs_service::owned_io::PinnedSource::open(
            &source_path,
            &fs_service::owned_io::SourceIdentity::capture(&source_path)
                .map_err(LockedError::from)?,
        )
        .map_err(LockedError::from)?;
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            use std::io::{Read, Write};
            if token.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(LockedError::Cancelled);
            }
            let read = source
                .file_mut()
                .read(&mut buffer)
                .map_err(|_| LockedError::Io)?;
            if read == 0 {
                break;
            }
            output
                .file_mut()
                .write_all(&buffer[..read])
                .map_err(LockedError::from)?;
        }
        source.verify_after_read().map_err(LockedError::from)?;
        output.flush_sync().map_err(LockedError::from)?;
        let closed = output.close();
        if let Err(error) = verify_generation(closed.path(), &pending_index, &identity, Limits::default()) {
            let _ = closed.dispose();
            return Err(error);
        }
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = closed.dispose();
            return Err(LockedError::Cancelled);
        }
        closed.publish_to(dest).map_err(LockedError::from)?;
        // The original session, its dirty flag and its model are untouched.
        Ok(LockedCopyResult {
            path: request.dest_path.clone(),
            container_id,
            revision: pending_index.revision,
            original_kept: true,
        })
    }

    pub fn lock(&self, request: &LockRequest, grants: &FileGrants) -> LockedResult<crate::locked_sessions::LockOutcome> {
        let runtime = self.get(request.session_id)?;
        let mut runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state == LockedSessionState::Locked {
            return Ok(LockOutcome {
                locked: true,
                state: runtime.session.clone(),
            });
        }
        if runtime.saving {
            runtime.session.state = LockedSessionState::LockPending;
            return Ok(LockOutcome {
                locked: false,
                state: runtime.session.clone(),
            });
        }
        let verified_pending = if !runtime.session.dirty || !runtime.pending_verified {
            false
        } else if let Some(pending_id) = runtime.pending_id {
            let exists = self
                .pending
                .path(runtime.session.container_id, pending_id)
                .exists();
            let record = self
                .pending
                .record(runtime.session.container_id, pending_id);
            exists
                && record.is_some_and(|record| {
                    record.revision == runtime.session.revision.saturating_add(1)
                        && runtime.dirty_entries.iter().all(|entry_id| {
                            runtime
                                .verified_captures
                                .get(entry_id)
                                .is_some_and(|(content_id, _)| {
                                    record.captures.iter().any(|capture| {
                                        capture.entry_id == *entry_id
                                            && capture.content_id == *content_id
                                    })
                                })
                        })
                })
        } else {
            false
        };
        let decision = lock_decision(
            runtime.session.dirty,
            request.discard_dirty,
            verified_pending,
        );
        if decision == LockDecision::LockPending {
            runtime.session.state = LockedSessionState::LockPending;
            return Ok(LockOutcome {
                locked: false,
                state: runtime.session.clone(),
            });
        }
        runtime.session.state = LockedSessionState::Saving;
        let tokens: Vec<String> = runtime.grants.keys().cloned().collect();
        let had_grants = !tokens.is_empty();
        let released_bytes = runtime.open_grant_bytes();
        for token in tokens {
            crate::document_grants::revoke(grants, &token);
        }
        runtime.grants.clear();
        self.release_open_memory(released_bytes);
        // Revocation stops new reads; the bounded grace lets a protocol
        // request already holding an Arc finish before bytes are zeroized.
        if had_grants {
            std::thread::sleep(locked_store::limits::LOCK_READ_GRACE);
        }
        if request.discard_dirty {
            runtime.pending_changes.clear();
            runtime.dirty_entries.clear();
            runtime.session.dirty = false;
        }
        let has_pending = !self
            .pending
            .list(runtime.session.container_id)
            .is_empty();
        // The lock result says truthfully whether an encrypted pending
        // generation still exists, independent of whether this lock saved
        // a new one or the user explicitly discarded current edits.
        runtime.session.pending_recovery = verified_pending || has_pending;
        runtime.take_secrets();
        runtime.session.state = LockedSessionState::Locked;
        Ok(LockOutcome {
            locked: true,
            state: runtime.session.clone(),
        })
    }

    pub fn due_for_idle(&self) -> Vec<Uuid> {
        let settings = self.settings();
        let now = SystemTime::now();
        let mut due = Vec::new();
        let Ok(runtimes) = self.lock_runtimes() else {
            return due;
        };
        for (id, runtime) in runtimes.iter() {
            if let Ok(runtime) = runtime.lock() {
                if runtime.session.state == LockedSessionState::Unlocked
                    && idle_due(runtime.last_input, settings.auto_lock_minutes, now)
                {
                    due.push(*id);
                }
            }
        }
        due
    }

    pub fn recovery_list(&self, session_id: Uuid) -> LockedResult<Vec<LockedRecoveryItem>> {
        let runtime = self.get(session_id)?;
        let runtime = runtime.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        Self::verify_runtime_source(&runtime)?;
        let container_id = runtime.index()?.container_id;
        Ok(self.pending.list(container_id))
    }

    /// Recover one verified pending generation for this exact container.
    /// The recovery id must belong to the live session's container and the
    /// opened file must repeat that container id and content identity before
    /// its index or any chunk is trusted. Dirty edits are never replaced
    /// implicitly: recovery is offered before entry views are opened.
    pub fn recovery_choose(
        &self,
        session_id: Uuid,
        recovery_id: Uuid,
        action: LockedRecoveryAction,
        grants: &FileGrants,
    ) -> LockedResult<Option<LockedSession>> {
        if session_id.is_nil() || recovery_id.is_nil() {
            return Err(LockedError::Invalid);
        }
        let runtime_handle = self.get(session_id)?;
        let mut runtime = runtime_handle.lock().map_err(|_| LockedError::Locked)?;
        if runtime.session.state != LockedSessionState::Unlocked {
            return Err(LockedError::Locked);
        }
        let container_id = runtime.index()?.container_id;
        match action {
            LockedRecoveryAction::Later => Ok(None),
            LockedRecoveryAction::UseOriginal => Ok(Some(runtime.session.clone())),
            LockedRecoveryAction::Recover => {
                if runtime.saving {
                    return Err(LockedError::LockPending);
                }
                if runtime.session.dirty
                    || !runtime.dirty_entries.is_empty()
                    || !runtime.pending_changes.is_empty()
                {
                    return Err(LockedError::LockPending);
                }
                Self::verify_runtime_source(&runtime)?;
                // Only a recovery id this session listed for its own
                // container may be opened; a guessed id is not authenticated.
                if !self
                    .pending
                    .list(container_id)
                    .iter()
                    .any(|item| item.id == recovery_id)
                {
                    return Err(LockedError::Invalid);
                }
                let record = self.pending.record(container_id, recovery_id);
                if record
                    .as_ref()
                    .is_some_and(|record| record.container_id != container_id)
                {
                    return Err(LockedError::Changed);
                }
                let path = self.pending.path(container_id, recovery_id);
                let source_identity = SourceIdentity::capture(&path)
                    .map_err(|_| LockedError::Changed)?;
                let mut file = match ContainerFile::open(&path, Limits::default()) {
                    Ok(file) => file,
                    Err(LockedError::Io) => return Err(LockedError::Changed),
                    Err(error) => return Err(error),
                };
                let identity = runtime.identity()?.clone();
                {
                    let header = file.header();
                    if header.container_id != container_id
                        || header.content_recipient != identity.recipient()
                    {
                        return Err(LockedError::Changed);
                    }
                }
                let index = file.open_index(&identity)?;
                if index.container_id != container_id {
                    return Err(LockedError::Changed);
                }
                if record
                    .as_ref()
                    .is_some_and(|record| record.revision != index.revision)
                {
                    return Err(LockedError::Changed);
                }
                verify_generation(&path, &index, &identity, Limits::default())?;
                file.verify_source().map_err(|_| LockedError::Changed)?;
                let tokens: Vec<String> = runtime.grants.keys().cloned().collect();
                let had_grants = !tokens.is_empty();
                let released_bytes = runtime.open_grant_bytes();
                for token in tokens {
                    crate::document_grants::revoke(grants, &token);
                }
                runtime.grants.clear();
                self.release_open_memory(released_bytes);
                if had_grants {
                    std::thread::sleep(locked_store::limits::LOCK_READ_GRACE);
                }
                runtime.session.revision = index.revision;
                runtime.session.entry_count =
                    u32::try_from(index.entries.len()).unwrap_or(u32::MAX);
                runtime.session.dirty = false;
                runtime.dirty_entries.clear();
                runtime.pending_changes.clear();
                // The recovered generation remains an encrypted recovery of
                // the retained original, so the flag stays true.
                runtime.session.pending_recovery = true;
                runtime.session.container_path = path.to_string_lossy().into_owned();
                runtime.index = Some(index);
                runtime.container = Some(file);
                runtime.source_identity = Some(source_identity);
                runtime.verified_captures.clear();
                runtime.pending_verified = false;
                runtime.pending_id = Some(recovery_id);
                runtime.last_input = SystemTime::now();
                Ok(Some(runtime.session.clone()))
            }
        }
    }

    /// Feed one Windows workstation-lock event. The OS watcher is wired by
    /// the coordinator; this method owns the decision and never discards.
    pub fn on_workstation_lock(&self, grants: &FileGrants) {
        if !self.settings().lock_on_workstation {
            return;
        }
        self.lock_all(grants, locked_store::types::LockRequestMode::Workstation);
    }

    pub fn lock_all(&self, grants: &FileGrants, mode: locked_store::types::LockRequestMode) {
        let ids: Vec<Uuid> = self
            .lock_runtimes()
            .map(|runtimes| runtimes.keys().copied().collect())
            .unwrap_or_default();
        for session_id in ids {
            let _ = self.lock(
                &LockRequest {
                    session_id,
                    mode,
                    discard_dirty: false,
                },
                grants,
            );
        }
    }
}

struct SavingGuard {
    runtime: Arc<Mutex<LockedRuntime>>,
}

impl Drop for SavingGuard {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.saving = false;
        }
    }
}

pub struct LockOutcome {
    pub locked: bool,
    pub state: LockedSession,
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}
