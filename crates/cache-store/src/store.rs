//! Serialized, physically bounded cache store.
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use crate::{cleanup, records, schema, CacheError, CacheKey, CacheRecord, CacheUsage};
use fs_service::owned_io::PinnedDirectory;
use rusqlite::Connection;

pub const DEFAULT_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
// Each operation checkpoints its bounded transaction. Reserve space for the
// largest validated key/index update plus its WAL and checkpointed pages.
pub(crate) const CONTROL_HEADROOM: u64 = 512 * 1024;

pub struct CacheStore {
    pub(crate) root: PathBuf,
    limit_bytes: AtomicU64,
    conn: Mutex<Connection>,
    ops: Mutex<()>,
    _directories: Vec<PinnedDirectory>,
    _index_guard: File,
    pub(crate) touches: Mutex<BTreeMap<String, u64>>,
}

impl CacheStore {
    pub fn open(root: &Path, limit_bytes: u64) -> Result<Self, CacheError> {
        if !root.is_absolute() || root.to_str().is_none() || limit_bytes < CONTROL_HEADROOM {
            return Err(CacheError::BadRequest);
        }
        fs_service::validate_path_input(root.to_str().ok_or(CacheError::BadRequest)?)
            .map_err(|_| CacheError::BadRequest)?;
        std::fs::create_dir_all(root)?;
        cleanup::require_directory(root)?;
        let root_guard = PinnedDirectory::open(root)?;
        let root = root_guard.path().to_path_buf();
        let _lock = acquire_file_lock(&root)?;
        for name in ["blobs", "pending"] {
            let path = root.join(name);
            std::fs::create_dir_all(&path)?;
            cleanup::require_directory(&path)?;
        }
        let holds = vec![
            root_guard,
            PinnedDirectory::open(&root.join("blobs"))?,
            PinnedDirectory::open(&root.join("pending"))?,
        ];
        let before = cleanup::physical_bytes(&root)?;
        if !root.join("index.sqlite3").exists()
            && before
                .checked_add(CONTROL_HEADROOM)
                .is_none_or(|n| n > limit_bytes)
        {
            return Err(CacheError::Busy);
        }
        let (connection, index_guard) = schema::open_index(&root.join("index.sqlite3"))?;
        schema::checkpoint(&connection)?;
        Ok(Self {
            root,
            limit_bytes: AtomicU64::new(limit_bytes),
            conn: Mutex::new(connection),
            ops: Mutex::new(()),
            _directories: holds,
            _index_guard: index_guard,
            touches: Mutex::new(BTreeMap::new()),
        })
    }

    pub fn set_limit(&self, bytes: u64) {
        self.limit_bytes.store(bytes, Ordering::Relaxed);
    }
    pub fn limit_bytes(&self) -> u64 {
        self.limit_bytes.load(Ordering::Relaxed)
    }
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Reserve space for a helper result before any helper output is written.
    ///
    /// The trusted callback must exclusively create an owned, crash-cleaned
    /// staging file under this store and set its length to `bytes` before
    /// returning its guard. That physical length retains the reservation after
    /// the cross-process lock is released. Do not call cache methods inside
    /// the callback, or shrink the reservation while its helper is active.
    pub fn with_staging_budget<T>(
        &self,
        bytes: u64,
        create: impl FnOnce() -> Result<T, CacheError>,
    ) -> Result<T, CacheError> {
        if bytes == 0 {
            return Err(CacheError::BadRequest);
        }
        let reserved = bytes
            .checked_add(CONTROL_HEADROOM)
            .ok_or(CacheError::Busy)?;
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let connection = self.connection()?;
        self.clean_pending(&connection)?;
        self.make_room(&connection, reserved, false)?;
        let output = create()?;
        // The output's guard is dropped on every error, while the operation
        // and OS lock still exclude another store's admission.
        if cleanup::physical_bytes(&self.root)? > self.limit_bytes() {
            return Err(CacheError::Busy);
        }
        Ok(output)
    }

    pub fn usage(&self) -> Result<CacheUsage, CacheError> {
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let connection = self.connection()?;
        self.usage_locked(&connection)
    }

    pub fn lookup(&self, key: &CacheKey) -> Result<Option<CacheRecord>, CacheError> {
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let hash = crate::key_hash(key)?;
        let connection = self.connection()?;
        let Some((mut record, text)) = records::find_record(&connection, &hash)? else {
            return Ok(None);
        };
        if text != serde_json::to_string(key).map_err(|_| CacheError::BadRequest)?
            || self.open_indexed_blob(&connection, &record).is_err()
        {
            return Ok(None);
        }
        // Hits stay read-only: no cache-wide physical scan or fsync per
        // visible tile. A bounded write-behind map supplies eviction recency;
        // publication persists a finite batch inside reserved metadata space.
        let mut touches = self.touches.lock().map_err(|_| CacheError::Unavailable)?;
        if touches.len() >= crate::MAX_CACHE_ENTRIES && !touches.contains_key(&hash) {
            if let Some(old) = touches.keys().next().cloned() {
                touches.remove(&old);
            }
        }
        record.used_unix = unix_now();
        touches.insert(hash, record.used_unix);
        Ok(Some(record))
    }

    /// The same indexed object is validated and kept open with write/delete
    /// sharing denied. Consumers grant this handle, never reopen a record path.
    pub fn open_blob(&self, record: &CacheRecord) -> Result<File, CacheError> {
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let connection = self.connection()?;
        let Some((mut indexed, _)) = records::find_record(&connection, &record.key_hash)? else {
            return Err(CacheError::Changed);
        };
        indexed.used_unix = record.used_unix;
        if indexed != *record {
            return Err(CacheError::Changed);
        }
        self.open_indexed_blob(&connection, record)
    }

    pub(crate) fn open_indexed_blob(
        &self,
        connection: &Connection,
        record: &CacheRecord,
    ) -> Result<File, CacheError> {
        record.validate()?;
        if record.pending_delete {
            return Err(CacheError::Changed);
        }
        let identity =
            schema::owned_identity(connection, &record.blob_id)?.ok_or(CacheError::Changed)?;
        let file = cleanup::open_reading(&blob_path(&self.root, record)?)?;
        if cleanup::identity(&file)? != identity || file.metadata()?.len() != record.byte_len {
            return Err(CacheError::Changed);
        }
        Ok(file)
    }

    pub(crate) fn usage_locked(&self, connection: &Connection) -> Result<CacheUsage, CacheError> {
        let mut leased_count = 0;
        let mut pending_delete_bytes: u64 = 0;
        let records = records::all_records(connection)?;
        for record in &records {
            let path = blob_path(&self.root, record)?;
            if cleanup::is_leased(&path) {
                leased_count += 1;
            }
            if record.pending_delete {
                pending_delete_bytes = pending_delete_bytes.saturating_add(record.byte_len);
            }
        }
        Ok(CacheUsage {
            disk_bytes: cleanup::physical_bytes(&self.root)?,
            limit_bytes: self.limit_bytes(),
            entry_count: records.iter().filter(|r| !r.pending_delete).count() as u64,
            leased_count,
            pending_delete_bytes,
        })
    }

    pub(crate) fn operation(&self) -> Result<MutexGuard<'_, ()>, CacheError> {
        self.ops.lock().map_err(|_| CacheError::Unavailable)
    }
    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>, CacheError> {
        self.conn.lock().map_err(|_| CacheError::Unavailable)
    }
}

pub(crate) fn acquire_file_lock(root: &Path) -> Result<File, CacheError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT,
        };
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0);
    }
    let file = options.open(root.join("cache.lock"))?;
    cleanup::identity(&file)?;
    file.lock()?;
    Ok(file)
}

pub(crate) fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
        .min(i64::MAX as u64)
}

pub(crate) fn blob_path(root: &Path, record: &CacheRecord) -> Result<PathBuf, CacheError> {
    let id = uuid::Uuid::try_parse(&record.blob_id).map_err(|_| CacheError::BadRequest)?;
    Ok(root.join("blobs").join(format!("{id}.png")))
}
