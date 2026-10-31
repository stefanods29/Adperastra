//! Limits and explicit deletion, under one store session.

use crate::coordination::{PendingLock, StoreLock};
use crate::pending::pending_dir;
use crate::{StoreError, VersionStore};
use rusqlite::{params, OptionalExtension};
use std::path::Path;

impl VersionStore {
    /// Keep the store within its limits: first versions older than
    /// `keep_days`, then the oldest until the stored size fits `max_bytes`.
    /// Returns how many versions were deleted.
    pub fn trim(
        &mut self,
        keep_days: u32,
        max_bytes: u64,
        now_unix: u64,
    ) -> Result<usize, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        let cutoff = now_unix.saturating_sub(u64::from(keep_days) * 86_400);
        let mut freed: Vec<String> = Vec::new();
        let mut deleted = 0usize;
        {
            let tx = self.conn.transaction()?;
            let old: Vec<(i64, String)> = {
                let mut statement =
                    tx.prepare("SELECT id, hash FROM versions WHERE created_unix < ?1")?;
                let rows = statement.query_map(params![cutoff as i64], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?;
                let mut collected = Vec::new();
                for row in rows {
                    collected.push(row?);
                }
                collected
            };
            for (id, hash) in old {
                deleted += 1;
                if delete_version(&tx, id, &hash)? && !freed.contains(&hash) {
                    freed.push(hash);
                }
            }
            loop {
                let total: i64 = tx.query_row(
                    "SELECT COALESCE(SUM(stored_size), 0) FROM blobs WHERE refs > 0",
                    [],
                    |row| row.get(0),
                )?;
                if total as u64 <= max_bytes {
                    break;
                }
                let oldest: Option<(i64, String)> = tx
                    .query_row(
                        "SELECT id, hash FROM versions
                         ORDER BY created_unix ASC, id ASC LIMIT 1",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()?;
                let Some((id, hash)) = oldest else {
                    break;
                };
                deleted += 1;
                if delete_version(&tx, id, &hash)? && !freed.contains(&hash) {
                    freed.push(hash);
                }
            }
            tx.commit()?;
        }
        for hash in freed {
            let _ = std::fs::remove_file(self.blob_path(&hash));
        }
        Ok(deleted)
    }

    /// Remove every kept version and blob. User files are never touched.
    pub fn delete_all(&mut self) -> Result<(), StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.delete_all_locked()
    }

    pub(crate) fn delete_all_locked(&mut self) -> Result<(), StoreError> {
        let _pending_lock = PendingLock::acquire(&self.dir)?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM versions", [])?;
        tx.execute("DELETE FROM blobs", [])?;
        tx.execute("DELETE FROM files", [])?;
        tx.commit()?;
        clear_dir(&pending_dir(&self.dir))?;
        clear_dir(&self.dir.join("blobs"))?;
        clear_dir(&self.dir.join("open"))?;
        Ok(())
    }

    /// The compressed size of everything the store keeps, in bytes.
    pub fn stored_bytes(&self) -> Result<u64, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(stored_size), 0) FROM blobs",
            [],
            |row| row.get(0),
        )?;
        Ok(total as u64)
    }
}

/// Delete one version and lower its blob's references. `true` when the blob
/// reached zero and its file is to be removed after the commit.
fn delete_version(tx: &rusqlite::Transaction<'_>, id: i64, hash: &str) -> Result<bool, StoreError> {
    tx.execute("DELETE FROM versions WHERE id = ?1", params![id])?;
    tx.execute(
        "UPDATE blobs SET refs = refs - 1 WHERE hash = ?1",
        params![hash],
    )?;
    let refs: Option<i64> = tx
        .query_row(
            "SELECT refs FROM blobs WHERE hash = ?1",
            params![hash],
            |row| row.get(0),
        )
        .optional()?;
    if refs.is_some_and(|value| value <= 0) {
        tx.execute("DELETE FROM blobs WHERE hash = ?1", params![hash])?;
        return Ok(true);
    }
    Ok(false)
}

/// Remove everything inside `dir` and leave the folder in place.
fn clear_dir(dir: &Path) -> Result<(), StoreError> {
    #[cfg(windows)]
    if dir.try_exists()? {
        clear_readonly(dir)?;
    }
    match std::fs::remove_dir_all(dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(StoreError::Io(error.to_string())),
    }
    std::fs::create_dir_all(dir)?;
    Ok(())
}

#[cfg(windows)]
fn clear_readonly(dir: &Path) -> Result<(), StoreError> {
    use std::os::windows::fs::MetadataExt;
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        // Never follow a link or junction out of this app-owned store.
        if metadata.file_attributes() & 0x400 != 0 {
            continue;
        }
        if metadata.is_dir() {
            clear_readonly(&path)?;
        } else if metadata.permissions().readonly() {
            // Only the app's extracted copies are made writable for deletion.
            fs_service::clear_owned_readonly(&path)?;
        }
    }
    Ok(())
}
