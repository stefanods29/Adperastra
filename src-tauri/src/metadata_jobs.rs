//! Revision-bound metadata jobs. One group permit/helper; distinct consumer cancellation.
use crate::{
    background::{BackgroundPolicy, BackgroundTaskKind},
    background_queue::{BackgroundError, BackgroundPriority, BackgroundScheduler},
    cache::CacheService,
    jobs::{JobContext, Jobs},
    metadata_providers::{MetadataProvider, MetadataProviderRegistry},
    metadata_types::{validate_request, MetadataInfo, MetadataRequest},
};
use cache_store::{key_hash, CacheKey, CacheKind};
use fs_service::{CancellationToken, SourceStamp};
use std::{
    collections::HashMap,
    path::Path,
    sync::{atomic::Ordering, Arc, Mutex},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;
#[path = "metadata_consumers.rs"]
mod consumers;
#[path = "metadata_groups.rs"]
mod groups;
#[path = "metadata_pipeline.rs"]
mod pipeline;
#[path = "metadata_start.rs"]
mod start;
use groups::{Group, Waiter};
pub const MAX_ACTIVE_CONSUMERS: usize = 128;
pub const MAX_CACHED_BYTES: u64 = crate::metadata_types::MAX_SERIALIZED_BYTES as u64;
pub const CACHE_HANDLER_ID: &str = "windows-properties";
pub const CACHE_HANDLER_VERSION: u32 = 1;
pub const CACHE_OPTIONS_KEY: &str = "schema=1";
pub struct MetadataService {
    cache: Arc<CacheService>,
    policy: Arc<BackgroundPolicy>,
    scheduler: Arc<BackgroundScheduler>,
    registry: Mutex<MetadataProviderRegistry>,
    groups: Mutex<HashMap<String, Arc<Group>>>,
    consumers: consumers::Consumers,
}
impl MetadataService {
    pub fn new(
        cache: Arc<CacheService>,
        policy: Arc<BackgroundPolicy>,
        scheduler: Arc<BackgroundScheduler>,
    ) -> Self {
        Self {
            cache,
            policy,
            scheduler,
            registry: Mutex::new(crate::metadata_providers::default_registry()),
            groups: Mutex::new(HashMap::new()),
            consumers: consumers::Consumers::default(),
        }
    }
    #[allow(dead_code)] // Registration API for later preview providers (Step 07g).
    pub fn register_provider(
        &self,
        provider: Arc<dyn MetadataProvider + Send + Sync>,
    ) -> Result<(), String> {
        self.registry
            .lock()
            .map_err(|_| "metadata.failed")?
            .register(provider)
    }
    fn complete(&self, app: &AppHandle, group: &Group, outcome: Result<MetadataInfo, String>) {
        let waiters = {
            let Ok(mut state) = group.state.lock() else {
                return;
            };
            if state.outcome.is_some() {
                return;
            }
            state.outcome = Some(outcome.clone());
            group.wake.notify_all();
            state
                .waiters
                .iter()
                .filter(|w| w.job_token.is_some())
                .cloned()
                .collect::<Vec<_>>()
        };
        for waiter in waiters {
            self.finish_waiter(app, &waiter, &outcome);
        }
    }
    fn finish_waiter(
        &self,
        app: &AppHandle,
        waiter: &Waiter,
        outcome: &Result<MetadataInfo, String>,
    ) {
        let result = if waiter.consumer.token.load(Ordering::Relaxed)
            || waiter
                .job_token
                .as_ref()
                .is_some_and(|t| t.load(Ordering::Relaxed))
        {
            Err("background.cancelled".into())
        } else {
            outcome
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|info| serde_json::to_value(info).map_err(|_| "metadata.failed".into()))
        };
        app.state::<Jobs>().finish(&waiter.id, result);
    }
    pub fn release_consumer(&self, id: Uuid) {
        self.consumers.release(id);
        if let Ok(mut groups) = self.groups.lock() {
            groups.retain(|_, group| {
                group.wake.notify_all();
                if group.all_cancelled() {
                    group.token.store(true, Ordering::Relaxed);
                    self.scheduler.cancel_consumer(&group.id);
                    false
                } else {
                    true
                }
            });
        }
    }
}
pub fn cache_key(source: &SourceStamp) -> CacheKey {
    CacheKey {
        source: source.clone(),
        kind: CacheKind::Metadata,
        handler_id: CACHE_HANDLER_ID.into(),
        handler_version: CACHE_HANDLER_VERSION,
        options_key: CACHE_OPTIONS_KEY.into(),
    }
}
fn stamp_code(error: String) -> String {
    match error.as_str() {
        "cache.bad_request" => "metadata.bad_request",
        "cache.changed" => "metadata.changed",
        _ => "metadata.failed",
    }
    .into()
}
fn admission_code(error: BackgroundError) -> String {
    match error {
        BackgroundError::Busy => "background.busy",
        BackgroundError::Paused => "background.paused",
        BackgroundError::Cancelled => "background.cancelled",
        BackgroundError::Unavailable => "background.unavailable",
    }
    .into()
}
pub fn register_background(policy: &BackgroundPolicy) -> Result<(), String> {
    policy.register(BackgroundTaskKind::Metadata, true)
}
#[tauri::command]
pub async fn metadata_read_start(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, Arc<MetadataService>>,
    request_id: String,
    request: MetadataRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_request(&request)?;
    Arc::clone(service.inner())
        .start(app, request_id, request)
        .await
}
#[tauri::command]
pub async fn metadata_release(
    window: WebviewWindow,
    service: State<'_, Arc<MetadataService>>,
    consumer_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let id = Uuid::parse_str(&consumer_id).map_err(|_| "metadata.bad_request")?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.release_consumer(id))
        .await
        .map_err(|_| "metadata.failed".to_string())?;
    Ok(())
}
#[cfg(test)]
#[path = "metadata_jobs_tests.rs"]
mod tests;
