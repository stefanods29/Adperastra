//! Measured private memory for the resident shell (Step 16, guide D7).
//!
//! The number shown in Settings is read from
//! `GetProcessMemoryInfo(PROCESS_MEMORY_COUNTERS_EX).PrivateUsage`. It is
//! never estimated from a table and is clipped to the JSON safe-integer
//! range before it reaches the UI.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::windows_integration_types::{is_safe_wire, MAX_SAFE_WIRE};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemorySample {
    pub private_bytes: u64,
    pub measured_unix: u64,
}

impl MemorySample {
    pub const ZERO: Self = Self {
        private_bytes: 0,
        measured_unix: 0,
    };

    pub fn clipped(self) -> Self {
        Self {
            private_bytes: self.private_bytes.min(MAX_SAFE_WIRE),
            measured_unix: self.measured_unix,
        }
    }
}

pub fn clip_private_bytes(value: u64) -> u64 {
    if is_safe_wire(value) {
        value
    } else {
        MAX_SAFE_WIRE
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Read the current process counters. A failure keeps the last sample in the
/// caller; it never shows a made-up number.
#[cfg(windows)]
pub fn measure() -> Result<MemorySample, String> {
    use windows::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS_EX {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    // SAFETY: `counters.cb` describes the buffer, which the call fills.
    let counters_ptr = &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX;
    let result = unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            counters_ptr.cast::<windows::Win32::System::ProcessStatus::PROCESS_MEMORY_COUNTERS>(),
            counters.cb,
        )
    };
    result.map_err(|_| "resident.failed".to_string())?;
    Ok(MemorySample {
        private_bytes: clip_private_bytes(counters.PrivateUsage as u64),
        measured_unix: now_unix(),
    })
}

#[cfg(not(windows))]
pub fn measure() -> Result<MemorySample, String> {
    Err("resident.failed".to_string())
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    #[test]
    fn clips_values_to_the_safe_wire_range() {
        assert_eq!(clip_private_bytes(1024), 1024);
        assert_eq!(clip_private_bytes(u64::MAX), MAX_SAFE_WIRE);
        assert_eq!(MemorySample::ZERO.clipped(), MemorySample::ZERO);
    }
}
