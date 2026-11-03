//! Bounded eviction and recovery. Unknown files are retained and counted.
use crate::store::{acquire_file_lock, blob_path, CONTROL_HEADROOM};
use crate::{
    cleanup, records, schema, CacheError, CacheKind, CacheStore, CacheUsage, MAX_CACHE_ENTRIES,
};
use rusqlite::{params, Connection};

impl CacheStore {
    pub fn clear(&self, kind: Option<CacheKind>) -> Result<CacheUsage, CacheError> {
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let connection = self.connection()?;
        for record in records::all_records(&connection)? {
            let matches = match kind {
                None => true,
                Some(kind) => connection.query_row(
                    "SELECT kind=?1 FROM entries WHERE key_hash=?2",
                    params![kind.as_str(), &record.key_hash],
                    |r| r.get::<_, bool>(0),
                )?,
            };
            if matches {
                self.remove_record(&connection, &record, true)?;
            }
        }
        self.clean_pending(&connection)?;
        schema::checkpoint(&connection)?;
        self.usage_locked(&connection)
    }

    pub fn trim(&self) -> Result<CacheUsage, CacheError> {
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let connection = self.connection()?;
        self.clean_pending(&connection)?;
        // A lowered limit may retain leased/foreign bytes. No admission can
        // occur until they fit; never delete unowned data to satisfy a cap.
        match self.make_room(&connection, 0, false) {
            Ok(()) | Err(CacheError::Busy) => {}
            Err(error) => return Err(error),
        }
        self.usage_locked(&connection)
    }

    pub(crate) fn remove_record(
        &self,
        connection: &Connection,
        record: &crate::CacheRecord,
        mark_pending: bool,
    ) -> Result<bool, CacheError> {
        let Some(owner) = schema::owned_identity(connection, &record.blob_id)? else {
            return Ok(false);
        };
        if cleanup::remove_owned(&blob_path(&self.root, record)?, owner) {
            let transaction = connection.unchecked_transaction()?;
            transaction.execute("DELETE FROM entries WHERE key_hash=?1", [&record.key_hash])?;
            transaction.execute(
                "DELETE FROM owned_blobs WHERE blob_id=?1",
                [&record.blob_id],
            )?;
            transaction.commit()?;
            schema::checkpoint(connection)?;
            Ok(true)
        } else if mark_pending {
            connection.execute(
                "UPDATE entries SET pending_delete=1 WHERE key_hash=?1",
                [&record.key_hash],
            )?;
            schema::checkpoint(connection)?;
            Ok(false)
        } else {
            Ok(false)
        }
    }

    pub(crate) fn clean_pending(&self, connection: &Connection) -> Result<(), CacheError> {
        for record in records::pending_delete_records(connection)? {
            self.remove_record(connection, &record, true)?;
        }
        let rows = {
            let mut query =
                connection.prepare("SELECT blob_id,staging_name FROM pending LIMIT 50001")?;
            let rows = query
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if rows.len() > MAX_CACHE_ENTRIES {
            return Err(CacheError::Unavailable);
        }
        for (id, stage) in rows {
            let Ok(parsed) = uuid::Uuid::try_parse(&id) else {
                continue;
            };
            let Some(owner) = schema::owned_identity(connection, &id)? else {
                continue;
            };
            let blob = self.root.join("blobs").join(format!("{parsed}.png"));
            let stage_ok = match stage {
                None => true,
                Some(name) if name == format!("~adp-cache-{parsed}.partial") => {
                    cleanup::remove_owned(&self.root.join("pending").join(name), owner)
                }
                _ => false,
            };
            if stage_ok && cleanup::remove_owned(&blob, owner) {
                let transaction = connection.unchecked_transaction()?;
                transaction.execute("DELETE FROM pending WHERE blob_id=?1", [&id])?;
                transaction.execute("DELETE FROM owned_blobs WHERE blob_id=?1", [&id])?;
                transaction.commit()?;
                schema::checkpoint(connection)?;
            }
        }
        Ok(())
    }

    pub(crate) fn make_room(
        &self,
        connection: &Connection,
        incoming: u64,
        inserting: bool,
    ) -> Result<(), CacheError> {
        schema::checkpoint(connection)?;
        let reserve = if inserting { CONTROL_HEADROOM } else { 0 };
        let target = self
            .limit_bytes()
            .checked_sub(incoming)
            .and_then(|n| n.checked_sub(reserve))
            .ok_or(CacheError::Busy)?;
        let count = || -> Result<usize, CacheError> {
            Ok(
                connection.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get::<_, i64>(0))?
                    as usize,
            )
        };
        let fits = || -> Result<bool, CacheError> {
            Ok(cleanup::physical_bytes(&self.root)? <= target
                && count()? + usize::from(inserting) <= MAX_CACHE_ENTRIES)
        };
        if fits()? {
            return Ok(());
        }
        // A pending touch overrides persisted time even before its bounded
        // write-behind batch runs. Leases remain cross-process protection.
        let touches = self
            .touches
            .lock()
            .map_err(|_| CacheError::Unavailable)?
            .clone();
        let mut candidates = records::oldest_records(connection, None, MAX_CACHE_ENTRIES)?;
        for record in &mut candidates {
            if let Some(used) = touches.get(&record.key_hash) {
                record.used_unix = *used;
            }
        }
        candidates.sort_by(|a, b| {
            a.used_unix
                .cmp(&b.used_unix)
                .then_with(|| a.key_hash.cmp(&b.key_hash))
        });
        // Do not stop at32 leased rows: an evictable older row can be later.
        for record in candidates {
            if self.remove_record(connection, &record, false)? && fits()? {
                return Ok(());
            }
        }
        if fits()? {
            Ok(())
        } else {
            Err(CacheError::Busy)
        }
    }
    pub(crate) fn flush_touches(&self, connection: &Connection) -> Result<(), CacheError> {
        let mut touches = self.touches.lock().map_err(|_| CacheError::Unavailable)?;
        let batch: Vec<_> = touches
            .iter()
            .take(8)
            .map(|(key, time)| (key.clone(), *time))
            .collect();
        for (key, time) in batch {
            connection.execute(
                "UPDATE entries SET used_unix=?1 WHERE key_hash=?2",
                params![time as i64, &key],
            )?;
            schema::checkpoint(connection)?;
            touches.remove(&key);
        }
        Ok(())
    }
}
