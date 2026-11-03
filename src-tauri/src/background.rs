//! The one background policy every preview provider shares (Step 07a, E4).
//!
//! The decision itself is pure: settings, the sampled idle time and the AC
//! fact go in, one reason comes out. The policy object owns the settings
//! copy, the registered task kinds and the shared bounded scheduler.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::background_queue::BackgroundScheduler;
use crate::background_windows::WindowsBackgroundState;
use crate::ensure_main;

/// No keyboard or mouse input for this long means idle (plan D6).
pub const IDLE_AFTER_MS: u64 = 30_000;

/// The cache limits Settings offers, in megabytes (schema 12).
pub const CACHE_LIMITS_MB: [u32; 5] = [128, 256, 512, 1024, 2048];
/// The default preview cache limit (plan D3).
pub const DEFAULT_CACHE_MB: u32 = 512;

#[path = "background_types.rs"]
mod types;
pub use types::{BackgroundSettings, BackgroundTaskKind, CacheSettings};

/// Why background work is not eligible right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundReason {
    None,
    Disabled,
    Idle,
    Ac,
    Paused,
}

/// What Settings shows about the shared policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackgroundStatus {
    pub paused: bool,
    pub eligible: bool,
    pub reason: BackgroundReason,
    pub running: u32,
    pub queued: u32,
}

/// The pure inputs of one eligibility decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PolicyInputs {
    pub enabled: bool,
    pub only_idle: bool,
    pub only_ac: bool,
    pub paused: bool,
    pub task_enabled: bool,
}

/// The complete eligibility rule, in one place.
pub fn decide(inputs: PolicyInputs, idle_ms: u64, ac: Option<bool>) -> BackgroundReason {
    if inputs.paused {
        return BackgroundReason::Paused;
    }
    if !inputs.enabled || !inputs.task_enabled {
        return BackgroundReason::Disabled;
    }
    if inputs.only_idle && idle_ms < IDLE_AFTER_MS {
        return BackgroundReason::Idle;
    }
    if inputs.only_ac && ac != Some(true) {
        return BackgroundReason::Ac;
    }
    BackgroundReason::None
}

/// The managed policy object: settings copy, registrations and scheduler.
pub struct BackgroundPolicy {
    settings: Mutex<BackgroundSettings>,
    registered: Mutex<HashSet<BackgroundTaskKind>>,
    scheduler: Arc<BackgroundScheduler>,
    windows: Arc<WindowsBackgroundState>,
}

impl BackgroundPolicy {
    pub fn new(
        settings: BackgroundSettings,
        scheduler: Arc<BackgroundScheduler>,
        windows: Arc<WindowsBackgroundState>,
    ) -> Self {
        Self {
            settings: Mutex::new(settings),
            registered: Mutex::new(HashSet::new()),
            scheduler,
            windows,
        }
    }

    /// Copy a saved settings object; pausing through Save also cancels the
    /// units that are already running.
    pub fn set_settings(&self, settings: &BackgroundSettings) {
        let paused = settings.paused;
        if let Ok(mut current) = self.settings.lock() {
            *current = settings.clone();
        }
        if paused {
            self.pause_all();
        } else {
            self.scheduler.resume();
        }
        for kind in [
            BackgroundTaskKind::Thumbnails,
            BackgroundTaskKind::Metadata,
            BackgroundTaskKind::Ocr,
            BackgroundTaskKind::FilenameIndex,
            BackgroundTaskKind::ContentIndex,
            BackgroundTaskKind::FolderSizes,
            BackgroundTaskKind::StorageScan,
            BackgroundTaskKind::VersionCleanup,
            BackgroundTaskKind::PackDownload,
        ] {
            if !settings.enabled || !settings.task_enabled(kind) {
                self.cancel_kind(kind);
            }
        }
    }

    /// Register one installed task kind. Unknown kinds cannot exist in the
    /// enum; a second registration is refused so a bug is visible.
    pub fn register(
        &self,
        kind: BackgroundTaskKind,
        enabled_by_default: bool,
    ) -> Result<(), String> {
        let mut registered = self
            .registered
            .lock()
            .map_err(|_| "background lock poisoned".to_string())?;
        if !registered.insert(kind) {
            return Err(format!("background task {:?} is already registered", kind));
        }
        drop(registered);
        if let Ok(mut settings) = self.settings.lock() {
            settings
                .tasks
                .entry(kind.as_str().to_string())
                .or_insert(enabled_by_default);
        }
        Ok(())
    }

    /// Pure eligibility against the current settings and sampled facts.
    pub fn eligible(&self, kind: BackgroundTaskKind, idle_ms: u64, ac: Option<bool>) -> bool {
        self.reason_for(kind, idle_ms, ac) == BackgroundReason::None
    }

    /// Eligibility for one kind using the shared sampled idle/AC facts.
    /// `eligible` stays the pure decision; this samples the same
    /// `WindowsBackgroundState` the owner thread updates.
    pub fn eligible_now(&self, kind: BackgroundTaskKind) -> bool {
        self.eligible(kind, self.windows.idle_ms(), self.windows.ac())
    }

    /// E4 export for later providers (07b/12a); no caller in 07a yet.
    pub fn cancel_kind(&self, kind: BackgroundTaskKind) {
        self.scheduler.cancel_kind(kind);
    }

    pub fn set_paused(&self, paused: bool) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.paused = paused;
        }
        if paused {
            self.scheduler.pause_all();
        } else {
            self.scheduler.resume();
        }
    }

    /// E4 wrapper kept for later providers and the tray (Step 16).
    pub fn pause_all(&self) {
        self.set_paused(true);
    }

    /// The latest sampled inputs, so a provider can re-check eligibility
    /// without starting a Windows sample of its own.
    pub fn samples(&self) -> (u64, Option<bool>) {
        (self.windows.idle_ms(), self.windows.ac())
    }

    pub fn status(&self) -> BackgroundStatus {
        let settings = match self.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => BackgroundSettings::default(),
        };
        let (running, queued) = self.scheduler.counts();
        let reason = self.reason_for(
            BackgroundTaskKind::Thumbnails,
            self.windows.idle_ms(),
            self.windows.ac(),
        );
        BackgroundStatus {
            paused: settings.paused,
            eligible: reason == BackgroundReason::None,
            reason,
            running,
            queued,
        }
    }

    fn reason_for(
        &self,
        kind: BackgroundTaskKind,
        idle_ms: u64,
        ac: Option<bool>,
    ) -> BackgroundReason {
        let settings = match self.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => return BackgroundReason::Disabled,
        };
        let is_registered = self
            .registered
            .lock()
            .map(|registered| registered.contains(&kind))
            .unwrap_or(false);
        decide(
            PolicyInputs {
                enabled: settings.enabled,
                only_idle: settings.only_idle,
                only_ac: settings.only_ac,
                paused: settings.paused,
                task_enabled: is_registered && settings.task_enabled(kind),
            },
            idle_ms,
            ac,
        )
    }
}

/// The Settings status: policy state, never an execution result.
#[tauri::command]
pub fn background_status(
    window: WebviewWindow,
    policy: State<'_, Arc<BackgroundPolicy>>,
) -> Result<BackgroundStatus, String> {
    ensure_main(window.label())?;
    Ok(policy.status())
}

#[cfg(test)]
#[path = "background_tests.rs"]
mod tests;
