//! 12a `StorageProvider` adapter for the semantic tables (Step 17c T2).
//!
//! The semantic tables share `search/index.sqlite3` with the ordinary index.
//! That shared file's physical/WAL bytes are owned by 11a's content-index
//! provider; this provider reports the actual vector payload and pending
//! rows so App storage never counts the same bytes twice.
#![allow(dead_code)]


use std::path::{Path, PathBuf};

use fs_service::CancellationToken;
use pack_store::types::{ClearStorageResult, StorageCategory, StorageReport};
use rusqlite::{Connection, OpenFlags};

use crate::ai_search_types::{AiSearchError, MAX_EMBEDDING_BYTES};
use crate::ai_semantic_store::SemanticStore;
use crate::storage_types::StorageProvider;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SemanticUsage {
    pub payload_bytes: u64,
    pub pending_bytes: u64,
    pub pending_rows: u32,
}

/// Read the semantic payload without creating or migrating the database.
pub fn semantic_usage_at(db_path: &Path) -> SemanticUsage {
    let Ok(connection) = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return SemanticUsage::default();
    };
    let has_table: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'semantic_vectors'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if has_table == 0 {
        return SemanticUsage::default();
    }
    let payload = connection
        .query_row(
            "SELECT COALESCE(SUM(length(vector)), 0) FROM semantic_vectors",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64;
    let pending_rows = connection
        .query_row("SELECT COUNT(*) FROM semantic_pending", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as u32;
    SemanticUsage {
        payload_bytes: payload,
        pending_bytes: 0,
        pending_rows,
    }
}

/// Actual physical bytes of the shared database and its sidecars. Exposed for
/// the coordinator so the 11a provider can report the file exactly once.
pub fn sqlite_physical_bytes(db_path: &Path) -> u64 {
    let mut total = std::fs::metadata(db_path).map(|meta| meta.len()).unwrap_or(0);
    for suffix in ["-wal", "-shm"] {
        let mut name = db_path.as_os_str().to_os_string();
        name.push(suffix);
        total = total.saturating_add(
            std::fs::metadata(PathBuf::from(name))
                .map(|meta| meta.len())
                .unwrap_or(0),
        );
    }
    total
}

pub struct AiSemanticStorageProvider {
    db_path: PathBuf,
}

impl AiSemanticStorageProvider {
    pub fn new(profile_dir: &Path) -> Self {
        Self {
            db_path: profile_dir.join("search").join("index.sqlite3"),
        }
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}

impl StorageProvider for AiSemanticStorageProvider {
    fn category(&self) -> StorageCategory {
        StorageCategory::AiEmbeddings
    }

    fn report(&self) -> Result<StorageReport, String> {
        if !self.db_path.exists() {
            return Ok(StorageReport {
                category: StorageCategory::AiEmbeddings,
                limit_bytes: MAX_EMBEDDING_BYTES,
                ..StorageReport::empty(StorageCategory::AiEmbeddings)
            });
        }
        let usage = semantic_usage_at(&self.db_path);
        Ok(StorageReport {
            category: StorageCategory::AiEmbeddings,
            disk_bytes: usage.payload_bytes,
            memory_bytes: 0,
            pending_delete_bytes: usage.pending_bytes,
            limit_bytes: MAX_EMBEDDING_BYTES,
            clearable: true,
            loss_key: "storage.lossAi".to_string(),
            busy: false,
        })
    }

    fn clear(&self, token: &CancellationToken) -> Result<ClearStorageResult, String> {
        let mut store = SemanticStore::open_profile(
            self.db_path
                .parent()
                .and_then(Path::parent)
                .ok_or_else(|| "storage.failed".to_string())?,
        )
        .map_err(|error: AiSearchError| error.code().to_string())?;
        let (freed, pending) = store
            .clear_semantic_data(token)
            .map_err(|error| error.code().to_string())?;
        Ok(ClearStorageResult {
            category: StorageCategory::AiEmbeddings,
            freed_bytes: freed,
            pending_bytes: pending,
            complete: true,
            errors: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::semantic_usage_at;
    use std::path::Path;

    #[test]
    fn missing_database_reports_nothing() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(semantic_usage_at(&directory.path().join("absent.sqlite3")), Default::default());
    }

    #[test]
    fn unrelated_database_is_not_counted() {
        let directory = tempfile::tempdir().unwrap();
        let db = directory.path().join("other.sqlite3");
        let connection = rusqlite::Connection::open(&db).unwrap();
        connection
            .execute_batch("CREATE TABLE files (key TEXT); INSERT INTO files VALUES ('x');")
            .unwrap();
        assert_eq!(semantic_usage_at(Path::new(&db)).payload_bytes, 0);
    }
}
