//! One-use outbound consent for file-derived payloads (Step 17a T4/D4).
//!
//! Preparing a request never touches the network. A native human review
//! creates a consent bound to the provider, model, exact payload hash, source
//! revisions and expiry. Replay, expiry, a changed source or a changed hash
//! refuses before the key or body is disclosed.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use ai_runtime::types::{AiResultPayload, AiTaskKind, AiTaskRequest, AiTaskResult};
use ai_runtime::validation::{
    ascii_bounded, validate_options_keys, validate_request_shape, validate_result_shape,
};
use fs_service::CancellationToken;

use crate::assistant::AssistantService;
use crate::assistant_credentials::CredentialStore;
use crate::assistant_provider::{ProviderConfig, CONSENT_EXPIRY_SECS};
use crate::assistant_types::{
    AssistantBackend, AssistantEndpointConfig, AssistantLocalSource, AssistantOutboundPreview,
    AssistantOutboundSource, AssistantProviderId, AssistantSettings,
};
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

const MAX_INFERENCE_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRevision {
    pub input_id: Uuid,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundConsent {
    pub id: Uuid,
    pub preview_id: Uuid,
    /// `None` for a loopback user server; API consents always bind a provider.
    pub provider_id: Option<crate::assistant_types::AssistantProviderId>,
    pub model_id: String,
    pub payload_sha256: String,
    pub source_revisions: Vec<SourceRevision>,
    pub chat_revision: u64,
    pub one_use: bool,
    pub expires_unix: u64,
}

struct PreviewRecord {
    preview: AssistantOutboundPreview,
    payload: Vec<u8>,
    source_revisions: Vec<SourceRevision>,
}

#[derive(Default)]
pub struct OutboundRegistry {
    previews: Mutex<HashMap<Uuid, PreviewRecord>>,
    consents: Mutex<HashMap<Uuid, OutboundConsent>>,
    used: Mutex<HashSet<Uuid>>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|_| "assistant.failed".to_string())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl OutboundRegistry {
    pub fn prepare(
        &self,
        mut preview: AssistantOutboundPreview,
        payload: &[u8],
        source_revisions: Vec<SourceRevision>,
        now: u64,
    ) -> Result<AssistantOutboundPreview, String> {
        if payload.len() > 2 * 1024 * 1024 {
            return Err("assistant.invalid".to_string());
        }
        if preview.sources.len() > 128 {
            return Err("assistant.invalid".to_string());
        }
        if preview.sources.iter().any(|source| source.excerpt.len() > 8_192) {
            return Err("assistant.invalid".to_string());
        }
        preview.payload_sha256 = Some(sha256_hex(payload));
        preview.byte_len = payload.len() as u64;
        preview.expires_unix = now + CONSENT_EXPIRY_SECS;
        preview.requires_consent = preview.backend == crate::assistant_types::AssistantBackend::Api
            || preview.local_server;
        lock(&self.previews)?.insert(
            preview.preview_id,
            PreviewRecord {
                preview: preview.clone(),
                payload: payload.to_vec(),
                source_revisions,
            },
        );
        Ok(preview)
    }

    /// Only this native review path can make a consent. `approved` is set by
    /// the native dialog, never by WebView/model text.
    pub fn confirm(
        &self,
        preview_id: Uuid,
        approved: bool,
        chat_revision: u64,
        now: u64,
    ) -> Result<OutboundConsent, String> {
        if !approved {
            return Err("assistant.outbound_required".to_string());
        }
        let previews = lock(&self.previews)?;
        let record = previews
            .get(&preview_id)
            .ok_or_else(|| "assistant.outbound_required".to_string())?;
        if now > record.preview.expires_unix {
            return Err("assistant.outbound_expired".to_string());
        }
        let consent = OutboundConsent {
            id: Uuid::new_v4(),
            preview_id,
            provider_id: record.preview.provider_id,
            model_id: record.preview.model_id.clone(),
            payload_sha256: record
                .preview
                .payload_sha256
                .clone()
                .ok_or_else(|| "assistant.outbound_required".to_string())?,
            source_revisions: record.source_revisions.clone(),
            chat_revision,
            one_use: true,
            expires_unix: record.preview.expires_unix,
        };
        lock(&self.consents)?.insert(consent.id, consent.clone());
        Ok(consent)
    }

    /// Validate and consume exactly once, immediately before the network
    /// call. A changed payload/source or a replay never reaches the network.
    #[allow(clippy::too_many_arguments)]
    pub fn take_for_send(
        &self,
        consent_id: Uuid,
        provider_id: Option<crate::assistant_types::AssistantProviderId>,
        model_id: &str,
        payload_sha256: &str,
        current_revisions: &[SourceRevision],
        chat_revision: u64,
        now: u64,
    ) -> Result<OutboundConsent, String> {
        if lock(&self.used)?.contains(&consent_id) {
            return Err("assistant.outbound_required".to_string());
        }
        let consents = lock(&self.consents)?;
        let consent = consents
            .get(&consent_id)
            .cloned()
            .ok_or_else(|| "assistant.outbound_required".to_string())?;
        if now > consent.expires_unix {
            return Err("assistant.outbound_expired".to_string());
        }
        if consent.provider_id != provider_id || consent.model_id != model_id {
            return Err("assistant.changed".to_string());
        }
        if consent.chat_revision != chat_revision {
            return Err("assistant.changed".to_string());
        }
        if consent.payload_sha256 != payload_sha256
            || consent.source_revisions != current_revisions
        {
            return Err("assistant.changed".to_string());
        }
        drop(consents);
        if !lock(&self.used)?.insert(consent_id) {
            return Err("assistant.outbound_required".to_string());
        }
        Ok(consent)
    }

    pub fn payload(&self, preview_id: Uuid) -> Result<Vec<u8>, String> {
        lock(&self.previews)?
            .get(&preview_id)
            .map(|record| record.payload.clone())
            .ok_or_else(|| "assistant.outbound_required".to_string())
    }

    pub fn preview(&self, preview_id: Uuid) -> Result<AssistantOutboundPreview, String> {
        lock(&self.previews)?
            .get(&preview_id)
            .map(|record| record.preview.clone())
            .ok_or_else(|| "assistant.outbound_required".to_string())
    }

    /// A provider/endpoint/profile change voids every pending consent.
    pub fn invalidate_all(&self) -> Result<(), String> {
        lock(&self.previews)?.clear();
        lock(&self.consents)?.clear();
        lock(&self.used)?.clear();
        Ok(())
    }
}

/// Local bundled inference never needs an outbound consent.
pub fn local_bundled_needs_consent(local_source_bundled: bool) -> bool {
    !local_source_bundled
}

/// Native review of the exact outbound bytes before a consent is created.
pub trait OutboundApproval: Send + Sync {
    fn approve(&self, preview: &AssistantOutboundPreview) -> Result<bool, String>;
}

#[derive(Default)]
pub struct OutboundApprovalState(pub Option<Arc<dyn OutboundApproval>>);

/// The selected inference adapter. Without it every API/14c start fails
/// closed; this command layer never fabricates a result.
pub trait InferenceHost: Send + Sync {
    /// Exact source description for the native review. Sensitive sources must
    /// fail instead of returning a partial list.
    fn preview_sources(
        &self,
        request: &AiTaskRequest,
    ) -> Result<Vec<AssistantOutboundSource>, String>;

    /// Build the exact semantic request bytes (system instruction, history,
    /// sources, schema, tools) without any network call. `infer` must send
    /// exactly these bytes; the generated job id is not part of them.
    fn build_payload(
        &self,
        request: &AiTaskRequest,
        sources: &[AssistantOutboundSource],
    ) -> Result<Vec<u8>, String>;

    /// Send `payload` only after the command consumed the one-use consent.
    #[allow(clippy::too_many_arguments)]
    fn infer(
        &self,
        request: &AiTaskRequest,
        backend: AssistantBackend,
        provider: Option<AssistantProviderId>,
        model_id: &str,
        endpoint: Option<&AssistantEndpointConfig>,
        secret: &[u8],
        payload: &[u8],
        consent: Option<&OutboundConsent>,
        cancel: CancellationToken,
    ) -> Result<AiTaskResult, String>;
}

#[derive(Default)]
pub struct InferenceRuntime {
    pub host: Option<Arc<dyn InferenceHost>>,
}

impl InferenceRuntime {
    pub fn new(host: Option<Arc<dyn InferenceHost>>) -> Self {
        Self { host }
    }

    fn host(&self) -> Option<Arc<dyn InferenceHost>> {
        self.host.clone()
    }
}

struct InferenceSelection {
    backend: AssistantBackend,
    provider: Option<AssistantProviderId>,
    model_id: String,
    consent_required: bool,
    local_server: bool,
    endpoint: Option<AssistantEndpointConfig>,
}

fn select_inference(
    settings: &AssistantSettings,
    endpoint: Option<&AssistantEndpointConfig>,
) -> Result<InferenceSelection, String> {
    settings
        .validate()
        .map_err(|_| "assistant.invalid".to_string())?;
    match settings.backend {
        AssistantBackend::Local => match settings.local_source {
            AssistantLocalSource::Bundled => Ok(InferenceSelection {
                backend: AssistantBackend::Local,
                provider: None,
                model_id: "qwen3.5-4b".to_string(),
                consent_required: false,
                local_server: false,
                endpoint: None,
            }),
            AssistantLocalSource::UserServer => Ok(InferenceSelection {
                backend: AssistantBackend::Local,
                provider: None,
                model_id: "user-server".to_string(),
                consent_required: true,
                local_server: true,
                endpoint: None,
            }),
        },
        AssistantBackend::Api => match settings.provider_id {
            AssistantProviderId::Meta => Ok(InferenceSelection {
                backend: AssistantBackend::Api,
                provider: Some(AssistantProviderId::Meta),
                model_id: settings.api_model_id.clone(),
                consent_required: true,
                local_server: false,
                endpoint: None,
            }),
            AssistantProviderId::CustomCompatible => {
                let config =
                    endpoint.ok_or_else(|| "assistant.provider_invalid".to_string())?;
                if settings.custom_endpoint_id != Some(config.id) {
                    return Err("assistant.provider_invalid".to_string());
                }
                Ok(InferenceSelection {
                    backend: AssistantBackend::Api,
                    provider: Some(AssistantProviderId::CustomCompatible),
                    model_id: config.model_id.clone(),
                    consent_required: true,
                    local_server: false,
                    endpoint: Some(config.clone()),
                })
            }
        },
    }
}

fn validate_inference_request(request: &AiTaskRequest) -> Result<(), String> {
    let value =
        serde_json::to_value(request).map_err(|_| "assistant.invalid".to_string())?;
    let options = value
        .get("options")
        .ok_or_else(|| "assistant.invalid".to_string())?;
    validate_options_keys(options, request.task).map_err(|_| "assistant.invalid".to_string())?;
    validate_request_shape(request).map_err(|_| "assistant.invalid".to_string())?;
    if !matches!(
        request.task,
        AiTaskKind::StructuredText | AiTaskKind::VisionAnswer
    ) {
        return Err("assistant.provider_unsupported".to_string());
    }
    Ok(())
}

fn validate_capabilities(
    selection: &InferenceSelection,
    request: &AiTaskRequest,
) -> Result<(), String> {
    let Some(config) = selection.endpoint.as_ref() else {
        return Ok(());
    };
    if !config.schema_supported {
        return Err("assistant.provider_unsupported".to_string());
    }
    if request.task == AiTaskKind::VisionAnswer && !config.vision_supported {
        return Err("assistant.provider_unsupported".to_string());
    }
    Ok(())
}

fn source_revisions(request: &AiTaskRequest) -> Vec<SourceRevision> {
    request
        .inputs
        .iter()
        .map(|input| SourceRevision {
            input_id: input.id,
            revision: input.expected_revision,
        })
        .collect()
}

fn validate_sources(
    sources: &[AssistantOutboundSource],
    request: &AiTaskRequest,
) -> Result<(), String> {
    if sources.len() > 128
        || sources.iter().any(|source| {
            source.excerpt.len() > 8_192
                || source.label.chars().count() > 32_768
                || source.mime.is_empty()
                || source.mime.len() > 128
                || !request.inputs.iter().any(|input| {
                    input.id == source.input_id && input.expected_revision == source.revision
                })
        })
    {
        return Err("assistant.invalid".to_string());
    }
    Ok(())
}

fn validate_inference_result(
    result: &AiTaskResult,
    request: &AiTaskRequest,
) -> Result<(), String> {
    if result.job_id != request.request_id
        || result.task != request.task
        || !ascii_bounded(&result.model_id, 96)
        || !ascii_bounded(&result.model_revision, 64)
        || result.citations.len() > 256
        || result.warnings.len() > 32
    {
        return Err("assistant.api_response".to_string());
    }
    match (result.task, &result.result) {
        (AiTaskKind::StructuredText, AiResultPayload::Structured { .. }) => {
            validate_result_shape(result).map_err(|_| "assistant.api_response".to_string())
        }
        (AiTaskKind::VisionAnswer, AiResultPayload::Structured { canonical_json, .. }) => {
            // `validate_result_shape` has no vision_answer arm yet; the host
            // must still return the registered structured schema.
            if canonical_json.len() > 262_144 {
                return Err("assistant.api_response".to_string());
            }
            Ok(())
        }
        _ => Err("assistant.api_response".to_string()),
    }
}

#[tauri::command]
pub fn assistant_inference_prepare(
    window: WebviewWindow,
    outbound: State<'_, OutboundRegistry>,
    service: State<'_, AssistantService>,
    provider: State<'_, ProviderConfig>,
    runtime: State<'_, InferenceRuntime>,
    request: AiTaskRequest,
) -> Result<AssistantOutboundPreview, String> {
    ensure_main(window.label())?;
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    valid_request_id(&request.request_id).map_err(|_| "assistant.invalid".to_string())?;
    validate_inference_request(&request)?;
    let endpoint = provider.endpoint_snapshot()?;
    let selection = select_inference(&settings, endpoint.as_ref())?;
    validate_capabilities(&selection, &request)?;
    let host = runtime
        .host()
        .ok_or_else(|| "assistant.failed".to_string())?;
    let sources = if selection.consent_required {
        let sources = host.preview_sources(&request)?;
        validate_sources(&sources, &request)?;
        sources
    } else {
        Vec::new()
    };
    let payload = host.build_payload(&request, &sources)?;
    if payload.len() > MAX_INFERENCE_PAYLOAD_BYTES {
        return Err("assistant.invalid".to_string());
    }
    let preview = AssistantOutboundPreview {
        preview_id: Uuid::new_v4(),
        backend: selection.backend,
        provider_id: selection.provider,
        model_id: selection.model_id,
        payload_sha256: None,
        sources,
        byte_len: 0,
        requires_consent: selection.consent_required,
        expires_unix: 0,
        includes_chat_history: false,
        local_server: selection.local_server,
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    outbound.prepare(preview, &payload, source_revisions(&request), now)
}

#[tauri::command]
pub fn assistant_outbound_confirm(
    window: WebviewWindow,
    outbound: State<'_, OutboundRegistry>,
    approval: State<'_, OutboundApprovalState>,
    preview_id: String,
) -> Result<serde_json::Value, String> {
    ensure_main(window.label())?;
    let preview_id =
        Uuid::parse_str(&preview_id).map_err(|_| "assistant.invalid".to_string())?;
    let preview = outbound.preview(preview_id)?;
    if !preview.requires_consent {
        return Err("assistant.outbound_required".to_string());
    }
    let approval = approval
        .0
        .as_ref()
        .ok_or_else(|| "assistant.confirmation_required".to_string())?;
    let approved = approval.approve(&preview)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let consent = outbound.confirm(preview_id, approved, 0, now)?;
    Ok(serde_json::json!({ "consent_id": consent.id }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn assistant_inference_start(
    window: WebviewWindow,
    app: AppHandle,
    _outbound: State<'_, OutboundRegistry>,
    service: State<'_, AssistantService>,
    provider: State<'_, ProviderConfig>,
    runtime: State<'_, InferenceRuntime>,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: AiTaskRequest,
    outbound_consent_id: Option<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "assistant.invalid".to_string())?;
    if request.request_id != request_id {
        return Err("assistant.invalid".to_string());
    }
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    validate_inference_request(&request)?;
    let endpoint = provider.endpoint_snapshot()?;
    let selection = select_inference(&settings, endpoint.as_ref())?;
    validate_capabilities(&selection, &request)?;
    let revisions = source_revisions(&request);
    let consent_id = outbound_consent_id
        .map(|id| Uuid::parse_str(&id).map_err(|_| "assistant.invalid".to_string()))
        .transpose()?;
    if selection.consent_required && consent_id.is_none() {
        return Err("assistant.outbound_required".to_string());
    }
    let host = runtime.host().ok_or_else(|| {
        if selection.backend == AssistantBackend::Api {
            "assistant.api_unavailable".to_string()
        } else {
            "assistant.failed".to_string()
        }
    })?;
    let token = jobs.begin(&request_id, 1)?;
    let endpoint_for_job = selection.endpoint;
    let model_id = selection.model_id;
    let provider_id = selection.provider;
    let backend = selection.backend;
    let consent_required = selection.consent_required;
    spawn_job(app, request_id, token, move |context| {
        let sources = if consent_required {
            let sources = host.preview_sources(&request)?;
            validate_sources(&sources, &request)?;
            sources
        } else {
            Vec::new()
        };
        // Rebuild the exact bytes on the job thread so a changed source or
        // template changes the hash before the consent is consumed.
        let payload = host.build_payload(&request, &sources)?;
        if payload.len() > MAX_INFERENCE_PAYLOAD_BYTES {
            return Err("assistant.invalid".to_string());
        }
        let payload_sha256 = sha256_hex(&payload);
        let registry = context.app().state::<OutboundRegistry>();
        let consent = if consent_required {
            let id = consent_id.ok_or_else(|| "assistant.outbound_required".to_string())?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            Some(registry.take_for_send(
                id,
                provider_id,
                &model_id,
                &payload_sha256,
                &revisions,
                0,
                now,
            )?)
        } else {
            None
        };
        // The key is decrypted only after the consent was consumed and is
        // wiped immediately after the single adapter call.
        let mut secret = match provider_id {
            Some(provider_id) => context
                .app()
                .state::<CredentialStore>()
                .secret(provider_id)?,
            None => Vec::new(),
        };
        if provider_id.is_some() && secret.is_empty() {
            return Err("assistant.api_auth".to_string());
        }
        let result = host.infer(
            &request,
            backend,
            provider_id,
            &model_id,
            endpoint_for_job.as_ref(),
            &secret,
            &payload,
            consent.as_ref(),
            context.token().clone(),
        );
        secret.fill(0);
        let result = result?;
        validate_inference_result(&result, &request)?;
        serde_json::to_value(result).map_err(|_| "assistant.failed".to_string())
    });
    Ok(())
}
