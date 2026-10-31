//! Bounded history queries and same-file date/ID cursors.

use rusqlite::{params, OptionalExtension};

use crate::coordination::StoreLock;
use crate::{path_key, StoreError, VersionInfo, VersionStore};

impl VersionStore {
    /// A file's versions, newest first.
    pub fn list(&self, path: &str) -> Result<Vec<VersionInfo>, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.list_page_locked(path, None, -1)
    }

    /// A cursor is the last row from the same file, in descending date/id order.
    pub fn list_page(
        &self,
        path: &str,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<VersionInfo>, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        let limit =
            i64::try_from(limit).map_err(|_| StoreError::Io("invalid page limit".to_string()))?;
        self.list_page_locked(path, before_id, limit)
    }

    fn list_page_locked(
        &self,
        path: &str,
        before_id: Option<i64>,
        limit: i64,
    ) -> Result<Vec<VersionInfo>, StoreError> {
        let key = path_key(path);
        let before_date: Option<i64> = match before_id {
            Some(id) if id > 0 => Some(
                self.conn
                    .query_row(
                        "SELECT v.created_unix FROM versions v JOIN files f ON f.id = v.file_id
                 WHERE v.id = ?1 AND f.path_key = ?2",
                        params![id, key],
                        |row| row.get(0),
                    )
                    .optional()?
                    .ok_or(StoreError::NotFound)?,
            ),
            Some(_) => return Err(StoreError::NotFound),
            None => None,
        };
        let mut statement = self.conn.prepare(
            "SELECT v.id, v.created_unix, v.reason, v.size, v.file_modified_unix
             FROM versions v JOIN files f ON f.id = v.file_id
             WHERE f.path_key = ?1 AND (?2 IS NULL OR v.created_unix < ?2
                 OR (v.created_unix = ?2 AND v.id < ?3))
             ORDER BY v.created_unix DESC, v.id DESC LIMIT ?4",
        )?;
        let rows = statement.query_map(params![key, before_date, before_id, limit], |row| {
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
}
