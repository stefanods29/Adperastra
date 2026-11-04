//! Dirty-safe resident state machine (Step 16, guide D6/D7; revision
//! `resident-mode-1`).
//!
//! Only five states exist and every transition is serialized. A close asks
//! the 09a document host to settle dirty documents first; Cancel leaves the
//! window visible and changes nothing. Entering resident mode releases heavy
//! engines and keeps only the background tasks the user already enabled.
//! Residency never enables a task, download or update check.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard};

/// The visible state of the application window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentState {
    Visible,
    ClosingDecision,
    Resident,
    Restoring,
    Quitting,
}

/// What the close handler should do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseDecision {
    KeepVisible,
    Hide,
    Exit,
}

/// Why a dirty decision is being asked, so the host can reuse the normal
/// 09a/09h wording and recovery path instead of a second prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseReason {
    WindowClose,
    TurnOff,
    Quit,
}

impl CloseReason {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "close" => Ok(CloseReason::WindowClose),
            "turn_off" => Ok(CloseReason::TurnOff),
            "quit" => Ok(CloseReason::Quit),
            _ => Err("resident.busy".to_string()),
        }
    }
}

/// One incoming activation from the 09c single-instance pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationTicket {
    pub request_id: String,
    pub paths: Vec<String>,
    /// The fixed Explorer verb carried as data; `None` opens.
    pub intent: Option<crate::windows_integration_types::ActivationIntent>,
}

/// Everything the state machine needs from the coordinator-owned app shell.
/// Each method runs on the UI thread the coordinator chooses; the machine
/// never touches windows, documents or engines itself.
pub trait ResidentHost: Send + Sync {
    /// Await the normal 09a/09h dirty decision. `true` means the close may
    /// proceed; `false` means the user cancelled. Must not discard anything.
    fn settle_dirty(&self, reason: CloseReason) -> Result<bool, String>;
    /// True while a foreground job has an unacknowledged choice on screen.
    fn has_pending_foreground_choice(&self) -> bool;
    fn hide_main_window(&self) -> Result<(), String>;
    fn show_main_window(&self) -> Result<(), String>;
    /// Release parsers, engines, GPU surfaces, read leases and proxies.
    fn release_heavy_resources(&self) -> Result<(), String>;
    /// Keep exactly the background tasks the user already enabled.
    fn retain_explicit_background(&self) -> Result<(), String>;
    /// Show the window first, then run the normal 09c open pipeline.
    fn forward_activation(&self, ticket: &ActivationTicket) -> Result<(), String>;
    /// Write or remove the owned HKCU Run value. Never enables anything else.
    fn set_start_with_windows(&self, enabled: bool) -> Result<(), String>;
    fn quit_app(&self) -> Result<(), String>;
    /// Number of main windows; must be 1 (no duplicate window).
    fn window_count(&self) -> u32;
}

struct Machine {
    state: ResidentState,
    enabled: bool,
    start_with_windows: bool,
    /// The state a cancelled decision returns to.
    resume: Option<ResidentState>,
}

/// The single owner of resident transitions.
pub struct ResidentCoordinator {
    machine: Mutex<Machine>,
    host: Arc<dyn ResidentHost>,
}

fn busy() -> String {
    "resident.busy".to_string()
}

impl ResidentCoordinator {
    pub fn new(host: Arc<dyn ResidentHost>, enabled: bool, start_with_windows: bool) -> Self {
        Self {
            machine: Mutex::new(Machine {
                state: ResidentState::Visible,
                enabled,
                start_with_windows: start_with_windows && enabled,
                resume: None,
            }),
            host,
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Machine>, String> {
        self.machine.lock().map_err(|_| busy())
    }

    pub fn state(&self) -> ResidentState {
        self.machine
            .lock()
            .map(|machine| machine.state)
            .unwrap_or(ResidentState::Visible)
    }

    pub fn enabled(&self) -> bool {
        self.machine
            .lock()
            .map(|machine| machine.enabled)
            .unwrap_or(false)
    }

    pub fn start_with_windows(&self) -> bool {
        self.machine
            .lock()
            .map(|machine| machine.start_with_windows)
            .unwrap_or(false)
    }

    pub fn host(&self) -> &dyn ResidentHost {
        self.host.as_ref()
    }

    fn set_state(&self, state: ResidentState) -> Result<(), String> {
        let mut machine = self.lock()?;
        machine.state = state;
        if state != ResidentState::ClosingDecision {
            machine.resume = None;
        }
        Ok(())
    }

    fn reset_to(&self, state: ResidentState) {
        if let Ok(mut machine) = self.lock() {
            machine.state = state;
            machine.resume = None;
        }
    }

    fn resume_after_cancel(&self) -> Result<ResidentState, String> {
        let mut machine = self.lock()?;
        let resume = machine.resume.unwrap_or(ResidentState::Visible);
        machine.state = resume;
        machine.resume = None;
        Ok(resume)
    }

    /// The window close button or Alt+F4 (synchronous part).
    pub fn request_close_now(&self) -> Result<CloseDecision, String> {
        {
            let mut machine = self.lock()?;
            match machine.state {
                // A close event on the hidden shell is already satisfied.
                ResidentState::Resident => return Ok(CloseDecision::Hide),
                ResidentState::Visible => {
                    machine.state = ResidentState::ClosingDecision;
                    machine.resume = Some(ResidentState::Visible);
                }
                _ => return Err(busy()),
            }
        }

        if self.host.has_pending_foreground_choice() {
            // Guide D6: never hide while a foreground job still needs an
            // answer. The window stays visible and the dialog keeps focus.
            self.reset_to(ResidentState::Visible);
            return Ok(CloseDecision::KeepVisible);
        }

        let approved = match self.host.settle_dirty(CloseReason::WindowClose) {
            Ok(approved) => approved,
            Err(error) => {
                self.reset_to(ResidentState::Visible);
                return Err(error);
            }
        };
        if !approved {
            self.reset_to(ResidentState::Visible);
            return Ok(CloseDecision::KeepVisible);
        }

        let enabled = self.lock()?.enabled;
        if !enabled {
            self.set_state(ResidentState::Quitting)?;
            if let Err(error) = self.host.quit_app() {
                self.reset_to(ResidentState::Visible);
                return Err(error);
            }
            return Ok(CloseDecision::Exit);
        }

        // Release before hiding: if a release fails the window is still
        // visible and the user can retry instead of facing a hidden app.
        if let Err(error) = self
            .host
            .release_heavy_resources()
            .and_then(|_| self.host.retain_explicit_background())
            .and_then(|_| self.host.hide_main_window())
        {
            self.reset_to(ResidentState::Visible);
            return Err(error);
        }
        self.set_state(ResidentState::Resident)?;
        Ok(CloseDecision::Hide)
    }

    /// Guide E3's Future-returning entry point. The synchronous window event
    /// uses `request_close_now`; asynchronous hosts can await this.
    pub async fn request_close(&self) -> Result<CloseDecision, String> {
        self.request_close_now()
    }

    /// Continue a close the UI already approved through the normal 09a/09h
    /// dirty flow. The real host answers `settle_dirty` by asking the UI and
    /// cancelling the synchronous close, then calls this method after the
    /// user chose Save or Don't save. A cancelled decision never gets here.
    pub fn confirmed(&self, reason: CloseReason) -> Result<CloseDecision, String> {
        let (visible, enabled) = {
            let machine = self.lock()?;
            match machine.state {
                ResidentState::Visible | ResidentState::Resident => {}
                _ => return Err(busy()),
            }
            (machine.state == ResidentState::Visible, machine.enabled)
        };
        if self.host.has_pending_foreground_choice() {
            return Ok(CloseDecision::KeepVisible);
        }
        if reason == CloseReason::TurnOff && visible {
            let had_start_with_windows = {
                let mut machine = self.lock()?;
                let had = machine.start_with_windows;
                machine.enabled = false;
                machine.start_with_windows = false;
                had
            };
            if had_start_with_windows && self.host.set_start_with_windows(false).is_err() {
                return Err("resident.failed".to_string());
            }
            return Ok(CloseDecision::KeepVisible);
        }

        match reason {
            CloseReason::WindowClose if enabled => {
                self.host
                    .release_heavy_resources()
                    .and_then(|_| self.host.retain_explicit_background())
                    .and_then(|_| self.host.hide_main_window())?;
                self.set_state(ResidentState::Resident)?;
                Ok(CloseDecision::Hide)
            }
            _ => {
                self.set_state(ResidentState::Quitting)?;
                if let Err(error) = self.host.quit_app() {
                    self.reset_to(if enabled {
                        ResidentState::Resident
                    } else {
                        ResidentState::Visible
                    });
                    return Err(error);
                }
                Ok(CloseDecision::Exit)
            }
        }
    }

    /// Turn off "Stay in background". From the resident shell this asks the
    /// dirty question and then exits the background copy. From a visible
    /// window it only disables future hiding.
    pub fn turn_off(&self) -> Result<bool, String> {
        {
            let mut machine = self.lock()?;
            let state = machine.state;
            match state {
                ResidentState::Visible => {
                    let had_start_with_windows = machine.start_with_windows;
                    drop(machine);
                    if had_start_with_windows && self.host.set_start_with_windows(false).is_err() {
                        return Err("resident.failed".to_string());
                    }
                    let mut machine = self.lock()?;
                    machine.enabled = false;
                    machine.start_with_windows = false;
                    return Ok(false);
                }
                ResidentState::Resident => {
                    machine.state = ResidentState::ClosingDecision;
                    machine.resume = Some(ResidentState::Resident);
                }
                _ => return Err(busy()),
            }
        }
        if self.host.has_pending_foreground_choice() {
            self.reset_to(ResidentState::Resident);
            return Err(busy());
        }
        let approved = match self.host.settle_dirty(CloseReason::TurnOff) {
            Ok(approved) => approved,
            Err(error) => {
                self.reset_to(ResidentState::Resident);
                return Err(error);
            }
        };
        if !approved {
            self.resume_after_cancel()?;
            return Ok(false);
        }
        self.set_state(ResidentState::Quitting)?;
        if let Err(error) = self.host.quit_app() {
            self.reset_to(ResidentState::Resident);
            return Err(error);
        }
        Ok(true)
    }

    /// Quit from the tray. It cannot discard unsaved changes: a cancelled
    /// decision leaves the current state untouched.
    pub fn quit(&self) -> Result<bool, String> {
        let resume = {
            let machine = self.lock()?;
            match machine.state {
                ResidentState::Visible => ResidentState::Visible,
                ResidentState::Resident => ResidentState::Resident,
                _ => return Err(busy()),
            }
        };
        {
            let mut machine = self.lock()?;
            machine.state = ResidentState::ClosingDecision;
            machine.resume = Some(resume);
        }
        if self.host.has_pending_foreground_choice() {
            self.reset_to(resume);
            return Err(busy());
        }
        let approved = match self.host.settle_dirty(CloseReason::Quit) {
            Ok(approved) => approved,
            Err(error) => {
                self.reset_to(resume);
                return Err(error);
            }
        };
        if !approved {
            self.reset_to(resume);
            return Ok(false);
        }
        self.set_state(ResidentState::Quitting)?;
        if let Err(error) = self.host.quit_app() {
            self.reset_to(resume);
            return Err(error);
        }
        Ok(true)
    }

    /// Show the window from the tray or a double click, without opening files.
    pub fn restore_window(&self) -> Result<(), String> {
        {
            let mut machine = self.lock()?;
            match machine.state {
                ResidentState::Resident => machine.state = ResidentState::Restoring,
                ResidentState::Visible => return Ok(()),
                _ => return Err(busy()),
            }
        }
        if let Err(error) = self.host.show_main_window() {
            self.reset_to(ResidentState::Resident);
            return Err(error);
        }
        self.set_state(ResidentState::Visible)?;
        Ok(())
    }

    /// Incoming activation: from the resident shell, show the one window
    /// first and then hand the request to the normal 09c pipeline.
    pub fn activate_ticket(&self, ticket: ActivationTicket) -> Result<(), String> {
        {
            let mut machine = self.lock()?;
            let state = machine.state;
            match state {
                ResidentState::Resident => machine.state = ResidentState::Restoring,
                ResidentState::Visible => {
                    drop(machine);
                    return self.host.forward_activation(&ticket);
                }
                _ => return Err(busy()),
            }
        }
        if self.host.window_count() > 1 {
            self.reset_to(ResidentState::Resident);
            return Err("resident.failed".to_string());
        }
        if let Err(error) = self.host.show_main_window() {
            self.reset_to(ResidentState::Resident);
            return Err(error);
        }
        if let Err(error) = self.host.forward_activation(&ticket) {
            self.reset_to(ResidentState::Visible);
            return Err(error);
        }
        self.set_state(ResidentState::Visible)?;
        Ok(())
    }

    /// `--background` startup: the window was created hidden and the runtime
    /// starts in the resident state without asking a dirty question (there
    /// are no documents yet). It never enables a background task.
    pub fn mark_started_resident(&self) -> Result<(), String> {
        let mut machine = self.lock()?;
        if machine.state != ResidentState::Visible {
            return Err(busy());
        }
        // `--background` cannot keep a copy the user did not opt into; a
        // stale Run value must fall back to a normal visible start.
        if !machine.enabled {
            return Err("resident.failed".to_string());
        }
        machine.state = ResidentState::Resident;
        Ok(())
    }

    /// Change the two startup choices. Only legal while visible; the
    /// start-with-Windows choice is written before the flags change.
    pub fn set_mode(&self, enabled: bool, start_with_windows: bool) -> Result<(), String> {
        let start_with_windows = start_with_windows && enabled;
        {
            let machine = self.lock()?;
            if machine.state != ResidentState::Visible {
                return Err(busy());
            }
        }
        if self.host.set_start_with_windows(start_with_windows).is_err() {
            return Err("resident.failed".to_string());
        }
        let mut machine = self.lock()?;
        machine.enabled = enabled;
        machine.start_with_windows = start_with_windows;
        Ok(())
    }
}

/// The policy the coordinator applies when the shell becomes resident.
/// Residency releases engines and never adds a background task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResidentPolicy {
    pub release_engine_resources: bool,
    pub keep_background_tasks: bool,
}

pub fn resident_policy(state: ResidentState) -> ResidentPolicy {
    ResidentPolicy {
        release_engine_resources: state == ResidentState::Resident,
        keep_background_tasks: true,
    }
}

#[cfg(test)]
#[path = "resident_step16_tests.rs"]
mod step16_tests;

