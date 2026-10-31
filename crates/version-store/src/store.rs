//! The store itself: an SQLite index plus compressed blobs (Step 06b).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

use crate::pending::{modified_unix, pending_dir, PendingSidecar};
use crate::{path_key, StoreError, VersionInfo, STORE_SCHEMA};

/// A sidecar without its copy is left alone this long, then removed.
const LONELY_SIDECAR_SECS: u64 = 60;

/// Compressed blobs are written with `zstd::stream::copy_encode` at this level.
const ZSTD_LEVEL: i32 = 3;

/// The opened version store: one connection, one folder of blobs.
pub struct VersionStore {
    conn: Connection,
    dir: PathBuf,
}

impl VersionStore {
    /// Open (or create) a store in `dir`.
    pub fn open(dir: &Path) -> Result<VersionStore, StoreError> {
        std::fs::create_dir_all(dir)?;
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
        Ok(VersionStore {
            conn,
            dir: dir.to_path_buf(),
        })
    }

    /// Store every pending copy, oldest first. Returns how many versions were
    /// added. Runs in the background worker (Step 06b D3).
    pub fn import_pending(&mut self, now_unix: u64) -> Result<usize, StoreError> {
        let pending = pending_dir(&self.dir);
        std::fs::create_dir_all(&pending)?;
        let mut sidecars: Vec<PathBuf> = std::fs::read_dir(&pending)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
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
                    let _ = std::fs::remove_file(&sidecar);
                }
                continue;
            }
            if self.import_one(&sidecar, &raw, &mut added)? {
                let _ = std::fs::remove_file(&raw);
                let _ = std::fs::remove_file(&sidecar);
            }
        }
        Ok(added)
    }

    /// Store one pending pair. `false` leaves both files for a later run.
    fn import_one(
        &mut self,
        sidecar: &Path,
        raw: &Path,
        added: &mut usize,
    ) -> Result<bool, StoreError> {
        let Ok(text) = std::fs::read_to_string(sidecar) else {
            return Ok(false);
        };
        let Ok(entry) = serde_json::from_str::<PendingSidecar>(&text) else {
            return Ok(false);
        };
        let hash = hash_file(raw)?;
        if !self.blob_exists(&hash)? {
            self.store_blob(raw, &hash)?;
        }
        let size = std::fs::metadata(raw)?.len();
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
        let newest: Option<String> = tx
            .query_row(
                "SELECT hash FROM versions WHERE file_id = ?1
                 ORDER BY created_unix DESC, id DESC LIMIT 1",
                params![file_id],
                |row| row.get(0),
            )
            .optional()?;
        if newest.as_deref() != Some(hash.as_str()) {
            tx.execute(
                "INSERT INTO versions
                     (file_id, created_unix, reason, size, hash, file_modified_unix)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
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
        }
        tx.commit()?;
        Ok(true)
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

    /// A file's versions, newest first.
    pub fn list(&self, path: &str) -> Result<Vec<VersionInfo>, StoreError> {
        let mut statement = self.conn.prepare(
            "SELECT v.id, v.created_unix, v.reason, v.size, v.file_modified_unix
             FROM versions v JOIN files f ON f.id = v.file_id
             WHERE f.path_key = ?1
             ORDER BY v.created_unix DESC, v.id DESC",
        )?;
        let rows = statement.query_map(params![path_key(path)], |row| {
            Ok(VersionInfo {
                id: row.get(0)?,
                created_unix: row.get::<_, i64>(1)? as u64,
                reason: row.get(2)?,
                size: row.get::<_, i64>(3)? as u64,
                file_modified_unix: row.get::<_, i64>(4)? as u64,
            })
        })?;
        let mut versions = Vec::new();
        for version in rows {
            versions.push(version?);
        }
        Ok(versions)
    }

    /// Decompress a version to `dest` (partial file, then rename).
    pub fn extract(&self, id: i64, dest: &Path) -> Result<(), StoreError> {
        let hash = self.hash_for(id)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut partial = dest.as_os_str().to_owned();
        partial.push(".partial");
        let partial = PathBuf::from(partial);
        let written = (|| -> std::io::Result<()> {
            let source = std::fs::File::open(self.blob_path(&hash))?;
            let mut target = std::fs::File::create(&partial)?;
            zstd::stream::copy_decode(source, &mut target)?;
            target.flush()?;
            target.sync_all()
        })();
        if let Err(error) = written {
            let _ = std::fs::remove_file(&partial);
            return Err(StoreError::Io(error.to_string()));
        }
        if let Err(error) = std::fs::rename(&partial, dest) {
            let _ = std::fs::remove_file(&partial);
            return Err(StoreError::Io(error.to_string()));
        }
        Ok(())
    }

    /// A version's original bytes.
    pub fn read_bytes(&self, id: i64) -> Result<Vec<u8>, StoreError> {
        let hash = self.hash_for(id)?;
        let file = std::fs::File::open(self.blob_path(&hash))?;
        Ok(zstd::decode_all(file)?)
    }

    fn hash_for(&self, id: i64) -> Result<String, StoreError> {
        self.conn
            .query_row(
                "SELECT hash FROM versions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound)
    }

    fn blob_path(&self, hash: &str) -> PathBuf {
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
