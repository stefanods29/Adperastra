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

/// Bind every egui text family before the first frame. egui's built-in
/// fonts are turned off (their Ubuntu font license is not on the allowed
/// list), so there is no automatic fallback. Order: the bundled Inter
/// (`payload/fonts/Inter.ttf` under `base_dir`), else the Windows UI font
/// installed on the PC, else any TrueType font in the Windows Fonts folder.
/// System fonts are read at run time and never bundled; they matter exactly
/// when Inter is missing, which is when this window runs to repair it.
pub fn install_fonts(ctx: &egui::Context, base_dir: &Path) {
    let windows = std::env::var_os("WINDIR").unwrap_or_else(|| r"C:\Windows".into());
    let fonts_dir = Path::new(&windows).join("Fonts");
    let mut candidates = vec![
        base_dir.join("payload").join("fonts").join("Inter.ttf"),
        fonts_dir.join("segoeui.ttf"),
    ];
    if let Ok(entries) = std::fs::read_dir(&fonts_dir) {
        let mut others: Vec<_> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("ttf")))
            .collect();
        others.sort();
        candidates.extend(others);
    }
    let Some(bytes) = candidates.iter().find_map(|p| std::fs::read(p).ok()) else {
        // Only reachable on a Windows install with no readable fonts at
        // all; the window then has no text, but the repair still runs.
        return;
    };
    let mut defs = FontDefinitions::empty();
    defs.font_data
        .insert("ui".to_owned(), Arc::new(FontData::from_owned(bytes)));
    defs.families
        .insert(FontFamily::Proportional, vec!["ui".to_owned()]);
    defs.families
        .insert(FontFamily::Monospace, vec!["ui".to_owned()]);
    ctx.set_fonts(defs);
}

/// Best guess at whether the OS is currently in dark mode.
pub fn system_dark(ctx: &egui::Context) -> bool {
    matches!(ctx.system_theme(), Some(egui::Theme::Dark))
}
