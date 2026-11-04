//! Tag transactions, Undo history and the native commands of Step 11b T1.
//!
//! `TagHistory` keeps the before/after states of committed tag writes, with
//! the Step 09a limits: at most 100 entries, 16 MiB in total and 4 MiB per
//! state. The state is reserved before the store writes; a refused
//! reservation fails the whole operation with `tags.limit`.
#![allow(dead_code)]


use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;

use fs_service::FileIdentityKey;
use serde_json::json;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::tag_store::{HistoryReservation, TagStore};
use crate::tag_types::{
    is_uuid, validate_mutation, Tag, TagAssignment, TagCatalog, TagMutation, TagMutationResult,
    TagStateSnapshot, MAX_HISTORY_BYTES, MAX_HISTORY_ENTRIES, MAX_HISTORY_STATE_BYTES,
};

/// The id returned when a batch changed nothing and no Undo entry exists.
pub const NO_HISTORY_ID: &str = "00000000-0000-4000-8000-000000000000";

/// A metadata-only identity resolver. Production uses the Step 07a capture;
/// tests use a fake.
pub trait IdentitySource {
    fn resolve(&self, path: &str) -> Result<FileIdentityKey, String>;
    /// How many file contents the resolver opened (always 0 for metadata).
    fn content_reads(&self) -> u32 {
        0
    }
}

/// The Step 07a metadata-only capture, used by the real tag commands.
pub struct FsIdentitySource;

impl IdentitySource for FsIdentitySource {
    fn resolve(&self, path: &str) -> Result<FileIdentityKey, String> {
        fs_service::capture_file_identity(Path::new(path))
            .map_err(|_| "tags.io".to_string())
    }
}

struct HistoryEntry {
    id: String,
    before: TagStateSnapshot,
    after: TagStateSnapshot,
    bytes: usize,
    /// The write committed and the entry may be applied.
    live: bool,
    /// The `after` state is the one currently applied.
    applied_after: bool,
}

struct HistoryInner {
    entries: VecDeque<HistoryEntry>,
    bytes: usize,
    limit: usize,
}

/// Session-only tag Undo history (managed Tauri state).
pub struct TagHistory {
    inner: Mutex<HistoryInner>,
}

impl Default for TagHistory {
    fn default() -> Self {
        Self::with_limit(MAX_HISTORY_BYTES)
    }
}

impl TagHistory {
    /// A history with an explicit byte budget (tests use a tiny one).
    pub fn with_limit(limit: usize) -> Self {
        Self {
            inner: Mutex::new(HistoryInner {
                entries: VecDeque::new(),
                bytes: 0,
                limit,
            }),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HistoryInner>, String> {
        self.inner.lock().map_err(|_| "tags.io".to_string())
    }

    /// Whether a live entry with this id exists.
    pub fn has(&self, history_id: &str) -> bool {
        self.lock()
            .map(|inner| {
                inner
                    .entries
                    .iter()
                    .any(|entry| entry.id == history_id && entry.live)
            })
            .unwrap_or(false)
    }

    /// Whether no entry (live or reserved) is retained.
    pub fn is_empty(&self) -> bool {
        self.lock()
            .map(|inner| inner.entries.is_empty())
            .unwrap_or(true)
    }

    /// Restore the `before` state (`reverse == true`, Undo) or the `after`
    /// state (`reverse == false`, Redo). The state is validated by the store.
    pub fn apply(&self, store: &TagStore, history_id: &str, reverse: bool) -> Result<(), String> {
        let state = {
            let inner = self.lock()?;
            let entry = inner
                .entries
                .iter()
                .find(|entry| entry.id == history_id && entry.live)
                .ok_or_else(|| "tags.changed".to_string())?;
            if reverse != entry.applied_after {
                return Err("tags.changed".to_string());
            }
            if reverse {
                entry.before.clone()
            } else {
                entry.after.clone()
            }
        };
        store.restore_state(&state)?;
        let mut inner = self.lock()?;
        if let Some(entry) = inner
            .entries
            .iter_mut()
            .find(|entry| entry.id == history_id)
        {
            entry.applied_after = !reverse;
        }
        Ok(())
    }
}

impl HistoryReservation for TagHistory {
    fn reserve(
        &self,
        before: &TagStateSnapshot,
        after: &TagStateSnapshot,
    ) -> Result<String, String> {
        let before_bytes =
            serde_json::to_vec(before).map_err(|_| "tags.io".to_string())?.len();
        let after_bytes = serde_json::to_vec(after)
            .map_err(|_| "tags.io".to_string())?
            .len();
        if before_bytes > MAX_HISTORY_STATE_BYTES || after_bytes > MAX_HISTORY_STATE_BYTES {
            return Err("tags.limit".to_string());
        }
        let entry_bytes = before_bytes.saturating_add(after_bytes);
        let mut inner = self.lock()?;
        if entry_bytes > inner.limit {
            return Err("tags.limit".to_string());
        }
        // Oldest entries leave first once the byte budget or the count would
        // be crossed. A single state too large is refused above.
        while inner.bytes.saturating_add(entry_bytes) > inner.limit {
            let Some(entry) = inner.entries.pop_front() else {
                break;
            };
            inner.bytes = inner.bytes.saturating_sub(entry.bytes);
        }
        while inner.entries.len() >= MAX_HISTORY_ENTRIES {
            let Some(entry) = inner.entries.pop_front() else {
                break;
            };
            inner.bytes = inner.bytes.saturating_sub(entry.bytes);
        }
        if inner.bytes.saturating_add(entry_bytes) > inner.limit {
            return Err("tags.limit".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        inner.bytes = inner.bytes.saturating_add(entry_bytes);
        inner.entries.push_back(HistoryEntry {
            id: id.clone(),
            before: before.clone(),
            after: after.clone(),
            bytes: entry_bytes,
            live: false,
            applied_after: false,
        });
        Ok(id)
    }

    fn commit(&self, history_id: &str) {
        if let Ok(mut inner) = self.lock() {
            if let Some(entry) = inner
                .entries
                .iter_mut()
                .find(|entry| entry.id == history_id)
            {
                entry.live = true;
                entry.applied_after = true;
            }
        }
    }

    fn discard(&self, history_id: &str) {
        if let Ok(mut inner) = self.lock() {
            if let Some(index) = inner
                .entries
                .iter()
                .position(|entry| entry.id == history_id)
            {
                if let Some(entry) = inner.entries.remove(index) {
                    inner.bytes = inner.bytes.saturating_sub(entry.bytes);
                }
            }
        }
    }
}

/// Executes one membership batch as one transaction and one Undo entry.
pub struct TagTransaction;

impl TagTransaction {
    pub fn execute(
        store: &TagStore,
        history: &TagHistory,
        source: &dyn IdentitySource,
        request: &TagMutation,
    ) -> Result<TagMutationResult, String> {
        let never = || false;
        store.mutate(request, source, history, &never)
    }
}

#[tauri::command]
pub async fn tags_catalog(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || app.state::<TagStore>().catalog())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tag_save(
    window: WebviewWindow,
    app: AppHandle,
    tag: Tag,
    expected_catalog_revision: u64,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<TagStore>();
        store.save_tag(&tag, expected_catalog_revision, &store.history)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tag_merge(
    window: WebviewWindow,
    app: AppHandle,
    from_id: String,
    to_id: String,
    expected_revision: u64,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<TagStore>();
        let catalog = store.merge_tags(&from_id, &to_id, expected_revision, &store.history)?;
        let _ = crate::tag_search_bridge::flush_after_commit(&app);
        Ok(catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tag_delete(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    expected_revision: u64,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<TagStore>();
        let catalog = store.delete_tag(&id, expected_revision, &store.history)?;
        let _ = crate::tag_search_bridge::flush_after_commit(&app);
        Ok(catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tag_assignments(
    window: WebviewWindow,
    app: AppHandle,
    keys: Vec<FileIdentityKey>,
) -> Result<Vec<TagAssignment>, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<TagStore>().assignments(&keys)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Start one add/remove batch as a shared job. The result is polled with
/// `job_poll`; `job_cancel` before the reservation writes nothing.
#[tauri::command]
pub fn tag_mutate_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: TagMutation,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_mutation(&request)?;
    for path in &request.paths {
        crate::validate_absolute_path(path).map_err(|_| "tags.invalid".to_string())?;
    }
    let token = jobs.begin(&request_id, request.keys.len())?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let store = work_app.state::<TagStore>();
        let token = context.token();
        let cancelled = || token.load(std::sync::atomic::Ordering::Relaxed);
        let result = store.mutate(&request, &FsIdentitySource, &store.history, &cancelled)?;
        let _ = crate::tag_search_bridge::flush_after_commit(&work_app);
        Ok(json!(result))
    });
    Ok(())
}

/// Undo (`reverse == true`) or redo one reserved tag state.
#[tauri::command]
pub async fn tag_undo(
    window: WebviewWindow,
    app: AppHandle,
    history_id: String,
    reverse: bool,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    if !is_uuid(&history_id) {
        return Err("tags.invalid".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<TagStore>();
        store.history.apply(&store, &history_id, reverse)?;
        let catalog = store.catalog()?;
        let _ = crate::tag_search_bridge::flush_after_commit(&app);
        Ok(catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}
