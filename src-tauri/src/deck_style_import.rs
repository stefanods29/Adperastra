//! Template-to-style import (Step 22b T5, D8).
//!
//! The approved 20a binding inspects/extracts a template through the supplied
//! host. This module never parses ZIP/XML in the main process, never imports
//! template text/notes/images/macros and never guesses a file format. The
//! interactive UI path uses 22a `importDeckTheme`; this command is the typed
//! one-shot path with the exact `deck_style_import_start` signature.
#![allow(dead_code)]


use std::sync::{Arc, OnceLock, RwLock};

use convert::ConversionInput;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};

use crate::deck_style_types::{
    invalid, validate_deck_style, DeckStyle, DeckStyleGuidance, DECK_STYLE_VERSION,
    INTER_FONT_FAMILY,
};
use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_values::DeckTheme;
use crate::ensure_main;

/// Only the two licensed asset IDs may be a mapping target.
pub const DECK_STYLE_FONT_ASSET_IDS: [&str; 2] = ["inter-regular", "inter-bold"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StyleFontMapping {
    pub from_family: String,
    pub to_asset_id: String,
}

pub trait DeckStyleTemplateHost: Send + Sync {
    fn import_template_style(
        &self,
        input: &ConversionInput,
        name: &str,
        font_map: &[StyleFontMapping],
    ) -> Result<DeckTheme, String>;
}

static TEMPLATE_HOST: OnceLock<RwLock<Option<Arc<dyn DeckStyleTemplateHost>>>> = OnceLock::new();

fn host_slot() -> &'static RwLock<Option<Arc<dyn DeckStyleTemplateHost>>> {
    TEMPLATE_HOST.get_or_init(|| RwLock::new(None))
}

pub fn register_deck_style_template_host(host: Arc<dyn DeckStyleTemplateHost>) {
    if let Ok(mut slot) = host_slot().write() {
        *slot = Some(host);
    }
}

fn current_host() -> Result<Arc<dyn DeckStyleTemplateHost>, String> {
    host_slot()
        .read()
        .map_err(|_| "deck_style.failed".to_string())?
        .clone()
        .ok_or_else(|| "office_edit.engine_missing".to_string())
}

fn check_request_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(invalid())
    }
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let length = name.chars().count();
    if !(1..=60).contains(&length) || name.trim() != name {
        return Err(invalid());
    }
    if name.contains('\0') || name.contains('<') || name.to_ascii_lowercase().contains("http") {
        return Err(invalid());
    }
    Ok(())
}

pub fn validate_font_map(font_map: &[StyleFontMapping]) -> Result<(), String> {
    if font_map.len() > 32 {
        return Err(invalid());
    }
    let mut families = std::collections::HashSet::new();
    for mapping in font_map {
        let length = mapping.from_family.chars().count();
        if !(1..=128).contains(&length) || !families.insert(mapping.from_family.to_lowercase()) {
            return Err(invalid());
        }
        if !DECK_STYLE_FONT_ASSET_IDS.contains(&mapping.to_asset_id.as_str()) {
            return Err(invalid());
        }
    }
    Ok(())
}

/// Turn the extracted theme into a normalized user style. Layout names become
/// fixed i18n keys so no template words reach the catalog.
pub fn style_from_theme(theme: DeckTheme, name: &str, now: u64) -> Result<DeckStyle, String> {
    validate_name(name)?;
    let mut theme = theme;
    if theme.layouts.is_empty() || theme.layouts.len() > 8 {
        return Err("deck_style.unsupported".to_string());
    }
    let mut kinds = std::collections::HashSet::new();
    for layout in &mut theme.layouts {
        let kind = serde_json::to_value(layout.kind)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(invalid)?;
        if !kinds.insert(kind.clone()) {
            return Err(invalid());
        }
        layout.name = format!("deckStyle.layout.{kind}");
    }
    theme.name = name.to_string();
    theme.density = serde_json::from_str("\"comfortable\"").map_err(|_| invalid())?;
    let font_ready = |font: &crate::office_edit_values::OfficeFont| {
        font.family == INTER_FONT_FAMILY
            && font.embeddable
            && serde_json::to_value(font.source)
                .ok()
                .and_then(|value| value.as_str().map(|text| text == "bundled"))
                .unwrap_or(false)
    };
    if !font_ready(&theme.heading_font) || !font_ready(&theme.body_font) {
        return Err("deck_style.font_missing".to_string());
    }
    let style = DeckStyle {
        id: theme.id,
        builtin: false,
        name_key: None,
        name: Some(name.to_string()),
        description_key: None,
        theme,
        density: "comfortable".to_string(),
        guidance: DeckStyleGuidance {
            max_bullets: 6,
            max_words_per_bullet: 12,
            advice_key: None,
        },
        created_unix: now,
        modified_unix: now,
        version: DECK_STYLE_VERSION,
    };
    validate_deck_style(&style)?;
    Ok(style)
}

#[tauri::command]
pub fn deck_style_import_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: ConversionInput,
    name: String,
    font_map: Vec<StyleFontMapping>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    check_request_id(&request_id)?;
    validate_name(&name)?;
    validate_font_map(&font_map)?;
    let host = current_host()?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |_context| {
        let theme = host.import_template_style(&input, &name, &font_map)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let style = style_from_theme(theme, &name, now)?;
        serde_json::to_value(style).map_err(|_| invalid())
    });
    Ok(())
}
