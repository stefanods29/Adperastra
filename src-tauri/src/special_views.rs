//! Special-view commands E1-E5 (Step 07g).
//!
//! Every command checks the main window, a UUID/enum/path and the source
//! stamp. Disk work runs in shared jobs; the map lock is never held while a
//! helper works. Closing is idempotent and releases every lease.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::cache::CacheService;
use crate::jobs::{spawn_job, Jobs};
use crate::special_view_backend::NativeSpecialBackend;
use crate::special_view_jobs::{open_session, read_psd_page, refresh_raw_preview};
use crate::special_view_session::SpecialViews;
use crate::special_view_types::{SceneInfo, SpecialKind, SPECIAL_MAX_SOURCE_BYTES};
use crate::thumbnail_providers::PreviewSource;
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource};

fn bad_request() -> String {
    "special_view.bad_request".to_string()
}

fn validate_session_id(value: &str) -> Result<(), String> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| bad_request())
}

fn validate_cursor(value: Option<&str>) -> Result<(), String> {
    match value {
        Some(cursor) => validate_session_id(cursor),
        None => Ok(()),
    }
}

/// Shared with the 07b metadata and 07a thumbnail providers.
pub(crate) fn grant_for(source: &PreviewSource) -> HelperInputGrant {
    HelperInputGrant {
        grant_id: Uuid::new_v4(),
        name: source
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "source".to_string()),
        mime: source.mime.clone(),
        source: HelperInputSource::Disk {
            path: source.path.clone(),
            expected: source.stamp.clone(),
            pinned: source.pinned.clone(),
        },
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn special_view_open_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    path: String,
    kind: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&path).map_err(|_| bad_request())?;
    let kind = SpecialKind::parse(&kind)?;
    let token = jobs.begin(&request_id, 1)?;
    let target = PathBuf::from(path);
    spawn_job(app.clone(), request_id, token, move |context| {
        let cache = app.state::<Arc<CacheService>>();
        let views = app.state::<SpecialViews>();
        let source = cache.source_stamp(&target)?;
        if source.size_bytes == 0 || source.size_bytes > SPECIAL_MAX_SOURCE_BYTES {
            return Err("special_view.too_large".to_string());
        }
        let cache = app.state::<Arc<CacheService>>();
        let backend = NativeSpecialBackend {
            cache: Arc::clone(cache.inner()),
            cancel: context.token().clone(),
            data_dir: app.state::<crate::AppState>().data_dir.clone(),
        };
        let session = open_session(
            &backend,
            &views,
            &cache,
            source,
            &target,
            kind,
            context.token(),
        )?;
        serde_json::to_value(session).map_err(|_| "special_view.unavailable".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn special_view_scene(
    window: WebviewWindow,
    views: State<'_, SpecialViews>,
    session_id: String,
) -> Result<SceneInfo, String> {
    crate::ensure_main(window.label())?;
    validate_session_id(&session_id)?;
    let state = views.get(&session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "special view lock poisoned".to_string())?;
    guard
        .scene
        .clone()
        .ok_or_else(|| "special_view.unsupported".to_string())
}

#[tauri::command]
pub async fn special_view_raw_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    session_id: String,
    edge: u32,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_session_id(&session_id)?;
    if edge == 0 || edge > crate::special_view_types::SPECIAL_MAX_EDGE {
        return Err(bad_request());
    }
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app.clone(), request_id, token, move |context| {
        let views = app.state::<SpecialViews>();
        let state = views.get(&session_id)?;
        let mut work = state
            .lock()
            .map_err(|_| "special_view.unavailable")?
            .take_work(Some(context.token().clone()))?;
        if work.kind != SpecialKind::Raw {
            return finish_work(
                &state,
                work,
                &app.state::<Arc<CacheService>>(),
                Err(bad_request()),
            );
        }
        let cache = app.state::<Arc<CacheService>>();
        let backend = NativeSpecialBackend {
            cache: Arc::clone(cache.inner()),
            cancel: work.cancel.clone(),
            data_dir: app.state::<crate::AppState>().data_dir.clone(),
        };
        let cache = app.state::<Arc<CacheService>>();
        let path = PathBuf::from(&work.source.path_key);
        let session =
            refresh_raw_preview(&backend, &cache, &mut work, &path, edge, context.token());
        let session = finish_work(&state, work, &cache, session)?;
        serde_json::to_value(session).map_err(|_| "special_view.unavailable".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn special_view_layers(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    cursor: Option<String>,
) -> Result<crate::special_view_types::PsdInfo, String> {
    crate::ensure_main(window.label())?;
    validate_session_id(&session_id)?;
    validate_cursor(cursor.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let views = app.state::<SpecialViews>();
        let state = views.get(&session_id)?;
        let mut work = state
            .lock()
            .map_err(|_| "special_view.unavailable")?
            .take_work(None)?;
        let cache = app.state::<Arc<CacheService>>();
        let backend = NativeSpecialBackend {
            cache: Arc::clone(cache.inner()),
            cancel: work.cancel.clone(),
            data_dir: app.state::<crate::AppState>().data_dir.clone(),
        };
        let result = read_psd_page(&backend, &mut work, cursor.as_deref());
        finish_work(&state, work, &cache, result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn special_view_close(
    window: WebviewWindow,
    views: State<'_, SpecialViews>,
    cache: State<'_, Arc<CacheService>>,
    session_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    validate_session_id(&session_id)?;
    let Some(state) = views.remove(&session_id) else {
        return Ok(());
    };
    let cache = Arc::clone(cache.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state
            .lock()
            .map_err(|_| "special view lock poisoned".to_string())?;
        guard.closed = true;
        guard
            .cancel
            .store(true, std::sync::atomic::Ordering::Relaxed);
        for lease in guard.leases() {
            let _ = cache.release(&lease);
        }
        guard.preview = None;
        guard.scene = None;
        let helper = guard.psd_helper.take();
        drop(guard);
        if let Some(mut helper) = helper {
            let _ = helper.close();
        }
        Ok(())
    })
    .await
    .map_err(|_| "special_view.unavailable".to_string())?
}

fn finish_work<T>(
    state: &Arc<std::sync::Mutex<crate::special_view_session::SpecialSessionState>>,
    mut work: crate::special_view_session::SpecialSessionState,
    cache: &CacheService,
    result: Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.lock().map_err(|_| "special_view.unavailable")?;
    if guard.closed || work.cancel.load(std::sync::atomic::Ordering::Relaxed) {
        guard.busy = false;
        drop(guard);
        for lease in work.leases() {
            let _ = cache.release(&lease);
        }
        if let Some(mut helper) = work.psd_helper.take() {
            let _ = helper.close();
        }
        Err("background.cancelled".into())
    } else {
        work.busy = false;
        *guard = work;
        result
    }
}
