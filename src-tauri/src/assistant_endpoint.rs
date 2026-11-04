//! Separately configured compatible endpoint (Step 17a T4).
//!
//! One active custom endpoint per profile. Changing host/port/path resets
//! capability tests, starts a new chat, invalidates all outbound consents and
//! drops the association with the old credential. No model/tool argument can
//! choose this address.
#![allow(dead_code)]


use uuid::Uuid;

use crate::assistant_provider::{parse_url, validate_custom_endpoint};
use crate::assistant_types::{AssistantEndpointConfig, AssistantEndpointStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndpointOrigin {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub path: String,
}

impl EndpointOrigin {
    pub fn from_config(config: &AssistantEndpointConfig) -> Result<Self, String> {
        let url = parse_url(&config.base_url)?;
        Ok(Self {
            scheme: url.scheme,
            host: url.host,
            port: url.port,
            path: url.path,
        })
    }
}

pub fn configure(
    base_url: &str,
    model_id: &str,
    existing: Option<&AssistantEndpointConfig>,
) -> Result<AssistantEndpointConfig, String> {
    let url = validate_custom_endpoint(base_url, model_id)?;
    let generation = existing
        .map(|config| {
            config.generation
                + u64::from(
                    config.base_url != base_url || config.model_id != model_id,
                )
        })
        .unwrap_or(1);
    let id = existing.map(|config| config.id).unwrap_or_else(Uuid::new_v4);
    Ok(AssistantEndpointConfig {
        id,
        base_url: format!("https://{}{}", url.host, url.path),
        host: url.host,
        port: 443,
        model_id: model_id.to_string(),
        generation,
        schema_supported: false,
        vision_supported: false,
        tested_unix: None,
    })
}

pub fn status(config: Option<&AssistantEndpointConfig>) -> AssistantEndpointStatus {
    match config {
        Some(config) => AssistantEndpointStatus {
            id: Some(config.id),
            display_origin: Some(format!("https://{}", config.host)),
            model_id: Some(config.model_id.clone()),
            generation: config.generation,
            configured: true,
            schema_supported: config.schema_supported,
            vision_supported: config.vision_supported,
            tested_unix: config.tested_unix,
        },
        None => AssistantEndpointStatus {
            id: None,
            display_origin: None,
            model_id: None,
            generation: 0,
            configured: false,
            schema_supported: false,
            vision_supported: false,
            tested_unix: None,
        },
    }
}

/// Any origin change is a new association; old consents are void.
pub fn changed_origin(
    previous: Option<&AssistantEndpointConfig>,
    next: &AssistantEndpointConfig,
) -> bool {
    match previous {
        None => true,
        Some(previous) => {
            previous.host != next.host
                || previous.port != next.port
                || previous.model_id != next.model_id
                || parse_url(&previous.base_url).ok().map(|u| u.path)
                    != parse_url(&next.base_url).ok().map(|u| u.path)
        }
    }
}

/// No schema support means no execution, independent of a model name.
pub fn execution_allowed(config: &AssistantEndpointConfig, probe_ok: bool) -> bool {
    config.schema_supported && probe_ok
}

/// A probe is an explicit one-click action; there is no automatic test.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointProbe {
    Models,
    Structured,
    Vision,
}

pub fn mark_probe(config: &mut AssistantEndpointConfig, probe: EndpointProbe, ok: bool, now: u64) {
    if !ok {
        config.schema_supported = false;
        config.tested_unix = None;
        return;
    }
    match probe {
        EndpointProbe::Models => {}
        EndpointProbe::Structured => config.schema_supported = true,
        EndpointProbe::Vision => config.vision_supported = true,
    }
    config.tested_unix = Some(now);
}
