//! Native mirror of the manual deck-style contract (Step 22b T1).
//!
//! The TypeScript source of truth is `src/office/deck/styles/styleTypes.ts`.
//! Every value here is plain data; no engine object, path, token or document
//! content is accepted. Validation returns stable `deck_style.*` codes.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::office_edit_values::DeckTheme;

pub const DECK_STYLE_SCHEMA_VERSION: u32 = 1;
pub const DECK_STYLE_FILE_SCHEMA_VERSION: u32 = 1;
pub const DECK_STYLE_VERSION: u32 = 1;
pub const DECK_STYLE_FILE_MIME: &str = "application/vnd.adperastra.deck-style+json";
pub const MAX_USER_DECK_STYLES: usize = 64;
pub const MAX_DECK_STYLE_BYTES: usize = 64 * 1024;
pub const MAX_DECK_STYLE_CATALOG_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_DECK_STYLE_LAYOUTS: usize = 8;
pub const MAX_DECK_STYLE_NAME: usize = 60;
pub const MAX_STYLE_PREVIEW_WARNINGS: usize = 32;
pub const STYLE_PREVIEW_TTL_SECONDS: u64 = 300;
pub const INTER_FONT_FAMILY: &str = "Inter";

/// JavaScript safe-integer ceiling. Every stored counter must stay below it.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStyleGuidance {
    pub max_bullets: u8,
    pub max_words_per_bullet: u8,
    /// Nullable i18n key; built-ins carry one, user guidance may omit it.
    pub advice_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStyle {
    pub id: Uuid,
    pub builtin: bool,
    pub name_key: Option<String>,
    pub name: Option<String>,
    pub description_key: Option<String>,
    pub theme: DeckTheme,
    /// `comfortable` or `compact`; mirrors `DeckTheme.density`.
    pub density: String,
    pub guidance: DeckStyleGuidance,
    pub created_unix: u64,
    pub modified_unix: u64,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStyleCatalog {
    pub schema_version: u32,
    pub styles: Vec<DeckStyle>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStyleFile {
    pub schema_version: u32,
    pub style: DeckStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StyleWarning {
    FontMissing {
        id: Uuid,
        asset_id: String,
    },
    FontMapped {
        id: Uuid,
        from_family: String,
        to_asset_id: String,
    },
    Overflow {
        id: Uuid,
        slide_id: Uuid,
        shape_id: Uuid,
    },
    ManualFormatPreserved {
        id: Uuid,
        slide_id: Uuid,
    },
    TemplateContentOmitted {
        id: Uuid,
    },
}

impl StyleWarning {
    pub fn id(&self) -> Uuid {
        match self {
            StyleWarning::FontMissing { id, .. }
            | StyleWarning::FontMapped { id, .. }
            | StyleWarning::Overflow { id, .. }
            | StyleWarning::ManualFormatPreserved { id, .. }
            | StyleWarning::TemplateContentOmitted { id } => *id,
        }
    }

    /// Overflow and unsupported layout cannot be acknowledged away.
    pub fn is_acknowledgeable(&self) -> bool {
        !matches!(self, StyleWarning::Overflow { .. })
    }
}

/// Read a producer enum/string field without assuming whether 20a stores it as
/// a Rust enum or a `String`; both serialize to the same wire text.
fn enum_text<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|item| item.as_str().map(str::to_owned))
        .unwrap_or_default()
}

pub fn invalid() -> String {
    "deck_style.invalid".to_string()
}

pub fn too_large() -> String {
    "deck_style.too_large".to_string()
}

pub fn changed() -> String {
    "deck_style.changed".to_string()
}

fn key_ok(value: &str, max: usize) -> bool {
    let length = value.chars().count();
    length >= 1
        && length <= max
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
}

fn forbidden_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.contains('\0')
        || value.contains('<')
        || lower.contains("http:")
        || lower.contains("https:")
        || lower.contains("file:")
        || lower.contains("javascript:")
        || lower.contains("data:")
}

fn style_bytes(style: &DeckStyle) -> Result<usize, String> {
    serde_json::to_vec(style)
        .map(|bytes| bytes.len())
        .map_err(|_| invalid())
}

/// Validate one complete style. Built-ins pass; storage calls additionally
/// require `builtin == false` and a unique name.
pub fn validate_deck_style(style: &DeckStyle) -> Result<(), String> {
    if style.version > DECK_STYLE_VERSION {
        return Err("deck_style.schema_newer".to_string());
    }
    if style.version != DECK_STYLE_VERSION {
        return Err(invalid());
    }
    if !style.theme.is_valid() {
        return Err(invalid());
    }
    if !matches!(style.density.as_str(), "comfortable" | "compact") {
        return Err(invalid());
    }
    if style.theme.id != style.id || style.theme.version != DECK_STYLE_VERSION {
        return Err(invalid());
    }
    if enum_text(&style.theme.density) != style.density {
        return Err(invalid());
    }
    match (&style.name_key, &style.name) {
        (Some(key), None) => {
            if !style.builtin || !key_ok(key, 96) {
                return Err(invalid());
            }
        }
        (None, Some(name)) => {
            let length = name.chars().count();
            if style.builtin || !(1..=MAX_DECK_STYLE_NAME).contains(&length) || forbidden_text(name) {
                return Err(invalid());
            }
        }
        _ => return Err(invalid()),
    }
    if style.builtin && style.name_key.is_none() {
        return Err(invalid());
    }
    if style.builtin && (style.created_unix != 0 || style.modified_unix != 0) {
        return Err(invalid());
    }
    if style.created_unix > MAX_SAFE_INTEGER || style.modified_unix > MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    if let Some(key) = &style.description_key {
        if !key_ok(key, 96) {
            return Err(invalid());
        }
    }
    if style.guidance.max_bullets < 1 || style.guidance.max_bullets > 10 {
        return Err(invalid());
    }
    if style.guidance.max_words_per_bullet < 1 || style.guidance.max_words_per_bullet > 30 {
        return Err(invalid());
    }
    if let Some(key) = &style.guidance.advice_key {
        if !key_ok(key, 96) {
            return Err(invalid());
        }
    }
    for font in [&style.theme.heading_font, &style.theme.body_font] {
        if font.family != INTER_FONT_FAMILY || !font.embeddable || enum_text(&font.source) != "bundled" {
            return Err("deck_style.font_missing".to_string());
        }
    }
    if style.theme.name.chars().count() > MAX_DECK_STYLE_NAME {
        return Err(invalid());
    }
    let layouts = &style.theme.layouts;
    if layouts.is_empty() || layouts.len() > MAX_DECK_STYLE_LAYOUTS {
        return Err(too_large());
    }
    let mut layout_ids = std::collections::HashSet::new();
    for layout in layouts {
        if !layout_ids.insert(layout.id) {
            return Err(invalid());
        }
        if layout.name.chars().count() > MAX_DECK_STYLE_NAME {
            return Err(invalid());
        }
        let kind = enum_text(&layout.kind);
        if kind == "blank" && !layout.placeholders.is_empty() {
            return Err(invalid());
        }
        if kind != "blank" && layout.placeholders.is_empty() {
            return Err(invalid());
        }
        if layout.placeholders.len() > 16 {
            return Err(too_large());
        }
        let mut roles = std::collections::HashSet::new();
        for placeholder in &layout.placeholders {
            if !roles.insert(enum_text(&placeholder.role)) {
                return Err(invalid());
            }
            let rect = &placeholder.rect;
            if rect.x_pt < 0.0
                || rect.y_pt < 0.0
                || rect.width_pt <= 0.0
                || rect.height_pt <= 0.0
                || rect.x_pt + rect.width_pt > style.theme.slide_width_pt
                || rect.y_pt + rect.height_pt > style.theme.slide_height_pt
            {
                return Err(invalid());
            }
            if placeholder.text.size_pt < 1.0 || placeholder.text.size_pt > 400.0 {
                return Err(invalid());
            }
        }
    }
    if !layout_ids.contains(&style.theme.default_layout_id) {
        return Err(invalid());
    }
    if style_bytes(style)? > MAX_DECK_STYLE_BYTES {
        return Err(too_large());
    }
    Ok(())
}

pub fn validate_catalog(catalog: &DeckStyleCatalog) -> Result<(), String> {
    if catalog.schema_version > DECK_STYLE_SCHEMA_VERSION {
        return Err("deck_style.schema_newer".to_string());
    }
    if catalog.schema_version != DECK_STYLE_SCHEMA_VERSION {
        return Err(invalid());
    }
    if catalog.styles.len() > MAX_USER_DECK_STYLES {
        return Err(too_large());
    }
    if catalog.revision > MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for style in &catalog.styles {
        validate_deck_style(style)?;
        if style.builtin
            || crate::deck_style_catalog::is_builtin_style_id(style.id)
        {
            return Err(invalid());
        }
        if !ids.insert(style.id) {
            return Err(invalid());
        }
        let key = style
            .name
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        if !names.insert(key) {
            return Err(invalid());
        }
    }
    let bytes = serde_json::to_vec(catalog).map_err(|_| invalid())?;
    if bytes.len() > MAX_DECK_STYLE_CATALOG_BYTES {
        return Err(too_large());
    }
    Ok(())
}
