//! Provider policy and request bounds (Step 17a T4).
//!
//! Pure, testable rules shared by Meta and a separately configured compatible
//! endpoint: exact URLs, no redirects, no proxies, no automatic retry, and
//! strict payload/response caps. No credential ever appears in a DTO or log.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::assistant_credentials::CredentialStore;
use crate::assistant_endpoint;
use crate::assistant_outbound::OutboundRegistry;
use crate::assistant_types::{
    AssistantConnectionResult, AssistantEndpointConfig, AssistantEndpointStatus, AssistantModel,
    AssistantProviderId, CredentialStatus,
};
use crate::ensure_main;

pub const META_BASE: &str = "https://api.meta.ai/v1";
pub const META_HOST: &str = "api.meta.ai";
pub const META_MODEL: &str = "muse-spark-1.3";
pub const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_SOURCE_BYTES: usize = 128 * 1024;
pub const MAX_HISTORY_MESSAGES: usize = 32;
pub const MAX_HISTORY_BYTES: usize = 128 * 1024;
pub const MAX_COMPLETION_TOKENS: u32 = 4_096;
pub const MAX_IMAGES: usize = 16;
pub const MAX_IMAGE_EDGE: u32 = 1_024;
pub const MAX_IMAGE_BYTES: usize = 512 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
pub const MAX_PROVISIONAL_BYTES: usize = 256 * 1024;
pub const MAX_TOOL_CALLS: usize = 256;
pub const CONNECT_TIMEOUT_SECS: u64 = 10;
pub const FIRST_BYTE_TIMEOUT_SECS: u64 = 30;
pub const IDLE_TIMEOUT_SECS: u64 = 15;
pub const TOTAL_TIMEOUT_SECS: u64 = 120;
pub const CONSENT_EXPIRY_SECS: u64 = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointUrl {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub query: Option<String>,
    pub fragment: Option<String>,
    pub userinfo: bool,
}

fn split_authority(raw: &str) -> Option<(&str, &str, &str)> {
    let (scheme, rest) = raw.split_once("://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    Some((scheme, &rest[..end], &rest[end..]))
}

pub fn parse_url(raw: &str) -> Result<EndpointUrl, String> {
    if raw.len() > 2_048 || raw.chars().any(char::is_whitespace) {
        return Err("assistant.endpoint_denied".to_string());
    }
    let (scheme, authority, tail) =
        split_authority(raw).ok_or_else(|| "assistant.endpoint_denied".to_string())?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("assistant.endpoint_denied".to_string());
    }
    if authority.is_empty() || authority.contains('@') {
        return Err("assistant.endpoint_denied".to_string());
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (host, rest) = inner
            .split_once(']')
            .ok_or_else(|| "assistant.endpoint_denied".to_string())?;
        if host.is_empty() {
            return Err("assistant.endpoint_denied".to_string());
        }
        let port = if rest.is_empty() {
            443
        } else {
            let value = rest
                .strip_prefix(':')
                .ok_or_else(|| "assistant.endpoint_denied".to_string())?;
            value
                .parse::<u16>()
                .map_err(|_| "assistant.endpoint_denied".to_string())?
        };
        (format!("[{host}]"), port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (
                host.to_ascii_lowercase(),
                port.parse::<u16>()
                    .map_err(|_| "assistant.endpoint_denied".to_string())?,
            ),
            None => (authority.to_ascii_lowercase(), 443),
        }
    };
    let (path, query, fragment) = {
        let (before_fragment, fragment) = match tail.split_once('#') {
            Some((before, fragment)) => (before, Some(fragment.to_string())),
            None => (tail, None),
        };
        let (path, query) = match before_fragment.split_once('?') {
            Some((path, query)) => (path.to_string(), Some(query.to_string())),
            None => (before_fragment.to_string(), None),
        };
        (path, query, fragment)
    };
    Ok(EndpointUrl {
        scheme,
        host,
        port,
        path: if path.is_empty() {
            "/".to_string()
        } else {
            path
        },
        query,
        fragment,
        userinfo: false,
    })
}

/// The Meta endpoint is fixed: HTTPS, exact host, port 443, `/v1`.
pub fn validate_meta_url(raw: &str) -> Result<EndpointUrl, String> {
    let url = parse_url(raw)?;
    if url.scheme != "https"
        || url.host != META_HOST
        || url.port != 443
        || url.query.is_some()
        || url.fragment.is_some()
        || !(url.path == "/v1" || url.path.starts_with("/v1/"))
        || url
            .path
            .split('/')
            .any(|segment| segment == "." || segment == ".." || segment.contains('%'))
    {
        return Err("assistant.endpoint_denied".to_string());
    }
    Ok(url)
}

/// The compatible endpoint is HTTPS, port 443, path ending in `/v1` and no
/// query/fragment/userinfo. Hostnames are resolved separately.
pub fn validate_custom_endpoint(raw: &str, model_id: &str) -> Result<EndpointUrl, String> {
    let url = parse_url(raw)?;
    if url.scheme != "https"
        || url.port != 443
        || url.query.is_some()
        || url.fragment.is_some()
        || !url.path.ends_with("/v1")
        || url.host.is_empty()
        || url.host.len() > 253
        || model_id.is_empty()
        || model_id.len() > 96
        || !model_id.is_ascii()
        || model_id.chars().any(char::is_whitespace)
    {
        return Err("assistant.endpoint_denied".to_string());
    }
    let host = url.host.to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".local") || !host.contains('.') {
        return Err("assistant.endpoint_denied".to_string());
    }
    for segment in url.path.split('/') {
        if segment == "." || segment == ".." || segment.contains('%') {
            return Err("assistant.endpoint_denied".to_string());
        }
    }
    Ok(url)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseBudget {
    pub request_bytes: usize,
    pub source_bytes: usize,
    pub history_messages: usize,
    pub history_bytes: usize,
    pub images: usize,
    pub image_edge: u32,
    pub image_bytes: usize,
    pub max_completion_tokens: u32,
}

impl Default for ResponseBudget {
    fn default() -> Self {
        Self {
            request_bytes: 0,
            source_bytes: 0,
            history_messages: 0,
            history_bytes: 0,
            images: 0,
            image_edge: 0,
            image_bytes: 0,
            max_completion_tokens: 1_024,
        }
    }
}

pub fn validate_budget(budget: &ResponseBudget) -> Result<(), String> {
    if budget.request_bytes > MAX_REQUEST_BYTES
        || budget.source_bytes > MAX_SOURCE_BYTES
        || budget.history_messages > MAX_HISTORY_MESSAGES
        || budget.history_bytes > MAX_HISTORY_BYTES
        || budget.images > MAX_IMAGES
        || budget.image_edge > MAX_IMAGE_EDGE
        || budget.image_bytes > MAX_IMAGE_BYTES
        || budget.max_completion_tokens == 0
        || budget.max_completion_tokens > MAX_COMPLETION_TOKENS
    {
        return Err("assistant.invalid".to_string());
    }
    Ok(())
}

/// HTTP status to stable assistant error code. No response body is shown.
pub fn error_for_status(status: u16) -> String {
    match status {
        400 | 404 | 409 | 422 => "assistant.api_response",
        401 | 403 => "assistant.api_auth",
        429 => "assistant.api_rate_limit",
        500..=599 => "assistant.api_unavailable",
        _ => "assistant.api_response",
    }
    .to_string()
}

/// A paid/remote request is never retried automatically.
pub fn should_retry(_status: Option<u16>) -> bool {
    false
}

/// External redirects are never followed, for Meta or loopback.
pub fn redirect_allowed(status: u16) -> bool {
    !(300..400).contains(&status)
}

pub fn credential_status(
    provider: AssistantProviderId,
    secret: Option<&[u8]>,
    updated: Option<u64>,
) -> CredentialStatus {
    let has_key = secret.map(|bytes| !bytes.is_empty()).unwrap_or(false);
    let hint = if has_key {
        secret.map(last_four).unwrap_or_default()
    } else {
        String::new()
    };
    CredentialStatus {
        provider_id: provider,
        has_key,
        masked_hint: hint,
        updated_unix: updated,
    }
}

/// Only the last four characters ever leave the credential store.
pub fn last_four(secret: &[u8]) -> String {
    let text = String::from_utf8_lossy(secret);
    let chars: Vec<char> = text.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// Detect an accidental credential-shaped value in a settings/export JSON.
pub fn contains_secret(value: &serde_json::Value, secret: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    match value {
        serde_json::Value::String(text) => text.contains(secret),
        serde_json::Value::Array(items) => items.iter().any(|item| contains_secret(item, secret)),
        serde_json::Value::Object(map) => map.values().any(|item| contains_secret(item, secret)),
        _ => false,
    }
}

/// A log line never includes an Authorization header or the secret itself.
pub fn redact_for_log(line: &str, secret: &str) -> String {
    let mut redacted = line.to_string();
    if !secret.is_empty() {
        redacted = redacted.replace(secret, "[redacted]");
    }
    redacted
        .replace("Authorization: Bearer", "Authorization: [redacted]")
        .replace("authorization: bearer", "authorization: [redacted]")
}

/// File names never included in a portable export.
pub fn export_omits_credentials(relative: &str) -> bool {
    !relative.to_ascii_lowercase().ends_with(".cred")
}

/// Changing provider starts a new conversation; old history is not uploaded.
pub fn provider_switch_starts_new_chat(
    old_provider: AssistantProviderId,
    new_provider: AssistantProviderId,
    old_message_count: usize,
) -> (bool, usize) {
    (
        old_provider != new_provider,
        if old_provider != new_provider {
            0
        } else {
            old_message_count
        },
    )
}

/// A selected local server is a separate source; it is not the bundled model.
pub fn local_server_requires_consent(local_server: bool) -> bool {
    local_server
}

/// Bundled local inference is confined to the computer; it never opens a
/// network socket. This is a constant, not a runtime preference.
pub fn local_bundled_uses_network() -> bool {
    false
}

/// Native password editor. Returns `None` when the user cancels.
pub trait CredentialEditor: Send + Sync {
    fn request_secret(&self, provider: AssistantProviderId) -> Result<Option<Vec<u8>>, String>;
}

/// Native confirmation of a custom origin before it is configured.
pub trait OriginPrompt: Send + Sync {
    fn confirm_origin(&self, origin: &str, model_id: &str) -> Result<bool, String>;
}

#[derive(Default)]
pub struct CredentialEditorState(pub Option<Arc<dyn CredentialEditor>>);

#[derive(Default)]
pub struct OriginPromptState(pub Option<Arc<dyn OriginPrompt>>);

/// HTTP side of provider list/test/probe. Missing methods fail closed; the
/// implementation receives the decrypted key only for one bounded call.
pub trait ProviderTransport: Send + Sync {
    fn list_models(
        &self,
        _provider: AssistantProviderId,
        _endpoint: Option<&AssistantEndpointConfig>,
        _secret: &[u8],
    ) -> Result<Vec<AssistantModel>, String> {
        Err("assistant.api_unavailable".to_string())
    }

    fn test_provider(
        &self,
        _provider: AssistantProviderId,
        _endpoint: Option<&AssistantEndpointConfig>,
        _secret: &[u8],
    ) -> Result<AssistantConnectionResult, String> {
        Ok(unavailable_connection())
    }

    fn probe_endpoint(
        &self,
        _endpoint: &AssistantEndpointConfig,
        _probe: assistant_endpoint::EndpointProbe,
        _secret: &[u8],
    ) -> Result<AssistantConnectionResult, String> {
        Ok(unavailable_connection())
    }
}

/// One active custom endpoint plus the optional HTTP adapter. The state holds
/// no credential; every call reads it from the owned credential store.
#[derive(Default)]
pub struct ProviderConfig {
    endpoint: Mutex<Option<AssistantEndpointConfig>>,
    transport: Option<Arc<dyn ProviderTransport>>,
}

impl ProviderConfig {
    pub fn new(transport: Option<Arc<dyn ProviderTransport>>) -> Self {
        Self {
            endpoint: Mutex::new(None),
            transport,
        }
    }

    pub(crate) fn endpoint_snapshot(&self) -> Result<Option<AssistantEndpointConfig>, String> {
        self.endpoint
            .lock()
            .map(|config| config.clone())
            .map_err(|_| "assistant.failed".to_string())
    }

    fn set_endpoint(&self, config: AssistantEndpointConfig) -> Result<(), String> {
        *self
            .endpoint
            .lock()
            .map_err(|_| "assistant.failed".to_string())? = Some(config);
        Ok(())
    }

    fn mark_probe(
        &self,
        endpoint_id: uuid::Uuid,
        probe: assistant_endpoint::EndpointProbe,
        ok: bool,
        now: u64,
    ) -> Result<(), String> {
        let mut slot = self
            .endpoint
            .lock()
            .map_err(|_| "assistant.failed".to_string())?;
        let config = slot
            .as_mut()
            .filter(|config| config.id == endpoint_id)
            .ok_or_else(|| "assistant.endpoint_denied".to_string())?;
        assistant_endpoint::mark_probe(config, probe, ok, now);
        Ok(())
    }
}

fn unavailable_connection() -> AssistantConnectionResult {
    AssistantConnectionResult {
        ok: false,
        error_code: Some("assistant.api_unavailable".to_string()),
        model_ids: Vec::new(),
    }
}

fn parse_provider_id(value: &str) -> Result<AssistantProviderId, String> {
    match value {
        "meta" => Ok(AssistantProviderId::Meta),
        "custom_compatible" => Ok(AssistantProviderId::CustomCompatible),
        _ => Err("assistant.provider_invalid".to_string()),
    }
}

fn provider_endpoint(
    store: &ProviderConfig,
    provider: AssistantProviderId,
) -> Result<Option<AssistantEndpointConfig>, String> {
    match provider {
        AssistantProviderId::Meta => Ok(None),
        AssistantProviderId::CustomCompatible => store
            .endpoint_snapshot()?
            .map(Some)
            .ok_or_else(|| "assistant.provider_invalid".to_string()),
    }
}

fn validate_models(
    models: Vec<AssistantModel>,
    provider: AssistantProviderId,
) -> Result<Vec<AssistantModel>, String> {
    if models.len() > 128
        || models.iter().any(|model| {
            model.id.is_empty()
                || model.id.len() > 96
                || !model.id.is_ascii()
                || model.id.chars().any(char::is_whitespace)
                || model.display_name.chars().count() > 128
                || model.provider_id != provider
        })
    {
        return Err("assistant.api_response".to_string());
    }
    Ok(models)
}

fn normalize_connection(
    mut result: AssistantConnectionResult,
) -> Result<AssistantConnectionResult, String> {
    if result.model_ids.len() > 128
        || result.model_ids.iter().any(|id| {
            id.is_empty() || id.len() > 96 || !id.is_ascii() || id.chars().any(char::is_whitespace)
        })
    {
        return Err("assistant.api_response".to_string());
    }
    if let Some(code) = result.error_code.as_deref() {
        if code.is_empty() || code.len() > 96 || !code.is_ascii() {
            return Err("assistant.api_response".to_string());
        }
    }
    if result.ok {
        if result.error_code.is_some() {
            return Err("assistant.api_response".to_string());
        }
    } else if result.error_code.is_none() {
        result.error_code = Some("assistant.api_unavailable".to_string());
    }
    Ok(result)
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn assistant_credential_status(
    window: WebviewWindow,
    store: State<'_, CredentialStore>,
    provider_id: String,
) -> Result<CredentialStatus, String> {
    ensure_main(window.label())?;
    let provider = parse_provider_id(&provider_id)?;
    store.status(provider)
}

#[tauri::command]
pub fn assistant_credential_edit(
    window: WebviewWindow,
    store: State<'_, CredentialStore>,
    editor: State<'_, CredentialEditorState>,
    provider_id: String,
) -> Result<CredentialStatus, String> {
    ensure_main(window.label())?;
    let provider = parse_provider_id(&provider_id)?;
    let editor = editor
        .0
        .as_ref()
        .ok_or_else(|| "assistant.failed".to_string())?;
    let Some(mut secret) = editor.request_secret(provider)? else {
        return store.status(provider);
    };
    let result = store.edit(provider, &secret);
    secret.fill(0);
    result
}

#[tauri::command]
pub fn assistant_credential_remove(
    window: WebviewWindow,
    store: State<'_, CredentialStore>,
    provider_id: String,
) -> Result<CredentialStatus, String> {
    ensure_main(window.label())?;
    let provider = parse_provider_id(&provider_id)?;
    store.remove(provider)
}

#[tauri::command]
pub async fn assistant_provider_models(
    window: WebviewWindow,
    store: State<'_, ProviderConfig>,
    credentials: State<'_, CredentialStore>,
    provider_id: String,
) -> Result<Vec<AssistantModel>, String> {
    ensure_main(window.label())?;
    let provider = parse_provider_id(&provider_id)?;
    let endpoint = provider_endpoint(&store, provider)?;
    let status = credentials.status(provider)?;
    if !status.has_key {
        return Err("assistant.api_auth".to_string());
    }
    let transport = store
        .transport
        .as_ref()
        .cloned()
        .ok_or_else(|| "assistant.api_unavailable".to_string())?;
    let secret = zeroize::Zeroizing::new(credentials.secret(provider)?);
    let models = tauri::async_runtime::spawn_blocking(move || {
        transport.list_models(provider, endpoint.as_ref(), &secret)
    })
    .await
    .map_err(|_| "assistant.api_unavailable".to_string())?;
    validate_models(models?, provider)
}

#[tauri::command]
pub async fn assistant_provider_test(
    window: WebviewWindow,
    store: State<'_, ProviderConfig>,
    credentials: State<'_, CredentialStore>,
    provider_id: String,
) -> Result<AssistantConnectionResult, String> {
    ensure_main(window.label())?;
    let provider = parse_provider_id(&provider_id)?;
    let endpoint = provider_endpoint(&store, provider)?;
    let status = credentials.status(provider)?;
    if !status.has_key {
        return Err("assistant.api_auth".to_string());
    }
    let Some(transport) = store.transport.as_ref().cloned() else {
        return Ok(unavailable_connection());
    };
    let secret = zeroize::Zeroizing::new(credentials.secret(provider)?);
    let result = tauri::async_runtime::spawn_blocking(move || {
        transport.test_provider(provider, endpoint.as_ref(), &secret)
    })
    .await
    .map_err(|_| "assistant.api_unavailable".to_string())?;
    normalize_connection(result?)
}

#[tauri::command]
pub fn assistant_endpoint_configure(
    window: WebviewWindow,
    store: State<'_, ProviderConfig>,
    origins: State<'_, OriginPromptState>,
    outbound: State<'_, OutboundRegistry>,
    credentials: State<'_, CredentialStore>,
    base_url: String,
    model_id: String,
) -> Result<AssistantEndpointStatus, String> {
    ensure_main(window.label())?;
    validate_custom_endpoint(&base_url, &model_id)?;
    let parsed = parse_url(&base_url)?;
    if parsed.host == META_HOST {
        return Err("assistant.endpoint_denied".to_string());
    }
    let existing = store.endpoint_snapshot()?;
    let mut config = assistant_endpoint::configure(&base_url, &model_id, existing.as_ref())?;
    if let Some(previous) = existing.as_ref() {
        if !assistant_endpoint::changed_origin(Some(previous), &config) {
            config.schema_supported = previous.schema_supported;
            config.vision_supported = previous.vision_supported;
            config.tested_unix = previous.tested_unix;
        }
    }
    let origin_changed = existing
        .as_ref()
        .map(|previous| {
            previous.host != config.host
                || previous.port != config.port
                || parse_url(&previous.base_url).ok().map(|url| url.path)
                    != parse_url(&config.base_url).ok().map(|url| url.path)
        })
        .unwrap_or(false);
    let key_must_be_cleared = existing.is_none() || origin_changed;
    let origin = assistant_endpoint::EndpointOrigin::from_config(&config)?;
    let display = format!("{}://{}", origin.scheme, origin.host);
    let prompt = origins
        .0
        .as_ref()
        .ok_or_else(|| "assistant.failed".to_string())?;
    if !prompt.confirm_origin(&display, &config.model_id)? {
        return Err("assistant.confirmation_required".to_string());
    }
    outbound.invalidate_all()?;
    if key_must_be_cleared {
        // Without a known previous origin (for example after a restart before
        // persisted endpoint hydration) the existing custom key cannot be
        // proven to belong to this origin. Remove it rather than risk sending
        // it to a different host; the user re-enters it explicitly.
        credentials.remove(AssistantProviderId::CustomCompatible)?;
    }
    store.set_endpoint(config.clone())?;
    Ok(assistant_endpoint::status(Some(&config)))
}

#[tauri::command]
pub fn assistant_endpoint_status(
    window: WebviewWindow,
    store: State<'_, ProviderConfig>,
) -> Result<AssistantEndpointStatus, String> {
    ensure_main(window.label())?;
    let config = store.endpoint_snapshot()?;
    Ok(assistant_endpoint::status(config.as_ref()))
}

#[tauri::command]
pub fn assistant_endpoint_probe(
    window: WebviewWindow,
    store: State<'_, ProviderConfig>,
    credentials: State<'_, CredentialStore>,
    endpoint_id: String,
    probe: String,
) -> Result<AssistantConnectionResult, String> {
    ensure_main(window.label())?;
    let endpoint_id =
        uuid::Uuid::parse_str(&endpoint_id).map_err(|_| "assistant.invalid".to_string())?;
    let probe_kind = match probe.as_str() {
        "models" => assistant_endpoint::EndpointProbe::Models,
        "structured" => assistant_endpoint::EndpointProbe::Structured,
        "vision" => assistant_endpoint::EndpointProbe::Vision,
        _ => return Err("assistant.invalid".to_string()),
    };
    let config = store
        .endpoint_snapshot()?
        .ok_or_else(|| "assistant.provider_invalid".to_string())?;
    if config.id != endpoint_id {
        return Err("assistant.endpoint_denied".to_string());
    }
    let status = credentials.status(AssistantProviderId::CustomCompatible)?;
    if !status.has_key {
        return Err("assistant.api_auth".to_string());
    }
    let Some(transport) = store.transport.as_ref() else {
        return Ok(unavailable_connection());
    };
    let mut secret = credentials.secret(AssistantProviderId::CustomCompatible)?;
    let result = transport.probe_endpoint(&config, probe_kind, &secret);
    secret.fill(0);
    let normalized = match result {
        Ok(result) => normalize_connection(result),
        Err(error) => {
            store.mark_probe(endpoint_id, probe_kind, false, now_unix())?;
            return Err(error);
        }
    };
    let ok = normalized.as_ref().map(|result| result.ok).unwrap_or(false);
    store.mark_probe(endpoint_id, probe_kind, ok, now_unix())?;
    normalized
}

#[cfg(test)]
#[path = "assistant_provider_step17a_tests.rs"]
mod step17a_tests;
