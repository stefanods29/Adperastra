//! UI scale (Step 05d): the webview's page zoom.

use tauri::WebviewWindow;

use crate::ensure_main;

/// True when `scale` is one of `UI_SCALES`.
pub fn is_ui_scale(scale: u32) -> bool {
    crate::UI_SCALES.contains(&scale)
}

/// The webview zoom for a percentage: 125 becomes 1.25.
pub fn zoom_factor(scale: u32) -> f64 {
    f64::from(scale) / 100.0
}

/// A point given in CSS pixels, as screen pixels: the window's origin plus
/// the CSS offset scaled by the display's DPI and the UI scale.
pub fn screen_point(
    origin: (i32, i32),
    css: (i32, i32),
    dpi_scale: f64,
    ui_scale: u32,
) -> (i32, i32) {
    let factor = dpi_scale * zoom_factor(ui_scale);
    (
        origin.0 + (f64::from(css.0) * factor).round() as i32,
        origin.1 + (f64::from(css.1) * factor).round() as i32,
    )
}

/// Applies the saved scale at startup, before the page paints (D5).
/// 100 % is the webview's own default, so it needs no call.
pub fn apply_startup_zoom(window: &WebviewWindow, scale: u32) {
    if is_ui_scale(scale) && scale != 100 {
        let _ = window.set_zoom(zoom_factor(scale));
    }
}

/// Sets the webview's page zoom. No disk work, so it is a plain command.
#[tauri::command]
pub fn appearance_set_zoom(window: WebviewWindow, scale: u32) -> Result<(), String> {
    ensure_main(window.label())?;
    if !is_ui_scale(scale) {
        return Err("appearance.bad_scale".to_string());
    }
    window
        .set_zoom(zoom_factor(scale))
        .map_err(|_| "appearance.other".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_scales_are_the_listed_percentages() {
        assert!(is_ui_scale(100));
        assert!(is_ui_scale(75));
        assert!(!is_ui_scale(80));
        assert!(!is_ui_scale(0));
        assert_eq!(zoom_factor(125), 1.25);
    }

    #[test]
    fn screen_point_includes_the_ui_scale() {
        assert_eq!(screen_point((100, 200), (10, 20), 1.5, 100), (115, 230));
        assert_eq!(screen_point((100, 200), (10, 20), 1.5, 200), (130, 260));
    }
}
