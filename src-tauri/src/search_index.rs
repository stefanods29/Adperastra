//! Tauri adapter for the bounded search index (Step 11a E1-E3). Every
//! command starts with `ensure_main`, validates its inputs, and runs disk or
//! scan work inside the shared job table or a blocking thread.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use fs_service::{CancellationToken, OpProgress};
use search_index::content_extractors::default_registry;
use search_index::limits::{
    db_limit_bytes, FIRST_PAGE, PAGE_SIZE, REGEX_FIRST_BUDGET, MAX_ROOTS,
};
use search_index::paging::CursorStore;
use search_index::scan::{scan_root, ScanOptions};
use search_index::store::SearchStore;
pub use search_index::types::SearchSettings;
use search_index::types::{
    validate_uuid, IndexRoot, IndexStatus, SavedSearch, SearchPage, SearchQuery,
};
use search_index::SearchError;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::saved_searches::SavedSearchStore;
use crate::search_index_watch::{self, WatchHandle};
use crate::{ensure_main, valid_request_id, AppState};

pub struct SearchIndexState {
    profile_dir: PathBuf,
    store: Arc<Mutex<Option<SearchStore>>>,
    cursors: Arc<Mutex<CursorStore>>,
    rebuild_cancel: Arc<Mutex<Option<CancellationToken>>>,
    watch: Mutex<Option<WatchHandle>>,
    /// The last pause intent. It is read under the watch lock so a rebuild
    /// that finishes after `index_pause(true)` cannot restart the watcher.
    paused: AtomicBool,
    /// Only one automatic initial build per process.
    started: AtomicBool,
}

impl SearchIndexState {
    pub fn new(profile_dir: PathBuf) -> Self {
        Self {
            profile_dir,
            store: Arc::new(Mutex::new(None)),
            cursors: Arc::new(Mutex::new(CursorStore::default())),
            rebuild_cancel: Arc::new(Mutex::new(None)),
            watch: Mutex::new(None),
            paused: AtomicBool::new(false),
            started: AtomicBool::new(false),
        }
    }

    pub fn profile_dir(&self) -> &PathBuf {
        &self.profile_dir
    }

    fn open_store(&self, limit_bytes: u64) -> Result<MutexGuard<'_, Option<SearchStore>>, String> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| "search.unavailable".to_string())?;
        if let Some(existing) = guard.as_ref() {
            if existing.limit_bytes() != limit_bytes {
                // The index limit setting changed; reopen with the new
                // physical budget before the next write or search.
                *guard = None;
            }
        }
        if guard.is_none() {
            let path = self.profile_dir.join("search").join("index.sqlite3");
            *guard = Some(
                SearchStore::open(&path, limit_bytes)
                    .map_err(|error| error.code().to_string())?,
            );
        }
        Ok(guard)
    }

    /// Run one synchronous paged query for an indexed view inside a shared job.
    pub fn run_view_query(
        &self,
        app: &AppHandle,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<SearchPage, String> {
        if limit == 0 || limit > PAGE_SIZE {
            return Err("search.too_large".to_string());
        }
        let settings = search_settings(app);
        let store = self.open_store(limit_for(&settings))?;
        let store = store
            .as_ref()
            .ok_or_else(|| "search.unavailable".to_string())?;
        store
            .search(
                query,
                offset,
                limit,
                Instant::now() + REGEX_FIRST_BUDGET,
                cancel,
            )
            .map_err(code)
    }

    /// Apply authoritative tag membership updates after the tag store commits.
    pub fn with_store_mut<T>(
        &self,
        app: &AppHandle,
        work: impl FnOnce(&mut SearchStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let settings = search_settings(app);
        let mut store = self.open_store(limit_for(&settings))?;
        let store = store
            .as_mut()
            .ok_or_else(|| "search.unavailable".to_string())?;
        work(store)
    }

    fn stop_watch(&self) {
        if let Ok(mut watch) = self.watch.lock() {
            if let Some(mut handle) = watch.take() {
                // Joining keeps a running batch from writing while a rebuild
                // resets the index.
                handle.stop();
            }
        }
    }

    /// Start the watcher unless the user has paused the index. The check and
    /// the handle swap share the watch lock with `stop_watch`, so a pause and
    /// a finishing rebuild cannot leave a watcher running behind a pause.
    fn start_watch(
        &self,
        settings: &SearchSettings,
        roots: &[IndexRoot],
        limit_bytes: u64,
    ) -> Result<(), String> {
        let mut watch = self
            .watch
            .lock()
            .map_err(|_| "search.unavailable".to_string())?;
        if let Some(mut handle) = watch.take() {
            handle.stop();
        }
        if self.paused.load(Ordering::SeqCst) {
            return Ok(());
        }
        let handle = search_index_watch::start(
            roots.to_vec(),
            settings.clone(),
            self.store.clone(),
            self.profile_dir.clone(),
            limit_bytes,
        )?;
        *watch = Some(handle);
        Ok(())
    }
}

fn search_settings(app: &AppHandle) -> SearchSettings {
    app.state::<AppState>()
        .settings
        .lock()
        .map(|settings| settings.search.clone())
        .unwrap_or_default()
}

fn limit_for(settings: &SearchSettings) -> u64 {
    db_limit_bytes(settings.index_limit_mb)
}

fn scan_options(settings: &SearchSettings) -> ScanOptions {
    ScanOptions {
        content_max_chars: settings.content_max_chars,
        excluded_paths: settings.excluded_paths.clone(),
        denied_roots: Vec::new(),
        ocr_allowed: true,
    }
}

fn code(error: SearchError) -> String {
    error.code().to_string()
}

/// True when `token` is still the rebuild recorded in the shared slot.
fn owns_rebuild_token(
    rebuild_cancel: &Arc<Mutex<Option<CancellationToken>>>,
    token: &CancellationToken,
) -> bool {
    rebuild_cancel
        .lock()
        .map(|running| {
            running
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, token))
        })
        .unwrap_or(false)
}

/// Clear the shared rebuild slot only if it still belongs to `token`.
fn release_rebuild_token(
    rebuild_cancel: &Arc<Mutex<Option<CancellationToken>>>,
    token: &CancellationToken,
) {
    if let Ok(mut running) = rebuild_cancel.lock() {
        if running
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, token))
        {
            *running = None;
        }
    }
}

fn with_store<T>(
    store: &Arc<Mutex<Option<SearchStore>>>,
    profile_dir: &Path,
    limit_bytes: u64,
    work: impl FnOnce(&mut SearchStore) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = store
        .lock()
        .map_err(|_| "search.unavailable".to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.limit_bytes() != limit_bytes {
            *guard = None;
        }
    }
    if guard.is_none() {
        *guard = Some(
            SearchStore::open(
                &profile_dir.join("search").join("index.sqlite3"),
                limit_bytes,
            )
            .map_err(code)?,
        );
    }
    work(guard.as_mut().ok_or_else(|| "search.unavailable".to_string())?)
}

fn search_job(
    store: &Arc<Mutex<Option<SearchStore>>>,
    cursors: &Arc<Mutex<CursorStore>>,
    profile_dir: &Path,
    limit_bytes: u64,
    query: SearchQuery,
    cursor: Option<String>,
    token: &CancellationToken,
) -> Result<SearchPage, String> {
    let mut guard = store
        .lock()
        .map_err(|_| "search.unavailable".to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.limit_bytes() != limit_bytes {
            *guard = None;
        }
    }
    if guard.is_none() {
        *guard = Some(
            SearchStore::open(
                &profile_dir.join("search").join("index.sqlite3"),
                limit_bytes,
            )
            .map_err(code)?,
        );
    }
    let store_ref = guard.as_ref().ok_or_else(|| "search.unavailable".to_string())?;
    let (query, offset) = if let Some(cursor_id) = cursor {
        let bound = cursors
            .lock()
            .map_err(|_| "search.unavailable".to_string())?
            .take(&cursor_id)
            .map_err(code)?;
        if bound.generation != store_ref.generation().map_err(code)? {
            return Err("search.changed".to_string());
        }
        (bound.query, bound.offset)
    } else {
        (query, 0)
    };
    let limit = if offset == 0 { FIRST_PAGE } else { PAGE_SIZE };
    let mut page = store_ref
        .search(
            &query,
            offset,
            limit,
            Instant::now() + REGEX_FIRST_BUDGET,
            token,
        )
        .map_err(code)?;
    if let Some(next_offset) = page.next_offset {
        let cursor_id = cursors
            .lock()
            .map_err(|_| "search.unavailable".to_string())?
            .insert(&query, page.generation, next_offset)
            .map_err(code)?;
        page.next_cursor = Some(cursor_id);
    }
    Ok(page)
}

#[tauri::command]
pub async fn search_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, SearchIndexState>,
    request_id: String,
    query: SearchQuery,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    query.validate().map_err(code)?;
    let settings = search_settings(&app);
    let limit = limit_for(&settings);
    let store = state.store.clone();
    let cursors = state.cursors.clone();
    let profile = state.profile_dir.clone();
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let page = search_job(
            &store,
            &cursors,
            &profile,
            limit,
            query,
            None,
            context.token(),
        )?;
        serde_json::to_value(page).map_err(|_| "search.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn search_page_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, SearchIndexState>,
    request_id: String,
    cursor: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    validate_uuid(&cursor).map_err(code)?;
    let settings = search_settings(&app);
    let limit = limit_for(&settings);
    let store = state.store.clone();
    let cursors = state.cursors.clone();
    let profile = state.profile_dir.clone();
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |context| {
        let page = search_job(
            &store,
            &cursors,
            &profile,
            limit,
            SearchQuery::default(),
            Some(cursor),
            context.token(),
        )?;
        serde_json::to_value(page).map_err(|_| "search.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn index_status(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, SearchIndexState>,
) -> Result<IndexStatus, String> {
    ensure_main(window.label())?;
    let settings = search_settings(&app);
    let store = state.store.clone();
    let profile = state.profile_dir.clone();
    let limit = limit_for(&settings);
    tauri::async_runtime::spawn_blocking(move || {
        with_store(&store, &profile, limit, |index| {
            index.status().map_err(code)
        })
    })
    .await
    .map_err(|_| "search.unavailable".to_string())?
}

#[allow(clippy::field_reassign_with_default)]
fn begin_rebuild(app: AppHandle, request_id: String, root_ids: Vec<String>) -> Result<(), String> {
    valid_request_id(&request_id)?;
    if root_ids.len() > MAX_ROOTS {
        return Err("search.invalid".to_string());
    }
    for id in &root_ids {
        validate_uuid(id).map_err(code)?;
    }
    let settings = search_settings(&app);
    let roots: Vec<IndexRoot> = if root_ids.is_empty() {
        settings.enabled_roots()
    } else {
        let selected: Vec<IndexRoot> = settings
            .roots
            .iter()
            .filter(|root| root_ids.contains(&root.id))
            .cloned()
            .collect();
        if selected.len() != root_ids.len() {
            return Err("search.denied".to_string());
        }
        selected
    };
    let all_roots = settings.roots.clone();
    let options = scan_options(&settings);
    let limit = limit_for(&settings);
    let state = app.state::<SearchIndexState>();
    let rebuild_cancel = state.rebuild_cancel.clone();
    let token = app.state::<Jobs>().begin(&request_id, 0)?;
    if let Ok(mut running) = rebuild_cancel.lock() {
        // A manual rebuild supersedes a running one; its job then sees that
        // it no longer owns the token and cannot start the watcher.
        if let Some(previous) = running.as_ref() {
            previous.store(true, Ordering::Relaxed);
        }
        *running = Some(token.clone());
    }
    // No watch events may race the full rebuild; the job stops the watcher
    // again right before it opens the store.
    state.stop_watch();
    let job_token = token.clone();
    spawn_job(app.clone(), request_id, token, move |context| {
        let state = app.state::<SearchIndexState>();
        // Only the current rebuild may stop the watcher here; a superseded
        // job must not tear down the watcher a newer rebuild already
        // started after its own pre-spawn stop.
        if owns_rebuild_token(&rebuild_cancel, &job_token) {
            state.stop_watch();
        }
        let mut guard = state.open_store(limit)?;
        let store_ref = guard.as_mut().ok_or_else(|| "search.unavailable".to_string())?;
        if context.token().load(Ordering::Relaxed) {
            // Paused or superseded before the first write: keep the
            // persisted pause instead of opening a new rebuild.
            let status = store_ref.status().map_err(code)?;
            drop(guard);
            release_rebuild_token(&rebuild_cancel, &job_token);
            return serde_json::to_value(status).map_err(|_| "search.failed".to_string());
        }
        store_ref.set_roots(&all_roots).map_err(code)?;
        let paused_intent = state.paused.load(Ordering::SeqCst);
        store_ref.begin_rebuild().map_err(code)?;
        if paused_intent {
            // `begin_rebuild` clears the stored pause; an explicit rebuild
            // still honours the user's pause when it finishes.
            store_ref.set_paused(true).map_err(code)?;
        }
        let registry = default_registry();
        let mut report = search_index::scan::ScanReport::default();
        // A pause that lands between `begin_rebuild` and the first root must
        // still finish as cancelled, not as a complete empty sweep.
        report.cancelled = context.token().load(Ordering::Relaxed);
        for root in &roots {
            if context
                .token()
                .load(std::sync::atomic::Ordering::Relaxed)
            {
                break;
            }
            let mut progress = |done: u64| {
                context.set_progress(&OpProgress {
                    items_done: done.min(usize::MAX as u64) as usize,
                    items_total: 0,
                    bytes_done: 0,
                    bytes_total: 0,
                    current: String::new(),
                });
            };
            let root_report = scan_root(
                store_ref,
                root,
                &options,
                &registry,
                context.token(),
                &mut progress,
            );
            report.scanned += root_report.scanned;
            report.inserted += root_report.inserted;
            report.updated += root_report.updated;
            report.unchanged += root_report.unchanged;
            report.skipped = report.skipped.saturating_add(root_report.skipped);
            report.ocr_files += root_report.ocr_files;
            report.limit_reached |= root_report.limit_reached;
            report.cancelled |= root_report.cancelled;
            report.errors.extend(root_report.errors);
            if root_report.limit_reached || root_report.cancelled {
                break;
            }
        }
        store_ref
            .finish_rebuild(report.skipped, report.cancelled)
            .map_err(code)?;
        if !report.errors.is_empty() {
            store_ref.set_reason("search.failed").map_err(code)?;
        }
        let status = store_ref.status().map_err(code)?;
        drop(guard);
        // Only the rebuild that still owns the token may restart the watcher:
        // a pause that arrived meanwhile wins, and an older rebuild cannot
        // restart the watcher over a newer one.
        let current = owns_rebuild_token(&rebuild_cancel, &job_token);
        if current && !status.paused && !status.limit_reached {
            let _ = state.start_watch(&settings, &settings.enabled_roots(), limit);
        }
        release_rebuild_token(&rebuild_cancel, &job_token);
        serde_json::to_value(status).map_err(|_| "search.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn index_rebuild_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    root_ids: Vec<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    begin_rebuild(app, request_id, root_ids)
}

/// Start the initial background build once the profile root and settings are
/// known. The coordinator calls this from setup; it never starts twice.
pub fn ensure_started(app: AppHandle) {
    let settings = search_settings(&app);
    if settings.roots.is_empty() {
        return;
    }
    let limit = limit_for(&settings);
    let (running, started) = {
        let state = app.state::<SearchIndexState>();
        // A persisted pause survives a restart: no build and no watcher
        // until the user resumes indexing.
        let persisted = with_store(&state.store, &state.profile_dir, limit, |index| {
            index.status().map_err(code)
        });
        let Ok(status) = persisted else {
            // Fail closed instead of building on an unknown state; an
            // explicit rebuild still surfaces the error.
            return;
        };
        state.paused.store(status.paused, Ordering::SeqCst);
        if status.paused {
            return;
        }
        let started = !state.started.swap(true, Ordering::SeqCst);
        let running = state
            .rebuild_cancel
            .lock()
            .map(|running| running.is_some())
            .unwrap_or(false);
        (running, started)
    };
    if running || !started {
        return;
    }
    let request = format!(
        "index-{}-1",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|age| age.as_millis())
            .unwrap_or(0)
    );
    let _ = begin_rebuild(app, request, Vec::new());
}

#[tauri::command]
pub async fn index_pause(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, SearchIndexState>,
    paused: bool,
) -> Result<IndexStatus, String> {
    ensure_main(window.label())?;
    let settings = search_settings(&app);
    let limit = limit_for(&settings);
    if paused {
        // The pause intent is recorded before anything else: a rebuild that
        // finishes during this call must not start the watcher again.
        state.paused.store(true, Ordering::SeqCst);
        // Cancel first so a rebuild holding the store releases it, then stop
        // and join the watcher (a batch may be scanning).
        if let Ok(running) = state.rebuild_cancel.lock() {
            if let Some(token) = running.as_ref() {
                token.store(true, Ordering::Relaxed);
            }
        }
        state.stop_watch();
    } else {
        state.paused.store(false, Ordering::SeqCst);
    }
    let store = state.store.clone();
    let profile = state.profile_dir.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        with_store(&store, &profile, limit, |index| {
            index.set_paused(paused).map_err(code)?;
            index.status().map_err(code)
        })
    })
    .await
    .map_err(|_| "search.unavailable".to_string())??;
    if !paused {
        // `start_watch` re-reads the pause flag under the watch lock, so a
        // pause that lands now still wins; a rebuild that is finishing may
        // restart the watcher too, and the two swaps stay serialized.
        let _ = state.start_watch(&settings, &settings.enabled_roots(), limit);
    }
    Ok(status)
}

#[tauri::command]
pub async fn saved_searches_list(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
) -> Result<Vec<SavedSearch>, String> {
    ensure_main(window.label())?;
    let directory = state.profile_dir.clone();
    tauri::async_runtime::spawn_blocking(move || SavedSearchStore::new(&directory).list())
        .await
        .map_err(|_| "search.unavailable".to_string())?
}

#[tauri::command]
pub async fn saved_search_save(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    search: SavedSearch,
) -> Result<SavedSearch, String> {
    ensure_main(window.label())?;
    let directory = state.profile_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        SavedSearchStore::new(&directory).save(search)
    })
    .await
    .map_err(|_| "search.unavailable".to_string())?
}

#[tauri::command]
pub async fn saved_search_remove(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let directory = state.profile_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        SavedSearchStore::new(&directory).remove(&id)
    })
    .await
    .map_err(|_| "search.unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{owns_rebuild_token, release_rebuild_token};
    use fs_service::CancellationToken;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    #[test]
    fn an_old_rebuild_cannot_release_the_new_token() {
        let slot: Arc<Mutex<Option<CancellationToken>>> = Arc::new(Mutex::new(None));
        let old: CancellationToken = Arc::new(AtomicBool::new(false));
        let new: CancellationToken = Arc::new(AtomicBool::new(false));
        *slot.lock().unwrap() = Some(old.clone());
        assert!(owns_rebuild_token(&slot, &old));
        // A manual rebuild replaces the token; the old job must neither
        // restart the watcher nor clear the newer rebuild slot.
        *slot.lock().unwrap() = Some(new.clone());
        assert!(!owns_rebuild_token(&slot, &old));
        release_rebuild_token(&slot, &old);
        assert!(slot.lock().unwrap().is_some());
        release_rebuild_token(&slot, &new);
        assert!(slot.lock().unwrap().is_none());
    }
}
