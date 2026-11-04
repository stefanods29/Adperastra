//! Reading settings for the e-book viewer (Step 07f D3): font size 12-32
//! pixels (default 18) and the reading theme app/light/dark (default app).
//!
//! The section is additive on the existing settings file. The coordinator
//! adds it to `Settings`/`AppSettings`, schema 15 and both migrations; this
//! module owns the defaults and the validation so Rust and TypeScript cannot
//! drift.

use serde::{Deserialize, Serialize};

pub const MIN_FONT_PX: u32 = 12;
pub const MAX_FONT_PX: u32 = 32;
pub const DEFAULT_FONT_PX: u32 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReadingTheme {
    #[default]
    App,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadingSettings {
    #[serde(default = "default_font_px")]
    pub font_px: u32,
    #[serde(default)]
    pub theme: ReadingTheme,
}

fn default_font_px() -> u32 {
    DEFAULT_FONT_PX
}

impl Default for ReadingSettings {
    fn default() -> Self {
        Self {
            font_px: DEFAULT_FONT_PX,
            theme: ReadingTheme::App,
        }
    }
}

impl ReadingSettings {
    /// A missing or invalid value falls back per field; it never resets the
    /// rest of the user's settings. Used by migration tests and available to
    /// the settings merge without changing the wire defaults.
    #[allow(dead_code)]
    pub fn normalize(value: Option<&serde_json::Value>) -> Self {
        let Some(serde_json::Value::Object(map)) = value else {
            return Self::default();
        };
        let font_px = map
            .get("font_px")
            .and_then(serde_json::Value::as_u64)
            .filter(|value| (u64::from(MIN_FONT_PX)..=u64::from(MAX_FONT_PX)).contains(value))
            .map(|value| value as u32)
            .unwrap_or(DEFAULT_FONT_PX);
        let theme = match map.get("theme").and_then(serde_json::Value::as_str) {
            Some("light") => ReadingTheme::Light,
            Some("dark") => ReadingTheme::Dark,
            _ => ReadingTheme::App,
        };
        Self { font_px, theme }
    }

    /// Exact validation used before saving; `None` means the value is valid.
    pub fn validate(&self) -> Option<&'static str> {
        if !(MIN_FONT_PX..=MAX_FONT_PX).contains(&self.font_px) {
            return Some("settings.reading.font_px");
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_18_and_app() {
        assert_eq!(ReadingSettings::default().font_px, 18);
        assert_eq!(ReadingSettings::default().theme, ReadingTheme::App);
    }

    #[test]
    fn a_missing_section_keeps_defaults() {
        assert_eq!(ReadingSettings::normalize(None), ReadingSettings::default());
    }

    #[test]
    fn an_invalid_font_falls_back_alone() {
        let value = serde_json::json!({ "font_px": 200, "theme": "dark" });
        let settings = ReadingSettings::normalize(Some(&value));
        assert_eq!(settings.font_px, 18);
        assert_eq!(settings.theme, ReadingTheme::Dark);
    }

    #[test]
    fn bounds_are_exact() {
        assert_eq!(
            ReadingSettings {
                font_px: 11,
                theme: ReadingTheme::App
            }
            .validate(),
            Some("settings.reading.font_px")
        );
        assert_eq!(
            ReadingSettings {
                font_px: 12,
                theme: ReadingTheme::Light
            }
            .validate(),
            None
        );
        assert_eq!(
            ReadingSettings {
                font_px: 32,
                theme: ReadingTheme::Dark
            }
            .validate(),
            None
        );
    }
}
