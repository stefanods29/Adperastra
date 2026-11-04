//! Window material adapter (Step 10a D4).
//!
//! Mica and acrylic are native WebView2 window effects. A build or session
//! that cannot apply them gets a solid surface and an explicit fallback flag;
//! text and panes are never made transparent to imitate blur.

use tauri::window::{Effect, EffectsBuilder};
use tauri::WebviewWindow;

use crate::custom_theme_types::MaterialResult;
use crate::ensure_main;

#[tauri::command]
pub fn theme_apply_material(
    window: WebviewWindow,
    material: String,
) -> Result<MaterialResult, String> {
    ensure_main(window.label())?;
    let requested = match material.as_str() {
        "solid" | "mica" | "acrylic" => material,
        _ => return Err("theme.invalid".to_string()),
    };
    let effects = match requested.as_str() {
        "mica" => Some(EffectsBuilder::new().effect(Effect::Mica).build()),
        "acrylic" => Some(EffectsBuilder::new().effect(Effect::Acrylic).build()),
        _ => None,
    };
    match window.set_effects(effects) {
        Ok(()) => Ok(MaterialResult {
            applied: requested.clone(),
            requested,
            fallback: false,
        }),
        Err(_) => {
            let _ = window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
            Ok(MaterialResult {
                requested,
                applied: "solid".to_string(),
                fallback: true,
            })
        }
    }
}
