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
    // egui's built-in fonts are turned off (their Ubuntu font license is not
    // on the allowed list), so every text family must be bound here before
    // the first frame. The bundled Inter comes first; the Windows UI font is
    // read from the system (never bundled) for when Inter is missing, which
    // is exactly when this window runs to repair it.
    let mut defs = FontDefinitions::empty();
    let windows = std::env::var_os("WINDIR").unwrap_or_else(|| r"C:\Windows".into());
    let candidates = [
        (
            "inter",
            base_dir.join("payload").join("fonts").join("Inter.ttf"),
        ),
        (
            "system",
            Path::new(&windows).join("Fonts").join("segoeui.ttf"),
        ),
        (
            "system-mono",
            Path::new(&windows).join("Fonts").join("consola.ttf"),
        ),
    ];
    let mut names = Vec::new();
    for (name, path) in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            defs.font_data
                .insert(name.to_owned(), Arc::new(FontData::from_owned(bytes)));
            names.push(name.to_owned());
        }
    }
    if names.is_empty() {
        return;
    }
    let mut mono = names.clone();
    mono.sort_by_key(|n| n != "system-mono");
    defs.families.insert(FontFamily::Proportional, names);
    defs.families.insert(FontFamily::Monospace, mono);
    ctx.set_fonts(defs);
}

/// Best guess at whether the OS is currently in dark mode.
pub fn system_dark(ctx: &egui::Context) -> bool {
    matches!(ctx.system_theme(), Some(egui::Theme::Dark))
}
