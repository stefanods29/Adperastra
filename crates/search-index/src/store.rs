//! SQLite schema 1 for the local search index. One writer connection and one
//! read-only connection per store; every value is bound, no caller SQL is
//! accepted and every growing operation is checked against the record and
//! physical-size budgets.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use fs_service::{CancellationToken, ItemKind, SortDirection, SortKey};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension, Transaction};

use crate::filter;
use crate::limits::{
    is_safe_u64, path_key, physical_bytes, COMMIT_BATCH_RECORDS, FIRST_PAGE, MAX_INDEX_RECORDS,
    MAX_QUERY_BYTES, MAX_TAG_UPDATES, PAGE_MAX_BYTES, PAGE_SIZE, REGEX_FIRST_BUDGET,
    WAL_LIMIT_BYTES,
};
use crate::paging::CursorData;
use crate::query::{self, prepare_name_query};
use crate::regex_scan;
use crate::types::{
    DateField, ExplorerItem, ExtractedText, ExtractionCoverage, IndexRoot, IndexStatus,
    ScannedFile, SearchCoverage, SearchMode, SearchPage, SearchQuery, SearchResult,
    TagSearchUpdate,
};
use crate::{SearchError, SearchOutcome as Result};

const FILE_COLUMNS: &str = "f.key, f.volume_id, f.file_id, f.path_key, f.path, f.name, \
     f.normalized_name, f.ext, f.kind, f.size, f.modified_unix, f.created_unix, \
     f.date_taken_unix, f.width, f.height, f.duration_ms, f.pages, f.author, f.hidden, \
     f.system, f.is_link, f.online_only, f.file_id_stable, f.content_state, \
     f.content_truncated, f.metadata_available";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BatchReport {
    pub inserted: u64,
    pub updated: u64,
    pub unchanged: u64,
    pub limit_reached: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct FileRow {
    key: String,
    volume_id: String,
    file_id: String,
    path_key: String,
    path: String,
    name: String,
    normalized_name: String,
    ext: String,
    kind: String,
    size: u64,
    modified_unix: u64,
    created_unix: u64,
    date_taken_unix: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u64>,
    pages: Option<u32>,
    author: Option<String>,
    hidden: bool,
    system: bool,
    is_link: bool,
    online_only: bool,
    file_id_stable: bool,
    content_state: String,
    content_truncated: bool,
    metadata_available: bool,
    matched_text: Option<String>,
}

struct PageRows {
    rows: Vec<FileRow>,
    /// Source position after each row, so a page trimmed to the serialized
    /// byte cap still resumes after the last row it actually returned.
    resume: Vec<usize>,
    total_estimate: u64,
    total_bytes: u64,
    total_exact: bool,
    has_more: bool,
    next_offset: Option<usize>,
}

pub struct SearchStore {
    write: Connection,
    read: Connection,
    db_path: PathBuf,
    limit_bytes: u64,
    max_records: u64,
}

impl SearchStore {
    pub fn open(db_path: &Path, limit_bytes: u64) -> Result<Self> {
        Self::open_with_caps(db_path, limit_bytes, MAX_INDEX_RECORDS)
    }

    pub fn open_with_caps(db_path: &Path, limit_bytes: u64, max_records: u64) -> Result<Self> {
        if max_records == 0 {
            return Err(SearchError::Invalid);
        }
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| SearchError::Unavailable)?;
        }
        let write = Connection::open(db_path).map_err(map_db_error)?;
        write
            .busy_timeout(Duration::from_secs(5))
            .map_err(map_db_error)?;
        write
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(map_db_error)?;
        write
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(map_db_error)?;
        write
            .pragma_update(None, "trusted_schema", false)
            .map_err(map_db_error)?;
        write
            .pragma_update(None, "journal_size_limit", WAL_LIMIT_BYTES as i64)
            .map_err(map_db_error)?;
        write.execute_batch(SCHEMA).map_err(map_db_error)?;
        for (key, value) in [
            ("schema_version", "1"),
            ("generation", "1"),
            ("running", "0"),
            ("paused", "0"),
            ("limit_reached", "0"),
            ("skipped_count", "0"),
            ("reason", ""),
        ] {
            write
                .execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)",
                    params![key, value],
                )
                .map_err(map_db_error)?;
        }
        let was_running: String = write
            .query_row("SELECT value FROM meta WHERE key = 'running'", [], |row| {
                row.get(0)
            })
            .map_err(map_db_error)?;
        write
            .execute("UPDATE meta SET value = '0' WHERE key = 'running'", [])
            .map_err(map_db_error)?;
        if was_running == "1" {
            // A previous process stopped mid-rebuild. The index is usable but
            // not complete; keep that state instead of overclaiming coverage.
            write
                .execute(
                    "UPDATE meta SET value = 'cancelled'
                     WHERE key = 'reason' AND value = ''",
                    [],
                )
                .map_err(map_db_error)?;
        }

        let read = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(map_db_error)?;
        read.busy_timeout(Duration::from_secs(5))
            .map_err(map_db_error)?;
        read.pragma_update(None, "query_only", true)
            .map_err(map_db_error)?;
        read.pragma_update(None, "trusted_schema", false)
            .map_err(map_db_error)?;
        let mut store = Self {
            write,
            read,
            db_path: db_path.to_path_buf(),
            limit_bytes,
            max_records,
        };
        store.enforce_budget()?;
        Ok(store)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// The physical budget this store was opened with.
    pub fn limit_bytes(&self) -> u64 {
        self.limit_bytes
    }

    pub fn generation(&self) -> Result<u64> {
        self.meta_u64("generation")
    }

    pub fn status(&self) -> Result<IndexStatus> {
        let files_count: i64 = self
            .read
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .map_err(map_db_error)?;
        let active_roots: i64 = self
            .read
            .query_row(
                "SELECT COUNT(*) FROM roots WHERE enabled = 1 AND filename = 1",
                [],
                |row| row.get(0),
            )
            .map_err(map_db_error)?;
        let generation = self.generation()?;
        let running = self.meta_bool("running")?;
        let paused = self.meta_bool("paused")?;
        let limit_reached = self.meta_bool("limit_reached")?;
        let skipped_count = self.meta_u64("skipped_count")?.min(u32::MAX as u64) as u32;
        let reason = self.meta_string("reason")?;
        let coverage = if running
            || paused
            || limit_reached
            || skipped_count > 0
            || !reason.is_empty()
            // A configured root with no indexed rows has not been covered
            // yet; claiming complete would overstate an unfinished index.
            || (files_count == 0 && active_roots > 0)
        {
            // A cancelled or failed rebuild and a stopped index are partial.
            // Only a clean, finished pass may claim complete coverage.
            SearchCoverage::Partial
        } else {
            SearchCoverage::Complete
        };
        Ok(IndexStatus {
            generation,
            files_count: files_count.min(u32::MAX as i64) as u32,
            disk_bytes: physical_bytes(&self.db_path),
            running,
            paused,
            coverage,
            skipped_count,
            limit_reached,
            reason_code: if reason.is_empty() {
                None
            } else {
                Some(reason)
            },
        })
    }

    pub fn file_count(&self) -> Result<u64> {
        self.read
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
            .map(|count| count.max(0) as u64)
            .map_err(map_db_error)
    }

    pub fn root_member_count(&self, key: &str) -> Result<u64> {
        self.read
            .query_row(
                "SELECT COUNT(*) FROM root_members WHERE file_key = ?1",
                params![key],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count.max(0) as u64)
            .map_err(map_db_error)
    }

    pub fn content_state(&self, path: &str) -> Result<String> {
        self.read
            .query_row(
                "SELECT content_state FROM files WHERE path_key = ?1",
                params![path_key(path)],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db_error)?
            .ok_or(SearchError::Changed)
    }

    pub fn begin_rebuild(&mut self) -> Result<()> {
        let tx = self.write.transaction().map_err(map_db_error)?;
        set_meta_tx(&tx, "running", "1")?;
        set_meta_tx(&tx, "paused", "0")?;
        set_meta_tx(&tx, "limit_reached", "0")?;
        set_meta_tx(&tx, "skipped_count", "0")?;
        set_meta_tx(&tx, "reason", "")?;
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    pub fn finish_rebuild(&mut self, skipped: u32, cancelled: bool) -> Result<()> {
        let tx = self.write.transaction().map_err(map_db_error)?;
        set_meta_tx(&tx, "running", "0")?;
        set_meta_tx(&tx, "skipped_count", &skipped.to_string())?;
        if cancelled {
            set_meta_tx(&tx, "reason", "cancelled")?;
        }
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<()> {
        self.set_meta("paused", if paused { "1" } else { "0" })
    }

    pub fn set_skipped(&mut self, skipped: u32) -> Result<()> {
        self.set_meta("skipped_count", &skipped.to_string())
    }

    pub fn set_reason(&mut self, reason: &str) -> Result<()> {
        self.set_meta("reason", reason)
    }

    pub fn set_limit_reached(&mut self, reached: bool, reason: &str) -> Result<()> {
        self.set_meta("limit_reached", if reached { "1" } else { "0" })?;
        self.set_meta("reason", if reached { reason } else { "" })
    }

    pub fn set_roots(&mut self, roots: &[IndexRoot]) -> Result<()> {
        if roots.len() > crate::limits::MAX_ROOTS {
            return Err(SearchError::Invalid);
        }
        // Identical or overlapping roots are allowed: a file row is stored
        // once and membership is many-to-many, so removing one root keeps the
        // file visible through the other.
        for root in roots {
            root.validate()?;
        }
        let keep: HashSet<String> = roots.iter().map(|root| root.id.clone()).collect();
        let tx = self.write.transaction().map_err(map_db_error)?;
        let mut existing = Vec::new();
        {
            let mut statement = tx.prepare("SELECT id FROM roots").map_err(map_db_error)?;
            let mut rows = statement.query([]).map_err(map_db_error)?;
            while let Some(row) = rows.next().map_err(map_db_error)? {
                existing.push(row.get::<_, String>(0).map_err(map_db_error)?);
            }
        }
        for id in existing {
            if keep.contains(&id) {
                continue;
            }
            tx.execute("DELETE FROM root_members WHERE root_id = ?1", params![id])
                .map_err(map_db_error)?;
            tx.execute("DELETE FROM roots WHERE id = ?1", params![id])
                .map_err(map_db_error)?;
        }
        for root in roots {
            tx.execute(
                "INSERT INTO roots (id, path, filename, content, ocr, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET path = excluded.path,
                   filename = excluded.filename, content = excluded.content,
                   ocr = excluded.ocr, enabled = excluded.enabled",
                params![
                    root.id,
                    root.path,
                    root.filename as i64,
                    root.content as i64,
                    root.ocr as i64,
                    root.enabled as i64
                ],
            )
            .map_err(map_db_error)?;
        }
        delete_orphans(&tx)?;
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)?;
        self.enforce_budget()
    }

    #[allow(clippy::collapsible_if)]
    pub fn apply_batch(
        &mut self,
        root_id: &str,
        entries: &[(ScannedFile, Option<ExtractedText>)],
    ) -> Result<BatchReport> {
        if entries.len() > COMMIT_BATCH_RECORDS {
            return Err(SearchError::TooLarge);
        }
        crate::types::validate_uuid(root_id)?;
        if self.meta_bool("limit_reached")? {
            return Ok(BatchReport {
                limit_reached: true,
                ..BatchReport::default()
            });
        }
        let tx = self.write.transaction().map_err(map_db_error)?;
        let mut count: u64 = tx
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
            .map_err(map_db_error)?
            .max(0) as u64;
        let mut report = BatchReport::default();
        let mut changed = false;
        for (file, content) in entries {
            // Defence in depth: even a caller that ignored the scanner's
            // online-only check cannot store a placeholder's content.
            let content = if file.online_only {
                None
            } else {
                content.as_ref()
            };
            let key = file_key(file);
            let stored_path = path_key(&file.path_string());
            let existing: Option<(String, String, String, String)> = tx
                .query_row(
                    "SELECT key, modified_ticks, content_state, path_key FROM files
                     WHERE path_key = ?1 OR key = ?2
                     ORDER BY (path_key = ?1) DESC LIMIT 1",
                    params![stored_path, key],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()
                .map_err(map_db_error)?;
            // A moved file whose watcher event could not be paired is found
            // by identity at its old path. Move the row's path key first so
            // the ordinary update below refreshes every column and its FTS
            // row instead of failing the unique key insert.
            let mut moved = false;
            if let Some((existing_key, _, _, existing_path)) = &existing {
                if existing_key == &key && existing_path != &stored_path {
                    tx.execute(
                        "UPDATE files SET path_key = ?2 WHERE key = ?1",
                        params![key, stored_path],
                    )
                    .map_err(map_db_error)?;
                    moved = true;
                }
            }
            let needs_content = content.is_some()
                && existing.as_ref().is_some_and(|(_, _, state, _)| {
                    matches!(state.as_str(), "unsupported" | "pending")
                });
            let needs_removal = content.is_none()
                && existing.as_ref().is_some_and(|(_, _, state, _)| {
                    matches!(state.as_str(), "indexed" | "partial")
                });
            if let Some((existing_key, ticks, _, _)) = &existing {
                if !moved
                    && existing_key == &key
                    && *ticks == file.stamp.modified_ticks
                    && !needs_content
                    && !needs_removal
                {
                    tx.execute(
                        "INSERT OR IGNORE INTO root_members (root_id, file_key) VALUES (?1, ?2)",
                        params![root_id, key],
                    )
                    .map_err(map_db_error)?;
                    report.unchanged += 1;
                    continue;
                }
            } else {
                if count >= self.max_records {
                    report.limit_reached = true;
                    break;
                }
                count += 1;
            }

            let (content_state, truncated) = match content {
                None => ("unsupported".to_string(), false),
                Some(text) => (
                    match text.coverage {
                        ExtractionCoverage::Complete => "indexed",
                        ExtractionCoverage::Partial => "partial",
                        ExtractionCoverage::Unsupported => "unsupported",
                    }
                    .to_string(),
                    text.truncated,
                ),
            };
            let metadata_available =
                file.metadata_available() || content.is_some_and(|text| !text.metadata.is_empty());
            let path = file.path_string();
            let name = file.name.clone();
            let normalized_name = query::normalize_text(&name);
            let ext = file.extension.trim_start_matches('.').to_lowercase();
            let kind = kind_name(file.kind);
            let identity = &file.identity;
            if !is_safe_u64(file.size)
                || !is_safe_u64(file.modified_unix)
                || !is_safe_u64(file.created_unix)
            {
                return Err(SearchError::TooLarge);
            }
            if existing.is_some() {
                tx.execute(
                    "UPDATE files SET volume_id = ?2, file_id = ?3, path = ?4, name = ?5,
                       normalized_name = ?6, ext = ?7, kind = ?8, size = ?9,
                       modified_unix = ?10, created_unix = ?11, date_taken_unix = ?12,
                       width = ?13, height = ?14, duration_ms = ?15, pages = ?16,
                       author = ?17, hidden = ?18, system = ?19, is_link = ?20,
                       online_only = ?21, file_id_stable = ?22, modified_ticks = ?23,
                       content_state = ?24, content_truncated = ?25,
                       metadata_available = ?26
                     WHERE path_key = ?1",
                    params![
                        stored_path,
                        identity.volume_id,
                        identity.file_id,
                        path,
                        name,
                        normalized_name,
                        ext,
                        kind,
                        file.size as i64,
                        file.modified_unix as i64,
                        file.created_unix as i64,
                        file.date_taken_unix.map(|value| value as i64),
                        file.width,
                        file.height,
                        file.duration_ms.map(|value| value as i64),
                        file.pages,
                        file.author,
                        file.hidden as i64,
                        file.system as i64,
                        file.is_link as i64,
                        file.online_only as i64,
                        identity.stable as i64,
                        file.stamp.modified_ticks,
                        content_state,
                        truncated as i64,
                        metadata_available as i64
                    ],
                )
                .map_err(map_db_error)?;
                if let Some((existing_key, _, _, _)) = &existing {
                    if existing_key != &key {
                        // A different file now occupies the same path. Move
                        // memberships/tags to its new identity key and keep
                        // one row; the old key must not survive as a ghost.
                        tx.execute(
                            "UPDATE OR IGNORE root_members SET file_key = ?2 WHERE file_key = ?1",
                            params![existing_key, key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "DELETE FROM root_members WHERE file_key = ?1",
                            params![existing_key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "UPDATE OR IGNORE tag_members SET file_key = ?2 WHERE file_key = ?1",
                            params![existing_key, key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "DELETE FROM tag_members WHERE file_key = ?1",
                            params![existing_key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "UPDATE OR IGNORE tag_revisions SET file_key = ?2 WHERE file_key = ?1",
                            params![existing_key, key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "DELETE FROM tag_revisions WHERE file_key = ?1",
                            params![existing_key],
                        )
                        .map_err(map_db_error)?;
                        tx.execute(
                            "UPDATE files SET key = ?2 WHERE path_key = ?1",
                            params![stored_path, key],
                        )
                        .map_err(map_db_error)?;
                    }
                }
                report.updated += 1;
            } else {
                tx.execute(
                    "INSERT INTO files (key, volume_id, file_id, path_key, path, name,
                       normalized_name, ext, kind, size, modified_unix, created_unix,
                       date_taken_unix, width, height, duration_ms, pages, author, hidden,
                       system, is_link, online_only, file_id_stable, modified_ticks,
                       content_state, content_truncated, metadata_available)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                       ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
                    params![
                        key,
                        identity.volume_id,
                        identity.file_id,
                        stored_path,
                        path,
                        name,
                        normalized_name,
                        ext,
                        kind,
                        file.size as i64,
                        file.modified_unix as i64,
                        file.created_unix as i64,
                        file.date_taken_unix.map(|value| value as i64),
                        file.width,
                        file.height,
                        file.duration_ms.map(|value| value as i64),
                        file.pages,
                        file.author,
                        file.hidden as i64,
                        file.system as i64,
                        file.is_link as i64,
                        file.online_only as i64,
                        identity.stable as i64,
                        file.stamp.modified_ticks,
                        content_state,
                        truncated as i64,
                        metadata_available as i64
                    ],
                )
                .map_err(map_db_error)?;
                report.inserted += 1;
            }
            let file_rowid: i64 = tx
                .query_row("SELECT id FROM files WHERE key = ?1", params![key], |row| {
                    row.get(0)
                })
                .map_err(map_db_error)?;
            tx.execute("DELETE FROM name_fts WHERE rowid = ?1", params![file_rowid])
                .map_err(map_db_error)?;
            tx.execute(
                "INSERT INTO name_fts (rowid, name, normalized_name, file_key)
                 VALUES (?1, ?2, ?3, ?4)",
                params![file_rowid, name, normalized_name, key],
            )
            .map_err(map_db_error)?;
            tx.execute(
                "DELETE FROM content_fts WHERE rowid = ?1",
                params![file_rowid],
            )
            .map_err(map_db_error)?;
            if let Some(text) = content {
                if text.coverage != ExtractionCoverage::Unsupported && !text.text.is_empty() {
                    tx.execute(
                        "INSERT INTO content_fts (rowid, content, file_key) VALUES (?1, ?2, ?3)",
                        params![file_rowid, text.text, key],
                    )
                    .map_err(map_db_error)?;
                }
            }
            tx.execute(
                "INSERT OR IGNORE INTO root_members (root_id, file_key) VALUES (?1, ?2)",
                params![root_id, key],
            )
            .map_err(map_db_error)?;
            changed = true;
        }
        if changed {
            bump_generation_tx(&tx)?;
        }
        tx.commit().map_err(map_db_error)?;
        if report.limit_reached {
            self.set_limit_reached(true, "index_limit")?;
            self.set_paused(true)?;
        }
        self.enforce_budget()?;
        Ok(report)
    }

    pub fn remove_path(&mut self, root_id: &str, path: &str) -> Result<()> {
        let stored_path = path_key(path);
        let tx = self.write.transaction().map_err(map_db_error)?;
        let key: Option<String> = tx
            .query_row(
                "SELECT key FROM files WHERE path_key = ?1",
                params![stored_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db_error)?;
        let Some(key) = key else {
            return Ok(());
        };
        tx.execute(
            "DELETE FROM root_members WHERE root_id = ?1 AND file_key = ?2",
            params![root_id, key],
        )
        .map_err(map_db_error)?;
        let memberships: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM root_members WHERE file_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map_err(map_db_error)?;
        if memberships == 0 {
            delete_file_row(&tx, &key)?;
        }
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    /// Remove a file or a whole removed folder subtree from one root. Files
    /// shared with another root keep their row and lose only this membership.
    pub fn remove_prefix(&mut self, root_id: &str, path: &str) -> Result<()> {
        let prefix = path_key(path);
        let escaped = prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like = if prefix.ends_with('\\') {
            format!("{escaped}%")
        } else {
            format!("{escaped}\\%")
        };
        let tx = self.write.transaction().map_err(map_db_error)?;
        let mut keys = Vec::new();
        {
            let mut statement = tx
                .prepare(
                    "SELECT key FROM files WHERE path_key = ?1 OR path_key LIKE ?2 ESCAPE '\\'",
                )
                .map_err(map_db_error)?;
            let mut rows = statement
                .query(params![prefix, like])
                .map_err(map_db_error)?;
            while let Some(row) = rows.next().map_err(map_db_error)? {
                keys.push(row.get::<_, String>(0).map_err(map_db_error)?);
            }
        }
        for key in keys {
            tx.execute(
                "DELETE FROM root_members WHERE root_id = ?1 AND file_key = ?2",
                params![root_id, key],
            )
            .map_err(map_db_error)?;
            let memberships: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM root_members WHERE file_key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .map_err(map_db_error)?;
            if memberships == 0 {
                delete_file_row(&tx, &key)?;
            }
        }
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    /// A paired rename keeps the identity key and changes only the path and
    /// name. An identity mismatch returns `search.changed` so the caller
    /// rescans the root instead of renaming a different file.
    pub fn rename_path(
        &mut self,
        root_id: &str,
        old_path: &str,
        new_path: &str,
        identity: &FileIdentityKey,
        stamp: &SourceStamp,
    ) -> Result<()> {
        let tx = self.write.transaction().map_err(map_db_error)?;
        // A rename may only move an indexed row inside the root that reported
        // it; another root or an arbitrary path is refused.
        let root_path: String = tx
            .query_row(
                "SELECT path FROM roots WHERE id = ?1",
                params![root_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db_error)?
            .ok_or(SearchError::Denied)?;
        if !crate::limits::path_is_under(old_path, &root_path)
            || !crate::limits::path_is_under(new_path, &root_path)
        {
            return Err(SearchError::Denied);
        }
        let existing: Option<(String, String, String)> = tx
            .query_row(
                "SELECT key, volume_id, file_id FROM files WHERE path_key = ?1",
                params![path_key(old_path)],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(map_db_error)?;
        let Some((key, volume_id, file_id)) = existing else {
            return Err(SearchError::Changed);
        };
        if identity.stable && (volume_id != identity.volume_id || file_id != identity.file_id) {
            return Err(SearchError::Changed);
        }
        let name = Path::new(new_path)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or(SearchError::Invalid)?;
        let normalized = query::normalize_text(&name);
        let ext = Path::new(new_path)
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        tx.execute(
            "UPDATE files SET path = ?2, path_key = ?3, name = ?4, normalized_name = ?5,
               ext = ?6, modified_ticks = ?7 WHERE key = ?1",
            params![
                key,
                new_path,
                path_key(new_path),
                name,
                normalized,
                ext,
                stamp.modified_ticks
            ],
        )
        .map_err(map_db_error)?;
        let file_rowid: i64 = tx
            .query_row("SELECT id FROM files WHERE key = ?1", params![key], |row| {
                row.get(0)
            })
            .map_err(map_db_error)?;
        tx.execute("DELETE FROM name_fts WHERE rowid = ?1", params![file_rowid])
            .map_err(map_db_error)?;
        tx.execute(
            "INSERT INTO name_fts (rowid, name, normalized_name, file_key)
             VALUES (?1, ?2, ?3, ?4)",
            params![file_rowid, name, normalized, key],
        )
        .map_err(map_db_error)?;
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    pub fn apply_tag_updates(&mut self, updates: &[TagSearchUpdate]) -> Result<()> {
        if updates.len() > MAX_TAG_UPDATES {
            return Err(SearchError::TooLarge);
        }
        let tx = self.write.transaction().map_err(map_db_error)?;
        for update in updates {
            update.validate()?;
            let key: Option<String> = tx
                .query_row(
                    "SELECT key FROM files WHERE volume_id = ?1 AND file_id = ?2 AND path_key = ?3",
                    params![
                        update.key.volume_id,
                        update.key.file_id,
                        update.key.path_key
                    ],
                    |row| row.get(0),
                )
                .optional()
                .map_err(map_db_error)?;
            let Some(key) = key else {
                continue;
            };
            let current: Option<i64> = tx
                .query_row(
                    "SELECT revision FROM tag_revisions WHERE file_key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(map_db_error)?;
            if current.is_some_and(|revision| update.revision < revision as u64) {
                continue;
            }
            // Each update is the complete membership for this file, including
            // an empty tombstone. Replace it atomically instead of accumulating
            // tag IDs that the authoritative tag store has already removed.
            tx.execute("DELETE FROM tag_members WHERE file_key = ?1", params![key])
                .map_err(map_db_error)?;
            if !update.deleted {
                for tag_id in &update.tag_ids {
                    tx.execute(
                        "INSERT INTO tag_members (file_key, tag_id, revision)
                         VALUES (?1, ?2, ?3)
                         ON CONFLICT(file_key, tag_id) DO UPDATE SET revision = excluded.revision",
                        params![key, tag_id.to_lowercase(), update.revision as i64],
                    )
                    .map_err(map_db_error)?;
                }
            }
            tx.execute(
                "INSERT INTO tag_revisions (file_key, revision) VALUES (?1, ?2)
                 ON CONFLICT(file_key) DO UPDATE SET revision = excluded.revision",
                params![key, update.revision as i64],
            )
            .map_err(map_db_error)?;
        }
        bump_generation_tx(&tx)?;
        tx.commit().map_err(map_db_error)
    }

    pub fn search(
        &self,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> Result<SearchPage> {
        query.validate()?;
        if limit == 0 || limit > PAGE_SIZE || offset > i64::MAX as usize {
            return Err(SearchError::TooLarge);
        }
        if query.text.len() > MAX_QUERY_BYTES {
            return Err(SearchError::TooLarge);
        }
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(SearchError::Changed);
        }
        let generation = self.generation()?;
        let page = match query.mode {
            SearchMode::Name => self.search_name(query, offset, limit)?,
            SearchMode::Content => self.search_content(query, offset, limit)?,
            SearchMode::Filters => self.search_filters(query, offset, limit)?,
            SearchMode::Regex => self.search_regex(query, offset, limit, deadline, cancel)?,
        };
        let status = self.status()?;
        let mut results = Vec::with_capacity(page.rows.len());
        for row in &page.rows {
            let snippet = match query.mode {
                SearchMode::Content | SearchMode::Regex => row
                    .matched_text
                    .as_deref()
                    .map(|text| query::snippet(text, &query_tokens(&query.text), query.match_case)),
                _ => None,
            };
            results.push(to_result(row, query.mode, snippet)?);
        }
        let mut page_out = SearchPage {
            results,
            next_cursor: None,
            next_offset: page.next_offset,
            generation,
            total_estimate: page.total_estimate.min(u32::MAX as u64) as u32,
            total_bytes: page.total_bytes,
            total_exact: page.total_exact,
            complete: !page.has_more && status.coverage == SearchCoverage::Complete,
            coverage: status.coverage,
            skipped_count: status.skipped_count,
        };
        while serde_json::to_vec(&page_out)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX)
            > PAGE_MAX_BYTES
        {
            // One result larger than the cap cannot fit in any bounded page.
            if page_out.results.len() <= 1 {
                return Err(SearchError::TooLarge);
            }
            page_out.results.pop();
            // Resume after the last row that actually fits. A regex page also
            // consumes rows that did not match, so its resume position is not
            // the number of returned results.
            page_out.next_offset = page.resume.get(page_out.results.len() - 1).copied();
            page_out.complete = false;
        }
        Ok(page_out)
    }

    fn search_name(&self, query: &SearchQuery, offset: usize, limit: usize) -> Result<PageRows> {
        let prepared = prepare_name_query(&query.text);
        let mut values = Vec::new();
        let mut from = "files f";
        let mut parts = Vec::new();
        if prepared.is_empty() {
            parts.push("1=1".to_string());
        } else if prepared.prefix {
            let (low, high) = query::prefix_range(&prepared.normalized[0]);
            parts.push("(f.normalized_name >= ? AND f.normalized_name < ?)".to_string());
            values.push(Value::Text(low));
            values.push(Value::Text(high));
        } else {
            // The trigram index only contains three-character sequences; a
            // short token is verified by the literal condition below.
            let candidates: Vec<String> = prepared
                .normalized
                .iter()
                .filter(|token| token.chars().count() >= 3)
                .cloned()
                .collect();
            let expression = query::fts_and_expression(&candidates);
            if !expression.is_empty() {
                from = "files f JOIN name_fts ON name_fts.rowid = f.id";
                parts.push("name_fts MATCH ?".to_string());
                values.push(Value::Text(expression));
            }
            for token in &prepared.normalized {
                let (condition, value) = name_token_condition(token);
                parts.push(condition.to_string());
                values.push(Value::Text(value));
            }
        }
        if let Some(filter) = &query.filter {
            let built = filter::build(filter)?;
            parts.push(built.clause);
            values.extend(built.values);
        }
        let order = if prepared.is_empty() {
            SortOrder::ModifiedDesc
        } else {
            SortOrder::from_query(query)
        };
        self.page_with(from, parts, values, query, offset, limit, false, order)
    }

    fn search_content(&self, query: &SearchQuery, offset: usize, limit: usize) -> Result<PageRows> {
        let prepared = prepare_name_query(&query.text);
        if prepared.is_empty() {
            return self.search_name(query, offset, limit);
        }
        let mut values = Vec::new();
        let mut parts = vec!["1=1".to_string()];
        let from = "files f JOIN content_fts ON content_fts.rowid = f.id";
        let expression = query::fts_and_expression(&prepared.normalized);
        let has_match = !expression.is_empty();
        if !has_match {
            for token in &prepared.raw {
                parts.push("instr(content_fts.content, ?) > 0".to_string());
                values.push(Value::Text(token.clone()));
            }
        } else {
            parts.push("content_fts MATCH ?".to_string());
            values.push(Value::Text(expression));
            if query.match_case {
                for token in &prepared.raw {
                    parts.push("instr(content_fts.content, ?) > 0".to_string());
                    values.push(Value::Text(token.clone()));
                }
            }
        }
        if let Some(filter) = &query.filter {
            let built = filter::build(filter)?;
            parts.push(built.clause);
            values.extend(built.values);
        }
        let order = if has_match
            && query.sort.key == SortKey::Name
            && query.sort.direction == SortDirection::Ascending
        {
            SortOrder::Bm25
        } else {
            SortOrder::from_query(query)
        };
        self.page_with(from, parts, values, query, offset, limit, true, order)
    }

    fn search_filters(&self, query: &SearchQuery, offset: usize, limit: usize) -> Result<PageRows> {
        let mut values = Vec::new();
        let mut parts = Vec::new();
        if let Some(filter) = &query.filter {
            let built = filter::build(filter)?;
            parts.push(built.clause);
            values.extend(built.values);
        } else {
            parts.push("1=1".to_string());
        }
        if !query.text.trim().is_empty() {
            let prepared = prepare_name_query(&query.text);
            for token in &prepared.normalized {
                let (condition, value) = name_token_condition(token);
                parts.push(condition.to_string());
                values.push(Value::Text(value));
            }
        }
        let order = if query.filter.is_none() && query.text.trim().is_empty() {
            SortOrder::ModifiedDesc
        } else {
            SortOrder::from_query(query)
        };
        self.page_with("files f", parts, values, query, offset, limit, false, order)
    }

    fn search_regex(
        &self,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> Result<PageRows> {
        let regex = regex_scan::compile(&query.text, query.match_case)?;
        let mut values = Vec::new();
        let mut parts = Vec::new();
        if let Some(filter) = &query.filter {
            let built = filter::build(filter)?;
            parts.push(built.clause);
            values.extend(built.values);
        } else {
            parts.push("1=1".to_string());
        }
        let scope = scope_clause(query, &mut values);
        parts.push(scope);
        let from = if query.regex_scope == crate::types::RegexScope::Content {
            "files f JOIN content_fts ON content_fts.rowid = f.id"
        } else {
            "files f"
        };
        let where_sql = parts.join(" AND ");
        let with_content = query.regex_scope == crate::types::RegexScope::Content;
        let content_column = if with_content {
            ", content_fts.content"
        } else {
            ""
        };
        let sql = format!(
            "SELECT {FILE_COLUMNS}{content_column} FROM {from} WHERE {where_sql}
             ORDER BY f.path_key ASC LIMIT -1 OFFSET ?"
        );
        // Even the scan position is bound; no query text carries a value.
        values.push(Value::Integer(offset as i64));
        let mut statement = self.read.prepare(&sql).map_err(map_db_error)?;
        let mut rows = statement
            .query(params_from_iter(values.iter()))
            .map_err(map_db_error)?;
        let mut found = Vec::new();
        let mut resume = Vec::new();
        let mut scanned = 0usize;
        let mut stopped = false;
        while let Some(row) = rows.next().map_err(map_db_error)? {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(SearchError::Changed);
            }
            if Instant::now() >= deadline {
                stopped = true;
                break;
            }
            scanned += 1;
            let mut file = row_to_file(row, with_content)?;
            let text = if with_content {
                file.matched_text.clone()
            } else {
                Some(file.name.clone())
            };
            if let Some(text) = text {
                if regex_scan::matches(&regex, &text) {
                    if query.regex_scope == crate::types::RegexScope::Content {
                        file.matched_text = Some(text);
                    }
                    found.push(file);
                    resume.push(offset + scanned);
                    if found.len() >= limit {
                        break;
                    }
                }
            }
        }
        let has_more = stopped || found.len() >= limit;
        Ok(PageRows {
            total_estimate: (offset + scanned) as u64,
            total_bytes: found.iter().map(|file| file.size).sum(),
            total_exact: false,
            has_more,
            next_offset: if has_more {
                Some(offset + scanned.max(1))
            } else {
                None
            },
            resume,
            rows: found,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn page_with(
        &self,
        from: &str,
        mut parts: Vec<String>,
        mut values: Vec<Value>,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        with_content: bool,
        order: SortOrder,
    ) -> Result<PageRows> {
        let scope = scope_clause(query, &mut values);
        parts.push(scope);
        let where_sql = parts.join(" AND ");
        let count_sql =
            format!("SELECT COUNT(*), COALESCE(SUM(f.size), 0) FROM {from} WHERE {where_sql}");
        let (total, total_bytes): (i64, i64) = self
            .read
            .query_row(&count_sql, params_from_iter(values.iter()), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_db_error)?;
        let content_column = if with_content {
            ", content_fts.content"
        } else {
            ""
        };
        let sql = format!(
            "SELECT {FILE_COLUMNS}{content_column} FROM {from} WHERE {where_sql}
             ORDER BY {} LIMIT ? OFFSET ?",
            order.sql()
        );
        let mut page_values = values;
        page_values.push(Value::Integer(limit as i64));
        page_values.push(Value::Integer(offset as i64));
        let mut statement = self.read.prepare(&sql).map_err(map_db_error)?;
        let mut rows = statement
            .query(params_from_iter(page_values.iter()))
            .map_err(map_db_error)?;
        let mut files = Vec::new();
        let mut resume = Vec::new();
        while let Some(row) = rows.next().map_err(map_db_error)? {
            files.push(row_to_file(row, with_content)?);
            resume.push(offset + files.len());
        }
        let has_more = files.len() >= limit;
        let next_offset = if has_more {
            Some(offset + files.len())
        } else {
            None
        };
        Ok(PageRows {
            rows: files,
            resume,
            total_estimate: total.max(0) as u64,
            total_bytes: total_bytes.max(0) as u64,
            total_exact: true,
            has_more,
            next_offset,
        })
    }

    pub fn first_page_size(&self) -> usize {
        FIRST_PAGE
    }

    fn enforce_budget(&mut self) -> Result<()> {
        if wal_bytes(&self.db_path) > WAL_LIMIT_BYTES {
            let _ = self
                .write
                .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |_| Ok(()));
        }
        if physical_bytes(&self.db_path) > self.limit_bytes {
            self.set_limit_reached(true, "index_limit")?;
            self.set_paused(true)?;
        }
        Ok(())
    }

    fn meta_u64(&self, key: &str) -> Result<u64> {
        let value = self.meta_string(key)?;
        value.parse::<u64>().map_err(|_| SearchError::Unavailable)
    }

    fn meta_bool(&self, key: &str) -> Result<bool> {
        Ok(self.meta_u64(key)? != 0)
    }

    fn meta_string(&self, key: &str) -> Result<String> {
        self.read
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db_error)?
            .ok_or(SearchError::Unavailable)
    }

    fn set_meta(&mut self, key: &str, value: &str) -> Result<()> {
        self.write
            .execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(map_db_error)?;
        Ok(())
    }
}

fn wal_bytes(db_path: &Path) -> u64 {
    let mut name = db_path.as_os_str().to_os_string();
    name.push("-wal");
    std::fs::metadata(PathBuf::from(name))
        .map(|meta| meta.len())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy)]
enum SortOrder {
    NameAsc,
    NameDesc,
    ModifiedAsc,
    ModifiedDesc,
    CreatedAsc,
    CreatedDesc,
    DateTakenAsc,
    DateTakenDesc,
    SizeAsc,
    SizeDesc,
    KindAsc,
    KindDesc,
    Bm25,
}

impl SortOrder {
    fn from_query(query: &SearchQuery) -> Self {
        if let Some(field) = query.sort_date {
            return match (field, query.sort.direction) {
                (DateField::Modified, SortDirection::Ascending) => SortOrder::ModifiedAsc,
                (DateField::Modified, SortDirection::Descending) => SortOrder::ModifiedDesc,
                (DateField::Created, SortDirection::Ascending) => SortOrder::CreatedAsc,
                (DateField::Created, SortDirection::Descending) => SortOrder::CreatedDesc,
                (DateField::DateTaken, SortDirection::Ascending) => SortOrder::DateTakenAsc,
                (DateField::DateTaken, SortDirection::Descending) => SortOrder::DateTakenDesc,
            };
        }
        match (query.sort.key, query.sort.direction) {
            (SortKey::Name, SortDirection::Ascending) => SortOrder::NameAsc,
            (SortKey::Name, SortDirection::Descending) => SortOrder::NameDesc,
            (SortKey::Modified, SortDirection::Ascending) => SortOrder::ModifiedAsc,
            (SortKey::Modified, SortDirection::Descending) => SortOrder::ModifiedDesc,
            (SortKey::Size, SortDirection::Ascending) => SortOrder::SizeAsc,
            (SortKey::Size, SortDirection::Descending) => SortOrder::SizeDesc,
            (SortKey::Kind, SortDirection::Ascending) => SortOrder::KindAsc,
            (SortKey::Kind, SortDirection::Descending) => SortOrder::KindDesc,
        }
    }

    fn sql(self) -> &'static str {
        match self {
            SortOrder::NameAsc => "f.normalized_name ASC, f.path_key ASC",
            SortOrder::NameDesc => "f.normalized_name DESC, f.path_key ASC",
            SortOrder::ModifiedAsc => "f.modified_unix ASC, f.path_key ASC",
            SortOrder::ModifiedDesc => "f.modified_unix DESC, f.path_key ASC",
            SortOrder::CreatedAsc => "f.created_unix ASC, f.path_key ASC",
            SortOrder::CreatedDesc => "f.created_unix DESC, f.path_key ASC",
            SortOrder::DateTakenAsc => "f.date_taken_unix ASC, f.path_key ASC",
            SortOrder::DateTakenDesc => "f.date_taken_unix DESC, f.path_key ASC",
            SortOrder::SizeAsc => "f.size ASC, f.path_key ASC",
            SortOrder::SizeDesc => "f.size DESC, f.path_key ASC",
            SortOrder::KindAsc => "f.kind ASC, f.normalized_name ASC, f.path_key ASC",
            SortOrder::KindDesc => "f.kind DESC, f.normalized_name ASC, f.path_key ASC",
            SortOrder::Bm25 => "bm25(content_fts) ASC, f.path_key ASC",
        }
    }
}

fn scope_clause(query: &SearchQuery, values: &mut Vec<Value>) -> String {
    if query.roots.is_empty() {
        return "EXISTS (SELECT 1 FROM root_members m JOIN roots r ON r.id = m.root_id
                 WHERE m.file_key = f.key AND r.enabled = 1)"
            .to_string();
    }
    let placeholders = vec!["?"; query.roots.len()].join(",");
    for root in &query.roots {
        values.push(Value::Text(root.clone()));
    }
    format!(
        "EXISTS (SELECT 1 FROM root_members m JOIN roots r ON r.id = m.root_id
         WHERE m.file_key = f.key AND r.enabled = 1 AND m.root_id IN ({placeholders}))"
    )
}

fn query_tokens(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

/// A long token is a literal substring. A one/two-character token inside a
/// longer query must start a word, so the two-letter `or` in `report OR`
/// does not match the letters inside `report`.
fn name_token_condition(token: &str) -> (&'static str, String) {
    if token.chars().count() >= 3 {
        ("instr(f.normalized_name, ?) > 0", token.to_string())
    } else {
        (
            "instr(' ' || replace(replace(replace(f.normalized_name, '.', ' '), '-', ' '), '_', ' ') || ' ', ?) > 0",
            format!(" {token}"),
        )
    }
}

fn file_key(file: &ScannedFile) -> String {
    if file.identity.stable {
        format!("{}:{}", file.identity.volume_id, file.identity.file_id)
    } else {
        format!("path:{}", path_key(&file.path_string()))
    }
}

fn kind_name(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Folder => "folder",
        ItemKind::File => "file",
        ItemKind::Drive => "drive",
        ItemKind::Other => "other",
    }
}

fn parse_kind(value: &str) -> ItemKind {
    match value {
        "folder" => ItemKind::Folder,
        "drive" => ItemKind::Drive,
        "other" => ItemKind::Other,
        _ => ItemKind::File,
    }
}

fn row_to_file(row: &rusqlite::Row<'_>, with_content: bool) -> Result<FileRow> {
    let matched_text: Option<String> = if with_content {
        row.get(26).map_err(map_db_error)?
    } else {
        None
    };
    Ok(FileRow {
        key: row.get(0).map_err(map_db_error)?,
        volume_id: row.get(1).map_err(map_db_error)?,
        file_id: row.get(2).map_err(map_db_error)?,
        path_key: row.get(3).map_err(map_db_error)?,
        path: row.get(4).map_err(map_db_error)?,
        name: row.get(5).map_err(map_db_error)?,
        normalized_name: row.get(6).map_err(map_db_error)?,
        ext: row.get(7).map_err(map_db_error)?,
        kind: row.get(8).map_err(map_db_error)?,
        size: row.get::<_, i64>(9).map_err(map_db_error)?.max(0) as u64,
        modified_unix: row.get::<_, i64>(10).map_err(map_db_error)?.max(0) as u64,
        created_unix: row.get::<_, i64>(11).map_err(map_db_error)?.max(0) as u64,
        date_taken_unix: row
            .get::<_, Option<i64>>(12)
            .map_err(map_db_error)?
            .map(|value| value.max(0) as u64),
        width: row.get(13).map_err(map_db_error)?,
        height: row.get(14).map_err(map_db_error)?,
        duration_ms: row
            .get::<_, Option<i64>>(15)
            .map_err(map_db_error)?
            .map(|value| value.max(0) as u64),
        pages: row.get(16).map_err(map_db_error)?,
        author: row.get(17).map_err(map_db_error)?,
        hidden: row.get::<_, i64>(18).map_err(map_db_error)? != 0,
        system: row.get::<_, i64>(19).map_err(map_db_error)? != 0,
        is_link: row.get::<_, i64>(20).map_err(map_db_error)? != 0,
        online_only: row.get::<_, i64>(21).map_err(map_db_error)? != 0,
        file_id_stable: row.get::<_, i64>(22).map_err(map_db_error)? != 0,
        content_state: row.get(23).map_err(map_db_error)?,
        content_truncated: row.get::<_, i64>(24).map_err(map_db_error)? != 0,
        metadata_available: row.get::<_, i64>(25).map_err(map_db_error)? != 0,
        matched_text,
    })
}

fn to_result(row: &FileRow, found_by: SearchMode, snippet: Option<String>) -> Result<SearchResult> {
    let file_id = if row.file_id_stable {
        u64::from_str_radix(&row.file_id, 16)
            .ok()
            .map(|value| value.to_string())
    } else {
        None
    };
    Ok(SearchResult {
        item: ExplorerItem {
            path: row.path.clone(),
            name: row.name.clone(),
            kind: parse_kind(&row.kind),
            size: row.size,
            modified_unix: row.modified_unix,
            hidden: row.hidden,
            system: row.system,
            is_link: row.is_link,
            online_only: row.online_only,
            file_id,
            file_id_stable: row.file_id_stable,
        },
        key: FileIdentityKey {
            volume_id: row.volume_id.clone(),
            file_id: row.file_id.clone(),
            path_key: row.path_key.clone(),
            stable: row.file_id_stable,
        },
        found_by,
        snippet,
        content_truncated: row.content_truncated,
        metadata_available: row.metadata_available,
        created_unix: row.created_unix,
        date_taken_unix: row.date_taken_unix,
    })
}

fn delete_orphans(tx: &Transaction<'_>) -> Result<()> {
    let mut statement = tx
        .prepare(
            "SELECT key FROM files
             WHERE NOT EXISTS (SELECT 1 FROM root_members m WHERE m.file_key = files.key)",
        )
        .map_err(map_db_error)?;
    let mut rows = statement.query([]).map_err(map_db_error)?;
    let mut keys = Vec::new();
    while let Some(row) = rows.next().map_err(map_db_error)? {
        keys.push(row.get::<_, String>(0).map_err(map_db_error)?);
    }
    drop(rows);
    drop(statement);
    for key in keys {
        delete_file_row(tx, &key)?;
    }
    Ok(())
}

fn delete_file_row(tx: &Transaction<'_>, key: &str) -> Result<()> {
    let rowid: Option<i64> = tx
        .query_row("SELECT id FROM files WHERE key = ?1", params![key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(map_db_error)?;
    if let Some(rowid) = rowid {
        tx.execute("DELETE FROM name_fts WHERE rowid = ?1", params![rowid])
            .map_err(map_db_error)?;
        tx.execute("DELETE FROM content_fts WHERE rowid = ?1", params![rowid])
            .map_err(map_db_error)?;
    }
    tx.execute("DELETE FROM tag_members WHERE file_key = ?1", params![key])
        .map_err(map_db_error)?;
    tx.execute(
        "DELETE FROM tag_revisions WHERE file_key = ?1",
        params![key],
    )
    .map_err(map_db_error)?;
    tx.execute("DELETE FROM files WHERE key = ?1", params![key])
        .map_err(map_db_error)?;
    Ok(())
}

fn bump_generation_tx(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'generation'",
        [],
    )
    .map_err(map_db_error)?;
    Ok(())
}

fn set_meta_tx(tx: &Transaction<'_>, key: &str, value: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(map_db_error)?;
    Ok(())
}

fn map_db_error(error: rusqlite::Error) -> SearchError {
    match error {
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::DatabaseBusy
                || inner.code == rusqlite::ErrorCode::DatabaseLocked =>
        {
            SearchError::Unavailable
        }
        _ => SearchError::Failed,
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roots (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    filename INTEGER NOT NULL DEFAULT 1,
    content INTEGER NOT NULL DEFAULT 0,
    ocr INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    volume_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    path_key TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_unix INTEGER NOT NULL,
    created_unix INTEGER NOT NULL,
    date_taken_unix INTEGER,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    pages INTEGER,
    author TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    system INTEGER NOT NULL DEFAULT 0,
    is_link INTEGER NOT NULL DEFAULT 0,
    online_only INTEGER NOT NULL DEFAULT 0,
    file_id_stable INTEGER NOT NULL DEFAULT 0,
    modified_ticks TEXT NOT NULL,
    content_state TEXT NOT NULL DEFAULT 'unsupported',
    content_truncated INTEGER NOT NULL DEFAULT 0,
    metadata_available INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_name_prefix ON files(normalized_name);
CREATE INDEX IF NOT EXISTS files_modified ON files(modified_unix);
CREATE INDEX IF NOT EXISTS files_size ON files(size);
CREATE INDEX IF NOT EXISTS files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS files_ext ON files(ext);
CREATE INDEX IF NOT EXISTS files_identity ON files(volume_id, file_id);
CREATE TABLE IF NOT EXISTS root_members (
    root_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    PRIMARY KEY (root_id, file_key)
);
CREATE INDEX IF NOT EXISTS root_members_file ON root_members(file_key);
CREATE TABLE IF NOT EXISTS tag_members (
    file_key TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (file_key, tag_id)
);
CREATE TABLE IF NOT EXISTS tag_revisions (
    file_key TEXT PRIMARY KEY,
    revision INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS name_fts USING fts5(
    name, normalized_name, file_key UNINDEXED, tokenize='trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    content, file_key UNINDEXED, tokenize='unicode61 remove_diacritics 2'
);
"#;

impl SearchStore {
    pub fn default_cursor_limit(offset: usize) -> usize {
        if offset == 0 {
            FIRST_PAGE
        } else {
            PAGE_SIZE
        }
    }

    pub fn query_limit_for_cursor(cursor: Option<&CursorData>) -> usize {
        cursor.map_or(FIRST_PAGE, |_| PAGE_SIZE)
    }

    pub fn regex_budget() -> Instant {
        Instant::now() + REGEX_FIRST_BUDGET
    }
}

#[cfg(test)]
mod tests {
    use crate::limits::MAX_INDEX_RECORDS;

    #[test]
    fn the_documented_record_cap_is_one_million() {
        assert_eq!(MAX_INDEX_RECORDS, 1_000_000);
    }

    #[test]
    fn physical_usage_counts_all_sqlite_files() {
        let directory = tempfile::tempdir().unwrap();
        let db = directory.path().join("index.sqlite3");
        std::fs::write(&db, vec![0u8; 100]).unwrap();
        std::fs::write(format!("{}-wal", db.display()), vec![0u8; 20]).unwrap();
        std::fs::write(format!("{}-shm", db.display()), vec![0u8; 3]).unwrap();
        assert_eq!(crate::limits::physical_bytes(&db), 123);
    }
}
