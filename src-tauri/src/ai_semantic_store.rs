//! Bounded, revisioned semantic storage in the existing search SQLite
//! database (Step 17c D3/D4, schema `semantic 1`).
//!
//! This module owns only the semantic tables. It never writes a user file,
//! never stores extracted text, and never exposes a raw vector to the UI.
#![allow(dead_code)]


use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use fs_service::source_stamp::FileIdentityKey;
use fs_service::CancellationToken;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};

use crate::ai_search_types::{
    AiSearchError, AiSearchResult, AiSemanticRoot, SemanticPage, SemanticQuery, SemanticStatus,
    SemanticVectorKind, SemanticVectorRecord, MAX_EMBEDDING_BYTES, MAX_INDEXED_IMAGES,
    MAX_INDEXED_TEXT_CHUNKS, MAX_SEMANTIC_WORKING_BYTES,
};
use crate::ai_semantic_vectors::{normalized_copy, vector_to_le_bytes};

pub const SEMANTIC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy)]
pub struct SemanticLimits {
    pub text_chunks: u64,
    pub images: u64,
    pub bytes: u64,
    pub working_bytes: u64,
}

impl Default for SemanticLimits {
    fn default() -> Self {
        Self {
            text_chunks: MAX_INDEXED_TEXT_CHUNKS,
            images: MAX_INDEXED_IMAGES,
            bytes: MAX_EMBEDDING_BYTES,
            working_bytes: MAX_SEMANTIC_WORKING_BYTES,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UnindexedFile {
    pub file_key: String,
    pub path: String,
    pub path_key: String,
    pub volume_id: String,
    pub file_id: String,
    pub file_id_stable: bool,
    pub modified_ticks: String,
    pub size_bytes: u64,
    pub online_only: bool,
    pub content_state: String,
}

pub struct SemanticStore {
    conn: Connection,
    db_path: PathBuf,
    limits: SemanticLimits,
}

impl SemanticStore {
    /// Open the shared `<profile>/search/index.sqlite3` database. The 11a
    /// store creates the file tables; the semantic tables migrate in one
    /// transaction and a newer schema is refused rather than downgraded.
    pub fn open_profile(profile_dir: &Path) -> AiSearchResult<Self> {
        Self::open_at(&profile_dir.join("search").join("index.sqlite3"), SemanticLimits::default())
    }

    pub fn open_at(db_path: &Path, limits: SemanticLimits) -> AiSearchResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| AiSearchError::Unavailable)?;
        }
        let conn = Connection::open(db_path).map_err(map_db)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(map_db)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(map_db)?;
        conn.pragma_update(None, "synchronous", "NORMAL").map_err(map_db)?;
        conn.pragma_update(None, "trusted_schema", false).map_err(map_db)?;
        let store = Self {
            conn,
            db_path: db_path.to_path_buf(),
            limits,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> AiSearchResult<()> {
        let tx = self.conn.unchecked_transaction().map_err(map_db)?;
        tx.execute_batch(SCHEMA).map_err(map_db)?;
        let version: Option<String> = tx
            .query_row(
                "SELECT value FROM semantic_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db)?;
        match version.as_deref() {
            None => {
                set_meta_tx(&tx, "schema_version", &SEMANTIC_SCHEMA_VERSION.to_string())?;
                set_meta_tx(&tx, "generation", "1")?;
                set_meta_tx(&tx, "paused", "0")?;
                set_meta_tx(&tx, "reason", "")?;
                set_meta_tx(&tx, "skipped", "0")?;
                set_meta_tx(&tx, "text_model_id", "")?;
                set_meta_tx(&tx, "text_model_revision", "")?;
                set_meta_tx(&tx, "image_model_id", "")?;
                set_meta_tx(&tx, "image_model_revision", "")?;
            }
            Some(value) => {
                let parsed = value.parse::<u32>().map_err(|_| AiSearchError::Unavailable)?;
                if parsed > SEMANTIC_SCHEMA_VERSION || parsed == 0 {
                    return Err(AiSearchError::Unavailable);
                }
            }
        }
        tx.commit().map_err(map_db)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn set_roots(&mut self, roots: &[AiSemanticRoot]) -> AiSearchResult<()> {
        let tx = self.conn.transaction().map_err(map_db)?;
        let keep: HashSet<String> = roots.iter().map(|root| root.root_id.clone()).collect();
        let mut existing = Vec::new();
        {
            let mut statement = tx
                .prepare("SELECT root_id FROM semantic_roots")
                .map_err(map_db)?;
            let mut rows = statement.query([]).map_err(map_db)?;
            while let Some(row) = rows.next().map_err(map_db)? {
                existing.push(row.get::<_, String>(0).map_err(map_db)?);
            }
        }
        for root_id in existing {
            if keep.contains(&root_id) {
                continue;
            }
            tx.execute(
                "DELETE FROM semantic_root_members WHERE root_id = ?1",
                params![root_id],
            )
            .map_err(map_db)?;
            tx.execute("DELETE FROM semantic_roots WHERE root_id = ?1", params![root_id])
                .map_err(map_db)?;
        }
        for root in roots {
            tx.execute(
                "INSERT INTO semantic_roots (root_id, text, photos) VALUES (?1, ?2, ?3)
                 ON CONFLICT(root_id) DO UPDATE SET text = excluded.text, photos = excluded.photos",
                params![root.root_id, root.text as i64, root.photos as i64],
            )
            .map_err(map_db)?;
        }
        delete_orphan_vectors(&tx)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    pub fn remove_root(&mut self, root_id: &str) -> AiSearchResult<()> {
        let tx = self.conn.transaction().map_err(map_db)?;
        tx.execute("DELETE FROM semantic_root_members WHERE root_id = ?1", params![root_id])
            .map_err(map_db)?;
        tx.execute("DELETE FROM semantic_roots WHERE root_id = ?1", params![root_id])
            .map_err(map_db)?;
        delete_orphan_vectors(&tx)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    pub fn set_paused(&mut self, paused: bool, reason: Option<&str>) -> AiSearchResult<()> {
        let tx = self.conn.transaction().map_err(map_db)?;
        set_meta_tx(&tx, "paused", if paused { "1" } else { "0" })?;
        set_meta_tx(&tx, "reason", reason.unwrap_or(""))?;
        tx.commit().map_err(map_db)
    }

    /// Persist how many candidates the last passes could not read, so status
    /// reports real skips instead of always zero.
    pub fn add_skipped(&mut self, count: u32) -> AiSearchResult<()> {
        if count == 0 {
            return Ok(());
        }
        let current = self.meta_u64("skipped").unwrap_or(0);
        let next = current.saturating_add(u64::from(count)).min(u32::MAX as u64);
        let tx = self.conn.transaction().map_err(map_db)?;
        set_meta_tx(&tx, "skipped", &next.to_string())?;
        tx.commit().map_err(map_db)
    }

    pub fn promote_model(
        &mut self,
        kind: SemanticVectorKind,
        model_id: &str,
        model_revision: &str,
    ) -> AiSearchResult<()> {
        if model_id.is_empty() || model_id.len() > 96 || model_revision.is_empty() || model_revision.len() > 64 {
            return Err(AiSearchError::Invalid);
        }
        let (id_key, revision_key) = model_keys(kind);
        let current = self.current_model(kind)?;
        if current.as_ref() == Some(&(model_id.to_string(), model_revision.to_string())) {
            return Ok(());
        }
        let tx = self.conn.transaction().map_err(map_db)?;
        let mut files = Vec::new();
        {
            let mut statement = tx
                .prepare(
                    "SELECT DISTINCT file_key FROM semantic_vectors
                     WHERE kind = ?1 AND (model_id != ?2 OR model_revision != ?3)",
                )
                .map_err(map_db)?;
            let mut rows = statement
                .query(params![kind.as_str(), model_id, model_revision])
                .map_err(map_db)?;
            while let Some(row) = rows.next().map_err(map_db)? {
                files.push(row.get::<_, String>(0).map_err(map_db)?);
            }
        }
        tx.execute(
            "DELETE FROM semantic_vectors WHERE kind = ?1 AND (model_id != ?2 OR model_revision != ?3)",
            params![kind.as_str(), model_id, model_revision],
        )
        .map_err(map_db)?;
        for file_key in files {
            enqueue_recompute_tx(&tx, &file_key, kind, "model_revision")?;
        }
        set_meta_tx(&tx, id_key, model_id)?;
        set_meta_tx(&tx, revision_key, model_revision)?;
        delete_orphan_vectors(&tx)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    pub fn current_model(&self, kind: SemanticVectorKind) -> AiSearchResult<Option<(String, String)>> {
        let (id_key, revision_key) = model_keys(kind);
        let id = self.meta_string(id_key)?;
        let revision = self.meta_string(revision_key)?;
        if id.is_empty() || revision.is_empty() {
            Ok(None)
        } else {
            Ok(Some((id, revision)))
        }
    }

    /// Insert one validated row only when its model is the promoted model.
    /// Quotas are checked inside the same transaction, so the 25,001st image
    /// is refused while the first 25,000 stay valid.
    pub fn insert_vector(&mut self, record: &SemanticVectorRecord) -> AiSearchResult<()> {
        record.validate()?;
        let model = self
            .current_model(record.kind)?
            .ok_or(AiSearchError::Unavailable)?;
        if model != (record.model_id.clone(), record.model_revision.clone()) {
            return Err(AiSearchError::Changed);
        }
        let vector = normalized_copy(&record.vector)?;
        let bytes = vector_to_le_bytes(&vector);
        let tx = self.conn.transaction().map_err(map_db)?;
        let file_key = file_key(&record.identity);
        let existing: Option<i64> = tx
            .query_row(
                "SELECT length(vector) FROM semantic_vectors
                 WHERE file_key = ?1 AND kind = ?2 AND chunk_index = ?3
                   AND model_id = ?4 AND model_revision = ?5",
                params![
                    file_key,
                    record.kind.as_str(),
                    record.chunk_index,
                    record.model_id,
                    record.model_revision
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db)?;
        let text_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM semantic_vectors WHERE kind = 'text'",
                [],
                |row| row.get(0),
            )
            .map_err(map_db)?;
        let image_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM semantic_vectors WHERE kind = 'image'",
                [],
                |row| row.get(0),
            )
            .map_err(map_db)?;
        let used: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(length(vector)), 0) FROM semantic_vectors",
                [],
                |row| row.get(0),
            )
            .map_err(map_db)?;
        let replacing = existing.unwrap_or(0).max(0) as u64;
        let was_text = record.kind == SemanticVectorKind::Text && existing.is_some();
        let was_image = record.kind == SemanticVectorKind::Image && existing.is_some();
        let next_text = text_count.max(0) as u64
            + if record.kind == SemanticVectorKind::Text && !was_text { 1 } else { 0 };
        let next_image = image_count.max(0) as u64
            + if record.kind == SemanticVectorKind::Image && !was_image { 1 } else { 0 };
        if next_text > self.limits.text_chunks || next_image > self.limits.images {
            return Err(AiSearchError::TooLarge);
        }
        let used = used.max(0) as u64 - replacing;
        if used.saturating_add(bytes.len() as u64) > self.limits.bytes {
            return Err(AiSearchError::TooLarge);
        }
        tx.execute(
            "INSERT INTO semantic_vectors
             (file_key, kind, chunk_index, model_id, model_revision, extractor_revision,
              volume_id, file_id, path_key, stable, modified_ticks, size_bytes, dimensions,
              vector, start_scalar, end_scalar, partial)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(file_key, kind, chunk_index, model_id, model_revision) DO UPDATE SET
               extractor_revision = excluded.extractor_revision, volume_id = excluded.volume_id,
               file_id = excluded.file_id, path_key = excluded.path_key, stable = excluded.stable,
               modified_ticks = excluded.modified_ticks, size_bytes = excluded.size_bytes,
               dimensions = excluded.dimensions, vector = excluded.vector,
               start_scalar = excluded.start_scalar, end_scalar = excluded.end_scalar,
               partial = excluded.partial",
            params![
                file_key,
                record.kind.as_str(),
                i64::from(record.chunk_index),
                record.model_id,
                record.model_revision,
                record.extractor_revision,
                record.identity.volume_id,
                record.identity.file_id,
                record.identity.path_key,
                record.identity.stable as i64,
                record.source.modified_ticks,
                record.source.size_bytes as i64,
                i64::from(record.dimensions),
                bytes,
                record.start.map(i64::from),
                record.end.map(i64::from),
                record.partial as i64
            ],
        )
        .map_err(map_db)?;
        for root_id in &record.root_ids {
            tx.execute(
                "INSERT OR IGNORE INTO semantic_root_members (file_key, root_id, kind) VALUES (?1, ?2, ?3)",
                params![file_key, root_id, record.kind.as_str()],
            )
            .map_err(map_db)?;
        }
        // A reindex under a smaller root set must not keep a stale membership.
        let mut obsolete = Vec::new();
        {
            let mut statement = tx
                .prepare("SELECT root_id FROM semantic_root_members WHERE file_key = ?1 AND kind = ?2")
                .map_err(map_db)?;
            let mut rows = statement
                .query(params![file_key, record.kind.as_str()])
                .map_err(map_db)?;
            while let Some(row) = rows.next().map_err(map_db)? {
                let root_id: String = row.get(0).map_err(map_db)?;
                if !record.root_ids.iter().any(|kept| kept == &root_id) {
                    obsolete.push(root_id);
                }
            }
        }
        for root_id in obsolete {
            tx.execute(
                "DELETE FROM semantic_root_members WHERE file_key = ?1 AND root_id = ?2 AND kind = ?3",
                params![file_key, root_id, record.kind.as_str()],
            )
            .map_err(map_db)?;
        }
        tx.execute(
            "DELETE FROM semantic_pending WHERE file_key = ?1 AND kind = ?2",
            params![file_key, record.kind.as_str()],
        )
        .map_err(map_db)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    /// Remove every row for one file/kind before writing a fresh chunk set.
    /// This prevents stale chunks after a file shrinks or changes shape.
    pub fn clear_file_vectors(
        &mut self,
        identity: &FileIdentityKey,
        kind: SemanticVectorKind,
    ) -> AiSearchResult<()> {
        let tx = self.conn.transaction().map_err(map_db)?;
        let file_key = file_key(identity);
        tx.execute(
            "DELETE FROM semantic_vectors WHERE file_key = ?1 AND kind = ?2",
            params![file_key, kind.as_str()],
        )
        .map_err(map_db)?;
        tx.execute(
            "DELETE FROM semantic_root_members WHERE file_key = ?1 AND kind = ?2",
            params![file_key, kind.as_str()],
        )
        .map_err(map_db)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    /// Remove exactly one invalid row and ask the indexer to recompute it.
    pub fn invalidate_vector(
        &mut self,
        identity: &FileIdentityKey,
        kind: SemanticVectorKind,
        chunk_index: u16,
        model_id: &str,
        model_revision: &str,
    ) -> AiSearchResult<()> {
        let tx = self.conn.transaction().map_err(map_db)?;
        let file_key = file_key(identity);
        tx.execute(
            "DELETE FROM semantic_vectors
             WHERE file_key = ?1 AND kind = ?2 AND chunk_index = ?3 AND model_id = ?4 AND model_revision = ?5",
            params![file_key, kind.as_str(), chunk_index, model_id, model_revision],
        )
        .map_err(map_db)?;
        enqueue_recompute_tx(&tx, &file_key, kind, "invalid_vector")?;
        delete_orphan_vectors(&tx)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)
    }

    pub fn pending_count(&self) -> AiSearchResult<u32> {
        self.conn
            .query_row("SELECT COUNT(*) FROM semantic_pending", [], |row| row.get::<_, i64>(0))
            .map(|value| value.max(0) as u32)
            .map_err(map_db)
    }

    pub fn status(&self) -> AiSearchResult<SemanticStatus> {
        let text_chunks = self.count("SELECT COUNT(*) FROM semantic_vectors WHERE kind = 'text'")?;
        let images = self.count("SELECT COUNT(*) FROM semantic_vectors WHERE kind = 'image'")?;
        let bytes = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(length(vector)), 0) FROM semantic_vectors",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value.max(0) as u64)
            .map_err(map_db)?;
        Ok(SemanticStatus {
            generation: self.meta_u64("generation")?,
            text_chunks,
            images,
            bytes,
            pending: self.pending_count()?,
            skipped: self.meta_u64("skipped")?.min(u32::MAX as u64) as u32,
            paused: self.meta_bool("paused")?,
            reason_code: {
                let reason = self.meta_string("reason").unwrap_or_default();
                if reason.is_empty() { None } else { Some(reason) }
            },
        })
    }

    /// Exact dot-product scan over one low-priority worker, checking a cancel
    /// every 256 rows. Ties are deterministic: FileIdentityKey, then chunk.
    pub fn search(
        &self,
        query: &SemanticQuery,
        query_vector: &[f32],
        cancel: &CancellationToken,
    ) -> AiSearchResult<SemanticPage> {
        crate::ai_semantic_scan::search(&self.conn, self.limits, query, query_vector, cancel)
    }

    /// Files that still need an embedding for the current model/extractor,
    /// keyed by persisted identity rather than an ordinal in a folder.
    pub fn unindexed_batch(
        &self,
        root_ids: &[String],
        kind: SemanticVectorKind,
        model_id: &str,
        model_revision: &str,
        extractor_revision: u32,
        limit: usize,
    ) -> AiSearchResult<Vec<UnindexedFile>> {
        if root_ids.is_empty() || root_ids.len() > 32 || limit == 0 || limit > 512 {
            return Err(AiSearchError::Invalid);
        }
        let placeholders = vec!["?"; root_ids.len()].join(",");
        let content_condition = if kind == SemanticVectorKind::Image {
            "f.ext IN ('jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'avif', 'heic', 'heif')"
        } else {
            "f.content_state IN ('indexed', 'partial')"
        };
        let mut values: Vec<Value> = root_ids.iter().map(|id| Value::Text(id.clone())).collect();
        values.push(Value::Text(kind.as_str().to_string()));
        values.push(Value::Text(model_id.to_string()));
        values.push(Value::Text(model_revision.to_string()));
        values.push(Value::Integer(i64::from(extractor_revision)));
        values.push(Value::Integer(limit as i64));
        let sql = format!(
            "SELECT f.key, f.path, f.path_key, f.volume_id, f.file_id, f.file_id_stable,
                    f.modified_ticks, f.size, f.online_only, f.content_state
             FROM files f JOIN root_members m ON m.file_key = f.key
             WHERE m.root_id IN ({placeholders}) AND f.online_only = 0
               AND {content_condition}
               AND NOT EXISTS (SELECT 1 FROM semantic_vectors v
                               WHERE v.file_key = f.key AND v.kind = ? AND v.model_id = ?
                                 AND v.model_revision = ? AND v.extractor_revision = ?
                                 AND v.modified_ticks = f.modified_ticks AND v.size_bytes = f.size)
             GROUP BY f.key LIMIT ?"
        );
        let mut statement = self.conn.prepare(&sql).map_err(map_db)?;
        let mut rows = statement.query(params_from_iter(values)).map_err(map_db)?;
        let mut files = Vec::new();
        while let Some(row) = rows.next().map_err(map_db)? {
            files.push(UnindexedFile {
                file_key: row.get(0).map_err(map_db)?,
                path: row.get(1).map_err(map_db)?,
                path_key: row.get(2).map_err(map_db)?,
                volume_id: row.get(3).map_err(map_db)?,
                file_id: row.get(4).map_err(map_db)?,
                file_id_stable: row.get::<_, i64>(5).map_err(map_db)? != 0,
                modified_ticks: row.get(6).map_err(map_db)?,
                size_bytes: row.get::<_, i64>(7).map_err(map_db)?.max(0) as u64,
                online_only: row.get::<_, i64>(8).map_err(map_db)? != 0,
                content_state: row.get(9).map_err(map_db)?,
            });
        }
        Ok(files)
    }

    /// Remove only semantic data. User files and the 11a file/name tables are
    /// untouched.
    pub fn clear_semantic_data(&mut self, cancel: &CancellationToken) -> AiSearchResult<(u64, u64)> {
        let used = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(length(vector)), 0) FROM semantic_vectors",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value.max(0) as u64)
            .map_err(map_db)?;
        if cancel.load(Ordering::Relaxed) {
            return Err(AiSearchError::Changed);
        }
        let tx = self.conn.transaction().map_err(map_db)?;
        tx.execute("DELETE FROM semantic_vectors", []).map_err(map_db)?;
        tx.execute("DELETE FROM semantic_root_members", []).map_err(map_db)?;
        tx.execute("DELETE FROM semantic_pending", []).map_err(map_db)?;
        bump_generation(&tx)?;
        tx.commit().map_err(map_db)?;
        Ok((used, 0))
    }


    fn count(&self, sql: &str) -> AiSearchResult<u32> {
        self.conn
            .query_row(sql, [], |row| row.get::<_, i64>(0))
            .map(|value| value.max(0) as u32)
            .map_err(map_db)
    }

    fn meta_string(&self, key: &str) -> AiSearchResult<String> {
        self.conn
            .query_row(
                "SELECT value FROM semantic_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_db)?
            .ok_or(AiSearchError::Unavailable)
    }

    fn meta_u64(&self, key: &str) -> AiSearchResult<u64> {
        self.meta_string(key)?
            .parse::<u64>()
            .map_err(|_| AiSearchError::Unavailable)
    }

    fn meta_bool(&self, key: &str) -> AiSearchResult<bool> {
        Ok(self.meta_u64(key)? != 0)
    }

    #[cfg(test)]
    fn seed_file_row(&self, key: &str, path: &str, name: &str) {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO files
                 (key, volume_id, file_id, path_key, path, name, normalized_name, ext, kind, size,
                  modified_unix, created_unix, date_taken_unix, width, height, duration_ms, pages,
                  author, hidden, system, is_link, online_only, file_id_stable, modified_ticks,
                  content_state, content_truncated, metadata_available)
                 VALUES (?1, '00000001', '0000000000000001', ?2, ?2, ?3, ?3, 'txt', 'file', 10,
                         1, 1, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, '133000000000000000', 'indexed', 0, 0)",
                params![key, path, name],
            )
            .unwrap();
    }
}

#[allow(dead_code)]
fn identity_key(key: &FileIdentityKey) -> String {
    format!("{}:{}:{}", key.volume_id, key.file_id, key.path_key)
}

fn model_keys(kind: SemanticVectorKind) -> (&'static str, &'static str) {
    match kind {
        SemanticVectorKind::Text => ("text_model_id", "text_model_revision"),
        SemanticVectorKind::Image => ("image_model_id", "image_model_revision"),
    }
}

/// Persisted identity key shared by vectors, memberships and pending rows.
pub fn file_key(identity: &FileIdentityKey) -> String {
    if identity.stable {
        format!("{}:{}", identity.volume_id, identity.file_id)
    } else {
        format!("path:{}", identity.path_key)
    }
}

fn enqueue_recompute_tx(
    tx: &Transaction<'_>,
    file_key: &str,
    kind: SemanticVectorKind,
    reason: &str,
) -> AiSearchResult<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    tx.execute(
        "INSERT INTO semantic_pending (file_key, kind, reason, requested_unix)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(file_key, kind) DO UPDATE SET reason = excluded.reason,
           requested_unix = excluded.requested_unix",
        params![file_key, kind.as_str(), reason, now as i64],
    )
    .map_err(map_db)?;
    Ok(())
}

fn delete_orphan_vectors(tx: &Transaction<'_>) -> AiSearchResult<()> {
    tx.execute(
        "DELETE FROM semantic_vectors WHERE NOT EXISTS
         (SELECT 1 FROM semantic_root_members m
          WHERE m.file_key = semantic_vectors.file_key AND m.kind = semantic_vectors.kind)",
        [],
    )
    .map_err(map_db)?;
    tx.execute(
        "DELETE FROM semantic_pending WHERE NOT EXISTS
         (SELECT 1 FROM root_members m WHERE m.file_key = semantic_pending.file_key)",
        [],
    )
    .map_err(map_db)?;
    Ok(())
}

fn bump_generation(tx: &Transaction<'_>) -> AiSearchResult<()> {
    tx.execute(
        "UPDATE semantic_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
         WHERE key = 'generation'",
        [],
    )
    .map_err(map_db)?;
    Ok(())
}

fn set_meta_tx(tx: &Transaction<'_>, key: &str, value: &str) -> AiSearchResult<()> {
    tx.execute(
        "INSERT INTO semantic_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(map_db)?;
    Ok(())
}

fn map_db(error: rusqlite::Error) -> AiSearchError {
    match error {
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::DatabaseBusy
                || inner.code == rusqlite::ErrorCode::DatabaseLocked =>
        {
            AiSearchError::Unavailable
        }
        _ => AiSearchError::Failed,
    }
}

#[cfg(test)]
#[path = "ai_semantic_store_step17c_tests.rs"]
mod ai_semantic_store_step17c_tests;

use crate::ai_semantic_schema::SCHEMA;
