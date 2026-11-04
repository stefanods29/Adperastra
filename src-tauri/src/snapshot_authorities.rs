//! Native-only snapshot authorities (Step 08a T2).
//!
//! An authority names the document whose model the capture represents, the
//! storage policy the native provider decided, and the MIME types that
//! provider is allowed to encode. No Tauri command can call
//! `permit_capture_mime`: only native providers do, at registration.

use std::collections::HashMap;
use std::sync::Mutex;

use fs_service::SourceStamp;
use uuid::Uuid;

use crate::export_snapshot_types::{
    valid_snapshot_mime, valid_snapshot_name, SnapshotAuthority, StoragePolicy, MAX_CAPTURE_MIMES,
    MAX_SNAPSHOT_AUTHORITIES,
};

/// What the authority registry keeps privately. `source` and the policy are
/// never chosen by the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotAuthorityRecord {
    pub authority: SnapshotAuthority,
    pub source: Option<SourceStamp>,
    pub capture_mimes: Vec<String>,
}

/// Authorities issued by native providers in this process.
#[derive(Default)]
pub struct SnapshotAuthorityRegistry {
    records: Mutex<HashMap<Uuid, SnapshotAuthorityRecord>>,
}

impl SnapshotAuthorityRegistry {
    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<Uuid, SnapshotAuthorityRecord>>, String> {
        self.records
            .lock()
            .map_err(|_| "snapshot authorities lock poisoned".to_string())
    }

    /// Issue or coalesce one authority. Only native providers call this.
    pub fn register_native(
        &self,
        document_id: Uuid,
        name: &str,
        mime: &str,
        source: Option<SourceStamp>,
        sensitive: bool,
    ) -> Result<SnapshotAuthority, String> {
        if !valid_snapshot_name(name) || !valid_snapshot_mime(mime) {
            return Err("snapshot.bad_request".to_string());
        }
        if let Some(stamp) = &source {
            stamp
                .validate()
                .map_err(|_| "snapshot.bad_request".to_string())?;
        }
        let policy = if sensitive {
            StoragePolicy::Sensitive
        } else {
            StoragePolicy::Ordinary
        };
        let mut records = self.lock()?;
        if let Some(existing) = records.get(&document_id) {
            if existing.source != source || existing.authority.storage_policy != policy {
                return Err("snapshot.bad_request".to_string());
            }
            return Ok(existing.authority.clone());
        }
        if records.len() >= MAX_SNAPSHOT_AUTHORITIES {
            return Err("snapshot.too_large".to_string());
        }
        let authority = SnapshotAuthority {
            document_id,
            name: name.to_string(),
            mime: mime.to_string(),
            storage_policy: policy,
        };
        records.insert(
            document_id,
            SnapshotAuthorityRecord {
                authority: authority.clone(),
                source,
                capture_mimes: vec![mime.to_string()],
            },
        );
        Ok(authority)
    }

    pub fn get(&self, document_id: Uuid) -> Result<SnapshotAuthorityRecord, String> {
        self.lock()?
            .get(&document_id)
            .cloned()
            .ok_or_else(|| "snapshot.bad_request".to_string())
    }

    /// Revoking prevents new uploads; finalized leases keep their data.
    pub fn revoke(&self, document_id: Uuid) -> Result<(), String> {
        self.lock()?.remove(&document_id);
        Ok(())
    }

    /// Native-provider/encoder registration only. Duplicate values are
    /// idempotent; the seventeenth unique value is refused.
    pub fn permit_capture_mime(&self, document_id: Uuid, mime: &str) -> Result<(), String> {
        if !valid_snapshot_mime(mime) {
            return Err("snapshot.bad_request".to_string());
        }
        let mut records = self.lock()?;
        let record = records
            .get_mut(&document_id)
            .ok_or_else(|| "snapshot.bad_request".to_string())?;
        if record.capture_mimes.iter().any(|value| value == mime) {
            return Ok(());
        }
        if record.capture_mimes.len() >= MAX_CAPTURE_MIMES {
            return Err("snapshot.too_large".to_string());
        }
        record.capture_mimes.push(mime.to_string());
        Ok(())
    }

    pub fn capture_mimes(&self, document_id: Uuid) -> Result<Vec<String>, String> {
        Ok(self.get(document_id)?.capture_mimes)
    }
}
