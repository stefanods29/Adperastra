//! Accessibility preference and system-state types (Step 10f,
//! accessibility-1). Mirrors `src/services/accessibility.ts` field for
//! field; the native side validates persisted values again and never
//! rewrites stored preferences from Windows state.

use serde::{Deserialize, Serialize};

pub const MAX_VOICE_ID_SCALARS: usize = 512;
pub const SYSTEM_TEXT_SCALE_MIN: f64 = 1.0;
pub const SYSTEM_TEXT_SCALE_MAX: f64 = 3.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubtitleAccessibility {
    pub font_percent: f64,
    pub text_color: String,
    pub background_color: String,
    pub background_opacity: f64,
    /// `bottom` or `top`.
    pub position: String,
}

impl Default for SubtitleAccessibility {
    fn default() -> Self {
        Self {
            font_percent: 100.0,
            text_color: "#FFFFFF".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 0.75,
            position: "bottom".to_string(),
        }
    }
}

// Settings values are validated as finite before they are persisted or compared.
impl Eq for SubtitleAccessibility {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccessibilitySettings {
    pub large_targets: bool,
    /// One of 2, 3, 4.
    pub focus_px: u32,
    /// `normal`, `large` or `xlarge`.
    pub cursor: String,
    /// `none`, `deuteranopia`, `protanopia` or `tritanopia`.
    pub color_mode: String,
    pub dyslexic_font: bool,
    pub letter_spacing_em: f64,
    pub word_spacing_em: f64,
    pub line_height: f64,
    pub simple_mode: bool,
    pub persistent_toasts: bool,
    /// `system`, `on` or `off`.
    pub reduced_motion: String,
    pub no_autoplay: bool,
    /// Absent means "use the Windows double-click time".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub double_click_ms: Option<f64>,
    pub hover_ms: f64,
    pub drag_threshold_px: f64,
    pub completion_sound: bool,
    pub sound_volume: f64,
    pub subtitle: SubtitleAccessibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_voice_id: Option<String>,
    pub read_rate: f64,
    pub read_volume: f64,
    /// Reserved for the 17b speech provider; inactive before it registers.
    pub auto_captions: bool,
}

impl Default for AccessibilitySettings {
    fn default() -> Self {
        Self {
            large_targets: false,
            focus_px: 2,
            cursor: "normal".to_string(),
            color_mode: "none".to_string(),
            dyslexic_font: false,
            letter_spacing_em: 0.0,
            word_spacing_em: 0.0,
            line_height: 1.4,
            simple_mode: false,
            persistent_toasts: false,
            reduced_motion: "system".to_string(),
            no_autoplay: false,
            double_click_ms: None,
            hover_ms: 600.0,
            drag_threshold_px: 4.0,
            completion_sound: false,
            sound_volume: 0.2,
            subtitle: SubtitleAccessibility::default(),
            read_voice_id: None,
            read_rate: 1.0,
            read_volume: 1.0,
            auto_captions: false,
        }
    }
}

// Settings values are validated as finite before they are persisted or compared.
impl Eq for AccessibilitySettings {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemAccessibility {
    pub forced_colors: bool,
    pub reduced_motion: bool,
    /// Finite, 1 to 3.
    pub text_scale: f64,
    pub double_click_ms: u16,
    /// Monotonic snapshot counter; only values in the JSON safe range cross.
    pub generation: u64,
}

fn finite_in(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}

fn is_hex6(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn invalid() -> String {
    "accessibility.invalid".to_string()
}

fn channel_luminance(value: f64) -> f64 {
    let channel = value / 255.0;
    if channel <= 0.04045 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

fn hex_luminance(hex: &str) -> Option<f64> {
    if !is_hex6(hex) {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok().map(f64::from);
    let red = channel_luminance(channel(1)?);
    let green = channel_luminance(channel(3)?);
    let blue = channel_luminance(channel(5)?);
    Some(0.2126 * red + 0.7152 * green + 0.0722 * blue)
}

/// WCAG contrast of the cue text over its background blended onto black at
/// the stored opacity; the same math as `subtitleContrast` in the UI.
pub fn subtitle_contrast(subtitle: &SubtitleAccessibility) -> Option<f64> {
    if !is_hex6(&subtitle.background_color) {
        return None;
    }
    let text = hex_luminance(&subtitle.text_color)?;
    let channel = |at: usize| {
        u8::from_str_radix(&subtitle.background_color[at..at + 2], 16)
            .ok()
            .map(f64::from)
    };
    let blended = |at: usize| channel(at).map(|value| (value * subtitle.background_opacity).round());
    let red = channel_luminance(blended(1)?);
    let green = channel_luminance(blended(3)?);
    let blue = channel_luminance(blended(5)?);
    let background = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    let (lighter, darker) = if text >= background {
        (text, background)
    } else {
        (background, text)
    };
    Some((lighter + 0.05) / (darker + 0.05))
}

pub fn validate_subtitle(subtitle: &SubtitleAccessibility) -> Result<(), String> {
    if !finite_in(subtitle.font_percent, 75.0, 300.0)
        || !is_hex6(&subtitle.text_color)
        || !is_hex6(&subtitle.background_color)
        || !finite_in(subtitle.background_opacity, 0.0, 1.0)
        || !matches!(subtitle.position.as_str(), "bottom" | "top")
    {
        return Err(invalid());
    }
    Ok(())
}

/// Full validation of one settings section (guide bounds). Used by the
/// schema-33 settings validator and by any command that receives the shape.
pub fn validate_accessibility_settings(settings: &AccessibilitySettings) -> Result<(), String> {
    if !matches!(settings.focus_px, 2..=4)
        || !matches!(settings.cursor.as_str(), "normal" | "large" | "xlarge")
        || !matches!(
            settings.color_mode.as_str(),
            "none" | "deuteranopia" | "protanopia" | "tritanopia"
        )
        || !finite_in(settings.letter_spacing_em, 0.0, 0.2)
        || !finite_in(settings.word_spacing_em, 0.0, 0.5)
        || !finite_in(settings.line_height, 1.0, 2.0)
        || !matches!(settings.reduced_motion.as_str(), "system" | "on" | "off")
        || !match settings.double_click_ms {
            None => true,
            Some(v) => finite_in(v, 100.0, 1000.0),
        }
        || !finite_in(settings.hover_ms, 200.0, 2000.0)
        || !finite_in(settings.drag_threshold_px, 2.0, 32.0)
        || !finite_in(settings.sound_volume, 0.0, 1.0)
        || !match &settings.read_voice_id {
            None => true,
            Some(id) => id.chars().count() <= MAX_VOICE_ID_SCALARS,
        }
        || !finite_in(settings.read_rate, 0.5, 2.0)
        || !finite_in(settings.read_volume, 0.0, 1.0)
    {
        return Err(invalid());
    }
    validate_subtitle(&settings.subtitle)?;
    match subtitle_contrast(&settings.subtitle) {
        Some(ratio) if ratio >= 4.5 => Ok(()),
        _ => Err(invalid()),
    }
}

pub fn validate_system_accessibility(system: &SystemAccessibility) -> Result<(), String> {
    if !finite_in(system.text_scale, SYSTEM_TEXT_SCALE_MIN, SYSTEM_TEXT_SCALE_MAX)
        || system.generation > 9_007_199_254_740_991
    {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        assert!(validate_accessibility_settings(&AccessibilitySettings::default()).is_ok());
        assert!(validate_subtitle(&SubtitleAccessibility::default()).is_ok());
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn invalid_spacings_rejected() {
        let mut settings = AccessibilitySettings::default();
        settings.letter_spacing_em = 0.21;
        assert_eq!(
            validate_accessibility_settings(&settings),
            Err("accessibility.invalid".to_string())
        );
        let mut settings = AccessibilitySettings::default();
        settings.word_spacing_em = 0.51;
        assert!(validate_accessibility_settings(&settings).is_err());
        let mut settings = AccessibilitySettings::default();
        settings.line_height = 2.1;
        assert!(validate_accessibility_settings(&settings).is_err());
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn invalid_enums_and_ranges_rejected() {
        let mut settings = AccessibilitySettings::default();
        settings.focus_px = 5;
        assert!(validate_accessibility_settings(&settings).is_err());
        let mut settings = AccessibilitySettings::default();
        settings.subtitle.position = "middle".to_string();
        assert!(validate_accessibility_settings(&settings).is_err());
        let mut settings = AccessibilitySettings::default();
        settings.read_voice_id = Some("v".repeat(MAX_VOICE_ID_SCALARS + 1));
        assert!(validate_accessibility_settings(&settings).is_err());
    }

    #[test]
    fn low_contrast_subtitles_rejected() {
        let mut settings = AccessibilitySettings::default();
        assert!(validate_accessibility_settings(&settings).is_ok());
        settings.subtitle.text_color = "#777777".to_string();
        settings.subtitle.background_color = "#888888".to_string();
        settings.subtitle.background_opacity = 1.0;
        assert_eq!(
            validate_accessibility_settings(&settings),
            Err("accessibility.invalid".to_string())
        );
    }

    #[test]
    fn system_snapshot_bounds_checked() {
        let system = SystemAccessibility {
            forced_colors: false,
            reduced_motion: false,
            text_scale: 1.0,
            double_click_ms: 500,
            generation: 0,
        };
        assert!(validate_system_accessibility(&system).is_ok());
        let mut bad = system.clone();
        bad.text_scale = f64::NAN;
        assert!(validate_system_accessibility(&bad).is_err());
        let mut bad = system;
        bad.text_scale = 3.5;
        assert!(validate_system_accessibility(&bad).is_err());
    }
}
