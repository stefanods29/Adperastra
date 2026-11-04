//! Startup wiring for AI actions (`ai-actions-1` E1).
//!
//! One capability source reads the live settings. This build has no verified
//! action executor yet, so every row stays typed unavailable instead of
//! pretending an action can run; local AI pack probes are asynchronous and
//! must not hash helper binaries on the command thread. The active profile
//! scope is set here because every retained result and transcript is
//! profile-bound.

use ai_runtime::AiTaskKind;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::ai_action_types::AiActionsSettings;
use crate::ai_actions::{
    install_capability_source, set_active_profile, AiActionCapabilitySource, AiCapabilityRow,
};

/// `default` is not a UUID; this fixed scope keeps the legacy profile bound
/// to one in-process id without inventing a second on-disk profile.
const DEFAULT_PROFILE_SCOPE: u128 = 0x0ad9_e4a5_7b31_4c0e_9a6a_6d2c_3f1b_8e40;

const LOCAL_ROWS: [(&str, AiTaskKind); 4] = [
    ("ai.foreground_mask", AiTaskKind::ForegroundMask),
    ("ai.inpaint", AiTaskKind::Inpaint),
    ("ai.transcribe", AiTaskKind::Transcribe),
    ("ai.upscale", AiTaskKind::Upscale),
];

const ASSISTANT_ROWS: [&str; 2] = ["assistant.structured_text", "assistant.vision_answer"];

struct LocalCapabilitySource {
    app: AppHandle,
}

impl LocalCapabilitySource {
    fn settings_snapshot(&self) -> Option<crate::Settings> {
        let state = self.app.try_state::<crate::AppState>()?;
        let settings = state.settings.lock().ok()?;
        Some(settings.clone())
    }
}

impl AiActionCapabilitySource for LocalCapabilitySource {
    fn rows(&self) -> Vec<AiCapabilityRow> {
        let Some(settings) = self.settings_snapshot() else {
            return settings_free_rows("unavailable");
        };
        rows_for(&settings)
    }

    fn settings(&self) -> AiActionsSettings {
        self.settings_snapshot()
            .map(|settings| settings.ai_actions)
            .unwrap_or_default()
    }
}

fn row(capability: &str, reason: &str, pack_id: Option<String>) -> AiCapabilityRow {
    AiCapabilityRow {
        id: capability.to_string(),
        available: false,
        reason: Some(reason.to_string()),
        pack_id,
    }
}

fn rows_for(settings: &crate::Settings) -> Vec<AiCapabilityRow> {
    let mut rows = Vec::with_capacity(LOCAL_ROWS.len() + ASSISTANT_ROWS.len());
    for (capability, task) in LOCAL_ROWS {
        let enabled = settings.local_ai.enabled
            && settings.local_ai.tasks.get(&task).copied().unwrap_or(false);
        // No verified action executor is installed in this build, so a
        // disabled preference and a missing adapter are both fail-closed.
        let reason = if enabled { "unsupported" } else { "disabled" };
        rows.push(row(capability, reason, None));
    }
    for capability in ASSISTANT_ROWS {
        let reason = if settings.assistant.enabled { "unsupported" } else { "disabled" };
        rows.push(row(capability, reason, None));
    }
    rows
}

fn settings_free_rows(reason: &str) -> Vec<AiCapabilityRow> {
    LOCAL_ROWS
        .iter()
        .map(|(capability, _)| row(capability, reason, None))
        .chain(ASSISTANT_ROWS.iter().map(|capability| row(capability, reason, None)))
        .collect()
}

fn profile_scope(profile_id: &str) -> Uuid {
    Uuid::parse_str(profile_id).unwrap_or_else(|_| Uuid::from_u128(DEFAULT_PROFILE_SCOPE))
}

/// Installs the one capability source and sets the active profile scope.
pub fn install(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    set_active_profile(profile_scope(profile_id));
    install_capability_source(Box::new(LocalCapabilitySource { app: app.clone() }))
}
