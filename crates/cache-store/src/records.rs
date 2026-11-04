use crate::{CacheError, CacheRecord, MAX_CACHE_ENTRIES};
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) type RecordLine = (CacheRecord, String);

pub(crate) fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CacheRecord> {
    let unsigned = |index| -> rusqlite::Result<u64> {
        let value = row.get::<_, i64>(index)?;
        u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(index, value))
    };
    let dimension = |index| -> rusqlite::Result<Option<u32>> {
        row.get::<_, Option<i64>>(index)?
            .map(|value| {
                u32::try_from(value)
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(index, value))
            })
            .transpose()
    };
    let pending = row.get::<_, i64>(8)?;
    if !matches!(pending, 0 | 1) {
        return Err(rusqlite::Error::IntegralValueOutOfRange(8, pending));
    }
    let record = CacheRecord {
        key_hash: row.get(0)?,
        blob_id: row.get(1)?,
        relative_name: row.get(2)?,
        mime: row.get(3)?,
        byte_len: unsigned(4)?,
        width: dimension(5)?,
        height: dimension(6)?,
        used_unix: unsigned(7)?,
        pending_delete: pending == 1,
    };
    record.validate().map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(record)
}

pub(crate) const RECORD_COLUMNS: &str =
    "key_hash, blob_id, relative_name, mime, byte_len, width, height,
     used_unix, pending_delete";

pub(crate) fn find_record(
    connection: &Connection,
    hash: &str,
) -> Result<Option<RecordLine>, CacheError> {
    let key_text: Option<String> = connection
        .query_row(
            "SELECT key_text FROM entries WHERE key_hash = ?1",
            [hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CacheError::Unavailable)?;
    let Some(key_text) = key_text else {
        return Ok(None);
    };
    let record = connection
        .query_row(
            &format!("SELECT {RECORD_COLUMNS} FROM entries WHERE key_hash = ?1"),
            [hash],
            record_from_row,
        )
        .map_err(|_| CacheError::Unavailable)?;
    Ok(Some((record, key_text)))
}

pub(crate) fn all_records(connection: &Connection) -> Result<Vec<CacheRecord>, CacheError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM entries LIMIT {}",
            MAX_CACHE_ENTRIES + 1
        ))
        .map_err(|_| CacheError::Unavailable)?;
    let rows = statement
        .query_map([], record_from_row)
        .map_err(|_| CacheError::Unavailable)?;
    bounded_records(rows.collect::<Result<Vec<_>, _>>())
}

pub(crate) fn pending_delete_records(
    connection: &Connection,
) -> Result<Vec<CacheRecord>, CacheError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM entries WHERE pending_delete = 1 LIMIT {}",
            MAX_CACHE_ENTRIES + 1
        ))
        .map_err(|_| CacheError::Unavailable)?;
    let rows = statement
        .query_map([], record_from_row)
        .map_err(|_| CacheError::Unavailable)?;
    bounded_records(rows.collect::<Result<Vec<_>, _>>())
}

pub(crate) fn oldest_records(
    connection: &Connection,
    except: Option<&str>,
    limit: usize,
) -> Result<Vec<CacheRecord>, CacheError> {
    let except = except.unwrap_or("");
    let mut statement = connection
        .prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM entries
             WHERE pending_delete = 0 AND key_hash <> ?1
             ORDER BY used_unix ASC, key_hash ASC LIMIT ?2"
        ))
        .map_err(|_| CacheError::Unavailable)?;
    let rows = statement
        .query_map(
            params![except, limit.min(MAX_CACHE_ENTRIES + 1) as i64],
            record_from_row,
        )
        .map_err(|_| CacheError::Unavailable)?;
    bounded_records(rows.collect::<Result<Vec<_>, _>>())
}

fn bounded_records(
    rows: rusqlite::Result<Vec<CacheRecord>>,
) -> Result<Vec<CacheRecord>, CacheError> {
    let rows = rows.map_err(|_| CacheError::Unavailable)?;
    if rows.len() > MAX_CACHE_ENTRIES {
        return Err(CacheError::Unavailable);
    }
    Ok(rows)
}
