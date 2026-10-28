//! Visual styling for the setup windows (Step 01a).
//!
//! Applies the Adperastra accent colour and neutral surfaces on top of
//! egui's built-in light/dark visuals, plus the bundled Inter font when
//! it is present next to the executable.

use egui::{
    Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, TextStyle, Visuals,
};
use std::path::Path;
use std::sync::Arc;

/// Accent colour used for selections and progress (`#0067C0`).
pub const ACCENT: Color32 = Color32::from_rgb(0, 103, 192);

/// Apply visuals and text sizes for the given mode to `ctx`.
pub fn apply(ctx: &egui::Context, dark: bool) {
    let mut visuals = if dark {
        Visuals::dark()
    } else {
        Visuals::light()
    };
    let surface = if dark {
        Color32::from_rgb(0x20, 0x20, 0x20)
    } else {
        Color32::WHITE
    };
    visuals.window_fill = surface;
    visuals.panel_fill = surface;
    visuals.selection.bg_fill = ACCENT;
    visuals.window_corner_radius = CornerRadius::same(10);
    visuals.menu_corner_radius = CornerRadius::same(4);
    let radius = CornerRadius::same(4);
    visuals.widgets.noninteractive.corner_radius = radius;
    visuals.widgets.inactive.corner_radius = radius;
    visuals.widgets.hovered.corner_radius = radius;
    visuals.widgets.active.corner_radius = radius;
    visuals.widgets.open.corner_radius = radius;
    ctx.set_visuals(visuals);
    ctx.style_mut(|style| {
        style
            .text_styles
            .insert(TextStyle::Body, FontId::new(13.0, FontFamily::Proportional));
        style.text_styles.insert(
            TextStyle::Heading,
            FontId::new(18.0, FontFamily::Proportional),
        );
        style.text_styles.insert(
            TextStyle::Button,
            FontId::new(13.0, FontFamily::Proportional),
        );
    });
}

/// Load `payload/fonts/Inter.ttf` under `base_dir` as the primary
/// proportional font, if present. All failures are ignored: the
/// built-in egui fonts are an acceptable fallback.
pub fn install_fonts(ctx: &egui::Context, base_dir: &Path) {
    let path = base_dir.join("payload").join("fonts").join("Inter.ttf");
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return,
    };
    let mut defs = FontDefinitions::default();
    defs.font_data
        .insert("inter".to_owned(), Arc::new(FontData::from_owned(bytes)));
    defs.families
        .entry(FontFamily::Proportional)
        .or_default()
        .insert(0, "inter".to_owned());
    ctx.set_fonts(defs);
}

/// Best guess at whether the OS is currently in dark mode.
pub fn system_dark(ctx: &egui::Context) -> bool {
    matches!(ctx.system_theme(), Some(egui::Theme::Dark))
}
