//! Bounded waveform pages (Step 15 T3, `E4`).
//!
//! Decoding runs only through the confined engine backend; this module owns
//! the 512-bucket page contract, the 100-buckets-per-second resolution, the
//! 100-minute ceiling and a 128 MiB in-memory cache. A changed `SourceStamp`
//! is a different cache entry and is refused before any stale page is read.
#![allow(dead_code)]


use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::engine_types::EngineError;
use crate::media_edit_types::{
    MediaEditError, MediaSource, WavePage, WavePeak, WAVEFORM_BUCKETS_PER_PAGE,
    WAVEFORM_BUCKETS_PER_SECOND, WAVEFORM_MAX_CHANNELS, WAVEFORM_MAX_MINUTES,
};

/// In-memory cache budget.
pub const WAVEFORM_CACHE_BYTES: usize = 128 * 1024 * 1024;
/// Bytes charged for one cached peak (two f32 values plus index overhead).
const PEAK_BYTES: usize = 8;
/// Largest number of buckets a 100-minute source can have.
pub const MAX_WAVEFORM_BUCKETS: u32 =
    (WAVEFORM_MAX_MINUTES * 60 * WAVEFORM_BUCKETS_PER_SECOND) as u32;

/// The confined decoder a verified media pack installs. Without it the
/// command fails closed with `engines.pack_missing`, never a fabricated wave.
pub trait WaveformBackend: Send + Sync {
    /// Decodes one channel through the confined engine. The cancellation
    /// token is checked between bounded decode windows.
    fn produce(
        &self,
        source: &MediaSource,
        channel: u8,
        cancel: &fs_service::CancellationToken,
    ) -> Result<Vec<WavePeak>, String>;
}

struct CachedWaveform {
    peaks: Vec<WavePeak>,
    total_buckets: u32,
}

/// The managed waveform service.
pub struct WaveformService {
    backend: Mutex<Option<Arc<dyn WaveformBackend>>>,
    cache: Mutex<WaveformCache>,
}

impl Default for WaveformService {
    fn default() -> Self {
        Self {
            backend: Mutex::new(None),
            cache: Mutex::new(WaveformCache::new(WAVEFORM_CACHE_BYTES)),
        }
    }
}

impl WaveformService {
    fn lock_backend(&self) -> Result<MutexGuard<'_, Option<Arc<dyn WaveformBackend>>>, String> {
        self.backend
            .lock()
            .map_err(|_| "media_edit.failed".to_string())
    }

    fn lock_cache(&self) -> Result<MutexGuard<'_, WaveformCache>, String> {
        self.cache
            .lock()
            .map_err(|_| "media_edit.failed".to_string())
    }

    pub fn install_backend(&self, backend: Arc<dyn WaveformBackend>) -> Result<(), String> {
        let mut slot = self.lock_backend()?;
        if slot.is_some() {
            return Err("media_edit.failed".to_string());
        }
        *slot = Some(backend);
        Ok(())
    }

    fn backend(&self) -> Option<Arc<dyn WaveformBackend>> {
        self.lock_backend().ok().and_then(|slot| slot.clone())
    }

    fn cached(&self, key: &str) -> Option<Arc<CachedWaveform>> {
        let mut cache = self.lock_cache().ok()?;
        cache.get(key)
    }

    fn store(&self, key: String, peaks: Vec<WavePeak>, total_buckets: u32) {
        if let Ok(mut cache) = self.lock_cache() {
            cache.put(key, Arc::new(CachedWaveform { peaks, total_buckets }));
        }
    }
}

struct WaveformCache {
    limit_bytes: usize,
    bytes: usize,
    order: VecDeque<String>,
    entries: HashMap<String, Arc<CachedWaveform>>,
}

impl WaveformCache {
    fn new(limit_bytes: usize) -> Self {
        Self {
            limit_bytes,
            bytes: 0,
            order: VecDeque::new(),
            entries: HashMap::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<Arc<CachedWaveform>> {
        let entry = self.entries.get(key).cloned();
        if entry.is_some() {
            self.order.retain(|candidate| candidate != key);
            self.order.push_back(key.to_string());
        }
        entry
    }

    fn put(&mut self, key: String, entry: Arc<CachedWaveform>) {
        let bytes = entry.peaks.len() * PEAK_BYTES;
        if bytes > self.limit_bytes {
            return;
        }
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.peaks.len() * PEAK_BYTES);
            self.order.retain(|candidate| candidate != &key);
        }
        while self.bytes + bytes > self.limit_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.peaks.len() * PEAK_BYTES);
            }
        }
        self.bytes += bytes;
        self.order.push_back(key.clone());
        self.entries.insert(key, entry);
    }
}

/// `ceil(duration / 10 ms)`, capped at 100 minutes of buckets.
pub fn total_buckets_for_duration(duration_us: u64) -> u32 {
    let bucket_us = 1_000_000 / WAVEFORM_BUCKETS_PER_SECOND;
    let total = duration_us.div_ceil(bucket_us);
    u32::try_from(total.min(u64::from(MAX_WAVEFORM_BUCKETS))).unwrap_or(MAX_WAVEFORM_BUCKETS)
}

/// The cache identity of one source revision and channel.
pub fn waveform_cache_key(source: &MediaSource, channel: u8) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        source.id,
        source.stamp.volume_id,
        source.stamp.file_id,
        source.stamp.modified_ticks,
        source.stamp.size_bytes,
        channel
    )
}

/// Refuse a request whose source changed after the UI probed it.
pub fn ensure_source_unchanged(
    requested: &fs_service::SourceStamp,
    current: &fs_service::SourceStamp,
) -> Result<(), MediaEditError> {
    if requested != current {
        return Err(MediaEditError::Changed);
    }
    Ok(())
}

fn validate_source(source: &MediaSource) -> Result<(), MediaEditError> {
    if source.sensitive {
        return Err(MediaEditError::Unsupported);
    }
    let candidate = crate::media_edit_types::MediaRecipe {
        schema_version: 1,
        project_id: Uuid::nil(),
        content_id: Uuid::nil(),
        sources: vec![source.clone()],
        segments: vec![crate::media_edit_types::MediaSegment {
            id: Uuid::nil(),
            source_id: source.id,
            start_us: 0,
            end_us: source.duration_us.max(1),
            speed: 1.0,
        }],
        crop: None,
        rotation: 0,
        volume: 1.0,
        mute: false,
        keep_pitch: true,
        subtitles: Vec::new(),
        subtitle_mode: crate::media_edit_types::MediaSubtitleMode::Off,
        metadata_keep: true,
    };
    candidate.validate()
}

/** One page of at most 512 buckets from a complete peak list. */
pub fn page_from_peaks(
    source: &MediaSource,
    channel: u8,
    first_bucket: u32,
    total_buckets: u32,
    peaks: &[WavePeak],
) -> Result<WavePage, MediaEditError> {
    if channel >= WAVEFORM_MAX_CHANNELS {
        return Err(MediaEditError::BadRequest);
    }
    if total_buckets > MAX_WAVEFORM_BUCKETS || peaks.len() != total_buckets as usize {
        return Err(MediaEditError::TooLarge);
    }
    if first_bucket > total_buckets {
        return Err(MediaEditError::BadRequest);
    }
    let start = first_bucket as usize;
    let end = (start + WAVEFORM_BUCKETS_PER_PAGE).min(peaks.len());
    let buckets = peaks[start..end].to_vec();
    let page = WavePage {
        source_id: source.id,
        channel,
        first_bucket,
        buckets,
        total_buckets,
    };
    page.validate()?;
    Ok(page)
}

/// Reads one page, producing and caching the channel on a miss.
fn load_page(
    service: &WaveformService,
    source: &MediaSource,
    channel: u8,
    first_bucket: u32,
    cancel: &fs_service::CancellationToken,
) -> Result<WavePage, String> {
    validate_source(source)?;
    if channel >= WAVEFORM_MAX_CHANNELS {
        return Err(MediaEditError::BadRequest.message());
    }
    let total = total_buckets_for_duration(source.duration_us);
    let key = waveform_cache_key(source, channel);
    if let Some(cached) = service.cached(&key) {
        return page_from_peaks(source, channel, first_bucket, total, &cached.peaks)
            .map_err(Into::into);
    }
    let backend = service.backend().ok_or_else(|| EngineError::PackMissing.message())?;
    let peaks = backend.produce(source, channel, cancel)?;
    if peaks.len() != total as usize {
        return Err(MediaEditError::Changed.message());
    }
    service.store(key, peaks.clone(), total);
    page_from_peaks(source, channel, first_bucket, total, &peaks).map_err(Into::into)
}

/** Waveform page command (`E4`). */
#[tauri::command]
pub async fn media_waveform_page(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, Arc<WaveformService>>,
    source: MediaSource,
    channel: u8,
    first_bucket: u32,
) -> Result<WavePage, String> {
    crate::ensure_main(window.label())?;
    crate::validate_absolute_path(&source.path)
        .map_err(|_| MediaEditError::BadRequest.message())?;
    if channel >= WAVEFORM_MAX_CHANNELS || first_bucket > MAX_WAVEFORM_BUCKETS {
        return Err(MediaEditError::BadRequest.message());
    }
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::PathBuf::from(&source.path);
        let cache = app.state::<std::sync::Arc<crate::cache::CacheService>>();
        let current = cache.source_stamp(Path::new(&path))?;
        ensure_source_unchanged(&source.stamp, &current)?;
        let cancel = fs_service::new_cancellation_token();
        load_page(&service, &source, channel, first_bucket, &cancel)
    })
    .await
    .map_err(|_| MediaEditError::Failed.message())?
}

#[cfg(test)]
#[path = "media_waveform_step15_tests.rs"]
mod step15_tests;
