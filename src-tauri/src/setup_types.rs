//! Native setup-file wire types (Step 10e, setup-file-1).
//!
//! A setup is ZIP data, never code. The manifest names only three fixed,
//! relative entry families; everything else is refused before a preview is
//! built. The TypeScript mirror is `src/services/setups.ts`.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const SETUP_SCHEMA_VERSION: u32 = 1;
pub const MAX_SETUP_COMPRESSED_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_SETUP_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SETUP_ENTRIES: usize = 256;
pub const MAX_SETUP_DEPTH: usize = 4;
pub const MAX_SETUP_RATIO: u64 = 100;
pub const MAX_SETUP_PART_BYTES: u64 = 1024 * 1024;
pub const MAX_SETUP_ASSET_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_SETUP_APP_VERSION_CHARS: usize = 128;
pub const MAX_SETUP_WARNINGS: usize = 64;
pub const MAX_SAFE_UNIX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupPart {
    Theme,
    Layout,
    Menus,
    Toolbars,
    Navigation,
    Home,
    Status,
    Keyboard,
}

pub const SETUP_PARTS: [SetupPart; 8] = [
    SetupPart::Theme,
    SetupPart::Layout,
    SetupPart::Menus,
    SetupPart::Toolbars,
    SetupPart::Navigation,
    SetupPart::Home,
    SetupPart::Status,
    SetupPart::Keyboard,
];

impl SetupPart {
    pub fn id(self) -> &'static str {
        match self {
            SetupPart::Theme => "theme",
            SetupPart::Layout => "layout",
            SetupPart::Menus => "menus",
            SetupPart::Toolbars => "toolbars",
            SetupPart::Navigation => "navigation",
            SetupPart::Home => "home",
            SetupPart::Status => "status",
            SetupPart::Keyboard => "keyboard",
        }
    }

    pub fn from_id(value: &str) -> Option<Self> {
        SETUP_PARTS.iter().copied().find(|part| part.id() == value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupManifestEntry {
    pub name: String,
    pub byte_len: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub parts: Vec<SetupPart>,
    pub entries: Vec<SetupManifestEntry>,
    pub contains_personal_paths: bool,
    pub created_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupPreviewPart {
    pub id: SetupPart,
    pub item_count: u32,
    pub warning_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupPreview {
    pub preview_id: String,
    pub manifest: SetupManifest,
    pub parts: Vec<SetupPreviewPart>,
    pub expires_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupApplyRequest {
    pub preview_id: String,
    pub parts: Vec<SetupPart>,
    pub accept_personal_paths: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupApplyResult {
    pub applied_parts: Vec<SetupPart>,
    pub history_id: String,
    pub restart_required: bool,
    pub pending_recovery: bool,
    pub warning_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupEntryKind {
    Manifest,
    Part(SetupPart),
    Asset,
}

pub fn is_safe_u64(value: u64) -> bool {
    value <= MAX_SAFE_UNIX
}

pub fn is_canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

/// Classify one ZIP entry name; `None` means it is outside the fixed format.
pub fn classify_entry(name: &str) -> Option<SetupEntryKind> {
    if name.is_empty()
        || name.len() > 512
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('/')
        || name.contains(':')
        || name.split('/').count() > MAX_SETUP_DEPTH
    {
        return None;
    }
    if name == "manifest.json" {
        return Some(SetupEntryKind::Manifest);
    }
    if let Some(rest) = name.strip_prefix("data/").and_then(|value| value.strip_suffix(".json")) {
        return SetupPart::from_id(rest).map(SetupEntryKind::Part);
    }
    if let Some(rest) = name.strip_prefix("assets/").and_then(|value| value.strip_suffix(".png")) {
        return is_canonical_uuid(rest).then_some(SetupEntryKind::Asset);
    }
    None
}

fn valid_app_version(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= MAX_SETUP_APP_VERSION_CHARS && !value.chars().any(|c| c < ' ')
}

/// Full manifest validation. Unknown fields are refused by serde; the rest
/// is checked here so a preview can never be built from a half-valid file.
pub fn validate_manifest(manifest: &SetupManifest) -> Result<(), String> {
    if manifest.schema_version != SETUP_SCHEMA_VERSION {
        return Err("setup.unsupported_version".to_string());
    }
    if !valid_app_version(&manifest.app_version) {
        return Err("setup.invalid".to_string());
    }
    if manifest.parts.is_empty() || manifest.parts.len() > SETUP_PARTS.len() {
        return Err("setup.invalid".to_string());
    }
    let mut parts = HashSet::new();
    for part in &manifest.parts {
        if !parts.insert(*part) {
            return Err("setup.invalid".to_string());
        }
    }
    if manifest.entries.len() >= MAX_SETUP_ENTRIES || !is_safe_u64(manifest.created_unix) {
        return Err("setup.too_large".to_string());
    }
    let mut names = HashSet::new();
    let mut part_entries = HashSet::new();
    for entry in &manifest.entries {
        match classify_entry(&entry.name) {
            Some(SetupEntryKind::Part(part)) => {
                part_entries.insert(part);
            }
            Some(_) => return Err("setup.invalid".to_string()),
            None => return Err("setup.invalid".to_string()),
        }
        let limit = if entry.name.starts_with("assets/") {
            MAX_SETUP_ASSET_BYTES
        } else {
            MAX_SETUP_PART_BYTES
        };
        if !is_safe_u64(entry.byte_len) || entry.byte_len > limit {
            return Err("setup.too_large".to_string());
        }
        if !is_lower_hex(&entry.sha256, 64) {
            return Err("setup.invalid".to_string());
        }
        if !names.insert(entry.name.to_lowercase()) {
            return Err("setup.invalid".to_string());
        }
    }
    for part in &manifest.parts {
        if !part_entries.contains(part) {
            return Err("setup.invalid".to_string());
        }
    }
    for part in &part_entries {
        if !manifest.parts.contains(part) {
            return Err("setup.invalid".to_string());
        }
    }
    Ok(())
}

pub fn validate_apply_request(request: &SetupApplyRequest) -> Result<(), String> {
    if !is_canonical_uuid(&request.preview_id) {
        return Err("setup.invalid".to_string());
    }
    if request.parts.is_empty() || request.parts.len() > SETUP_PARTS.len() {
        return Err("setup.invalid".to_string());
    }
    let mut seen = HashSet::new();
    for part in &request.parts {
        if !seen.insert(*part) {
            return Err("setup.invalid".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, data: &[u8]) -> SetupManifestEntry {
        SetupManifestEntry {
            name: name.to_string(),
            byte_len: data.len() as u64,
            sha256: "0".repeat(64),
        }
    }

    fn manifest() -> SetupManifest {
        SetupManifest {
            schema_version: 1,
            app_version: "0.1.16".to_string(),
            parts: vec![SetupPart::Menus],
            entries: vec![entry("data/menus.json", b"[]")],
            contains_personal_paths: false,
            created_unix: 1_800_000_000,
        }
    }

    #[test]
    fn valid_manifest_accepted() {
        assert_eq!(validate_manifest(&manifest()), Ok(()));
    }

    #[test]
    fn traversal_name_refused() {
        let mut value = manifest();
        value.entries[0].name = "data/../evil.json".to_string();
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn executable_entry_refused() {
        let mut value = manifest();
        value.entries[0].name = "data/setup.exe".to_string();
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn duplicate_casefold_name_refused() {
        let mut value = manifest();
        value.entries.push(entry("data/Menus.json", b"[]"));
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn unsupported_version_refused() {
        let mut value = manifest();
        value.schema_version = 2;
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.unsupported_version");
    }

    #[test]
    fn part_without_data_refused() {
        let mut value = manifest();
        value.parts.push(SetupPart::Home);
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn uppercase_hash_refused() {
        let mut value = manifest();
        value.entries[0].sha256 = "A".repeat(64);
        assert_eq!(validate_manifest(&value).unwrap_err(), "setup.invalid");
    }
}
