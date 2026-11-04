//! Pack and helper verification for the local AI runtime (T1).
//!
//! These functions are pure so the coordinator can prove that source metadata
//! is not a binary verification, a modified helper is never launched, an
//! unknown operator is refused, and a missing pack never starts a download.
//! The real catalog, hashes, signature and canaries stay coordinator evidence.
#![allow(dead_code)]


/// Pack ids reserved by D3. Only `ai.upscale` is activated in Step 14c.
pub const RESERVED_AI_PACKS: [&str; 10] = [
    "ai_runtime",
    "ai_upscale",
    "ai_assistant_small",
    "ai_assistant",
    "ai_assistant_pro",
    "ai_embeddings_text",
    "ai_embeddings_vision",
    "ai_speech",
    "ai_foreground",
    "ai_inpaint",
];

/// Fixed entrypoints. A caller never chooses an executable or a path.
pub const AI_ENTRYPOINTS: [&str; 3] = ["runtime.llama", "runtime.onnx", "runtime.whisper"];

/// Fixed model capabilities.
pub const AI_CAPABILITIES: [&str; 9] = [
    "ai.upscale",
    "ai.structured_text",
    "ai.vision_answer",
    "ai.embed_text",
    "ai.embed_image",
    "ai.embed_siglip_text",
    "ai.transcribe",
    "ai.foreground_mask",
    "ai.inpaint",
];

/// Exactly the helper operations compiled into this build.
pub const AI_UPSTREAM_OPERATORS: [&str; 4] = [
    "llama_text",
    "llama_vision",
    "onnx_tensor",
    "whisper_speech",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedPack {
    pub id: String,
    pub version: String,
    pub capability: String,
    pub helper_sha256: String,
    /// Every file was independently hashed after receipt.
    pub binary_verified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackResolutionError {
    pub code: &'static str,
    pub network_attempted: bool,
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Upstream LFS metadata identifies an object; it is not proof of the bytes
/// that arrived. Only an independently computed hash of a received file counts.
pub fn verify_received_artifact(
    expected_sha256: &str,
    actual_sha256: &str,
    source_metadata_only: bool,
) -> Result<(), String> {
    if source_metadata_only || !is_sha256(expected_sha256) || !is_sha256(actual_sha256) {
        return Err("ai.unverified".into());
    }
    if expected_sha256 != actual_sha256 {
        return Err("ai.unverified".into());
    }
    Ok(())
}

/// A helper is launched only when its received bytes match the signed catalog.
pub fn verify_helper_hash(expected_sha256: &str, actual_sha256: &str) -> Result<(), String> {
    verify_received_artifact(expected_sha256, actual_sha256, false)
}

/// Only compiled upstream operators are accepted; no dynamic/custom operator.
pub fn validate_operator(operator: &str) -> Result<(), String> {
    if AI_UPSTREAM_OPERATORS.contains(&operator) {
        Ok(())
    } else {
        Err("ai.unsupported".into())
    }
}

/// Resolve a verified installed pack. This function has no network capability:
/// every failure reports `network_attempted = false`.
pub fn resolve_pack<'a>(
    installed: Option<&'a VerifiedPack>,
    requested_id: &str,
    capability: &str,
) -> Result<&'a VerifiedPack, PackResolutionError> {
    let Some(pack) = installed else {
        return Err(PackResolutionError {
            code: "ai.pack_missing",
            network_attempted: false,
        });
    };
    if pack.id != requested_id || pack.capability != capability {
        return Err(PackResolutionError {
            code: "ai.pack_missing",
            network_attempted: false,
        });
    }
    if !pack.binary_verified {
        return Err(PackResolutionError {
            code: "ai.unverified",
            network_attempted: false,
        });
    }
    Ok(pack)
}

/// The fixed helper launch plan. A modified received helper is refused before
/// `CreateProcess`; there is no alternate executable chosen by a caller.
pub struct HelperLaunch {
    pub entrypoint: &'static str,
    pub expected_sha256: String,
}

pub fn helper_launch_plan(
    pack: &VerifiedPack,
    received_helper_sha256: &str,
) -> Result<HelperLaunch, String> {
    verify_helper_hash(&pack.helper_sha256, received_helper_sha256)?;
    Ok(HelperLaunch {
        entrypoint: "runtime.onnx",
        expected_sha256: pack.helper_sha256.clone(),
    })
}
