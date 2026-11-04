//! Gallery commands (Step 07c, export E4).
//!
//! `gallery_start` validates and authorizes the sources, registers a bounded
//! session and starts the discovery job. The returned job result is the first
//! page; the scan keeps running so `gallery_page` can fetch the rest.
//! `gallery_close` is idempotent and cancels every consumer and watcher.
//!
//! The scan holds one background `metadata` permit (07a E10) for its whole
//! lifetime, so a paused policy never reads a source and the foreground UI
//! keeps working.

use crate::gallery_scan::{GalleryScanConfig, GalleryScanShared, SystemGalleryLister};
use crate::gallery_sessions::FIRST_PAGE_TIMEOUT;
use crate::gallery_types::{
    parse_date_source, validate_sources, GalleryPage, GalleryStartRequest, MAX_GALLERY_SOURCES,
};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub use crate::gallery_sessions::GallerySessions;

/// The UI hears this once per scan; it regroups the loaded rows and shows the
/// partial notice without fetching the remaining 250,000 pages.
#[derive(Debug, Clone, Serialize)]
pub struct GalleryScanFinished {
    pub generation: String,
    pub complete: bool,
    pub partial: bool,
    pub skipped_count: u32,
    pub limit_reason: Option<String>,
}

fn map_background_error(error: crate::background_queue::BackgroundError) -> String {
    use crate::background_queue::BackgroundError;
    match error {
        BackgroundError::Paused => "background.paused".to_string(),
        BackgroundError::Busy => "background.busy".to_string(),
        BackgroundError::Cancelled => "background.cancelled".to_string(),
        BackgroundError::Unavailable => "background.unavailable".to_string(),
    }
}

fn validate_start(request: &GalleryStartRequest) -> Result<(), String> {
    if crate::valid_request_id(&request.request_id).is_err() {
        return Err("gallery.bad_request".to_string());
    }
    if request.sources.is_empty() {
        return Err("gallery.bad_request".to_string());
    }
    if request.sources.len() > MAX_GALLERY_SOURCES {
        return Err("gallery.too_many".to_string());
    }
    validate_sources(&request.sources)?;
    parse_date_source(&request.date_source)?;
    Ok(())
}

/// Starts a Gallery scan. The shared job's result is the first `GalleryPage`.
#[tauri::command]
pub async fn gallery_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, crate::jobs::Jobs>,
    sessions: State<'_, GallerySessions>,
    request: GalleryStartRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    validate_start(&request)?;
    let policy = app.state::<Arc<crate::background::BackgroundPolicy>>();
    let (idle, ac) = policy.samples();
    if !policy.eligible(crate::background::BackgroundTaskKind::Metadata, idle, ac) {
        return Err("background.paused".into());
    }
    let date_source = parse_date_source(&request.date_source)?;
    let generation = uuid::Uuid::new_v4().to_string();
    let token = jobs
        .begin(&request.request_id, 0)
        .map_err(|_| "gallery.unavailable".to_string())?;
    let manager = sessions.inner().clone();
    let sources_for_session = request.sources.clone();
    let session_token = token.clone();
    let session_app = app.clone();
    let session = match tauri::async_runtime::spawn_blocking(move || {
        manager.admit(
            &generation,
            date_source,
            sources_for_session,
            session_token,
            session_app,
        )
    })
    .await
    {
        Ok(Ok(session)) => session,
        outcome => {
            let error = match outcome {
                Ok(Err(error)) => error,
                _ => "gallery.unavailable".into(),
            };
            jobs.finish(&request.request_id, Err(error.clone()));
            let _ = jobs.poll(&request.request_id);
            return Err(error);
        }
    };

    let config = GalleryScanConfig {
        show_hidden: request.show_hidden,
        show_system: request.show_system,
        ..GalleryScanConfig::default()
    };
    let sources = request.sources;
    let scan_session = session.clone();
    let scan_token = token.clone();
    let task_app = app.clone();
    let finish_app = app.clone();
    let finish_generation = session.generation.clone();
    let scan_for_flags = session.scan.clone();
    tauri::async_runtime::spawn(async move {
        let Some(scheduler) =
            task_app.try_state::<Arc<crate::background_queue::BackgroundScheduler>>()
        else {
            scan_session.set_start_error("background.unavailable".to_string());
            return;
        };
        let consumer = uuid::Uuid::new_v4();
        match scheduler
            .acquire(
                crate::background::BackgroundTaskKind::Metadata,
                consumer,
                crate::background_queue::BackgroundPriority::Visible,
                scan_token.clone(),
            )
            .await
        {
            Ok(permit) => {
                let lister: Arc<dyn crate::gallery_scan::GalleryLister> =
                    Arc::new(SystemGalleryLister::new());
                let sink: Arc<GalleryScanShared> = scan_for_flags.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let _permit = permit;
                    crate::gallery_scan::run_scan(&sources, &config, lister, scan_token, sink);
                    let (complete, partial, skipped_count, limit_reason) = scan_for_flags.flags();
                    let _ = finish_app.emit(
                        "gallery-scan-finished",
                        GalleryScanFinished {
                            generation: finish_generation,
                            complete,
                            partial,
                            skipped_count,
                            limit_reason,
                        },
                    );
                })
                .await;
            }
            Err(error) => scan_session.set_start_error(map_background_error(error)),
        }
    });

    let job_session = session;
    let job_app = app.clone();
    let job_generation = job_session.generation.clone();
    let request_id = request.request_id;
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let close = || {
            job_session.close();
            let _ = job_app.state::<GallerySessions>().close(&job_generation);
        };
        if context.token().load(Ordering::Relaxed) {
            close();
            return Err("gallery.changed".to_string());
        }
        match job_session.wait_for_first_page(FIRST_PAGE_TIMEOUT) {
            Ok(page) => serde_json::to_value(page).map_err(|_| "gallery.unavailable".to_string()),
            Err(error) => {
                close();
                Err(error)
            }
        }
    });
    Ok(())
}

/// Fetches one page of a started scan. A foreign or expired cursor is
/// `gallery.changed`; the UI then offers Refresh.
#[tauri::command]
pub async fn gallery_page(
    window: WebviewWindow,
    sessions: State<'_, GallerySessions>,
    generation: String,
    cursor: Option<String>,
) -> Result<GalleryPage, String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::parse_str(&generation).is_err() {
        return Err("gallery.changed".to_string());
    }
    if let Some(cursor) = &cursor {
        if cursor.is_empty() || cursor.len() > 128 {
            return Err("gallery.bad_request".to_string());
        }
    }
    let session = sessions
        .get(&generation)?
        .ok_or_else(|| "gallery.changed".to_string())?;
    tauri::async_runtime::spawn_blocking(move || session.page(cursor.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

/// Closes a scan; idempotent. Every consumer and source watcher is released.
#[tauri::command]
pub async fn gallery_close(
    window: WebviewWindow,
    sessions: State<'_, GallerySessions>,
    generation: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::parse_str(&generation).is_err() {
        return Err("gallery.bad_request".to_string());
    }
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || sessions.close(&generation))
        .await
        .map_err(|_| "gallery.unavailable".to_string())?
}

/// Inactive views stop discovery immediately; their watchers have a 30s UI grace.
#[tauri::command]
pub async fn gallery_active(
    window: WebviewWindow,
    sessions: State<'_, GallerySessions>,
    generation: String,
    active: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if uuid::Uuid::parse_str(&generation).is_err() {
        return Err("gallery.bad_request".into());
    }
    sessions.set_active(&generation, active)
}

/// Windows' folder picker for Gallery sources. The title is the translated
/// `gallery.addFolder` label; it is validated like every other dialog title.
#[tauri::command]
pub async fn gallery_pick_source(
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
) -> Result<Option<String>, String> {
    crate::ensure_main(window.label())?;
    let language = state
        .settings
        .lock()
        .map_err(|_| "gallery.unavailable")?
        .language
        .clone();
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        // Text has exactly one source, the canonical locale JSON. The IPC
        // caller cannot choose a different dialog message.
        let locale = match language.as_str() {
            "es" => include_str!("../../src/i18n/locales/es.json"),
            "pseudo" => include_str!("../../src/i18n/locales/pseudo.json"),
            _ => include_str!("../../src/i18n/locales/en.json"),
        };
        let values: serde_json::Value =
            serde_json::from_str(locale).map_err(|_| "gallery.unavailable")?;
        let title = values
            .pointer("/gallery/addFolder")
            .and_then(|value| value.as_str())
            .ok_or("gallery.unavailable")?;
        crate::file_dialogs::pick_folder_path(owner, title)
    })
    .await
    .map_err(|_| "dialog.failed".to_string())?
}
