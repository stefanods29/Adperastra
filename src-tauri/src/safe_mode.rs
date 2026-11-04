//! Non-destructive safe mode (Step 09h T4).
//!
//! Safe mode uses default settings in memory, keeps the original settings,
//! session and recovery catalog read-only, and disables packs and automatic
//! helpers. It never resets or rewrites the user's saved configuration.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};

use crate::startup_health::{StartupHealth, FAILED_START_LIMIT};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SafeModeReason {
    RepeatedStartupFailure,
    Manual,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SafeModeStatus {
    pub active: bool,
    pub reason: SafeModeReason,
    pub failed_starts: u8,
    pub settings_read_only: bool,
}

impl Default for SafeModeStatus {
    fn default() -> Self {
        Self {
            active: false,
            reason: SafeModeReason::None,
            failed_starts: 0,
            settings_read_only: false,
        }
    }
}

#[derive(Default)]
pub struct SafeMode {
    status: Mutex<SafeModeStatus>,
}

impl SafeMode {
    pub fn new(failed_starts: u8) -> Self {
        let mode = Self::default();
        if failed_starts >= FAILED_START_LIMIT {
            mode.activate(SafeModeReason::RepeatedStartupFailure, failed_starts);
        }
        mode
    }

    pub fn activate(&self, reason: SafeModeReason, failed_starts: u8) {
        if let Ok(mut status) = self.status.lock() {
            *status = SafeModeStatus {
                active: true,
                reason,
                failed_starts,
                settings_read_only: true,
            };
        }
    }

    pub fn status(&self) -> SafeModeStatus {
        self.status.lock().map(|status| status.clone()).unwrap_or_default()
    }

    /// Saving settings is refused while safe mode is active. The coordinator
    /// calls this first in `save_settings`, so the original bytes stay. A
    /// poisoned lock also refuses the write instead of assuming normal mode.
    pub fn settings_writable(&self) -> Result<(), String> {
        match self.status.lock() {
            Ok(status) if !status.active => Ok(()),
            Ok(_) | Err(_) => Err("settings.read_only".to_string()),
        }
    }

    /// Session and recovery-catalog writes are refused too: safe mode keeps
    /// the original state until the user explicitly restarts normally.
    pub fn state_writable(&self) -> Result<(), String> {
        match self.status.lock() {
            Ok(status) if !status.active => Ok(()),
            Ok(_) | Err(_) => Err("safe_mode.read_only".to_string()),
        }
    }

    /// A restart is allowed only from safe mode and after the UI has awaited
    /// its dirty-close decision. It never clears the mode on its own.
    pub fn restart_allowed(&self) -> Result<(), String> {
        match self.status.lock() {
            Ok(status) if status.active => Ok(()),
            Ok(_) | Err(_) => Err("safe_mode.not_active".to_string()),
        }
    }

    fn deactivate_for_restart(&self) {
        if let Ok(mut status) = self.status.lock() {
            status.active = false;
            status.reason = SafeModeReason::None;
            status.settings_read_only = false;
        }
    }
}

#[tauri::command]
pub fn safe_mode_status(window: WebviewWindow, safe: State<'_, SafeMode>) -> Result<SafeModeStatus, String> {
    crate::ensure_main(window.label())?;
    Ok(safe.status())
}

/// The TypeScript caller first awaits the app close/dirty decision; only an
/// explicit "Restart normally" reaches this command. Evidence rows remain.
#[tauri::command]
pub fn restart_normal(
    window: WebviewWindow,
    app: AppHandle,
    safe: State<'_, SafeMode>,
    health: State<'_, StartupHealth>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    safe.restart_allowed()?;
    let now = crate::unix_now();
    health.acknowledge_restart(now)?;
    safe.deactivate_for_restart();
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_failures_activate_safe_mode_and_two_do_not() {
        assert!(!SafeMode::new(2).status().active);
        let mode = SafeMode::new(3);
        let status = mode.status();
        assert!(status.active);
        assert_eq!(status.reason, SafeModeReason::RepeatedStartupFailure);
        assert_eq!(status.failed_starts, 3);
        assert!(status.settings_read_only);
    }

    #[test]
    fn safe_mode_refuses_settings_writes_without_touching_the_file() {
        let folder = tempfile::tempdir().unwrap();
        let settings = folder.path().join("settings.json");
        let original = br#"{"schema_version":24,"language":"es","theme":{"mode":"dark"}}"#;
        std::fs::write(&settings, original).unwrap();
        let before = std::fs::read(&settings).unwrap();

        let mode = SafeMode::new(3);
        assert_eq!(mode.settings_writable().unwrap_err(), "settings.read_only");
        assert_eq!(std::fs::read(&settings).unwrap(), before);
        assert_eq!(&before, original);
    }

    #[test]
    fn restart_is_refused_outside_safe_mode() {
        let mode = SafeMode::default();
        assert_eq!(mode.restart_allowed().unwrap_err(), "safe_mode.not_active");
    }

    #[test]
    fn a_manual_activation_is_explicit() {
        let mode = SafeMode::default();
        mode.activate(SafeModeReason::Manual, 0);
        assert_eq!(mode.status().reason, SafeModeReason::Manual);
        assert!(mode.status().settings_read_only);
    }
}
