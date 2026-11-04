//! Optional preview proxies (Step 15 T3, `D5`).
//!
//! A proxy is generated only through the verified media engine, is keyed by
//! the source stamp and requested edge, and is leased from the 07a cache.
//! Without an installed, audited engine the command fails with
//! `engines.pack_missing`; the ordinary player remains fully usable.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::engine_types::EngineError;
use crate::media_edit_types::{MediaEditError, MediaSource};

pub const PROXY_512_EDGE: u32 = 512;
pub const PROXY_960_EDGE: u32 = 960;
pub const MAX_PROXY_LEASES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProxyQuality {
    #[serde(rename = "source")]
    Source,
    #[serde(rename = "960")]
    Edge960,
    #[serde(rename = "512")]
    Edge512,
}

impl ProxyQuality {
    /// `None` means the original source; no proxy is generated for it.
    pub fn edge(self) -> Option<u32> {
        match self {
            Self::Source => None,
            Self::Edge960 => Some(PROXY_960_EDGE),
            Self::Edge512 => Some(PROXY_512_EDGE),
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "source" => Some(Self::Source),
            "960" => Some(Self::Edge960),
            "512" => Some(Self::Edge512),
            _ => None,
        }
    }
}

/// The confined engine adapter that renders one proxy. It returns a cache
/// lease; it never writes a user destination.
pub trait ProxyBackend: Send + Sync {
    fn generate(
        &self,
        source: &MediaSource,
        edge: u32,
        cancel: &fs_service::CancellationToken,
    ) -> Result<cache_store::CacheLease, String>;
}

pub struct ProxyService {
    backend: Mutex<Option<Arc<dyn ProxyBackend>>>,
    leases: Mutex<HashMap<String, cache_store::CacheLease>>,
}

impl Default for ProxyService {
    fn default() -> Self {
        Self {
            backend: Mutex::new(None),
            leases: Mutex::new(HashMap::new()),
        }
    }
}

impl ProxyService {
    fn lock_backend(&self) -> Result<MutexGuard<'_, Option<Arc<dyn ProxyBackend>>>, String> {
        self.backend
            .lock()
            .map_err(|_| MediaEditError::Failed.message())
    }

    fn lock_leases(&self) -> Result<MutexGuard<'_, HashMap<String, cache_store::CacheLease>>, String> {
        self.leases
            .lock()
            .map_err(|_| MediaEditError::Failed.message())
    }

    pub fn install_backend(&self, backend: Arc<dyn ProxyBackend>) -> Result<(), String> {
        let mut slot = self.lock_backend()?;
        if slot.is_some() {
            return Err(MediaEditError::Failed.message());
        }
        *slot = Some(backend);
        Ok(())
    }

    fn backend(&self) -> Option<Arc<dyn ProxyBackend>> {
        self.lock_backend().ok().and_then(|slot| slot.clone())
    }

    fn cached(&self, key: &str) -> Option<cache_store::CacheLease> {
        self.lock_leases().ok()?.get(key).cloned()
    }

    fn store(&self, key: String, lease: cache_store::CacheLease) {
        if let Ok(mut leases) = self.lock_leases() {
            if leases.len() >= MAX_PROXY_LEASES && !leases.contains_key(&key) {
                if let Some(oldest) = leases.keys().next().cloned() {
                    leases.remove(&oldest);
                }
            }
            leases.insert(key, lease);
        }
    }
}

/// The cache identity of one preview revision and edge (`D5`).
pub fn proxy_key(source: &MediaSource, edge: u32) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        source.id,
        source.stamp.volume_id,
        source.stamp.file_id,
        source.stamp.modified_ticks,
        source.stamp.size_bytes,
        edge
    )
}

fn validate_source(source: &MediaSource) -> Result<(), String> {
    if source.sensitive {
        return Err(MediaEditError::Unsupported.message());
    }
    if source.duration_us == 0 {
        return Err(MediaEditError::BadRequest.message());
    }
    Ok(())
}

fn start(
    service: &ProxyService,
    app: &AppHandle,
    source: &MediaSource,
    edge: u32,
    cancel: &fs_service::CancellationToken,
) -> Result<serde_json::Value, String> {
    validate_source(source)?;
    let key = proxy_key(source, edge);
    if let Some(lease) = service.cached(&key) {
        return serde_json::to_value(lease).map_err(|_| MediaEditError::Failed.message());
    }
    let backend = service
        .backend()
        .ok_or_else(|| EngineError::PackMissing.message())?;
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(EngineError::Cancelled.message());
    }
    let lease = backend.generate(source, edge, cancel)?;
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        let cache = app.state::<std::sync::Arc<crate::cache::CacheService>>();
        let _ = cache.release(&lease.lease_id);
        return Err(EngineError::Cancelled.message());
    }
    service.store(key, lease.clone());
    serde_json::to_value(lease).map_err(|_| MediaEditError::Failed.message())
}

/** Starts one optional proxy job (`D5`). */
#[tauri::command]
pub async fn media_proxy_start(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, Arc<ProxyService>>,
    request_id: String,
    source: MediaSource,
    quality: ProxyQuality,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&source.path).map_err(|_| MediaEditError::BadRequest.message())?;
    let edge = quality.edge().ok_or_else(|| MediaEditError::BadRequest.message())?;
    let service = service.inner().clone();
    let jobs = app.state::<crate::jobs::Jobs>();
    let token = jobs.begin(&request_id, 1)?;
    let id = request_id.clone();
    let source = source.clone();
    let worker_app = app.clone();
    crate::jobs::spawn_job(app.clone(), id, token, move |context| {
        let path = std::path::PathBuf::from(&source.path);
        let current = worker_app
            .state::<std::sync::Arc<crate::cache::CacheService>>()
            .source_stamp(Path::new(&path))?;
        crate::waveforms::ensure_source_unchanged(&source.stamp, &current)?;
        start(&service, &worker_app, &source, edge, context.token())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(stamp: &str) -> MediaSource {
        MediaSource {
            id: uuid::Uuid::nil(),
            path: "C:\\media\\clip.mp4".to_string(),
            stamp: fs_service::SourceStamp {
                path_key: "C:\\media\\clip.mp4".to_string(),
                volume_id: "00000000".to_string(),
                file_id: "0000000000000001".to_string(),
                modified_ticks: stamp.to_string(),
                size_bytes: 10,
            },
            duration_us: 10_000_000,
            video_rate: Some(crate::engine_types::FrameRate { num: 30, den: 1 }),
            audio_rate: Some(48_000),
            sensitive: false,
        }
    }

    #[test]
    fn changed_stamp_changes_the_proxy_identity() {
        let first = proxy_key(&source("10"), 512);
        let second = proxy_key(&source("11"), 512);
        assert_ne!(first, second);
        assert_ne!(proxy_key(&source("10"), 512), proxy_key(&source("10"), 960));
    }

    #[test]
    fn source_quality_never_generates_a_proxy() {
        assert_eq!(ProxyQuality::Source.edge(), None);
        assert_eq!(ProxyQuality::Edge512.edge(), Some(512));
        assert_eq!(ProxyQuality::from_wire("960"), Some(ProxyQuality::Edge960));
        assert_eq!(ProxyQuality::from_wire("source"), Some(ProxyQuality::Source));
        assert_eq!(ProxyQuality::from_wire("1440"), None);
    }
}
