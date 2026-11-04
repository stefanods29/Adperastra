//! Assistant history commands and settings migration (Step 17a T7).
//!
//! History is disabled by default and lives in an encrypted profile store.
//! Clear removes only owned history files; it never touches a user file.
//! Settings schema 43 migrates to 44 with Local AI as the backend.
#![allow(dead_code)]


use serde_json::Value;
use tauri::{State, WebviewWindow};

use crate::assistant_history_store::HistoryStore;
use crate::assistant_types::{AssistantConversation, AssistantSettings};
use crate::{ensure_main, validate_absolute_path};

#[tauri::command]
pub async fn assistant_history_list(
    window: WebviewWindow,
    store: State<'_, HistoryStore>,
) -> Result<Vec<AssistantConversation>, String> {
    ensure_main(window.label())?;
    store.load_all()
}

#[tauri::command]
pub async fn assistant_history_clear(
    window: WebviewWindow,
    store: State<'_, HistoryStore>,
) -> Result<u32, String> {
    ensure_main(window.label())?;
    store.clear().map(|removed| removed as u32)
}

#[tauri::command]
pub async fn assistant_history_export(
    window: WebviewWindow,
    store: State<'_, HistoryStore>,
    dest_path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_absolute_path(&dest_path)?;
    store.export(std::path::Path::new(&dest_path)).map(|_| ())
}

/// Schema 43 has no assistant block; schema 44 adds it with Local AI first.
pub fn migrate_assistant_settings(value: &Value, from_schema: u32) -> AssistantSettings {
    if from_schema < 44 {
        return AssistantSettings::default();
    }
    value
        .get("assistant")
        .and_then(|assistant| serde_json::from_value::<AssistantSettings>(assistant.clone()).ok())
        .filter(|settings| settings.validate().is_ok())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "assistant_history_step17a_tests.rs"]
mod step17a_tests;
