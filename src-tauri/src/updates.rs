//! Opt-in release checks (Step 08d T5/E2-E4).
//!
//! The check is off by default. Automatic checks require `updates.enabled`
//! and run at most once per 24 hours; a manual check is an explicit request.
//! Only the fixed GitHub API endpoint is contacted, over TLS, with a
//! 10-second timeout and a 256 KiB response cap. Nothing is downloaded or
//! installed. The release page opens only from the last validated URL kept
//! in native state, never from a URL supplied by the UI.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{State, WebviewWindow};

use crate::release_version::ReleaseVersion;

/// The only update endpoint the app contacts.
pub const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/stefanods29/Adperastra/releases/latest";
/// Response cap (256 KiB).
pub const MAX_RESPONSE_BYTES: u64 = 256 * 1024;
/// Network timeout in seconds.
pub const TIMEOUT_SECS: u64 = 10;
/// Automatic checks are limited to one per day.
pub const RATE_LIMIT_SECS: u64 = 24 * 60 * 60;
/// Longest version text accepted in settings or a response.
pub const MAX_VERSION_CHARS: usize = 128;
/// Longest release page URL accepted.
pub const MAX_URL_CHARS: usize = 2048;
/// Largest integer JavaScript stores without losing precision.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const RELEASE_PREFIX: &str = "https://github.com/stefanods29/Adperastra/releases";

/// Schema-19 update preferences. The fields are additive with defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub struct UpdateSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub last_seen_version: String,
    #[serde(default)]
    pub last_check_unix: u64,
}


impl UpdateSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.last_seen_version.chars().count() > MAX_VERSION_CHARS {
            return Err("updates.invalid_settings".to_string());
        }
        if !self.last_seen_version.is_empty() {
            ReleaseVersion::parse(&self.last_seen_version)
                .map_err(|_| "updates.invalid_settings".to_string())?;
        }
        if self.last_check_unix > MAX_SAFE_INTEGER {
            return Err("updates.invalid_settings".to_string());
        }
        Ok(())
    }
}

/// E2: no installer URL and no action, only the checked facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub available: bool,
    pub release_url: Option<String>,
    pub checked_unix: u64,
}

#[derive(Debug, Deserialize)]
struct ReleasePayload {
    tag_name: Option<String>,
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// The E3 gate before any network access.
pub fn check_preconditions(
    settings: &UpdateSettings,
    manual: bool,
    now_unix: u64,
) -> Result<(), String> {
    if manual {
        return Ok(());
    }
    if !settings.enabled {
        return Err("updates.disabled".to_string());
    }
    if settings.last_check_unix > 0
        && now_unix.saturating_sub(settings.last_check_unix) < RATE_LIMIT_SECS
    {
        return Err("updates.rate_limited".to_string());
    }
    Ok(())
}

/// Accepts only the project's release path on github.com.
pub fn validate_release_url(url: &str) -> Result<(), String> {
    if url.is_empty()
        || url.chars().count() > MAX_URL_CHARS
        || !url.is_ascii()
        || url.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("updates.invalid_response".to_string());
    }
    let rest = url
        .strip_prefix(RELEASE_PREFIX)
        .ok_or_else(|| "updates.invalid_response".to_string())?;
    if !rest.is_empty() && !rest.starts_with('/') {
        return Err("updates.invalid_response".to_string());
    }
    if rest.contains('?')
        || rest.contains('#')
        || rest.contains('\\')
        || rest.contains('%')
        || rest.contains(':')
        || rest.starts_with("//")
        || rest.split('/').any(|part| part == "." || part == "..")
    {
        return Err("updates.invalid_response".to_string());
    }
    Ok(())
}

/// Reads at most `max` bytes; one extra byte proves the response is too big.
pub fn read_bounded<R: Read>(reader: &mut R, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut limited = reader.take(max.saturating_add(1));
    limited
        .read_to_end(&mut bytes)
        .map_err(|_| "updates.network".to_string())?;
    if bytes.len() as u64 > max {
        return Err("updates.invalid_response".to_string());
    }
    Ok(bytes)
}

/// Parses a GitHub latest-release response. Draft and prerelease entries are
/// ignored rather than offered.
pub fn parse_release_payload(
    json: &[u8],
    current_version: &str,
    checked_unix: u64,
) -> Result<UpdateInfo, String> {
    if checked_unix > MAX_SAFE_INTEGER {
        return Err("updates.invalid_response".to_string());
    }
    let current = ReleaseVersion::parse(current_version)
        .map_err(|_| "updates.invalid_response".to_string())?;
    let payload: ReleasePayload =
        serde_json::from_slice(json).map_err(|_| "updates.invalid_response".to_string())?;
    if payload.draft || payload.prerelease {
        return Ok(UpdateInfo {
            current_version: current.to_string(),
            latest_version: None,
            available: false,
            release_url: None,
            checked_unix,
        });
    }
    let tag = payload
        .tag_name
        .ok_or_else(|| "updates.invalid_response".to_string())?;
    let latest =
        ReleaseVersion::parse_tag(&tag).map_err(|_| "updates.invalid_response".to_string())?;
    let url = payload
        .html_url
        .ok_or_else(|| "updates.invalid_response".to_string())?;
    validate_release_url(&url)?;
    Ok(UpdateInfo {
        current_version: current.to_string(),
        latest_version: Some(latest.to_string()),
        available: latest.is_newer_than(&current),
        release_url: Some(url),
        checked_unix,
    })
}

/// Synchronous transport; tests inject a fake, the app uses HTTPS.
pub trait ReleaseTransport: Send + Sync {
    fn fetch_latest(&self) -> Result<Vec<u8>, String>;
}

pub struct HttpReleaseTransport {
    client: reqwest::blocking::Client,
}

impl HttpReleaseTransport {
    pub fn new(app_version: &str) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECS))
            .user_agent(format!("Adperastra/{app_version}"))
            .build()
            .map_err(|_| "updates.network".to_string())?;
        Ok(Self { client })
    }
}

impl ReleaseTransport for HttpReleaseTransport {
    fn fetch_latest(&self) -> Result<Vec<u8>, String> {
        let response = self
            .client
            .get(LATEST_RELEASE_URL)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .map_err(|_| "updates.network".to_string())?;
        if !response.status().is_success() {
            return Err("updates.network".to_string());
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES)
        {
            return Err("updates.invalid_response".to_string());
        }
        let mut response = response;
        read_bounded(&mut response, MAX_RESPONSE_BYTES)
    }
}

/// Runs one check and returns its facts; the caller persists the timestamp.
pub fn check_with_transport(
    transport: &dyn ReleaseTransport,
    current_version: &str,
    settings: &UpdateSettings,
    manual: bool,
    now_unix: u64,
) -> Result<UpdateInfo, String> {
    check_preconditions(settings, manual, now_unix)?;
    let body = transport.fetch_latest()?;
    parse_release_payload(&body, current_version, now_unix)
}

/// The last validated release page, kept only in native memory.
#[derive(Default)]
pub struct UpdatesService {
    checking: AtomicBool,
    last_release_url: Mutex<Option<String>>,
}

impl UpdatesService {
    pub fn remember_release_url(&self, url: Option<String>) {
        let validated = url.filter(|value| validate_release_url(value).is_ok());
        if let Ok(mut slot) = self.last_release_url.lock() {
            *slot = validated;
        }
    }

    pub fn release_url(&self) -> Option<String> {
        self.last_release_url
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
    }
}

#[tauri::command]
pub async fn update_check(
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    service: State<'_, UpdatesService>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    manual: bool,
) -> Result<UpdateInfo, String> {
    crate::ensure_main(window.label())?;
    // Step 09h: a check persists its timestamp, so safe mode refuses it
    // before any network access or settings write.
    safe.settings_writable()?;
    let (settings, current_version) = {
        let cached = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        (
            cached.updates.clone(),
            env!("CARGO_PKG_VERSION").to_string(),
        )
    };
    let now = crate::unix_now();
    check_preconditions(&settings, manual, now)?;
    if service.checking.swap(true, Ordering::AcqRel) {
        return Err("updates.rate_limited".to_string());
    }
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let transport = HttpReleaseTransport::new(&current_version)?;
        check_with_transport(&transport, &current_version, &settings, manual, now)
    })
    .await;
    service.checking.store(false, Ordering::Release);
    let info = joined.map_err(|error| error.to_string())??;

    let updated = {
        let mut cached = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        cached.updates.last_check_unix = info.checked_unix;
        cached.clone()
    };
    // Best effort: the check result is still usable when the settings file
    // cannot be written, and the next UI save retries the same value.
    let _ = crate::save_settings_to_dir(&state.data_dir, &updated);
    if let Ok(mut cached) = state.settings.lock() {
        *cached = updated;
    }
    service.remember_release_url(info.release_url.clone());
    Ok(info)
}

fn validate_whats_new_version(version: &str) -> Result<(), String> {
    if version.chars().count() > MAX_VERSION_CHARS
        || version != env!("CARGO_PKG_VERSION")
    {
        return Err("updates.invalid_settings".to_string());
    }
    ReleaseVersion::parse(version)
        .map(|_| ())
        .map_err(|_| "updates.invalid_settings".to_string())
}

/// D8: records the version whose What's new page was shown. Only this field
/// is changed, under the settings lock, so a stale UI object cannot overwrite
/// other settings.
#[tauri::command]
pub fn update_mark_seen(
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    version: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    // Step 09h: recording the seen version rewrites settings.json.
    safe.settings_writable()?;
    validate_whats_new_version(&version)?;
    let updated = {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        settings.updates.last_seen_version = version;
        settings.clone()
    };
    crate::save_settings_to_dir(&state.data_dir, &updated).map_err(String::from)?;
    if let Ok(mut cached) = state.settings.lock() {
        *cached = updated;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_open_page(
    window: WebviewWindow,
    service: State<'_, UpdatesService>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let url = service
        .release_url()
        .ok_or_else(|| "updates.unavailable".to_string())?;
    validate_release_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || crate::links::shell_open(&url))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;
