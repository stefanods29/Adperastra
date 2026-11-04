//! Fixed runtime limits (T3, D6-D8).
#![allow(dead_code)]


use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

pub const MIB: u64 = 1_048_576;
pub const GIB: u64 = 1_073_741_824;

pub const CROP_TIMEOUT: Duration = Duration::from_secs(30);
pub const FULL_IMAGE_TIMEOUT: Duration = Duration::from_secs(600);
pub const BATCH_FILE_TIMEOUT: Duration = Duration::from_secs(600);
pub const TEXT_FIRST_TOKEN_TIMEOUT: Duration = Duration::from_secs(10);
pub const TEXT_TOTAL_TIMEOUT: Duration = Duration::from_secs(120);
pub const CANCEL_DESCENDANT_DEADLINE: Duration = Duration::from_secs(2);
pub const TERMINAL_JOB_DEADLINE: Duration = Duration::from_secs(5);
pub const IDLE_UNLOAD_DEFAULT_SECONDS: u32 = 120;
pub const ONE_ACTIVE_INFERENCE: usize = 1;
pub const MAX_QUEUED_INFERENCE: usize = 8;
pub const MAX_BATCH_FILES: usize = 1_000;
pub const MAX_CONTEXT_TOKENS: u32 = 8_192;
pub const MAX_OUTPUT_TOKENS: u32 = 4_096;
pub const CPU_MEMORY_CEILING: u64 = 8 * GIB;
pub const GPU_MEMORY_CEILING: u64 = 4 * GIB;
pub const MIN_CPU_MEMORY: u64 = 512 * MIB;
pub const MIN_GPU_MEMORY: u64 = 256 * MIB;

struct GateState {
    active: bool,
    waiting: usize,
}

/// One inference at a time with a bounded wait queue (D7). The permit covers
/// a whole task, not one tile, so a second model never starts concurrently.
pub struct InferenceGate {
    state: Mutex<GateState>,
    ready: Condvar,
}

/// Held for the duration of one task; dropping it wakes the next waiter.
pub struct InferencePermit<'a> {
    gate: &'a InferenceGate,
}

impl Default for InferenceGate {
    fn default() -> Self {
        Self::new()
    }
}

impl InferenceGate {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(GateState {
                active: false,
                waiting: 0,
            }),
            ready: Condvar::new(),
        }
    }

    /// Wait for the single inference slot. A cancelled task leaves the queue;
    /// more than eight waiters is refused instead of growing without bound.
    pub fn acquire(&self, cancel: &AtomicBool) -> Result<InferencePermit<'_>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "ai-inference lock poisoned".to_string())?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("ai.cancelled".into());
            }
            if !state.active {
                state.active = true;
                return Ok(InferencePermit { gate: self });
            }
            if state.waiting >= MAX_QUEUED_INFERENCE {
                return Err("ai.memory_limit".into());
            }
            state.waiting += 1;
            let (next, _) = self
                .ready
                .wait_timeout(state, Duration::from_millis(100))
                .map_err(|_| "ai-inference lock poisoned".to_string())?;
            state = next;
            state.waiting = state.waiting.saturating_sub(1);
        }
    }
}

impl Drop for InferencePermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.gate.state.lock() {
            state.active = false;
        }
        self.gate.ready.notify_one();
    }
}

/// min(8 GiB, floor(available RAM * 0.5)), with a 512 MiB floor.
pub fn cpu_memory_ceiling(available_ram_bytes: u64) -> u64 {
    let half = available_ram_bytes / 2;
    half.clamp(MIN_CPU_MEMORY, CPU_MEMORY_CEILING)
}

/// min(4 GiB, floor(dedicated VRAM * 0.7)), with a 256 MiB floor.
/// `None` means no usable VRAM fact; the caller must stay on the CPU.
pub fn gpu_memory_budget(dedicated_vram_bytes: Option<u64>) -> Option<u64> {
    dedicated_vram_bytes.map(|vram| {
        let budget = vram.saturating_mul(7) / 10;
        budget.clamp(MIN_GPU_MEMORY, GPU_MEMORY_CEILING)
    })
}

/// max(1, min(4, logical cores - 2)).
pub fn cpu_threads(logical_cores: u16) -> u16 {
    logical_cores.saturating_sub(2).clamp(1, 4)
}

/// Settings memory is clipped to what this machine can actually offer.
pub fn effective_memory_limit_mb(requested_mb: u32, available_ram_bytes: u64) -> u32 {
    let requested = u64::from(requested_mb)
        .saturating_mul(MIB)
        .clamp(512 * MIB, 8 * GIB);
    let ceiling = cpu_memory_ceiling(available_ram_bytes);
    (requested.min(ceiling) / MIB) as u32
}

pub fn bounded_batch(requested: usize) -> usize {
    requested.min(MAX_BATCH_FILES)
}

/// 120 s by default; settings clamp to 30..=600.
pub fn unload_due(last_used: std::time::Instant, now: std::time::Instant, idle_seconds: u32) -> bool {
    let idle = idle_seconds.clamp(30, 600);
    now.saturating_duration_since(last_used) >= Duration::from_secs(u64::from(idle))
}

/// One terminal state per cancel: cooperative first, then tree termination.
pub enum CancelAction {
    Checkpoint,
    TerminateTree,
    EscalateFailure,
}

pub fn cancel_step(elapsed: Duration, cooperative_ack: bool) -> CancelAction {
    if cooperative_ack {
        return CancelAction::Checkpoint;
    }
    if elapsed >= CANCEL_DESCENDANT_DEADLINE {
        return CancelAction::TerminateTree;
    }
    CancelAction::Checkpoint
}

pub fn terminal_overdue(elapsed: Duration) -> bool {
    elapsed >= TERMINAL_JOB_DEADLINE
}
