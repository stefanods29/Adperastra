//! The app shell's `ResidentHost` (Step 16, coordinator-owned wiring).
//!
//! `resident_state.rs` owns the dirty-safe state machine and `resident.rs`
//! owns the commands; this module is the one place that gives the state
//! machine the real single main window, the integration registry and the
//! background policy. The coordinator's synchronous close path never blocks
//! on a dialog: it shows and focuses the window and emits
//! `resident-close-requested`, then the UI runs the existing 09a/09h dirty
//! flow and calls `resident_close_confirmed`. A cancelled decision therefore
//! leaves the window and every tab exactly as they were.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::resident_state::{ActivationTicket, CloseReason, ResidentHost};

/// The UI listener that runs the normal dirty flow for a resident close.
pub const CLOSE_REQUESTED_EVENT: &str = "resident-close-requested";

#[derive(Clone, serde::Serialize)]
struct CloseRequestedPayload {
    reason: &'static str,
}

fn failed() -> String {
    "resident.failed".to_string()
}

fn reason_code(reason: CloseReason) -> &'static str {
    match reason {
        CloseReason::WindowClose => "close",
        CloseReason::TurnOff => "turn_off",
        CloseReason::Quit => "quit",
    }
}

/// The one host for the app's `main` window. It never creates a window and
/// never writes a document; every method is a thin adapter over an existing
/// public service.
#[derive(Clone)]
pub struct AppResidentHost {
    app: AppHandle,
    /// Shared with `ResidentRuntime`: a foreground job waiting for a choice.
    active_jobs: Arc<AtomicU32>,
}

impl AppResidentHost {
    pub fn new(app: AppHandle, active_jobs: Arc<AtomicU32>) -> Self {
        Self { app, active_jobs }
    }

    fn main_window(&self) -> Result<tauri::WebviewWindow, String> {
        self.app.get_webview_window("main").ok_or_else(failed)
    }
}

impl ResidentHost for AppResidentHost {
    fn settle_dirty(&self, reason: CloseReason) -> Result<bool, String> {
        // A hidden prompt would lose the visible context: show the single
        // window before the UI asks the normal dirty question.
        self.show_main_window()?;
        self.app
            .emit(
                CLOSE_REQUESTED_EVENT,
                CloseRequestedPayload {
                    reason: reason_code(reason),
                },
            )
            .map_err(|_| failed())?;
        // The UI answers asynchronously through `resident_close_confirmed`;
        // the synchronous close always keeps the window until then.
        Ok(false)
    }

    fn has_pending_foreground_choice(&self) -> bool {
        // No central job table exposes its "waiting for choice" count yet;
        // the shared counter is updated by the coordinator once that table
        // exists. Until then nothing is treated as pending.
        self.active_jobs.load(Ordering::Relaxed) > 0
    }

    fn hide_main_window(&self) -> Result<(), String> {
        self.main_window()?.hide().map_err(|_| failed())
    }

    fn show_main_window(&self) -> Result<(), String> {
        let window = self.main_window()?;
        let _ = window.unminimize();
        window.show().map_err(|_| failed())?;
        let _ = window.set_focus();
        Ok(())
    }

    fn release_heavy_resources(&self) -> Result<(), String> {
        // The document controllers, parser/engine sessions and read leases
        // belong to open tabs and have no app-wide "release" entry point
        // yet. Hiding keeps them alive, so residency is memory-heavier than
        // the plan's target until that shared release API exists; nothing
        // is destroyed without the UI's own close path.
        Ok(())
    }

    fn retain_explicit_background(&self) -> Result<(), String> {
        // Read-only: residency never writes the 12a policy, so every task
        // the user enabled keeps its own setting and nothing is enabled by
        // becoming resident.
        if let Some(policy) = self
            .app
            .try_state::<Arc<crate::background::BackgroundPolicy>>()
        {
            let _ = policy.task_statuses();
        }
        Ok(())
    }

    fn forward_activation(&self, ticket: &ActivationTicket) -> Result<(), String> {
        let request = crate::activation::ActivationRequest {
            version: crate::activation::ACTIVATION_VERSION,
            request_id: ticket.request_id.clone(),
            paths: ticket.paths.clone(),
            sent_unix: crate::activation::now_unix(),
            intent: ticket.intent,
        };
        self.app
            .emit(crate::activation_pipe::ACTIVATION_OPEN_EVENT, request)
            .map_err(|_| failed())
    }

    fn set_start_with_windows(&self, enabled: bool) -> Result<(), String> {
        let integration = self
            .app
            .try_state::<crate::integration_commands::IntegrationState>()
            .ok_or_else(failed)?;
        integration.set_start_with_windows(enabled).map(|_| ())
    }

    fn quit_app(&self) -> Result<(), String> {
        self.app.exit(0);
        Ok(())
    }

    fn window_count(&self) -> u32 {
        self.app.get_webview_window("main").map_or(0, |_| 1)
    }
}
