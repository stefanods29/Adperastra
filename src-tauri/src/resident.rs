//! Resident mode commands and runtime (Step 16, guide D6-D8).
//!
//! The state machine lives in `resident_state.rs`; this module only exposes
//! it to the UI, measures memory when Settings asks, and keeps the last
//! measured sample. Creating the coordinator with its real `ResidentHost`
//! (windows, documents, engines, settings) belongs to the coordinator-owned
//! app setup.
#![allow(dead_code)]


use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::ensure_main;
use crate::resident_memory::{MemorySample, measure};
pub use crate::resident_state::{
    ActivationTicket, CloseDecision, CloseReason, ResidentCoordinator, ResidentState,
};
use crate::tray::{build_tray, set_visible, TrayLabels};

/// The wire status read by Settings and the tray.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResidentStatus {
    pub state: ResidentState,
    pub enabled: bool,
    pub start_with_windows: bool,
    pub private_bytes: u64,
    pub measured_unix: u64,
    pub active_jobs: u32,
}

/// The last translated labels, kept even while the tray does not exist yet.
#[derive(Clone, Default)]
pub struct TrayLabelsState(pub Arc<Mutex<Option<TrayLabels>>>);

/// The app-owned resident runtime, managed by Tauri.
#[derive(Clone)]
pub struct ResidentRuntime {
    coordinator: Arc<ResidentCoordinator>,
    memory: Arc<Mutex<MemorySample>>,
    active_jobs: Arc<AtomicU32>,
}

impl ResidentRuntime {
    pub fn new(coordinator: Arc<ResidentCoordinator>, active_jobs: Arc<AtomicU32>) -> Self {
        Self {
            coordinator,
            memory: Arc::new(Mutex::new(MemorySample::ZERO)),
            active_jobs,
        }
    }

    pub fn coordinator(&self) -> &ResidentCoordinator {
        self.coordinator.as_ref()
    }

    /// Count foreground or background jobs that need an unacknowledged
    /// choice. The coordinator updates this from the shared job table.
    pub fn set_active_jobs(&self, count: u32) {
        self.active_jobs.store(count, Ordering::Relaxed);
    }

    pub fn status(&self) -> Result<ResidentStatus, String> {
        let sample = match measure() {
            Ok(sample) => {
                let mut cached = self
                    .memory
                    .lock()
                    .map_err(|_| "resident.failed".to_string())?;
                *cached = sample.clipped();
                sample.clipped()
            }
            // Keep the last real measurement rather than inventing a number.
            Err(_) => *self
                .memory
                .lock()
                .map_err(|_| "resident.failed".to_string())?,
        };
        Ok(ResidentStatus {
            state: self.coordinator.state(),
            enabled: self.coordinator.enabled(),
            start_with_windows: self.coordinator.start_with_windows(),
            private_bytes: sample.private_bytes,
            measured_unix: sample.measured_unix,
            active_jobs: self.active_jobs.load(Ordering::Relaxed),
        })
    }

    pub fn set_mode(
        &self,
        enabled: bool,
        start_with_windows: bool,
    ) -> Result<ResidentStatus, String> {
        self.coordinator.set_mode(enabled, start_with_windows)?;
        self.status()
    }
}

impl ResidentCoordinator {
    /// Guide E3: one incoming 09c activation. The request's fixed intent and
    /// bounded paths are validated before the single window is shown.
    pub async fn activate(
        &self,
        request: crate::activation::ActivationRequest,
    ) -> Result<(), String> {
        let plan = crate::integration_commands::plan_from_request(&request)?;
        self.activate_ticket(ActivationTicket {
            request_id: request.request_id.clone(),
            paths: plan.paths,
            intent: request.intent,
        })
    }
}

#[tauri::command]
pub async fn resident_status(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<ResidentStatus, String> {
    ensure_main(window.label())?;
    // A missing runtime is a wiring error, not a reason to panic the main
    // window; the command fails closed until the coordinator manages it.
    let runtime = app
        .try_state::<ResidentRuntime>()
        .map(|runtime| runtime.inner().clone())
        .ok_or_else(|| "resident.failed".to_string())?;
    tauri::async_runtime::spawn_blocking(move || runtime.status())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn resident_set(
    window: WebviewWindow,
    app: AppHandle,
    enabled: bool,
    start_with_windows: bool,
) -> Result<ResidentStatus, String> {
    ensure_main(window.label())?;
    // Enabling without an app icon would create an invisible tray; refuse
    // before the flags change.
    if enabled && app.default_window_icon().is_none() {
        return Err("resident.failed".to_string());
    }
    let runtime = app
        .try_state::<ResidentRuntime>()
        .map(|runtime| runtime.inner().clone())
        .ok_or_else(|| "resident.failed".to_string())?;
    // The tray stays visible for the whole resident lifetime. The first
    // enable therefore needs the translated labels that
    // `resident_tray_labels` caches; without them the hidden copy would have
    // no visible way to open or quit.
    let cached = app
        .try_state::<TrayLabelsState>()
        .and_then(|state| state.0.lock().ok().and_then(|labels| labels.clone()));
    if enabled && cached.is_none() {
        return Err("resident.failed".to_string());
    }
    let status = tauri::async_runtime::spawn_blocking(move || {
        runtime.set_mode(enabled, start_with_windows)
    })
    .await
    .map_err(|error| error.to_string())??;
    if status.enabled {
        if let Some(labels) = cached {
            let handle = app.clone();
            app.run_on_main_thread(move || {
                let _ = build_tray(&handle, labels);
            })
            .map_err(|_| "resident.failed".to_string())?;
        }
    } else {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = set_visible(&handle, false);
        })
        .map_err(|_| "resident.failed".to_string())?;
    }
    Ok(status)
}

#[tauri::command]
pub fn resident_show(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main(window.label())?;
    let runtime = app
        .try_state::<ResidentRuntime>()
        .map(|runtime| runtime.inner().clone())
        .ok_or_else(|| "resident.failed".to_string())?;
    runtime.coordinator().restore_window()
}

/// The UI calls this only after the normal 09a/09h dirty flow approved the
/// close. `reason` is one of `close`, `turn_off`, `quit`; no other value is
/// accepted and nothing is written from the string.
#[tauri::command]
pub fn resident_close_confirmed(
    window: WebviewWindow,
    app: AppHandle,
    reason: String,
) -> Result<CloseDecision, String> {
    ensure_main(window.label())?;
    let reason = CloseReason::parse(&reason)?;
    let runtime = app
        .try_state::<ResidentRuntime>()
        .map(|runtime| runtime.inner().clone())
        .ok_or_else(|| "resident.failed".to_string())?;
    runtime.coordinator().confirmed(reason)
}

fn valid_label(text: &str) -> bool {
    !text.trim().is_empty()
        && text.chars().count() <= 128
        && !text.chars().any(|character| character.is_control())
}

/// The UI sends the three translated tray labels after a language change.
/// Values are text for a native menu, bounded and checked; they never become
/// a command line.
#[tauri::command]
pub fn resident_tray_labels(
    window: WebviewWindow,
    app: AppHandle,
    labels: TrayLabels,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if !valid_label(&labels.open) || !valid_label(&labels.turn_off) || !valid_label(&labels.quit) {
        return Err("resident.failed".to_string());
    }
    if app.default_window_icon().is_none() {
        return Err("resident.failed".to_string());
    }
    let labels_state = app
        .try_state::<TrayLabelsState>()
        .ok_or_else(|| "resident.failed".to_string())?;
    let enabled = app
        .try_state::<ResidentRuntime>()
        .map(|runtime| runtime.coordinator().enabled())
        .unwrap_or(false);
    if enabled {
        let handle = app.clone();
        let tray_labels = labels.clone();
        app.run_on_main_thread(move || {
            let _ = build_tray(&handle, tray_labels);
        })
        .map_err(|_| "resident.failed".to_string())?;
    }
    *labels_state
        .0
        .lock()
        .map_err(|_| "resident.failed".to_string())? = Some(labels);
    Ok(())
}
