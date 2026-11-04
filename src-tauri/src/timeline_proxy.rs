//! Bounded timeline proxy identity and lease helpers (Step 19a T4/E5, D6).
//!
//! No concrete proxy producer exists in this build. The 07a cache publishes
//! results with an 8 MiB ceiling and a `blobs/<id>.png` shape, which cannot
//! hold a 512/960-edge WebM proxy, and no installed engine backend produces
//! one. `timeline_proxy_start` therefore refuses with `timeline.unsupported`
//! before it starts a job, stages a file or creates a lease; a UI must keep
//! showing the original until Step 19b (or a later cache revision) registers
//! a real producer. The pure identity, generation, pause and lease-ownership
//! helpers below are the parts Step 19a can test without such a backend.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cache_store::{CacheKey, CacheKind};
use fs_service::SourceStamp;
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::cache::CacheService;
use crate::media_edit_types::MediaSource;
use crate::timeline_types::{validate_source, TimelineError};

pub const TIMELINE_PROXY_HANDLER_ID: &str = "timeline-proxy";
pub const TIMELINE_PROXY_HANDLER_VERSION: u32 = 1;
/// One proxy is at most 512 MiB inside the shared cache.
pub const TIMELINE_PROXY_MAX_BYTES: u64 = 512 * 1024 * 1024;
/// A thumbnail window is at most 256 pictures, 160x90 each.
pub const TIMELINE_THUMBNAIL_MAX: usize = 256;
pub const TIMELINE_THUMBNAIL_WIDTH: u32 = 160;
pub const TIMELINE_THUMBNAIL_HEIGHT: u32 = 90;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyQuality {
    Edge512,
    Edge960,
}

impl ProxyQuality {
    pub fn from_u32(value: u32) -> Result<Self, String> {
        match value {
            512 => Ok(Self::Edge512),
            960 => Ok(Self::Edge960),
            _ => Err(TimelineError::BadRequest.message()),
        }
    }

    pub fn edge(self) -> u32 {
        match self {
            Self::Edge512 => 512,
            Self::Edge960 => 960,
        }
    }
}

/// The cache identity of one proxy: source stamp, stream, engine and quality.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyIdentity {
    pub stamp: SourceStamp,
    pub stream: String,
    pub engine_version: String,
    pub quality: u32,
}

impl ProxyIdentity {
    pub fn from_source(
        source: &MediaSource,
        quality: ProxyQuality,
        engine_version: &str,
    ) -> Result<Self, String> {
        validate_source(source).map_err(TimelineError::message)?;
        if source.video_rate.is_none() {
            return Err(TimelineError::Unsupported.message());
        }
        if engine_version.is_empty() || engine_version.len() > 64 {
            return Err(TimelineError::BadRequest.message());
        }
        Ok(Self {
            stamp: source.stamp.clone(),
            stream: "video".to_string(),
            engine_version: engine_version.to_string(),
            quality: quality.edge(),
        })
    }

    /// The cache options key (at most 256 ASCII characters).
    pub fn options_key(&self) -> String {
        format!(
            "timeline-proxy-v1;stream={};engine={};quality={}",
            self.stream, self.engine_version, self.quality
        )
    }

    pub fn cache_key(&self) -> CacheKey {
        CacheKey {
            source: self.stamp.clone(),
            kind: CacheKind::MediaProxy,
            handler_id: TIMELINE_PROXY_HANDLER_ID.to_string(),
            handler_version: TIMELINE_PROXY_HANDLER_VERSION,
            options_key: self.options_key(),
        }
    }
}

/// A changed source stamp invalidates a proxy key even for the same path.
pub fn proxy_identity_changes_with_source(
    before: &SourceStamp,
    after: &SourceStamp,
    quality: ProxyQuality,
    engine_version: &str,
) -> bool {
    let left = ProxyIdentity {
        stamp: before.clone(),
        stream: "video".to_string(),
        engine_version: engine_version.to_string(),
        quality: quality.edge(),
    };
    let right = ProxyIdentity {
        stamp: after.clone(),
        stream: "video".to_string(),
        engine_version: engine_version.to_string(),
        quality: quality.edge(),
    };
    left != right
}

/// One monotonic scrub clock. Only the newest seek generation may draw.
#[derive(Debug, Default)]
pub struct SeekGate {
    latest: AtomicU64,
}

impl SeekGate {
    pub fn begin(&self) -> u64 {
        self.latest.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.latest.load(Ordering::SeqCst) == generation
    }

    pub fn reset(&self) {
        self.latest.fetch_add(1, Ordering::SeqCst);
    }
}

/// Playback and preview pause when the timeline tab is inactive or hidden.
pub fn preview_should_run(active: bool, document_hidden: bool) -> bool {
    active && !document_hidden
}

/// Tracks the lease a proxy job would own, so a failed/cancelled job can
/// release it exactly once instead of leaving it pinned. Kept ready for the
/// future producer; the current command creates no leases.
#[derive(Debug, Default)]
pub struct ProxyLeases {
    entries: Mutex<HashMap<String, Option<String>>>,
}

impl ProxyLeases {
    pub fn begin(&self, job: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(job.to_string(), None);
        }
    }

    pub fn attach(&self, job: &str, lease_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(slot) = entries.get_mut(job) {
                *slot = Some(lease_id.to_string());
            }
        }
    }

    /// Successful completion: the UI now owns the lease.
    pub fn complete(&self, job: &str) -> Option<String> {
        self.entries
            .lock()
            .ok()
            .and_then(|mut entries| entries.remove(job))
            .flatten()
    }

    /// Cancellation/failure: returns the lease the caller must release.
    pub fn cancel(&self, job: &str) -> Option<String> {
        self.complete(job)
    }

    pub fn live(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }
}

/// E5: start one optional proxy job. Unavailable until a concrete producer and
/// a cache that can hold a WebM result are registered; refusing here means no
/// fake preview, no staged output and no lease the UI cannot use.
#[tauri::command]
pub async fn timeline_proxy_start(
    window: WebviewWindow,
    request_id: String,
    source: MediaSource,
    quality: u32,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_source(&source).map_err(TimelineError::message)?;
    ProxyQuality::from_u32(quality)?;
    if source.video_rate.is_none() {
        return Err(TimelineError::Unsupported.message());
    }
    Err(TimelineError::Unsupported.message())
}

/// E5: release one proxy lease through the one 07a cache service; unknown
/// lease IDs are ignored exactly as the shared cache does.
#[tauri::command]
pub fn timeline_proxy_release(
    window: WebviewWindow,
    cache: State<'_, Arc<CacheService>>,
    lease_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&lease_id).map_err(|_| TimelineError::BadRequest.message())?;
    cache.release(&lease_id)
}

/// Bound one requested thumbnail window: sorted, deduplicated and <= 256.
pub fn thumbnail_window(times_us: &[u64], limit: usize) -> Vec<u64> {
    let mut values: Vec<u64> = times_us.to_vec();
    values.sort_unstable();
    values.dedup();
    values.truncate(limit.min(TIMELINE_THUMBNAIL_MAX));
    values
}

/// A window longer than 256 pictures is reported incomplete, not truncated
/// silently.
pub fn thumbnail_window_complete(requested: usize, returned: usize) -> bool {
    requested <= TIMELINE_THUMBNAIL_MAX && returned == requested
}

#[cfg(test)]
#[path = "timeline_proxy_step19a_tests.rs"]
mod step19a_tests;
