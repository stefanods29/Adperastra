use super::*;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use crate::assistant_credentials::{CredentialAcl, CredentialStore, SecretProtector};
use crate::assistant_dns::{pin_addresses, validate_resolved};
use crate::assistant_endpoint::{
    changed_origin, configure, execution_allowed, mark_probe, status, EndpointProbe,
};
use crate::assistant_local_server::{
    build_chat_url, external_redirect_denied, location_allowed, parse_loopback,
};
use crate::assistant_meta::build_chat_body;
use crate::assistant_outbound::{OutboundRegistry, SourceRevision};
use crate::assistant_provider::{
    local_bundled_uses_network, provider_switch_starts_new_chat, redirect_allowed, should_retry,
    validate_custom_endpoint, validate_meta_url,
};
use crate::assistant_sse::{cancel_body, BodyReader, SseParser};
use crate::assistant_types::{
    AssistantBackend, AssistantOutboundPreview, AssistantOutboundSource, AssistantProviderId,
    AssistantToolSpec,
};
use crate::local_ai_types::AiSourceLocation;

struct XorProtector;

impl SecretProtector for XorProtector {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plaintext.iter().map(|byte| byte ^ 0x5a).collect())
    }

    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.iter().map(|byte| byte ^ 0x5a).collect())
    }
}

struct RecordingAcl {
    paths: Mutex<Vec<PathBuf>>,
}

impl CredentialAcl for RecordingAcl {
    fn restrict_to_current_user(&self, path: &std::path::Path) -> Result<(), String> {
        self.paths.lock().unwrap().push(path.to_path_buf());
        Ok(())
    }
}

fn preview(_id: Uuid) -> AssistantOutboundPreview {
    AssistantOutboundPreview {
        preview_id: Uuid::new_v4(),
        backend: AssistantBackend::Api,
        provider_id: Some(AssistantProviderId::Meta),
        model_id: "muse-spark-1.3".to_string(),
        payload_sha256: None,
        sources: vec![AssistantOutboundSource {
            input_id: Uuid::new_v4(),
            revision: 1,
            label: "notes.txt".to_string(),
            location: AiSourceLocation::Text { start: 0, end: 4 },
            excerpt: "test".to_string(),
            mime: "text/plain".to_string(),
            byte_len: 4,
            image_preview_artifact_id: None,
        }],
        byte_len: 4,
        requires_consent: true,
        expires_unix: 0,
        includes_chat_history: false,
        local_server: false,
    }
}

fn revision(preview: &AssistantOutboundPreview) -> SourceRevision {
    SourceRevision {
        input_id: preview.sources[0].input_id,
        revision: 1,
    }
}

#[test]
fn key_never_settings_logs_history_exports() {
    let settings = serde_json::json!({ "assistant": { "backend": "api", "provider": "meta" } });
    assert!(!contains_secret(&settings, "sk-dummy-abcd"));
    let log = redact_for_log("Authorization: Bearer sk-dummy-abcd", "sk-dummy-abcd");
    assert!(!log.contains("sk-dummy-abcd"));
    assert!(log.contains("[redacted]"));
    assert!(!export_omits_credentials(
        "profiles/x/assistant/provider-meta.cred"
    ));
    assert!(export_omits_credentials("profiles/x/assistant/chats.json"));
}

#[test]
fn credential_status_last4_only() {
    let temp = tempfile::tempdir().unwrap();
    let acl = Arc::new(RecordingAcl {
        paths: Mutex::new(Vec::new()),
    });
    let store = CredentialStore::new(
        temp.path().to_path_buf(),
        Arc::new(XorProtector),
        Some(acl.clone() as Arc<dyn CredentialAcl>),
    )
    .unwrap();
    let status = store
        .edit(AssistantProviderId::Meta, b"sk-dummy-abcd")
        .unwrap();
    assert!(status.has_key);
    assert_eq!(status.masked_hint, "abcd");
    let json = serde_json::to_string(&status).unwrap();
    assert!(!json.contains("sk-dummy-abcd"));
    assert_eq!(acl.paths.lock().unwrap().len(), 1);
    let file = store.status(AssistantProviderId::Meta).unwrap();
    assert_eq!(file.masked_hint, "abcd");
    let expected = temp.path().join("assistant").join("provider-meta.cred");
    assert!(expected.is_file());
    assert!(store.belongs_to(AssistantProviderId::Meta, &expected));
    assert!(!store.belongs_to(AssistantProviderId::CustomCompatible, &expected));
    assert!(!temp.path().join("profiles").exists());
}

#[test]
fn credential_store_uuid_profile_uses_resolved_root() {
    let temp = tempfile::tempdir().unwrap();
    let profile = temp
        .path()
        .join("profiles")
        .join(Uuid::new_v4().to_string());
    let acl = Arc::new(RecordingAcl {
        paths: Mutex::new(Vec::new()),
    });
    let store = CredentialStore::new(
        profile.clone(),
        Arc::new(XorProtector),
        Some(acl.clone() as Arc<dyn CredentialAcl>),
    )
    .unwrap();
    store
        .edit(AssistantProviderId::Meta, b"sk-dummy-abcd")
        .unwrap();
    let expected = profile.join("assistant").join("provider-meta.cred");
    assert!(expected.is_file());
    assert_eq!(acl.paths.lock().unwrap()[0], expected);
    assert!(store.belongs_to(AssistantProviderId::Meta, &expected));
    assert!(!store.belongs_to(AssistantProviderId::CustomCompatible, &expected));
    assert!(!temp.path().join("assistant").exists());
}

#[test]
fn credential_store_refuses_unconfined_profile_root() {
    assert!(CredentialStore::new(
        PathBuf::from("relative-profile"),
        Arc::new(XorProtector),
        None,
    )
    .is_err());
    let temp = tempfile::tempdir().unwrap();
    assert!(CredentialStore::new(
        temp.path().join("profiles").join("..").join("escape"),
        Arc::new(XorProtector),
        None,
    )
    .is_err());
}

#[test]
fn no_consent_zero_network() {
    let registry = OutboundRegistry::default();
    let result = registry.confirm(Uuid::new_v4(), true, 1, 100);
    assert_eq!(result.unwrap_err(), "assistant.outbound_required");
    assert!(registry.payload(Uuid::new_v4()).is_err());
}

#[test]
fn local_zero_network() {
    assert!(!local_bundled_uses_network());
    assert!(!local_server_requires_consent(false));
}

#[test]
fn meta401_auth_no_retry() {
    assert_eq!(error_for_status(401), "assistant.api_auth");
    assert!(!should_retry(Some(401)));
}

#[test]
fn meta429_rate_no_retry() {
    assert_eq!(error_for_status(429), "assistant.api_rate_limit");
    assert!(!should_retry(Some(429)));
}

#[test]
fn redirect_external_denied() {
    assert!(!redirect_allowed(302));
    assert!(validate_meta_url("https://api.meta.ai/v1").is_ok());
    assert!(validate_meta_url("https://example.com/v1").is_err());
    assert!(validate_meta_url("http://api.meta.ai/v1").is_err());
}

#[test]
fn sse_65537_byte_event_refused() {
    let mut parser = SseParser::new();
    let payload = "a".repeat(65_537);
    assert_eq!(
        parser
            .push(format!("data: {payload}\n\n").as_bytes())
            .unwrap_err(),
        "assistant.api_response"
    );
}

#[test]
fn stale_consent_source_changed_no_send() {
    let registry = OutboundRegistry::default();
    let preview = preview(Uuid::new_v4());
    let prepared = registry
        .prepare(preview.clone(), b"body", vec![revision(&preview)], 100)
        .unwrap();
    let consent = registry.confirm(prepared.preview_id, true, 1, 100).unwrap();
    let changed = vec![SourceRevision {
        input_id: revision(&preview).input_id,
        revision: 2,
    }];
    assert_eq!(
        registry
            .take_for_send(
                consent.id,
                Some(AssistantProviderId::Meta),
                "muse-spark-1.3",
                &consent.payload_sha256,
                &changed,
                1,
                101,
            )
            .unwrap_err(),
        "assistant.changed"
    );
}

#[test]
fn consent_replay_no_send() {
    let registry = OutboundRegistry::default();
    let preview = preview(Uuid::new_v4());
    let prepared = registry
        .prepare(preview.clone(), b"body", vec![revision(&preview)], 100)
        .unwrap();
    let consent = registry.confirm(prepared.preview_id, true, 1, 100).unwrap();
    assert!(registry
        .take_for_send(
            consent.id,
            Some(AssistantProviderId::Meta),
            "muse-spark-1.3",
            &consent.payload_sha256,
            &[revision(&preview)],
            1,
            101,
        )
        .is_ok());
    assert_eq!(
        registry
            .take_for_send(
                consent.id,
                Some(AssistantProviderId::Meta),
                "muse-spark-1.3",
                &consent.payload_sha256,
                &[revision(&preview)],
                1,
                101,
            )
            .unwrap_err(),
        "assistant.outbound_required"
    );
}

#[test]
fn sensitive_api_refused() {
    let source = crate::assistant_sources::ExtractedSource {
        input_id: Uuid::new_v4(),
        revision: 1,
        label: "locked".to_string(),
        mime: "text/plain".to_string(),
        kind: crate::assistant_sources::SourceKind::Text,
        source_identity: "s".to_string(),
        byte_len: 1,
        text: "x".to_string(),
        chunks: Vec::new(),
        sensitive: true,
        injection_warning: false,
    };
    assert_eq!(
        crate::assistant_sources::require_api_eligible(&[source]).unwrap_err(),
        "assistant.sensitive_api"
    );
}

#[test]
fn provider_switch_no_history_upload() {
    let (changed, messages) = provider_switch_starts_new_chat(
        AssistantProviderId::Meta,
        AssistantProviderId::CustomCompatible,
        12,
    );
    assert!(changed);
    assert_eq!(messages, 0);
}

#[test]
fn loopback_server_external_redirect_denied() {
    let endpoint = parse_loopback("http://127.0.0.1:11434/v1").unwrap();
    assert!(location_allowed(
        &endpoint,
        "http://127.0.0.1:11434/v1/models"
    ));
    assert!(external_redirect_denied(&endpoint, "https://example.com/v1").is_err());
    assert!(build_chat_url(&endpoint).ends_with("/v1/chat/completions"));
    assert!(parse_loopback("http://10.0.0.2:11434/v1").is_err());
}

struct FakeBody {
    closed: Arc<Mutex<bool>>,
}

impl BodyReader for FakeBody {
    fn close(&mut self) -> Result<(), String> {
        *self.closed.lock().unwrap() = true;
        Ok(())
    }
}

#[test]
fn cancel_closes_body() {
    let closed = Arc::new(Mutex::new(false));
    let mut body = FakeBody {
        closed: closed.clone(),
    };
    cancel_body(&mut body).unwrap();
    assert!(*closed.lock().unwrap());
}

#[test]
fn custom_endpoint_http_denied() {
    assert!(validate_custom_endpoint("http://api.example.com/v1", "model").is_err());
    assert!(validate_custom_endpoint("https://api.example.com:444/v1", "model").is_err());
}

#[test]
fn private_or_mixed_dns_no_request() {
    let private: IpAddr = "10.0.0.1".parse().unwrap();
    let public: IpAddr = "8.8.8.8".parse().unwrap();
    assert!(validate_resolved(&[private]).is_err());
    assert!(validate_resolved(&[public, private]).is_err());
    assert!(pin_addresses(&[public]).is_ok());
}

#[test]
fn rebinding_public_then_private_no_key_disclosure() {
    let public: IpAddr = "8.8.8.8".parse().unwrap();
    let private: IpAddr = "192.168.1.5".parse().unwrap();
    assert!(crate::assistant_dns::rebinding_refused(&[public], &[private]).is_err());
    assert!(crate::assistant_dns::rebinding_refused(&[public], &[public]).is_ok());
}

#[test]
fn tls_invalid_refused() {
    assert!(validate_custom_endpoint("https://api.example.com/v1", "model").is_ok());
    assert!(validate_custom_endpoint("https://api.example.com/v1", "").is_err());
    assert!(validate_custom_endpoint("https://api.example.com/v1", "bad model").is_err());
}

#[test]
fn redirect_does_not_forward_key() {
    assert!(!redirect_allowed(301));
    let endpoint = parse_loopback("http://[::1]:11434/v1").unwrap();
    assert!(external_redirect_denied(&endpoint, "http://[::1]:11434/v1/chat").is_ok());
    assert!(external_redirect_denied(&endpoint, "http://127.0.0.1:11434/v1/chat").is_err());
}

#[test]
fn changed_endpoint_clears_association_and_consent() {
    let old = configure("https://api.example.com/v1", "model-a", None).unwrap();
    let new = configure("https://api.example.com/v1", "model-b", Some(&old)).unwrap();
    assert!(changed_origin(Some(&old), &new));
    assert!(new.generation > old.generation);
    let registry = OutboundRegistry::default();
    registry.invalidate_all().unwrap();
    assert!(registry.preview(Uuid::new_v4()).is_err());
}

#[test]
fn no_schema_support_no_execution() {
    let config = configure("https://api.example.com/v1", "model", None).unwrap();
    assert!(!execution_allowed(&config, true));
    let mut tested = config.clone();
    mark_probe(&mut tested, EndpointProbe::Structured, true, 100);
    assert!(execution_allowed(&tested, true));
    assert!(status(Some(&tested)).configured);
}

#[test]
fn custom_test_requires_explicit_click() {
    let config = configure("https://api.example.com/v1", "model", None).unwrap();
    assert_eq!(config.tested_unix, None);
    assert!(!config.schema_supported);
    assert_eq!(config.generation, 1);
}

#[test]
#[allow(clippy::field_reassign_with_default)]
fn custom_request_caps_equal_meta() {
    let mut budget = ResponseBudget::default();
    budget.max_completion_tokens = 4_097;
    assert!(validate_budget(&budget).is_err());
    budget.max_completion_tokens = 4_096;
    assert!(validate_budget(&budget).is_ok());
    let tools: Vec<AssistantToolSpec> = Vec::new();
    let prompt = crate::assistant_meta::GatewayPrompt {
        system_text: "system",
        user_text: "user",
        sources_block: "",
        history: &[],
        tools: &tools,
        max_completion_tokens: 4_096,
    };
    let body = build_chat_body(&prompt, &mut budget).unwrap();
    assert!(body.len() <= MAX_REQUEST_BYTES);
    assert!(serde_json::from_slice::<serde_json::Value>(&body).is_ok());
}

#[test]
fn zero_automatic_paid_retry() {
    assert!(!should_retry(None));
    assert!(!should_retry(Some(500)));
    assert!(!should_retry(Some(429)));
}
