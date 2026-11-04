//! Bounded owned storage index (Step 11c T2, `storage-scan-1`).
//!
//! One SQLite file per profile at `<profile>/storage.sqlite`, schema 1.
//! The budget is physical (database + WAL + shared-memory file), at most
//! 256 MiB, and only app-owned rows/blobs live here. The store never keeps a
//! copy of a user file and never deletes anything outside its own file.
//! Pages are cut by `storage_paging` so a response stays under 768 KiB.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use ::storage_scan::{
    Coverage, ScanSink, StorageError, StorageNode, StorageNodeKind, StoragePage, StorageSummary,
    TypeBreakdown, STORAGE_DB_LIMIT_BYTES, MAX_PAGE_NODES, MAX_RETAINED_ROOTS,
    MAX_SCAN_AGE_SECS, MAX_TYPE_GROUPS, SCANNER_VERSION,
};
use fs_service::{FileIdentityKey, SourceStamp};
use rusqlite::{params, Connection, OptionalExtension};

use crate::storage_paging::bound_page;

const STORE_SCHEMA: u32 = 1;

/// What a cached lookup returns without walking the filesystem.
#[derive(Debug, Clone)]
#[allow(dead_code)] // The summary is kept for coordinators that verify the key.
pub struct CachedScan {
    pub scan_id: String,
    pub summary: StorageSummary,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // `scan_count` is reported by the T2 diagnostics.
pub struct StorageUsage {
    pub disk_bytes: u64,
    pub scan_count: u32,
}

pub struct StorageStore {
    conn: Connection,
    dir: PathBuf,
    db_path: PathBuf,
    limit_bytes: u64,
    nodes_since_budget_check: u32,
    /// One scan records at a time (Step 11c D1). The sink has no scan id,
    /// so the store binds it explicitly in `begin_scan`.
    active_scan: Option<String>,
}

impl StorageStore {
    /// Open or create the store. A newer schema is refused whole.
    pub fn open(profile_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(profile_dir).map_err(|_| "storage.unavailable".to_string())?;
        let db_path = profile_dir.join("storage.sqlite");
        let conn = Connection::open(&db_path).map_err(|_| "storage.unavailable".to_string())?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|_| "storage.unavailable".to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|_| "storage.unavailable".to_string())?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|_| "storage.unavailable".to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS scans (
                 scan_id TEXT PRIMARY KEY,
                 root_key TEXT NOT NULL,
                 generation INTEGER NOT NULL,
                 options_key TEXT NOT NULL,
                 scanner_version INTEGER NOT NULL,
                 state TEXT NOT NULL,
                 created_unix INTEGER NOT NULL,
                 used_unix INTEGER NOT NULL,
                 summary_json TEXT,
                 root_node_id TEXT
             );
             CREATE INDEX IF NOT EXISTS scans_by_key
                 ON scans (root_key, generation, options_key, used_unix);
             CREATE TABLE IF NOT EXISTS nodes (
                 scan_id TEXT NOT NULL,
                 node_id TEXT NOT NULL,
                 parent_id TEXT,
                 path_key TEXT NOT NULL,
                 path TEXT NOT NULL,
                 name TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 key_json TEXT NOT NULL,
                 logical_bytes INTEGER NOT NULL,
                 allocated_bytes INTEGER,
                 item_count INTEGER NOT NULL,
                 online_only INTEGER NOT NULL,
                 coverage TEXT NOT NULL,
                 children_count INTEGER NOT NULL,
                 PRIMARY KEY (scan_id, node_id)
             );
             CREATE INDEX IF NOT EXISTS nodes_page
                 ON nodes (scan_id, parent_id, logical_bytes DESC, path_key, node_id);
             CREATE TABLE IF NOT EXISTS breakdown (
                 scan_id TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 count INTEGER NOT NULL,
                 logical_bytes INTEGER NOT NULL,
                 PRIMARY KEY (scan_id, kind)
             );
             CREATE TABLE IF NOT EXISTS duplicate_hashes (
                 key_text TEXT PRIMARY KEY,
                 modified_ticks TEXT NOT NULL,
                 size_bytes INTEGER NOT NULL,
                 full_hash TEXT NOT NULL,
                 used_unix INTEGER NOT NULL
             );",
        )
        .map_err(|_| "storage.failed".to_string())?;
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "storage.failed".to_string())?;
        match stored {
            Some(text) if text == STORE_SCHEMA.to_string() => {}
            Some(text)
                if text
                    .parse::<u32>()
                    .map(|version| version > STORE_SCHEMA)
                    .unwrap_or(false) =>
            {
                return Err("storage.unavailable".to_string())
            }
            _ => {
                conn.execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
                    params![STORE_SCHEMA.to_string()],
                )
                .map_err(|_| "storage.failed".to_string())?;
            }
        }
        Ok(Self {
            conn,
            dir: profile_dir.to_path_buf(),
            db_path,
            limit_bytes: STORAGE_DB_LIMIT_BYTES,
            nodes_since_budget_check: 0,
            active_scan: None,
        })
    }

    #[allow(dead_code)] // Exposed to the 12a App-storage provider.
    pub fn scanner_version(&self) -> u32 {
        SCANNER_VERSION
    }

    /// Physical usage of the database, its WAL and shared-memory sidecars.
    pub fn usage(&self) -> Result<StorageUsage, String> {
        let mut disk_bytes = file_bytes(&self.db_path);
        disk_bytes = disk_bytes.saturating_add(file_bytes(&sidecar(&self.db_path, "-wal")));
        disk_bytes = disk_bytes.saturating_add(file_bytes(&sidecar(&self.db_path, "-shm")));
        disk_bytes = disk_bytes.saturating_add(file_bytes(&sidecar(&self.db_path, "-journal")));
        let scan_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0))
            .map_err(|_| "storage.failed".to_string())?;
        Ok(StorageUsage {
            disk_bytes,
            scan_count: u32::try_from(scan_count).unwrap_or(u32::MAX),
        })
    }

    pub fn begin_scan(
        &mut self,
        scan_id: &str,
        root_key: &str,
        generation: u64,
        options_key: &str,
        now_unix: u64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO scans (scan_id, root_key, generation, options_key,
                                    scanner_version, state, created_unix, used_unix)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6)",
                params![
                    scan_id,
                    root_key,
                    i64_of(generation)?,
                    options_key,
                    i64::from(SCANNER_VERSION),
                    i64_of(now_unix)?
                ],
            )
            .map_err(|_| "storage.failed".to_string())?;
        self.active_scan = Some(scan_id.to_string());
        Ok(())
    }

    /// Bind an already inserted scan row to this connection's sink before
    /// the worker records the first node.
    pub fn bind_scan(&mut self, scan_id: &str) {
        self.active_scan = Some(scan_id.to_string());
    }

    pub fn finish_scan(&mut self, summary: &StorageSummary) -> Result<(), String> {
        let json = serde_json::to_string(summary).map_err(|_| "storage.failed".to_string())?;
        self.conn
            .execute(
                "UPDATE scans SET state = 'complete', summary_json = ?2, used_unix = ?3
                 WHERE scan_id = ?1",
                params![summary.scan_id, json, i64_of(summary.calculated_unix)?],
            )
            .map_err(|_| "storage.failed".to_string())?;
        if self.active_scan.as_deref() == Some(summary.scan_id.as_str()) {
            self.active_scan = None;
        }
        Ok(())
    }

    /// The newest complete scan for this exact root/generation/options key,
    /// excluding the scan currently being refreshed.
    pub fn find_cached(
        &self,
        root_key: &str,
        generation: u64,
        options_key: &str,
        exclude_scan: &str,
    ) -> Result<Option<CachedScan>, String> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT scan_id, summary_json FROM scans
                 WHERE root_key = ?1 AND generation = ?2 AND options_key = ?3
                   AND scanner_version = ?4
                   AND state = 'complete' AND summary_json IS NOT NULL
                   AND scan_id <> ?5
                 ORDER BY used_unix DESC LIMIT 1",
                params![
                    root_key,
                    i64_of(generation)?,
                    options_key,
                    i64::from(SCANNER_VERSION),
                    exclude_scan
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "storage.failed".to_string())?;
        let Some((scan_id, json)) = row else {
            return Ok(None);
        };
        let summary: StorageSummary =
            serde_json::from_str(&json).map_err(|_| "storage.failed".to_string())?;
        Ok(Some(CachedScan { scan_id, summary }))
    }

    /// The newest complete scan for the same root/options even when its
    /// generation is older. The caller marks the page stale and starts a
    /// bounded rescan; it never presents the old totals as current.
    pub fn find_cached_previous(
        &self,
        root_key: &str,
        options_key: &str,
        exclude_scan: &str,
    ) -> Result<Option<CachedScan>, String> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT scan_id, summary_json FROM scans
                 WHERE root_key = ?1 AND options_key = ?2 AND scanner_version = ?3
                   AND state = 'complete' AND summary_json IS NOT NULL
                   AND scan_id <> ?4
                 ORDER BY used_unix DESC LIMIT 1",
                params![
                    root_key,
                    options_key,
                    i64::from(SCANNER_VERSION),
                    exclude_scan
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "storage.failed".to_string())?;
        let Some((scan_id, json)) = row else {
            return Ok(None);
        };
        let summary: StorageSummary =
            serde_json::from_str(&json).map_err(|_| "storage.failed".to_string())?;
        Ok(Some(CachedScan { scan_id, summary }))
    }

    /// One page of direct children, ordered by logical size descending then
    /// path key ascending. `stale` is set by the caller when the page comes
    /// from a cached scan while a refresh is running.
    pub fn page(
        &self,
        scan_id: &str,
        parent_id: Option<&str>,
        cursor: Option<&str>,
        stale: bool,
    ) -> Result<StoragePage, String> {
        let (summary_json, root_node_id): (Option<String>, Option<String>) = self
            .conn
            .query_row(
                "SELECT summary_json, root_node_id FROM scans WHERE scan_id = ?1",
                params![scan_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "storage.failed".to_string())?
            .ok_or_else(|| "storage.invalid".to_string())?;
        let Some(json) = summary_json else {
            return Err("storage.failed".to_string());
        };
        let mut summary: StorageSummary =
            serde_json::from_str(&json).map_err(|_| "storage.failed".to_string())?;
        summary.stale = stale;
        let effective_parent = parent_id.map(str::to_string).or(root_node_id);
        let Some(effective_parent) = effective_parent else {
            return Ok(StoragePage {
                summary,
                nodes: Vec::new(),
                next_cursor: None,
                complete: false,
                typed_breakdown: Vec::new(),
            });
        };

        let (has_cursor, cursor_logical, cursor_path) = match cursor {
            None => (0i64, 0i64, String::new()),
            Some(cursor_id) => {
                let row: Option<(i64, String, String)> = self
                    .conn
                    .query_row(
                        "SELECT logical_bytes, path_key, node_id FROM nodes
                         WHERE scan_id = ?1 AND node_id = ?2",
                        params![scan_id, cursor_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .optional()
                    .map_err(|_| "storage.failed".to_string())?;
                let Some((logical, path_key, id)) = row else {
                    return Err("storage.invalid".to_string());
                };
                if id != cursor_id {
                    return Err("storage.invalid".to_string());
                }
                (1i64, logical, path_key)
            }
        };

        let mut statement = self
            .conn
            .prepare(
                "SELECT node_id, parent_id, key_json, path, name, kind, logical_bytes,
                        allocated_bytes, item_count, online_only, coverage, children_count
                 FROM nodes
                 WHERE scan_id = ?1 AND parent_id IS ?2
                   AND (?3 = 0 OR logical_bytes < ?4
                        OR (logical_bytes = ?4 AND (path_key > ?5
                            OR (path_key = ?5 AND node_id > ?6))))
                 ORDER BY logical_bytes DESC, path_key ASC, node_id ASC
                 LIMIT 257",
            )
            .map_err(|_| "storage.failed".to_string())?;
        let rows = statement
            .query_map(
                params![
                    scan_id,
                    effective_parent,
                    has_cursor,
                    cursor_logical,
                    cursor_path,
                    cursor.unwrap_or("")
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, Option<i64>>(7)?,
                        row.get::<_, i64>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, i64>(11)?,
                    ))
                },
            )
            .map_err(|_| "storage.failed".to_string())?;

        let mut loaded = Vec::new();
        for row in rows {
            let row = row.map_err(|_| "storage.failed".to_string())?;
            loaded.push(node_from_row(row)?);
        }
        let had_more = loaded.len() > MAX_PAGE_NODES;
        let (nodes, shortened) = bound_page(loaded);
        let complete = !had_more && !shortened;
        let next_cursor = if complete {
            None
        } else {
            nodes.last().map(|node| node.id.clone())
        };
        let typed_breakdown = self.breakdown(scan_id)?;
        Ok(StoragePage {
            summary,
            nodes,
            next_cursor,
            complete,
            typed_breakdown,
        })
    }

    fn breakdown(&self, scan_id: &str) -> Result<Vec<TypeBreakdown>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT kind, count, logical_bytes FROM breakdown
                 WHERE scan_id = ?1
                 ORDER BY logical_bytes DESC, kind ASC LIMIT ?2",
            )
            .map_err(|_| "storage.failed".to_string())?;
        let rows = statement
            .query_map(params![scan_id, MAX_TYPE_GROUPS as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| "storage.failed".to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (kind, count, logical) = row.map_err(|_| "storage.failed".to_string())?;
            out.push(TypeBreakdown {
                kind,
                count: u32::try_from(count).unwrap_or(u32::MAX),
                logical_bytes: u64::try_from(logical).unwrap_or(0),
            });
        }
        Ok(out)
    }

    pub fn delete_scan(&mut self, scan_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM breakdown WHERE scan_id = ?1", params![scan_id])
            .and_then(|_| {
                self.conn
                    .execute("DELETE FROM nodes WHERE scan_id = ?1", params![scan_id])
            })
            .and_then(|_| {
                self.conn
                    .execute("DELETE FROM scans WHERE scan_id = ?1", params![scan_id])
            })
            .map(|_| ())
            .map_err(|_| "storage.failed".to_string())
    }

    /// LRU and age retention: ten roots at most, seven days, then the
    /// physical 256 MiB budget. Only rows owned by this store are removed.
    pub fn trim(&mut self, now_unix: u64) -> Result<(), String> {
        let cutoff = now_unix.saturating_sub(MAX_SCAN_AGE_SECS);
        self.conn
            .execute(
                "DELETE FROM nodes WHERE scan_id IN
                   (SELECT scan_id FROM scans WHERE created_unix < ?1)",
                params![i64_of(cutoff)?],
            )
            .map_err(|_| "storage.failed".to_string())?;
        self.conn
            .execute(
                "DELETE FROM breakdown WHERE scan_id IN
                   (SELECT scan_id FROM scans WHERE created_unix < ?1)",
                params![i64_of(cutoff)?],
            )
            .map_err(|_| "storage.failed".to_string())?;
        self.conn
            .execute(
                "DELETE FROM scans WHERE created_unix < ?1",
                params![i64_of(cutoff)?],
            )
            .map_err(|_| "storage.failed".to_string())?;

        let old_roots: Vec<String> = {
            let mut statement = self
                .conn
                .prepare(
                    "SELECT root_key FROM scans GROUP BY root_key
                     ORDER BY MAX(used_unix) DESC LIMIT -1 OFFSET ?1",
                )
                .map_err(|_| "storage.failed".to_string())?;
            let rows = statement
                .query_map(params![MAX_RETAINED_ROOTS as i64], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|_| "storage.failed".to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        for root in old_roots {
            self.drop_root(&root)?;
        }

        let mut guard = 0;
        while self.usage()?.disk_bytes > self.limit_bytes && guard < 64 {
            guard += 1;
            let oldest: Option<String> = self
                .conn
                .query_row(
                    "SELECT scan_id FROM scans ORDER BY used_unix ASC, scan_id ASC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| "storage.failed".to_string())?;
            let Some(scan_id) = oldest else {
                break;
            };
            self.delete_scan(&scan_id)?;
        }
        let _ = self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        if self.usage()?.disk_bytes > self.limit_bytes {
            let _ = self.conn.execute_batch("VACUUM;");
        }
        Ok(())
    }

    fn drop_root(&mut self, root_key: &str) -> Result<(), String> {
        let ids: Vec<String> = {
            let mut statement = self
                .conn
                .prepare("SELECT scan_id FROM scans WHERE root_key = ?1")
                .map_err(|_| "storage.failed".to_string())?;
            let rows = statement
                .query_map(params![root_key], |row| row.get::<_, String>(0))
                .map_err(|_| "storage.failed".to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        for id in ids {
            self.delete_scan(&id)?;
        }
        Ok(())
    }

    #[allow(dead_code)] // Provider-facing accessor for the owned data root.
    pub fn set_limit(&mut self, limit_bytes: u64) {
        self.limit_bytes = limit_bytes;
    }

    #[allow(dead_code)] // Provider-facing accessor for the owned data root.
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

impl ScanSink for StorageStore {
    fn record_node(&mut self, node: StorageNode) -> Result<(), StorageError> {
        let key_json = serde_json::to_string(&node.key).map_err(|_| StorageError::Failed(
            "identity serialization".to_string(),
        ))?;
        let kind = match node.kind {
            StorageNodeKind::File => "file",
            StorageNodeKind::Folder => "folder",
        };
        let coverage = match node.coverage {
            Coverage::Complete => "complete",
            Coverage::Partial => "partial",
        };
        let scan_id = self.active_scan_id()?;
        self.conn
            .execute(
                "INSERT INTO nodes (scan_id, node_id, parent_id, path_key, path, name, kind,
                                    key_json, logical_bytes, allocated_bytes, item_count,
                                    online_only, coverage, children_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(scan_id, node_id) DO UPDATE SET
                   parent_id = excluded.parent_id, path_key = excluded.path_key,
                   path = excluded.path, name = excluded.name, kind = excluded.kind,
                   key_json = excluded.key_json, logical_bytes = excluded.logical_bytes,
                   allocated_bytes = excluded.allocated_bytes,
                   item_count = excluded.item_count, online_only = excluded.online_only,
                   coverage = excluded.coverage, children_count = excluded.children_count",
                params![
                    scan_id,
                    node.id,
                    node.parent_id,
                    node.key.path_key,
                    node.path,
                    node.name,
                    kind,
                    key_json,
                    i64_of(node.logical_bytes).map_err(|_| StorageError::Invalid)?,
                    node.allocated_bytes
                        .map(i64_of)
                        .transpose()
                        .map_err(|_| StorageError::Invalid)?,
                    i64::from(node.item_count),
                    i64::from(node.online_only),
                    coverage,
                    i64::from(node.children_count),
                ],
            )
            .map_err(|_| StorageError::Failed("node insert".to_string()))?;
        if node.parent_id.is_none() {
            let _ = self.conn.execute(
                "UPDATE scans SET root_node_id = ?2 WHERE scan_id = ?1",
                params![scan_id, node.id],
            );
        }
        if matches!(node.kind, StorageNodeKind::File) {
            let group = canonical_type_group(&node.name);
            let _ = self.conn.execute(
                "INSERT INTO breakdown (scan_id, kind, count, logical_bytes)
                 VALUES (?1, ?2, 1, ?3)
                 ON CONFLICT(scan_id, kind) DO UPDATE SET
                   count = count + 1, logical_bytes = logical_bytes + excluded.logical_bytes",
                params![
                    scan_id,
                    group,
                    i64_of(node.logical_bytes).map_err(|_| StorageError::Invalid)?
                ],
            );
        }
        self.nodes_since_budget_check = self.nodes_since_budget_check.saturating_add(1);
        if self.nodes_since_budget_check >= 256 {
            self.nodes_since_budget_check = 0;
            let usage = self
                .usage()
                .map_err(|_| StorageError::Failed("usage".to_string()))?;
            if usage.disk_bytes > self.limit_bytes {
                return Err(StorageError::Limit);
            }
        }
        Ok(())
    }
}

impl StorageStore {
    fn active_scan_id(&self) -> Result<String, StorageError> {
        self.active_scan
            .clone()
            .ok_or_else(|| StorageError::Failed("no active scan".to_string()))
    }
}

#[allow(clippy::type_complexity)]
fn node_from_row(
    row: (
        String,
        Option<String>,
        String,
        String,
        String,
        String,
        i64,
        Option<i64>,
        i64,
        i64,
        String,
        i64,
    ),
) -> Result<StorageNode, String> {
    let (id, parent_id, key_json, path, name, kind, logical, allocated, item_count, online, coverage, children) =
        row;
    let key = serde_json::from_str(&key_json).map_err(|_| "storage.failed".to_string())?;
    Ok(StorageNode {
        id,
        parent_id,
        key,
        path,
        name,
        kind: if kind == "folder" {
            StorageNodeKind::Folder
        } else {
            StorageNodeKind::File
        },
        logical_bytes: u64::try_from(logical).map_err(|_| "storage.failed".to_string())?,
        allocated_bytes: allocated
            .map(|value| u64::try_from(value).map_err(|_| "storage.failed".to_string()))
            .transpose()?,
        item_count: u32::try_from(item_count).unwrap_or(u32::MAX),
        online_only: online != 0,
        coverage: if coverage == "partial" {
            Coverage::Partial
        } else {
            Coverage::Complete
        },
        children_count: u32::try_from(children).unwrap_or(u32::MAX),
    })
}

/// The duplicate hash cache is a separate 128 MiB allowance inside the
/// store's 256 MiB physical budget. A row is valid only for the exact
/// identity and 100 ns stamp it recorded.
pub const HASH_CACHE_LIMIT_BYTES: u64 = 128 * 1024 * 1024;

fn hash_cache_key(key: &FileIdentityKey, stamp: &SourceStamp) -> String {
    format!(
        "{}:{}:{}|{}|{}",
        key.volume_id, key.file_id, key.path_key, stamp.modified_ticks, stamp.size_bytes
    )
}

fn parse_hash(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let mut out = [0u8; 32];
    let (pairs, _) = text.as_bytes().as_chunks::<2>();
    for (slot, pair) in out.iter_mut().zip(pairs) {
        let digits = std::str::from_utf8(pair).ok()?;
        *slot = u8::from_str_radix(digits, 16).ok()?;
    }
    Some(out)
}

impl StorageStore {
    pub fn hash_cache_get(
        &self,
        key: &FileIdentityKey,
        stamp: &SourceStamp,
    ) -> Option<[u8; 32]> {
        let cache_key = hash_cache_key(key, stamp);
        let text: Option<String> = self
            .conn
            .query_row(
                "SELECT full_hash FROM duplicate_hashes
                 WHERE key_text = ?1 AND modified_ticks = ?2 AND size_bytes = ?3",
                params![cache_key, stamp.modified_ticks, i64_of(stamp.size_bytes).ok()?],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        text.and_then(|value| parse_hash(&value))
    }

    pub fn hash_cache_put(
        &mut self,
        key: &FileIdentityKey,
        stamp: &SourceStamp,
        hash: &[u8; 32],
        now_unix: u64,
    ) {
        let cache_key = hash_cache_key(key, stamp);
        let text = hash.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let _ = self.conn.execute(
            "INSERT INTO duplicate_hashes
               (key_text, modified_ticks, size_bytes, full_hash, used_unix)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(key_text) DO UPDATE SET
               modified_ticks = excluded.modified_ticks,
               size_bytes = excluded.size_bytes,
               full_hash = excluded.full_hash,
               used_unix = excluded.used_unix",
            params![
                cache_key,
                stamp.modified_ticks,
                i64_of(stamp.size_bytes).unwrap_or(0),
                text,
                i64_of(now_unix).unwrap_or(0)
            ],
        );
        let _ = self.hash_cache_trim(now_unix);
    }

    pub fn hash_cache_trim(&mut self, now_unix: u64) -> Result<(), String> {
        let age_cutoff = now_unix.saturating_sub(MAX_SCAN_AGE_SECS);
        let _ = self.conn.execute(
            "DELETE FROM duplicate_hashes WHERE used_unix < ?1",
            params![i64_of(age_cutoff)?],
        );
        let mut guard = 0;
        while self.hash_cache_bytes()? > HASH_CACHE_LIMIT_BYTES && guard < 128 {
            guard += 1;
            let oldest: Option<String> = self
                .conn
                .query_row(
                    "SELECT key_text FROM duplicate_hashes
                     ORDER BY used_unix ASC, key_text ASC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| "storage.failed".to_string())?;
            let Some(oldest) = oldest else {
                break;
            };
            self.conn
                .execute(
                    "DELETE FROM duplicate_hashes WHERE key_text = ?1",
                    params![oldest],
                )
                .map_err(|_| "storage.failed".to_string())?;
        }
        Ok(())
    }

    pub fn hash_cache_bytes(&self) -> Result<u64, String> {
        let bytes: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(length(key_text) + length(full_hash) + 32), 0)
                 FROM duplicate_hashes",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "storage.failed".to_string())?;
        Ok(u64::try_from(bytes).unwrap_or(0))
    }
}

impl crate::duplicate_hash::DuplicateHashCache for StorageStore {
    fn get(&self, key: &FileIdentityKey, stamp: &SourceStamp) -> Option<[u8; 32]> {
        self.hash_cache_get(key, stamp)
    }

    fn put(&mut self, key: &FileIdentityKey, stamp: &SourceStamp, hash: &[u8; 32]) {
        self.hash_cache_put(key, stamp, hash, now_unix());
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

fn i64_of(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "storage.invalid".to_string())
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix))
}

fn file_bytes(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Deterministic canonical file-type groups (at most 32). This is display
/// grouping only; it never changes a file's name or type.
pub fn canonical_type_group(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "ico" | "heic"
        | "avif" | "raw" => "images",
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "m4v" => "videos",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "wma" => "audio",
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "markdown" => "documents",
        "xls" | "xlsx" | "ods" | "csv" | "tsv" => "spreadsheets",
        "ppt" | "pptx" | "odp" => "presentations",
        "zip" | "7z" | "rar" | "tar" | "gz" | "xz" | "bz2" | "zst" => "archives",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "c" | "h" | "cpp" | "cs" | "go" | "java"
        | "json" | "xml" | "html" | "css" => "code",
        _ => "other",
    }
}


