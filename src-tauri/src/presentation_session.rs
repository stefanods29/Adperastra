//! One live audience presentation (Step 22a T7).
//!
//! The worker owns the one helper session, the engine binding and at most two
//! rendered-frame leases. It polls the audience at most once per 16 ms while
//! idle, applies only typed navigation through the main-owned binding, and
//! closes the helper and releases retained frames on end/cancel/display loss.
//! It never reads notes and never sends them to the audience.
#![allow(dead_code)]


use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::presentation::{
    BindingPresentationFrame, PresentationDeckInfo, PresentationEngine, PresentationIntent,
    PresentationRequest, PresentationState,
};
use crate::presentation_displays::DisplayChoice;
use crate::presentation_helper_types::{
    PresentationAudienceEnd, PresentationAudienceFrame, PresentationFrameAck,
    PresentationIntentReply, PresentationWaitIntentRequest,
};
use crate::presentation_inputs::{prepare_audience_frame_input, FrameLeaseTracker};
use crate::webview_helper::start_webview_helper;
use crate::webview_helper_types::{
    HelperAction, HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind,
    WebviewHelperRequest,
};

#[path = "presentation_worker.rs"]
mod worker;

const IDLE_POLL: Duration = Duration::from_millis(16);
const WAIT_SLEEP: Duration = Duration::from_millis(8);
const START_TIMEOUT: Duration = Duration::from_secs(10);
const DISPLAY_RECHECK_EVERY: u32 = 30;

enum SessionCommand {
    Navigate(PresentationIntent, SyncSender<Result<PresentationState, String>>),
    End(SyncSender<()>),
}

/// The main window's handle on one presentation.
pub struct PresentationSessionHandle {
    presentation_id: Uuid,
    session_id: Uuid,
    state: Arc<Mutex<PresentationState>>,
    sender: Sender<SessionCommand>,
    join: Arc<Mutex<Option<JoinHandle<()>>>>,
    cancel: fs_service::CancellationToken,
    started: Arc<AtomicBool>,
    start_error: Arc<Mutex<Option<String>>>,
}

impl PresentationSessionHandle {
    pub fn presentation_id(&self) -> Uuid {
        self.presentation_id
    }

    pub fn session_id(&self) -> Uuid {
        self.session_id
    }

    pub fn state(&self) -> Result<PresentationState, String> {
        self.state
            .lock()
            .map_err(|_| "presentation.failed".to_string())
            .map(|state| state.clone())
    }

    pub fn wait_started(&self) -> Result<PresentationState, String> {
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            if let Ok(error) = self.start_error.lock() {
                if let Some(code) = error.clone() {
                    return Err(code);
                }
            }
            if self.started.load(Ordering::Relaxed) {
                return self.state();
            }
            if Instant::now() >= deadline {
                return Err("presentation.failed".to_string());
            }
            std::thread::sleep(WAIT_SLEEP);
        }
    }

    pub fn navigate(&self, intent: PresentationIntent) -> Result<PresentationState, String> {
        let (send, receive) = mpsc::sync_channel(1);
        self.sender
            .send(SessionCommand::Navigate(intent, send))
            .map_err(|_| "presentation.invalid".to_string())?;
        receive
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "presentation.failed".to_string())?
    }

    pub fn end(&self) -> Result<(), String> {
        let (send, receive) = mpsc::sync_channel(1);
        self.sender
            .send(SessionCommand::End(send))
            .map_err(|_| "presentation.invalid".to_string())?;
        let _ = receive.recv_timeout(Duration::from_secs(2));
        self.cancel.store(true, Ordering::Relaxed);
        if let Ok(mut join) = self.join.lock() {
            if let Some(handle) = join.take() {
                let _ = handle.join();
            }
        }
        Ok(())
    }
}

impl Drop for PresentationSessionHandle {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

/// Sensitive frames require the 07d private-profile proof first; this helper
/// is pure so the preflight order can be tested without a WebView.
pub fn sensitive_frame_allowed(private_profile: bool, sensitive: bool) -> bool {
    !sensitive || private_profile
}

/// A reply sequence is applied once; an older or repeated sequence is stale.
pub fn intent_is_new(sequence: u64, last_applied: u64) -> bool {
    sequence > last_applied
}

pub struct PresentationSession;

impl PresentationSession {
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        engine: Arc<dyn PresentationEngine>,
        presentation_id: Uuid,
        session_id: Uuid,
        request: PresentationRequest,
        deck: PresentationDeckInfo,
        display: DisplayChoice,
        app: AppHandle,
        data_dir: PathBuf,
    ) -> Result<PresentationSessionHandle, String> {
        let cancel = fs_service::new_cancellation_token();
        let config = WebviewHelperConfig {
            kind: WebviewHelperKind::Presentation,
            entry: WebviewHelperKind::Presentation.entry(),
            max_body_bytes: 1024 * 1024,
            max_output_bytes: 8 * 1024 * 1024,
            data_dir,
            placement: HelperWindowPlacement::Audience {
                display_id: display.id.clone(),
                rect: display.as_placement_rect(),
            },
        };
        // The child starts with no inputs: the first frame grant is minted
        // only after the private-profile ready gate and the binding frame.
        let helper = start_webview_helper(config, Vec::new(), cancel.clone())?;
        let slide_index = deck.visible_index(request.slide_id).unwrap_or(0);
        let state = PresentationState {
            presentation_id,
            session_id,
            slide_id: request.slide_id,
            slide_index,
            slide_count: deck.visible().len() as u32,
            step_index: 0,
            elapsed_ms: 0,
            paused: false,
            black: false,
            ended: false,
            output_display_id: display.id.clone(),
        };
        let state = Arc::new(Mutex::new(state));
        let started = Arc::new(AtomicBool::new(false));
        let start_error = Arc::new(Mutex::new(None));
        let (sender, receiver) = mpsc::channel();
        let worker_state = state.clone();
        let worker_started = started.clone();
        let worker_error = start_error.clone();
        let worker_cancel = cancel.clone();
        let join = std::thread::Builder::new()
            .name("presentation-session".to_string())
            .spawn(move || {
                let result = worker::run_session(
                    engine, presentation_id, session_id, request, deck, display, app, helper,
                    worker_state.clone(), receiver, worker_cancel,
                );
                if let Err(code) = result {
                    if let Ok(mut error) = worker_error.lock() {
                        if error.is_none() {
                            *error = Some(code);
                        }
                    }
                    if let Ok(mut state) = worker_state.lock() {
                        state.ended = true;
                    }
                }
                worker_started.store(true, Ordering::Relaxed);
            })
            .map_err(|_| "presentation.failed".to_string())?;
        Ok(PresentationSessionHandle {
            presentation_id,
            session_id,
            state,
            sender,
            join: Arc::new(Mutex::new(Some(join))),
            cancel,
            started,
            start_error,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elapsed_excludes_paused_interval() {
        let start = Instant::now() - Duration::from_secs(10);
        let paused = Duration::from_secs(3);
        let value = worker::elapsed_ms(start, paused, None);
        assert!((6_500..=7_500).contains(&value), "got {value}");
    }

    #[test]
    fn first_visible_slide_is_not_hidden() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let mut hidden = std::collections::HashSet::new();
        hidden.insert(a);
        let deck = PresentationDeckInfo { slide_ids: vec![a, b], hidden };
        assert_eq!(deck.first_visible(), Some(b));
        assert_eq!(deck.visible_index(b), Some(0));
        assert_eq!(deck.visible_index(a), None);
    }
}
