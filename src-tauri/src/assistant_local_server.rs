//! Optional loopback OpenAI-compatible server guard (Step 17a T4/D6).
//!
//! HTTP only, literal loopback only, fixed `/v1` path, no redirect/proxy/DNS.
//! The app cannot attest that a separate server never forwards content, so the
//! same outbound review applies. An unavailable server leaves the turn
//! stopped; no other endpoint is tried.
#![allow(dead_code)]


use crate::assistant_provider::parse_url;

pub const MIN_PORT: u16 = 1_024;
pub const MAX_PORT: u16 = 65_535;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoopbackEndpoint {
    pub address: String,
    pub port: u16,
}

pub fn parse_loopback(raw: &str) -> Result<LoopbackEndpoint, String> {
    let url = parse_url(raw)?;
    if url.scheme != "http"
        || url.query.is_some()
        || url.fragment.is_some()
        || url.path != "/v1"
        || !(MIN_PORT..=MAX_PORT).contains(&url.port)
    {
        return Err("assistant.endpoint_denied".to_string());
    }
    let address = match url.host.as_str() {
        "127.0.0.1" => "127.0.0.1".to_string(),
        "[::1]" => "[::1]".to_string(),
        _ => return Err("assistant.endpoint_denied".to_string()),
    };
    Ok(LoopbackEndpoint {
        address,
        port: url.port,
    })
}

pub fn build_chat_url(endpoint: &LoopbackEndpoint) -> String {
    format!("http://{}:{}/v1/chat/completions", endpoint.address, endpoint.port)
}

pub fn build_models_url(endpoint: &LoopbackEndpoint) -> String {
    format!("http://{}:{}/v1/models", endpoint.address, endpoint.port)
}

/// A redirect is accepted only when it stays on the exact loopback origin.
pub fn location_allowed(endpoint: &LoopbackEndpoint, location: &str) -> bool {
    parse_url(location)
        .map(|url| {
            url.scheme == "http"
                && url.host == endpoint.address
                && url.port == endpoint.port
                && url.path.starts_with("/v1")
                && url.query.is_none()
                && url.fragment.is_none()
        })
        .unwrap_or(false)
}

pub fn external_redirect_denied(endpoint: &LoopbackEndpoint, location: &str) -> Result<(), String> {
    if location_allowed(endpoint, location) {
        Ok(())
    } else {
        Err("assistant.endpoint_denied".to_string())
    }
}

/// The server is never probed automatically; a failed probe is a stable code.
pub fn unavailable_code() -> String {
    "assistant.api_unavailable".to_string()
}
