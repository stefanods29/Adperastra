//! AI-action commands (`ai-actions-1` E1/E2).
//!
//! A command validates the request and the installed/tested capability before
//! any work starts, then runs as one cancellable shared job. Model work is
//! only performed by a producer adapter installed by the coordinator; when no
//! verified adapter is present the action fails with `ai_actions.failed`
//! instead of reporting a fake suggestion.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::ai_action_results::{AiActionResult, AiActionResultStore};
use crate::ai_action_types::{
    self, AiActionId, AiActionRequest, AiActionsSettings, ERR_FAILED, ERR_INVALID, ERR_NO_SOURCES,
    ERR_SOURCE_CHANGED, ERR_UNSUPPORTED,
};
use crate::jobs::{spawn_job, Jobs};

/// One capability row: a 14c task id or a 17a backend id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiCapabilityRow {
    pub id: String,
    pub available: bool,
    pub reason: Option<String>,
    pub pack_id: Option<String>,
}

/// The app's capability source, installed once by the coordinator wiring.
pub trait AiActionCapabilitySource: Send + Sync {
    fn rows(&self) -> Vec<AiCapabilityRow>;
    fn settings(&self) -> AiActionsSettings;
}

static CAPABILITY_SOURCE: OnceLock<Box<dyn AiActionCapabilitySource>> = OnceLock::new();
static ACTIVE_PROFILE: OnceLock<std::sync::Mutex<Option<Uuid>>> = OnceLock::new();

fn profile_slot() -> &'static std::sync::Mutex<Option<Uuid>> {
    ACTIVE_PROFILE.get_or_init(|| std::sync::Mutex::new(None))
}

/// The coordinator sets this on profile open/change; a change invalidates
/// every previously issued result for the old profile.
pub fn set_active_profile(profile: Uuid) {
    if let Ok(mut slot) = profile_slot().lock() {
        *slot = Some(profile);
    }
}

pub fn active_profile() -> Result<Uuid, String> {
    profile_slot()
        .lock()
        .map_err(|_| "ai_actions profile lock poisoned".to_string())?
        .ok_or_else(|| ERR_FAILED.to_string())
}

pub fn install_capability_source(source: Box<dyn AiActionCapabilitySource>) -> Result<(), String> {
    CAPABILITY_SOURCE
        .set(source)
        .map(|_| ())
        .map_err(|_| "ai_actions capabilities already installed".to_string())
}

pub fn capability_rows() -> Vec<AiCapabilityRow> {
    CAPABILITY_SOURCE.get().map(|source| source.rows()).unwrap_or_default()
}

pub fn action_settings() -> AiActionsSettings {
    CAPABILITY_SOURCE
        .get()
        .map(|source| source.settings())
        .unwrap_or_default()
}

fn row_for<'a>(capability: &str, rows: &'a [AiCapabilityRow]) -> Option<&'a AiCapabilityRow> {
    rows.iter().find(|row| row.id == capability)
}

/// Why the action cannot run now; `None` means every required row passed.
pub fn capability_error(
    action: AiActionId,
    settings: &AiActionsSettings,
    rows: &[AiCapabilityRow],
) -> Option<String> {
    if action == AiActionId::CopyText {
        // 07e owns OCR; it never needs an AI pack or a model.
        return None;
    }
    if !settings.is_enabled(action) {
        return Some("disabled".to_string());
    }
    for capability in action.required_capabilities() {
        match row_for(capability, rows) {
            None => return Some("unavailable".to_string()),
            Some(row) if !row.available => {
                return Some(row.reason.clone().unwrap_or_else(|| "unavailable".to_string()))
            }
            Some(_) => {}
        }
    }
    None
}

/// A model adapter installed by the coordinator, e.g. 14c's helper process.
pub trait AiActionExecutor: Send + Sync {
    fn execute(&self, request: &AiActionRequest) -> Result<AiActionResult, String>;
}

static EXECUTOR: OnceLock<Box<dyn AiActionExecutor>> = OnceLock::new();

pub fn install_executor(executor: Box<dyn AiActionExecutor>) -> Result<(), String> {
    EXECUTOR
        .set(executor)
        .map(|_| ())
        .map_err(|_| "ai_actions executor already installed".to_string())
}

fn executor() -> Result<&'static dyn AiActionExecutor, String> {
    EXECUTOR.get().map(|boxed| boxed.as_ref()).ok_or_else(|| ERR_FAILED.to_string())
}

/// The exact inputs an action may read, for `prepareAiActionSources`.
pub fn request_input_ids(request: &AiActionRequest) -> Vec<Uuid> {
    request.inputs.iter().map(|input| input.id).collect()
}

/// Refuses a folder action whose approved list is empty.
pub fn check_folder_request(request: &AiActionRequest) -> Result<(), String> {
    if let ai_action_types::AiActionOptions::SummarizeFolder { approved_input_ids, .. } = &request.options {
        if approved_input_ids.is_empty() {
            return Err(ERR_NO_SOURCES.to_string());
        }
    }
    Ok(())
}

/// Validates one parsed request against the live capability state.
///
/// Source identity is checked by the executor that owns the immutable
/// artifact/document lease, because only it can read the captured revision.
pub fn prepare_start(
    request: &AiActionRequest,
    settings: &AiActionsSettings,
    rows: &[AiCapabilityRow],
) -> Result<(), String> {
    if capability_error(request.action, settings, rows).is_some() {
        return Err(ERR_UNSUPPORTED.to_string());
    }
    if request.action.local_only() && request.outbound_consent_id.is_some() {
        return Err(ERR_INVALID.to_string());
    }
    check_folder_request(request)
}

#[tauri::command]
pub async fn ai_action_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let parsed = ai_action_types::parse_request(&request)?;
    let settings = action_settings();
    let rows = capability_rows();
    prepare_start(&parsed, &settings, &rows)?;
    let token = jobs.begin(&request_id, 1)?;
    let profile = active_profile()?;
    spawn_job(app, request_id, token, move |_context| {
        let result = match executor() {
            Ok(runner) => runner.execute(&parsed),
            Err(code) => Err(code),
        }?;
        let store = result_store();
        let bytes = serde_json::to_vec(&result).map(|bytes| bytes.len() as u64).unwrap_or(u64::MAX);
        store.insert(result.clone(), profile, bytes)?;
        serde_json::to_value(&result).map_err(|_| ERR_FAILED.to_string())
    });
    Ok(())
}

/// One retained erase mask; pixels never cross IPC as megabytes (P-10).
struct MaskRecord {
    width: u32,
    height: u32,
    mask: crate::ai_mask::SoftMask,
    expected_content_id: Option<Uuid>,
    profile_id: Uuid,
}

pub const MAX_RETAINED_MASKS: usize = 16;
pub const MASK_IDLE_EXPIRY: std::time::Duration = std::time::Duration::from_secs(300);

static MASKS: OnceLock<std::sync::Mutex<Vec<(Uuid, std::time::Instant, MaskRecord)>>> = OnceLock::new();

fn mask_slot() -> &'static std::sync::Mutex<Vec<(Uuid, std::time::Instant, MaskRecord)>> {
    MASKS.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn parse_mask_spec(value: &Value) -> Result<crate::ai_mask::MaskSpec, String> {
    use crate::ai_mask::{BrushSegment, MaskRect, MaskSpec, ERR_INVALID};
    let Some(object) = value.as_object() else {
        return Err(ERR_INVALID.to_string());
    };
    let number = |key: &str| -> Result<i64, String> {
        object
            .get(key)
            .and_then(Value::as_i64)
            .ok_or_else(|| ERR_INVALID.to_string())
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("rect") => {
            let x = number("x")?;
            let y = number("y")?;
            let width = number("width")?;
            let height = number("height")?;
            if x < 0 || y < 0 || width < 1 || height < 1 {
                return Err(ERR_INVALID.to_string());
            }
            Ok(MaskSpec::Rect(MaskRect {
                x: x as u32,
                y: y as u32,
                width: width as u32,
                height: height as u32,
            }))
        }
        Some("strokes") => {
            let Some(Value::Array(items)) = object.get("strokes") else {
                return Err(ERR_INVALID.to_string());
            };
            if items.is_empty() || items.len() > 4_096 {
                return Err("ai_actions.empty_mask".to_string());
            }
            let mut strokes = Vec::with_capacity(items.len());
            for item in items {
                let Some(stroke) = item.as_object() else {
                    return Err(ERR_INVALID.to_string());
                };
                let field = |key: &str| -> Result<i64, String> {
                    stroke
                        .get(key)
                        .and_then(Value::as_i64)
                        .ok_or_else(|| ERR_INVALID.to_string())
                };
                let radius = field("radius")?;
                if !(1..=256).contains(&radius) {
                    return Err(ERR_INVALID.to_string());
                }
                strokes.push(BrushSegment {
                    x0: field("x0")?.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
                    y0: field("y0")?.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
                    x1: field("x1")?.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
                    y1: field("y1")?.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
                    radius: radius as u32,
                });
            }
            Ok(MaskSpec::Strokes(strokes))
        }
        _ => Err(ERR_INVALID.to_string()),
    }
}

#[tauri::command]
pub fn ai_mask_artifact_create(
    window: WebviewWindow,
    width: u32,
    height: u32,
    spec: Value,
    expected_content_id: Option<String>,
) -> Result<Value, String> {
    crate::ensure_main(window.label())?;
    crate::ai_mask::validate_source_size(width, height, 0)?;
    crate::ai_inpaint::validate_inpaint_size(width, height)?;
    let parsed = parse_mask_spec(&spec)?;
    let mask = crate::ai_mask::mask_from_spec(width, height, &parsed)?;
    let expected = match expected_content_id {
        Some(text) => Some(Uuid::parse_str(&text).map_err(|_| ERR_INVALID.to_string())?),
        None => None,
    };
    let profile = active_profile()?;
    let id = Uuid::new_v4();
    let mut slot = mask_slot().lock().map_err(|_| "ai_actions mask lock poisoned".to_string())?;
    slot.retain(|(_, created, _)| created.elapsed() <= MASK_IDLE_EXPIRY);
    if slot.len() >= MAX_RETAINED_MASKS {
        slot.remove(0);
    }
    slot.push((
        id,
        std::time::Instant::now(),
        MaskRecord { width, height, mask, expected_content_id: expected, profile_id: profile },
    ));
    Ok(serde_json::json!({ "mask_artifact_id": id }))
}

/// Resolves one mask for the inpaint executor; refuses another profile.
pub fn take_mask(id: Uuid, profile: Uuid) -> Result<(u32, u32, crate::ai_mask::SoftMask, Option<Uuid>), String> {
    let slot = mask_slot().lock().map_err(|_| "ai_actions mask lock poisoned".to_string())?;
    let Some((_, created, record)) = slot.iter().find(|(candidate, _, _)| *candidate == id) else {
        return Err(ERR_SOURCE_CHANGED.to_string());
    };
    if created.elapsed() > MASK_IDLE_EXPIRY || record.profile_id != profile {
        return Err(ERR_SOURCE_CHANGED.to_string());
    }
    Ok((record.width, record.height, record.mask.clone(), record.expected_content_id))
}

/// The process-wide result store; the coordinator may seed it at startup.
pub static ACTION_RESULTS: OnceLock<AiActionResultStore> = OnceLock::new();

pub fn result_store() -> &'static AiActionResultStore {
    ACTION_RESULTS.get_or_init(AiActionResultStore::new)
}

#[tauri::command]
pub fn ai_action_result(window: WebviewWindow, id: String) -> Result<AiActionResult, String> {
    crate::ensure_main(window.label())?;
    let parsed = Uuid::parse_str(&id).map_err(|_| ERR_INVALID.to_string())?;
    result_store().get(parsed, active_profile()?)
}

#[tauri::command]
pub fn ai_action_result_release(window: WebviewWindow, id: String) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let parsed = Uuid::parse_str(&id).map_err(|_| ERR_INVALID.to_string())?;
    result_store().close(parsed, active_profile()?)
}

/// The owning UI may read a result only while its tab is open.
pub fn read_for_tab(id: Uuid) -> Result<AiActionResult, String> {
    result_store().acquire(id, active_profile()?)
}

pub fn release_for_tab(id: Uuid) {
    result_store().release_lease(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_action_types::AiActionsSettings;

    fn rows_available(capability: &str) -> Vec<AiCapabilityRow> {
        vec![AiCapabilityRow {
            id: capability.to_string(),
            available: true,
            reason: None,
            pack_id: Some("ai_foreground".to_string()),
        }]
    }

    fn enabled(action: AiActionId) -> AiActionsSettings {
        let mut settings = AiActionsSettings::default();
        settings.enabled.insert(action.as_str().to_string(), true);
        settings
    }

    #[test]
    fn missing_pack_is_reported_before_work() {
        let action = AiActionId::RemoveBackground;
        let error = capability_error(action, &enabled(action), &[]).unwrap();
        assert_eq!(error, "unavailable");
    }

    #[test]
    fn installed_and_tested_capability_enables_action() {
        let action = AiActionId::RemoveBackground;
        assert!(capability_error(action, &enabled(action), &rows_available("ai.foreground_mask")).is_none());
    }

    #[test]
    fn copy_text_never_needs_ai() {
        assert!(capability_error(AiActionId::CopyText, &AiActionsSettings::default(), &[]).is_none());
    }

    #[test]
    fn disabled_preference_keeps_action_off() {
        let action = AiActionId::Summarize;
        let error = capability_error(
            action,
            &AiActionsSettings::default(),
            &rows_available("assistant.structured_text"),
        );
        assert_eq!(error.as_deref(), Some("disabled"));
    }
}
