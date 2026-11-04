//! Local wallpaper palette (Step 10a).
//!
//! Reads only the path Windows reports through `SPI_GETDESKWALLPAPER`, never
//! a pictures folder. The Step 07a helper samples at most 256 x 256 pixels;
//! the histogram and six representative colours are pure and mirrored in
//! `src/appearance/themeMath.ts`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::WebviewWindow;

use crate::custom_theme_types::{ThemeError, WallpaperPalette};
use crate::ensure_main;

pub const WALLPAPER_BUFFER_CHARS: usize = 32_768;
pub const SAMPLE_EDGE: u32 = 256;
pub const SAMPLE_PIXELS: u64 = 256 * 256;
pub const MAX_COLORS: usize = 6;
pub const MIN_COLOR_DISTANCE: f64 = 40.0;

#[derive(Debug, Clone, Copy)]
struct Bin {
    count: u32,
    red_sum: u64,
    green_sum: u64,
    blue_sum: u64,
}

fn packed(red: u8, green: u8, blue: u8) -> u32 {
    (u32::from(red >> 3) << 10) | (u32::from(green >> 3) << 5) | u32::from(blue >> 3)
}

fn color_hex(red: f64, green: f64, blue: f64) -> String {
    let channel = |value: f64| -> u8 { value.round().clamp(0.0, 255.0) as u8 };
    format!("#{:02X}{:02X}{:02X}", channel(red), channel(green), channel(blue))
}

fn distance(a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let dr = f64::from(a.0) - f64::from(b.0);
    let dg = f64::from(a.1) - f64::from(b.1);
    let db = f64::from(a.2) - f64::from(b.2);
    (dr * dr + dg * dg + db * db).sqrt()
}

/// RGBA pixels -> at most six representative colours.
pub fn palette_from_pixels(rgba: &[u8], width: u32, height: u32) -> Vec<String> {
    let pixel_count = (rgba.len() / 4).min((width as usize).saturating_mul(height as usize));
    let mut bins: BTreeMap<u32, Bin> = BTreeMap::new();
    for index in 0..pixel_count {
        let offset = index * 4;
        if rgba[offset + 3] == 0 {
            continue;
        }
        let red = rgba[offset];
        let green = rgba[offset + 1];
        let blue = rgba[offset + 2];
        let entry = bins.entry(packed(red, green, blue)).or_insert(Bin {
            count: 0,
            red_sum: 0,
            green_sum: 0,
            blue_sum: 0,
        });
        entry.count += 1;
        entry.red_sum += u64::from(red);
        entry.green_sum += u64::from(green);
        entry.blue_sum += u64::from(blue);
    }
    let mut ordered: Vec<(u32, Bin)> = bins.into_iter().collect();
    ordered.sort_by(|(packed_a, a), (packed_b, b)| {
        b.count.cmp(&a.count).then_with(|| packed_a.cmp(packed_b))
    });
    let mut chosen: Vec<((u8, u8, u8), String)> = Vec::new();
    for (_, bin) in ordered {
        if bin.count == 0 {
            continue;
        }
        let red = bin.red_sum as f64 / f64::from(bin.count);
        let green = bin.green_sum as f64 / f64::from(bin.count);
        let blue = bin.blue_sum as f64 / f64::from(bin.count);
        let rgb = (red.round() as u8, green.round() as u8, blue.round() as u8);
        if chosen
            .iter()
            .any(|(existing, _)| distance(*existing, rgb) < MIN_COLOR_DISTANCE)
        {
            continue;
        }
        chosen.push((rgb, color_hex(red, green, blue)));
        if chosen.len() >= MAX_COLORS {
            break;
        }
    }
    chosen.into_iter().map(|(_, color)| color).collect()
}

#[cfg(windows)]
pub fn desktop_wallpaper_path() -> Result<PathBuf, ThemeError> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut buffer = vec![0u16; WALLPAPER_BUFFER_CHARS];
    // SAFETY: the buffer is writable for exactly the declared character count
    // and lives across the call; the API writes a terminated path or fails.
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            WALLPAPER_BUFFER_CHARS as u32,
            Some(buffer.as_mut_ptr().cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .map_err(|_| ThemeError::WallpaperUnavailable)?;
    }
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    if length == 0 {
        return Err(ThemeError::WallpaperUnavailable);
    }
    let text = String::from_utf16_lossy(&buffer[..length]);
    if text.trim().is_empty() {
        return Err(ThemeError::WallpaperUnavailable);
    }
    Ok(PathBuf::from(text))
}

#[cfg(not(windows))]
pub fn desktop_wallpaper_path() -> Result<PathBuf, ThemeError> {
    Err(ThemeError::WallpaperUnavailable)
}

pub fn palette_for_path(path: &Path) -> Result<Vec<String>, ThemeError> {
    let metadata = std::fs::metadata(path).map_err(|_| ThemeError::WallpaperUnavailable)?;
    if metadata.len() == 0 || metadata.len() > crate::custom_theme_types::MAX_BACKGROUND_SOURCE_BYTES {
        return Err(ThemeError::WallpaperUnavailable);
    }
    let file = std::fs::File::open(path).map_err(|_| ThemeError::WallpaperUnavailable)?;
    let decoded = crate::thumbnail_decode::decode_pixels(&file, SAMPLE_EDGE, SAMPLE_PIXELS)
        .map_err(|_| ThemeError::WallpaperUnavailable)?;
    if decoded.width == 0 || decoded.height == 0 {
        return Err(ThemeError::WallpaperUnavailable);
    }
    Ok(palette_from_pixels(
        &decoded.rgba,
        decoded.width,
        decoded.height,
    ))
}

pub fn read_wallpaper_palette() -> WallpaperPalette {
    let path = match desktop_wallpaper_path() {
        Ok(path) => path,
        Err(_) => {
            return WallpaperPalette {
                colors: Vec::new(),
                source_stamp: None,
                available: false,
                reason: Some("theme.wallpaper_unavailable".to_string()),
            }
        }
    };
    let stamp = fs_service::capture_source_stamp(&path).ok();
    match palette_for_path(&path) {
        Ok(colors) if !colors.is_empty() => WallpaperPalette {
            colors,
            source_stamp: stamp,
            available: true,
            reason: None,
        },
        _ => WallpaperPalette {
            colors: Vec::new(),
            source_stamp: stamp,
            available: false,
            reason: Some("theme.wallpaper_unavailable".to_string()),
        },
    }
}

#[tauri::command]
pub async fn theme_wallpaper_palette(window: WebviewWindow) -> Result<WallpaperPalette, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(read_wallpaper_palette)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_and_white_are_kept() {
        let pixels = [0u8, 0, 0, 255, 255, 255, 255, 255];
        assert_eq!(
            palette_from_pixels(&pixels, 2, 1),
            vec!["#000000".to_string(), "#FFFFFF".to_string()]
        );
    }

    #[test]
    fn equal_frequency_ties_use_packed_rgb_order() {
        // One red and one blue pixel: blue (0x0000FF) sorts before red (0xFF0000).
        let pixels = [255u8, 0, 0, 255, 0, 0, 255, 255];
        assert_eq!(
            palette_from_pixels(&pixels, 2, 1),
            vec!["#0000FF".to_string(), "#FF0000".to_string()]
        );
    }

    #[test]
    fn transparent_pixels_are_ignored() {
        let pixels = [255u8, 0, 0, 0, 0, 0, 255, 255];
        assert_eq!(palette_from_pixels(&pixels, 2, 1), vec!["#0000FF".to_string()]);
        assert!(palette_from_pixels(&[0u8; 4], 1, 1).is_empty());
    }

    #[test]
    fn representative_is_the_per_bin_mean() {
        let pixels = [0u8, 0, 0, 255, 0, 0, 4, 255];
        // Same 5-bit bin (0,0,0); mean blue is 2.
        assert_eq!(palette_from_pixels(&pixels, 2, 1), vec!["#000002".to_string()]);
    }
}
