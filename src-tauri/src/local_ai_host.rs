//! Confined local AI helper lifecycle (T3, D2/D7/D8).
//!
//! The actual AppContainer/job-object launch is owned by 12b `EngineHost`.
//! This module proposes one additive method, `spawn_protocol_child`, so the AI
//! helper reuses that confinement instead of duplicating a weaker launcher.
//! Header bounds, framing, deadlines, idle unload and the one CPU retry stay
//! here.
#![allow(dead_code)]


use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use ai_runtime::protocol::{
    decode_frame, encode_frame, encode_header, validate_error_code, FrameKind, HelperHeader,
    OutputHasher, StreamBudget, MAX_HEADER_BYTES, MAX_OUTPUT_BYTES, MAX_PAYLOAD_CHUNK_BYTES,
};
use ai_runtime::types::{AiDevice, AiWarningCode};
use ai_runtime::validation::{retry_after_gpu_start_failure, DeviceRetry};

use crate::jobs::JobContext;
use crate::local_ai_limits::{
    cpu_threads, unload_due, CANCEL_DESCENDANT_DEADLINE, IDLE_UNLOAD_DEFAULT_SECONDS,
};

/// One already-confined child. Implemented by 12b `EngineHost`.
pub trait ProtocolChild: Send {
    /// One complete frame (`kind | length | payload`) or `None` when the wait
    /// expired. The pipe handle must be cancellable/overlapped; a blocking
    /// read that ignores the timeout is not a valid implementation.
    fn read_frame(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String>;
    fn write_stdin(&mut self, bytes: &[u8]) -> Result<(), String>;
    /// True when the process exited within the wait.
    fn wait_timeout(&mut self, timeout: Duration) -> Result<bool, String>;
    fn kill_tree(&mut self) -> Result<(), String>;
}

/// The coordinator supplies the 12b implementation. No caller-provided path
/// or executable reaches `CreateProcess`.
pub trait ConfinedChildLauncher: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn spawn_protocol_child(
        &self,
        helper: &Path,
        args: &[OsString],
        read_roots: &[PathBuf],
        write_root: &Path,
        memory_limit_bytes: u64,
        cpu_rate_percent: u32,
    ) -> Result<Box<dyn ProtocolChild>, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Metadata only; image bytes go to an owned output sink, never this JSON.
pub struct HelperResult {
    pub model_id: String,
    pub model_revision: String,
    pub output_width: u32,
    pub output_height: u32,
    pub output_sha256: String,
    pub warnings: Vec<AiWarningCode>,
    /// Set by the parent when Automatic retried once on the CPU.
    #[serde(skip)]
    pub cpu_fallback: bool,
}

pub struct AiHost {
    launcher: Arc<dyn ConfinedChildLauncher>,
    last_used: Mutex<Option<Instant>>,
    loaded: AtomicBool,
    model_epoch: AtomicU64,
    /// max(1, min(4, logical cores - 2)); passed to the helper.
    threads: u16,
}

impl AiHost {
    pub fn new(launcher: Arc<dyn ConfinedChildLauncher>) -> Self {
        let cores = crate::local_ai_hardware::query_hardware().logical_cores;
        Self {
            launcher,
            last_used: Mutex::new(None),
            loaded: AtomicBool::new(false),
            model_epoch: AtomicU64::new(0),
            threads: cpu_threads(cores),
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded.load(Ordering::Acquire)
    }

    pub fn epoch(&self) -> u64 {
        self.model_epoch.load(Ordering::Acquire)
    }

    /// Cooperative cancel first, then tree termination within 2 s.
    pub fn request_cancel(&self) {
        self.model_epoch.fetch_add(1, Ordering::AcqRel);
    }

    /// Unload when idle; returns true when a loaded model was dropped. A
    /// profile switch calls this with an idle of zero (immediate).
    pub fn unload_if_idle(&self, now: Instant, settings_idle_seconds: u32) -> bool {
        if !self.is_loaded() {
            return false;
        }
        let idle = settings_idle_seconds.clamp(30, 600);
        let due = match self.last_used.lock().ok().and_then(|last| *last) {
            Some(last) => unload_due(last, now, idle),
            None => true,
        };
        if due {
            self.loaded.store(false, Ordering::Release);
            self.model_epoch.fetch_add(1, Ordering::AcqRel);
        }
        due
    }

    pub fn mark_loaded(&self) {
        self.loaded.store(true, Ordering::Release);
        if let Ok(mut last) = self.last_used.lock() {
            *last = Some(Instant::now());
        }
    }

    pub fn unload_now(&self) {
        self.loaded.store(false, Ordering::Release);
        self.model_epoch.fetch_add(1, Ordering::AcqRel);
    }

    /// Run one task end to end. `input_bytes` is already decoded/encoded by
    /// the caller; output chunks stream to the owned sink.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        helper: &Path,
        model_root: &Path,
        job_root: &Path,
        header: &HelperHeader,
        input_bytes: &[u8],
        output: &mut dyn Write,
        context: &JobContext,
        device: AiDevice,
        memory_limit_bytes: u64,
        cpu_memory_limit_bytes: u64,
        timeout: Duration,
    ) -> Result<HelperResult, String> {
        let header_bytes = encode_header(header)?;
        let (mut child, cpu_fallback) = self.launch(
            helper,
            model_root,
            job_root,
            device,
            memory_limit_bytes,
            cpu_memory_limit_bytes,
        )?;
        child.write_stdin(&encode_frame(FrameKind::Header, &header_bytes)?)?;
        let mut budget = StreamBudget::new(header.input_bytes, MAX_OUTPUT_BYTES)?;
        for chunk in input_bytes.chunks(MAX_PAYLOAD_CHUNK_BYTES) {
            if context.token().load(Ordering::Relaxed) {
                return cancel_child(child.as_mut());
            }
            budget.add_input(chunk.len())?;
            child.write_stdin(&encode_frame(FrameKind::InputChunk, chunk)?)?;
        }
        let started = Instant::now();
        let mut hasher = OutputHasher::new();
        loop {
            if context.token().load(Ordering::Relaxed) {
                return cancel_child(child.as_mut());
            }
            if started.elapsed() >= timeout {
                let _ = child.kill_tree();
                return Err("ai.timeout".into());
            }
            let Some(frame) = child.read_frame(Duration::from_millis(100))? else {
                continue;
            };
            let (kind, payload) = decode_frame(&frame)?;
            match kind {
                FrameKind::OutputChunk => {
                    budget.add_output(payload.len())?;
                    hasher.update(payload);
                    output
                        .write_all(payload)
                        .map_err(|_| "ai.failed".to_string())?;
                }
                FrameKind::Progress => {
                    if let Ok(progress) = serde_json::from_slice::<fs_service::OpProgress>(payload) {
                        context.set_progress(&progress);
                    }
                }
                FrameKind::Result => {
                    if payload.len() > 65_536 {
                        return Err("ai.model_output".into());
                    }
                    let mut result: HelperResult = serde_json::from_slice(payload)
                        .map_err(|_| "ai.model_output".to_string())?;
                    result.cpu_fallback = cpu_fallback;
                    let digest = hasher.hex();
                    if result.model_id != header.model_id
                        || result.model_revision != header.model_revision
                        || result.output_width != header.output_width
                        || result.output_height != header.output_height
                        || !is_sha256(&result.output_sha256)
                        || result.output_sha256 != digest
                    {
                        return Err("ai.model_output".into());
                    }
                    let _ = child.kill_tree();
                    // The one-shot helper exits with its model; no model is
                    // retained between tiles in v1.
                    self.unload_now();
                    return Ok(result);
                }
                FrameKind::Error => {
                    let code = std::str::from_utf8(payload).map_err(|_| "ai.failed".to_string())?;
                    validate_error_code(code)?;
                    let _ = child.kill_tree();
                    return Err(code.to_string());
                }
                FrameKind::Heartbeat => {}
                FrameKind::Header | FrameKind::InputChunk | FrameKind::Cancel => {
                    let _ = child.kill_tree();
                    return Err("ai.failed".into());
                }
            }
        }
    }

    fn launch(
        &self,
        helper: &Path,
        model_root: &Path,
        job_root: &Path,
        device: AiDevice,
        memory_limit_bytes: u64,
        cpu_memory_limit_bytes: u64,
    ) -> Result<(Box<dyn ProtocolChild>, bool), String> {
        let read_roots = vec![
            helper.parent().unwrap_or(Path::new(".")).to_path_buf(),
            model_root.to_path_buf(),
        ];
        let model = model_root.join("runtime.onnx");
        let threads = self.threads.to_string();
        let args_for = |selected: AiDevice| {
            let value = match selected {
                AiDevice::Gpu | AiDevice::Auto => "gpu",
                AiDevice::Cpu => "cpu",
            };
            vec![
                OsString::from("--ai-host"),
                OsString::from("--protocol"),
                OsString::from("1"),
                OsString::from("--model"),
                model.as_os_str().to_os_string(),
                OsString::from("--device"),
                OsString::from(value),
                OsString::from("--threads"),
                OsString::from(threads.clone()),
            ]
        };
        let first = if device == AiDevice::Cpu {
            AiDevice::Cpu
        } else {
            AiDevice::Gpu
        };
        let spawn = |selected: AiDevice, memory: u64| {
            self.launcher.spawn_protocol_child(
                helper,
                &args_for(selected),
                &read_roots,
                job_root,
                memory,
                100,
            )
        };
        match spawn(first, memory_limit_bytes) {
            Ok(child) => Ok((child, false)),
            Err(error) => match retry_after_gpu_start_failure(device, false) {
                // A denied GPU sandbox or a GPU out-of-memory start leaves
                // Automatic on the CPU; an explicit GPU request never falls
                // back silently.
                DeviceRetry::RetryCpu
                    if error == "ai.memory_limit" || error == "ai.sandbox_failed" =>
                {
                    spawn(AiDevice::Cpu, cpu_memory_limit_bytes).map(|child| (child, true))
                }
                _ => Err(error),
            },
        }
    }
}

fn cancel_child(child: &mut dyn ProtocolChild) -> Result<HelperResult, String> {
    let _ = child.write_stdin(&encode_frame(FrameKind::Cancel, &[])?);
    let started = Instant::now();
    loop {
        if child.wait_timeout(Duration::from_millis(100))? {
            return Err("ai.cancelled".into());
        }
        if started.elapsed() >= CANCEL_DESCENDANT_DEADLINE {
            child.kill_tree()?;
            return Err("ai.cancelled".into());
        }
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The helper may only open paths below the verified pack root and the private
/// job root. Reparse points are resolved before comparison.
pub fn path_allowed(roots: &[PathBuf], candidate: &Path) -> bool {
    let Ok(candidate) = std::fs::canonicalize(candidate) else {
        return false;
    };
    roots.iter().any(|root| {
        std::fs::canonicalize(root).is_ok_and(|root| candidate.starts_with(root))
    })
}

pub fn header_within_limit(bytes: &[u8]) -> bool {
    bytes.len() <= MAX_HEADER_BYTES
}

pub const DEFAULT_IDLE_SECONDS: u32 = IDLE_UNLOAD_DEFAULT_SECONDS;
