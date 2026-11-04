//! The bounded identity-keyed tag store (Step 11b, interface tags-1).
//!
//! One SQLite database per profile at `<profile>/tags.sqlite`, schema 1.
//! Physical size, tag count and link count are bounded; a write that would
//! cross a bound fails with `tags.limit` before its transaction commits.
//! The store never opens file content: identities come from callers that
//! used the metadata-only Step 07a capture.
#![allow(dead_code)]


use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use fs_service::FileIdentityKey;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::tag_identity_effects::TagIdentityEffects;
use crate::tag_transactions::TagHistory;
use crate::tag_types::{
    assignment_lookup, catalog_is_bounded, normalize_tag_name, tag_name_fold, validate_tag, Tag,
    TagAssignment, TagCatalog, TagStateSnapshot, MAX_DB_BYTES, MAX_TAGS, TAG_SCHEMA_VERSION,
};

/// One durable membership mirror update waiting for the search bridge.
///
/// `revision` is the store-wide mirror revision, not the assignment
/// revision: it only grows, including across Undo and app restarts, so the
/// Step 11a index never mistakes a restored state for a stale update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMirror {
    pub key: FileIdentityKey,
    pub tag_ids: Vec<String>,
    pub deleted: bool,
    pub revision: u64,
}

/// Reserves one Undo state before a write. Implemented by `TagHistory`; the
/// store never knows where states are kept.
pub trait HistoryReservation {
    /// Keep `before`/`after` and return the entry id, or refuse with
    /// `tags.limit` without dropping retained entries.
    fn reserve(
        &self,
        before: &TagStateSnapshot,
        after: &TagStateSnapshot,
    ) -> Result<String, String>;
    /// The write committed: the entry becomes an Undo target.
    fn commit(&self, history_id: &str);
    /// The write did not commit: forget the reservation.
    fn discard(&self, history_id: &str);
}

/// The tag store (managed Tauri state).
pub struct TagStore {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) db_path: Option<PathBuf>,
    pub(crate) limit_bytes: u64,
    pub(crate) pending: Mutex<VecDeque<PendingMirror>>,
    /// The session Undo history of committed tag writes. It lives with the
    /// store so the tag commands never depend on a second managed state that
    /// a partial app-wiring change could leave unregistered.
    pub(crate) history: TagHistory,
    /// The sequence gate of the Step 09f receipt listener.
    pub(crate) effects: TagIdentityEffects,
}

/// Seconds since the Unix epoch, or 0 before it.
pub(crate) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn wal_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push("-wal");
    PathBuf::from(name)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO meta (key, value) VALUES ('catalog_revision', '0');
INSERT OR IGNORE INTO meta (key, value) VALUES ('mirror_revision', '0');
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_fold TEXT NOT NULL,
    color TEXT NOT NULL,
    icon_id TEXT NOT NULL,
    created_unix INTEGER NOT NULL,
    modified_unix INTEGER NOT NULL,
    revision INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_fold ON tags (name_fold);
CREATE TABLE IF NOT EXISTS assignments (
    lookup TEXT PRIMARY KEY,
    volume_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    path_key TEXT NOT NULL,
    stable INTEGER NOT NULL,
    display_path TEXT NOT NULL,
    tag_ids TEXT NOT NULL,
    revision INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_path ON assignments (path_key);
";

impl TagStore {
    /// Open the profile's database, creating it with schema 1.
    pub fn open(profile_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(profile_dir).map_err(|_| "tags.io".to_string())?;
        Self::open_at(&profile_dir.join("tags.sqlite"), MAX_DB_BYTES)
    }

    /// Open one database path with an explicit physical limit.
    pub fn open_at(path: &Path, limit_bytes: u64) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|_| "tags.io".to_string())?;
        Self::prepare(conn, Some(path.to_path_buf()), limit_bytes)
    }

    /// A database that lives only in memory (tests).
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|_| "tags.io".to_string())?;
        Self::prepare(conn, None, MAX_DB_BYTES)
    }

    fn prepare(
        conn: Connection,
        db_path: Option<PathBuf>,
        limit_bytes: u64,
    ) -> Result<Self, String> {
        configure(&conn, limit_bytes)?;
        conn.execute_batch(SCHEMA)
            .map_err(|_| "tags.io".to_string())?;
        let version: Option<String> = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "tags.io".to_string())?;
        match version.as_deref() {
            Some("1") => {}
            Some(_) => return Err("tags.unsupported".to_string()),
            None => return Err("tags.io".to_string()),
        }
        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
            limit_bytes,
            pending: Mutex::new(VecDeque::new()),
            history: TagHistory::default(),
            effects: TagIdentityEffects::new(),
        })
    }

    pub(crate) fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "tags.io".to_string())
    }

    /// The whole catalog, at most 256 KiB on the wire.
    pub fn catalog(&self) -> Result<TagCatalog, String> {
        let conn = self.lock()?;
        read_catalog(&conn)
    }

    pub(crate) fn catalog_revision(conn: &Connection) -> Result<u64, String> {
        let value: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'catalog_revision'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "tags.io".to_string())?;
        value.parse::<u64>().map_err(|_| "tags.io".to_string())
    }

    fn bump_catalog_revision(conn: &Connection, expected: u64) -> Result<u64, String> {
        let current = Self::catalog_revision(conn)?;
        if current != expected {
            return Err("tags.changed".to_string());
        }
        let next = current.saturating_add(1);
        conn.execute(
            "UPDATE meta SET value = ?1 WHERE key = 'catalog_revision'",
            params![next.to_string()],
        )
        .map_err(|_| "tags.io".to_string())?;
        Ok(next)
    }

    /// The store-wide mirror revision. It only grows, so every membership
    /// state, including an Undo that restores older assignment revisions,
    /// reaches the search index as a newer update.
    pub(crate) fn mirror_revision(conn: &Connection) -> Result<u64, String> {
        let value: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'mirror_revision'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "tags.io".to_string())?;
        value.parse::<u64>().map_err(|_| "tags.io".to_string())
    }

    pub(crate) fn bump_mirror_revision(conn: &Connection) -> Result<u64, String> {
        let next = Self::mirror_revision(conn)?.saturating_add(1);
        conn.execute(
            "UPDATE meta SET value = ?1 WHERE key = 'mirror_revision'",
            params![next.to_string()],
        )
        .map_err(|_| "tags.io".to_string())?;
        Ok(next)
    }

    /// Check the physical database size including the WAL before commit.
    pub(crate) fn check_physical_limit(&self, conn: &Connection) -> Result<(), String> {
        let pages: i64 = conn
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .unwrap_or(0);
        let page_size: i64 = conn
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .unwrap_or(4096);
        let wal = self
            .db_path
            .as_ref()
            .and_then(|path| fs::metadata(wal_path(path)).ok())
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let total = (pages.max(0) as u64)
            .saturating_mul(page_size.max(0) as u64)
            .saturating_add(wal);
        if total > self.limit_bytes {
            return Err("tags.limit".to_string());
        }
        Ok(())
    }

    /// Count assignment rows (one row is one linked item).
    pub fn count_links(conn: &Connection) -> Result<u64, String> {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM assignments", [], |row| row.get(0))
            .map_err(|_| "tags.io".to_string())?;
        Ok(count.max(0) as u64)
    }

    pub(crate) fn queued(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, VecDeque<PendingMirror>>, String> {
        self.pending.lock().map_err(|_| "tags.io".to_string())
    }

    /// Take the mirror updates of committed mutations (search bridge input).
    pub fn take_search_updates(&self) -> Vec<PendingMirror> {
        self.queued()
            .map(|mut queue| queue.drain(..).collect())
            .unwrap_or_default()
    }

    /// Create or update one tag. The Undo state is reserved before the first
    /// write; a refused reservation leaves the database untouched.
    pub fn save_tag(
        &self,
        tag: &Tag,
        expected_catalog_revision: u64,
        history: &dyn HistoryReservation,
    ) -> Result<TagCatalog, String> {
        validate_tag(tag)?;
        let name = normalize_tag_name(&tag.name);
        if !crate::tag_types::is_valid_tag_name(&name) {
            return Err("tags.invalid".to_string());
        }
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        let current = Self::catalog_revision(&transaction)?;
        if current != expected_catalog_revision {
            return Err("tags.changed".to_string());
        }
        let duplicate: Option<String> = transaction
            .query_row(
                "SELECT id FROM tags WHERE name_fold = ?1 AND id <> ?2 LIMIT 1",
                params![tag_name_fold(&name), tag.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "tags.io".to_string())?;
        if duplicate.is_some() {
            return Err("tags.invalid".to_string());
        }
        let before_catalog = read_catalog(&transaction)?;
        let existing: Option<(i64, i64)> = transaction
            .query_row(
                "SELECT created_unix, revision FROM tags WHERE id = ?1",
                params![tag.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "tags.io".to_string())?;
        if existing.is_none() {
            let count: i64 = transaction
                .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
                .map_err(|_| "tags.io".to_string())?;
            if count.max(0) as usize >= MAX_TAGS {
                return Err("tags.limit".to_string());
            }
        }
        let now = unix_now();
        let created = existing
            .map(|(created, _)| created.max(0) as u64)
            .unwrap_or(now);
        let revision = existing
            .map(|(_, revision)| revision.max(0) as u64)
            .unwrap_or(0)
            .saturating_add(1);
        let stored = Tag {
            id: tag.id.clone(),
            name: name.clone(),
            color: tag.color.clone(),
            icon_id: tag.icon_id.clone(),
            created_unix: created,
            modified_unix: now,
            revision,
        };
        let mut after_tags = before_catalog.tags.clone();
        match after_tags.iter_mut().find(|candidate| candidate.id == stored.id) {
            Some(slot) => *slot = stored.clone(),
            None => after_tags.push(stored.clone()),
        }
        after_tags.sort_by(|a, b| {
            a.created_unix
                .cmp(&b.created_unix)
                .then_with(|| a.id.cmp(&b.id))
        });
        let next_revision = current.saturating_add(1);
        let after_catalog = TagCatalog {
            schema_version: TAG_SCHEMA_VERSION,
            tags: after_tags,
            revision: next_revision,
            history_id: None,
        };
        // The 256 KiB wire cap is checked before the write: a catalog that
        // could never be read back must not be committed.
        if !catalog_is_bounded(&after_catalog) {
            return Err("tags.limit".to_string());
        }
        let before = TagStateSnapshot {
            catalog: before_catalog,
            assignments: Vec::new(),
        };
        let after = TagStateSnapshot {
            catalog: after_catalog,
            assignments: Vec::new(),
        };
        let history_id = history.reserve(&before, &after)?;
        transaction
            .execute(
                "INSERT INTO tags (id, name, name_fold, color, icon_id, created_unix, modified_unix, revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                     name = excluded.name,
                     name_fold = excluded.name_fold,
                     color = excluded.color,
                     icon_id = excluded.icon_id,
                     modified_unix = excluded.modified_unix,
                     revision = excluded.revision",
                params![
                    stored.id,
                    name,
                    tag_name_fold(&stored.name),
                    stored.color,
                    stored.icon_id,
                    stored.created_unix as i64,
                    stored.modified_unix as i64,
                    stored.revision as i64
                ],
            )
            .map_err(|_| "tags.io".to_string())?;
        Self::bump_catalog_revision(&transaction, current)?;
        if let Err(error) = self.check_physical_limit(&transaction) {
            history.discard(&history_id);
            return Err(error);
        }
        if transaction.commit().is_err() {
            history.discard(&history_id);
            return Err("tags.io".to_string());
        }
        history.commit(&history_id);
        let mut catalog = read_catalog(&conn)?;
        catalog.history_id = Some(history_id);
        Ok(catalog)
    }

    /// Merge `from_id` into `to_id`: the union of both memberships, then the
    /// source tag disappears.
    pub fn merge_tags(
        &self,
        from_id: &str,
        to_id: &str,
        expected_catalog_revision: u64,
        history: &dyn HistoryReservation,
    ) -> Result<TagCatalog, String> {
        if from_id == to_id
            || !crate::tag_types::is_uuid(from_id)
            || !crate::tag_types::is_uuid(to_id)
        {
            return Err("tags.invalid".to_string());
        }
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        let current = Self::catalog_revision(&transaction)?;
        if current != expected_catalog_revision {
            return Err("tags.changed".to_string());
        }
        let before_catalog = read_catalog(&transaction)?;
        if !before_catalog.tags.iter().any(|tag| tag.id == from_id)
            || !before_catalog.tags.iter().any(|tag| tag.id == to_id)
        {
            return Err("tags.invalid".to_string());
        }
        let affected = assignment_rows(&transaction, Some(from_id))?;
        let mut after_rows = Vec::with_capacity(affected.len());
        for row in &affected {
            let mut tag_ids = row.tag_ids.clone();
            if !tag_ids.iter().any(|id| id == to_id) {
                tag_ids.push(to_id.to_string());
            }
            tag_ids.retain(|id| id != from_id);
            tag_ids.sort();
            tag_ids.dedup();
            if tag_ids.len() > crate::tag_types::MAX_ASSIGNMENT_TAGS {
                return Err("tags.limit".to_string());
            }
            after_rows.push(TagAssignment {
                key: row.key.clone(),
                display_path: row.display_path.clone(),
                tag_ids,
                revision: row.revision.saturating_add(1),
            });
        }
        let mut after_tags = before_catalog.tags.clone();
        after_tags.retain(|tag| tag.id != from_id);
        let next_revision = current.saturating_add(1);
        let before = TagStateSnapshot {
            catalog: before_catalog,
            assignments: affected,
        };
        let after = TagStateSnapshot {
            catalog: TagCatalog {
                schema_version: TAG_SCHEMA_VERSION,
                tags: after_tags,
                revision: next_revision,
                history_id: None,
            },
            assignments: after_rows.clone(),
        };
        let history_id = history.reserve(&before, &after)?;
        for row in &after_rows {
            write_assignment(
                &transaction,
                &row.key,
                &row.display_path,
                &row.tag_ids,
                row.revision,
            )?;
        }
        transaction
            .execute("DELETE FROM tags WHERE id = ?1", params![from_id])
            .map_err(|_| "tags.io".to_string())?;
        Self::bump_catalog_revision(&transaction, current)?;
        let mirror_revision = Self::bump_mirror_revision(&transaction)?;
        if let Err(error) = self.check_physical_limit(&transaction) {
            history.discard(&history_id);
            return Err(error);
        }
        let pending: VecDeque<PendingMirror> = after_rows
            .iter()
            .map(|row| PendingMirror {
                key: row.key.clone(),
                tag_ids: row.tag_ids.clone(),
                deleted: false,
                revision: mirror_revision,
            })
            .collect();
        if transaction.commit().is_err() {
            history.discard(&history_id);
            return Err("tags.io".to_string());
        }
        history.commit(&history_id);
        if let Ok(mut queue) = self.pending.lock() {
            queue.extend(pending);
        }
        let mut catalog = read_catalog(&conn)?;
        catalog.history_id = Some(history_id);
        Ok(catalog)
    }

    /// Delete one tag and every link that carries it.
    pub fn delete_tag(
        &self,
        id: &str,
        expected_catalog_revision: u64,
        history: &dyn HistoryReservation,
    ) -> Result<TagCatalog, String> {
        if !crate::tag_types::is_uuid(id) {
            return Err("tags.invalid".to_string());
        }
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        let current = Self::catalog_revision(&transaction)?;
        if current != expected_catalog_revision {
            return Err("tags.changed".to_string());
        }
        let before_catalog = read_catalog(&transaction)?;
        if !before_catalog.tags.iter().any(|tag| tag.id == id) {
            return Err("tags.invalid".to_string());
        }
        let affected = assignment_rows(&transaction, Some(id))?;
        let mut after_rows = Vec::with_capacity(affected.len());
        for row in &affected {
            let mut tag_ids = row.tag_ids.clone();
            tag_ids.retain(|candidate| candidate != id);
            tag_ids.sort();
            tag_ids.dedup();
            after_rows.push(TagAssignment {
                key: row.key.clone(),
                display_path: row.display_path.clone(),
                tag_ids,
                revision: row.revision.saturating_add(1),
            });
        }
        let mut after_tags = before_catalog.tags.clone();
        after_tags.retain(|tag| tag.id != id);
        let next_revision = current.saturating_add(1);
        let before = TagStateSnapshot {
            catalog: before_catalog,
            assignments: affected,
        };
        let after = TagStateSnapshot {
            catalog: TagCatalog {
                schema_version: TAG_SCHEMA_VERSION,
                tags: after_tags,
                revision: next_revision,
                history_id: None,
            },
            assignments: after_rows.clone(),
        };
        let history_id = history.reserve(&before, &after)?;
        for row in &after_rows {
            if row.tag_ids.is_empty() {
                transaction
                    .execute(
                        "DELETE FROM assignments WHERE lookup = ?1",
                        params![assignment_lookup(&row.key)],
                    )
                    .map_err(|_| "tags.io".to_string())?;
            } else {
                write_assignment(
                    &transaction,
                    &row.key,
                    &row.display_path,
                    &row.tag_ids,
                    row.revision,
                )?;
            }
        }
        transaction
            .execute("DELETE FROM tags WHERE id = ?1", params![id])
            .map_err(|_| "tags.io".to_string())?;
        Self::bump_catalog_revision(&transaction, current)?;
        let mirror_revision = Self::bump_mirror_revision(&transaction)?;
        if let Err(error) = self.check_physical_limit(&transaction) {
            history.discard(&history_id);
            return Err(error);
        }
        let pending: VecDeque<PendingMirror> = after_rows
            .iter()
            .map(|row| PendingMirror {
                key: row.key.clone(),
                tag_ids: row.tag_ids.clone(),
                deleted: row.tag_ids.is_empty(),
                revision: mirror_revision,
            })
            .collect();
        if transaction.commit().is_err() {
            history.discard(&history_id);
            return Err("tags.io".to_string());
        }
        history.commit(&history_id);
        if let Ok(mut queue) = self.pending.lock() {
            queue.extend(pending);
        }
        let mut catalog = read_catalog(&conn)?;
        catalog.history_id = Some(history_id);
        Ok(catalog)
    }

    /// One page of membership rows ordered by their stable lookup key. The
    /// personal-location export pages through this without holding the whole
    /// database in memory.
    pub fn assignment_page(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TagAssignment>, String> {
        if limit == 0 || limit > 4096 {
            return Err("tags.invalid".to_string());
        }
        let conn = self.lock()?;
        let mut statement = conn
            .prepare(
                "SELECT volume_id, file_id, path_key, stable, display_path, tag_ids, revision
                 FROM assignments
                 WHERE (?1 IS NULL OR lookup > ?1)
                 ORDER BY lookup ASC
                 LIMIT ?2",
            )
            .map_err(|_| "tags.io".to_string())?;
        let rows = statement
            .query_map(params![after, limit as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .map_err(|_| "tags.io".to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (volume_id, file_id, path_key, stable, display_path, tags_json, revision) =
                row.map_err(|_| "tags.io".to_string())?;
            let mut tag_ids: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            tag_ids.sort();
            tag_ids.dedup();
            out.push(TagAssignment {
                key: FileIdentityKey {
                    volume_id,
                    file_id,
                    path_key,
                    stable: stable != 0,
                },
                display_path,
                tag_ids,
                revision: revision.max(0) as u64,
            });
        }
        Ok(out)
    }

    /// Apply a reviewed import: tags are inserted or updated, then the exact
    /// membership rows are written, all in one transaction with one Undo
    /// state. The caller has already verified every key against the current
    /// file identity; this method never resolves a path itself.
    pub fn import_catalog(
        &self,
        tags: &[Tag],
        rows: &[TagAssignment],
        history: &dyn HistoryReservation,
    ) -> Result<TagCatalog, String> {
        if tags.len() > MAX_TAGS || rows.len() > crate::tag_types::MAX_LINKS as usize {
            return Err("tags.limit".to_string());
        }
        for tag in tags {
            validate_tag(tag)?;
        }
        let mut ids = std::collections::HashSet::new();
        let mut names = std::collections::HashSet::new();
        for tag in tags {
            if !ids.insert(tag.id.clone()) {
                return Err("tags.invalid".to_string());
            }
            let folded = tag_name_fold(&normalize_tag_name(&tag.name));
            if !names.insert(folded) {
                return Err("tags.invalid".to_string());
            }
        }
        let mut conn = self.lock()?;
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tags.io".to_string())?;
        let current = Self::catalog_revision(&transaction)?;
        let before_catalog = read_catalog(&transaction)?;
        let now = unix_now();
        let mut after_tags = before_catalog.tags.clone();
        for incoming in tags {
            // Import never replaces a tag that already exists in this
            // catalog: the local name, color and icon win. Only new tags are
            // added, so an import cannot rename anything silently.
            if after_tags.iter().any(|tag| tag.id == incoming.id) {
                continue;
            }
            let name = normalize_tag_name(&incoming.name);
            let duplicate = after_tags
                .iter()
                .any(|existing| tag_name_fold(&existing.name) == tag_name_fold(&name));
            if duplicate {
                return Err("tags.invalid".to_string());
            }
            if after_tags.len() >= MAX_TAGS {
                return Err("tags.limit".to_string());
            }
            after_tags.push(Tag {
                id: incoming.id.clone(),
                name,
                color: incoming.color.clone(),
                icon_id: incoming.icon_id.clone(),
                created_unix: if incoming.created_unix == 0 {
                    now
                } else {
                    incoming.created_unix
                },
                modified_unix: now,
                revision: 1,
            });
        }
        after_tags.sort_by(|a, b| {
            a.created_unix
                .cmp(&b.created_unix)
                .then_with(|| a.id.cmp(&b.id))
        });
        let known: std::collections::HashSet<&str> =
            after_tags.iter().map(|tag| tag.id.as_str()).collect();
        let mut before_rows = Vec::with_capacity(rows.len());
        let mut after_rows = Vec::with_capacity(rows.len());
        let mut seen = std::collections::HashSet::new();
        for row in rows {
            if !crate::tag_types::is_valid_identity_key(&row.key)
                || !seen.insert(assignment_lookup(&row.key))
                || row.tag_ids.iter().any(|id| !known.contains(id.as_str()))
            {
                return Err("tags.invalid".to_string());
            }
            let mut tag_ids = row.tag_ids.clone();
            tag_ids.sort();
            tag_ids.dedup();
            if tag_ids.len() > crate::tag_types::MAX_ASSIGNMENT_TAGS {
                return Err("tags.limit".to_string());
            }
            let existing = read_assignment(&transaction, &row.key)?;
            let next_row_revision = existing
                .as_ref()
                .map(|current| current.revision.saturating_add(1))
                .unwrap_or(1)
                .max(row.revision);
            match existing {
                Some(current) => before_rows.push(current),
                // Undo removes a membership row this import created; store
                // the empty before-row so restore_state can delete it.
                None => before_rows.push(TagAssignment {
                    key: row.key.clone(),
                    display_path: row.display_path.clone(),
                    tag_ids: Vec::new(),
                    revision: 0,
                }),
            }
            after_rows.push(TagAssignment {
                key: row.key.clone(),
                display_path: row.display_path.clone(),
                tag_ids,
                revision: next_row_revision,
            });
        }
        let next_revision = current.saturating_add(1);
        let after_catalog = TagCatalog {
            schema_version: TAG_SCHEMA_VERSION,
            tags: after_tags.clone(),
            revision: next_revision,
            history_id: None,
        };
        if !catalog_is_bounded(&after_catalog) {
            return Err("tags.limit".to_string());
        }
        let before = TagStateSnapshot {
            catalog: before_catalog,
            assignments: before_rows,
        };
        let after = TagStateSnapshot {
            catalog: after_catalog,
            assignments: after_rows.clone(),
        };
        let history_id = history.reserve(&before, &after)?;
        for tag in &after_tags {
            transaction
                .execute(
                    "INSERT INTO tags (id, name, name_fold, color, icon_id, created_unix, modified_unix, revision)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(id) DO UPDATE SET
                         name = excluded.name,
                         name_fold = excluded.name_fold,
                         color = excluded.color,
                         icon_id = excluded.icon_id,
                         modified_unix = excluded.modified_unix,
                         revision = excluded.revision",
                    params![
                        tag.id,
                        tag.name,
                        tag_name_fold(&tag.name),
                        tag.color,
                        tag.icon_id,
                        tag.created_unix as i64,
                        tag.modified_unix as i64,
                        tag.revision as i64
                    ],
                )
                .map_err(|_| "tags.io".to_string())?;
        }
        for row in &after_rows {
            if row.tag_ids.is_empty() {
                transaction
                    .execute(
                        "DELETE FROM assignments WHERE lookup = ?1",
                        params![assignment_lookup(&row.key)],
                    )
                    .map_err(|_| "tags.io".to_string())?;
            } else {
                write_assignment(
                    &transaction,
                    &row.key,
                    &row.display_path,
                    &row.tag_ids,
                    row.revision,
                )?;
            }
        }
        Self::bump_catalog_revision(&transaction, current)?;
        let mirror_revision = Self::bump_mirror_revision(&transaction)?;
        if Self::count_links(&transaction)? > crate::tag_types::MAX_LINKS {
            history.discard(&history_id);
            return Err("tags.limit".to_string());
        }
        if let Err(error) = self.check_physical_limit(&transaction) {
            history.discard(&history_id);
            return Err(error);
        }
        let pending: VecDeque<PendingMirror> = after_rows
            .iter()
            .map(|row| PendingMirror {
                key: row.key.clone(),
                tag_ids: row.tag_ids.clone(),
                deleted: row.tag_ids.is_empty(),
                revision: mirror_revision,
            })
            .collect();
        if transaction.commit().is_err() {
            history.discard(&history_id);
            return Err("tags.io".to_string());
        }
        history.commit(&history_id);
        if let Ok(mut queue) = self.pending.lock() {
            queue.extend(pending);
        }
        let mut catalog = read_catalog(&conn)?;
        catalog.history_id = Some(history_id);
        Ok(catalog)
    }
}

/// PRAGMA setup shared by file and memory databases.
fn configure(conn: &Connection, limit_bytes: u64) -> Result<(), String> {
    if limit_bytes > 0 {
        let page_size: i64 = 4096;
        let pages = (limit_bytes / page_size as u64).min(i64::MAX as u64) as i64;
        conn.pragma_update(None, "max_page_count", pages)
            .map_err(|_| "tags.io".to_string())?;
    }
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "tags.io".to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    Ok(())
}

pub(crate) fn read_catalog(conn: &Connection) -> Result<TagCatalog, String> {
    let revision = TagStore::catalog_revision(conn)?;
    let mut statement = conn
        .prepare(
            "SELECT id, name, color, icon_id, created_unix, modified_unix, revision
             FROM tags ORDER BY created_unix ASC, id ASC",
        )
        .map_err(|_| "tags.io".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon_id: row.get(3)?,
                created_unix: row.get::<_, i64>(4)?.max(0) as u64,
                modified_unix: row.get::<_, i64>(5)?.max(0) as u64,
                revision: row.get::<_, i64>(6)?.max(0) as u64,
            })
        })
        .map_err(|_| "tags.io".to_string())?;
    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|_| "tags.io".to_string())?);
    }
    let catalog = TagCatalog {
        schema_version: TAG_SCHEMA_VERSION,
        tags,
        revision,
        history_id: None,
    };
    if !catalog_is_bounded(&catalog) {
        return Err("tags.limit".to_string());
    }
    Ok(catalog)
}

pub(crate) fn read_assignment(
    conn: &Connection,
    key: &FileIdentityKey,
) -> Result<Option<TagAssignment>, String> {
    let row = conn
        .query_row(
            "SELECT path_key, stable, display_path, tag_ids, revision
             FROM assignments WHERE lookup = ?1",
            params![assignment_lookup(key)],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "tags.io".to_string())?;
    let Some((path_key, stable, display_path, tags_json, revision)) = row else {
        return Ok(None);
    };
    let mut tag_ids: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    tag_ids.sort();
    tag_ids.dedup();
    Ok(Some(TagAssignment {
        key: FileIdentityKey {
            volume_id: key.volume_id.clone(),
            file_id: key.file_id.clone(),
            path_key,
            stable: stable != 0,
        },
        display_path,
        tag_ids,
        revision: revision.max(0) as u64,
    }))
}

pub(crate) fn write_assignment(
    conn: &Connection,
    key: &FileIdentityKey,
    display_path: &str,
    tag_ids: &[String],
    revision: u64,
) -> Result<(), String> {
    let json = serde_json::to_string(tag_ids).map_err(|_| "tags.io".to_string())?;
    conn.execute(
        "INSERT INTO assignments (lookup, volume_id, file_id, path_key, stable, display_path, tag_ids, revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(lookup) DO UPDATE SET
             volume_id = excluded.volume_id,
             file_id = excluded.file_id,
             path_key = excluded.path_key,
             stable = excluded.stable,
             display_path = excluded.display_path,
             tag_ids = excluded.tag_ids,
             revision = excluded.revision",
        params![
            assignment_lookup(key),
            key.volume_id,
            key.file_id,
            key.path_key,
            if key.stable { 1i64 } else { 0i64 },
            display_path,
            json,
            revision as i64
        ],
    )
    .map_err(|_| "tags.io".to_string())?;
    Ok(())
}

/// Every assignment that currently carries `tag_id` (all rows when `None`).
pub(crate) fn assignment_rows(
    conn: &Connection,
    tag_id: Option<&str>,
) -> Result<Vec<TagAssignment>, String> {
    let pattern = tag_id.map(|id| format!("%\"{id}\"%"));
    let mut statement = conn
        .prepare(
            "SELECT volume_id, file_id, path_key, stable, display_path, tag_ids, revision
             FROM assignments
             WHERE (?1 IS NULL OR tag_ids LIKE ?1)
             ORDER BY display_path ASC",
        )
        .map_err(|_| "tags.io".to_string())?;
    let rows = statement
        .query_map(params![pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|_| "tags.io".to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (volume_id, file_id, path_key, stable, display_path, tags_json, revision) =
            row.map_err(|_| "tags.io".to_string())?;
        let mut tag_ids: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        tag_ids.sort();
        tag_ids.dedup();
        if tag_id.is_some_and(|wanted| !tag_ids.iter().any(|id| id == wanted)) {
            continue;
        }
        out.push(TagAssignment {
            key: FileIdentityKey {
                volume_id,
                file_id,
                path_key,
                stable: stable != 0,
            },
            display_path,
            tag_ids,
            revision: revision.max(0) as u64,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod step11b_tags_tests {
    use super::*;
    use crate::tag_transactions::{IdentitySource, TagHistory, TagTransaction, NO_HISTORY_ID};
    use crate::tag_types::{TagMutation, TagStateSnapshot, DEFAULT_TAG_COLORS, DEFAULT_TAG_IDS};

    fn default_tag(index: usize) -> Tag {
        Tag {
            id: DEFAULT_TAG_IDS[index].to_string(),
            name: format!("Default {index}"),
            color: DEFAULT_TAG_COLORS[index].to_string(),
            icon_id: "tag".to_string(),
            created_unix: index as u64,
            modified_unix: index as u64,
            revision: 0,
        }
    }

    fn native_tag(index: usize) -> Tag {
        Tag {
            id: format!("10000000-0000-4000-8000-{index:012}"),
            name: format!("Tag {index}"),
            color: "#1565C0".to_string(),
            icon_id: "tag".to_string(),
            created_unix: index as u64,
            modified_unix: index as u64,
            revision: 0,
        }
    }

    fn key(file: &str, path: &str) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: "1a2b3c4d".to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable: true,
        }
    }

    /// Keeps no snapshots. The catalog-limit test proves the store bound
    /// without also filling the 16 MiB Undo budget.
    struct NoHistory;

    impl HistoryReservation for NoHistory {
        fn reserve(
            &self,
            _before: &TagStateSnapshot,
            _after: &TagStateSnapshot,
        ) -> Result<String, String> {
            Ok(NO_HISTORY_ID.to_string())
        }

        fn commit(&self, _history_id: &str) {}

        fn discard(&self, _history_id: &str) {}
    }

    /// Resolves the test paths to the identities used in each request.
    struct TestSource;
    impl IdentitySource for TestSource {
        fn resolve(&self, path: &str) -> Result<FileIdentityKey, String> {
            let file = match path {
                "C:\\a.txt" => "0011223344556677",
                "C:\\b.txt" => "0011223344556678",
                "C:\\c.txt" => "0011223344556679",
                _ => return Err("tags.io".to_string()),
            };
            Ok(key(file, path))
        }
    }

    #[test]
    fn seven_defaults_uuid_stable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tags.sqlite");
        {
            let store = TagStore::open_at(&path, MAX_DB_BYTES).unwrap();
            let history = TagHistory::default();
            for index in 0..7 {
                store
                    .save_tag(&default_tag(index), index as u64, &history)
                    .unwrap();
            }
            assert_eq!(store.catalog().unwrap().tags.len(), 7);
        }
        // Reopening the profile keeps every reserved identifier.
        let store = TagStore::open_at(&path, MAX_DB_BYTES).unwrap();
        let catalog = store.catalog().unwrap();
        assert_eq!(catalog.tags.len(), 7);
        for (index, tag) in catalog.tags.iter().enumerate() {
            assert_eq!(tag.id, DEFAULT_TAG_IDS[index]);
            assert_eq!(tag.color, DEFAULT_TAG_COLORS[index]);
        }
        // Renaming a reserved tag keeps its identifier.
        let mut renamed = catalog.tags[0].clone();
        renamed.name = "Important".to_string();
        let history = TagHistory::default();
        let after = store
            .save_tag(&renamed, catalog.revision, &history)
            .unwrap();
        assert_eq!(after.tags.len(), 7);
        assert_eq!(after.tags[0].id, DEFAULT_TAG_IDS[0]);
        assert_eq!(after.tags[0].name, "Important");
    }

    #[test]
    fn catalog_limit_is_1001() {
        let store = TagStore::open_in_memory().unwrap();
        let history = NoHistory;
        for index in 0..MAX_TAGS {
            store
                .save_tag(&native_tag(index), index as u64, &history)
                .unwrap();
        }
        assert_eq!(
            store
                .save_tag(&native_tag(MAX_TAGS), MAX_TAGS as u64, &history)
                .err()
                .as_deref(),
            Some("tags.limit")
        );
        assert_eq!(store.catalog().unwrap().tags.len(), MAX_TAGS);
    }

    #[test]
    fn duplicate_casefold_name_refused() {
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let mut first = native_tag(1);
        first.name = "Work".to_string();
        store.save_tag(&first, 0, &history).unwrap();
        let mut second = native_tag(2);
        second.name = "WORK".to_string();
        assert_eq!(
            store.save_tag(&second, 1, &history).err().as_deref(),
            Some("tags.invalid")
        );
        assert_eq!(store.catalog().unwrap().tags.len(), 1);
    }

    #[test]
    fn cloud_item_is_tagged_with_zero_content_reads() {
        use std::cell::Cell;
        struct Spy {
            content_reads: Cell<u32>,
        }
        impl IdentitySource for Spy {
            fn resolve(&self, path: &str) -> Result<FileIdentityKey, String> {
                // A metadata-only resolver: the transaction never asks for
                // file bytes, so the cloud placeholder is not hydrated.
                Ok(key("0011223344556677", path))
            }
            fn content_reads(&self) -> u32 {
                self.content_reads.get()
            }
        }
        let spy = Spy {
            content_reads: Cell::new(0),
        };
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let tag = native_tag(1);
        store.save_tag(&tag, 0, &history).unwrap();
        let request = TagMutation {
            keys: vec![key("0011223344556677", "C:\\cloud\\photo.jpg")],
            paths: vec!["C:\\cloud\\photo.jpg".to_string()],
            add: vec![tag.id.clone()],
            remove: vec![],
            expected_revisions: vec![0],
        };
        let result = TagTransaction::execute(&store, &history, &spy, &request).unwrap();
        assert_eq!(result.changed_count, 1);
        assert_eq!(spy.content_reads(), 0);
        assert_eq!(
            store.assignments(&request.keys).unwrap()[0].tag_ids,
            vec![tag.id]
        );
    }

    #[test]
    fn one_batch_is_one_undo() {
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let tag = native_tag(1);
        store.save_tag(&tag, 0, &history).unwrap();
        let source = TestSource;
        let request = TagMutation {
            keys: vec![
                key("0011223344556677", "C:\\a.txt"),
                key("0011223344556678", "C:\\b.txt"),
                key("0011223344556679", "C:\\c.txt"),
            ],
            paths: vec![
                "C:\\a.txt".to_string(),
                "C:\\b.txt".to_string(),
                "C:\\c.txt".to_string(),
            ],
            add: vec![tag.id.clone()],
            remove: vec![],
            expected_revisions: vec![0, 0, 0],
        };
        let result = TagTransaction::execute(&store, &history, &source, &request).unwrap();
        assert_eq!(result.changed_count, 3);
        assert_ne!(result.history_id, NO_HISTORY_ID);
        assert!(history.has(&result.history_id));
        // One Ctrl+Z removes the tag from all three items.
        history.apply(&store, &result.history_id, true).unwrap();
        for assignment in store.assignments(&request.keys).unwrap() {
            assert!(assignment.tag_ids.is_empty());
        }
        // Ctrl+Y puts it back.
        history.apply(&store, &result.history_id, false).unwrap();
        for assignment in store.assignments(&request.keys).unwrap() {
            assert_eq!(assignment.tag_ids, vec![tag.id.clone()]);
        }
    }

    #[test]
    fn history_capacity_fails_before_write() {
        let store = TagStore::open_in_memory().unwrap();
        let tag = native_tag(1);
        let seed_history = TagHistory::default();
        store.save_tag(&tag, 0, &seed_history).unwrap();
        let history = TagHistory::with_limit(64);
        let source = TestSource;
        let request = TagMutation {
            keys: vec![key("0011223344556677", "C:\\a.txt")],
            paths: vec!["C:\\a.txt".to_string()],
            add: vec![tag.id.clone()],
            remove: vec![],
            expected_revisions: vec![0],
        };
        assert_eq!(
            TagTransaction::execute(&store, &history, &source, &request)
                .err()
                .as_deref(),
            Some("tags.limit")
        );
        assert!(store.assignments(&request.keys).unwrap()[0]
            .tag_ids
            .is_empty());
        // A refused reservation retains no entry.
        assert!(history.is_empty());
    }
}
