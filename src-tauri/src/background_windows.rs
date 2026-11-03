//! Windows idle and power sampling for the background policy (Step 07a, D6).
//!
//! One dedicated thread samples once a second. `GetLastInputInfo` reports a
//! 32-bit tick that wraps every 49.7 days, so the difference is computed with
//! wrapping arithmetic against the current 32-bit tick.

use std::sync::atomic::{AtomicBool, AtomicI8, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A sample every second (plan D6).
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// `ACLineStatus` values from `GetSystemPowerStatus`.
const AC_UNKNOWN: i8 = -1;
const AC_OFFLINE: i8 = 0;
const AC_ONLINE: i8 = 1;

/// The latest idle and AC facts, shared with the policy.
pub struct WindowsBackgroundState {
    idle_ms: AtomicU64,
    ac: AtomicI8,
    stop: Arc<AtomicBool>,
}

impl WindowsBackgroundState {
    /// Start the sampling thread. A failure leaves unknown values, which
    /// makes "only on AC power" ineligible rather than guessing.
    pub fn start() -> Arc<Self> {
        let state = Arc::new(Self {
            idle_ms: AtomicU64::new(0),
            ac: AtomicI8::new(AC_UNKNOWN),
            stop: Arc::new(AtomicBool::new(false)),
        });
        let weak = Arc::downgrade(&state);
        let stop = Arc::clone(&state.stop);
        let _ = std::thread::Builder::new()
            .name("background-power".to_string())
            .spawn(move || loop {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                let (idle_ms, ac) = sample();
                let Some(state) = weak.upgrade() else {
                    return;
                };
                state.idle_ms.store(idle_ms, Ordering::Relaxed);
                state.ac.store(ac, Ordering::Relaxed);
                drop(state);
                std::thread::sleep(POLL_INTERVAL);
            });
        state
    }

    pub fn idle_ms(&self) -> u64 {
        self.idle_ms.load(Ordering::Relaxed)
    }

    /// `Some(true)` on AC, `Some(false)` on battery, `None` when unknown.
    pub fn ac(&self) -> Option<bool> {
        match self.ac.load(Ordering::Relaxed) {
            AC_ONLINE => Some(true),
            AC_OFFLINE => Some(false),
            _ => None,
        }
    }
}

impl Drop for WindowsBackgroundState {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// The wrap-safe idle time between two 32-bit tick values.
pub fn idle_between(now: u32, last_input: u32) -> u64 {
    u64::from(now.wrapping_sub(last_input))
}

#[cfg(windows)]
fn sample() -> (u64, i8) {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    // SAFETY: both calls write into correctly sized local structures. A
    // failed call leaves the defaults, which the policy treats as ineligible.
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        let idle_ms = if GetLastInputInfo(&mut info).as_bool() {
            idle_between(GetTickCount(), info.dwTime)
        } else {
            0
        };
        let mut power = SYSTEM_POWER_STATUS::default();
        let ac = if GetSystemPowerStatus(&mut power).is_ok() {
            match power.ACLineStatus {
                1 => AC_ONLINE,
                0 => AC_OFFLINE,
                _ => AC_UNKNOWN,
            }
        } else {
            AC_UNKNOWN
        };
        (idle_ms, ac)
    }
}

#[cfg(not(windows))]
fn sample() -> (u64, i8) {
    (0, AC_UNKNOWN)
}

#[cfg(test)]
mod tests {
    use super::idle_between;

    #[test]
    fn idle_time_survives_the_32_bit_wrap() {
        assert_eq!(idle_between(1_000, 1_000), 0);
        assert_eq!(idle_between(1_000, 500), 500);
        // Five ticks before the wrap, five after it: ten milliseconds.
        assert_eq!(idle_between(5, u32::MAX - 4), 10);
    }
}
