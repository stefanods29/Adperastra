//! Thumbnail commands and wire shapes (Step 07a, T6/E6).
//!
//! `thumbnail_request_start` is used only on cache misses. The service keeps
//! a table per cache key, so two visible consumers of the same key share one
//! helper and each receives its own lease. `thumbnail_lookup` is the additive
//! cache-hit check; it never starts a job.

use std::sync::Arc;

use cache_store::CacheLease;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};

use crate::cache::validate_uuid;
use crate::ensure_main;
use crate::thumbnail_jobs::ThumbnailService;

/// Mirrors `ThumbnailRequest` in `src/services/thumbnails.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailRequest {
    pub path: String,
    pub edge: u32,
    pub consumer_id: String,
}

/// What the UI paints: a ready lease, or a fallback state with no error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailState {
    Ready,
    Unsupported,
    OnlineOnly,
    Paused,
}

/// Mirrors `ThumbnailReply` in `src/services/thumbnails.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailReply {
    pub state: ThumbnailState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<CacheLease>,
}

/// Start one thumbnail job after admission. Cancelling a queued consumer
/// returns `background.cancelled` without creating a user-visible job.
#[tauri::command]
pub async fn thumbnail_request_start(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, Arc<ThumbnailService>>,
    request_id: String,
    request: ThumbnailRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let service = Arc::clone(service.inner());
    service.start(app, request_id, request).await
}

/// A cache hit without starting work. Returns `null` on a miss.
#[tauri::command]
pub async fn thumbnail_lookup(
    window: WebviewWindow,
    service: State<'_, Arc<ThumbnailService>>,
    request: ThumbnailRequest,
) -> Result<Option<ThumbnailReply>, String> {
    ensure_main(window.label())?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.lookup(&request))
        .await
        .map_err(|e| e.to_string())?
}

/// Release one consumer. It cancels queued admission even before a job ID
/// exists, releases that consumer's lease, and is idempotent.
#[tauri::command]
pub async fn thumbnail_release(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, Arc<ThumbnailService>>,
    consumer_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let consumer = validate_uuid(&consumer_id, "thumbnail.bad_request")?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || {
        service.release_consumer(&app, &consumer);
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ThumbnailReply, ThumbnailState};

    #[test]
    fn a_fallback_reply_carries_no_lease() {
        let reply = ThumbnailReply {
            state: ThumbnailState::Unsupported,
            lease: None,
        };
        let json = serde_json::to_value(&reply).unwrap();
        assert_eq!(json["state"], "unsupported");
        assert!(json.get("lease").is_none());
    }

    #[test]
    fn every_state_uses_the_documented_string() {
        for (state, text) in [
            (ThumbnailState::Ready, "ready"),
            (ThumbnailState::Unsupported, "unsupported"),
            (ThumbnailState::OnlineOnly, "online_only"),
            (ThumbnailState::Paused, "paused"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), text);
        }
    }
}
