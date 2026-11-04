//! Bounded local activity log (Step 11b decision 8 and E5).
//!
//! Only the app itself may append: `record_activity` takes an
//! `AuthorizedActivitySource` that can be built solely from document or
//! operation commits inside this crate. The log stores no file contents and
//! no sensitive or virtual entries, keeps at most 1000 events from the last
//! 30 days, and never exceeds 4 MiB. The catalog lives at
//! `<profile>/activity.json` schema 1.

use std::path::{Path, PathBuf};

use fs_service::source_stamp::FileIdentityKey;
use search_index::limits::{is_safe_u64, unix_now};
use search_index::types::validate_uuid;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::search_index::SearchIndexState;

pub const ACTIVITY_SCHEMA_VERSION: u32 = 1;
pub const MAX_ACTIVITY_EVENTS: usize = 1000;
pub const MAX_ACTIVITY_PAGE: usize = 256;
pub const MAX_ACTIVITY_PAGE_BYTES: usize = 768 * 1024;
pub const MAX_ACTIVITY_BYTES: usize = 4 * 1024 * 1024;
/// Events older than this many seconds are not listed and not kept.
pub const ACTIVITY_RETENTION_SECONDS: u64 = 30 * 24 * 60 * 60;
pub const MAX_ACTIVITY_PATH_CHARS: usize = 4096;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Open,
    Edit,
    Convert,
    Move,
    Download,
}

/// One committed action. `key` is absent when the source had no stable
/// identity; `path` is display-only and never used to reopen later.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: String,
    pub kind: ActivityKind,
    #[serde(default)]
    pub key: Option<FileIdentityKey>,
    pub path: String,
    #[serde(default)]
    pub dest_path: Option<String>,
    pub created_unix: u64,
    #[serde(default)]
    pub operation_id: Option<String>,
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn check_path(path: &str) -> Result<(), String> {
    if path.chars().count() > MAX_ACTIVITY_PATH_CHARS {
        return Err("activity.invalid".to_string());
    }
    crate::validate_absolute_path(path).map_err(|_| "activity.invalid".to_string())
}

pub(crate) fn check_key(key: &FileIdentityKey) -> Result<(), String> {
    if !valid_hex(&key.volume_id, 8)
        || !valid_hex(&key.file_id, 16)
        || key.path_key.is_empty()
        || key.path_key.chars().count() > MAX_ACTIVITY_PATH_CHARS
        || key.path_key.chars().any(char::is_control)
    {
        return Err("activity.invalid".to_string());
    }
    Ok(())
}

impl ActivityEvent {
    pub fn validate(&self) -> Result<(), String> {
        validate_uuid(&self.id).map_err(|_| "activity.invalid".to_string())?;
        if !is_safe_u64(self.created_unix) {
            return Err("activity.invalid".to_string());
        }
        check_path(&self.path)?;
        if let Some(dest) = &self.dest_path {
            check_path(dest)?;
        }
        if let Some(key) = &self.key {
            check_key(key)?;
        }
        if let Some(operation) = &self.operation_id {
            validate_uuid(operation).map_err(|_| "activity.invalid".to_string())?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityPage {
    pub events: Vec<ActivityEvent>,
    pub next_cursor: Option<String>,
    pub complete: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ActivityStatus {
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActivityCatalog {
    #[serde(default = "default_schema")]
    schema_version: u32,
    #[serde(default)]
    paused: bool,
    #[serde(default)]
    events: Vec<ActivityEvent>,
}

fn default_schema() -> u32 {
    ACTIVITY_SCHEMA_VERSION
}

impl Default for ActivityCatalog {
    fn default() -> Self {
        Self {
            schema_version: ACTIVITY_SCHEMA_VERSION,
            paused: false,
            events: Vec::new(),
        }
    }
}

/// A commit that finished successfully. The constructors are crate-private:
/// no IPC command and no test outside this crate can forge one.
#[allow(dead_code)]
pub struct AuthorizedActivitySource {
    /// A sensitive (for example password-protected) document was unlocked for
    /// the action; its entry must never be written down.
    sensitive: bool,
    _private: (),
}

#[allow(dead_code)]
impl AuthorizedActivitySource {
    /// Called after a document open/save/render commit, with the sensitivity
    /// flag of the thing that was committed.
    pub(crate) fn document_commit(sensitive: bool) -> Self {
        Self {
            sensitive,
            _private: (),
        }
    }

    /// Called after a file operation (convert, move, download) committed its
    /// outputs and verified publication.
    pub(crate) fn operation_commit() -> Self {
        Self {
            sensitive: false,
            _private: (),
        }
    }
}

pub struct ActivityStore {
    path: PathBuf,
}

impl ActivityStore {
    pub fn new(profile_dir: &Path) -> Self {
        Self {
            path: profile_dir.join("activity.json"),
        }
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn status(&self) -> Result<ActivityStatus, String> {
        Ok(ActivityStatus {
            paused: self.load()?.paused,
        })
    }

    /// Append one committed event. Paused recording and sensitive commits
    /// succeed without writing anything. The oldest entries are dropped when
    /// the ring, the age limit or the byte limit is reached.
    pub fn record(&self, event: &ActivityEvent, sensitive: bool, now: u64) -> Result<(), String> {
        event.validate()?;
        let catalog = self.load()?;
        if catalog.paused || sensitive || is_expired(event.created_unix, now) {
            return Ok(());
        }
        let mut events = catalog.events;
        prune(&mut events, now);
        events.retain(|entry| entry.id != event.id);
        events.insert(0, event.clone());
        events.truncate(MAX_ACTIVITY_EVENTS);
        loop {
            let candidate = ActivityCatalog {
                schema_version: ACTIVITY_SCHEMA_VERSION,
                paused: catalog.paused,
                events: events.clone(),
            };
            if serialized_len(&candidate)? <= MAX_ACTIVITY_BYTES {
                return self.write(&candidate);
            }
            if events.pop().is_none() {
                return Err("activity.invalid".to_string());
            }
        }
    }

    /// One page, newest first. A cursor is the id of the last event the
    /// previous page returned; an aged or cleared cursor is `activity.invalid`
    /// so the view reloads instead of guessing.
    pub fn list(&self, cursor: Option<&str>, now: u64) -> Result<ActivityPage, String> {
        let catalog = self.load()?;
        let mut events = catalog.events;
        prune(&mut events, now);
        events.truncate(MAX_ACTIVITY_EVENTS);
        let start = match cursor {
            Some(cursor) => {
                validate_uuid(cursor).map_err(|_| "activity.invalid".to_string())?;
                events
                    .iter()
                    .position(|entry| entry.id == cursor)
                    .map(|position| position + 1)
                    .ok_or_else(|| "activity.invalid".to_string())?
            }
            None => 0,
        };
        let mut page: Vec<ActivityEvent> = events
            .iter()
            .skip(start)
            .take(MAX_ACTIVITY_PAGE)
            .cloned()
            .collect();
        loop {
            let complete = start + page.len() >= events.len();
            let next_cursor = if complete {
                None
            } else {
                page.last().map(|entry| entry.id.clone())
            };
            let answer = ActivityPage {
                events: page.clone(),
                next_cursor,
                complete,
            };
            if serialized_len(&answer)? <= MAX_ACTIVITY_PAGE_BYTES {
                return Ok(answer);
            }
            if page.is_empty() {
                return Err("activity.invalid".to_string());
            }
            page.pop();
        }
    }

    /// Remove the app's own list. No file, folder or Recycle Bin entry is
    /// touched; a damaged catalog is replaced by an empty one.
    pub fn clear(&self) -> Result<(), String> {
        let paused = self.load().map(|catalog| catalog.paused).unwrap_or(false);
        self.write(&ActivityCatalog {
            schema_version: ACTIVITY_SCHEMA_VERSION,
            paused,
            events: Vec::new(),
        })
    }

    pub fn set_paused(&self, paused: bool) -> Result<ActivityStatus, String> {
        let mut catalog = self.load()?;
        if catalog.paused != paused {
            catalog.paused = paused;
            self.write(&catalog)?;
        }
        Ok(ActivityStatus { paused })
    }

    fn load(&self) -> Result<ActivityCatalog, String> {
        let metadata = match std::fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ActivityCatalog::default())
            }
            Err(_) => return Err("activity.unavailable".to_string()),
        };
        if metadata.len() > MAX_ACTIVITY_BYTES as u64 {
            return Err("activity.invalid".to_string());
        }
        let bytes = std::fs::read(&self.path).map_err(|_| "activity.unavailable".to_string())?;
        let catalog: ActivityCatalog =
            serde_json::from_slice(&bytes).map_err(|_| "activity.invalid".to_string())?;
        if catalog.schema_version != ACTIVITY_SCHEMA_VERSION
            || catalog.events.len() > MAX_ACTIVITY_EVENTS
            || catalog.events.iter().any(|event| event.validate().is_err())
        {
            return Err("activity.invalid".to_string());
        }
        Ok(catalog)
    }

    fn write(&self, catalog: &ActivityCatalog) -> Result<(), String> {
        let bytes = serde_json::to_vec(catalog).map_err(|_| "activity.invalid".to_string())?;
        if bytes.len() > MAX_ACTIVITY_BYTES {
            return Err("activity.invalid".to_string());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "activity.unavailable".to_string())?;
        }
        fs_service::atomic_write(&self.path, &bytes)
            .map_err(|_| "activity.unavailable".to_string())
    }
}

fn serialized_len<T: Serialize>(value: &T) -> Result<usize, String> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| "activity.invalid".to_string())
}

fn is_expired(created_unix: u64, now: u64) -> bool {
    created_unix.saturating_add(ACTIVITY_RETENTION_SECONDS) <= now
}

fn prune(events: &mut Vec<ActivityEvent>, now: u64) {
    events.retain(|event| !is_expired(event.created_unix, now));
    events.sort_by_key(|event| std::cmp::Reverse(event.created_unix));
    events.truncate(MAX_ACTIVITY_EVENTS);
}

/// Append a successfully committed action. Callers inside the crate pass the
/// commit's authorized source; there is deliberately no IPC command for this.
#[allow(dead_code)]
pub fn record_activity(
    store: &ActivityStore,
    event: &ActivityEvent,
    source: &AuthorizedActivitySource,
) -> Result<(), String> {
    store.record(event, source.sensitive, unix_now())
}

/// Best-effort record for an open/edit that already committed. A sensitive
/// (for example unlocked) document is passed with `sensitive = true` and is
/// never written. Missing state, disabled activity or a broken catalog never
/// fail the action itself.
#[allow(dead_code)]
pub fn record_document(
    app: &tauri::AppHandle,
    kind: ActivityKind,
    path: &str,
    sensitive: bool,
) {
    record_commit(app, kind, path, None, None, sensitive);
}

/// Best-effort record for a convert/move/download that verified its outputs.
/// `operation_id` is the report id when the producer has one. A sensitive
/// source is passed with `sensitive = true`.
#[allow(dead_code)]
pub fn record_operation(
    app: &tauri::AppHandle,
    kind: ActivityKind,
    path: &str,
    dest_path: Option<&str>,
    operation_id: Option<&str>,
    sensitive: bool,
) {
    record_commit(app, kind, path, dest_path, operation_id, sensitive);
}

fn record_commit(
    app: &tauri::AppHandle,
    kind: ActivityKind,
    path: &str,
    dest_path: Option<&str>,
    operation_id: Option<&str>,
    sensitive: bool,
) {
    use tauri::Manager;
    let enabled = app
        .try_state::<crate::AppState>()
        .and_then(|state| state.views_settings().ok())
        .map(|views| views.activity_enabled)
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let Some(directory) = app
        .try_state::<SearchIndexState>()
        .map(|state| state.profile_dir().clone())
    else {
        return;
    };
    let event = ActivityEvent {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        key: None,
        path: path.to_string(),
        dest_path: dest_path.map(str::to_string),
        created_unix: unix_now(),
        operation_id: operation_id.map(str::to_string),
    };
    let source = if sensitive {
        AuthorizedActivitySource::document_commit(true)
    } else {
        match kind {
            ActivityKind::Open | ActivityKind::Edit => {
                AuthorizedActivitySource::document_commit(false)
            }
            ActivityKind::Convert | ActivityKind::Move | ActivityKind::Download => {
                AuthorizedActivitySource::operation_commit()
            }
        }
    };
    let _ = record_activity(&ActivityStore::new(&directory), &event, &source);
}

#[tauri::command]
pub async fn activity_status(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
) -> Result<ActivityStatus, String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || ActivityStore::new(&directory).status())
        .await
        .map_err(|_| "activity.unavailable".to_string())?
}

#[tauri::command]
pub async fn activity_list(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    cursor: Option<String>,
) -> Result<ActivityPage, String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ActivityStore::new(&directory).list(cursor.as_deref(), unix_now())
    })
    .await
    .map_err(|_| "activity.unavailable".to_string())?
}

#[tauri::command]
pub async fn activity_clear(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || ActivityStore::new(&directory).clear())
        .await
        .map_err(|_| "activity.unavailable".to_string())?
}

#[tauri::command]
pub async fn activity_set_paused(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    paused: bool,
) -> Result<ActivityStatus, String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || ActivityStore::new(&directory).set_paused(paused))
        .await
        .map_err(|_| "activity.unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60;

    fn event(id: &str, path: &str, created_unix: u64) -> ActivityEvent {
        ActivityEvent {
            id: id.to_string(),
            kind: ActivityKind::Open,
            key: None,
            path: path.to_string(),
            dest_path: None,
            created_unix,
            operation_id: None,
        }
    }

    fn uuid_event(path: &str, created_unix: u64) -> ActivityEvent {
        event(&uuid::Uuid::new_v4().to_string(), path, created_unix)
    }

    #[test]
    fn ring_keeps_newest_one_thousand() {
        let directory = tempfile::tempdir().unwrap();
        let store = ActivityStore::new(directory.path());
        let now = 1_700_000_000;
        for index in 0..1001 {
            let created = now - (1000 - index);
            store
                .record(&uuid_event(r"C:\Photos\one.jpg", created), false, now)
                .unwrap();
        }
        let page = store.list(None, now).unwrap();
        assert_eq!(page.events.len(), MAX_ACTIVITY_PAGE);
        assert!(!page.complete);
        let mut seen = page.events.len();
        let mut cursor = page.next_cursor.clone();
        while let Some(next) = cursor {
            let page = store.list(Some(&next), now).unwrap();
            seen += page.events.len();
            cursor = page.next_cursor;
        }
        assert_eq!(seen, MAX_ACTIVITY_EVENTS);
        // The very first (oldest) event fell out of the ring.
        let all = store.list(None, now).unwrap();
        assert_eq!(all.events[0].created_unix, now);
    }

    #[test]
    fn events_older_than_thirty_days_are_not_listed() {
        let directory = tempfile::tempdir().unwrap();
        let store = ActivityStore::new(directory.path());
        let now = 1_700_000_000;
        let old = uuid_event(r"C:\Docs\old.txt", now - 31 * DAY);
        store.record(&old, false, now).unwrap();
        assert!(store.list(None, now).unwrap().events.is_empty());
        let fresh = uuid_event(r"C:\Docs\fresh.txt", now - 29 * DAY);
        store.record(&fresh, false, now).unwrap();
        let page = store.list(None, now).unwrap();
        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].id, fresh.id);
    }

    #[test]
    fn sensitive_commit_records_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let store = ActivityStore::new(directory.path());
        let now = 1_700_000_000;
        store
            .record(&uuid_event(r"C:\Vault\locked.docx", now), true, now)
            .unwrap();
        assert!(store.list(None, now).unwrap().events.is_empty());
        assert!(!store.path().exists());
    }

    #[test]
    fn pausing_records_nothing_and_keeps_old_events() {
        let directory = tempfile::tempdir().unwrap();
        let store = ActivityStore::new(directory.path());
        let now = 1_700_000_000;
        let first = uuid_event(r"C:\Docs\one.txt", now - 60);
        store.record(&first, false, now).unwrap();
        store.set_paused(true).unwrap();
        assert!(store.status().unwrap().paused);
        store
            .record(&uuid_event(r"C:\Docs\two.txt", now), false, now)
            .unwrap();
        let page = store.list(None, now).unwrap();
        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].id, first.id);
        store.set_paused(false).unwrap();
        assert!(!store.status().unwrap().paused);
    }

    #[test]
    fn clearing_removes_events_not_files() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("notes.txt");
        std::fs::write(&marker, b"keep me").unwrap();
        let now = 1_700_000_000;
        let store = ActivityStore::new(directory.path());
        store
            .record(
                &uuid_event(&marker.to_string_lossy(), now),
                false,
                now,
            )
            .unwrap();
        assert_eq!(store.list(None, now).unwrap().events.len(), 1);
        store.clear().unwrap();
        assert!(store.list(None, now).unwrap().events.is_empty());
        assert_eq!(std::fs::read(&marker).unwrap(), b"keep me");
    }

    #[test]
    fn pagination_uses_a_stable_cursor() {
        let directory = tempfile::tempdir().unwrap();
        let store = ActivityStore::new(directory.path());
        let now = 1_700_000_000;
        for index in 0..300 {
            store
                .record(&uuid_event(r"C:\Docs\one.txt", now - index), false, now)
                .unwrap();
        }
        let page = store.list(None, now).unwrap();
        assert_eq!(page.events.len(), MAX_ACTIVITY_PAGE);
        assert!(!page.complete);
        let cursor = page.next_cursor.unwrap();
        let next = store.list(Some(&cursor), now).unwrap();
        assert_eq!(next.events.len(), 300 - MAX_ACTIVITY_PAGE);
        assert!(next.complete);
        assert_eq!(store.list(Some(&cursor), now).unwrap().events.len(), 44);
        assert_eq!(
            store.list(Some(&uuid::Uuid::new_v4().to_string()), now).unwrap_err(),
            "activity.invalid"
        );
    }

    #[test]
    fn a_foreign_or_oversized_catalog_is_refused_without_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("activity.json");
        std::fs::write(&path, vec![b'{'; MAX_ACTIVITY_BYTES + 1]).unwrap();
        let before = std::fs::read(&path).unwrap();
        let store = ActivityStore::new(directory.path());
        assert_eq!(store.list(None, 1).unwrap_err(), "activity.invalid");
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
