use serde::{Deserialize, Serialize};
fn default_true() -> bool {
    true
}
/// Quick Convert defaults (schema 16, Step 08a D9).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversionSettings {
    #[serde(default = "default_conversion_destination")]
    pub default_destination: String,
    #[serde(default = "default_conversion_quality")]
    pub default_quality: u8,
    #[serde(default = "default_true")]
    pub preserve_metadata: bool,
    #[serde(default = "default_conversion_jobs")]
    pub concurrent_jobs: u8,
    /// UUID of the last used preset, or none (schema 17, Step 08b).
    #[serde(default)]
    pub last_preset: Option<String>,
    /// Always true; the loss review cannot be hidden (schema 17).
    #[serde(default = "default_true")]
    pub prompt_for_losses: bool,
}

fn default_conversion_destination() -> String {
    "source".to_string()
}

fn default_conversion_quality() -> u8 {
    90
}

fn default_conversion_jobs() -> u8 {
    2
}

impl Default for ConversionSettings {
    fn default() -> Self {
        Self {
            default_destination: default_conversion_destination(),
            default_quality: default_conversion_quality(),
            preserve_metadata: true,
            concurrent_jobs: default_conversion_jobs(),
            last_preset: None,
            prompt_for_losses: true,
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn schema15_keeps_language_theme_and_templates_and_adds_quality_90() {
        let settings = crate::migrate(serde_json::json!({
            "schema_version": 15, "language": "es", "theme": { "mode": "dark" },
            "templates": { "my_folder": "C:\\Templates" }
        }))
        .unwrap();
        assert_eq!(settings.schema_version, crate::CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.templates.my_folder, "C:\\Templates");
        assert_eq!(settings.conversion.default_quality, 90);
        assert_eq!(settings.conversion.default_destination, "source");
        assert!(settings.conversion.preserve_metadata);
        assert_eq!(settings.conversion.concurrent_jobs, 2);
    }

    #[test]
    fn conversion_settings_refuse_invalid_quality_destination_and_parallelism() {
        let mut settings = crate::Settings::default();
        settings.conversion.default_quality = 0;
        assert!(crate::validate(&settings).is_err());
        settings.conversion.default_quality = 90;
        settings.conversion.default_destination = "replace".into();
        assert!(crate::validate(&settings).is_err());
        settings.conversion.default_destination = "source".into();
        settings.conversion.concurrent_jobs = 3;
        assert!(crate::validate(&settings).is_err());
    }
}
