//! Import and export of `.adptheme` files (Step 10a).
//!
//! The on-disk file is a small JSON package: the validated `CustomTheme`
//! plus an optional owned PNG as a hex string. It never contains an absolute
//! source path, a font file or history. User export publishes with owned
//! no-replace I/O; import never changes settings or the catalog by itself.

use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::custom_theme_types::{
    is_canonical_uuid, validate_custom_theme, CustomTheme, ThemeError, ThemeExportResult,
    MAX_THEME_BYTES, MAX_THEME_IMAGE_BYTES,
};
use crate::{ensure_main, validate_absolute_path, AppState};

pub const THEME_FILE_EXTENSION: &str = "adptheme";
pub const MAX_THEME_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThemePackage {
    schema_version: u32,
    theme: CustomTheme,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background_png_hex: Option<String>,
}

fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, ThemeError> {
    let file = std::fs::File::open(path).map_err(|_| ThemeError::Io)?;
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ThemeError::Io)?;
    if bytes.len() as u64 > max {
        return Err(ThemeError::Limit);
    }
    Ok(bytes)
}

fn decode_hex(text: &str) -> Result<Vec<u8>, ThemeError> {
    if !text.len().is_multiple_of(2) || text.len() > MAX_THEME_IMAGE_BYTES * 2 {
        return Err(ThemeError::Limit);
    }
    let mut bytes = Vec::with_capacity(text.len() / 2);
    let raw = text.as_bytes();
    for pair in raw.as_chunks::<2>().0 {
        let high = hex_value(pair[0]).ok_or(ThemeError::Invalid)?;
        let low = hex_value(pair[1]).ok_or(ThemeError::Invalid)?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Parse and fully validate a package without touching the store. The
/// returned image bytes are untrusted until `import_theme` decodes and owns
/// them; no asset id from the package is ever trusted.
pub fn parse_package(bytes: &[u8]) -> Result<(CustomTheme, Option<Vec<u8>>), ThemeError> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| ThemeError::Invalid)?;
    let (mut theme, image_hex) = if value.get("theme").is_some() {
        let package: ThemePackage = serde_json::from_value(value).map_err(|_| ThemeError::Invalid)?;
        if package.schema_version != 1 {
            return Err(ThemeError::Invalid);
        }
        (package.theme, package.background_png_hex)
    } else {
        let theme: CustomTheme = serde_json::from_value(value).map_err(|_| ThemeError::Invalid)?;
        (theme, None)
    };
    validate_custom_theme(&theme)?;
    crate::theme_fonts::ensure_font_allowed(&theme.ui_font)
        .map_err(|_| ThemeError::Invalid)?;
    let Some(hex) = image_hex else {
        if let Some(background) = &mut theme.background {
            // Foreign asset ids are not trusted and never resolved in this store.
            background.asset_id = None;
        }
        return Ok((theme, None));
    };
    let background = theme.background.as_mut().ok_or(ThemeError::Invalid)?;
    let png = decode_hex(&hex)?;
    crate::theme_assets::validate_owned_png(&png)?;
    // The image is re-owned under a fresh asset id by `import_theme`.
    background.asset_id = None;
    Ok((theme, Some(png)))
}

pub fn import_theme(data_dir: &Path, path: &Path) -> Result<CustomTheme, ThemeError> {
    let bytes = read_bounded(path, MAX_THEME_PACKAGE_BYTES)?;
    let (mut theme, image) = parse_package(&bytes)?;
    let Some(png) = image else {
        return Ok(theme);
    };
    let (asset_id, _, _, _) = crate::theme_assets::store_owned_png(data_dir, &png)?;
    let background = theme.background.as_mut().ok_or(ThemeError::Invalid)?;
    background.asset_id = Some(asset_id.clone());
    if let Err(error) = validate_custom_theme(&theme) {
        if let Some(asset) = crate::theme_assets::asset_path(data_dir, &asset_id) {
            let _ = std::fs::remove_file(asset);
        }
        return Err(error);
    }
    Ok(theme)
}

pub fn export_theme(
    data_dir: &Path,
    id: &str,
    dest: &Path,
    include_image: bool,
) -> Result<ThemeExportResult, ThemeError> {
    let theme = crate::custom_theme_store::read(data_dir, id)?;
    let image = if include_image {
        match theme
            .background
            .as_ref()
            .and_then(|background| background.asset_id.as_deref())
        {
            Some(asset_id) => Some(crate::theme_assets::read_asset_png(data_dir, asset_id)?),
            None => None,
        }
    } else {
        None
    };
    let package = ThemePackage {
        schema_version: 1,
        theme: theme.clone(),
        background_png_hex: image.as_deref().map(hex_encode),
    };
    // The theme data itself stays within its own bound; the optional image is
    // bounded separately by validate_png and the package cap.
    let theme_bytes = serde_json::to_vec(&theme).map_err(|_| ThemeError::Invalid)?;
    if theme_bytes.len() > MAX_THEME_BYTES {
        return Err(ThemeError::Limit);
    }
    let bytes = serde_json::to_vec_pretty(&package).map_err(|_| ThemeError::Invalid)?;
    if bytes.len() as u64 > MAX_THEME_PACKAGE_BYTES {
        return Err(ThemeError::Limit);
    }

    let parent = dest.parent().ok_or(ThemeError::Invalid)?;
    if parent.as_os_str().is_empty() || !parent.is_dir() {
        return Err(ThemeError::Invalid);
    }
    let pinned = fs_service::owned_io::PinnedDirectory::open(parent).map_err(|_| ThemeError::Io)?;
    let mut output = fs_service::owned_io::OwnedOutput::create(&pinned, "theme").map_err(|_| ThemeError::Io)?;
    output
        .file_mut()
        .write_all(&bytes)
        .map_err(|_| ThemeError::Io)?;
    output.flush_sync().map_err(|_| ThemeError::Io)?;
    let name = dest
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ThemeError::Invalid)?;
    output.publish_name(name).map_err(|_| ThemeError::Io)?;
    Ok(ThemeExportResult {
        path: dest.to_string_lossy().into_owned(),
        bytes: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn theme_import(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    path: String,
) -> Result<CustomTheme, String> {
    ensure_main(window.label())?;
    // Step 09h: importing owns a new asset in the theme store, which safe
    // mode keeps read-only.
    safe.settings_writable()?;
    validate_absolute_path(&path)?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_theme(&data_dir, Path::new(&path)).map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn theme_export(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    dest_path: String,
    include_image: bool,
) -> Result<ThemeExportResult, String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&id) {
        return Err("theme.invalid".to_string());
    }
    validate_absolute_path(&dest_path)?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        export_theme(&data_dir, &id, Path::new(&dest_path), include_image)
            .map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A dialog suggestion only: the user still chooses the real path.
fn safe_file_name(value: &str) -> String {
    let mut name: String = value
        .chars()
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                character
            }
        })
        .collect();
    name = name.trim_matches(|character| character == '.' || character == ' ').to_string();
    if name.is_empty() {
        "theme".to_string()
    } else {
        name
    }
}

fn check_dialog_text(title: &str, file_name: Option<&str>, filter_name: &str) -> Result<(), String> {
    if title.chars().count() > 200
        || filter_name.chars().count() > 200
        || file_name.is_some_and(|name| name.chars().count() > 200)
    {
        return Err("theme.invalid".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn theme_pick_import(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    title: String,
    filter_name: String,
) -> Result<Option<CustomTheme>, String> {
    ensure_main(window.label())?;
    // Step 09h: fail before the dialog when the theme store is read-only.
    safe.settings_writable()?;
    check_dialog_text(&title, None, &filter_name)?;
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, "*.adptheme")
            .map_err(|_| "theme.io".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(path) = chosen else {
        return Ok(None);
    };
    validate_absolute_path(&path)?;
    let data_dir = state.data_dir.clone();
    let theme = tauri::async_runtime::spawn_blocking(move || {
        import_theme(&data_dir, Path::new(&path)).map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(theme))
}

#[tauri::command]
pub async fn theme_pick_export(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    include_image: bool,
    title: String,
    file_name: String,
    filter_name: String,
) -> Result<Option<ThemeExportResult>, String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&id) {
        return Err("theme.invalid".to_string());
    }
    check_dialog_text(&title, Some(&file_name), &filter_name)?;
    let data_dir = state.data_dir.clone();
    let name = safe_file_name(&file_name);
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_save_path(
            owner,
            &title,
            &name,
            &filter_name,
            "*.adptheme",
            THEME_FILE_EXTENSION,
        )
        .map_err(|_| "theme.io".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(dest) = chosen else {
        return Ok(None);
    };
    validate_absolute_path(&dest)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        export_theme(&data_dir, &id, Path::new(&dest), include_image)
            .map_err(|error| error.code().to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::custom_theme_types::ThemeBackground;
    use fs_service::theme_data::ThemeValue;

    fn theme() -> CustomTheme {
        CustomTheme {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            name: "Example".to_string(),
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
            modified_unix: 1,
        }
    }

    #[test]
    fn dialog_name_cannot_add_a_path() {
        assert_eq!(safe_file_name("../evil"), "_evil");
        assert_eq!(safe_file_name("  "), "theme");
    }

    #[test]
    fn failed_import_does_not_apply() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.adptheme");
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(import_theme(dir.path(), &path), Err(ThemeError::Invalid));
        assert!(!crate::custom_theme_store::catalog_path(dir.path()).exists());
        assert!(crate::custom_theme_store::list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn export_never_contains_source_paths() {
        let dir = tempfile::tempdir().unwrap();
        let saved = crate::custom_theme_store::save(dir.path(), theme()).unwrap();
        let dest = dir.path().join("export.adptheme");
        export_theme(dir.path(), &saved.id, &dest, true).unwrap();
        let text = std::fs::read_to_string(&dest).unwrap();
        assert!(!text.contains(dir.path().to_string_lossy().as_ref()));
        assert!(!text.contains("C:\\"));
        assert!(text.contains("\"theme\""));
    }

    #[test]
    fn collision_does_not_replace() {
        let dir = tempfile::tempdir().unwrap();
        let saved = crate::custom_theme_store::save(dir.path(), theme()).unwrap();
        let dest = dir.path().join("export.adptheme");
        std::fs::write(&dest, b"keep me").unwrap();
        assert!(export_theme(dir.path(), &saved.id, &dest, false).is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"keep me".to_vec());
    }

    #[cfg(windows)]
    fn one_pixel_png() -> Vec<u8> {
        let pixels = crate::thumbnail_decode::DecodedPixels {
            width: 1,
            height: 1,
            stride: 4,
            rgba: vec![255, 0, 0, 255],
            original_width: 1,
            original_height: 1,
            orientation: 1,
        };
        crate::thumbnail_encode::encode_png(&pixels, 4096).unwrap()
    }

    #[test]
    fn a_package_image_must_really_decode() {
        let mut value = theme();
        value.background = Some(ThemeBackground {
            asset_id: None,
            fit: "fill".to_string(),
            opacity: 0.15,
            blur_px: 0,
        });
        let mut fake = vec![0u8; 33];
        fake[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        fake[12..16].copy_from_slice(b"IHDR");
        fake[16..20].copy_from_slice(&10u32.to_be_bytes());
        fake[20..24].copy_from_slice(&10u32.to_be_bytes());
        let package = ThemePackage {
            schema_version: 1,
            theme: value,
            background_png_hex: Some(hex_encode(&fake)),
        };
        let bytes = serde_json::to_vec(&package).unwrap();
        assert_eq!(parse_package(&bytes), Err(ThemeError::Invalid));
    }

    #[cfg(windows)]
    #[test]
    fn round_trip_keeps_data_and_embedded_png() {
        let dir = tempfile::tempdir().unwrap();
        let mut value = theme();
        let asset_id = uuid::Uuid::new_v4().to_string();
        value.background = Some(ThemeBackground {
            asset_id: Some(asset_id.clone()),
            fit: "fill".to_string(),
            opacity: 0.15,
            blur_px: 0,
        });
        let saved = crate::custom_theme_store::save(dir.path(), value).unwrap();
        let png = one_pixel_png();
        let asset = crate::theme_assets::asset_path(dir.path(), &asset_id).unwrap();
        std::fs::create_dir_all(asset.parent().unwrap()).unwrap();
        std::fs::write(&asset, &png).unwrap();

        let dest = dir.path().join("export.adptheme");
        export_theme(dir.path(), &saved.id, &dest, true).unwrap();
        let other = tempfile::tempdir().unwrap();
        let imported = import_theme(other.path(), &dest).unwrap();
        assert!(imported.background.is_some());
        assert_ne!(imported.background.unwrap().asset_id, Some(asset_id));
    }
}
