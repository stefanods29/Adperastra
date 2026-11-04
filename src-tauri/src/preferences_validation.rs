//! Settings validation for tab options, display formats and behavior
//! (Step 10c T1, preferences 29 -> 30).
//!
//! The structs here are the canonical native shapes used by `Settings` in
//! `main.rs`. Every bound below is the same bound the TypeScript normalizer
//! uses; a value the UI cannot produce is still refused here.
#![allow(dead_code)]


use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const INVALID_TABS: &str = "preferences.invalid_tabs";
pub const INVALID_FORMAT: &str = "preferences.invalid_format";

pub const TAB_WIDTH_FIXED_MIN: u32 = 100;
pub const TAB_WIDTH_FIXED_MAX: u32 = 320;
pub const HOVER_DELAY_MIN: u32 = 300;
pub const HOVER_DELAY_MAX: u32 = 2000;
pub const TITLE_LIMIT_MIN: u32 = 12;
pub const TITLE_LIMIT_MAX: u32 = 120;
pub const MAX_FORMAT_LOCALE_CHARS: usize = 64;
pub const MAX_EXTENSION_OVERRIDES: usize = 256;
pub const MAX_EXTENSION_KEY_CHARS: usize = 32;
pub const MAX_SIZE_DECIMALS: u8 = 4;
pub const MAX_CUSTOM_PATTERN_CHARS: usize = 64;

fn default_width_mode() -> String {
    "fixed".to_string()
}
fn default_fixed_width_px() -> u32 {
    180
}
fn default_close_button() -> String {
    "always".to_string()
}
fn default_new_position() -> String {
    "end".to_string()
}
fn default_close_activation() -> String {
    "mru".to_string()
}
fn default_true() -> bool {
    true
}
fn default_hover_delay_ms() -> u32 {
    500
}
fn default_title_limit() -> u32 {
    40
}
fn default_scroll() -> String {
    "scroll".to_string()
}
fn default_system() -> String {
    "system".to_string()
}
fn default_short() -> String {
    "short".to_string()
}
fn default_custom_date() -> String {
    "YYYY-MM-DD HH:mm".to_string()
}
fn default_binary() -> String {
    "binary".to_string()
}
fn default_decimals() -> u8 {
    1
}
fn default_end() -> String {
    "end".to_string()
}
fn default_double() -> String {
    "double".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TabOptions {
    pub width_mode: String,
    pub fixed_width_px: u32,
    pub close_button: String,
    pub new_position: String,
    pub close_activation: String,
    pub hover_preview: bool,
    pub hover_delay_ms: u32,
    pub type_icons: bool,
    pub type_underline: bool,
    pub title_limit: u32,
    pub overflow: String,
    pub double_click_new: bool,
}

impl Default for TabOptions {
    fn default() -> Self {
        Self {
            width_mode: default_width_mode(),
            fixed_width_px: default_fixed_width_px(),
            close_button: default_close_button(),
            new_position: default_new_position(),
            close_activation: default_close_activation(),
            hover_preview: false,
            hover_delay_ms: default_hover_delay_ms(),
            type_icons: true,
            type_underline: true,
            title_limit: default_title_limit(),
            overflow: default_scroll(),
            double_click_new: default_true(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FormatOptions {
    pub locale: String,
    pub date_style: String,
    pub custom_date: String,
    pub time_cycle: String,
    pub week_start: String,
    pub size_base: String,
    pub decimals: u8,
    pub name_truncation: String,
    pub extension_overrides: BTreeMap<String, bool>,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            locale: default_system(),
            date_style: default_short(),
            custom_date: default_custom_date(),
            time_cycle: default_system(),
            week_start: default_system(),
            size_base: default_binary(),
            decimals: default_decimals(),
            name_truncation: default_end(),
            extension_overrides: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct Confirmations {
    pub recycle: bool,
    /// Raw identifier: the serialized key is `move`, matching the UI map.
    pub r#move: bool,
    pub rename: bool,
    pub convert: bool,
    pub clean: bool,
    pub save: bool,
}


#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BehaviorSettings {
    pub open_click: String,
    pub confirm_changes: bool,
    pub confirmations: Confirmations,
}

impl Default for BehaviorSettings {
    fn default() -> Self {
        Self {
            open_click: default_double(),
            confirm_changes: false,
            confirmations: Confirmations::default(),
        }
    }
}

fn check_choice(field: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "preferences: unsupported {field} {value:?} (expected {})",
            allowed.join(", ")
        ))
    }
}

fn check_range(field: &str, value: u32, minimum: u32, maximum: u32) -> Result<(), String> {
    if (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "preferences: {field} {value} is outside {minimum}..={maximum}"
        ))
    }
}

pub fn validate_tab_options(options: &TabOptions) -> Result<(), String> {
    check_choice("width_mode", &options.width_mode, &["compact", "fixed", "fit"])?;
    check_range(
        "fixed_width_px",
        options.fixed_width_px,
        TAB_WIDTH_FIXED_MIN,
        TAB_WIDTH_FIXED_MAX,
    )?;
    check_choice("close_button", &options.close_button, &["always", "hover"])?;
    check_choice("new_position", &options.new_position, &["end", "after_active"])?;
    check_choice("close_activation", &options.close_activation, &["mru", "right"])?;
    check_range(
        "hover_delay_ms",
        options.hover_delay_ms,
        HOVER_DELAY_MIN,
        HOVER_DELAY_MAX,
    )?;
    check_range(
        "title_limit",
        options.title_limit,
        TITLE_LIMIT_MIN,
        TITLE_LIMIT_MAX,
    )?;
    check_choice("overflow", &options.overflow, &["scroll", "shrink"])?;
    Ok(())
}

/// `system` or a well-formed BCP 47-style tag of at most 64 characters.
pub fn is_valid_locale(value: &str) -> bool {
    if value == "system" {
        return true;
    }
    if value.is_empty() || value.len() > MAX_FORMAT_LOCALE_CHARS {
        return false;
    }
    let mut parts = value.split('-');
    let Some(language) = parts.next() else {
        return false;
    };
    if !(2..=8).contains(&language.len())
        || !language.chars().all(|c| c.is_ascii_alphabetic())
    {
        return false;
    }
    for part in parts {
        if part.is_empty()
            || part.len() > 8
            || !part.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return false;
        }
    }
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PatternPart {
    Field(&'static str),
    Literal(char),
}

fn parse_custom_date_pattern(pattern: &str) -> Option<Vec<PatternPart>> {
    let chars: Vec<char> = pattern.chars().collect();
    if chars.is_empty() || chars.len() > MAX_CUSTOM_PATTERN_CHARS {
        return None;
    }
    let mut parts = Vec::new();
    let mut index = 0;
    let mut fields = 0usize;
    while index < chars.len() {
        let four: String = chars
            .get(index..(index + 4).min(chars.len()))
            .unwrap_or(&[])
            .iter()
            .collect();
        if four == "YYYY" {
            parts.push(PatternPart::Field("YYYY"));
            fields += 1;
            index += 4;
            continue;
        }
        let two: String = chars
            .get(index..(index + 2).min(chars.len()))
            .unwrap_or(&[])
            .iter()
            .collect();
        if matches!(two.as_str(), "MM" | "DD" | "HH" | "hh" | "mm" | "ss") {
            let token = match two.as_str() {
                "MM" => "MM",
                "DD" => "DD",
                "HH" => "HH",
                "hh" => "hh",
                "mm" => "mm",
                _ => "ss",
            };
            parts.push(PatternPart::Field(token));
            fields += 1;
            index += 2;
            continue;
        }
        let one = chars[index];
        if one == 'A' {
            parts.push(PatternPart::Field("A"));
            fields += 1;
            index += 1;
            continue;
        }
        if matches!(one, ' ' | '-' | ':' | '.' | ',') {
            parts.push(PatternPart::Literal(one));
            index += 1;
            continue;
        }
        return None;
    }
    if fields == 0 {
        None
    } else {
        Some(parts)
    }
}

pub fn is_valid_custom_date_pattern(pattern: &str) -> bool {
    parse_custom_date_pattern(pattern).is_some()
}

fn is_valid_extension_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_EXTENSION_KEY_CHARS
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '+' | '-'))
}

pub fn validate_format_options(options: &FormatOptions) -> Result<(), String> {
    if !is_valid_locale(&options.locale) {
        return Err(format!("preferences: invalid locale {:?}", options.locale));
    }
    check_choice(
        "date_style",
        &options.date_style,
        &["relative", "short", "long", "custom"],
    )?;
    if !is_valid_custom_date_pattern(&options.custom_date) {
        return Err("preferences: invalid custom_date pattern".to_string());
    }
    check_choice("time_cycle", &options.time_cycle, &["system", "h12", "h23"])?;
    check_choice("week_start", &options.week_start, &["system", "monday", "sunday"])?;
    check_choice("size_base", &options.size_base, &["legacy", "decimal", "binary"])?;
    if options.decimals > MAX_SIZE_DECIMALS {
        return Err(format!(
            "preferences: decimals {} is outside 0..={MAX_SIZE_DECIMALS}",
            options.decimals
        ));
    }
    check_choice("name_truncation", &options.name_truncation, &["middle", "end"])?;
    if options.extension_overrides.len() > MAX_EXTENSION_OVERRIDES {
        return Err("preferences: too many extension overrides".to_string());
    }
    for key in options.extension_overrides.keys() {
        if !is_valid_extension_key(key) {
            return Err(format!("preferences: invalid extension override {key:?}"));
        }
    }
    Ok(())
}

pub fn validate_behavior(behavior: &BehaviorSettings) -> Result<(), String> {
    check_choice("open_click", &behavior.open_click, &["single", "double"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_settings_table() {
        let tabs = TabOptions::default();
        assert_eq!(tabs.fixed_width_px, 180);
        assert_eq!(tabs.hover_delay_ms, 500);
        assert_eq!(tabs.title_limit, 40);
        assert!(tabs.type_icons && tabs.type_underline);

        let formats = FormatOptions::default();
        assert_eq!(formats.size_base, "binary");
        assert_eq!(formats.decimals, 1);
        assert_eq!(formats.custom_date, "YYYY-MM-DD HH:mm");

        let behavior = BehaviorSettings::default();
        assert_eq!(behavior.open_click, "double");
        assert!(!behavior.confirmations.save);
    }

    #[test]
    fn accepts_the_full_custom_pattern() {
        assert!(is_valid_custom_date_pattern("YYYY-MM-DD HH:mm"));
        assert!(is_valid_custom_date_pattern("DD.MM.YYYY, hh:mm:ss A"));
        assert!(!is_valid_custom_date_pattern("YYYY-MM-DDTHH:mm"));
        assert!(!is_valid_custom_date_pattern(""));
        assert!(!is_valid_custom_date_pattern("YYYY-MM-DD HH:mm:ss.SSS"));
        assert!(!is_valid_custom_date_pattern(&"Y".repeat(65)));
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn refuses_bounds_and_unknown_enums() {
        let mut tabs = TabOptions::default();
        tabs.title_limit = 11;
        assert!(validate_tab_options(&tabs).is_err());
        tabs.title_limit = 40;
        tabs.hover_delay_ms = 2001;
        assert!(validate_tab_options(&tabs).is_err());

        let mut formats = FormatOptions::default();
        formats.decimals = 5;
        assert!(validate_format_options(&formats).is_err());
        formats.decimals = 1;
        formats.locale = "not a locale".to_string();
        assert!(validate_format_options(&formats).is_err());
    }

    #[test]
    fn extension_overrides_are_lower_case_and_bounded() {
        let mut formats = FormatOptions::default();
        formats.extension_overrides.insert("txt".to_string(), true);
        assert!(validate_format_options(&formats).is_ok());
        formats.extension_overrides.insert("TXT".to_string(), true);
        assert!(validate_format_options(&formats).is_err());
    }

    #[test]
    fn locale_accepts_system_and_well_formed_tags() {
        assert!(is_valid_locale("system"));
        assert!(is_valid_locale("en"));
        assert!(is_valid_locale("es-419"));
        assert!(is_valid_locale("en-US"));
        assert!(!is_valid_locale(""));
        assert!(!is_valid_locale("en_US"));
        assert!(!is_valid_locale(&"a-".repeat(40)));
    }
}
