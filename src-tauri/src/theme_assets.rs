//! Owned theme background images (Step 10a).
//!
//! The source is an explicit local choice. It is decoded by the Step 07a
//! helper at most 4096 px per edge and 16 MP, then re-encoded as an owned PNG
//! under `<data>/themes/assets`. No source path and no raw bytes enter the
//! theme data or JSON IPC.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{State, WebviewWindow};

use crate::custom_theme_types::{
    is_canonical_uuid, ThemeBackgroundAsset, ThemeError, MAX_BACKGROUND_EDGE,
    MAX_BACKGROUND_PIXELS, MAX_BACKGROUND_SOURCE_BYTES, MAX_THEME_IMAGE_BYTES,
};
use crate::files::FileGrants;
use crate::{ensure_main, validate_absolute_path, AppState};

pub const ASSETS_DIR: &str = "assets";

pub fn assets_root(data_dir: &Path) -> PathBuf {
    crate::custom_theme_store::themes_root(data_dir).join(ASSETS_DIR)
}

pub fn asset_path(data_dir: &Path, asset_id: &str) -> Option<PathBuf> {
    if !is_canonical_uuid(asset_id) {
        return None;
    }
    Some(assets_root(data_dir).join(format!("{asset_id}.png")))
}

/// Refuse an oversized source before opening or allocating pixels.
pub fn check_source_size(size: u64) -> Result<(), ThemeError> {
    if size == 0 || size > MAX_BACKGROUND_SOURCE_BYTES {
        return Err(ThemeError::Limit);
    }
    Ok(())
}

/// PNG signature and IHDR dimensions, before any decoder allocation.
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32), ThemeError> {
    if bytes.len() < 33 || bytes.len() > MAX_THEME_IMAGE_BYTES {
        return Err(ThemeError::Limit);
    }
    if &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err(ThemeError::Invalid);
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0
        || height == 0
        || width > MAX_BACKGROUND_EDGE
        || height > MAX_BACKGROUND_EDGE
        || u64::from(width) * u64::from(height) > MAX_BACKGROUND_PIXELS
    {
        return Err(ThemeError::Limit);
    }
    Ok((width, height))
}

/// Read at most `max` bytes, so a file that grows after a metadata check can
/// never make the caller allocate past its bound.
fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, ThemeError> {
    let file = std::fs::File::open(path).map_err(|_| ThemeError::Io)?;
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| ThemeError::Io)?;
    if bytes.len() as u64 > max {
        return Err(ThemeError::Limit);
    }
    Ok(bytes)
}

pub fn read_asset_png(data_dir: &Path, asset_id: &str) -> Result<Vec<u8>, ThemeError> {
    let path = asset_path(data_dir, asset_id).ok_or(ThemeError::Invalid)?;
    let bytes = read_bounded(&path, MAX_THEME_IMAGE_BYTES as u64)?;
    validate_png(&bytes)?;
    Ok(bytes)
}

/// The helper's PNG writer has a lower hard cap than the theme image limit.
pub fn png_output_cap() -> u64 {
    (MAX_THEME_IMAGE_BYTES as u64).min(crate::thumbnail_encode::MAX_OUTPUT_BYTES)
}

/// An untrusted package image is fully decoded (bounded edge and pixels)
/// before it can become an owned asset; a header alone is not enough.
pub fn validate_owned_png(bytes: &[u8]) -> Result<(u32, u32), ThemeError> {
    let (width, height) = validate_png(bytes)?;
    let decoded = crate::thumbnail_decode::decode_pixels_from_memory(
        bytes,
        MAX_BACKGROUND_EDGE,
        MAX_BACKGROUND_PIXELS,
    )
    .map_err(|code| {
        if code == "thumbnail.too_large" {
            ThemeError::Limit
        } else {
            ThemeError::Invalid
        }
    })?;
    if decoded.width == 0
        || decoded.height == 0
        || decoded.width > MAX_BACKGROUND_EDGE
        || decoded.height > MAX_BACKGROUND_EDGE
        || u64::from(decoded.width) * u64::from(decoded.height) > MAX_BACKGROUND_PIXELS
    {
        return Err(ThemeError::Limit);
    }
    Ok((width, height))
}

/// Publish one already validated PNG under a fresh UUID. The path is derived
/// only from this store; no caller path is stored or cleaned up.
pub fn store_owned_png(
    data_dir: &Path,
    png: &[u8],
) -> Result<(String, u32, u32, u64), ThemeError> {
    let (width, height) = validate_png(png)?;
    let asset_id = uuid::Uuid::new_v4().to_string();
    let path = asset_path(data_dir, &asset_id).ok_or(ThemeError::Invalid)?;
    fs_service::atomic_write(&path, png).map_err(|_| ThemeError::Io)?;
    Ok((asset_id, width, height, png.len() as u64))
}

/// Decode one chosen image through the Step 07a helper and publish an owned
/// PNG. Only this command's files are ever removed on failure.
pub fn import_background(
    data_dir: &Path,
    source: &Path,
) -> Result<(String, u32, u32, u64), ThemeError> {
    let metadata = std::fs::metadata(source).map_err(|_| ThemeError::Io)?;
    check_source_size(metadata.len())?;
    let file = std::fs::File::open(source).map_err(|_| ThemeError::Io)?;
    let decoded = crate::thumbnail_decode::decode_pixels(
        &file,
        MAX_BACKGROUND_EDGE,
        MAX_BACKGROUND_PIXELS,
    )
    .map_err(|_| ThemeError::Invalid)?;
    let width = decoded.width;
    let height = decoded.height;
    if width == 0
        || height == 0
        || width > MAX_BACKGROUND_EDGE
        || height > MAX_BACKGROUND_EDGE
        || u64::from(width) * u64::from(height) > MAX_BACKGROUND_PIXELS
    {
        return Err(ThemeError::Limit);
    }
    let expected = (width as usize)
        .checked_mul(4)
        .and_then(|stride| stride.checked_mul(height as usize))
        .ok_or(ThemeError::Limit)?;
    if decoded.rgba.len() != expected {
        return Err(ThemeError::Invalid);
    }
    let png = crate::thumbnail_encode::encode_png(&decoded, png_output_cap()).map_err(|code| {
        if code == "thumbnail.too_large" {
            ThemeError::Limit
        } else {
            ThemeError::Invalid
        }
    })?;
    validate_png(&png)?;
    store_owned_png(data_dir, &png)
}

fn asset_result(
    asset_id: String,
    token: String,
    width: u32,
    height: u32,
    byte_len: u64,
) -> ThemeBackgroundAsset {
    ThemeBackgroundAsset {
        name: format!("{asset_id}.png"),
        asset_id,
        token,
        mime: "image/png".to_string(),
        byte_len,
        width,
        height,
    }
}

#[tauri::command]
pub async fn theme_background_import(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    grants: State<'_, Arc<FileGrants>>,
    path: String,
) -> Result<ThemeBackgroundAsset, String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the theme store read-only.
    safe.settings_writable()?;
    validate_absolute_path(&path)?;
    let data_dir = state.data_dir.clone();
    let (asset_id, width, height, byte_len) =
        tauri::async_runtime::spawn_blocking(move || {
            import_background(&data_dir, Path::new(&path)).map_err(|error| error.code().to_string())
        })
        .await
        .map_err(|error| error.to_string())??;
    let asset = asset_path(&state.data_dir, &asset_id).ok_or("theme.invalid".to_string())?;
    let token = grants.grant(asset)?;
    Ok(asset_result(asset_id, token, width, height, byte_len))
}

#[tauri::command]
pub async fn theme_background_lease(
    window: WebviewWindow,
    state: State<'_, AppState>,
    grants: State<'_, Arc<FileGrants>>,
    asset_id: String,
) -> Result<ThemeBackgroundAsset, String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&asset_id) {
        return Err("theme.invalid".to_string());
    }
    let data_dir = state.data_dir.clone();
    let bytes = tauri::async_runtime::spawn_blocking({
        let data_dir = data_dir.clone();
        let asset_id = asset_id.clone();
        move || {
            crate::theme_assets::read_asset_png(&data_dir, &asset_id)
                .map_err(|error| error.code().to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    let (width, height) = validate_png(&bytes).map_err(|error| error.code().to_string())?;
    let asset = asset_path(&state.data_dir, &asset_id).ok_or("theme.invalid".to_string())?;
    let token = grants.grant(asset)?;
    Ok(asset_result(asset_id, token, width, height, bytes.len() as u64))
}

#[tauri::command]
pub async fn theme_pick_background(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    grants: State<'_, Arc<FileGrants>>,
    title: String,
    filter_name: String,
) -> Result<Option<ThemeBackgroundAsset>, String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the theme store read-only.
    safe.settings_writable()?;
    if title.chars().count() > 200 || filter_name.chars().count() > 200 {
        return Err("theme.invalid".to_string());
    }
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, "*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp")
            .map_err(|_| "theme.io".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(path) = chosen else {
        return Ok(None);
    };
    validate_absolute_path(&path)?;
    let data_dir = state.data_dir.clone();
    let (asset_id, width, height, byte_len) =
        tauri::async_runtime::spawn_blocking(move || {
            import_background(&data_dir, Path::new(&path)).map_err(|error| error.code().to_string())
        })
        .await
        .map_err(|error| error.to_string())??;
    let asset = asset_path(&state.data_dir, &asset_id).ok_or("theme.invalid".to_string())?;
    let token = grants.grant(asset)?;
    Ok(Some(asset_result(asset_id, token, width, height, byte_len)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_decode_cap_precedes_allocation() {
        assert_eq!(check_source_size(0), Err(ThemeError::Limit));
        assert_eq!(
            check_source_size(MAX_BACKGROUND_SOURCE_BYTES + 1),
            Err(ThemeError::Limit)
        );
        assert!(check_source_size(1024).is_ok());
    }

    #[test]
    fn png_dimensions_are_bounded_before_decode() {
        let mut png = vec![0u8; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&4000u32.to_be_bytes());
        png[20..24].copy_from_slice(&4000u32.to_be_bytes());
        assert_eq!(validate_png(&png), Ok((4000, 4000)));
        png[16..20].copy_from_slice(&4097u32.to_be_bytes());
        assert_eq!(validate_png(&png), Err(ThemeError::Limit));
        png[16..20].copy_from_slice(&5000u32.to_be_bytes());
        png[20..24].copy_from_slice(&5000u32.to_be_bytes());
        assert_eq!(validate_png(&png), Err(ThemeError::Limit));
    }

    #[test]
    fn asset_paths_are_uuids_only() {
        let dir = Path::new(r"C:\data");
        assert!(asset_path(dir, "../../secret").is_none());
        let id = uuid::Uuid::new_v4().to_string();
        assert!(asset_path(dir, &id).unwrap().ends_with(format!("{id}.png").as_str()));
    }

    #[test]
    fn the_encoder_cap_is_within_the_helper_limit() {
        assert!(png_output_cap() > 0);
        assert!(png_output_cap() <= crate::thumbnail_encode::MAX_OUTPUT_BYTES);
        assert!(png_output_cap() <= MAX_THEME_IMAGE_BYTES as u64);
    }

    #[test]
    fn a_header_alone_is_not_a_decodable_owned_image() {
        let mut png = vec![0u8; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&10u32.to_be_bytes());
        png[20..24].copy_from_slice(&10u32.to_be_bytes());
        assert_eq!(validate_owned_png(&png), Err(ThemeError::Invalid));
    }
}
