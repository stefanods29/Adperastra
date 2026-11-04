//! Leased media sample previews (Step 12b T3, E2).
//!
//! A preview is at most three seconds of the source, decoded by the media
//! engine at a 512 px edge and stored in the shared preview cache as a leased
//! artifact. The full file is never converted just to show a sample (D6), the
//! source is never modified, and the reply is bound to the exact source
//! revision and to the newest UI request, so a slower earlier sample can never
//! replace a newer picture.
//!
//! Publishing goes through the shared cache service. The small trait below is
//! the seam 07a's `CacheService` implements with its own store and leases;
//! nothing here touches private cache state.
#![allow(dead_code)]


use std::fs::File;
use std::sync::Arc;

use cache_store::{CacheKey, CacheLease, CacheRecord};
use convert::MediaConversionOptions;
use fs_service::owned_io::PinnedDirectory;
use fs_service::SourceStamp;
use tauri::{AppHandle, State, WebviewWindow};

use crate::cache::CacheService;
use crate::engine_process::EngineHost;
use crate::engine_types::{
    DiskConversionInput, EngineAction, EngineInput, EngineRequest, EngineSource, MediaPreview,
    PREVIEW_SAMPLE_US, PREVIEW_TIMEOUT_MS,
};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::media_probe;
use crate::{ensure_main, valid_request_id};

/// The preview provider version, part of the cache key (07a D4).
pub const PREVIEW_HANDLER_ID: &str = "media-engine";
/// Bumped whenever the sample pipeline changes what it produces.
pub const PREVIEW_HANDLER_VERSION: u32 = 1;
/// The cache key options of one sample, independent of raw user JSON.
pub fn preview_options_key(
    start_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    keep_metadata: bool,
) -> String {
    format!(
        "v1;start={};w={};h={};keep={}",
        start_ms.unwrap_or(0),
        width.unwrap_or(0),
        height.unwrap_or(0),
        keep_metadata
    )
}

/// The cache publishing seam 07a's service implements.
pub trait PreviewCache {
    /// Store one completed sample and return its record.
    fn publish_preview(
        &self,
        key: &CacheKey,
        file: &File,
        mime: &str,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<CacheRecord, String>;

    /// Lease a record so the UI may read it until it is released.
    fn lease_preview(&self, record: &CacheRecord) -> Result<CacheLease, String>;
}

/// The sample window inside the source: start and length, both microseconds.
pub fn sample_bounds(start_ms: Option<u64>, duration_us: u64) -> (u64, u64) {
    let start = start_ms
        .map(|millis| millis.saturating_mul(1000))
        .unwrap_or(0)
        .min(duration_us);
    let length = PREVIEW_SAMPLE_US.min(duration_us.saturating_sub(start));
    (start, length)
}

/// True when a sample still describes the source the UI is showing.
pub fn accept_sample(
    expected_stamp: &SourceStamp,
    current_stamp: &SourceStamp,
    generation: u64,
    latest_generation: u64,
) -> bool {
    expected_stamp == current_stamp && generation == latest_generation
}

/// Ask the engine for one sample and publish it to the cache.
pub fn preview_disk_input(
    host: &EngineHost,
    cache: &dyn PreviewCache,
    input: DiskConversionInput,
    stamp: SourceStamp,
    options: MediaConversionOptions,
    work_dir: PinnedDirectory,
    context: &JobContext,
) -> Result<MediaPreview, String> {
    // The sample window is chosen from the real duration, so a huge start
    // never asks the engine for a negative or empty range.
    let info = media_probe::probe_disk_input(host, input.clone(), stamp.clone(), context)?;
    let (start, length) = sample_bounds(options.start_ms, info.duration_us);
    if length == 0 {
        return Err(crate::engine_types::EngineError::Unsupported.message());
    }
    let mut sample_options = options.clone();
    sample_options.start_ms = Some(start / 1000);
    sample_options.end_ms = None;

    let path = std::path::PathBuf::from(&input.path);
    let identity = fs_service::owned_io::SourceIdentity::capture(&path)
        .map_err(|_| crate::engine_types::EngineError::Changed.message())?;
    let pinned = fs_service::owned_io::PinnedSource::open(&path, &identity)
        .map_err(|_| crate::engine_types::EngineError::Changed.message())?;
    let engine_input = EngineInput {
        input_index: 0,
        original: convert::ConversionInput::File {
            path: input.path.clone(),
            expected: Some(stamp.clone()),
        },
        stamp: Some(stamp.clone()),
        source: EngineSource::Disk(pinned),
        sensitive: false,
    };
    let request = EngineRequest {
        request_id: uuid::Uuid::new_v4(),
        timeout_ms: PREVIEW_TIMEOUT_MS,
        work_dir,
        action: EngineAction::PreviewMedia {
            inputs: vec![engine_input],
            options: sample_options,
        },
    };
    let run = host.run_capture(&request, context)?;
    if run.result.outputs.len() != 1 {
        return Err(crate::engine_types::EngineError::Failed.message());
    }
    let output = run
        .result
        .outputs
        .into_iter()
        .next()
        .ok_or_else(|| crate::engine_types::EngineError::Failed.message())?;
    let closed = output.owned_output.close();
    let parsed = media_probe::probe_path(host, closed.path(), context)?;
    // A sample longer than the promised window is not a preview.
    if parsed.duration_us > PREVIEW_SAMPLE_US.saturating_add(250_000) {
        let _ = closed.dispose();
        return Err(crate::engine_types::EngineError::Failed.message());
    }
    let width = parsed
        .streams
        .iter()
        .find(|stream| matches!(stream.kind, crate::engine_types::MediaStreamKind::Video))
        .and_then(|stream| stream.width);
    let height = parsed
        .streams
        .iter()
        .find(|stream| matches!(stream.kind, crate::engine_types::MediaStreamKind::Video))
        .and_then(|stream| stream.height);
    let file = File::open(closed.path())
        .map_err(|_| crate::engine_types::EngineError::Failed.message())?;
    let key = CacheKey {
        source: stamp,
        kind: cache_store::CacheKind::MediaProxy,
        handler_id: PREVIEW_HANDLER_ID.to_string(),
        handler_version: PREVIEW_HANDLER_VERSION,
        options_key: preview_options_key(
            options.start_ms,
            options.width,
            options.height,
            options.keep_metadata,
        ),
    };
    let published = cache.publish_preview(&key, &file, &output.mime, width, height);
    drop(file);
    let _ = closed.dispose();
    let record = published?;
    let lease = cache.lease_preview(&record)?;
    let preview = MediaPreview {
        lease,
        duration_us: parsed.duration_us.min(length),
        mime: output.mime.clone(),
        // These previews only ever come from a disk file.
        source_revision: 1,
    };
    preview
        .validate()
        .map_err(|error| error.message())?;
    Ok(preview)
}

/// The one shared cache service publishes and leases media samples. The store
/// and its lease table stay private to `cache.rs`; the trait is the seam.
impl PreviewCache for CacheService {
    fn publish_preview(
        &self,
        key: &CacheKey,
        file: &File,
        mime: &str,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<CacheRecord, String> {
        self.publish(key, file, mime, width, height)
            .map_err(preview_cache_code)
    }

    fn lease_preview(&self, record: &CacheRecord) -> Result<CacheLease, String> {
        self.lease(record)
    }
}

/// `CacheService::publish` uses the thumbnail error names; a media sample is
/// a cache result, so its codes are reported as `cache.*`.
fn preview_cache_code(code: String) -> String {
    code.strip_prefix("thumbnail.")
        .map(|rest| format!("cache.{rest}"))
        .unwrap_or(code)
}

/// `media_preview_start` (E2): one bounded sample as a shared job.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn media_preview_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    cache: State<'_, Arc<CacheService>>,
    host: State<'_, Arc<EngineHost>>,
    request_id: String,
    input: DiskConversionInput,
    options: MediaConversionOptions,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    crate::validate_absolute_path(&input.path).map_err(|_| "engines.bad_request".to_string())?;
    let path = std::path::Path::new(&input.path);
    let stamp = cache
        .source_stamp(path)
        .map_err(|_| "engines.changed".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let cache = Arc::clone(cache.inner());
    let host = Arc::clone(host.inner());
    spawn_job(app, request_id, token, move |context| {
        let work_dir = host
            .new_private_root("preview")
            .map_err(|_| "engines.sandbox_failed".to_string())?
            .1;
        let preview = preview_disk_input(
            &host,
            cache.as_ref(),
            input,
            stamp,
            options,
            work_dir,
            context,
        )?;
        serde_json::to_value(preview).map_err(|_| "engines.failed".to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{accept_sample, preview_options_key, sample_bounds};
    use fs_service::SourceStamp;

    fn stamp(size_bytes: u64) -> SourceStamp {
        SourceStamp {
            path_key: "C:\\media\\clip.mp4".to_string(),
            volume_id: "0a1b2c3d".to_string(),
            file_id: "00112233445566aa".to_string(),
            modified_ticks: "133000000000000000".to_string(),
            size_bytes,
        }
    }

    #[test]
    fn samples_never_exceed_three_seconds() {
        assert_eq!(sample_bounds(None, 10_000_000), (0, 3_000_000));
        assert_eq!(sample_bounds(Some(9_000), 10_000_000), (9_000_000, 1_000_000));
        // A start past the end yields no sample at all.
        assert_eq!(sample_bounds(Some(20_000), 10_000_000), (10_000_000, 0));
    }

    #[test]
    fn stale_samples_are_ignored() {
        let current = stamp(100);
        assert!(accept_sample(&current, &current, 3, 3));
        // A newer request wins over a slower older one.
        assert!(!accept_sample(&current, &current, 2, 3));
        // A changed source invalidates the sample even for the newest request.
        assert!(!accept_sample(&current, &stamp(101), 3, 3));
    }

    #[test]
    fn the_options_key_is_stable_and_bounded() {
        let key = preview_options_key(Some(1500), None, None, true);
        assert!(key.len() <= 256);
        assert_eq!(key, preview_options_key(Some(1500), None, None, true));
        assert_ne!(key, preview_options_key(Some(1600), None, None, true));
    }
}
