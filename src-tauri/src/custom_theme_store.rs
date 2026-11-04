//! App-owned custom theme catalog (Step 10a).
//!
//! Layout under `<data>/themes`:
//! - `catalog.json`: bounded summaries, replaced atomically;
//! - `<uuid>.adptheme`: one validated `CustomTheme` per file;
//! - `assets/<uuid>.png`: owned background images (never listed as themes).
//!
//! No user path is ever stored in a theme. User export is handled by
//! `theme_transfer` with owned no-replace publication.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use crate::custom_theme_types::{
    fallback_theme_settings, is_canonical_uuid, theme_summary, validate_custom_theme,
    validate_summary_list, CustomTheme, CustomThemeSummary, ThemeError, MAX_THEME_STORAGE_BYTES,
    MAX_THEMES,
};
use crate::{ensure_main, unix_now, AppState};

pub const THEMES_DIR: &str = "themes";
pub const CATALOG_FILE: &str = "catalog.json";

pub fn themes_root(data_dir: &Path) -> PathBuf {
    data_dir.join(THEMES_DIR)
}

pub fn theme_path(data_dir: &Path, id: &str) -> Option<PathBuf> {
    if !is_canonical_uuid(id) {
        return None;
    }
    Some(themes_root(data_dir).join(format!("{id}.adptheme")))
}

pub fn catalog_path(data_dir: &Path) -> PathBuf {
    themes_root(data_dir).join(CATALOG_FILE)
}

fn catalog_bytes(summaries: &[CustomThemeSummary]) -> Result<Vec<u8>, ThemeError> {
    validate_summary_list(summaries)?;
    serde_json::to_vec_pretty(summaries).map_err(|_| ThemeError::Invalid)
}

fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, ThemeError> {
    let file = fs::File::open(path).map_err(|_| ThemeError::Io)?;
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| ThemeError::Io)?;
    if bytes.len() as u64 > max {
        return Err(ThemeError::Limit);
    }
    Ok(bytes)
}

fn read_catalog(data_dir: &Path) -> Option<Vec<CustomThemeSummary>> {
    let bytes = read_bounded(
        &catalog_path(data_dir),
        fs_service::theme_data::MAX_THEME_BYTES as u64,
    )
    .ok()?;
    let summaries: Vec<CustomThemeSummary> = serde_json::from_slice(&bytes).ok()?;
    validate_summary_list(&summaries).ok()?;
    Some(summaries)
}

fn write_catalog(data_dir: &Path, summaries: &[CustomThemeSummary]) -> Result<(), ThemeError> {
    let bytes = catalog_bytes(summaries)?;
    fs_service::atomic_write(&catalog_path(data_dir), &bytes).map_err(|_| ThemeError::Io)
}

/// Read every valid theme file (bounded by `MAX_THEMES`), ignoring notes and
/// assets. Invalid files are not listed and never overwritten by this scan.
fn scan_summaries(data_dir: &Path) -> Vec<CustomThemeSummary> {
    let root = themes_root(data_dir);
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut summaries = Vec::new();
    for entry in entries.flatten() {
        if summaries.len() >= MAX_THEMES {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".adptheme") else {
            continue;
        };
        if !is_canonical_uuid(id) {
            continue;
        }
        if let Ok(theme) = read_theme_file(&entry.path()) {
            if theme.id.eq_ignore_ascii_case(id) {
                summaries.push(theme_summary(&theme));
            }
        }
    }
    sort_summaries(&mut summaries);
    summaries
}

fn sort_summaries(summaries: &mut [CustomThemeSummary]) {
    summaries.sort_by(|left, right| {
        right
            .modified_unix
            .cmp(&left.modified_unix)
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn read_theme_file(path: &Path) -> Result<CustomTheme, ThemeError> {
    let bytes = read_bounded(path, fs_service::theme_data::MAX_THEME_BYTES as u64)?;
    let theme: CustomTheme = serde_json::from_slice(&bytes).map_err(|_| ThemeError::Invalid)?;
    validate_custom_theme(&theme)?;
    Ok(theme)
}

/// The catalog is a cache; a crash between the theme write and the catalog
/// write, or a file added/removed outside the app, must not hide a theme.
fn catalog_matches_files(data_dir: &Path, summaries: &[CustomThemeSummary]) -> bool {
    let Ok(entries) = fs::read_dir(themes_root(data_dir)) else {
        return summaries.is_empty();
    };
    let mut names = std::collections::BTreeSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".adptheme") else {
            continue;
        };
        if !is_canonical_uuid(id) {
            continue;
        }
        if !names.insert(id.to_ascii_lowercase()) || names.len() > MAX_THEMES {
            return false;
        }
    }
    names.len() == summaries.len()
        && summaries
            .iter()
            .all(|summary| names.contains(&summary.id.to_ascii_lowercase()))
}

fn catalog_or_rebuild(data_dir: &Path) -> Vec<CustomThemeSummary> {
    if let Some(summaries) = read_catalog(data_dir) {
        if catalog_matches_files(data_dir, &summaries) {
            return summaries;
        }
    }
    let summaries = scan_summaries(data_dir);
    let _ = write_catalog(data_dir, &summaries);
    summaries
}

pub fn list(data_dir: &Path) -> Result<Vec<CustomThemeSummary>, ThemeError> {
    let summaries = catalog_or_rebuild(data_dir);
    validate_summary_list(&summaries)?;
    Ok(summaries)
}

pub fn read(data_dir: &Path, id: &str) -> Result<CustomTheme, ThemeError> {
    let path = theme_path(data_dir, id).ok_or(ThemeError::Invalid)?;
    let theme = read_theme_file(&path)?;
    if !theme.id.eq_ignore_ascii_case(id) {
        return Err(ThemeError::Invalid);
    }
    Ok(theme)
}

fn stored_theme_bytes(data_dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(themes_root(data_dir)) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".adptheme"))
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

/// Save one validated theme atomically, then rebuild the bounded catalog.
pub fn save(data_dir: &Path, mut theme: CustomTheme) -> Result<CustomTheme, ThemeError> {
    validate_custom_theme(&theme)?;
    crate::theme_fonts::ensure_font_allowed(&theme.ui_font)
        .map_err(|_| ThemeError::Invalid)?;
    let id = theme.id.clone();
    let path = theme_path(data_dir, &id).ok_or(ThemeError::Invalid)?;
    let root = themes_root(data_dir);
    fs::create_dir_all(&root).map_err(|_| ThemeError::Io)?;

    // Never overwrite a file this store cannot read back: a newer schema, a
    // corrupted file or a file whose inner id differs is left untouched.
    let replacing = if path.exists() {
        let existing = read_theme_file(&path).map_err(|_| ThemeError::Invalid)?;
        if !existing.id.eq_ignore_ascii_case(&id) {
            return Err(ThemeError::Invalid);
        }
        true
    } else {
        false
    };
    let summaries = scan_summaries(data_dir);
    if !replacing && summaries.len() >= MAX_THEMES {
        return Err(ThemeError::Limit);
    }
    if theme.modified_unix == 0 {
        theme.modified_unix = unix_now();
    }
    let bytes = serde_json::to_vec_pretty(&theme).map_err(|_| ThemeError::Invalid)?;
    if bytes.len() > fs_service::theme_data::MAX_THEME_BYTES {
        return Err(ThemeError::Limit);
    }
    let previous = if replacing {
        fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0)
    } else {
        0
    };
    let current = stored_theme_bytes(data_dir);
    let next_total = current
        .saturating_sub(previous)
        .saturating_add(bytes.len() as u64);
    if next_total > MAX_THEME_STORAGE_BYTES {
        return Err(ThemeError::Limit);
    }
    fs_service::atomic_write(&path, &bytes).map_err(|_| ThemeError::Io)?;

    let mut summaries = scan_summaries(data_dir);
    sort_summaries(&mut summaries);
    write_catalog(data_dir, &summaries)?;
    Ok(theme)
}

/// Remove one owned theme file. The caller applies the settings fallback.
pub fn remove(data_dir: &Path, id: &str) -> Result<(), ThemeError> {
    let path = theme_path(data_dir, id).ok_or(ThemeError::Invalid)?;
    let asset_id = read_theme_file(&path)
        .ok()
        .and_then(|theme| theme.background.and_then(|background| background.asset_id));
    fs::remove_file(&path).map_err(|_| ThemeError::Io)?;
    let asset = asset_id
        .filter(|asset_id| !other_theme_uses_asset(data_dir, asset_id, id))
        .and_then(|asset_id| crate::theme_assets::asset_path(data_dir, &asset_id));
    if let Some(asset) = asset {
        let _ = fs::remove_file(asset);
    }
    let mut summaries = scan_summaries(data_dir);
    sort_summaries(&mut summaries);
    write_catalog(data_dir, &summaries)
}

fn other_theme_uses_asset(data_dir: &Path, asset_id: &str, except_theme: &str) -> bool {
    let Ok(entries) = fs::read_dir(themes_root(data_dir)) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".adptheme") else {
            continue;
        };
        if id == except_theme || !is_canonical_uuid(id) {
            continue;
        }
        if let Ok(theme) = read_theme_file(&entry.path()) {
            if theme
                .background
                .as_ref()
                .and_then(|background| background.asset_id.as_deref())
                == Some(asset_id)
            {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn theme_list(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<CustomThemeSummary>, String> {
    ensure_main(window.label())?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || list(&data_dir).map_err(|error| error.code().to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn theme_read(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<CustomTheme, String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&id) {
        return Err("theme.invalid".to_string());
    }
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        read(&data_dir, &id).map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn theme_save(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    theme: CustomTheme,
) -> Result<CustomTheme, String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the theme store read-only.
    safe.settings_writable()?;
    if !is_canonical_uuid(&theme.id) {
        return Err("theme.invalid".to_string());
    }
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save(&data_dir, theme).map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn theme_remove(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the theme store read-only.
    safe.settings_writable()?;
    if !is_canonical_uuid(&id) {
        return Err("theme.invalid".to_string());
    }
    let data_dir = state.data_dir.clone();
    let remove_dir = data_dir.clone();
    let remove_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        remove(&remove_dir, &remove_id).map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .clone();
    if fallback_theme_settings(&mut settings.theme_custom, &id) {
        let next = settings.clone();
        let save_dir = data_dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::save_settings_to_dir(&save_dir, &next).map_err(String::from)
        })
        .await
        .map_err(|error| error.to_string())??;
        let mut cached = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        *cached = settings;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::theme_data::{ThemeBackground, ThemeValue};

    fn theme(name: &str) -> CustomTheme {
        CustomTheme {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            scheme: "light".to_string(),
            tokens: std::collections::BTreeMap::from([(
                "color.surface.window".to_string(),
                ThemeValue::String("#FFFFFF".to_string()),
            )]),
            editor_tokens: std::collections::BTreeMap::new(),
            material: "solid".to_string(),
            ui_font: "Inter".to_string(),
            ui_font_size_px: 12,
            tab_shape: "rounded".to_string(),
            icon_mode: "lucide".to_string(),
            styles: Vec::new(),
            background: None,
            modified_unix: 7,
        }
    }

    #[test]
    fn save_round_trip_and_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let saved = save(dir.path(), theme("Example")).unwrap();
        let read_back = read(dir.path(), &saved.id).unwrap();
        assert_eq!(read_back.name, "Example");
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn newer_schema_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let mut value = theme("Example");
        let path = theme_path(dir.path(), &value.id).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        value.schema_version = 2;
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(read(dir.path(), &value.id), Err(ThemeError::Invalid));
        save(dir.path(), theme("Other")).unwrap();
        let unchanged = fs::read(&path).unwrap();
        assert!(String::from_utf8_lossy(&unchanged).contains("\"schema_version\":2"));
    }

    #[test]
    fn theme_paths_are_uuids_only() {
        let dir = Path::new(r"C:\data");
        assert!(theme_path(dir, "../../secret").is_none());
        assert!(theme_path(dir, "not-a-uuid").is_none());
        let id = uuid::Uuid::new_v4().to_string();
        assert!(theme_path(dir, &id)
            .unwrap()
            .ends_with(format!("{id}.adptheme").as_str()));
    }

    #[test]
    fn same_id_newer_schema_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let value = theme("Example");
        let path = theme_path(dir.path(), &value.id).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut newer = value.clone();
        newer.schema_version = 2;
        fs::write(&path, serde_json::to_vec(&newer).unwrap()).unwrap();
        assert_eq!(save(dir.path(), value), Err(ThemeError::Invalid));
        let unchanged = fs::read(&path).unwrap();
        assert!(String::from_utf8_lossy(&unchanged).contains("\"schema_version\":2"));
    }

    #[test]
    fn unlisted_font_is_refused_before_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let mut value = theme("Font");
        value.ui_font = "@Arial".to_string();
        assert_eq!(save(dir.path(), value), Err(ThemeError::Invalid));
        assert!(!catalog_path(dir.path()).exists());
    }

    #[test]
    fn a_file_may_only_claim_its_own_id() {
        let dir = tempfile::tempdir().unwrap();
        let value = theme("Mismatch");
        let other = theme("Other");
        let path = theme_path(dir.path(), &value.id).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_vec(&other).unwrap()).unwrap();
        assert_eq!(read(dir.path(), &value.id), Err(ThemeError::Invalid));
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn catalog_rebuilds_when_a_theme_file_appears() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), theme("First")).unwrap();
        let added = theme("Added");
        let path = theme_path(dir.path(), &added.id).unwrap();
        fs::write(&path, serde_json::to_vec(&added).unwrap()).unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 2);
    }

    #[test]
    fn one_hundred_first_theme_refused() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..MAX_THEMES {
            save(dir.path(), theme(&format!("Theme {index}"))).unwrap();
        }
        assert_eq!(save(dir.path(), theme("Overflow")), Err(ThemeError::Limit));
        assert_eq!(list(dir.path()).unwrap().len(), MAX_THEMES);
    }

    #[test]
    fn remove_deletes_only_the_owned_theme_and_asset() {
        let dir = tempfile::tempdir().unwrap();
        let mut value = theme("With image");
        let asset_id = uuid::Uuid::new_v4().to_string();
        value.background = Some(ThemeBackground {
            asset_id: Some(asset_id.clone()),
            fit: "fill".to_string(),
            opacity: 0.15,
            blur_px: 0,
        });
        let saved = save(dir.path(), value).unwrap();
        let asset = crate::theme_assets::asset_path(dir.path(), &asset_id).unwrap();
        fs::create_dir_all(asset.parent().unwrap()).unwrap();
        fs::write(&asset, b"png").unwrap();
        remove(dir.path(), &saved.id).unwrap();
        assert!(!asset.exists());
        assert!(list(dir.path()).unwrap().is_empty());
    }
}
