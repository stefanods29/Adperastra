//! OpenStreetMap tile cache and leases (Step 11b decisions 10 and 11, E6).
//!
//! The UI can only name `zoom/x/y`; the host and path are fixed here. Every
//! redirect is refused, responses must be a PNG of at most 512 KiB, and a
//! request is served only while a map view lease is active and the persisted
//! online setting is on. Tiles live under `<profile>/map-tiles/<z>/<x>/<y>.png`
//! with their expiry/ETag beside them; the cache never evicts a tile to make
//! room, it stops at 256 MiB and answers `map.limit`.
//!
//! Tiles reach the WebView through the existing `adpfile` protocol as leased
//! files, so no remote script or CSP change is needed.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use search_index::limits::{is_safe_u64, unix_now};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::files::{is_valid_token, FileGrants};
use crate::map_types::{
    user_agent, MapTile, MapTileLease, MapTileRequest, MAX_TILE_BYTES, MAP_CACHE_BYTES,
    MIN_TILE_TTL_SECONDS, OSM_ATTRIBUTION, OSM_TILE_URL, TILE_REQUEST_TIMEOUT_SECONDS, TILE_SIZE,
};
use crate::{ensure_main, AppState};

/// Cached responses do not outlive a year, whatever a header says.
const MAX_TILE_TTL_SECONDS: u64 = 365 * 24 * 60 * 60;
/// Most live tile tokens one view may hold. The UI keeps at most 64 visible
/// tiles; the spare room absorbs a viewport change in flight.
const MAX_TILE_LEASES: usize = 128;
const TILE_META_SCHEMA: u32 = 1;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
/// The provider policy allows two concurrent tile requests. The UI session
/// applies it too, but the native store is the authority for every caller.
const MAX_CONCURRENT_FETCHES: usize = 2;

struct TileGate {
    active: Mutex<usize>,
    wake: Condvar,
}

struct TilePermit<'a> {
    gate: &'a TileGate,
}

impl TileGate {
    fn new() -> Self {
        Self {
            active: Mutex::new(0),
            wake: Condvar::new(),
        }
    }

    fn acquire(&self) -> Result<TilePermit<'_>, String> {
        let mut active = self.active.lock().map_err(|_| "map.unavailable".to_string())?;
        while *active >= MAX_CONCURRENT_FETCHES {
            active = self
                .wake
                .wait(active)
                .map_err(|_| "map.unavailable".to_string())?;
        }
        *active += 1;
        Ok(TilePermit { gate: self })
    }
}

impl Drop for TilePermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.gate.active.lock() {
            *active = active.saturating_sub(1);
            self.gate.wake.notify_one();
        }
    }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/// One provider response. `bytes: None` means `304 Not Modified`, so the
/// caller keeps the cached PNG and only extends its expiry.
pub struct FetchedTile {
    pub bytes: Option<Vec<u8>>,
    pub expires_unix: u64,
    pub etag: Option<String>,
}

/// The provider seam. Tests replace it with an in-memory counter so no test
/// ever touches the network.
pub trait TileFetcher: Send + Sync {
    fn fetch(
        &self,
        request: &MapTileRequest,
        etag: Option<&str>,
        now: u64,
    ) -> Result<FetchedTile, String>;
}

pub struct HttpTileFetcher {
    client: reqwest::blocking::Client,
}

impl HttpTileFetcher {
    pub fn new(app_version: &str) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(TILE_REQUEST_TIMEOUT_SECONDS))
            .user_agent(user_agent(app_version))
            .build()
            .map_err(|_| "map.unavailable".to_string())?;
        Ok(Self { client })
    }
}

fn header_text(
    headers: &reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Any redirect or non-success status is refused: the UI never supplies a
/// host, so there is no legitimate second location to follow.
fn response_is_refused(status: reqwest::StatusCode) -> bool {
    status.is_redirection() || !status.is_success()
}

fn is_osm_response_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("tile.openstreetmap.org")
        && url.path().ends_with(".png")
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.len() > PNG_SIGNATURE.len() && bytes.starts_with(&PNG_SIGNATURE)
}

fn validate_tile_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("map.unavailable".to_string());
    }
    if bytes.len() as u64 > MAX_TILE_BYTES {
        return Err("map.limit".to_string());
    }
    if !is_png(bytes) {
        return Err("map.unavailable".to_string());
    }
    Ok(())
}

impl TileFetcher for HttpTileFetcher {
    fn fetch(
        &self,
        request: &MapTileRequest,
        etag: Option<&str>,
        now: u64,
    ) -> Result<FetchedTile, String> {
        request.validate()?;
        let mut builder = self
            .client
            .get(format!("{OSM_TILE_URL}{}", request.url_path()))
            .header(reqwest::header::ACCEPT, "image/png");
        if let Some(etag) = etag {
            builder = builder.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        let response = builder
            .send()
            .map_err(|_| "map.unavailable".to_string())?;
        let status = response.status();
        let headers = response.headers().clone();
        let response_now = unix_now().max(now);
        let expires_unix = response_now.saturating_add(ttl_seconds(
            header_text(&headers, reqwest::header::CACHE_CONTROL).as_deref(),
            header_text(&headers, reqwest::header::EXPIRES).as_deref(),
            response_now,
        ));
        let response_etag = header_text(&headers, reqwest::header::ETAG)
            .filter(|value| value.len() <= 256 && !value.chars().any(char::is_control));
        if status == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(FetchedTile {
                bytes: None,
                expires_unix,
                etag: response_etag.or_else(|| etag.map(str::to_string)),
            });
        }
        if response_is_refused(status) || !is_osm_response_url(response.url()) {
            return Err("map.unavailable".to_string());
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_TILE_BYTES)
        {
            return Err("map.limit".to_string());
        }
        if let Some(content_type) = header_text(&headers, reqwest::header::CONTENT_TYPE) {
            if !content_type.to_ascii_lowercase().starts_with("image/png") {
                return Err("map.unavailable".to_string());
            }
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_TILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "map.unavailable".to_string())?;
        validate_tile_bytes(&bytes)?;
        Ok(FetchedTile {
            bytes: Some(bytes),
            expires_unix,
            etag: response_etag,
        })
    }
}

/// `Cache-Control: max-age`, then `Expires`, then the seven-day minimum.
/// A cache directive that forbids storing still keeps the tile for this
/// session but expires it at once.
fn ttl_seconds(cache_control: Option<&str>, expires: Option<&str>, now: u64) -> u64 {
    if let Some(cache_control) = cache_control {
        for directive in cache_control.split(',') {
            let directive = directive.trim();
            if let Some(value) = directive.strip_prefix("max-age=") {
                if let Ok(seconds) = value.trim_matches('"').parse::<u64>() {
                    return seconds.min(MAX_TILE_TTL_SECONDS);
                }
            }
        }
        let lower = cache_control.to_ascii_lowercase();
        if lower.contains("no-store") || lower.contains("no-cache") {
            return 0;
        }
    }
    if let Some(expires) = expires {
        if let Some(at) = http_date_to_unix(expires) {
            return at.saturating_sub(now);
        }
    }
    MIN_TILE_TTL_SECONDS
}

/// RFC 1123 (`Sun, 06 Nov 1994 08:49:37 GMT`), the only format providers use
/// for `Expires` in practice. Anything else falls back to the fixed 7 days.
fn http_date_to_unix(text: &str) -> Option<u64> {
    let mut parts = text.split_whitespace();
    let _weekday = parts.next()?;
    let day: i64 = parts.next()?.trim_end_matches(',').parse().ok()?;
    let month = match parts.next()? {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let year: i64 = parts.next()?.parse().ok()?;
    let mut clock = parts.next()?.split(':');
    let hour: i64 = clock.next()?.parse().ok()?;
    let minute: i64 = clock.next()?.parse().ok()?;
    let second: i64 = clock.next()?.parse().ok()?;
    if !(1..=31).contains(&day)
        || !(1601..=9998).contains(&year)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)?;
    u64::try_from(seconds).ok()
}

/// Days since 1970-01-01 from a proleptic Gregorian civil date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TileMeta {
    schema_version: u32,
    expires_unix: u64,
    #[serde(default)]
    etag: Option<String>,
    byte_len: u64,
}

/// A tile whose bytes are in the cache and whose bytes may be leased.
#[derive(Debug)]
pub struct PreparedTile {
    path: PathBuf,
    byte_len: u64,
    cached: bool,
    expires_unix: u64,
}

struct StoredLease {
    token: String,
}

#[derive(Clone)]
pub struct MapTileStore {
    root: PathBuf,
    cap: u64,
    used: Arc<Mutex<Option<u64>>>,
    fetcher: Arc<dyn TileFetcher>,
    leases: Arc<Mutex<HashMap<String, StoredLease>>>,
    gate: Arc<TileGate>,
}

impl MapTileStore {
    pub fn new(profile_dir: &Path, app_version: &str) -> Result<Self, String> {
        Ok(Self {
            root: profile_dir.join("map-tiles"),
            cap: MAP_CACHE_BYTES,
            used: Arc::new(Mutex::new(None)),
            fetcher: Arc::new(HttpTileFetcher::new(app_version)?),
            leases: Arc::new(Mutex::new(HashMap::new())),
            gate: Arc::new(TileGate::new()),
        })
    }

    #[cfg(test)]
    fn with_fetcher(profile_dir: &Path, fetcher: Arc<dyn TileFetcher>) -> Self {
        Self::with_fetcher_and_cap(profile_dir, fetcher, MAP_CACHE_BYTES)
    }

    #[cfg(test)]
    fn with_fetcher_and_cap(
        profile_dir: &Path,
        fetcher: Arc<dyn TileFetcher>,
        cap: u64,
    ) -> Self {
        Self {
            root: profile_dir.join("map-tiles"),
            cap,
            used: Arc::new(Mutex::new(None)),
            fetcher,
            leases: Arc::new(Mutex::new(HashMap::new())),
            gate: Arc::new(TileGate::new()),
        }
    }

    fn tile_path(&self, request: &MapTileRequest) -> PathBuf {
        self.root
            .join(request.zoom.to_string())
            .join(request.x.to_string())
            .join(format!("{}.png", request.y))
    }

    fn meta_path(&self, request: &MapTileRequest) -> PathBuf {
        self.root
            .join(request.zoom.to_string())
            .join(request.x.to_string())
            .join(format!("{}.json", request.y))
    }

    fn used_bytes(&self) -> Result<u64, String> {
        let mut used = self
            .used
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        if let Some(value) = *used {
            return Ok(value);
        }
        let value = png_bytes_under(&self.root);
        *used = Some(value);
        Ok(value)
    }

    fn adjust_used(&self, previous: u64, next: u64) -> Result<(), String> {
        let mut used = self
            .used
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        let current = used.unwrap_or_else(|| png_bytes_under(&self.root));
        *used = Some(current.saturating_sub(previous).saturating_add(next));
        Ok(())
    }

    fn check_capacity(&self, previous: u64, next: u64) -> Result<(), String> {
        let used = self.used_bytes()?;
        if used.saturating_sub(previous).saturating_add(next) > self.cap {
            return Err("map.limit".to_string());
        }
        Ok(())
    }

    fn load_meta(&self, meta_path: &Path, png_path: &Path) -> Option<TileMeta> {
        let metadata = std::fs::metadata(meta_path).ok()?;
        if metadata.len() > 8 * 1024 {
            return None;
        }
        let bytes = std::fs::read(meta_path).ok()?;
        let meta: TileMeta = serde_json::from_slice(&bytes).ok()?;
        if meta.schema_version != TILE_META_SCHEMA
            || !is_safe_u64(meta.expires_unix)
            || meta.byte_len == 0
            || meta.byte_len > MAX_TILE_BYTES
            || meta
                .etag
                .as_ref()
                .is_some_and(|etag| etag.len() > 256 || etag.chars().any(char::is_control))
        {
            return None;
        }
        let png_len = std::fs::metadata(png_path).ok()?.len();
        if png_len != meta.byte_len {
            return None;
        }
        Some(meta)
    }

    fn write_meta(
        &self,
        meta_path: &Path,
        expires_unix: u64,
        etag: Option<String>,
        byte_len: u64,
    ) -> Result<(), String> {
        let meta = TileMeta {
            schema_version: TILE_META_SCHEMA,
            expires_unix,
            etag,
            byte_len,
        };
        let bytes = serde_json::to_vec(&meta).map_err(|_| "map.unavailable".to_string())?;
        fs_service::atomic_write(meta_path, &bytes).map_err(|_| "map.unavailable".to_string())
    }

    /// Fetch or reuse one tile while a view lease is active. Never evicts:
    /// `map.limit` tells the view to show the cache-full notice.
    pub fn prepare(
        &self,
        request: MapTileRequest,
        view_active: bool,
        now: u64,
    ) -> Result<PreparedTile, String> {
        request.validate()?;
        if !view_active {
            return Err("map.unavailable".to_string());
        }
        let png_path = self.tile_path(&request);
        let meta_path = self.meta_path(&request);
        let existing = self.load_meta(&meta_path, &png_path);
        if let Some(meta) = existing.as_ref() {
            if meta.expires_unix > now {
                return Ok(PreparedTile {
                    path: png_path,
                    byte_len: meta.byte_len,
                    cached: true,
                    expires_unix: meta.expires_unix,
                });
            }
        }
        let etag = existing.as_ref().and_then(|meta| meta.etag.clone());
        let previous = existing.as_ref().map(|meta| meta.byte_len).unwrap_or(0);
        if self.used_bytes()?.saturating_sub(previous) >= self.cap {
            return Err("map.limit".to_string());
        }
        // Native concurrency authority: at most two provider requests, even
        // if a caller bypasses the UI session.
        let _permit = self.gate.acquire()?;
        let fetched = self.fetcher.fetch(&request, etag.as_deref(), now)?;
        match fetched.bytes {
            None => {
                let Some(meta) = existing else {
                    return Err("map.unavailable".to_string());
                };
                self.write_meta(
                    &meta_path,
                    fetched.expires_unix,
                    fetched.etag.or(etag),
                    meta.byte_len,
                )?;
                Ok(PreparedTile {
                    path: png_path,
                    byte_len: meta.byte_len,
                    cached: true,
                    expires_unix: fetched.expires_unix,
                })
            }
            Some(bytes) => {
                validate_tile_bytes(&bytes)?;
                let len = bytes.len() as u64;
                self.check_capacity(previous, len)?;
                fs_service::atomic_write(&png_path, &bytes)
                    .map_err(|_| "map.unavailable".to_string())?;
                self.write_meta(&meta_path, fetched.expires_unix, fetched.etag, len)?;
                self.adjust_used(previous, len)?;
                Ok(PreparedTile {
                    path: png_path,
                    byte_len: len,
                    cached: false,
                    expires_unix: fetched.expires_unix,
                })
            }
        }
    }

    /// Grant an `adpfile` token for one prepared tile. The lease table is
    /// owned here so generic cache eviction can never shorten a visible tile.
    pub fn lease(&self, prepared: PreparedTile, grants: &FileGrants) -> Result<MapTile, String> {
        let mut leases = self
            .leases
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        if leases.len() >= MAX_TILE_LEASES {
            return Err("map.limit".to_string());
        }
        let token = grants.grant(prepared.path)?;
        let lease = MapTileLease {
            lease_id: uuid::Uuid::new_v4().to_string(),
            token,
            name: "tile.png".to_string(),
            mime: "image/png".to_string(),
            byte_len: prepared.byte_len,
            width: TILE_SIZE,
            height: TILE_SIZE,
        };
        lease.validate()?;
        leases.insert(lease.lease_id.clone(), StoredLease {
            token: lease.token.clone(),
        });
        Ok(MapTile {
            lease,
            cached: prepared.cached,
            expires_unix: prepared.expires_unix,
            attribution: OSM_ATTRIBUTION.to_string(),
        })
    }

    pub fn release(&self, lease_id: &str, grants: &FileGrants) -> Result<(), String> {
        search_index::types::validate_uuid(lease_id)
            .map_err(|_| "map.invalid".to_string())?;
        let stored = self
            .leases
            .lock()
            .map_err(|_| "map.unavailable".to_string())?
            .remove(lease_id);
        if let Some(stored) = stored {
            grants.revoke(&stored.token);
        }
        Ok(())
    }

    /// Drop every live tile token (the map view closed). Bytes stay cached.
    pub fn release_all(&self, grants: &FileGrants) -> Result<(), String> {
        let tokens: Vec<String> = self
            .leases
            .lock()
            .map_err(|_| "map.unavailable".to_string())?
            .drain()
            .map(|(_, stored)| stored.token)
            .collect();
        for token in tokens {
            if !is_valid_token(&token) {
                return Err("map.invalid".to_string());
            }
            grants.revoke(&token);
        }
        Ok(())
    }

    /// Tokens for the explicit Clear action; the caller revokes them so the
    /// adpfile protocol can no longer answer after the bytes are gone.
    fn take_leases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .leases
            .lock()
            .map_err(|_| "map.unavailable".to_string())?
            .drain()
            .map(|(_, stored)| stored.token)
            .collect())
    }

    fn clear_files(&self) -> Result<(), String> {
        match std::fs::remove_dir_all(&self.root) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("map.unavailable".to_string()),
        }
        let mut used = self
            .used
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        *used = Some(0);
        Ok(())
    }
}

fn png_bytes_under(root: &Path) -> u64 {
    let mut total = 0u64;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|ext| ext == "png") {
                total = total.saturating_add(entry.metadata().map(|meta| meta.len()).unwrap_or(0));
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// View leases
// ---------------------------------------------------------------------------

/// The current online map view. Tile requests are refused without it, and
/// opening one requires the persisted `map_online_enabled` setting.
#[derive(Default)]
pub struct MapViewLeases {
    active: Mutex<Option<String>>,
}

impl MapViewLeases {
    pub fn open(&self, online_enabled: bool) -> Result<String, String> {
        if !online_enabled {
            return Err("map.disabled".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut active = self
            .active
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        *active = Some(id.clone());
        Ok(id)
    }

    /// True when this call closed the active view; a stale id is ignored.
    pub fn close(&self, view_id: &str) -> Result<bool, String> {
        search_index::types::validate_uuid(view_id)
            .map_err(|_| "map.invalid".to_string())?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        if active.as_deref() == Some(view_id) {
            *active = None;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn is_active(&self) -> bool {
        self.active
            .lock()
            .map(|active| active.is_some())
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn map_view_open(
    window: WebviewWindow,
    state: State<'_, AppState>,
    leases: State<'_, MapViewLeases>,
) -> Result<String, String> {
    ensure_main(window.label())?;
    let online_enabled = state.views_settings()?.map_online_enabled;
    leases.open(online_enabled)
}

#[tauri::command]
pub fn map_view_close(
    window: WebviewWindow,
    leases: State<'_, MapViewLeases>,
    store: State<'_, MapTileStore>,
    grants: State<'_, Arc<FileGrants>>,
    view_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if leases.close(&view_id)? {
        store.release_all(grants.as_ref())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn map_tile_get(
    window: WebviewWindow,
    state: State<'_, AppState>,
    leases: State<'_, MapViewLeases>,
    store: State<'_, MapTileStore>,
    grants: State<'_, Arc<FileGrants>>,
    request: MapTileRequest,
) -> Result<MapTile, String> {
    ensure_main(window.label())?;
    request.validate()?;
    if !state.views_settings()?.map_online_enabled {
        return Err("map.disabled".to_string());
    }
    let view_active = leases.is_active();
    if !view_active {
        return Err("map.unavailable".to_string());
    }
    let worker = store.inner().clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        worker.prepare(request, true, unix_now())
    })
    .await
    .map_err(|_| "map.unavailable".to_string())??;
    store.inner().lease(prepared, grants.as_ref())
}

#[tauri::command]
pub fn map_tile_release(
    window: WebviewWindow,
    store: State<'_, MapTileStore>,
    grants: State<'_, Arc<FileGrants>>,
    lease_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    store.release(&lease_id, grants.as_ref())
}

#[tauri::command]
pub async fn map_tile_clear(
    window: WebviewWindow,
    store: State<'_, MapTileStore>,
    grants: State<'_, Arc<FileGrants>>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    for token in store.take_leases()? {
        if !is_valid_token(&token) {
            return Err("map.invalid".to_string());
        }
        grants.revoke(&token);
    }
    let worker = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || worker.clear_files())
        .await
        .map_err(|_| "map.unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const NOW: u64 = 1_700_000_000;

    struct CountingFetcher {
        calls: AtomicUsize,
        expires_unix: u64,
    }

    impl CountingFetcher {
        fn new(expires_unix: u64) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                expires_unix,
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::Relaxed)
        }
    }

    impl TileFetcher for CountingFetcher {
        fn fetch(
            &self,
            _request: &MapTileRequest,
            _etag: Option<&str>,
            _now: u64,
        ) -> Result<FetchedTile, String> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(FetchedTile {
                bytes: Some(png_bytes()),
                expires_unix: self.expires_unix,
                etag: Some("\"tile-1\"".to_string()),
            })
        }
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&[0u8; 16]);
        bytes
    }

    fn request() -> MapTileRequest {
        MapTileRequest {
            zoom: 3,
            x: 7,
            y: 7,
        }
    }

    #[test]
    // Guide oracle `7daycachefallback`: a Rust identifier cannot start with
    // a digit, so the same test is named `seven_day_cache_fallback`.
    fn seven_day_cache_fallback() {
        assert_eq!(ttl_seconds(None, None, NOW), MIN_TILE_TTL_SECONDS);
        assert_eq!(
            ttl_seconds(Some("public, max-age=3600"), None, NOW),
            3600
        );
        assert_eq!(ttl_seconds(Some("max-age=\"120\""), None, NOW), 120);
        assert_eq!(ttl_seconds(Some("no-store"), None, NOW), 0);
        // Sun, 06 Nov 1994 08:49:37 GMT
        assert_eq!(
            http_date_to_unix("Sun, 06 Nov 1994 08:49:37 GMT"),
            Some(784_111_777)
        );
        assert_eq!(
            ttl_seconds(
                None,
                Some("Sun, 06 Nov 1994 08:49:37 GMT"),
                784_111_000
            ),
            777
        );
        assert_eq!(ttl_seconds(None, Some("not a date"), NOW), MIN_TILE_TTL_SECONDS);
    }

    #[test]
    fn foreignredirectdeny() {
        assert!(response_is_refused(reqwest::StatusCode::FOUND));
        assert!(response_is_refused(
            reqwest::StatusCode::MOVED_PERMANENTLY
        ));
        assert!(response_is_refused(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!response_is_refused(reqwest::StatusCode::OK));
        assert!(is_osm_response_url(
            &reqwest::Url::parse("https://tile.openstreetmap.org/3/7/7.png").unwrap()
        ));
        assert!(!is_osm_response_url(
            &reqwest::Url::parse("https://example.invalid/3/7/7.png").unwrap()
        ));
        assert!(!is_osm_response_url(
            &reqwest::Url::parse("http://tile.openstreetmap.org/3/7/7.png").unwrap()
        ));
    }

    #[test]
    fn disabled0network() {
        let views = MapViewLeases::default();
        assert_eq!(views.open(false).unwrap_err(), "map.disabled");
        assert!(!views.is_active());

        let directory = tempfile::tempdir().unwrap();
        let fetcher = Arc::new(CountingFetcher::new(NOW + 60));
        let store = MapTileStore::with_fetcher(directory.path(), fetcher.clone());
        assert_eq!(
            store.prepare(request(), false, NOW).unwrap_err(),
            "map.unavailable"
        );
        assert_eq!(fetcher.calls(), 0);
        assert!(!directory.path().join("map-tiles").exists());
    }

    #[test]
    fn cached_tiles_do_not_refetch() {
        let directory = tempfile::tempdir().unwrap();
        let fetcher = Arc::new(CountingFetcher::new(NOW + 60));
        let store = MapTileStore::with_fetcher(directory.path(), fetcher.clone());
        let grants = FileGrants::default();

        let first = store.prepare(request(), true, NOW).unwrap();
        assert!(!first.cached);
        let first_lease = store.lease(first, &grants).unwrap();
        first_lease.lease.validate().unwrap();
        assert_eq!(
            grants.path_for(&first_lease.lease.token),
            Some(directory.path().join("map-tiles").join("3").join("7").join("7.png"))
        );

        let second = store.prepare(request(), true, NOW + 1).unwrap();
        assert!(second.cached);
        assert_eq!(fetcher.calls(), 1);
        let second_lease = store.lease(second, &grants).unwrap();
        assert_eq!(second_lease.attribution, OSM_ATTRIBUTION);

        store.release(&first_lease.lease.lease_id, &grants).unwrap();
        assert!(grants.path_for(&first_lease.lease.token).is_none());
        store.release_all(&grants).unwrap();
        assert!(grants.path_for(&second_lease.lease.token).is_none());
    }

    #[test]
    fn cache_full_stops_new_downloads() {
        let directory = tempfile::tempdir().unwrap();
        let fetcher = Arc::new(CountingFetcher::new(NOW + 60));
        let store = MapTileStore::with_fetcher_and_cap(
            directory.path(),
            fetcher.clone(),
            png_bytes().len() as u64,
        );
        let grants = FileGrants::default();
        let first = store.prepare(request(), true, NOW).unwrap();
        store.lease(first, &grants).unwrap();

        let elsewhere = MapTileRequest {
            zoom: 3,
            x: 6,
            y: 7,
        };
        assert_eq!(
            store.prepare(elsewhere, true, NOW).unwrap_err(),
            "map.limit"
        );
        assert_eq!(fetcher.calls(), 1);
    }
}
