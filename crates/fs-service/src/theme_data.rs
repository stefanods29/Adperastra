//! Bounded custom-theme data and validation (Step 10a, custom-theme-1).
//!
//! This is pure data: no file I/O, no Tauri types. The Tauri mirror
//! `src-tauri/src/custom_theme_types.rs` reexports these definitions so the
//! wire and validation shapes cannot drift.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::theme_tokens::{
    is_editor_token, is_theme_token, numeric_token_css, theme_variable_name, token_allows_alpha,
    token_bounds, token_kind, TokenKind,
};

pub const THEME_SCHEMA_VERSION: u32 = 1;
pub const MAX_THEMES: usize = 100;
pub const MAX_THEME_BYTES: usize = 128 * 1024;
pub const MAX_THEME_STORAGE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_THEME_NAME: usize = 60;
pub const MAX_THEME_TOKENS: usize = 512;
pub const MAX_EDITOR_TOKENS: usize = 64;
pub const MAX_THEME_STYLES: usize = 32;
pub const MAX_FONT_NAME: usize = 128;
pub const MAX_THEME_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_BACKGROUND_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_BACKGROUND_EDGE: u32 = 4096;
pub const MAX_BACKGROUND_PIXELS: u64 = 16_000_000;
pub const MAX_TYPE_ACCENTS: usize = 7;
/// The largest integer JavaScript represents exactly. `modified_unix` is
/// declared as a safe u64, so a larger value must not cross the wire.
pub const MAX_SAFE_UNIX: u64 = 9_007_199_254_740_991;

pub const THEME_ID_LIGHT: &str = "light";
pub const THEME_ID_DARK: &str = "dark";
pub const BUILTIN_THEME_IDS: &[&str] =
    &["light", "bright", "paper", "dark", "amoled", "highContrast"];
pub const THEME_TYPE_IDS: &[&str] = &[
    "explorer",
    "excel",
    "word",
    "pdf",
    "image",
    "powerpoint",
    "group",
];
pub const THEME_STYLE_SELECTORS: &[&str] = &[
    ".adp-window",
    ".adp-tab",
    ".adp-command-bar",
    ".adp-filelist-scroll",
];
pub const THEME_STYLE_PROPERTIES: &[&str] = &[
    "border-radius",
    "padding-inline",
    "padding-block",
    "letter-spacing",
    "line-height",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThemeError {
    Invalid,
    Limit,
    Io,
    Unavailable,
    WallpaperUnavailable,
    Contrast,
}

impl ThemeError {
    pub fn code(&self) -> &'static str {
        match self {
            ThemeError::Invalid => "theme.invalid",
            ThemeError::Limit => "theme.limit",
            ThemeError::Io => "theme.io",
            ThemeError::Unavailable => "theme.unavailable",
            ThemeError::WallpaperUnavailable => "theme.wallpaper_unavailable",
            ThemeError::Contrast => "theme.contrast",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ThemeValue {
    String(String),
    Number(f64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ThemeRef {
    Builtin { id: String },
    Custom { id: String },
}

impl ThemeRef {
    pub fn builtin(id: &str) -> Self {
        ThemeRef::Builtin { id: id.to_string() }
    }

    pub fn custom(id: &str) -> Self {
        ThemeRef::Custom { id: id.to_string() }
    }

    pub fn custom_id(&self) -> Option<&str> {
        match self {
            ThemeRef::Custom { id } => Some(id),
            ThemeRef::Builtin { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThemeStyleRule {
    pub selector: String,
    pub property: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThemeBackground {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub fit: String,
    pub opacity: f64,
    pub blur_px: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomTheme {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub scheme: String,
    #[serde(default)]
    pub tokens: BTreeMap<String, ThemeValue>,
    #[serde(default)]
    pub editor_tokens: BTreeMap<String, ThemeValue>,
    pub material: String,
    pub ui_font: String,
    pub ui_font_size_px: u8,
    pub tab_shape: String,
    pub icon_mode: String,
    #[serde(default)]
    pub styles: Vec<ThemeStyleRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<ThemeBackground>,
    #[serde(default)]
    pub modified_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomThemeSummary {
    pub id: String,
    pub name: String,
    pub scheme: String,
    pub modified_unix: u64,
    pub has_background: bool,
}

fn default_day() -> ThemeRef {
    ThemeRef::builtin(THEME_ID_LIGHT)
}

fn default_night() -> ThemeRef {
    ThemeRef::builtin(THEME_ID_DARK)
}

fn default_manual_scheme() -> String {
    "light".to_string()
}

fn default_day_start() -> u16 {
    420
}

fn default_night_start() -> u16 {
    1140
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeCustomSettings {
    #[serde(default = "default_day")]
    pub day: ThemeRef,
    #[serde(default = "default_night")]
    pub night: ThemeRef,
    #[serde(default = "default_windows")]
    pub mode: String,
    #[serde(default = "default_manual_scheme")]
    pub manual_scheme: String,
    #[serde(default = "default_day_start")]
    pub day_start_minute: u16,
    #[serde(default = "default_night_start")]
    pub night_start_minute: u16,
    #[serde(default)]
    pub follow_wallpaper: bool,
    #[serde(default)]
    pub type_accents: BTreeMap<String, String>,
}

fn default_windows() -> String {
    "windows".to_string()
}

impl Default for ThemeCustomSettings {
    fn default() -> Self {
        Self {
            day: default_day(),
            night: default_night(),
            mode: default_windows(),
            manual_scheme: default_manual_scheme(),
            day_start_minute: default_day_start(),
            night_start_minute: default_night_start(),
            follow_wallpaper: false,
            type_accents: BTreeMap::new(),
        }
    }
}

impl ThemeCustomSettings {
    /// Schema 27 -> 28: preserve the actual legacy light/dark choices. An id
    /// that was not a built-in falls back to the matching default, so the
    /// produced settings always pass `validate_theme_custom_settings`.
    pub fn from_legacy(light_theme: &str, dark_theme: &str, legacy_mode: &str) -> Self {
        let (mode, manual_scheme) = match legacy_mode {
            "light" => ("manual", "light"),
            "dark" => ("manual", "dark"),
            _ => ("windows", "light"),
        };
        let day = if BUILTIN_THEME_IDS.contains(&light_theme) {
            light_theme
        } else {
            THEME_ID_LIGHT
        };
        let night = if BUILTIN_THEME_IDS.contains(&dark_theme) {
            dark_theme
        } else {
            THEME_ID_DARK
        };
        Self {
            day: ThemeRef::builtin(day),
            night: ThemeRef::builtin(night),
            mode: mode.to_string(),
            manual_scheme: manual_scheme.to_string(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThemeRuntime {
    pub requested: ThemeRef,
    pub applied: ThemeRef,
    pub scheme: String,
    pub material_requested: String,
    pub material_applied: String,
    pub temporary_override: bool,
    pub warning_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperPalette {
    pub colors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_stamp: Option<crate::SourceStamp>,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub fn is_canonical_uuid(value: &str) -> bool {
    if value.len() != 36 || !value.contains('-') {
        return false;
    }
    uuid::Uuid::parse_str(value)
        .map(|parsed| parsed.hyphenated().to_string() == value.to_ascii_lowercase())
        .unwrap_or(false)
}

pub fn is_hex_color(value: &str, opaque: bool) -> bool {
    let length_ok = value.len() == 7 || (!opaque && value.len() == 9);
    length_ok && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn parse_css_color(value: &str) -> Option<(u8, u8, u8, u8)> {
    let text = value.trim();
    if text.is_empty() || text.len() > 64 {
        return None;
    }
    let lower = text.to_ascii_lowercase();
    let inner = lower
        .strip_prefix("rgba(")
        .or_else(|| lower.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 3 && parts.len() != 4 {
        return None;
    }
    let channel = |part: &str| -> Option<u8> {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        u8::try_from(part.parse::<u16>().ok()?).ok()
    };
    let red = channel(parts[0])?;
    let green = channel(parts[1])?;
    let blue = channel(parts[2])?;
    let alpha = match parts.get(3) {
        None => 255,
        Some(part) => {
            if part.is_empty()
                || part.len() > 8
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'.')
            {
                return None;
            }
            let number: f64 = part.parse().ok()?;
            if !number.is_finite() || !(0.0..=1.0).contains(&number) {
                return None;
            }
            (number * 255.0).round().clamp(0.0, 255.0) as u8
        }
    };
    Some((red, green, blue, alpha))
}

/// Canonical `#RRGGBB` or `#RRGGBBAA` (upper case) from a stored hex value or
/// the built-in token files' `rgb()`/`rgba()` form. The result is always a hex
/// color, so a built-in snapshot can become a valid draft token and generated
/// CSS never contains caller-provided syntax.
pub fn normalize_theme_color(value: &str) -> Option<String> {
    if is_hex_color(value, false) {
        return Some(value.to_ascii_uppercase());
    }
    let (red, green, blue, alpha) = parse_css_color(value)?;
    Some(if alpha == 255 {
        format!("#{red:02X}{green:02X}{blue:02X}")
    } else {
        format!("#{red:02X}{green:02X}{blue:02X}{alpha:02X}")
    })
}

/// The CSS value for one token, using the same bounded forms as
/// `themeTokenCss`: normalized upper-case hex for colors (alpha only where the
/// whitelist allows it) and a bounded `px` number for font-size, radius and
/// space. Unknown paths, wrong value kinds and out-of-bounds numbers are
/// refused, so a declaration can never carry arbitrary CSS text.
pub fn theme_token_css(path: &str, value: &ThemeValue) -> Option<String> {
    match (token_kind(path), value) {
        (Some(TokenKind::Color), ThemeValue::String(color)) => {
            let normalized = normalize_theme_color(color)?;
            if normalized.len() == 9 && !token_allows_alpha(path) {
                return None;
            }
            Some(normalized)
        }
        (Some(_), ThemeValue::Number(number)) => numeric_token_css(path, *number),
        _ => None,
    }
}

/// Generate the bounded `(custom property, CSS value)` pairs for one token
/// map. The map is validated first, so the list is limited by the whitelist
/// and by `MAX_THEME_TOKENS`/`MAX_EDITOR_TOKENS` and contains no raw CSS.
pub fn theme_token_declarations(
    tokens: &BTreeMap<String, ThemeValue>,
    editor: bool,
) -> Result<Vec<(String, String)>, ThemeError> {
    let max = if editor {
        MAX_EDITOR_TOKENS
    } else {
        MAX_THEME_TOKENS
    };
    validate_tokens(tokens, max, editor)?;
    let mut declarations = Vec::with_capacity(tokens.len());
    for (path, value) in tokens {
        let name = theme_variable_name(path).ok_or(ThemeError::Invalid)?;
        let css = theme_token_css(path, value).ok_or(ThemeError::Invalid)?;
        declarations.push((name, css));
    }
    Ok(declarations)
}

fn validate_color(path: &str, value: &str) -> Result<(), ThemeError> {
    let opaque = !token_allows_alpha(path);
    if !is_hex_color(value, opaque) {
        return Err(ThemeError::Invalid);
    }
    Ok(())
}

pub fn is_valid_theme_name(value: &str) -> bool {
    let count = value.chars().count();
    value == value.trim()
        && (1..=MAX_THEME_NAME).contains(&count)
        && value.chars().all(|character| {
            let code = character as u32;
            code >= 0x20 && code != 0x7f
        })
}

pub fn is_safe_font_family(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_FONT_NAME
        && !value.chars().any(|character| {
            character.is_control() || matches!(character, ';' | '{' | '}' | '<' | '>' | '"' | '\\')
        })
}

fn validate_tokens(
    tokens: &BTreeMap<String, ThemeValue>,
    max: usize,
    editor: bool,
) -> Result<(), ThemeError> {
    if tokens.len() > max {
        return Err(ThemeError::Limit);
    }
    for (path, value) in tokens {
        if editor {
            if !is_editor_token(path) {
                return Err(ThemeError::Invalid);
            }
        } else if !is_theme_token(path) {
            return Err(ThemeError::Invalid);
        }
        match (token_kind(path), value) {
            (Some(TokenKind::Color), ThemeValue::String(color)) => validate_color(path, color)?,
            (Some(TokenKind::Color), ThemeValue::Number(_)) => return Err(ThemeError::Invalid),
            (Some(_), ThemeValue::Number(number)) => {
                if !number.is_finite() {
                    return Err(ThemeError::Invalid);
                }
                let (min, max) = token_bounds(path).ok_or(ThemeError::Invalid)?;
                if *number < min || *number > max {
                    return Err(ThemeError::Invalid);
                }
            }
            (Some(_), ThemeValue::String(_)) => return Err(ThemeError::Invalid),
            (None, _) => return Err(ThemeError::Invalid),
        }
    }
    Ok(())
}

pub fn is_valid_style_rule(rule: &ThemeStyleRule) -> bool {
    if !THEME_STYLE_SELECTORS.contains(&rule.selector.as_str()) {
        return false;
    }
    if !THEME_STYLE_PROPERTIES.contains(&rule.property.as_str()) {
        return false;
    }
    if !rule.value.is_finite() {
        return false;
    }
    let expected_unit = if rule.property == "line-height" {
        "ratio"
    } else {
        "px"
    };
    if rule.unit != expected_unit {
        return false;
    }
    match rule.property.as_str() {
        "border-radius" => (0.0..=16.0).contains(&rule.value),
        "padding-inline" | "padding-block" => (0.0..=24.0).contains(&rule.value),
        "letter-spacing" => (0.0..=2.0).contains(&rule.value),
        "line-height" => (1.0..=2.0).contains(&rule.value),
        _ => false,
    }
}

fn parse_hex(value: &str) -> Option<(f64, f64, f64)> {
    if !value.is_ascii() || !value.starts_with('#') || (value.len() != 7 && value.len() != 9) {
        return None;
    }
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&value[range], 16).ok();
    Some((
        f64::from(parse(1..3)?),
        f64::from(parse(3..5)?),
        f64::from(parse(5..7)?),
    ))
}

/// `modified_unix` and summary timestamps must stay exactly representable in
/// JavaScript; the TypeScript normalizer already drops larger values.
pub fn is_safe_unix(value: u64) -> bool {
    value <= MAX_SAFE_UNIX
}

fn linear_channel(channel: f64) -> f64 {
    let value = channel / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

pub fn contrast_ratio(first: &str, second: &str) -> Option<f64> {
    let (r1, g1, b1) = parse_hex(first)?;
    let (r2, g2, b2) = parse_hex(second)?;
    let luminance = |red: f64, green: f64, blue: f64| {
        0.2126 * linear_channel(red)
            + 0.7152 * linear_channel(green)
            + 0.0722 * linear_channel(blue)
    };
    let a = luminance(r1, g1, b1);
    let b = luminance(r2, g2, b2);
    let lighter = a.max(b);
    let darker = a.min(b);
    Some((lighter + 0.05) / (darker + 0.05))
}

fn token_color<'a>(theme: &'a CustomTheme, path: &str) -> Option<&'a str> {
    match theme.tokens.get(path) {
        Some(ThemeValue::String(value)) => Some(value),
        _ => None,
    }
}

/// The same contrast pairs the editor checks. Missing pairs fall back to the
/// built-in snapshot, so only fully provided pairs are enforced here.
pub fn validate_theme_contrast(theme: &CustomTheme) -> Result<(), ThemeError> {
    const PAIRS: &[(&str, &str, f64)] = &[
        ("color.text.primary", "color.surface.window", 4.5),
        ("color.text.primary", "color.surface.selectedRow", 4.5),
        ("color.text.secondary", "color.surface.window", 4.5),
        ("color.text.bodyMuted", "color.surface.window", 4.5),
        ("color.text.onAccent", "color.accent.explorer", 4.5),
        ("color.accent.explorer", "color.surface.window", 3.0),
    ];
    for (foreground, background, minimum) in PAIRS {
        let (Some(first), Some(second)) = (
            token_color(theme, foreground),
            token_color(theme, background),
        ) else {
            continue;
        };
        if contrast_ratio(first, second).is_some_and(|ratio| ratio + 1e-9 < *minimum) {
            return Err(ThemeError::Contrast);
        }
    }
    Ok(())
}

/// A background may reference only an owned asset UUID, never a user path.
/// The optional reference is resolved by the native store; a theme file that
/// carries anything else (separators, `..`, a drive letter) is refused.
pub fn validate_theme_background(background: &ThemeBackground) -> Result<(), ThemeError> {
    if let Some(asset_id) = &background.asset_id {
        if !is_canonical_uuid(asset_id) {
            return Err(ThemeError::Invalid);
        }
    }
    if !matches!(background.fit.as_str(), "fill" | "fit" | "tile") {
        return Err(ThemeError::Invalid);
    }
    if !background.opacity.is_finite() || !(0.0..=0.5).contains(&background.opacity) {
        return Err(ThemeError::Invalid);
    }
    if background.blur_px > 32 {
        return Err(ThemeError::Invalid);
    }
    Ok(())
}

pub fn validate_custom_theme(theme: &CustomTheme) -> Result<(), ThemeError> {
    if theme.schema_version != THEME_SCHEMA_VERSION {
        return Err(ThemeError::Invalid);
    }
    if !is_canonical_uuid(&theme.id) || !is_valid_theme_name(&theme.name) {
        return Err(ThemeError::Invalid);
    }
    if !matches!(theme.scheme.as_str(), "light" | "dark") {
        return Err(ThemeError::Invalid);
    }
    if !is_safe_unix(theme.modified_unix) {
        return Err(ThemeError::Invalid);
    }
    validate_tokens(&theme.tokens, MAX_THEME_TOKENS, false)?;
    validate_tokens(&theme.editor_tokens, MAX_EDITOR_TOKENS, true)?;
    if !matches!(theme.material.as_str(), "solid" | "mica" | "acrylic") {
        return Err(ThemeError::Invalid);
    }
    if !is_safe_font_family(&theme.ui_font) {
        return Err(ThemeError::Invalid);
    }
    if !(10..=24).contains(&theme.ui_font_size_px) {
        return Err(ThemeError::Invalid);
    }
    if !matches!(theme.tab_shape.as_str(), "square" | "rounded" | "pill") {
        return Err(ThemeError::Invalid);
    }
    if !matches!(theme.icon_mode.as_str(), "lucide" | "system") {
        return Err(ThemeError::Invalid);
    }
    if theme.styles.len() > MAX_THEME_STYLES || !theme.styles.iter().all(is_valid_style_rule) {
        return Err(ThemeError::Invalid);
    }
    validate_theme_contrast(theme)?;
    if let Some(background) = &theme.background {
        validate_theme_background(background)?;
    }
    validate_theme_size(theme)
}

/// Serialized size limit; checked against the pretty JSON the app-owned store
/// writes, so validation and persistence apply the same 128 KiB bound.
pub fn validate_theme_size(theme: &CustomTheme) -> Result<(), ThemeError> {
    let bytes = serde_json::to_vec_pretty(theme).map_err(|_| ThemeError::Invalid)?;
    if bytes.len() > MAX_THEME_BYTES {
        return Err(ThemeError::Limit);
    }
    Ok(())
}

pub fn validate_theme_ref(reference: &ThemeRef) -> Result<(), ThemeError> {
    match reference {
        ThemeRef::Builtin { id } if BUILTIN_THEME_IDS.contains(&id.as_str()) => Ok(()),
        ThemeRef::Custom { id } if is_canonical_uuid(id) => Ok(()),
        _ => Err(ThemeError::Invalid),
    }
}

pub fn validate_theme_custom_settings(settings: &ThemeCustomSettings) -> Result<(), ThemeError> {
    validate_theme_ref(&settings.day)?;
    validate_theme_ref(&settings.night)?;
    if !matches!(settings.mode.as_str(), "manual" | "windows" | "clock") {
        return Err(ThemeError::Invalid);
    }
    if !matches!(settings.manual_scheme.as_str(), "light" | "dark") {
        return Err(ThemeError::Invalid);
    }
    if settings.day_start_minute > 1439
        || settings.night_start_minute > 1439
        || settings.day_start_minute == settings.night_start_minute
    {
        return Err(ThemeError::Invalid);
    }
    if settings.type_accents.len() > MAX_TYPE_ACCENTS {
        return Err(ThemeError::Invalid);
    }
    for (id, color) in &settings.type_accents {
        if !THEME_TYPE_IDS.contains(&id.as_str()) || !is_hex_color(color, true) {
            return Err(ThemeError::Invalid);
        }
    }
    Ok(())
}

/// Remove a custom reference after its theme was deleted. Returns whether
/// anything changed; built-in fallbacks are the light and dark defaults.
pub fn fallback_theme_settings(settings: &mut ThemeCustomSettings, removed_id: &str) -> bool {
    let mut changed = false;
    if settings.day.custom_id() == Some(removed_id) {
        settings.day = default_day();
        changed = true;
    }
    if settings.night.custom_id() == Some(removed_id) {
        settings.night = default_night();
        changed = true;
    }
    changed
}

pub fn theme_summary(theme: &CustomTheme) -> CustomThemeSummary {
    CustomThemeSummary {
        id: theme.id.clone(),
        name: theme.name.clone(),
        scheme: theme.scheme.clone(),
        modified_unix: theme.modified_unix,
        has_background: theme.background.is_some(),
    }
}

/// Bound the catalog the same way its file is written: at most `MAX_THEMES`
/// entries, every field valid, and at most `MAX_THEME_BYTES` of pretty JSON.
pub fn validate_summary_list(summaries: &[CustomThemeSummary]) -> Result<(), ThemeError> {
    if summaries.len() > MAX_THEMES {
        return Err(ThemeError::Limit);
    }
    for summary in summaries {
        if !is_canonical_uuid(&summary.id)
            || !is_valid_theme_name(&summary.name)
            || !matches!(summary.scheme.as_str(), "light" | "dark")
            || !is_safe_unix(summary.modified_unix)
        {
            return Err(ThemeError::Invalid);
        }
    }
    let bytes = serde_json::to_vec_pretty(summaries).map_err(|_| ThemeError::Invalid)?;
    if bytes.len() > MAX_THEME_BYTES {
        return Err(ThemeError::Limit);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme() -> CustomTheme {
        CustomTheme {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            name: "Example".to_string(),
            scheme: "light".to_string(),
            tokens: BTreeMap::new(),
            editor_tokens: BTreeMap::new(),
            material: "solid".to_string(),
            ui_font: "Inter".to_string(),
            ui_font_size_px: 12,
            tab_shape: "rounded".to_string(),
            icon_mode: "lucide".to_string(),
            styles: Vec::new(),
            background: None,
            modified_unix: 0,
        }
    }

    #[test]
    fn legacy_day_night_refs_preserved() {
        let settings = ThemeCustomSettings::from_legacy("paper", "amoled", "dark");
        assert_eq!(settings.day, ThemeRef::builtin("paper"));
        assert_eq!(settings.night, ThemeRef::builtin("amoled"));
        assert_eq!(settings.mode, "manual");
        assert_eq!(settings.manual_scheme, "dark");
    }

    #[test]
    fn unknown_token_rejected() {
        let mut value = theme();
        value.tokens.insert(
            "color.nope".to_string(),
            ThemeValue::String("#FFFFFF".to_string()),
        );
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Invalid));
    }

    #[test]
    fn url_style_rejected() {
        let mut value = theme();
        value.styles.push(ThemeStyleRule {
            selector: ".adp-window".to_string(),
            property: "border-radius".to_string(),
            value: 8.0,
            unit: "px".to_string(),
        });
        assert!(validate_custom_theme(&value).is_ok());
        value.styles[0].value = f64::NAN;
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Invalid));
        value.styles[0].value = 8.0;
        value.styles[0].selector = ".adp-window{background:url(x)}".to_string();
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Invalid));
    }

    #[test]
    fn unreadable_contrast_is_refused() {
        let mut value = theme();
        value.tokens.insert(
            "color.text.primary".to_string(),
            ThemeValue::String("#FFFFFF".to_string()),
        );
        value.tokens.insert(
            "color.surface.window".to_string(),
            ThemeValue::String("#FFFFFF".to_string()),
        );
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Contrast));
    }

    #[test]
    fn remove_active_theme_falls_back() {
        let mut settings = ThemeCustomSettings::default();
        let id = uuid::Uuid::new_v4().to_string();
        settings.day = ThemeRef::custom(&id);
        settings.night = ThemeRef::custom(&id);
        assert!(fallback_theme_settings(&mut settings, &id));
        assert_eq!(settings.day, ThemeRef::builtin("light"));
        assert_eq!(settings.night, ThemeRef::builtin("dark"));
        assert!(!fallback_theme_settings(&mut settings, &id));
    }

    #[test]
    fn one_hundred_first_theme_is_refused_by_the_catalog_bound() {
        assert_eq!(MAX_THEMES, 100);
        let summary = CustomThemeSummary {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Example".to_string(),
            scheme: "light".to_string(),
            modified_unix: 0,
            has_background: false,
        };
        assert!(validate_summary_list(&vec![summary.clone(); MAX_THEMES]).is_ok());
        assert_eq!(
            validate_summary_list(&vec![summary; MAX_THEMES + 1]),
            Err(ThemeError::Limit)
        );
    }

    #[test]
    fn legacy_invalid_ids_fall_back_to_builtin_defaults() {
        let settings = ThemeCustomSettings::from_legacy("../dark", "nope", "light");
        assert_eq!(settings.day, ThemeRef::builtin("light"));
        assert_eq!(settings.night, ThemeRef::builtin("dark"));
        assert!(validate_theme_custom_settings(&settings).is_ok());
    }

    #[test]
    fn background_asset_references_are_uuids_not_paths() {
        let asset_id = uuid::Uuid::new_v4().to_string();
        let mut background = ThemeBackground {
            asset_id: Some(asset_id),
            fit: "fill".to_string(),
            opacity: 0.15,
            blur_px: 0,
        };
        assert_eq!(validate_theme_background(&background), Ok(()));
        for bad in [
            "../../secret.png",
            "C:\\secret.png",
            "assets/secret.png",
            "not-a-uuid",
        ] {
            background.asset_id = Some(bad.to_string());
            assert_eq!(
                validate_theme_background(&background),
                Err(ThemeError::Invalid)
            );
        }
        let mut value = theme();
        value.background = Some(background);
        value.background.as_mut().unwrap().asset_id = Some("../../secret.png".to_string());
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Invalid));
        value.background.as_mut().unwrap().asset_id = None;
        assert!(validate_custom_theme(&value).is_ok());
    }

    #[test]
    fn colors_normalize_to_bounded_hex() {
        assert_eq!(normalize_theme_color("#abcdef").as_deref(), Some("#ABCDEF"));
        assert_eq!(
            normalize_theme_color("#ABCDEF80").as_deref(),
            Some("#ABCDEF80")
        );
        assert_eq!(
            normalize_theme_color("rgba(127,86,217,0.16)").as_deref(),
            Some("#7F56D929")
        );
        assert_eq!(
            normalize_theme_color("rgba(255, 223, 93, 0.55)").as_deref(),
            Some("#FFDF5D8C")
        );
        assert_eq!(
            normalize_theme_color("rgb(0,0,0)").as_deref(),
            Some("#000000")
        );
        assert_eq!(
            normalize_theme_color("rgb(0,0,0,1)").as_deref(),
            Some("#000000")
        );
        assert_eq!(
            normalize_theme_color("rgba(0,0,0)").as_deref(),
            Some("#000000")
        );
        for bad in [
            "rgba(300,0,0,0.5)",
            "rgba(0,0,0,-0.1)",
            "rgba(0,0,0,1.5)",
            "rgba(0,0,0,0.5,0.5)",
            "url(#x)",
            "#abc",
            "#GGGGGG",
        ] {
            assert_eq!(normalize_theme_color(bad), None, "{bad}");
        }
        assert_eq!(normalize_theme_color(&format!("#{}", "F".repeat(80))), None);
    }

    #[test]
    fn builtin_snapshot_normalizes_into_valid_tokens() {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../themes/light.tokens.json"
        ));
        let json: serde_json::Value = serde_json::from_str(raw).unwrap();
        let mut tokens = BTreeMap::new();
        fn walk(
            value: &serde_json::Value,
            prefix: &mut Vec<String>,
            tokens: &mut BTreeMap<String, ThemeValue>,
        ) {
            match value {
                serde_json::Value::Object(map) => {
                    for (key, child) in map {
                        if key.starts_with('_') {
                            continue;
                        }
                        prefix.push(key.clone());
                        walk(child, prefix, tokens);
                        prefix.pop();
                    }
                }
                serde_json::Value::Array(items) => {
                    for (index, child) in items.iter().enumerate() {
                        prefix.push(index.to_string());
                        walk(child, prefix, tokens);
                        prefix.pop();
                    }
                }
                serde_json::Value::String(text) => {
                    let path = prefix.join(".");
                    if path == "font.family" || path.starts_with("shadow.") {
                        return;
                    }
                    let color = normalize_theme_color(text)
                        .unwrap_or_else(|| panic!("built-in colour does not normalize: {path}"));
                    let alpha_ok = color.len() == 7 || token_allows_alpha(&path);
                    assert!(alpha_ok, "built-in alpha is not allowed: {path}");
                    tokens.insert(path, ThemeValue::String(color));
                }
                serde_json::Value::Number(number) => {
                    tokens.insert(
                        prefix.join("."),
                        ThemeValue::Number(number.as_f64().unwrap()),
                    );
                }
                _ => {}
            }
        }
        walk(&json, &mut Vec::new(), &mut tokens);
        assert_eq!(
            tokens.get("color.accentLight.group"),
            Some(&ThemeValue::String("#7F56D929".to_string()))
        );
        assert_eq!(
            tokens.get("syntax.match"),
            Some(&ThemeValue::String("#FFDF5D8C".to_string()))
        );
        assert!(validate_tokens(&tokens, MAX_THEME_TOKENS, false).is_ok());
        let declarations =
            theme_token_declarations(&tokens, false).expect("a light snapshot generates CSS");
        assert!(!declarations.is_empty());
        assert!(declarations.iter().all(|(name, value)| {
            name.starts_with("--adp-")
                && !value.contains('(')
                && !value.contains(';')
                && !value.contains('{')
                && !value.contains('}')
        }));
    }

    #[test]
    fn token_generation_is_typed_and_bounded() {
        assert_eq!(
            theme_token_css(
                "color.surface.window",
                &ThemeValue::String("#abcdef".to_string())
            )
            .as_deref(),
            Some("#ABCDEF")
        );
        assert_eq!(
            theme_token_css(
                "color.accentLight.group",
                &ThemeValue::String("rgba(127,86,217,0.16)".to_string())
            )
            .as_deref(),
            Some("#7F56D929")
        );
        assert_eq!(
            theme_token_css(
                "color.text.primary",
                &ThemeValue::String("rgba(0,0,0,0.5)".to_string())
            ),
            None
        );
        assert_eq!(
            theme_token_css("font.size.body", &ThemeValue::Number(12.0)).as_deref(),
            Some("12px")
        );
        assert_eq!(
            theme_token_css("color.surface.window", &ThemeValue::Number(1.0)),
            None
        );
        assert_eq!(
            theme_token_css("space.3", &ThemeValue::String("#FFFFFF".to_string())),
            None
        );
        assert_eq!(
            theme_token_css("color.nope", &ThemeValue::String("#FFFFFF".to_string())),
            None
        );

        let tokens = BTreeMap::from([
            (
                "color.surface.window".to_string(),
                ThemeValue::String("#ffffff".to_string()),
            ),
            ("font.size.body".to_string(), ThemeValue::Number(12.0)),
        ]);
        assert_eq!(
            theme_token_declarations(&tokens, false),
            Ok(vec![
                (
                    "--adp-color-surface-window".to_string(),
                    "#FFFFFF".to_string()
                ),
                ("--adp-font-body".to_string(), "12px".to_string()),
            ])
        );
        let editor = BTreeMap::from([(
            "syntax.keyword".to_string(),
            ThemeValue::String("#CF222E".to_string()),
        )]);
        assert_eq!(
            theme_token_declarations(&editor, true),
            Ok(vec![(
                "--adp-syntax-keyword".to_string(),
                "#CF222E".to_string()
            )])
        );
        let unknown = BTreeMap::from([(
            "color.nope".to_string(),
            ThemeValue::String("#FFFFFF".to_string()),
        )]);
        assert_eq!(
            theme_token_declarations(&unknown, false),
            Err(ThemeError::Invalid)
        );
    }

    #[test]
    fn contrast_ratio_rejects_non_hex_without_panicking() {
        assert_eq!(contrast_ratio("#aéxxx", "#FFFFFF"), None);
        assert_eq!(contrast_ratio("#FFFFFF", "#aéxxx"), None);
        assert_eq!(contrast_ratio("rgba(0,0,0,0.5)", "#FFFFFF"), None);
        let ratio = contrast_ratio("#000000", "#FFFFFF").unwrap();
        assert!((ratio - 21.0).abs() < 1e-9, "black/white ratio is {ratio}");
    }

    #[test]
    fn token_allowlists_fit_their_declared_bounds() {
        use crate::theme_tokens::{
            is_editor_token, is_theme_token, COLOR_PATHS, FONT_SIZE_PATHS, RADIUS_PATHS,
            SPACE_PATHS, THEME_EDITOR_TOKEN_PATHS,
        };
        let total =
            COLOR_PATHS.len() + FONT_SIZE_PATHS.len() + RADIUS_PATHS.len() + SPACE_PATHS.len();
        assert!(total <= MAX_THEME_TOKENS);
        assert!(THEME_EDITOR_TOKEN_PATHS.len() <= MAX_EDITOR_TOKENS);
        for path in THEME_EDITOR_TOKEN_PATHS {
            assert!(is_theme_token(path));
            assert!(is_editor_token(path));
        }
    }

    #[test]
    fn timestamps_and_summaries_stay_javascript_safe() {
        let mut value = theme();
        value.modified_unix = MAX_SAFE_UNIX;
        assert!(validate_custom_theme(&value).is_ok());
        value.modified_unix = MAX_SAFE_UNIX + 1;
        assert_eq!(validate_custom_theme(&value), Err(ThemeError::Invalid));

        let mut summary = theme_summary(&theme());
        summary.modified_unix = MAX_SAFE_UNIX + 1;
        assert_eq!(
            validate_summary_list(std::slice::from_ref(&summary)),
            Err(ThemeError::Invalid)
        );
        summary.modified_unix = MAX_SAFE_UNIX;
        assert!(validate_summary_list(std::slice::from_ref(&summary)).is_ok());
    }
}
