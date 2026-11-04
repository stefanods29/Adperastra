//! Step 10d wire declarations and field validation. Identity, catalog and
//! asset authority live in `folder_customization_store`; these declarations
//! alone authorize no disk write.
#![allow(dead_code)]

use fs_service::FileIdentityKey;
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::folder_presentation_types::ColumnSpec;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FolderIcon {
    Default,
    Lucide { value: String },
    Emoji { value: String },
    Image { value: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundKind { None, Solid, Gradient, Image }
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundFit { #[default] Fit, Fill, Tile }
fn default_opacity() -> f64 { 0.15 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderBackground {
    pub kind: BackgroundKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second_color: Option<String>,
    #[serde(default)] pub angle_degrees: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default)] pub fit: BackgroundFit,
    #[serde(default = "default_opacity")] pub opacity: f64,
    #[serde(default)] pub blur_px: u8,
    #[serde(default)] pub inherit: bool,
}

impl Default for FolderBackground {
    fn default() -> Self {
        Self {
            kind: BackgroundKind::None,
            color: None,
            second_color: None,
            angle_degrees: 0,
            asset_id: None,
            fit: BackgroundFit::Fit,
            opacity: default_opacity(),
            blur_px: 0,
            inherit: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderScope { Exact, Subtree }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderType { General, Photos, Music, Documents }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnSet {
    pub id: String,
    pub name: String,
    pub columns: Vec<ColumnSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_type: Option<FolderType>,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomization {
    pub key: FileIdentityKey,
    pub display_path: String,
    pub color: Option<String>,
    pub icon: FolderIcon,
    pub background: FolderBackground,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_set_id: Option<String>,
    pub scope: FolderScope,
    pub modified_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderDecoration {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub icon: FolderIcon,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<FolderBackground>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_set: Option<ColumnSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited_from: Option<String>,
    pub warning_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizationPage {
    pub records: Vec<FolderCustomization>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizeFailure { pub path: String, pub code: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizeResult {
    pub changed_count: u32,
    pub windows_applied_count: u32,
    pub failures: Vec<FolderCustomizeFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub history_id: String,
    pub complete: bool,
}

/// Keeps the difference between an omitted field (unchanged) and an explicit
/// `null` (clear the colour). Plain `Option<Option<T>>` would erase it.
fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizePatch {
    #[serde(
        default,
        deserialize_with = "deserialize_some",
        skip_serializing_if = "Option::is_none"
    )]
    pub color: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<FolderIcon>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<FolderBackground>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_set_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<FolderScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizeRequest {
    pub paths: Vec<String>,
    pub patch: FolderCustomizePatch,
    pub expected_keys: Vec<FileIdentityKey>,
    #[serde(default)]
    pub apply_windows: bool,
    #[serde(default)]
    pub accepted_windows_change: bool,
}

pub fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|parsed| parsed.to_string() == value)
        .unwrap_or(false)
}

pub(crate) fn is_rgb(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn is_theme_color(value: &str) -> bool {
    (value.len() == 7 || value.len() == 9)
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_regional_indicator(value: char) -> bool {
    (0x1F1E6..=0x1F1FF).contains(&(value as u32))
}

fn is_combining_mark(value: u32) -> bool {
    matches!(
        value,
        0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F
    )
}

/// One user-visible grapheme, bounded to 16 scalars. ZWJ families are refused
/// rather than split: the UI boundary already segments with `Intl.Segmenter`,
/// and this native check fails closed without a new segmentation dependency.
fn valid_emoji(value: &str) -> bool {
    let chars: Vec<char> = value.chars().collect();
    if chars.is_empty() || chars.len() > 16 {
        return false;
    }
    if chars.iter().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return false;
    }
    if is_regional_indicator(chars[0]) {
        return chars.len() == 2 && is_regional_indicator(chars[1]);
    }
    let mut bases = 0;
    for (index, ch) in chars.iter().enumerate() {
        let scalar = *ch as u32;
        let extender = matches!(scalar, 0x200D | 0xFE0E | 0xFE0F | 0x20E3)
            || (0x1F3FB..=0x1F3FF).contains(&scalar)
            || (0xE0020..=0xE007F).contains(&scalar)
            || is_combining_mark(scalar);
        if extender {
            if index == 0 {
                return false;
            }
        } else {
            bases += 1;
        }
    }
    bases == 1
}

impl FolderIcon {
    /// Image icons need an owned-asset import/lease authority that does not
    /// exist yet; they are refused instead of reading an arbitrary path.
    pub fn validate(&self) -> Result<(), String> {
        let invalid = || "folder_custom.invalid".to_string();
        match self {
            FolderIcon::Default => Ok(()),
            FolderIcon::Lucide { value } => {
                if [
                    "folder",
                    "folderOpen",
                    "folderHeart",
                    "folderStar",
                    "folderLock",
                ]
                .contains(&value.as_str())
                {
                    Ok(())
                } else {
                    Err(invalid())
                }
            }
            FolderIcon::Emoji { value } => {
                if valid_emoji(value) {
                    Ok(())
                } else {
                    Err(invalid())
                }
            }
            FolderIcon::Image { .. } => Err("folder_custom.unsupported".to_string()),
        }
    }
}

impl FolderBackground {
    /// Image backgrounds are refused for the same missing asset authority.
    pub fn validate(&self) -> Result<(), String> {
        let invalid = || "folder_custom.invalid".to_string();
        if !self.opacity.is_finite() || !(0.0..=0.5).contains(&self.opacity) {
            return Err(invalid());
        }
        if self.angle_degrees > 359 || self.blur_px > 32 {
            return Err(invalid());
        }
        match self.kind {
            BackgroundKind::Image => return Err("folder_custom.unsupported".to_string()),
            BackgroundKind::None => {
                if self.asset_id.is_some() {
                    return Err(invalid());
                }
            }
            BackgroundKind::Solid => {
                if self.asset_id.is_some()
                    || !self.color.as_deref().is_some_and(is_rgb)
                {
                    return Err(invalid());
                }
            }
            BackgroundKind::Gradient => {
                if self.asset_id.is_some()
                    || !self.color.as_deref().is_some_and(is_theme_color)
                    || !self.second_color.as_deref().is_some_and(is_theme_color)
                {
                    return Err(invalid());
                }
            }
        }
        for color in [self.color.as_deref(), self.second_color.as_deref()]
            .into_iter()
            .flatten()
        {
            if !is_theme_color(color) {
                return Err(invalid());
            }
        }
        Ok(())
    }
}

impl FolderCustomizePatch {
    pub fn is_empty(&self) -> bool {
        self.color.is_none()
            && self.icon.is_none()
            && self.background.is_none()
            && self.column_set_id.is_none()
            && self.scope.is_none()
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.is_empty() {
            return Err("folder_custom.invalid".to_string());
        }
        if let Some(Some(value)) = &self.color {
            if !is_rgb(value) {
                return Err("folder_custom.invalid".to_string());
            }
        }
        if let Some(icon) = &self.icon {
            icon.validate()?;
        }
        if let Some(background) = &self.background {
            background.validate()?;
        }
        if let Some(id) = &self.column_set_id {
            if !canonical_uuid(id) {
                return Err("folder_custom.invalid".to_string());
            }
        }
        Ok(())
    }
}

impl FolderCustomization {
    pub fn apply_patch(&mut self, patch: &FolderCustomizePatch) {
        if let Some(color) = &patch.color {
            self.color = color.as_ref().map(|value| value.to_ascii_uppercase());
        }
        if let Some(icon) = &patch.icon {
            self.icon = icon.clone();
        }
        if let Some(background) = &patch.background {
            self.background = background.clone();
        }
        if let Some(id) = &patch.column_set_id {
            self.column_set_id = Some(id.clone());
        }
        if let Some(scope) = patch.scope {
            self.scope = scope;
        }
    }
}
