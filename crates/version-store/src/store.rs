//! The store itself: an SQLite index plus compressed blobs (Step 06b).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

use crate::coordination::{PendingLock, StoreLock};
use crate::pending::{
    cleanup_incomplete, modified_unix, pending_dir, snapshot_locked, PendingSidecar,
};
use crate::{path_key, StoreError, VersionSession, STORE_SCHEMA};

/// A sidecar without its copy is left alone this long, then removed.
const LONELY_SIDECAR_SECS: u64 = 60;

/// Compressed blobs are written with `zstd::stream::copy_encode` at this level.
const ZSTD_LEVEL: i32 = 3;

/// The opened version store: one connection, one folder of blobs.
pub struct VersionStore {
    pub(crate) conn: Connection,
    pub(crate) dir: PathBuf,
}

impl VersionStore {
    /// Open (or create) a store in `dir`.
    pub fn open(dir: &Path) -> Result<VersionStore, StoreError> {
        let _lock = StoreLock::acquire(dir)?;
        std::fs::create_dir_all(dir.join("blobs"))?;
        std::fs::create_dir_all(dir.join("open"))?;
        std::fs::create_dir_all(pending_dir(dir))?;
        let conn = Connection::open(dir.join("index.sqlite3"))?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS files (
                 id INTEGER PRIMARY KEY,
                 path_key TEXT NOT NULL UNIQUE,
                 path TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS blobs (
                 hash TEXT PRIMARY KEY,
                 stored_size INTEGER NOT NULL,
                 refs INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS versions (
                 id INTEGER PRIMARY KEY,
                 file_id INTEGER NOT NULL,
                 created_unix INTEGER NOT NULL,
                 reason TEXT NOT NULL,
                 size INTEGER NOT NULL,
                 hash TEXT NOT NULL,
                 file_modified_unix INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS versions_by_file
                 ON versions (file_id, created_unix);",
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?1)",
            params![STORE_SCHEMA.to_string()],
        )?;
        // Unlike ROWID allocation, this durable high-water mark survives trim
        // and delete_all. A stale undo id must never identify new content.
        conn.execute(
            "INSERT OR IGNORE INTO meta (key, value)
             SELECT 'next_version_id', CAST(COALESCE(MAX(id), 0) + 1 AS TEXT) FROM versions",
            [],
        )?;
        Ok(VersionStore {
            conn,
            dir: dir.to_path_buf(),
        })
    }

    /// Exclude every other store operation for a composite restore. Merely
    /// retaining an opened store never retains its OS lock.
    pub fn session(&mut self) -> Result<VersionSession<'_>, StoreError> {
        let lock = StoreLock::acquire(&self.dir)?;
        Ok(VersionSession {
            store: self,
            _lock: lock,
        })
    }

    /// Store every pending copy, oldest first. Returns how many versions were
    /// added. Runs in the background worker (Step 06b D3).
    pub fn import_pending(&mut self, now_unix: u64) -> Result<usize, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.import_pending_locked(now_unix)
    }

    fn import_pending_locked(&mut self, now_unix: u64) -> Result<usize, StoreError> {
        let pending = pending_dir(&self.dir);
        std::fs::create_dir_all(&pending)?;
        let mut sidecars: Vec<PathBuf> = {
            let _pending_lock = PendingLock::acquire(&self.dir)?;
            cleanup_incomplete(&pending, now_unix)?;
            std::fs::read_dir(&pending)?
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
                .collect()
        };
        sidecars.sort();
        let mut added = 0usize;
        for sidecar in sidecars {
            let raw = sidecar.with_extension("raw");
            if !raw.is_file() {
                let old = match std::fs::metadata(&sidecar) {
                    Ok(meta) => {
                        now_unix.saturating_sub(modified_unix(&meta)) >= LONELY_SIDECAR_SECS
                    }
                    Err(_) => false,
                };
                if old {
                    let _pending_lock = PendingLock::acquire(&self.dir)?;
                    let _ = std::fs::remove_file(&sidecar);
                }
                continue;
            }
            if self.import_one(&sidecar, &raw, &mut added)?.is_some() {
                let _pending_lock = PendingLock::acquire(&self.dir)?;
                let _ = std::fs::remove_file(&raw);
                let _ = std::fs::remove_file(&sidecar);
            }
        }
        Ok(added)
    }

    /// Store one complete pending pair; return its exact inserted or deduplicated id.
    fn import_one(
        &mut self,
        sidecar: &Path,
        raw: &Path,
        added: &mut usize,
    ) -> Result<Option<i64>, StoreError> {
        let Ok(text) = std::fs::read_to_string(sidecar) else {
            return Ok(None);
        };
        let Ok(entry) = serde_json::from_str::<PendingSidecar>(&text) else {
            return Ok(None);
        };
        let size = std::fs::metadata(raw)?.len();
        if size != entry.size || size > crate::MAX_SNAPSHOT_BYTES {
            return Ok(None);
        }
        let hash = hash_file(raw)?;
        if !self.blob_exists(&hash)? {
            self.store_blob(raw, &hash)?;
        }
        let tx = self.conn.transaction()?;
        let file_id: i64 = match tx
            .query_row(
                "SELECT id FROM files WHERE path_key = ?1",
                params![path_key(&entry.path)],
                |row| row.get(0),
            )
            .optional()?
        {
            Some(id) => {
                tx.execute(
                    "UPDATE files SET path = ?1 WHERE id = ?2",
                    params![entry.path, id],
                )?;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO files (path_key, path) VALUES (?1, ?2)",
                    params![path_key(&entry.path), entry.path],
                )?;
                tx.last_insert_rowid()
            }
        };
        let newest: Option<(i64, String)> = tx
            .query_row(
                "SELECT id, hash FROM versions WHERE file_id = ?1
                 ORDER BY created_unix DESC, id DESC LIMIT 1",
                params![file_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let id = if let Some((id, _)) = newest.filter(|(_, newest_hash)| newest_hash == &hash) {
            id
        } else {
            let id: i64 = tx.query_row(
                "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'next_version_id'",
                [],
                |row| row.get(0),
            )?;
            let next = id
                .checked_add(1)
                .ok_or_else(|| StoreError::Sql("version id limit".to_string()))?;
            tx.execute(
                "UPDATE meta SET value = ?1 WHERE key = 'next_version_id'",
                params![next.to_string()],
            )?;
            tx.execute(
                "INSERT INTO versions
                     (id, file_id, created_unix, reason, size, hash, file_modified_unix)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    file_id,
                    entry.created_unix as i64,
                    entry.reason,
                    size as i64,
                    hash,
                    entry.file_modified_unix as i64
                ],
            )?;
            tx.execute(
                "UPDATE blobs SET refs = refs + 1 WHERE hash = ?1",
                params![hash],
            )?;
            *added += 1;
            id
        };
        tx.commit()?;
        Ok(Some(id))
    }

    /// Preserve the current file and return precisely that snapshot's id.
    /// The surrounding store session excludes import, trim and explicit deletion.
    pub fn snapshot_current(
        &mut self,
        path: &Path,
        reason: &str,
        now_unix: u64,
    ) -> Result<Option<i64>, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.snapshot_current_locked(path, reason, now_unix)
    }

    pub(crate) fn snapshot_current_locked(
        &mut self,
        path: &Path,
        reason: &str,
        now_unix: u64,
    ) -> Result<Option<i64>, StoreError> {
        self.import_pending_locked(now_unix)?;
        let copy = {
            let _pending_lock = PendingLock::acquire(&self.dir)?;
            snapshot_locked(&self.dir, path, reason, now_unix)?
        };
        let Some(copy) = copy else {
            return Ok(None);
        };
        let mut added = 0;
        let id = self
            .import_one(&copy.sidecar, &copy.raw, &mut added)?
            .ok_or_else(|| StoreError::Io("snapshot completion record is invalid".to_string()))?;
        let _pending_lock = PendingLock::acquire(&self.dir)?;
        let _ = std::fs::remove_file(copy.raw);
        let _ = std::fs::remove_file(copy.sidecar);
        Ok(Some(id))
    }

    fn blob_exists(&self, hash: &str) -> Result<bool, StoreError> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM blobs WHERE hash = ?1",
                params![hash],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    fn store_blob(&self, raw: &Path, hash: &str) -> Result<(), StoreError> {
        let blob = self.blob_path(hash);
        if let Some(parent) = blob.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut partial = blob.as_os_str().to_owned();
        partial.push(".partial");
        let partial = PathBuf::from(partial);
        let written = (|| -> std::io::Result<()> {
            let source = std::fs::File::open(raw)?;
            let mut dest = std::fs::File::create(&partial)?;
            zstd::stream::copy_encode(source, &mut dest, ZSTD_LEVEL)?;
            dest.flush()?;
            dest.sync_all()
        })();
        if let Err(error) = written {
            let _ = std::fs::remove_file(&partial);
            return Err(StoreError::Io(error.to_string()));
        }
        if let Err(error) = std::fs::rename(&partial, &blob) {
            let _ = std::fs::remove_file(&partial);
            return Err(StoreError::Io(error.to_string()));
        }
        let stored_size = std::fs::metadata(&blob)?.len();
        self.conn.execute(
            "INSERT INTO blobs (hash, stored_size, refs) VALUES (?1, ?2, 0)",
            params![hash, stored_size as i64],
        )?;
        Ok(())
    }

    /// Restore accepts only a version belonging to this exact normalized path.
    pub fn read_bytes_for_path(&self, id: i64, path: &str) -> Result<Vec<u8>, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.read_bytes_for_path_locked(id, path)
    }

    pub(crate) fn read_bytes_for_path_locked(
        &self,
        id: i64,
        path: &str,
    ) -> Result<Vec<u8>, StoreError> {
        let belongs: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM versions v JOIN files f ON f.id = v.file_id
             WHERE v.id = ?1 AND f.path_key = ?2)",
            params![id, path_key(path)],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(StoreError::NotFound);
        }
        self.read_bytes_locked(id)
    }

    pub(crate) fn blob_path(&self, hash: &str) -> PathBuf {
        let first_two: String = hash.chars().take(2).collect();
        self.dir
            .join("blobs")
            .join(first_two)
            .join(format!("{hash}.zst"))
    }
}

fn hash_file(path: &Path) -> Result<String, StoreError> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_string())
}
