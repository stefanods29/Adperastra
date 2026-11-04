//! Conversion presets (Step 08b E1-E4, D8).
//!
//! One small JSON catalog under the app data folder, written with
//! `fs_service::atomic_write`. A preset stores only allowlisted options, a
//! validated name pattern and display metadata. Passwords, tokens, input
//! paths, destinations and snapshots are absent by construction; the custom
//! `Serialize` implementation also strips them from an in-memory preset.
//!
//! Three immutable built-ins use fixed UUIDs and are never stored in the
//! catalog. A newer/unknown catalog version is refused without changing the
//! file.
#![allow(dead_code)]


use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use convert::naming::{render_conversion_name, MAX_PRESET_NAME_CHARS};
use convert::types::{ConvertOptions, ConverterId};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{ensure_main, AppState};

pub const PRESET_CATALOG_SCHEMA: u32 = 1;
pub const MAX_CONVERSION_PRESETS: usize = 100;
pub const MAX_PRESET_NAME_CHARS_NATIVE: usize = MAX_PRESET_NAME_CHARS as usize;
pub const MAX_IMPORT_BYTES: usize = 256 * 1024;

pub const BUILTIN_WEB_JPG: &str = "00000000-0000-4000-8000-000000000001";
pub const BUILTIN_IMAGES_PDF: &str = "00000000-0000-4000-8000-000000000002";
pub const BUILTIN_TABLE_CSV: &str = "00000000-0000-4000-8000-000000000003";

/// Mirrors the TypeScript `ConversionPreset` (E1). The wire keeps snake_case.
#[derive(Clone, Deserialize)]
pub struct ConversionPreset {
    pub id: String,
    pub name: String,
    pub converter_id: ConverterId,
    pub options: ConvertOptions,
    pub name_pattern: String,
    pub destination_mode: String,
    pub version: u32,
    pub created_unix: u64,
    pub modified_unix: u64,
}

impl fmt::Debug for ConversionPreset {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionPreset")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("converter_id", &self.converter_id)
            .field("options_kind", &option_kind(&self.options))
            .field("options", &"<redacted>")
            .field("name_pattern", &self.name_pattern)
            .field("destination_mode", &self.destination_mode)
            .field("version", &self.version)
            .field("created_unix", &self.created_unix)
            .field("modified_unix", &self.modified_unix)
            .finish()
    }
}

fn custom_error<S: Serializer>(message: String) -> S::Error {
    <S::Error as serde::ser::Error>::custom(message)
}

impl Serialize for ConversionPreset {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("ConversionPreset", 9)?;
        let options = sanitize_options(&self.options).map_err(custom_error::<S>)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("converter_id", &self.converter_id)?;
        state.serialize_field("options", &options)?;
        state.serialize_field("name_pattern", &self.name_pattern)?;
        state.serialize_field("destination_mode", &self.destination_mode)?;
        state.serialize_field("version", &self.version)?;
        state.serialize_field("created_unix", &self.created_unix)?;
        state.serialize_field("modified_unix", &self.modified_unix)?;
        state.end()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetCatalog {
    pub schema_version: u32,
    pub presets: Vec<ConversionPreset>,
}

impl Default for PresetCatalog {
    fn default() -> Self {
        Self {
            schema_version: PRESET_CATALOG_SCHEMA,
            presets: Vec::new(),
        }
    }
}

/// The managed catalog location and its write gate.
#[derive(Clone)]
pub struct ConversionPresetsStore {
    path: PathBuf,
    gate: Arc<Mutex<()>>,
}

impl ConversionPresetsStore {
    pub fn from_data_dir(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("conversion-presets.json"),
            gate: Arc::new(Mutex::new(())),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// The immutable built-ins, shown separately (E2). Their names are data;
/// the UI shows `convert.webJpg`, `convert.imagesPdf` and `convert.tableCsv`.
pub fn builtin_presets() -> Vec<ConversionPreset> {
    let image: ConvertOptions = serde_json::from_value(json!({
        "kind": "image",
        "value": {
            "quality": 90,
            "width": 1920,
            "height": null,
            "keep_aspect": true,
            "allow_upscale": false,
            "background_rgba": [255, 255, 255, 255],
            "first_frame": false,
            "metadata_keep": true
        }
    }))
    .expect("static image preset");
    let document: ConvertOptions = serde_json::from_value(json!({
        "kind": "document",
        "value": {
            "include_images": true,
            "page_size": "source",
            "margin_mm": 20,
            "sanitize": true,
            "encoding": "utf8",
            "title": null
        }
    }))
    .expect("static document preset");
    let table: ConvertOptions = serde_json::from_value(json!({
        "kind": "table",
        "value": {
            "delimiter": "comma",
            "header": true,
            "sheet": null,
            "formulas": "text",
            "dates": "iso",
            "newline": "crlf"
        }
    }))
    .expect("static table preset");
    vec![
        ConversionPreset {
            id: BUILTIN_WEB_JPG.to_string(),
            name: "web-jpg".to_string(),
            converter_id: serde_json::from_value(json!("image/jpeg")).expect("static converter"),
            options: image,
            name_pattern: "{stem}.{ext}".to_string(),
            destination_mode: "source".to_string(),
            version: 1,
            created_unix: 0,
            modified_unix: 0,
        },
        ConversionPreset {
            id: BUILTIN_IMAGES_PDF.to_string(),
            name: "images-pdf".to_string(),
            converter_id: serde_json::from_value(json!("images/pdf")).expect("static converter"),
            options: document,
            name_pattern: "{stem}.{ext}".to_string(),
            destination_mode: "source".to_string(),
            version: 1,
            created_unix: 0,
            modified_unix: 0,
        },
        ConversionPreset {
            id: BUILTIN_TABLE_CSV.to_string(),
            name: "table-csv".to_string(),
            converter_id: serde_json::from_value(json!("xlsx/csv")).expect("static converter"),
            options: table,
            name_pattern: "{stem}.{ext}".to_string(),
            destination_mode: "source".to_string(),
            version: 1,
            created_unix: 0,
            modified_unix: 0,
        },
    ]
}

pub fn is_builtin(id: &str) -> bool {
    matches!(id, BUILTIN_WEB_JPG | BUILTIN_IMAGES_PDF | BUILTIN_TABLE_CSV)
}

/// Parse a whole catalog without changing anything on disk. Any unknown,
/// newer or invalid entry refuses the entire import.
pub fn parse_catalog_json(text: &str) -> Result<PresetCatalog, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "convert.invalid_preset".to_string())?;
    let schema = value
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| "convert.invalid_preset".to_string())?;
    if schema != u64::from(PRESET_CATALOG_SCHEMA) {
        return Err("convert.invalid_preset".to_string());
    }
    let presets = value
        .get("presets")
        .and_then(Value::as_array)
        .ok_or_else(|| "convert.invalid_preset".to_string())?;
    if presets.len() > MAX_CONVERSION_PRESETS {
        return Err("convert.invalid_preset".to_string());
    }
    let mut result = Vec::with_capacity(presets.len());
    let mut ids = std::collections::HashSet::new();
    for entry in presets {
        let mut preset: ConversionPreset =
            serde_json::from_value(entry.clone()).map_err(|_| "convert.invalid_preset".to_string())?;
        validate_preset(&preset)?;
        if !ids.insert(preset.id.clone()) {
            return Err("convert.invalid_preset".to_string());
        }
        preset.options = sanitize_options(&preset.options)?;
        result.push(preset);
    }
    Ok(PresetCatalog {
        schema_version: PRESET_CATALOG_SCHEMA,
        presets: result,
    })
}

/// Validate a saved (never built-in) preset.
pub fn validate_preset(preset: &ConversionPreset) -> Result<(), String> {
    if uuid::Uuid::parse_str(&preset.id).is_err() || is_builtin(&preset.id) {
        return Err("convert.invalid_preset".to_string());
    }
    let name_chars = preset.name.trim().chars().count();
    if name_chars == 0 || name_chars > MAX_PRESET_NAME_CHARS_NATIVE {
        return Err("convert.invalid_preset".to_string());
    }
    if preset.version != 1 {
        return Err("convert.invalid_preset".to_string());
    }
    if preset.destination_mode != "source" && preset.destination_mode != "ask" {
        return Err("convert.invalid_preset".to_string());
    }
    let id = converter_id_string(&preset.converter_id);
    let Some(ext) = convert::adapters::extension_for_converter(&id) else {
        return Err("convert.invalid_preset".to_string());
    };
    if !convert::adapters::options_kind_matches(&id, &preset.options) {
        return Err("convert.invalid_preset".to_string());
    }
    render_conversion_name(&preset.name_pattern, "name", ext, 1, "2026-01-01")
        .map(|_| ())
        .map_err(|_| "convert.invalid_pattern".to_string())
}

/// Save or replace one preset. The catalog is written atomically only after
/// every check passed.
pub fn save_preset(path: &Path, preset: ConversionPreset) -> Result<PresetCatalog, String> {
    validate_preset(&preset)?;
    let mut catalog = load_catalog(path)?;
    let now = now_unix();
    let mut preset = preset;
    preset.options = sanitize_options(&preset.options)?;
    preset.name = preset.name.trim().chars().take(MAX_PRESET_NAME_CHARS_NATIVE).collect();
    if let Some(existing) = catalog.presets.iter_mut().find(|entry| entry.id == preset.id) {
        preset.created_unix = existing.created_unix;
        preset.modified_unix = now;
        *existing = preset;
    } else {
        if catalog.presets.len() >= MAX_CONVERSION_PRESETS {
            return Err("convert.invalid_preset".to_string());
        }
        preset.created_unix = now;
        preset.modified_unix = now;
        catalog.presets.push(preset);
    }
    catalog.presets.sort_by_key(|left| left.name.to_lowercase());
    store_catalog(path, &catalog)?;
    Ok(catalog)
}

/// Remove one saved preset; unknown IDs are already removed.
pub fn remove_preset(path: &Path, id: &str) -> Result<PresetCatalog, String> {
    if is_builtin(id) {
        return Err("convert.invalid_preset".to_string());
    }
    let mut catalog = load_catalog(path)?;
    let before = catalog.presets.len();
    catalog.presets.retain(|preset| preset.id != id);
    if catalog.presets.len() != before {
        store_catalog(path, &catalog)?;
    }
    Ok(catalog)
}

/// Replace the whole catalog after an explicit import review.
pub fn import_catalog(path: &Path, text: &str) -> Result<PresetCatalog, String> {
    if text.len() > MAX_IMPORT_BYTES {
        return Err("convert.invalid_preset".to_string());
    }
    let catalog = parse_catalog_json(text)?;
    store_catalog(path, &catalog)?;
    Ok(catalog)
}

pub fn load_catalog(path: &Path) -> Result<PresetCatalog, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(PresetCatalog::default()),
        Err(_) => return Err("convert.invalid_preset".to_string()),
    };
    parse_catalog_json(&text)
}

fn store_catalog(path: &Path, catalog: &PresetCatalog) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|_| "convert.invalid_preset".to_string())?;
    fs_service::atomic_write(path, &bytes).map_err(|_| "convert.io".to_string())
}

/// The allowlist for persisted options, by kind.
pub fn sanitize_options(options: &ConvertOptions) -> Result<ConvertOptions, String> {
    let value = serde_json::to_value(options).map_err(|_| "convert.invalid_preset".to_string())?;
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "convert.invalid_preset".to_string())?;
    let mut inner = value
        .get("value")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "convert.invalid_preset".to_string())?;
    let allowed: &[&str] = match kind {
        "image" => &[
            "quality", "width", "height", "keep_aspect", "allow_upscale", "background_rgba",
            "first_frame", "metadata_keep",
        ],
        "pdf" => &["ranges", "dpi", "image_format", "quality", "combine"],
        "document" => &["include_images", "page_size", "margin_mm", "sanitize", "encoding", "title"],
        "table" => &["delimiter", "header", "sheet", "formulas", "dates", "newline"],
        "archive" => &["format", "level", "encrypt_names", "preserve_timestamps"],
        "media" => &[
            "start_ms", "end_ms", "width", "height", "video_codec", "audio_codec", "bitrate_kbps",
            "sample_rate", "keep_metadata", "burn_subtitles", "speed", "volume",
        ],
        "office" => &[
            "page_ranges", "export_comments", "export_notes", "encoding", "preserve_metadata",
            "external_links", "macros",
        ],
        _ => return Err("convert.invalid_preset".to_string()),
    };
    inner.retain(|key, _| allowed.contains(&key.as_str()));
    serde_json::from_value(json!({"kind": kind, "value": inner}))
        .map_err(|_| "convert.invalid_preset".to_string())
}

pub fn option_kind(options: &ConvertOptions) -> String {
    serde_json::to_value(options)
        .ok()
        .and_then(|value| value.get("kind").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

fn converter_id_string(id: &ConverterId) -> String {
    serde_json::to_value(id)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri commands (E3)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn conversion_presets_list(
    window: WebviewWindow,
    store: tauri::State<'_, ConversionPresetsStore>,
) -> Result<PresetCatalog, String> {
    ensure_main(window.label())?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = store
            .gate
            .lock()
            .map_err(|_| "convert.invalid_preset".to_string())?;
        load_catalog(&store.path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn conversion_preset_save(
    window: WebviewWindow,
    _app: AppHandle,
    store: tauri::State<'_, ConversionPresetsStore>,
    preset: ConversionPreset,
) -> Result<PresetCatalog, String> {
    ensure_main(window.label())?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = store
            .gate
            .lock()
            .map_err(|_| "convert.invalid_preset".to_string())?;
        save_preset(&store.path, preset)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn conversion_preset_remove(
    window: WebviewWindow,
    _app: AppHandle,
    store: tauri::State<'_, ConversionPresetsStore>,
    id: String,
) -> Result<PresetCatalog, String> {
    ensure_main(window.label())?;
    if id.len() > 64 {
        return Err("convert.invalid_preset".to_string());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = store
            .gate
            .lock()
            .map_err(|_| "convert.invalid_preset".to_string())?;
        remove_preset(&store.path, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restore a previous catalog snapshot (Undo/Redo of a removal). Every
/// preset is validated and the whole file is replaced atomically.
#[tauri::command]
pub async fn conversion_presets_replace(
    window: WebviewWindow,
    _app: AppHandle,
    store: tauri::State<'_, ConversionPresetsStore>,
    catalog: PresetCatalog,
) -> Result<PresetCatalog, String> {
    ensure_main(window.label())?;
    if catalog.schema_version != PRESET_CATALOG_SCHEMA || catalog.presets.len() > MAX_CONVERSION_PRESETS {
        return Err("convert.invalid_preset".to_string());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = store
            .gate
            .lock()
            .map_err(|_| "convert.invalid_preset".to_string())?;
        let mut ids = std::collections::HashSet::new();
        let mut clean = Vec::with_capacity(catalog.presets.len());
        for mut preset in catalog.presets {
            validate_preset(&preset)?;
            if !ids.insert(preset.id.clone()) {
                return Err("convert.invalid_preset".to_string());
            }
            preset.options = sanitize_options(&preset.options)?;
            clean.push(preset);
        }
        let clean = PresetCatalog {
            schema_version: PRESET_CATALOG_SCHEMA,
            presets: clean,
        };
        store_catalog(&store.path, &clean)?;
        Ok(clean)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn conversion_presets_import(
    window: WebviewWindow,
    _app: AppHandle,
    store: tauri::State<'_, ConversionPresetsStore>,
    catalog_json: String,
) -> Result<PresetCatalog, String> {
    ensure_main(window.label())?;
    if catalog_json.len() > MAX_IMPORT_BYTES {
        return Err("convert.invalid_preset".to_string());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = store
            .gate
            .lock()
            .map_err(|_| "convert.invalid_preset".to_string())?;
        import_catalog(&store.path, &catalog_json)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The store lives under the app data folder; main.rs creates it once.
pub fn store_for(app: &AppHandle) -> ConversionPresetsStore {
    ConversionPresetsStore::from_data_dir(app.state::<AppState>().data_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn preset(id: &str, name: &str) -> ConversionPreset {
        let options: ConvertOptions = serde_json::from_value(json!({
            "kind": "table",
            "value": {
                "delimiter": "comma",
                "header": true,
                "sheet": null,
                "formulas": "text",
                "dates": "iso",
                "newline": "crlf"
            }
        }))
        .unwrap();
        ConversionPreset {
            id: id.to_string(),
            name: name.to_string(),
            converter_id: serde_json::from_value(json!("xlsx/csv")).unwrap(),
            options,
            name_pattern: "{stem}-{index}.{ext}".to_string(),
            destination_mode: "source".to_string(),
            version: 1,
            created_unix: 1,
            modified_unix: 1,
        }
    }

    #[test]
    fn a_newer_catalog_is_refused_without_mutation() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("conversion-presets.json");
        std::fs::write(&path, br#"{"schema_version":999,"presets":[]}"#).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert_eq!(
            import_catalog(&path, r#"{"schema_version":999,"presets":[]}"#).unwrap_err(),
            "convert.invalid_preset"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn one_hundred_presets_are_accepted_and_101_are_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("conversion-presets.json");
        for index in 0..MAX_CONVERSION_PRESETS {
            // 1000+ keeps these IDs clear of the three reserved built-ins.
            let id = format!("00000000-0000-4000-8000-{:012}", index + 1000);
            save_preset(&path, preset(&id, &format!("Preset {index}"))).unwrap();
        }
        let extra = preset("00000000-0000-4000-8000-000000000999", "Too many");
        assert_eq!(
            save_preset(&path, extra).unwrap_err(),
            "convert.invalid_preset"
        );
    }

    #[test]
    fn password_fields_never_reach_debug_or_serialization() {
        let mut value = preset("11111111-1111-4111-8111-111111111111", "Archive");
        value.converter_id = serde_json::from_value(json!("zip/seven_z")).unwrap();
        value.options = serde_json::from_value(json!({
            "kind": "archive",
            "value": {
                "format": "seven_z",
                "level": 6,
                "password": "output-secret",
                "source_password": "source-secret",
                "encrypt_names": false,
                "preserve_timestamps": true
            }
        }))
        .unwrap();
        let debug = format!("{value:?}");
        assert!(!debug.contains("output-secret"));
        assert!(!debug.contains("source-secret"));
        // The inner options Debug must redact too, not only the preset wrapper.
        let options_debug = format!("{:?}", value.options);
        assert!(!options_debug.contains("output-secret"));
        assert!(!options_debug.contains("source-secret"));
        let json = serde_json::to_string(&value).unwrap();
        assert!(!json.contains("output-secret"));
        assert!(!json.contains("source-secret"));
    }

    #[test]
    fn builtins_are_immutable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("conversion-presets.json");
        assert_eq!(
            remove_preset(&path, BUILTIN_WEB_JPG).unwrap_err(),
            "convert.invalid_preset"
        );
        let mut builtins = builtin_presets();
        let builtin = builtins.remove(0);
        assert_eq!(
            save_preset(&path, builtin).unwrap_err(),
            "convert.invalid_preset"
        );
    }
}
