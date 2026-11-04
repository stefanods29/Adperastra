//! Cache schema and durable native ownership records.
use crate::{
    cleanup::{self, BlobIdentity},
    CacheError, STORE_SCHEMA,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::time::Duration;
use std::{fs::File, path::Path};

pub(crate) fn open_index(path: &Path) -> Result<(Connection, File), CacheError> {
    let existed = path.exists();
    let guard = if existed {
        cleanup::open_index_guard(path)?
    } else {
        // Own creation before SQLite can initialize anything. CREATE_NEW
        // refuses a foreign file that appeared after the existence probe;
        // the retained handle prevents rename/delete throughout SQLite open.
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows::Win32::Storage::FileSystem::{
                FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
                FILE_SHARE_WRITE,
            };
            options
                .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
                .custom_flags(FILE_FLAG_OPEN_NO_RECALL.0 | FILE_FLAG_OPEN_REPARSE_POINT.0);
        }
        let owned = options.open(path)?;
        cleanup::identity(&owned)?;
        owned
    };
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    connection.busy_timeout(Duration::from_secs(5))?;
    // Version inspection precedes every PRAGMA/DDL write. Opening an unknown
    // newer cache must leave its database and schema untouched.
    let has_meta: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta')",
        [],
        |r| r.get(0),
    )?;
    if !has_meta && existed {
        return Err(CacheError::Unavailable);
    }
    if has_meta {
        let versions = connection
            .prepare("SELECT schema_version FROM meta LIMIT 2")?
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        if versions != [i64::from(STORE_SCHEMA)] {
            return Err(CacheError::Unavailable);
        }
    }
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        PRAGMA wal_autocheckpoint=0; PRAGMA journal_size_limit=0; PRAGMA temp_store=MEMORY;
        CREATE TABLE IF NOT EXISTS meta(schema_version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS entries (
            key_hash TEXT PRIMARY KEY, key_text TEXT NOT NULL, kind TEXT NOT NULL,
            blob_id TEXT NOT NULL, relative_name TEXT NOT NULL, mime TEXT NOT NULL,
            byte_len INTEGER NOT NULL, width INTEGER, height INTEGER,
            used_unix INTEGER NOT NULL, pending_delete INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS pending (
            blob_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, expected_len INTEGER NOT NULL,
            state TEXT NOT NULL, staging_name TEXT);
        CREATE TABLE IF NOT EXISTS owned_blobs (
            blob_id TEXT PRIMARY KEY, volume_id TEXT NOT NULL, file_id TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS entries_used ON entries(used_unix,key_hash);",
    )?;
    if !has_meta {
        connection.execute("INSERT INTO meta VALUES (?1)", [i64::from(STORE_SCHEMA)])?;
    }
    Ok((connection, guard))
}

pub(crate) fn checkpoint(connection: &Connection) -> Result<(), CacheError> {
    let (busy, _, _): (i32, i32, i32) =
        connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if busy != 0 {
        return Err(CacheError::Busy);
    }
    Ok(())
}

pub(crate) fn owned_identity(
    connection: &Connection,
    id: &str,
) -> Result<Option<BlobIdentity>, CacheError> {
    let found: Option<(String, String)> = connection
        .query_row(
            "SELECT volume_id,file_id FROM owned_blobs WHERE blob_id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    found
        .map(|(volume, index)| {
            Ok(BlobIdentity {
                volume: u64::from_str_radix(&volume, 16).map_err(|_| CacheError::Unavailable)?,
                index: u64::from_str_radix(&index, 16).map_err(|_| CacheError::Unavailable)?,
            })
        })
        .transpose()
}
