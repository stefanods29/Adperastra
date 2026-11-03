/// A marker trait whose implementor keeps a snapshot's bytes alive. The
/// native owner drops it only after every lease clone is gone.
pub trait SnapshotRetention: Send + Sync {}

/// What a resolver receives: the immutable identity, the backing bytes and
/// the retention handle that keeps them alive.
pub struct SnapshotLease {
    pub snapshot: ExportSnapshot,
    pub backing: Arc<GrantedBacking>,
    pub retention: Arc<dyn SnapshotRetention>,
    pub content_sha256: String,
}

#[derive(Default)]
struct SnapshotBudget {
    reserved: AtomicU64,
}

impl SnapshotBudget {
    fn reserve(&self, bytes: u64) -> Result<(), String> {
        let mut current = self.reserved.load(Ordering::Relaxed);
        loop {
            let next = current
                .checked_add(bytes)
                .ok_or_else(|| "snapshot.too_large".to_string())?;
            if next > MAX_SNAPSHOT_TOTAL_BYTES {
                return Err("snapshot.too_large".to_string());
            }
            match self.reserved.compare_exchange_weak(
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

    fn release(&self, bytes: u64) {
        let mut current = self.reserved.load(Ordering::Relaxed);
        loop {
            let next = current.saturating_sub(bytes);
            match self.reserved.compare_exchange_weak(
                current,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(value) => current = value,
            }
        }
    }
}

/// Releases the budget and removes an ordinary finalized file once the last
/// lease is gone. A failure leaves the file for startup cleanup.
struct SnapshotRetentionHandle {
    budget: Arc<SnapshotBudget>,
    byte_len: u64,
    owned: Option<Mutex<OwnedOutput>>,
}

impl SnapshotRetention for SnapshotRetentionHandle {}

impl Drop for SnapshotRetentionHandle {
    fn drop(&mut self) {
        self.budget.release(self.byte_len);
        // OwnedOutput disposes through the exact still-owned file handle.
        self.owned.take();
    }
}

/// Releases a finish's reservation when finalization fails before the
/// retention handle exists.
struct FinishBudgetGuard<'a> {
    budget: &'a SnapshotBudget,
    bytes: u64,
    armed: bool,
}

impl Drop for FinishBudgetGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.budget.release(self.bytes);
        }
    }
}

struct UploadEntry {
    document_id: Uuid,
    revision: u64,
    content_id: Uuid,
    token: String,
    expected_len: u64,
    mime: String,
    source: Option<SourceStamp>,
    policy: StoragePolicy,
    offset: u64,
    hasher: Sha256,
    ordinary: Option<OwnedOutput>,
    sensitive: Option<Zeroizing<Vec<u8>>>,
    last_touched: Instant,
    finished: bool,
}

struct FinalizedEntry {
    snapshot: ExportSnapshot,
    /// SHA-256 of the exact received bytes, kept for native integrity checks.
    content_sha256: String,
    backing: Arc<GrantedBacking>,
    retention: Arc<SnapshotRetentionHandle>,
    expires_at: Mutex<Instant>,
}

type UploadEntries = HashMap<Uuid, Arc<Mutex<UploadEntry>>>;

/// The managed snapshot registry.
pub struct ExportSnapshots {
    input_dir: Arc<PinnedDirectory>,
    budget: Arc<SnapshotBudget>,
    authorities: SnapshotAuthorityRegistry,
    uploads: Mutex<UploadEntries>,
    finalized: Mutex<HashMap<Uuid, Arc<FinalizedEntry>>>,
}

