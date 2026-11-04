//! Pause checkpoints and the CPU hard cap. Global pause takes effect at the
//! next bounded chunk boundary (at most 100 ms) through this gate; no
//! background parser is suspended behind its back.
#![allow(dead_code)]


use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use fs_service::CancellationToken;

use crate::background_policy::{validate_cpu_percent, CPU_PERCENT_MAX, CPU_PERCENT_MIN};

/// The largest time between two pause checkpoints.
pub const CHECKPOINT_MAX_MS: u64 = 100;
/// Cooperative work reads at most this much before checking again.
pub const CHUNK_BYTES: usize = 256 * 1024;

/// The one process-wide pause authority shared with Step 07a's policy.
#[derive(Debug, Default)]
pub struct PauseGate {
    paused: AtomicBool,
}

impl PauseGate {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pause all background work now. Active checkpoints see it at their next
    /// chunk boundary; foreground jobs only read the cancel token.
    pub fn pause_all(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

/// One checkpoint in a background loop. `foreground` work (an export the
/// user explicitly started) obeys Cancel but is never silently paused.
pub struct BackgroundCheckpoint {
    gate: Arc<PauseGate>,
    token: CancellationToken,
    foreground: bool,
}

impl BackgroundCheckpoint {
    pub fn new(gate: Arc<PauseGate>, token: CancellationToken, foreground: bool) -> Self {
        Self {
            gate,
            token,
            foreground,
        }
    }

    pub fn check(&self) -> Result<(), String> {
        if self.token.load(Ordering::Relaxed) {
            return Err("background.cancelled".to_string());
        }
        if !self.foreground && self.gate.is_paused() {
            return Err("background.paused".to_string());
        }
        Ok(())
    }
}

/// A validated CPU limit. `CpuRate` is hundredths of a percent, so 25% is
/// 2500, exactly what a Windows job object expects for a hard cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuLimit {
    percent: u8,
}

impl CpuLimit {
    pub fn new(percent: u8) -> Result<Self, String> {
        Ok(Self {
            percent: validate_cpu_percent(percent)?,
        })
    }

    pub fn percent(self) -> u8 {
        self.percent
    }

    pub fn cpu_rate_hundredths(self) -> u32 {
        u32::from(self.percent) * 100
    }
}

/// Apply the CPU rate as a hard cap to an existing helper job object. This
/// is enforcement; lowering a priority alone is not.
#[cfg(windows)]
pub fn apply_job_cpu_hard_cap(
    job: windows::Win32::Foundation::HANDLE,
    limit: CpuLimit,
) -> Result<(), String> {
    use windows::Win32::System::JobObjects::{
        JobObjectCpuRateControlInformation, SetInformationJobObject,
        JOBOBJECT_CPU_RATE_CONTROL_INFORMATION, JOBOBJECT_CPU_RATE_CONTROL_INFORMATION_0,
        JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
    };
    let information = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
        ControlFlags: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
        Anonymous: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION_0 {
            CpuRate: limit.cpu_rate_hundredths(),
        },
    };
    // SAFETY: `job` is an open job handle owned by the helper manager and
    // `information` outlives the synchronous call with its exact size.
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectCpuRateControlInformation,
            &information as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32,
        )
    }
    .map_err(|_| "background.failed".to_string())
}

/// The valid CPU range, exported for the settings page.
pub fn cpu_percent_bounds() -> (u8, u8) {
    (CPU_PERCENT_MIN, CPU_PERCENT_MAX)
}
