impl ExportSnapshots {
    /// Abandon an upload; only this snapshot's staging or memory is dropped.
    pub fn abort_upload(&self, snapshot_id: &str) -> Result<(), String> {
        let id = Uuid::parse_str(snapshot_id).map_err(|_| "snapshot.bad_request".to_string())?;
        let entry = self
            .uploads_lock()?
            .remove(&id)
            .ok_or_else(|| "snapshot.bad_request".to_string())?;
        let mut entry = entry
            .lock()
            .map_err(|_| "snapshot.bad_request".to_string())?;
        entry.finished = true;
        entry.ordinary.take();
        entry.sensitive.take();
        self.budget.release(entry.expected_len);
        Ok(())
    }

    pub fn resolve(
        &self,
        snapshot_id: &str,
        document_id: &str,
        revision: u64,
    ) -> Result<SnapshotLease, String> {
        let id = Uuid::parse_str(snapshot_id).map_err(|_| "snapshot.changed".to_string())?;
        let entry = self
            .finalized_lock()?
            .get(&id)
            .cloned()
            .ok_or_else(|| "snapshot.changed".to_string())?;
        if entry.snapshot.document_id.as_str() != document_id
            || entry.snapshot.revision != revision
        {
            return Err("snapshot.changed".to_string());
        }
        let mut expires = entry
            .expires_at
            .lock()
            .map_err(|_| "snapshot.changed".to_string())?;
        if Instant::now() >= *expires {
            return Err("snapshot.changed".to_string());
        }
        *expires = Instant::now() + Duration::from_secs(SNAPSHOT_LEASE_IDLE_SECS);
        let mut snapshot = entry.snapshot.clone();
        snapshot.expires_unix = now_unix() + SNAPSHOT_LEASE_IDLE_SECS;
        Ok(SnapshotLease {
            snapshot,
            backing: entry.backing.clone(),
            retention: entry.retention.clone(),
            content_sha256: entry.content_sha256.clone(),
        })
    }

    /// The PDF resolver additionally binds the immutable model content ID.
    pub fn resolve_exact(
        &self,
        snapshot_id: &str,
        document_id: &str,
        revision: u64,
        content_id: &str,
    ) -> Result<SnapshotLease, String> {
        let lease = self.resolve(snapshot_id, document_id, revision)?;
        let expected =
            Uuid::parse_str(content_id).map_err(|_| "snapshot.changed".to_string())?;
        if lease.snapshot.content_id != expected {
            return Err("snapshot.changed".to_string());
        }
        Ok(lease)
    }

    /// Release stops new acquisitions. A live lease keeps its bytes (and
    /// keeps counting against the budget) until it is dropped.
    pub fn release(&self, snapshot_id: &str) -> Result<(), String> {
        let id = Uuid::parse_str(snapshot_id).map_err(|_| "snapshot.bad_request".to_string())?;
        self.finalized_lock()?.remove(&id);
        Ok(())
    }

    pub fn release_snapshot_authority(&self, document_id: &str) -> Result<(), String> {
        let id =
            Uuid::parse_str(document_id).map_err(|_| "snapshot.bad_request".to_string())?;
        self.authorities.revoke(id)
    }

    /// Keep idle snapshot budgets bounded even when no further upload arrives.
    pub fn start_cleanup(snapshots: &Arc<Self>) {
        let snapshots = Arc::downgrade(snapshots);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(30));
            let Some(snapshots) = snapshots.upgrade() else { break; };
            snapshots.cleanup_expired();
        });
    }

    /// Startup/periodic cleanup: expired snapshots nobody holds are dropped,
    /// and an upload that stayed idle for five minutes is abandoned with
    /// only its own staging/memory.
    pub fn cleanup_expired(&self) {
        let now = Instant::now();
        if let Ok(mut finalized) = self.finalized_lock() {
            finalized.retain(|_, entry| {
                let expired = entry
                    .expires_at
                    .lock()
                    .map(|expires| now >= *expires)
                    .unwrap_or(false);
                !(expired && Arc::strong_count(&entry.retention) == 1)
            });
        }
        let stale: Vec<Uuid> = match self.uploads_lock() {
            Ok(uploads) => uploads
                .iter()
                .filter_map(|(id, entry)| {
                    let entry = entry.lock().ok()?;
                    if !entry.finished
                        && entry.last_touched.elapsed()
                            > Duration::from_secs(SNAPSHOT_UPLOAD_IDLE_SECS)
                    {
                        Some(*id)
                    } else {
                        None
                    }
                })
                .collect(),
            Err(_) => return,
        };
        for id in stale {
            let removed = self
                .uploads_lock()
                .ok()
                .and_then(|mut uploads| uploads.remove(&id));
            if let Some(entry) = removed {
                if let Ok(mut entry) = entry.lock() {
                    entry.finished = true;
                    entry.ordinary.take();
                    entry.sensitive.take();
                    self.budget.release(entry.expected_len);
                }
            }
        }
    }

}
