//! Native presentation wrapper (Step 22a T7, office-deck-ui-1).
//!
//! The main window owns the engine, the audience window and the presenter
//! state. A presentation is started only on explicit user action, against a
//! live display chosen by the user. The audience helper receives rendered
//! frames and nothing else. No command here accepts a window handle, a
//! program path, a file path or an engine command string.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

use crate::ensure_main;
use crate::office_edit_values::OfficeBinaryLease;
use crate::presentation_displays::{list_displays, validate_display_choice};
use crate::presentation_session::{PresentationSession, PresentationSessionHandle};

/// One physical monitor rectangle in physical pixels. Negative origins are
/// valid and common (a second display to the left of the primary one).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationDisplay {
    /// Opaque device id, never sent to a shell or used as command text.
    pub id: String,
    pub name: String,
    pub rect: PresentationRect,
    pub primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationStart {
    First,
    Current,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationRequest {
    pub slide_id: Uuid,
    pub start_from: PresentationStart,
    pub output_display_id: String,
    pub presenter_display_id: Option<String>,
    pub show_presenter: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PresentationIntent {
    Next,
    Previous,
    First,
    Last,
    End,
    ToggleBlack,
    TogglePause,
    ResetTimer,
    GoTo { slide_id: Uuid },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationState {
    pub presentation_id: Uuid,
    pub session_id: Uuid,
    pub slide_id: Uuid,
    pub slide_index: u32,
    pub slide_count: u32,
    pub step_index: u32,
    pub elapsed_ms: u64,
    pub paused: bool,
    pub black: bool,
    pub ended: bool,
    pub output_display_id: String,
}

impl PresentationState {
    pub fn validate(&self) -> Result<(), String> {
        if self.slide_count > 0 && self.slide_index >= self.slide_count {
            return Err("presentation.invalid".to_string());
        }
        if self.output_display_id.is_empty() || self.output_display_id.len() > 128 {
            return Err("presentation.invalid".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingPresentation {
    pub id: Uuid,
    pub initial_slide_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct BindingPresentationFrame {
    pub slide_id: Uuid,
    pub step_index: u32,
    pub has_next_step: bool,
    pub image: OfficeBinaryLease,
    pub width: u32,
    pub height: u32,
    pub frame_revision: u32,
}

/// Visible slide order supplied by the main-owned 20a E6 slide item page.
#[derive(Debug, Clone, Default)]
pub struct PresentationDeckInfo {
    pub slide_ids: Vec<Uuid>,
    pub hidden: HashSet<Uuid>,
}

impl PresentationDeckInfo {
    pub fn visible(&self) -> Vec<Uuid> {
        self.slide_ids.iter().copied().filter(|id| !self.hidden.contains(id)).collect()
    }

    pub fn visible_index(&self, slide_id: Uuid) -> Option<u32> {
        self.visible().iter().position(|id| *id == slide_id).map(|index| index as u32)
    }

    pub fn first_visible(&self) -> Option<Uuid> {
        self.visible().first().copied()
    }
}

/// The small adapter the 20a binding owner registers once. Its methods are
/// the frozen E16 presentation methods; `presentation_deck` exposes the
/// already-authorized visible slide page to this main-owned wrapper.
pub trait PresentationEngine: Send + Sync {
    fn presentation_start(&self, session_id: Uuid, slide_id: Uuid) -> Result<BindingPresentation, String>;
    fn presentation_step(
        &self,
        binding_presentation_id: Uuid,
        intent: PresentationIntent,
    ) -> Result<BindingPresentationFrame, String>;
    fn presentation_end(&self, binding_presentation_id: Uuid) -> Result<(), String>;
    fn presentation_deck(&self, session_id: Uuid) -> Result<PresentationDeckInfo, String>;
}

/// One native registry; the engine adapter is registered by the coordinator
/// after the approved Office binding exists. Until then every start fails
/// with the existing `office_edit.engine_missing`, never a fake window.
pub struct PresentationRuntime {
    engine: Mutex<Option<Arc<dyn PresentationEngine>>>,
    sessions: Mutex<HashMap<Uuid, Arc<PresentationSessionHandle>>>,
    /// Start is two-phase: the worker needs its ownership check before the
    /// finished handle is inserted. A pending pair is valid only during that
    /// short start window and is removed on success or failure.
    pending: Mutex<HashMap<Uuid, Uuid>>,
}

impl PresentationRuntime {
    fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        }
    }

    fn begin_pending(&self, presentation_id: Uuid, session_id: Uuid) -> Result<(), String> {
        self.pending
            .lock()
            .map_err(|_| "presentation.failed".to_string())?
            .insert(presentation_id, session_id);
        Ok(())
    }

    fn clear_pending(&self, presentation_id: Uuid) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&presentation_id);
        }
    }

    pub fn set_engine(&self, engine: Arc<dyn PresentationEngine>) -> Result<(), String> {
        let mut slot = self.engine.lock().map_err(|_| "presentation.failed".to_string())?;
        if slot.is_some() {
            return Err("presentation.failed".to_string());
        }
        *slot = Some(engine);
        Ok(())
    }

    pub fn engine(&self) -> Result<Arc<dyn PresentationEngine>, String> {
        self.engine
            .lock()
            .map_err(|_| "presentation.failed".to_string())?
            .clone()
            .ok_or_else(|| "office_edit.engine_missing".to_string())
    }

    fn insert(&self, handle: PresentationSessionHandle) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "presentation.failed".to_string())?;
        if sessions.len() >= 4 {
            return Err("presentation.busy".to_string());
        }
        sessions.insert(handle.presentation_id(), Arc::new(handle));
        Ok(())
    }

    fn get_state(&self, id: Uuid) -> Result<PresentationState, String> {
        let sessions = self.sessions.lock().map_err(|_| "presentation.failed".to_string())?;
        let handle = sessions.get(&id).ok_or_else(|| "presentation.invalid".to_string())?;
        handle.state()
    }

    fn remove(&self, id: Uuid) -> Option<Arc<PresentationSessionHandle>> {
        self.sessions.lock().ok()?.remove(&id)
    }

    fn bound(&self, presentation_id: Uuid, session_id: Uuid) -> bool {
        let inserted = self
            .sessions
            .lock()
            .map(|sessions| sessions.get(&presentation_id).map(|handle| handle.session_id()) == Some(session_id))
            .unwrap_or(false);
        inserted
            || self
                .pending
                .lock()
                .map(|pending| pending.get(&presentation_id) == Some(&session_id))
                .unwrap_or(false)
    }
}

static RUNTIME: OnceLock<Arc<PresentationRuntime>> = OnceLock::new();

pub fn presentation_runtime() -> &'static Arc<PresentationRuntime> {
    RUNTIME.get_or_init(|| Arc::new(PresentationRuntime::new()))
}

/// Register the approved 20a binding adapter once.
pub fn register_presentation_engine(engine: Arc<dyn PresentationEngine>) -> Result<(), String> {
    presentation_runtime().set_engine(engine)
}

/// Native-only ownership check used by `presentation_inputs`: a frame's
/// Office lease is accepted only for the presentation this session owns.
pub fn presentation_binds_session(presentation_id: Uuid, session_id: Uuid) -> bool {
    presentation_runtime().bound(presentation_id, session_id)
}

#[tauri::command]
pub async fn office_presentation_displays(
    window: WebviewWindow,
) -> Result<Vec<PresentationDisplay>, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(list_displays)
        .await
        .map_err(|_| "presentation.failed".to_string())?
}

#[tauri::command]
pub async fn office_presentation_start(
    window: WebviewWindow,
    session_id: String,
    request: PresentationRequest,
) -> Result<PresentationState, String> {
    ensure_main(window.label())?;
    let session_id = Uuid::parse_str(&session_id).map_err(|_| "presentation.invalid".to_string())?;
    let engine = presentation_runtime().engine()?;
    let deck = engine.presentation_deck(session_id)?;
    if deck.visible().is_empty() {
        return Err("presentation.invalid".to_string());
    }
    if deck.hidden.contains(&request.slide_id) || !deck.slide_ids.contains(&request.slide_id) {
        return Err("presentation.invalid".to_string());
    }
    if request.start_from == PresentationStart::First && deck.first_visible() != Some(request.slide_id) {
        return Err("presentation.invalid".to_string());
    }
    let displays = list_displays()?;
    let output = validate_display_choice(&displays, &request.output_display_id, None)?;
    if let Some(presenter) = &request.presenter_display_id {
        validate_display_choice(&displays, presenter, None)?;
    }
    if request.show_presenter && request.presenter_display_id.as_deref() == Some(request.output_display_id.as_str()) {
        // The audience output and presenter view may not share one display
        // through this path; the main window is the only default presenter.
        return Err("presentation.invalid".to_string());
    }
    let presentation_id = Uuid::new_v4();
    let data_dir = crate::resolve_data_dir().join("presentation-helper");
    presentation_runtime().begin_pending(presentation_id, session_id)?;
    let handle = match PresentationSession::start(
        engine,
        presentation_id,
        session_id,
        request,
        deck,
        output,
        window.app_handle().clone(),
        data_dir,
    ) {
        Ok(handle) => handle,
        Err(error) => {
            presentation_runtime().clear_pending(presentation_id);
            return Err(error);
        }
    };
    let state = handle.state()?;
    if let Err(error) = presentation_runtime().insert(handle) {
        presentation_runtime().clear_pending(presentation_id);
        return Err(error);
    }
    presentation_runtime().clear_pending(presentation_id);
    Ok(state)
}

#[tauri::command]
pub async fn office_presentation_navigate(
    window: WebviewWindow,
    presentation_id: String,
    intent: PresentationIntent,
) -> Result<PresentationState, String> {
    ensure_main(window.label())?;
    let presentation_id = Uuid::parse_str(&presentation_id).map_err(|_| "presentation.invalid".to_string())?;
    if matches!(intent, PresentationIntent::GoTo { slide_id } if slide_id.is_nil()) {
        return Err("presentation.invalid".to_string());
    }
    let sessions = presentation_runtime();
    let state = sessions.get_state(presentation_id)?;
    if state.ended {
        return Err("presentation.invalid".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let handle = {
            let sessions = presentation_runtime().sessions.lock().map_err(|_| "presentation.failed".to_string())?;
            sessions.get(&presentation_id).cloned()
        };
        let Some(handle) = handle else { return Err("presentation.invalid".to_string()) };
        handle.navigate(intent)
    })
    .await
    .map_err(|_| "presentation.failed".to_string())?
}

#[tauri::command]
pub async fn office_presentation_end(
    window: WebviewWindow,
    presentation_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let presentation_id = Uuid::parse_str(&presentation_id).map_err(|_| "presentation.invalid".to_string())?;
    let Some(handle) = presentation_runtime().remove(presentation_id) else {
        // Duplicate end succeeds.
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || handle.end())
        .await
        .map_err(|_| "presentation.failed".to_string())?
}
