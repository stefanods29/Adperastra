//! Coalesced, revision-bound thumbnail jobs. Admission precedes every Jobs.begin.
use crate::background::{BackgroundPolicy, BackgroundTaskKind};
use crate::background_queue::{BackgroundError, BackgroundPriority, BackgroundScheduler};
use crate::cache::CacheService;
use crate::files::extension_of;
use crate::jobs::{JobContext, Jobs};
use crate::thumbnail_providers::{PreviewSource, ThumbnailProviderRegistry};
use crate::thumbnails::{ThumbnailReply, ThumbnailRequest, ThumbnailState};
use cache_store::{key_hash, CacheKey, CacheKind, CacheRecord};
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::source_stamp::SourceStamp;
use fs_service::CancellationToken;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
#[path = "thumbnail_consumers.rs"]
mod consumers;
#[path = "thumbnail_groups.rs"]
mod groups;
#[path = "thumbnail_render.rs"]
mod render;
use groups::{Group, Waiter};
#[path = "thumbnail_start.rs"]
mod start;
pub const THUMBNAIL_HANDLER: &str = "wic";
pub const THUMBNAIL_HANDLER_VERSION: u32 = 1;
#[derive(Clone)]
pub enum RenderOutcome {
    Ready(CacheRecord),
    State(ThumbnailState),
}
pub trait SourceInspector: Send + Sync {
    fn online_only(&self, path: &Path) -> Result<bool, String>;
}
pub struct WindowsSourceInspector;
impl SourceInspector for WindowsSourceInspector {
    fn online_only(&self, path: &Path) -> Result<bool, String> {
        crate::cache_stamp::online_only(path)
    }
}
pub struct ThumbnailService {
    cache: Arc<CacheService>,
    policy: Arc<BackgroundPolicy>,
    scheduler: Arc<BackgroundScheduler>,
    registry: Arc<ThumbnailProviderRegistry>,
    inspector: Arc<dyn SourceInspector>,
    groups: Mutex<HashMap<String, Arc<Group>>>,
    consumers: consumers::Consumers,
}
impl ThumbnailService {
    pub fn new(
        cache: Arc<CacheService>,
        policy: Arc<BackgroundPolicy>,
        scheduler: Arc<BackgroundScheduler>,
    ) -> Self {
        let registry = Arc::new(crate::thumbnail_providers::default_registry(Arc::clone(
            &cache,
        )));
        Self {
            cache,
            policy,
            scheduler,
            registry,
            inspector: Arc::new(WindowsSourceInspector),
            groups: Mutex::new(HashMap::new()),
            consumers: consumers::Consumers::default(),
        }
    }
    #[cfg(test)]
    pub(crate) fn for_test(
        cache: Arc<CacheService>,
        policy: Arc<BackgroundPolicy>,
        scheduler: Arc<BackgroundScheduler>,
        registry: Arc<ThumbnailProviderRegistry>,
        inspector: Arc<dyn SourceInspector>,
    ) -> Arc<Self> {
        Arc::new(Self {
            cache,
            policy,
            scheduler,
            registry,
            inspector,
            groups: Mutex::new(HashMap::new()),
            consumers: consumers::Consumers::default(),
        })
    }
    fn complete(&self, app: &AppHandle, group: &Group, outcome: Result<RenderOutcome, String>) {
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
                .filter(|waiter| waiter.job_token.is_some())
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
        outcome: &Result<RenderOutcome, String>,
    ) {
        let result = if waiter.consumer.cancelled.load(Ordering::Relaxed)
            || waiter
                .job_token
                .as_ref()
                .is_some_and(|token| token.load(Ordering::Relaxed))
        {
            Err("background.cancelled".to_string())
        } else {
            match outcome {
                Ok(RenderOutcome::Ready(record)) => match self.cache.lease(record) {
                    Ok(lease) => {
                        if waiter.consumer.install(&self.cache, lease.lease_id.clone()) {
                            Ok(json!(ThumbnailReply {
                                state: ThumbnailState::Ready,
                                lease: Some(lease)
                            }))
                        } else {
                            Err("background.cancelled".into())
                        }
                    }
                    Err(_) => Ok(json!(ThumbnailReply {
                        state: ThumbnailState::Unsupported,
                        lease: None
                    })),
                },
                Ok(RenderOutcome::State(state)) => Ok(json!(ThumbnailReply {
                    state: *state,
                    lease: None
                })),
                Err(code) => Err(code.clone()),
            }
        };
        app.state::<Jobs>().finish(&waiter.id, result);
    }
    pub fn release_consumer(&self, _app: &AppHandle, consumer: &Uuid) {
        self.scheduler.cancel_consumer(consumer);
        self.consumers.release(*consumer, &self.cache);
        if let Ok(mut groups) = self.groups.lock() {
            groups.retain(|_, group| {
                group.wake.notify_all();
                if group.all_cancelled() {
                    group.token.store(true, Ordering::Relaxed);
                    self.scheduler.cancel_consumer(&group.id);
                    group.wake.notify_all();
                    false
                } else {
                    true
                }
            });
        }
    }
    pub fn lookup(&self, request: &ThumbnailRequest) -> Result<Option<ThumbnailReply>, String> {
        validate_request(request)?;
        let consumer = self.consumers.register(
            Uuid::parse_str(&request.consumer_id).map_err(|_| "thumbnail.bad_request")?,
        )?;
        let (idle, ac) = self.policy.samples();
        if !self
            .policy
            .eligible(BackgroundTaskKind::Thumbnails, idle, ac)
        {
            return Ok(Some(ThumbnailReply {
                state: ThumbnailState::Paused,
                lease: None,
            }));
        }
        if self
            .inspector
            .online_only(Path::new(&request.path))
            .unwrap_or(true)
        {
            return Ok(Some(ThumbnailReply {
                state: ThumbnailState::OnlineOnly,
                lease: None,
            }));
        }
        let expected = self
            .cache
            .source_stamp(Path::new(&request.path))
            .map_err(stamp_code)?;
        let Some(record) = self.cache.lookup(&thumbnail_key(&expected, request.edge))? else {
            return Ok(None);
        };
        if consumer.cancelled.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        if self
            .cache
            .source_stamp(Path::new(&request.path))
            .map_err(stamp_code)?
            != expected
        {
            return Ok(None);
        }
        match self.cache.lease(&record) {
            Ok(lease) => {
                if consumer.install(&self.cache, lease.lease_id.clone()) {
                    Ok(Some(ThumbnailReply {
                        state: ThumbnailState::Ready,
                        lease: Some(lease),
                    }))
                } else {
                    Err("background.cancelled".into())
                }
            }
            Err(_) => Ok(None),
        }
    }
}
fn validate_request(request: &ThumbnailRequest) -> Result<(), String> {
    if request.path.encode_utf16().count() > 32768 {
        return Err("thumbnail.bad_request".into());
    }
    crate::validate_absolute_path(&request.path)
        .map_err(|_| "thumbnail.bad_request".to_string())?;
    if !crate::thumbnail_helper::THUMBNAIL_EDGES.contains(&request.edge)
        || Uuid::parse_str(&request.consumer_id).is_err()
    {
        return Err("thumbnail.bad_request".into());
    }
    Ok(())
}
pub fn thumbnail_key(stamp: &SourceStamp, edge: u32) -> CacheKey {
    CacheKey {
        source: stamp.clone(),
        kind: CacheKind::Thumbnail,
        handler_id: THUMBNAIL_HANDLER.into(),
        handler_version: THUMBNAIL_HANDLER_VERSION,
        options_key: format!("edge={edge}"),
    }
}
fn stamp_code(error: String) -> String {
    match error.as_str() {
        "cache.bad_request" => "thumbnail.bad_request",
        "cache.changed" => "thumbnail.changed",
        _ => "thumbnail.failed",
    }
    .into()
}
fn admission_code(error: BackgroundError) -> String {
    match error {
        BackgroundError::Busy => "thumbnail.busy",
        BackgroundError::Paused => "background.paused",
        BackgroundError::Cancelled => "background.cancelled",
        BackgroundError::Unavailable => "background.unavailable",
    }
    .into()
}
#[cfg(test)]
#[path = "thumbnail_jobs_tests.rs"]
mod tests;
