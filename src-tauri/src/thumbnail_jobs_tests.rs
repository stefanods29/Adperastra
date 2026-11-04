use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use cache_store::CacheKind;
use fs_service::source_stamp::capture_source_stamp;
use tempfile::tempdir;

use crate::background::{BackgroundPolicy, BackgroundSettings, BackgroundTaskKind};
use crate::background_queue::BackgroundScheduler;
use crate::background_windows::WindowsBackgroundState;
use crate::cache::CacheService;
use crate::files::FileGrants;
use crate::thumbnail_jobs::{thumbnail_key, RenderOutcome, SourceInspector, ThumbnailService};
use crate::thumbnail_providers::{
    PreparedThumbnail, PreviewSource, ThumbnailProvider, ThumbnailProviderRegistry,
};
use crate::thumbnails::ThumbnailState;

struct Online(bool);
impl SourceInspector for Online {
    fn online_only(&self, _path: &std::path::Path) -> Result<bool, String> {
        Ok(self.0)
    }
}

struct CountingProvider {
    calls: Arc<AtomicUsize>,
}

impl ThumbnailProvider for CountingProvider {
    fn id(&self) -> &'static str {
        "counting"
    }
    fn version(&self) -> u32 {
        1
    }
    fn supports(&self, _source: &PreviewSource) -> bool {
        self.calls.fetch_add(1, Ordering::Relaxed);
        true
    }
    fn produce(
        &self,
        _source: &PreviewSource,
        _edge: u32,
        _context: &crate::jobs::JobContext,
    ) -> Result<PreparedThumbnail, String> {
        Err("thumbnail.failed".to_string())
    }
}

fn service(online: bool, calls: Arc<AtomicUsize>) -> (Arc<ThumbnailService>, tempfile::TempDir) {
    let data = tempdir().unwrap();
    let grants = Arc::new(FileGrants::default());
    let cache = Arc::new(CacheService::new(data.path().to_path_buf(), grants));
    let scheduler = Arc::new(BackgroundScheduler::new());
    let policy = Arc::new(BackgroundPolicy::new(
        BackgroundSettings::default(),
        Arc::clone(&scheduler),
        WindowsBackgroundState::start(),
    ));
    policy
        .register(BackgroundTaskKind::Thumbnails, true)
        .unwrap();
    let mut registry = ThumbnailProviderRegistry::new();
    registry
        .register(Arc::new(CountingProvider { calls }))
        .unwrap();
    let service = ThumbnailService::for_test(
        cache,
        policy,
        scheduler,
        Arc::new(registry),
        Arc::new(Online(online)),
    );
    (service, data)
}

#[test]
fn an_online_only_source_never_reaches_a_provider() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("cloud.png");
    std::fs::write(&path, b"not read").unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let (service, _data) = service(true, Arc::clone(&calls));
    let stamp = capture_source_stamp(&path).unwrap();
    let key = thumbnail_key(&stamp, 128);
    let outcome = service.render_request(
        &key,
        &path.to_string_lossy(),
        &stamp,
        128,
        &fs_service::new_cancellation_token(),
        None,
    );
    assert!(matches!(
        outcome,
        Ok(RenderOutcome::State(ThumbnailState::OnlineOnly))
    ));
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    assert_eq!(std::fs::read(&path).unwrap(), b"not read");
}

#[test]
fn an_old_stamp_is_rejected_before_a_provider() {
    use std::time::{Duration, UNIX_EPOCH};
    let dir = tempdir().unwrap();
    let path = dir.path().join("photo.png");
    std::fs::write(&path, b"first").unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let (service, _data) = service(false, Arc::clone(&calls));
    let stamp = capture_source_stamp(&path).unwrap();
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_millis(1_700_000_000_500))
        .unwrap();
    drop(file);
    let key = thumbnail_key(&stamp, 128);
    let outcome = service.render_request(
        &key,
        &path.to_string_lossy(),
        &stamp,
        128,
        &fs_service::new_cancellation_token(),
        None,
    );
    assert!(matches!(
        outcome,
        Ok(RenderOutcome::State(ThumbnailState::Unsupported))
    ));
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    assert_eq!(key.kind, CacheKind::Thumbnail);
}
