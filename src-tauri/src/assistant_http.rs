//! Bounded native Meta account checks. No source content is sent by these calls.
use std::io::Read;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde::Deserialize;

use crate::assistant_provider::{error_for_status, ProviderTransport, MAX_RESPONSE_BYTES};
use crate::assistant_types::{
    AssistantConnectionResult, AssistantEndpointConfig, AssistantModel, AssistantProviderId,
};

pub struct MetaHttp;

#[derive(Deserialize)]
struct ModelList {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

fn parse_models(bytes: &[u8]) -> Result<Vec<AssistantModel>, String> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("assistant.api_response".into());
    }
    let list: ModelList =
        serde_json::from_slice(bytes).map_err(|_| "assistant.api_response".to_string())?;
    if list.data.len() > 128 {
        return Err("assistant.api_response".into());
    }
    let mut models = Vec::new();
    for entry in list.data {
        if entry.id.is_empty()
            || entry.id.len() > 96
            || !entry
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
            || models
                .iter()
                .any(|model: &AssistantModel| model.id == entry.id)
        {
            return Err("assistant.api_response".into());
        }
        // Listing an account model does not prove its schema/vision capabilities.
        models.push(AssistantModel {
            display_name: entry.id.clone(),
            id: entry.id,
            supports_schema: false,
            supports_vision: false,
            provider_id: AssistantProviderId::Meta,
        });
    }
    Ok(models)
}

impl ProviderTransport for MetaHttp {
    fn list_models(
        &self,
        provider: AssistantProviderId,
        endpoint: Option<&AssistantEndpointConfig>,
        secret: &[u8],
    ) -> Result<Vec<AssistantModel>, String> {
        // A Meta key must never be forwarded to an arbitrary configured origin.
        if provider != AssistantProviderId::Meta || endpoint.is_some() {
            return Err("assistant.provider_unsupported".into());
        }
        if secret.is_empty() || secret.len() > 4096 || !secret.iter().all(|b| b.is_ascii_graphic())
        {
            return Err("assistant.api_auth".into());
        }
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "assistant.api_unavailable".to_string())?;
        let mut bearer = b"Bearer ".to_vec();
        bearer.extend_from_slice(secret);
        let header = HeaderValue::from_bytes(&bearer);
        bearer.fill(0);
        let mut header = header.map_err(|_| "assistant.api_auth".to_string())?;
        header.set_sensitive(true);
        let response = client
            .get("https://api.meta.ai/v1/models")
            .header(AUTHORIZATION, header)
            .send()
            .map_err(|_| "assistant.api_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err(error_for_status(response.status().as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
        {
            return Err("assistant.api_response".into());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "assistant.api_response".to_string())?;
        parse_models(&bytes)
    }

    fn test_provider(
        &self,
        provider: AssistantProviderId,
        endpoint: Option<&AssistantEndpointConfig>,
        secret: &[u8],
    ) -> Result<AssistantConnectionResult, String> {
        match self.list_models(provider, endpoint, secret) {
            Ok(models) => Ok(AssistantConnectionResult {
                ok: true,
                error_code: None,
                model_ids: models.into_iter().map(|model| model.id).collect(),
            }),
            Err(code) => Ok(AssistantConnectionResult {
                ok: false,
                error_code: Some(code),
                model_ids: Vec::new(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_list_preserves_contributor_without_inventing_capabilities() {
        let rows = parse_models(br#"{"data":[{"id":"muse-spark-1.3-contributor"}]}"#).unwrap();
        assert_eq!(rows[0].id, "muse-spark-1.3-contributor");
        assert!(!rows[0].supports_schema);
        assert!(!rows[0].supports_vision);
    }

    #[test]
    fn model_list_refuses_duplicates_invalid_ids_and_oversized_bodies() {
        for bytes in [
            br#"{"data":[{"id":"a"},{"id":"a"}]}"#.as_slice(),
            br#"{"data":[{"id":"https://other.invalid"}]}"#.as_slice(),
            br#"{"data":[{"id":""}]}"#.as_slice(),
        ] {
            assert!(parse_models(bytes).is_err());
        }
        assert!(parse_models(&vec![b' '; MAX_RESPONSE_BYTES + 1]).is_err());
    }

    #[test]
    fn custom_provider_and_invalid_keys_never_reach_network() {
        assert!(MetaHttp
            .list_models(AssistantProviderId::CustomCompatible, None, b"key")
            .is_err());
        for secret in [b"".as_slice(), b"key\r\nInjected: bad".as_slice()] {
            assert!(MetaHttp
                .list_models(AssistantProviderId::Meta, None, secret)
                .is_err());
        }
    }
}
