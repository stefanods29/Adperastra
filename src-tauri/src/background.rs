//! The one background policy every preview provider shares (Step 07a, E4).
//!
//! The decision itself is pure: settings, the sampled idle time and the AC
//! fact go in, one reason comes out. The policy object owns the settings
//! copy, the registered task kinds and the shared bounded scheduler.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::background_limits::{BackgroundCheckpoint, CpuLimit, PauseGate};
use crate::background_policy::{
    evaluate, local_minute_now, validate_cpu_percent, validate_quiet_hours, BackgroundGate,
    BackgroundRules, GateInputs, QuietHours,
};
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
pub use types::{BackgroundSettings, BackgroundTaskKind, CacheSettings, QuietHoursSettings};

/// Why background work is not eligible right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundReason {
    None,
    Disabled,
    Idle,
    Ac,
    /// The user pressed Pause all. Kept under the 07a variant name so the
    /// existing policy tests stay exact; the wire value is `user`.
    #[serde(rename = "user")]
    Paused,
    Fullscreen,
    QuietHours,
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

/// One row of the bounded `background_tasks` list (Step 12a E5). The single
/// 07a status record above is unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackgroundTaskStatus {
    pub kind: BackgroundTaskKind,
    pub enabled: bool,
    pub eligible: bool,
    pub reason: Option<BackgroundReason>,
    pub running: u32,
    pub queued: u32,
    pub last_error_code: Option<String>,
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
    pause_gate: Arc<PauseGate>,
    errors: Mutex<HashMap<BackgroundTaskKind, String>>,
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
            pause_gate: Arc::new(PauseGate::new()),
            errors: Mutex::new(HashMap::new()),
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
            self.pause_gate.resume();
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
            BackgroundTaskKind::MediaProxy,
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
            self.pause_gate.pause_all();
            self.scheduler.pause_all();
        } else {
            self.pause_gate.resume();
            self.scheduler.resume();
        }
    }

    /// E4 wrapper kept for later providers and the tray (Step 16).
    pub fn pause_all(&self) {
        self.set_paused(true);
    }

    /// The one shared pause gate a bounded parser reads at its checkpoints.
    pub fn pause_gate(&self) -> Arc<PauseGate> {
        Arc::clone(&self.pause_gate)
    }

    /// A checkpoint for one background loop. `foreground` work is an action
    /// the user started: it obeys Cancel but is never paused silently.
    pub fn checkpoint(
        &self,
        token: fs_service::CancellationToken,
        foreground: bool,
    ) -> BackgroundCheckpoint {
        BackgroundCheckpoint::new(Arc::clone(&self.pause_gate), token, foreground)
    }

    /// Apply the schema-37 full-screen, quiet-hour and CPU rules after
    /// validating them. Returns `background.bad_request` for an invalid value.
    pub fn set_rules(&self, rules: BackgroundRules) -> Result<(), String> {
        validate_quiet_hours(&rules.quiet_hours)?;
        validate_cpu_percent(rules.cpu_percent)?;
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| "background.failed".to_string())?;
        settings.pause_fullscreen = rules.pause_fullscreen;
        settings.quiet_hours = QuietHoursSettings {
            enabled: rules.quiet_hours.enabled,
            start_minute: rules.quiet_hours.start_minute,
            end_minute: rules.quiet_hours.end_minute,
        };
        settings.cpu_percent = rules.cpu_percent;
        Ok(())
    }

    pub fn rules(&self) -> BackgroundRules {
        match self.settings.lock() {
            Ok(settings) => rules_from(&settings),
            Err(_) => BackgroundRules::default(),
        }
    }

    pub fn set_task_enabled(&self, kind: BackgroundTaskKind, enabled: bool) -> Result<(), String> {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| "background.failed".to_string())?;
        settings.tasks.insert(kind.as_str().to_string(), enabled);
        drop(settings);
        if !enabled {
            self.cancel_kind(kind);
        }
        Ok(())
    }

    /// The job wrapper records the stable error code when a task fails; the
    /// next successful start clears it.
    pub fn note_task_error(&self, kind: BackgroundTaskKind, code: impl Into<String>) {
        if let Ok(mut errors) = self.errors.lock() {
            errors.insert(kind, code.into());
        }
    }

    pub fn clear_task_error(&self, kind: BackgroundTaskKind) {
        if let Ok(mut errors) = self.errors.lock() {
            errors.remove(&kind);
        }
    }

    /// The validated CPU limit for this policy, used when the helper manager
    /// creates the job object. Lowering priority alone is not this limit.
    pub fn cpu_limit(&self) -> Result<CpuLimit, String> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "background.failed".to_string())?;
        CpuLimit::new(settings.cpu_percent)
    }

    /// Apply the hard CPU rate to an existing helper job object.
    #[cfg(windows)]
    pub fn apply_cpu_limit(&self, job: windows::Win32::Foundation::HANDLE) -> Result<(), String> {
        crate::background_limits::apply_job_cpu_hard_cap(job, self.cpu_limit()?)
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
            paused: settings.paused || self.pause_gate.is_paused(),
            eligible: reason == BackgroundReason::None,
            reason,
            running,
            queued,
        }
    }

    /// The bounded list Settings > Background work shows. One row per
    /// registered kind, in the fixed order; `background_status` keeps its
    /// single 07a record.
    pub fn task_statuses(&self) -> Vec<BackgroundTaskStatus> {
        let settings = match self.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => BackgroundSettings::default(),
        };
        let registered = match self.registered.lock() {
            Ok(registered) => registered.clone(),
            Err(_) => HashSet::new(),
        };
        let idle_ms = self.windows.idle_ms();
        let ac = self.windows.ac();
        let mut rows = Vec::new();
        for kind in BackgroundTaskKind::ALL {
            if !registered.contains(&kind) {
                continue;
            }
            let reason = self.reason_for(kind, idle_ms, ac);
            let (running, queued) = self.scheduler.counts_for(kind);
            let last_error_code = self
                .errors
                .lock()
                .ok()
                .and_then(|errors| errors.get(&kind).cloned());
            rows.push(BackgroundTaskStatus {
                kind,
                enabled: settings.task_enabled(kind),
                eligible: reason == BackgroundReason::None,
                reason: (reason != BackgroundReason::None).then_some(reason),
                running,
                queued,
                last_error_code,
            });
        }
        rows
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
        let base = decide(
            PolicyInputs {
                enabled: settings.enabled,
                only_idle: settings.only_idle,
                only_ac: settings.only_ac,
                paused: settings.paused || self.pause_gate.is_paused(),
                task_enabled: is_registered && settings.task_enabled(kind),
            },
            idle_ms,
            ac,
        );
        if matches!(base, BackgroundReason::Paused | BackgroundReason::Disabled) {
            return base;
        }
        let rules = rules_from(&settings);
        let gate = evaluate(
            &rules,
            &GateInputs {
                enabled: true,
                globally_paused: false,
                only_idle: settings.only_idle,
                only_ac: settings.only_ac,
                idle_ms,
                ac,
                fullscreen: self.windows.fullscreen(),
                // An unreadable clock must not turn quiet hours on by guess.
                local_minute: local_minute_now().unwrap_or(u16::MAX),
            },
        );
        match gate {
            BackgroundGate::Allowed => BackgroundReason::None,
            BackgroundGate::Disabled => BackgroundReason::Disabled,
            BackgroundGate::Idle => BackgroundReason::Idle,
            BackgroundGate::Ac => BackgroundReason::Ac,
            BackgroundGate::Paused => BackgroundReason::Paused,
            BackgroundGate::Fullscreen => BackgroundReason::Fullscreen,
            BackgroundGate::QuietHours => BackgroundReason::QuietHours,
        }
    }
}

fn rules_from(settings: &BackgroundSettings) -> BackgroundRules {
    BackgroundRules {
        pause_fullscreen: settings.pause_fullscreen,
        quiet_hours: QuietHours {
            enabled: settings.quiet_hours.enabled,
            start_minute: settings.quiet_hours.start_minute,
            end_minute: settings.quiet_hours.end_minute,
        },
        cpu_percent: settings.cpu_percent,
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

/// The bounded task list, separate from the 07a status record.
#[tauri::command]
pub fn background_tasks(
    window: WebviewWindow,
    policy: State<'_, Arc<BackgroundPolicy>>,
) -> Result<Vec<BackgroundTaskStatus>, String> {
    ensure_main(window.label())?;
    Ok(policy.task_statuses())
}

/// The same policy pause authority the title bar and palette use.
#[tauri::command]
pub fn background_pause_all(
    window: WebviewWindow,
    policy: State<'_, Arc<BackgroundPolicy>>,
    paused: bool,
) -> Result<(), String> {
    ensure_main(window.label())?;
    policy.set_paused(paused);
    Ok(())
}

#[cfg(test)]
#[path = "background_tests.rs"]
mod tests;
