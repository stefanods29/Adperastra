impl ExportSnapshots {
    /// Append one contiguous chunk. A gap, duplicate, wrong token, overflow
    /// or finished upload changes nothing and touches no other snapshot.
    pub fn append(
        &self,
        snapshot_id: &str,
        token: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), String> {
        let id = Uuid::parse_str(snapshot_id).map_err(|_| "snapshot.bad_request".to_string())?;
        if !valid_upload_token(token)
            || bytes.is_empty()
            || bytes.len() > MAX_SNAPSHOT_CHUNK
        {
            return Err("snapshot.bad_request".to_string());
        }
        let entry = self
            .uploads_lock()?
            .get(&id)
            .cloned()
            .ok_or_else(|| "snapshot.bad_request".to_string())?;
        let mut entry = entry
            .lock()
            .map_err(|_| "snapshot.bad_request".to_string())?;
        if entry.finished
            || entry.token.as_str() != token
            || entry.last_touched.elapsed() > Duration::from_secs(SNAPSHOT_UPLOAD_IDLE_SECS)
        {
            return Err("snapshot.bad_request".to_string());
        }
        if offset != entry.offset {
            return Err("snapshot.bad_request".to_string());
        }
        let next = entry
            .offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "snapshot.too_large".to_string())?;
        if next > entry.expected_len {
            return Err("snapshot.too_large".to_string());
        }
        if let Some(output) = entry.ordinary.as_mut() {
            use std::io::Write;
            output
                .file_mut()
                .write_all(bytes)
                .map_err(|_| "snapshot.bad_request".to_string())?;
        } else if let Some(memory) = entry.sensitive.as_mut() {
            memory.extend_from_slice(bytes);
        } else {
            return Err("snapshot.bad_request".to_string());
        }
        entry.hasher.update(bytes);
        entry.offset = next;
        entry.last_touched = Instant::now();
        Ok(())
    }

    /// Finish one upload after the exact declared length arrived.
    pub fn finish(&self, snapshot_id: &str) -> Result<ExportSnapshot, String> {
        let id = Uuid::parse_str(snapshot_id).map_err(|_| "snapshot.bad_request".to_string())?;
        let entry = self
            .uploads_lock()?
            .remove(&id)
            .ok_or_else(|| "snapshot.bad_request".to_string())?;
        let mut entry = entry
            .lock()
            .map_err(|_| "snapshot.bad_request".to_string())?;
        if entry.finished || entry.offset != entry.expected_len {
            self.budget.release(entry.expected_len);
            return Err("snapshot.changed".to_string());
        }
        entry.finished = true;
        let mut budget_guard = FinishBudgetGuard {
            budget: self.budget.as_ref(),
            bytes: entry.expected_len,
            armed: true,
        };
        let digest = std::mem::replace(&mut entry.hasher, Sha256::new()).finalize();
        let content_sha256 = {
            let mut text = String::with_capacity(64);
            for byte in digest.iter() {
                text.push_str(&format!("{byte:02x}"));
            }
            text
        };
        let snapshot = ExportSnapshot {
            snapshot_id: id.to_string(),
            document_id: entry.document_id.to_string(),
            revision: entry.revision,
            content_id: entry.content_id,
            mime: entry.mime.clone(),
            byte_len: entry.expected_len,
            source: entry.source.clone(),
            storage_policy: entry.policy,
            expires_unix: now_unix() + SNAPSHOT_LEASE_IDLE_SECS,
        };
        let backing = if entry.policy == StoragePolicy::Sensitive {
            let bytes = entry
                .sensitive
                .take()
                .ok_or_else(|| "snapshot.bad_request".to_string())?;
            Arc::new(GrantedBacking::Memory {
                length: entry.expected_len,
                sensitive: true,
                bytes: Arc::new(bytes),
            })
        } else {
            let mut output = entry
                .ordinary
                .take()
                .ok_or_else(|| "snapshot.bad_request".to_string())?;
            output
                .flush_sync()
                .map_err(|_| "snapshot.bad_request".to_string())?;
            let file = output.file_mut().try_clone()
                .map_err(|_| "snapshot.changed".to_string())?;
            let source = PinnedSource::from_owned_file(file)
                .map_err(|_| "snapshot.changed".to_string())?;
            entry.ordinary = Some(output);
            Arc::new(GrantedBacking::Disk {
                length: entry.expected_len,
                source: Arc::new(source),
            })
        };
        let retention = Arc::new(SnapshotRetentionHandle {
            budget: self.budget.clone(),
            byte_len: entry.expected_len,
            owned: entry.ordinary.take().map(Mutex::new),
        });
        let finalized = FinalizedEntry {
            snapshot: snapshot.clone(),
            content_sha256,
            backing,
            retention,
            expires_at: Mutex::new(Instant::now() + Duration::from_secs(SNAPSHOT_LEASE_IDLE_SECS)),
        };
        // The retention handle now owns the budget reservation; it releases
        // exactly once, even when insertion below cannot happen.
        budget_guard.armed = false;
        self.finalized_lock()?.insert(id, Arc::new(finalized));
        Ok(snapshot)
    }


}
