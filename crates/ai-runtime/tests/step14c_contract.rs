//! Step 14c T2 contract tests (not executed by the coding worker).

use ai_runtime::artifacts::{AiArtifacts, InputLeases, InputRecord};
use ai_runtime::schema;
use ai_runtime::types::*;
use ai_runtime::types_ui::{AiArtifactKind, LocalAiSettings};
use ai_runtime::validation::{validate_embeddings, validate_request_shape};
use uuid::Uuid;

fn base_request(options: AiTaskOptions) -> AiTaskRequest {
    AiTaskRequest {
        request_id: "ai-test-1".into(),
        task: AiTaskKind::Upscale,
        locale: AiLocale::En,
        inputs: vec![AiInputRef {
            kind: AiInputKind::Document,
            id: Uuid::new_v4(),
            expected_revision: 1,
        }],
        prompt: None,
        options,
    }
}

#[test]
fn options_task_mismatch_refused() {
    let request = base_request(AiTaskOptions::StructuredText {
        max_output_tokens: 1024,
        temperature: 0.0,
        seed: 0,
    });
    assert_eq!(
        validate_request_shape(&request),
        Err("ai.bad_request".to_string())
    );
}

#[test]
fn output262145bytes_refused() {
    let payload = format!("{{\"x\":\"{}\"}}", "a".repeat(262_137));
    assert_eq!(payload.len(), 262_145);
    assert_eq!(
        schema::validate_canonical("assistant.answer.v1", &payload),
        Err("ai.schema_invalid".to_string())
    );
    assert!(schema::validate_canonical("assistant.answer.v1", "{\"x\":\"a\"}").is_ok());
}

#[test]
fn foreign_profile_artifact_refused() {
    let artifacts = AiArtifacts::new();
    let owner = Uuid::new_v4();
    let foreign = Uuid::new_v4();
    let info = artifacts
        .publish(owner, AiArtifactKind::Image, vec![1, 2, 3], false, 1_000)
        .expect("publish");
    assert_eq!(
        artifacts
            .resolve_at(info.id, AiArtifactKind::Image, foreign, 1_001)
            .err(),
        Some("ai.bad_request".to_string())
    );
    assert!(artifacts
        .resolve_at(info.id, AiArtifactKind::Image, owner, 1_001)
        .is_ok());
}

#[test]
fn expected_revision2_input1_source_changed() {
    let inputs = InputLeases::new();
    let profile = Uuid::new_v4();
    let id = Uuid::new_v4();
    inputs
        .register(InputRecord {
            kind: AiInputKind::Snapshot,
            id,
            content_id: Uuid::new_v4(),
            revision: 1,
            profile,
        })
        .expect("register");
    assert_eq!(
        inputs.resolve(id, 2, profile).err(),
        Some("ai.source_changed".to_string())
    );
    assert_eq!(
        inputs.resolve(id, 1, profile).expect("revision").revision(),
        1
    );
}

#[test]
fn released_input_live_job_retains_then_drops() {
    let inputs = InputLeases::new();
    let profile = Uuid::new_v4();
    let id = Uuid::new_v4();
    inputs
        .register(InputRecord {
            kind: AiInputKind::Document,
            id,
            content_id: Uuid::new_v4(),
            revision: 1,
            profile,
        })
        .expect("register");
    let lease = inputs.resolve(id, 1, profile).expect("lease");
    assert_eq!(inputs.live_count(), 1);
    inputs.release(id).expect("release");
    assert_eq!(inputs.live_count(), 1);
    assert_eq!(lease.record().id, id);
    drop(lease);
    assert_eq!(inputs.live_count(), 0);
    assert_eq!(
        inputs.resolve(id, 1, profile).err(),
        Some("ai.expired".to_string())
    );
}

#[test]
fn embeddings_nan_rejected() {
    let rows = 1u32;
    let dimensions = 384u16;
    let mut bytes = vec![0u8; rows as usize * dimensions as usize * 4];
    for chunk in bytes.as_chunks_mut::<4>().0 {
        chunk.copy_from_slice(&(1.0f32 / (dimensions as f32).sqrt()).to_le_bytes());
    }
    assert!(validate_embeddings(&bytes, rows, dimensions).is_ok());
    bytes[0..4].copy_from_slice(&f32::NAN.to_le_bytes());
    assert_eq!(
        validate_embeddings(&bytes, rows, dimensions),
        Err("ai.model_output".to_string())
    );
}

#[test]
fn settings_schema40_adds_every_task_off() {
    let settings = LocalAiSettings::default().normalized();
    assert!(!settings.enabled);
    assert_eq!(settings.device, AiDevice::Auto);
    assert_eq!(settings.tier, AiTier::Auto);
    assert_eq!(settings.idle_unload_seconds, 120);
    assert_eq!(settings.memory_limit_mb, 4096);
    for kind in AiTaskKind::ALL {
        assert_eq!(settings.tasks.get(&kind), Some(&false));
    }
}

#[test]
fn artifact_budget_and_release_keep_live_reader() {
    let artifacts = AiArtifacts::new();
    let profile = Uuid::new_v4();
    let info = artifacts
        .publish(profile, AiArtifactKind::Mask, vec![7; 32], true, 10)
        .expect("publish");
    let lease = artifacts
        .resolve_at(info.id, AiArtifactKind::Mask, profile, 11)
        .expect("lease");
    artifacts.release(info.id).expect("release");
    assert_eq!(lease.read(0, 4).expect("range"), &[7, 7, 7, 7]);
    assert_eq!(
        artifacts
            .resolve_at(info.id, AiArtifactKind::Mask, profile, 12)
            .err(),
        Some("ai.expired".to_string())
    );
    drop(lease);
    assert_eq!(artifacts.sensitive_bytes(), 0);
}
