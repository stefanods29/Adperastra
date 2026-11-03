//! Shared preview services, initialized once for the application.

use std::sync::Arc;
use tauri::{App, AppHandle, Manager};

use crate::{
    background, background_queue, background_windows, cache, files, metadata_jobs,
    metadata_preview, thumbnail_jobs,
};
use crate::{AppState, Settings};

pub fn initialize(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let (data_dir, settings) = {
        let state = app.state::<AppState>();
        let settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned")?;
        (state.data_dir.clone(), settings.clone())
    };
    let scheduler = Arc::new(background_queue::BackgroundScheduler::new());
    let policy = Arc::new(background::BackgroundPolicy::new(
        settings.background.clone(),
        Arc::clone(&scheduler),
        background_windows::WindowsBackgroundState::start(),
    ));
    scheduler.set_policy(Arc::downgrade(&policy));
    policy.register(background::BackgroundTaskKind::Thumbnails, true)?;
    metadata_jobs::register_background(&policy)?;
    let grants = Arc::clone(app.state::<Arc<files::FileGrants>>().inner());
    let cache = Arc::new(cache::CacheService::new(data_dir, grants));
    cache.set_limit_bytes(settings.cache.limit_bytes());
    let thumbnails = Arc::new(thumbnail_jobs::ThumbnailService::new(
        Arc::clone(&cache),
        Arc::clone(&policy),
        Arc::clone(&scheduler),
    ));
    let metadata = Arc::new(metadata_jobs::MetadataService::new(
        Arc::clone(&cache),
        Arc::clone(&policy),
        Arc::clone(&scheduler),
    ));
    app.manage(scheduler);
    app.manage(policy);
    app.manage(cache);
    app.manage(thumbnails);
    app.manage(metadata);
    app.manage(Arc::new(metadata_preview::PreviewGrants::default()));
    Ok(())
}

pub fn apply_settings(app: &AppHandle, settings: &Settings) {
    if let Some(policy) = app.try_state::<Arc<background::BackgroundPolicy>>() {
        policy.set_settings(&settings.background);
    }
    if let Some(cache) = app.try_state::<Arc<cache::CacheService>>() {
        cache.set_limit_bytes(settings.cache.limit_bytes());
    }
}
