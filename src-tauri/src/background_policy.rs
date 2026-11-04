//! Step 12a additions to the Step 07a background policy: quiet hours,
//! full-screen and CPU rules. One policy authority stays in `background.rs`;
//! this module only supplies the pure decision inputs and validation.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

/// The default quiet-hours window (22:00 to 07:00).
pub const QUIET_START_DEFAULT: u16 = 22 * 60;
pub const QUIET_END_DEFAULT: u16 = 7 * 60;
pub const CPU_PERCENT_DEFAULT: u8 = 25;
pub const CPU_PERCENT_MIN: u8 = 5;
pub const CPU_PERCENT_MAX: u8 = 100;
/// Step 07a's idle threshold.
pub const IDLE_THRESHOLD_MS: u64 = 30_000;

/// Quiet hours in Windows local time, as minutes since midnight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuietHours {
    pub enabled: bool,
    pub start_minute: u16,
    pub end_minute: u16,
}

impl Default for QuietHours {
    fn default() -> Self {
        Self {
            enabled: false,
            start_minute: QUIET_START_DEFAULT,
            end_minute: QUIET_END_DEFAULT,
        }
    }
}

/// The three new background controls (schema 37).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackgroundRules {
    pub pause_fullscreen: bool,
    pub quiet_hours: QuietHours,
    pub cpu_percent: u8,
}

impl Default for BackgroundRules {
    fn default() -> Self {
        Self {
            pause_fullscreen: true,
            quiet_hours: QuietHours::default(),
            cpu_percent: CPU_PERCENT_DEFAULT,
        }
    }
}

/// Why background work is (or is not) allowed right now. The native
/// `background_tasks` adapter maps these onto Step 07a's reason type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundGate {
    Allowed,
    Disabled,
    Idle,
    Ac,
    Paused,
    Fullscreen,
    QuietHours,
}

impl BackgroundGate {
    /// The serialized reason for `BackgroundTaskStatus`. Step 07a's enum is
    /// extended additively with `fullscreen`, `quiet_hours` and `user`.
    pub fn reason_code(self) -> &'static str {
        match self {
            BackgroundGate::Allowed => "none",
            BackgroundGate::Disabled => "disabled",
            BackgroundGate::Idle => "idle",
            BackgroundGate::Ac => "ac",
            BackgroundGate::Paused => "user",
            BackgroundGate::Fullscreen => "fullscreen",
            BackgroundGate::QuietHours => "quiet_hours",
        }
    }
}

/// Every input the decision needs, so the function stays pure and testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateInputs {
    pub enabled: bool,
    pub globally_paused: bool,
    pub only_idle: bool,
    pub only_ac: bool,
    pub idle_ms: u64,
    /// `None` means Windows did not answer; only-on-AC treats it ineligible.
    pub ac: Option<bool>,
    pub fullscreen: bool,
    pub local_minute: u16,
}

/// Evaluate the shared policy. Foreground user work never calls this.
pub fn evaluate(rules: &BackgroundRules, inputs: &GateInputs) -> BackgroundGate {
    if inputs.globally_paused {
        return BackgroundGate::Paused;
    }
    if !inputs.enabled {
        return BackgroundGate::Disabled;
    }
    if rules.pause_fullscreen && inputs.fullscreen {
        return BackgroundGate::Fullscreen;
    }
    if quiet_hours_active(&rules.quiet_hours, inputs.local_minute) {
        return BackgroundGate::QuietHours;
    }
    if inputs.only_idle && inputs.idle_ms < IDLE_THRESHOLD_MS {
        return BackgroundGate::Idle;
    }
    if inputs.only_ac && inputs.ac != Some(true) {
        return BackgroundGate::Ac;
    }
    BackgroundGate::Allowed
}

/// True when `minute` is inside the quiet window. A window that wraps
/// midnight (22:00 to 07:00) is two ranges; equal start and end means all
/// day when enabled.
pub fn quiet_hours_active(quiet: &QuietHours, minute: u16) -> bool {
    if !quiet.enabled || minute >= 24 * 60 {
        return false;
    }
    if quiet.start_minute == quiet.end_minute {
        return true;
    }
    if quiet.start_minute < quiet.end_minute {
        minute >= quiet.start_minute && minute < quiet.end_minute
    } else {
        minute >= quiet.start_minute || minute < quiet.end_minute
    }
}

/// Reject an out-of-range clock value before it reaches settings.
pub fn validate_quiet_hours(quiet: &QuietHours) -> Result<(), String> {
    if quiet.start_minute >= 24 * 60 || quiet.end_minute >= 24 * 60 {
        return Err("background.bad_request".to_string());
    }
    Ok(())
}

/// Convert a local `HH:MM` pair into minutes since midnight.
pub fn minute_of_day(hour: u16, minute: u16) -> Option<u16> {
    if hour >= 24 || minute >= 60 {
        return None;
    }
    Some(hour * 60 + minute)
}

/// The current Windows local minute (0..1439). `None` means the clock could
/// not be read, so quiet hours are not guessed at.
#[cfg(windows)]
pub fn local_minute_now() -> Option<u16> {
    use windows::Win32::System::SystemInformation::GetLocalTime;

    // SAFETY: GetLocalTime returns a fully initialized SYSTEMTIME value.
    let time = unsafe { GetLocalTime() };
    minute_of_day(time.wHour, time.wMinute)
}

#[cfg(not(windows))]
pub fn local_minute_now() -> Option<u16> {
    None
}

/// The CPU limit accepts 5 to 100 inclusive (Step 12a D8).
pub fn validate_cpu_percent(percent: u8) -> Result<u8, String> {
    if !(CPU_PERCENT_MIN..=CPU_PERCENT_MAX).contains(&percent) {
        return Err("background.bad_request".to_string());
    }
    Ok(percent)
}

#[cfg(test)]
#[path = "background_step12a_tests.rs"]
mod background_step12a_tests;
