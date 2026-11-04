//! `.adp-deck-style` import/export (Step 22b T5, D9).
//!
//! A style file is small normalized JSON, never a ZIP/XML parser in the main
//! UI. Import reads one authorized `ConversionInput` through the registered
//! 08a adapter; export publishes a new owned file and never replaces an
//! existing one.
#![allow(dead_code)]


use std::io::Write;
use std::path::Path;
use std::sync::{Arc, OnceLock, RwLock};

use convert::ConversionInput;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::deck_style_catalog::{catalog_path, load_catalog, lock_catalog};
use crate::deck_style_types::{
    invalid, too_large, validate_deck_style, DeckStyle, DeckStyleFile,
    DECK_STYLE_FILE_SCHEMA_VERSION, MAX_DECK_STYLE_BYTES,
};
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, resolve_data_dir, validate_absolute_path};

/// Read one authorized conversion input without inventing a second source
/// authority. The coordinator registers the 08a adapter.
pub trait DeckStyleInputHost: Send + Sync {
    fn read_conversion_input(&self, input: &ConversionInput, limit: u64) -> Result<Vec<u8>, String>;
}

static INPUT_HOST: OnceLock<RwLock<Option<Arc<dyn DeckStyleInputHost>>>> = OnceLock::new();

fn input_slot() -> &'static RwLock<Option<Arc<dyn DeckStyleInputHost>>> {
    INPUT_HOST.get_or_init(|| RwLock::new(None))
}

pub fn register_deck_style_input_host(host: Arc<dyn DeckStyleInputHost>) {
    if let Ok(mut slot) = input_slot().write() {
        *slot = Some(host);
    }
}

fn current_input_host() -> Result<Arc<dyn DeckStyleInputHost>, String> {
    input_slot()
        .read()
        .map_err(|_| "deck_style.failed".to_string())?
        .clone()
        .ok_or_else(|| "deck_style.unsupported".to_string())
}

fn check_request_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(invalid())
    }
}

/// Pure JSON boundary; no file I/O and no engine involvement.
pub fn parse_style_file(bytes: &[u8]) -> Result<DeckStyle, String> {
    if bytes.len() > MAX_DECK_STYLE_BYTES {
        return Err(too_large());
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let schema = value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(invalid)?;
    if schema > u64::from(DECK_STYLE_FILE_SCHEMA_VERSION) {
        return Err("deck_style.schema_newer".to_string());
    }
    if schema != u64::from(DECK_STYLE_FILE_SCHEMA_VERSION) {
        return Err(invalid());
    }
    let file: DeckStyleFile = serde_json::from_value(value).map_err(|_| invalid())?;
    if file.style.builtin || file.style.name_key.is_some() || file.style.name.is_none() {
        return Err(invalid());
    }
    validate_deck_style(&file.style)?;
    Ok(file.style)
}

pub fn serialize_style_file(style: &DeckStyle) -> Result<Vec<u8>, String> {
    if style.builtin || style.name_key.is_some() || style.name.is_none() {
        return Err(invalid());
    }
    validate_deck_style(style)?;
    let bytes = serde_json::to_vec(&DeckStyleFile {
        schema_version: DECK_STYLE_FILE_SCHEMA_VERSION,
        style: style.clone(),
    })
    .map_err(|_| invalid())?;
    if bytes.len() > MAX_DECK_STYLE_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

fn extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("adp-deck-style"))
}

/// Publish a new owned file; an existing destination is never replaced.
pub fn publish_new_style_file(dest_path: &str, bytes: &[u8]) -> Result<(), String> {
    validate_absolute_path(dest_path).map_err(|_| invalid())?;
    let target = Path::new(dest_path);
    if !extension_ok(target) {
        return Err(invalid());
    }
    let parent = target.parent().ok_or_else(invalid)?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(invalid)?;
    let directory =
        fs_service::owned_io::PinnedDirectory::open(parent).map_err(|_| "deck_style.failed".to_string())?;
    let mut output =
        fs_service::owned_io::OwnedOutput::create(&directory, name).map_err(|_| "deck_style.failed".to_string())?;
    output
        .file_mut()
        .write_all(bytes)
        .map_err(|_| "deck_style.failed".to_string())?;
    output.flush_sync().map_err(|_| "deck_style.failed".to_string())?;
    output
        .publish_name(name)
        .map_err(|_| "deck_style.failed".to_string())?;
    Ok(())
}

pub fn find_user_style(id: Uuid) -> Result<DeckStyle, String> {
    let _guard = lock_catalog()?;
    let catalog = load_catalog(&catalog_path(&resolve_data_dir()))?;
    catalog
        .styles
        .into_iter()
        .find(|style| style.id == id)
        .ok_or_else(invalid)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StyleFileExportResult {
    pub output_path: String,
}

#[tauri::command]
pub fn deck_style_file_import_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: ConversionInput,
) -> Result<(), String> {
    ensure_main(window.label())?;
    check_request_id(&request_id)?;
    let host = current_input_host()?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |_context| {
        let bytes = host.read_conversion_input(&input, MAX_DECK_STYLE_BYTES as u64)?;
        let style = parse_style_file(&bytes)?;
        serde_json::to_value(style).map_err(|_| invalid())
    });
    Ok(())
}

#[tauri::command]
pub fn deck_style_file_export_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    style_id: String,
    dest_path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    check_request_id(&request_id)?;
    let style_id = Uuid::parse_str(&style_id).map_err(|_| invalid())?;
    validate_absolute_path(&dest_path).map_err(|_| invalid())?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |_context| {
        let style = find_user_style(style_id)?;
        let bytes = serialize_style_file(&style)?;
        publish_new_style_file(&dest_path, &bytes)?;
        Ok(serde_json::json!(StyleFileExportResult {
            output_path: dest_path.trim_start_matches(r"\\?\").to_string()
        }))
    });
    Ok(())
}
