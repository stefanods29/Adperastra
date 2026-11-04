//! Read-only SQLite browsing (Step 07f algorithm 6).
//!
//! The reader holds a source guard that denies concurrent write/delete while
//! the session is open, refuses a live WAL sidecar, builds its own file URI
//! with only `mode=ro` and `immutable=1`, and sets `query_only` and
//! `trusted_schema=OFF` on the connection. No SQL console, extension, view or
//! virtual table is reachable from here.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::decode::decode_text;
use crate::viewer_error::ViewerError;

/// The largest database file this viewer opens.
pub const MAX_SQLITE_SOURCE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// The most physical tables one database may contain.
pub const MAX_SQLITE_SCHEMA_OBJECTS: usize = 1_000;
/// The most columns one table may contain.
pub const MAX_SQLITE_COLUMNS: usize = 2_000;
/// The most rows one page carries.
pub const MAX_SQLITE_ROWS: usize = 256;
/// The VM-instruction budget between two interrupt checks.
pub const SQLITE_VM_INSTRUCTIONS: i32 = 100_000;
/// The wall-clock budget for one page query.
pub const SQLITE_STEP_MILLIS: u64 = 2_000;
/// The most characters one text cell carries before it is truncated.
pub const MAX_SQLITE_CELL_CHARS: usize = 64 * 1024;
/// The most bytes of a BLOB shown as a hex preview.
pub const MAX_SQLITE_BLOB_PREVIEW: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqliteColumn {
    pub name: String,
    pub declared_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqliteTableInfo {
    pub name: String,
    pub columns: Vec<SqliteColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SqliteCell {
    Null,
    Text {
        value: String,
        truncated: bool,
    },
    /// Exact decimal text; 9007199254740993 never becomes a lossy f64.
    Integer {
        value: String,
    },
    /// Shortest round-trip representation of a finite or special f64.
    Real {
        value: String,
    },
    Blob {
        blob_size: String,
        preview_hex: String,
    },
}

pub type SqliteRow = Vec<SqliteCell>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqliteSort {
    Asc,
    Desc,
}

#[derive(Debug, Clone)]
pub struct SqlitePage {
    pub table: SqliteTableInfo,
    pub rows: Vec<SqliteRow>,
    pub next_offset: Option<usize>,
    pub complete: bool,
}

struct TableMeta {
    info: SqliteTableInfo,
    without_rowid: bool,
    rowid_table: bool,
}

/// One open read-only database. Dropping it releases the source guard.
pub struct SqliteReader {
    conn: Connection,
    _guard: PinnedSource,
    path: PathBuf,
    tables: Vec<TableMeta>,
}

impl std::fmt::Debug for SqliteReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The open connection and its guard never belong in a log line.
        f.debug_struct("SqliteReader")
            .field("path", &self.path)
            .field("tables", &self.tables.len())
            .finish()
    }
}

impl SqliteReader {
    /// Open one database. A live WAL sidecar is refused because ignoring its
    /// uncheckpointed data would show an incomplete database as complete.
    pub fn open(path: &Path) -> Result<Self, ViewerError> {
        let metadata = std::fs::metadata(path).map_err(|_| ViewerError::Unavailable)?;
        if metadata.len() > MAX_SQLITE_SOURCE_BYTES {
            return Err(ViewerError::TooLarge);
        }
        if sidecar(path, "-wal").exists() {
            return Err(ViewerError::ReadOnly);
        }
        let identity = SourceIdentity::capture(path).map_err(|_| ViewerError::Unavailable)?;
        let guard = PinnedSource::open(path, &identity).map_err(|_| ViewerError::Changed)?;
        let uri = sqlite_uri(path)?;
        let conn = Connection::open_with_flags(
            uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| ViewerError::Corrupt)?;
        conn.busy_timeout(Duration::from_millis(250))
            .map_err(|_| ViewerError::Unavailable)?;
        conn.execute_batch(
            "PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=OFF;",
        )
        .map_err(|_| ViewerError::ReadOnly)?;
        let tables = read_schema(&conn)?;
        Ok(Self {
            conn,
            _guard: guard,
            path: path.to_path_buf(),
            tables,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn tables(&self) -> Vec<SqliteTableInfo> {
        self.tables.iter().map(|table| table.info.clone()).collect()
    }

    pub fn table(&self, name: &str) -> Option<SqliteTableInfo> {
        self.tables
            .iter()
            .find(|table| table.info.name == name)
            .map(|table| table.info.clone())
    }

    /// One bounded page. `offset` is the cursor's decoded row offset, never
    /// arbitrary SQL. Sorting uses only an existing column index.
    pub fn page(
        &mut self,
        table_name: &str,
        sort_column: Option<usize>,
        sort: SqliteSort,
        offset: usize,
        limit: usize,
        cancel: &Arc<AtomicBool>,
    ) -> Result<SqlitePage, ViewerError> {
        let (table_info, without_rowid, rowid_table) = self
            .tables
            .iter()
            .find(|table| table.info.name == table_name)
            .map(|table| (table.info.clone(), table.without_rowid, table.rowid_table))
            .ok_or(ViewerError::BadRequest)?;
        if let Some(column) = sort_column {
            if column >= table_info.columns.len() {
                return Err(ViewerError::BadRequest);
            }
        }
        let limit = limit.clamp(1, MAX_SQLITE_ROWS);
        let offset_i64 = i64::try_from(offset).map_err(|_| ViewerError::BadRequest)?;
        let mut columns = String::new();
        for (index, column) in table_info.columns.iter().enumerate() {
            if index > 0 {
                columns.push_str(", ");
            }
            columns.push_str(&quote_identifier(&column.name));
        }
        let mut sql = format!(
            "SELECT {columns} FROM {}",
            quote_identifier(&table_info.name)
        );
        let mut order = Vec::new();
        if let Some(column) = sort_column {
            order.push(format!(
                "{} {}",
                quote_identifier(&table_info.columns[column].name),
                match sort {
                    SqliteSort::Asc => "ASC",
                    SqliteSort::Desc => "DESC",
                }
            ));
        }
        if rowid_table {
            order.push("rowid ASC".to_string());
        } else if without_rowid {
            for column in table_info
                .columns
                .iter()
                .filter(|column| column.primary_key)
            {
                order.push(format!("{} ASC", quote_identifier(&column.name)));
            }
        }
        if !order.is_empty() {
            sql.push_str(" ORDER BY ");
            sql.push_str(&order.join(", "));
        }
        sql.push_str(" LIMIT ?1 OFFSET ?2");
        let started = Instant::now();
        let cancelled = Arc::clone(cancel);
        let budget = Arc::new(AtomicBool::new(false));
        let budget_flag = Arc::clone(&budget);
        self.conn
            .progress_handler(
                SQLITE_VM_INSTRUCTIONS,
                Some(move || {
                    if cancelled.load(Ordering::Relaxed)
                        || started.elapsed() > Duration::from_millis(SQLITE_STEP_MILLIS)
                    {
                        budget_flag.store(true, Ordering::Relaxed);
                        return true;
                    }
                    false
                }),
            )
            .map_err(|_| ViewerError::Unavailable)?;
        let outcome = (|| -> Result<Vec<SqliteRow>, rusqlite::Error> {
            let mut statement = self.conn.prepare(&sql)?;
            let mut rows = statement.query(rusqlite::params![limit as i64, offset_i64])?;
            let mut output = Vec::new();
            while let Some(row) = rows.next()? {
                if cancel.load(Ordering::Relaxed) {
                    return Err(rusqlite::Error::ExecuteReturnedResults);
                }
                let mut cells = Vec::with_capacity(table_info.columns.len());
                for index in 0..table_info.columns.len() {
                    cells.push(cell_from_value(row.get_ref(index)?));
                }
                output.push(cells);
            }
            Ok(output)
        })();
        let _ = self.conn.progress_handler(0, None::<fn() -> bool>);
        let rows = outcome.map_err(|error| {
            if budget.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                ViewerError::TooLarge
            } else {
                match error {
                    rusqlite::Error::SqliteFailure(_, _) => ViewerError::Corrupt,
                    _ => ViewerError::Unavailable,
                }
            }
        })?;
        let complete = rows.len() < limit;
        Ok(SqlitePage {
            table: table_info,
            next_offset: if complete {
                None
            } else {
                Some(offset.saturating_add(rows.len()))
            },
            rows,
            complete,
        })
    }

    /// Test-only entry that runs one bounded read statement through the same
    /// progress handler. It never changes the database.
    #[cfg(test)]
    fn run_bounded_query_for_test(&mut self, sql: &str) -> Result<(), ViewerError> {
        let started = Instant::now();
        self.conn
            .progress_handler(
                SQLITE_VM_INSTRUCTIONS,
                Some(move || started.elapsed() > Duration::from_millis(SQLITE_STEP_MILLIS)),
            )
            .map_err(|_| ViewerError::Unavailable)?;
        let outcome = self.conn.query_row(sql, [], |_| Ok(()));
        let _ = self.conn.progress_handler(0, None::<fn() -> bool>);
        outcome.map_err(|_| ViewerError::TooLarge)
    }
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// A bounded file URI. Only the path is percent-encoded; the query is the
/// fixed read-only policy.
pub fn sqlite_uri(path: &Path) -> Result<String, ViewerError> {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.is_empty() || text.contains('\0') {
        return Err(ViewerError::BadRequest);
    }
    let mut encoded = String::with_capacity(text.len() + 32);
    for byte in text.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                encoded.push(char::from(*byte))
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    Ok(format!("file:///{encoded}?mode=ro&immutable=1"))
}

/// Escape one SQL identifier by doubling every double quote and surrounding
/// the whole name. No caller builds an identifier from raw UI text.
pub fn quote_identifier(name: &str) -> String {
    let mut quoted = String::with_capacity(name.len() + 2);
    quoted.push('"');
    for character in name.chars() {
        if character == '"' {
            quoted.push('"');
        }
        quoted.push(character);
    }
    quoted.push('"');
    quoted
}

fn read_schema(conn: &Connection) -> Result<Vec<TableMeta>, ViewerError> {
    let mut statement = conn
        .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .map_err(|_| ViewerError::Corrupt)?;
    let mut rows = statement.query([]).map_err(|_| ViewerError::Corrupt)?;
    let mut tables = Vec::new();
    while let Some(row) = rows.next().map_err(|_| ViewerError::Corrupt)? {
        let name: String = row.get(0).map_err(|_| ViewerError::Corrupt)?;
        if name.starts_with("sqlite_") {
            continue;
        }
        if name.chars().count() > 1_024 {
            return Err(ViewerError::TooLarge);
        }
        let sql: Option<String> = row.get(1).ok();
        let sql = sql.unwrap_or_default();
        if is_virtual_table(&sql) {
            continue;
        }
        if tables.len() >= MAX_SQLITE_SCHEMA_OBJECTS {
            return Err(ViewerError::TooLarge);
        }
        let columns = read_columns(conn, &name)?;
        let without_rowid = sql.to_ascii_uppercase().contains("WITHOUT ROWID");
        tables.push(TableMeta {
            info: SqliteTableInfo {
                name: name.chars().take(1_024).collect(),
                columns,
            },
            without_rowid,
            rowid_table: !without_rowid,
        });
    }
    Ok(tables)
}

fn is_virtual_table(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    upper.starts_with("CREATE VIRTUAL TABLE")
}

fn read_columns(conn: &Connection, table: &str) -> Result<Vec<SqliteColumn>, ViewerError> {
    let pragma = format!("PRAGMA table_info({})", quote_identifier(table));
    let mut statement = conn.prepare(&pragma).map_err(|_| ViewerError::Corrupt)?;
    let mut rows = statement.query([]).map_err(|_| ViewerError::Corrupt)?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next().map_err(|_| ViewerError::Corrupt)? {
        if columns.len() >= MAX_SQLITE_COLUMNS {
            return Err(ViewerError::TooLarge);
        }
        let name: String = row.get(1).map_err(|_| ViewerError::Corrupt)?;
        if name.chars().count() > 1_024 {
            return Err(ViewerError::TooLarge);
        }
        let declared_type: String = row.get(2).unwrap_or_default();
        let not_null: i64 = row.get(3).unwrap_or(0);
        let primary_key: i64 = row.get(5).unwrap_or(0);
        columns.push(SqliteColumn {
            name,
            declared_type: declared_type.chars().take(128).collect(),
            nullable: not_null == 0,
            primary_key: primary_key > 0,
        });
    }
    Ok(columns)
}

fn cell_from_value(value: ValueRef<'_>) -> SqliteCell {
    match value {
        ValueRef::Null => SqliteCell::Null,
        ValueRef::Integer(value) => SqliteCell::Integer {
            value: value.to_string(),
        },
        ValueRef::Real(value) => SqliteCell::Real {
            value: value.to_string(),
        },
        ValueRef::Text(bytes) => {
            let (text, _) = decode_text(bytes);
            let (value, truncated) = crate::ansi::truncate_chars(&text, MAX_SQLITE_CELL_CHARS);
            SqliteCell::Text { value, truncated }
        }
        ValueRef::Blob(bytes) => {
            let preview = &bytes[..bytes.len().min(MAX_SQLITE_BLOB_PREVIEW)];
            SqliteCell::Blob {
                blob_size: bytes.len().to_string(),
                preview_hex: preview.iter().map(|byte| format!("{byte:02x}")).collect(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn writable(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT, amount INTEGER, data BLOB);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (text, amount, data) VALUES (?1, ?2, ?3)",
            rusqlite::params!["hello", 9_007_199_254_740_993i64, vec![0u8, 1, 2, 3]],
        )
        .unwrap();
        drop(conn);
    }

    #[test]
    fn identifiers_are_quote_escaped() {
        assert_eq!(quote_identifier("x\" OR 1=1 --"), "\"x\"\" OR 1=1 --\"");
        assert_eq!(quote_identifier("normal"), "\"normal\"");
    }

    #[test]
    fn integers_above_two_to_the_fifty_three_stay_exact_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.sqlite");
        writable(&path);
        let mut reader = SqliteReader::open(&path).unwrap();
        let page = reader
            .page(
                "notes",
                None,
                SqliteSort::Asc,
                0,
                10,
                &Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        let amount = page.rows[0][2].clone();
        assert_eq!(
            amount,
            SqliteCell::Integer {
                value: "9007199254740993".to_string()
            }
        );
    }

    #[test]
    fn a_wal_sidecar_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.sqlite");
        writable(&path);
        let mut wal = std::fs::File::create(sidecar(&path, "-wal")).unwrap();
        wal.write_all(b"x").unwrap();
        assert_eq!(
            SqliteReader::open(&path).unwrap_err(),
            ViewerError::ReadOnly
        );
    }

    #[test]
    fn the_vm_budget_interrupts_a_runaway_statement() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.sqlite");
        writable(&path);
        let mut reader = SqliteReader::open(&path).unwrap();
        let result = reader.run_bounded_query_for_test(
            "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt) SELECT count(*) FROM cnt",
        );
        assert_eq!(result, Err(ViewerError::TooLarge));
    }

    #[test]
    fn the_uri_has_only_read_only_flags() {
        let uri = sqlite_uri(Path::new("C:\\My Files\\a#b.sqlite")).unwrap();
        assert!(uri.starts_with("file:///C:/My%20Files/a%23b.sqlite?"));
        assert!(uri.ends_with("mode=ro&immutable=1"));
        assert!(!uri.contains("mode=rw"));
    }
}
