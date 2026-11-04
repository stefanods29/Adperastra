//! Office pack font inventory (Step 13 T6).
//!
//! Fonts stay inside the signed, replaceable Office pack. This module validates
//! the manifest before a pack can be activated: every file is relative, its
//! SHA-256 and license are recorded, and the required metric-compatible
//! families are present. It never downloads a font, reads a document web-font
//! URL, installs a system font or commits a font binary.
//!
//! The cache key component includes the manifest revision and exact file
//! hashes, so replacing a font invalidates every previously cached page.
#![allow(dead_code)]


use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

/// The manifest schema this build understands.
pub const OFFICE_FONT_SCHEMA: u32 = 1;
/// A pack manifest stays small and bounded.
pub const OFFICE_FONT_MAX_FAMILIES: usize = 64;
pub const OFFICE_FONT_MAX_FILES: usize = 512;
pub const OFFICE_FONT_MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// Required metric-compatible families (D7). Inter is separate: it belongs to
/// 08b's provisioned app-authored export assets, not to this pack inventory.
pub const REQUIRED_FAMILIES: &[&str] = &[
    "Carlito",
    "Caladea",
    "Liberation Sans",
    "Liberation Serif",
    "Liberation Mono",
    "Noto Sans",
];
/// Licenses a font file may carry in the pack.
pub const ALLOWED_FONT_LICENSES: &[&str] = &[
    "SIL-OFL-1.1",
    "Apache-2.0",
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeFontFile {
    /// Relative path under the pack's `fonts/` directory. No absolute path,
    /// `..`, backslash, ADS or drive prefix.
    pub path: String,
    pub family: String,
    pub style: String,
    pub weight: u16,
    pub italic: bool,
    pub byte_len: u64,
    /// 64 lower-case hex characters.
    pub sha256: String,
    pub license: String,
    pub license_file: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeFontManifest {
    pub schema_version: u32,
    pub revision: u32,
    pub files: Vec<OfficeFontFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontSubstitution {
    pub requested: String,
    pub used: String,
    pub warning_key: &'static str,
}

impl OfficeFontManifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != OFFICE_FONT_SCHEMA || self.revision == 0 {
            return Err("office.unsupported".to_string());
        }
        if self.files.is_empty() || self.files.len() > OFFICE_FONT_MAX_FILES {
            return Err("office.too_large".to_string());
        }
        let mut families = HashSet::new();
        let mut paths = HashSet::new();
        let mut styles = HashSet::new();
        for file in &self.files {
            if !valid_font_path(&file.path) || !valid_license_file(&file.license_file) {
                return Err("office.unsupported".to_string());
            }
            if !paths.insert(file.path.to_ascii_lowercase()) {
                return Err("office.unsupported".to_string());
            }
            if file.family.is_empty() || file.family.len() > 128 || file.style.len() > 64 {
                return Err("office.unsupported".to_string());
            }
            if file.byte_len == 0 || file.byte_len > OFFICE_FONT_MAX_FILE_BYTES {
                return Err("office.too_large".to_string());
            }
            if file.sha256.len() != 64
                || !file
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err("office.unsupported".to_string());
            }
            if !ALLOWED_FONT_LICENSES
                .iter()
                .any(|license| license.eq_ignore_ascii_case(&file.license))
            {
                return Err("office.unsupported".to_string());
            }
            let style_key = format!("{}|{}|{}|{}", file.family, file.style, file.weight, file.italic);
            if !styles.insert(style_key) {
                return Err("office.unsupported".to_string());
            }
            families.insert(file.family.clone());
        }
        if families.len() > OFFICE_FONT_MAX_FAMILIES {
            return Err("office.too_large".to_string());
        }
        for required in REQUIRED_FAMILIES {
            if !families.iter().any(|family| family.eq_ignore_ascii_case(required)) {
                return Err("office.unsupported".to_string());
            }
        }
        Ok(())
    }

    /// Stable cache/catalog revision. Every byte-affecting field participates;
    /// a changed file hash changes the value even when the semver does not.
    pub fn inventory_hash(&self) -> String {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"adperastra-office-fonts\0");
        hasher.update(&self.schema_version.to_le_bytes());
        hasher.update(&self.revision.to_le_bytes());
        let mut files: Vec<&OfficeFontFile> = self.files.iter().collect();
        files.sort_by(|left, right| left.path.cmp(&right.path));
        for file in files {
            for part in [
                file.path.as_str(),
                file.family.as_str(),
                file.style.as_str(),
                file.license.as_str(),
                file.license_file.as_str(),
                file.sha256.as_str(),
            ] {
                hasher.update(&(part.len() as u64).to_le_bytes());
                hasher.update(part.as_bytes());
            }
            hasher.update(&file.weight.to_le_bytes());
            hasher.update(&[file.italic as u8]);
            hasher.update(&file.byte_len.to_le_bytes());
        }
        hasher.finalize().to_hex().to_string()
    }

    /// The value used in an Office page cache key. The engine version is added
    /// by the page producer; this component alone changes when a font file does.
    pub fn cache_component(&self) -> String {
        format!("fonts:v{}:{}", self.revision, self.inventory_hash())
    }
}

/// The documented substitutions. The original family is never silently
/// replaced: `substitution_for` returns the warning key used by the UI.
pub fn substitution_map() -> BTreeMap<String, String> {
    [
        ("Calibri", "Carlito"),
        ("Cambria", "Caladea"),
        ("Arial", "Liberation Sans"),
        ("Helvetica", "Liberation Sans"),
        ("Times New Roman", "Liberation Serif"),
        ("Times", "Liberation Serif"),
        ("Courier New", "Liberation Mono"),
        ("Courier", "Liberation Mono"),
        ("Aptos", "Carlito"),
        ("Aptos Display", "Carlito"),
    ]
    .into_iter()
    .map(|(requested, used)| (requested.to_string(), used.to_string()))
    .collect()
}

/// Return a warning when `requested` is not in the active inventory. A missing
/// family never becomes a silent successful render.
pub fn substitution_for(
    requested: &str,
    manifest: &OfficeFontManifest,
) -> Option<FontSubstitution> {
    let available = manifest
        .files
        .iter()
        .any(|file| file.family.eq_ignore_ascii_case(requested));
    if available {
        return None;
    }
    let map = substitution_map();
    let preferred = map
        .iter()
        .find(|(family, _)| family.eq_ignore_ascii_case(requested))
        .map(|(_, used)| used.clone());
    let used = preferred
        .filter(|family| {
            manifest
                .files
                .iter()
                .any(|file| file.family.eq_ignore_ascii_case(family))
        })
        .or_else(|| {
            manifest
                .files
                .iter()
                .find(|file| file.family.eq_ignore_ascii_case("Noto Sans"))
                .map(|file| file.family.clone())
        })
        .unwrap_or_default();
    Some(FontSubstitution {
        requested: requested.to_string(),
        used,
        warning_key: "office.fontSubstitution",
    })
}

/// A font path is relative under `fonts/`, uses `/`, and cannot escape.
pub fn valid_font_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && !path.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        && path.starts_with("fonts/")
        && path.to_ascii_lowercase().ends_with(".ttf")
}

pub fn valid_license_file(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        && (path.to_ascii_lowercase().contains("license") || path.to_ascii_lowercase().contains("ofl"))
}

#[cfg(test)]
#[path = "office_fonts_step13_tests.rs"]
mod step13_tests;
