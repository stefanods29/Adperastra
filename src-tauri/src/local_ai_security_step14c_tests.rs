//! Step 14c T3 security and lifecycle tests. Not executed by the coding worker.
//!
//! The two `#[ignore]` tests are deliberate evidence gates: the coordinator
//! runs them against the real packaged helper with a retained canary root.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use ai_runtime::protocol::{decode_header, MAX_HEADER_BYTES};
use ai_runtime::types::AiDevice;
use ai_runtime::validation::{retry_after_gpu_start_failure, DeviceRetry};

use crate::local_ai_host::{
    header_within_limit, path_allowed, AiHost, ConfinedChildLauncher, ProtocolChild,
};
use crate::local_ai_limits::{
    cancel_step, unload_due, CancelAction, CANCEL_DESCENDANT_DEADLINE,
};

struct NoopLauncher;

impl ConfinedChildLauncher for NoopLauncher {
    fn spawn_protocol_child(
        &self,
        _helper: &Path,
        _args: &[OsString],
        _read_roots: &[PathBuf],
        _write_root: &Path,
        _memory_limit_bytes: u64,
        _cpu_rate_percent: u32,
    ) -> Result<Box<dyn ProtocolChild>, String> {
        Err("ai.sandbox_failed".into())
    }
}

#[test]
fn outside_handle_open_denied() {
    let root = tempfile::tempdir().expect("temp root");
    let inside = root.path().join("model.bin");
    std::fs::write(&inside, b"model").expect("write");
    let outside_dir = tempfile::tempdir().expect("outside");
    let outside = outside_dir.path().join("secret.txt");
    std::fs::write(&outside, b"secret").expect("write");
    assert!(path_allowed(&[root.path().to_path_buf()], &inside));
    assert!(!path_allowed(&[root.path().to_path_buf()], &outside));
    let traversal = root.path().join("..").join("secret.txt");
    assert!(!path_allowed(&[root.path().to_path_buf()], &traversal));
}

#[test]
fn gpu_start_failure_cpu_retry_once() {
    assert_eq!(
        retry_after_gpu_start_failure(AiDevice::Auto, false),
        DeviceRetry::RetryCpu
    );
    assert_eq!(
        retry_after_gpu_start_failure(AiDevice::Auto, true),
        DeviceRetry::Fail
    );
}

#[test]
fn explicit_gpu_no_silent_cpu() {
    assert_eq!(
        retry_after_gpu_start_failure(AiDevice::Gpu, false),
        DeviceRetry::Fail
    );
    assert_eq!(
        retry_after_gpu_start_failure(AiDevice::Cpu, false),
        DeviceRetry::Fail
    );
}

#[test]
fn cancel_descendants_within2s() {
    assert_eq!(CANCEL_DESCENDANT_DEADLINE, Duration::from_secs(2));
    assert!(matches!(
        cancel_step(Duration::from_secs(2), false),
        CancelAction::TerminateTree
    ));
    assert!(matches!(
        cancel_step(Duration::from_millis(50), true),
        CancelAction::Checkpoint
    ));
}

#[test]
fn idle120s_unloads() {
    let now = Instant::now();
    assert!(!unload_due(now - Duration::from_secs(119), now, 120));
    assert!(unload_due(now - Duration::from_secs(120), now, 120));
    let host = AiHost::new(Arc::new(NoopLauncher));
    host.mark_loaded();
    assert!(host.is_loaded());
    assert!(host.unload_if_idle(Instant::now() + Duration::from_secs(121), 120));
    assert!(!host.is_loaded());
}

#[test]
fn header65537bytes_refused() {
    assert_eq!(MAX_HEADER_BYTES, 65_536);
    assert!(!header_within_limit(&vec![0u8; MAX_HEADER_BYTES + 1]));
    assert_eq!(
        decode_header(&vec![b'x'; MAX_HEADER_BYTES + 1]).err(),
        Some("ai.bad_request".to_string())
    );
}

#[test]
#[ignore = "coordinator runs the real network canary on the packaged helper"]
fn real_host_network_denied() {
    let root = std::env::var("ADPERASTRA_AI_CANARY")
        .expect("set ADPERASTRA_AI_CANARY to the retained canary root");
    let marker = Path::new(&root).join("network-denied.txt");
    assert!(
        marker.exists(),
        "the coordinator canary must record a denied outbound connection at {marker:?}"
    );
    let body = std::fs::read_to_string(&marker).expect("read canary record");
    assert!(body.contains("denied"));
}
