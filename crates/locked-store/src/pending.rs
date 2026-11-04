//! Verified encrypted pending generations (Step 09k D11/E8). Every dirty
//! capture becomes a complete standard container under
//! `<data>/locked-pending/<containerUUID>/<revisionUUID>.adplock`; metadata
//! names only opaque ids and revisions, never an inner name, view or secret.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use fs_service::owned_io::{ClosedOutput, OwnedOutput, PinnedDirectory};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{LockedError, LockedResult};
use crate::limits::{
    MAX_PENDING_GENERATION_BYTES, MAX_PENDING_STORE_BYTES, MAX_RECOVERY_REVISIONS,
};
use crate::types::LockedRecoveryItem;

const METADATA_SCHEMA: u32 = 1;
/// Metadata holds opaque ids and counters only; anything larger is corrupt.
const MAX_METADATA_BYTES: u64 = 8 * 1024 * 1024;
/// One listing scan looks at this many committed generation files at most.
const MAX_SCANNED_FILES: usize = 4096;

/// A staging file is not a committed generation: it is never counted as
/// stored bytes and this module never deletes it.
fn is_staging_name(name: &str) -> bool {
    name.starts_with("~adp-") && name.ends_with(".partial")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCapture {
    pub entry_id: Uuid,
    pub content_id: Uuid,
    pub captured_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingRecord {
    pub pending_id: Uuid,
    pub container_id: Uuid,
    pub revision: u64,
    pub created_unix: u64,
    pub captures: Vec<PendingCapture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingMetadata {
    schema_version: u32,
    records: Vec<PendingRecord>,
}

impl Default for PendingMetadata {
    fn default() -> Self {
        Self {
            schema_version: METADATA_SCHEMA,
            records: Vec::new(),
        }
    }
}

pub struct PendingStore {
    root: PathBuf,
}

impl PendingStore {
    pub fn new(root: PathBuf) -> LockedResult<Self> {
        fs::create_dir_all(&root).map_err(LockedError::from)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn container_dir(&self, container_id: Uuid) -> PathBuf {
        self.root.join(container_id.to_string())
    }

    fn metadata_path(&self, container_id: Uuid) -> PathBuf {
        self.container_dir(container_id).join("pending.json")
    }

    fn lock_store(&self) -> LockedResult<std::fs::File> {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.root.join("store.lock"))
            .map_err(LockedError::from)?;
        lock.lock_exclusive().map_err(|_| LockedError::Io)?;
        Ok(lock)
    }

    fn metadata(&self, container_id: Uuid) -> PendingMetadata {
        let path = self.metadata_path(container_id);
        let Ok(metadata) = fs::metadata(&path) else {
            return PendingMetadata::default();
        };
        if !metadata.is_file() || metadata.len() > MAX_METADATA_BYTES {
            return PendingMetadata::default();
        }
        let Ok(bytes) = fs::read(&path) else {
            return PendingMetadata::default();
        };
        let mut parsed = match serde_json::from_slice::<PendingMetadata>(&bytes) {
            Ok(parsed) if parsed.schema_version == METADATA_SCHEMA => parsed,
            _ => return PendingMetadata::default(),
        };
        // A record belongs to exactly one container and one real revision.
        parsed.records.retain(|record| {
            record.container_id == container_id
                && !record.pending_id.is_nil()
                && record.revision != 0
        });
        parsed
    }

    pub fn store_bytes(&self) -> u64 {
        let mut total = 0u64;
        let Ok(dirs) = fs::read_dir(&self.root) else {
            return 0;
        };
        for dir in dirs.flatten().take(1024) {
            let Ok(files) = fs::read_dir(dir.path()) else {
                continue;
            };
            for file in files.flatten().take(1024) {
                let name = file.file_name();
                if is_staging_name(&name.to_string_lossy()) {
                    continue;
                }
                if let Ok(metadata) = file.metadata() {
                    if metadata.is_file() {
                        total = total.saturating_add(metadata.len());
                    }
                }
            }
        }
        total
    }

    pub fn fits(&self, bytes: u64) -> bool {
        bytes <= MAX_PENDING_GENERATION_BYTES
            && self.store_bytes().saturating_add(bytes) <= MAX_PENDING_STORE_BYTES
    }

    /// Create the staging output for one pending generation. The caller
    /// writes, flushes, verifies and then calls `publish`.
    pub fn begin(&self, container_id: Uuid) -> LockedResult<OwnedOutput> {
        if container_id.is_nil() {
            return Err(LockedError::Invalid);
        }
        let directory = self.container_dir(container_id);
        fs::create_dir_all(&directory).map_err(LockedError::from)?;
        let pin = PinnedDirectory::open(&directory).map_err(LockedError::from)?;
        OwnedOutput::create(&pin, "pending").map_err(LockedError::from)
    }

    pub fn publish(&self, closed: ClosedOutput, record: PendingRecord) -> LockedResult<PathBuf> {
        if record.container_id.is_nil() || record.pending_id.is_nil() || record.revision == 0 {
            let _ = closed.dispose();
            return Err(LockedError::Invalid);
        }
        let container_id = record.container_id;
        let pending_id = record.pending_id;
        // The lock covers the size check, the duplicate check, the no-replace
        // publication and the metadata update, so one pending revision cannot
        // be published twice or push the store past its bound concurrently.
        let _lock = match self.lock_store() {
            Ok(lock) => lock,
            Err(error) => {
                let _ = closed.dispose();
                return Err(error);
            }
        };
        let target = self
            .container_dir(container_id)
            .join(format!("{pending_id}.adplock"));
        let size = fs::metadata(closed.path())
            .map(|metadata| metadata.len())
            .unwrap_or(u64::MAX);
        if !self.fits(size) {
            let _ = closed.dispose();
            return Err(LockedError::TooLarge);
        }
        let mut metadata = self.metadata(container_id);
        if metadata
            .records
            .iter()
            .any(|item| item.pending_id == pending_id)
            || target.exists()
        {
            let _ = closed.dispose();
            return Err(LockedError::Changed);
        }
        closed.publish_to(&target).map_err(LockedError::from)?;
        metadata.records.push(record);
        let bytes = serde_json::to_vec(&metadata).map_err(|_| LockedError::Invalid)?;
        fs_service::atomic_write(&self.metadata_path(container_id), &bytes)
            .map_err(|_| LockedError::Io)?;
        Ok(target)
    }

    pub fn list(&self, container_id: Uuid) -> Vec<LockedRecoveryItem> {
        let metadata = self.metadata(container_id);
        let mut items: Vec<LockedRecoveryItem> = metadata
            .records
            .iter()
            .map(|record| LockedRecoveryItem {
                id: record.pending_id,
                revision: record.revision,
                created_unix: record.created_unix,
            })
            .collect();
        // A crash after publication but before metadata still leaves a
        // complete standard container; list it by its owned file name.
        if let Ok(files) = fs::read_dir(self.container_dir(container_id)) {
            for file in files.flatten().take(MAX_SCANNED_FILES) {
                let name = file.file_name().to_string_lossy().into_owned();
                let Some(stem) = name.strip_suffix(".adplock") else {
                    continue;
                };
                let Ok(id) = Uuid::parse_str(stem) else {
                    continue;
                };
                if items.iter().any(|item| item.id == id) {
                    continue;
                }
                let created = file
                    .metadata()
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|age| age.as_secs())
                    .unwrap_or(0);
                items.push(LockedRecoveryItem {
                    id,
                    revision: 0,
                    created_unix: created,
                });
            }
        }
        items.sort_by_key(|left| std::cmp::Reverse(left.created_unix));
        items.truncate(MAX_RECOVERY_REVISIONS);
        items
    }

    pub fn record(&self, container_id: Uuid, id: Uuid) -> Option<PendingRecord> {
        self.metadata(container_id)
            .records
            .into_iter()
            .find(|record| record.pending_id == id)
    }

    pub fn path(&self, container_id: Uuid, id: Uuid) -> PathBuf {
        self.container_dir(container_id)
            .join(format!("{id}.adplock"))
    }

    pub fn latest_capture(&self, container_id: Uuid, entry_id: Uuid) -> Option<PendingCapture> {
        let mut records = self.metadata(container_id).records;
        records.sort_by_key(|left| std::cmp::Reverse(left.created_unix));
        records
            .into_iter()
            .flat_map(|record| record.captures)
            .find(|capture| capture.entry_id == entry_id)
    }
}
