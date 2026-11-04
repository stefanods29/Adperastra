//! Toolbar layout data mirrors (Step 10b, command-layout-1). These types
//! hold command ids and trusted custom-control ids only: no callbacks,
//! path arguments, shell strings or URLs are ever deserialized.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

pub const MAX_BAR_ENTRIES: usize = 100;
pub const MAX_BARS: usize = 100;
pub const MAX_TOTAL_ENTRIES: usize = 1000;
pub const MAX_QUICK_ACCESS: usize = 20;
pub const MAX_ENTRY_ID_CHARS: usize = 128;
pub const MAX_BAR_ID_CHARS: usize = 192;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandLayoutEntry {
    pub kind: String,
    pub id: String,
    #[serde(default = "default_true")]
    pub visible: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandBarLayout {
    pub bar_id: String,
    pub entries: Vec<CommandLayoutEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolbarCustomSettings {
    #[serde(default)]
    pub classic_menu: bool,
    #[serde(default)]
    pub bars: Vec<CommandBarLayout>,
    #[serde(default = "default_quick_access")]
    pub quick_access: Vec<String>,
}

fn default_quick_access() -> Vec<String> {
    ["explorer.undo", "explorer.redo", "explorer.copyPath"]
        .iter()
        .map(|id| id.to_string())
        .collect()
}

impl Default for ToolbarCustomSettings {
    fn default() -> Self {
        Self {
            classic_menu: false,
            bars: Vec::new(),
            quick_access: default_quick_access(),
        }
    }
}

fn char_count(text: &str) -> usize {
    text.chars().count()
}

/// Validate the toolbar section. Errors are the stable code
/// `toolbar.invalid`. Unknown command ids are kept: they are disabled
/// entries, never executed.
pub fn validate_toolbar_custom_settings(
    settings: &ToolbarCustomSettings,
) -> Result<(), String> {
    if settings.bars.len() > MAX_BARS {
        return Err("toolbar.invalid".to_string());
    }
    let mut seen: Vec<&str> = Vec::new();
    let mut total = settings.quick_access.len();
    for bar in &settings.bars {
        if bar.bar_id.is_empty() || char_count(&bar.bar_id) > MAX_BAR_ID_CHARS {
            return Err("toolbar.invalid".to_string());
        }
        if seen.contains(&bar.bar_id.as_str()) {
            return Err("toolbar.invalid".to_string());
        }
        seen.push(bar.bar_id.as_str());
        if bar.entries.len() > MAX_BAR_ENTRIES {
            return Err("toolbar.invalid".to_string());
        }
        total += bar.entries.len();
        if total > MAX_TOTAL_ENTRIES {
            return Err("toolbar.invalid".to_string());
        }
        for entry in &bar.entries {
            if !matches!(entry.kind.as_str(), "command" | "custom" | "separator") {
                return Err("toolbar.invalid".to_string());
            }
            if entry.id.is_empty() || char_count(&entry.id) > MAX_ENTRY_ID_CHARS {
                return Err("toolbar.invalid".to_string());
            }
        }
    }
    if settings.quick_access.len() > MAX_QUICK_ACCESS {
        return Err("toolbar.invalid".to_string());
    }
    for id in &settings.quick_access {
        if id.is_empty() || char_count(id) > MAX_ENTRY_ID_CHARS {
            return Err("toolbar.invalid".to_string());
        }
    }
    Ok(())
}

/// Can this entry run or render? Unknown ids cannot.
pub fn entry_executable(
    entry: &CommandLayoutEntry,
    command_ids: &[String],
    custom_ids: &[String],
) -> bool {
    match entry.kind.as_str() {
        "command" => command_ids.iter().any(|id| id == &entry.id),
        "custom" => custom_ids.iter().any(|id| id == &entry.id),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with(entry: CommandLayoutEntry) -> ToolbarCustomSettings {
        ToolbarCustomSettings {
            classic_menu: false,
            bars: vec![CommandBarLayout {
                bar_id: "explorer.command".to_string(),
                entries: vec![entry],
            }],
            quick_access: vec![],
        }
    }

    #[test]
    fn unknown_command_retained_disabled() {
        let entry = CommandLayoutEntry {
            kind: "command".to_string(),
            id: "future.command".to_string(),
            visible: true,
        };
        let settings = settings_with(entry.clone());
        assert!(validate_toolbar_custom_settings(&settings).is_ok());
        assert!(!entry_executable(&entry, &[], &[]));
        assert!(entry_executable(
            &entry,
            &["future.command".to_string()],
            &[]
        ));
    }

    #[test]
    fn custom_renderer_not_deserialized() {
        let raw = r#"{"kind":"custom","id":"zoom","visible":true,"render":"evil"}"#;
        assert!(serde_json::from_str::<CommandLayoutEntry>(raw).is_err());
        let raw_args = r#"{"kind":"command","id":"explorer.open","visible":true,"args":"C:\\x"}"#;
        assert!(serde_json::from_str::<CommandLayoutEntry>(raw_args).is_err());
    }

    #[test]
    fn twenty_first_quick_access_refused() {
        let settings = ToolbarCustomSettings {
            classic_menu: false,
            bars: vec![],
            quick_access: (0..21).map(|n| format!("cmd.{n}")).collect(),
        };
        assert_eq!(
            validate_toolbar_custom_settings(&settings),
            Err("toolbar.invalid".to_string())
        );
    }
}
