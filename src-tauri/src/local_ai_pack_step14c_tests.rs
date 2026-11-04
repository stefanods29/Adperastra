//! Step 14c T1 pack-verification tests. Not executed by the coding worker.

use crate::local_ai_pack::{
    helper_launch_plan, resolve_pack, validate_operator, verify_received_artifact, VerifiedPack,
};

const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn pack() -> VerifiedPack {
    VerifiedPack {
        id: "ai_upscale".into(),
        version: "1.0.0".into(),
        capability: "ai.upscale".into(),
        helper_sha256: HASH_A.into(),
        binary_verified: true,
    }
}

#[test]
fn upstream_metadata_is_not_binary_verification() {
    assert_eq!(
        verify_received_artifact(HASH_A, HASH_A, true),
        Err("ai.unverified".to_string())
    );
    assert_eq!(
        verify_received_artifact(HASH_A, HASH_B, false),
        Err("ai.unverified".to_string())
    );
    assert!(verify_received_artifact(HASH_A, HASH_A, false).is_ok());
}

#[test]
fn modified_helper_hash_refused() {
    let pack = pack();
    assert_eq!(
        helper_launch_plan(&pack, HASH_B).err(),
        Some("ai.unverified".to_string())
    );
    let plan = helper_launch_plan(&pack, HASH_A).expect("launch plan");
    assert_eq!(plan.entrypoint, "runtime.onnx");
}

#[test]
fn unknown_model_operator_refused() {
    assert_eq!(
        validate_operator("custom_operator").err(),
        Some("ai.unsupported".to_string())
    );
    assert!(validate_operator("onnx_tensor").is_ok());
}

#[test]
fn missing_pack_no_network() {
    let error = resolve_pack(None, "ai_upscale", "ai.upscale").expect_err("missing");
    assert_eq!(error.code, "ai.pack_missing");
    assert!(!error.network_attempted);
    let unverified = VerifiedPack {
        binary_verified: false,
        ..pack()
    };
    let error = resolve_pack(Some(&unverified), "ai_upscale", "ai.upscale").expect_err("unverified");
    assert_eq!(error.code, "ai.unverified");
    assert!(!error.network_attempted);
    assert!(resolve_pack(Some(&pack()), "ai_upscale", "ai.upscale").is_ok());
}
