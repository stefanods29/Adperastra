//! Typed validation and export assembly for setup parts (Step 10e T5).
//!
//! Each part is parsed with its canonical owner type and validator before a
//! preview is shown or an Apply starts. Personal navigation paths are removed
//! from an export unless the user explicitly includes them (D7-D8).
#![allow(dead_code)]


use std::collections::BTreeMap;

use serde::Serialize;

use crate::command_layout_types::{validate_toolbar_custom_settings, ToolbarCustomSettings};
use crate::custom_theme_types::{validate_custom_theme, CustomTheme};
use crate::keyboard_map_types::{validate_keyboard_map, KeyboardMap};
use crate::setup_archive::sha256_hex;
use crate::setup_types::{
    is_canonical_uuid, SetupManifest, SetupManifestEntry, SetupPart, SetupPreview,
    SetupPreviewPart, MAX_SETUP_ASSET_BYTES, MAX_SETUP_EXPANDED_BYTES, MAX_SETUP_PART_BYTES,
    SETUP_SCHEMA_VERSION,
};
use crate::shell_custom_types::{
    HomeCustomization, MenuCustomization, MenuNode, NavigationCustomization, NavigationItemKind,
    ShellCustomization, StatusCustomization,
};
use crate::shell_custom_validation::validate_shell_custom;
use crate::LayoutSettings;

pub struct PartData {
    pub part: SetupPart,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct PartSummary {
    pub id: SetupPart,
    pub item_count: u32,
    pub warning_codes: Vec<String>,
    pub contains_personal_paths: bool,
}

fn invalid() -> String {
    "setup.invalid".to_string()
}

fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|_| invalid())
}

fn check_layout(layout: &LayoutSettings) -> Result<(), String> {
    let pick = |value: &str, allowed: &[&str]| allowed.contains(&value);
    if !pick(&layout.toolbar_position, &["top", "bottom", "left", "right"])
        || !pick(&layout.toolbar_mode, &["full", "compact", "iconsOnly", "autoHide"])
        || !pick(&layout.tab_bar_position, &["top", "bottom", "left", "right"])
        || !pick(&layout.nav_pane_position, &["left", "right", "hidden"])
        || !pick(&layout.details_pane_position, &["right", "bottom"])
        || layout.saved_presets.len() > 20
    {
        return Err(invalid());
    }
    let mut names = std::collections::HashSet::new();
    for preset in &layout.saved_presets {
        let count = preset.name.chars().count();
        if preset.name.trim() != preset.name
            || count == 0
            || count > 60
            || !names.insert(preset.name.to_lowercase())
            || !pick(&preset.toolbar_position, &["top", "bottom", "left", "right"])
            || !pick(&preset.toolbar_mode, &["full", "compact", "iconsOnly", "autoHide"])
            || !pick(&preset.tab_bar_position, &["top", "bottom", "left", "right"])
            || !pick(&preset.nav_pane_position, &["left", "right", "hidden"])
            || !pick(&preset.details_pane_position, &["right", "bottom"])
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn menu_node_count(nodes: &[MenuNode]) -> u32 {
    nodes
        .iter()
        .map(|node| {
            1 + match node {
                MenuNode::Submenu { children, .. } => menu_node_count(children),
                _ => 0,
            }
        })
        .sum()
}

fn shell_with(
    menus: Vec<MenuCustomization>,
    home: Option<HomeCustomization>,
    navigation: Option<NavigationCustomization>,
    status: Option<StatusCustomization>,
) -> ShellCustomization {
    let defaults = ShellCustomization::default();
    ShellCustomization {
        menus,
        home: home.unwrap_or(defaults.home),
        navigation: navigation.unwrap_or(defaults.navigation),
        status: status.unwrap_or(defaults.status),
    }
}

pub fn validate_part(part: SetupPart, bytes: &[u8]) -> Result<PartSummary, String> {
    if bytes.len() as u64 > MAX_SETUP_PART_BYTES {
        return Err("setup.too_large".to_string());
    }
    let mut contains_personal_paths = false;
    let item_count: u32 = match part {
        SetupPart::Theme => {
            let theme: CustomTheme = parse(bytes)?;
            validate_custom_theme(&theme).map_err(|_| invalid())?;
            1
        }
        SetupPart::Layout => {
            let layout: LayoutSettings = parse(bytes)?;
            check_layout(&layout)?;
            1
        }
        SetupPart::Menus => {
            let menus: Vec<MenuCustomization> = parse(bytes)?;
            validate_shell_custom(&shell_with(menus.clone(), None, None, None)).map_err(|_| invalid())?;
            menus.iter().map(|menu| menu_node_count(&menu.nodes)).sum()
        }
        SetupPart::Toolbars => {
            let toolbars: ToolbarCustomSettings = parse(bytes)?;
            validate_toolbar_custom_settings(&toolbars).map_err(|_| invalid())?;
            (toolbars.bars.len() + toolbars.quick_access.len()) as u32
        }
        SetupPart::Navigation => {
            let navigation: NavigationCustomization = parse(bytes)?;
            contains_personal_paths = navigation
                .sections
                .iter()
                .flat_map(|section| section.items.iter())
                .any(|item| matches!(item.kind, NavigationItemKind::Folder));
            let count: u32 = navigation.sections.iter().map(|section| 1 + section.items.len() as u32).sum();
            validate_shell_custom(&shell_with(Vec::new(), None, Some(navigation), None)).map_err(|_| invalid())?;
            count
        }
        SetupPart::Home => {
            let home: HomeCustomization = parse(bytes)?;
            let count = home.sections.len() as u32;
            validate_shell_custom(&shell_with(Vec::new(), Some(home), None, None)).map_err(|_| invalid())?;
            count
        }
        SetupPart::Status => {
            let status: StatusCustomization = parse(bytes)?;
            validate_shell_custom(&shell_with(Vec::new(), None, None, Some(status.clone()))).map_err(|_| invalid())?;
            let orders = [
                &status.orders.explorer,
                &status.orders.text,
                &status.orders.pdf,
                &status.orders.image,
                &status.orders.media,
                &status.orders.office,
            ];
            orders.iter().map(|order| order.len() as u32).sum()
        }
        SetupPart::Keyboard => {
            let map: KeyboardMap = parse(bytes)?;
            validate_keyboard_map(&map).map_err(|_| invalid())?;
            map.bindings.len() as u32
        }
    };
    Ok(PartSummary {
        id: part,
        item_count,
        warning_codes: if contains_personal_paths {
            vec!["personal_paths".to_string()]
        } else {
            Vec::new()
        },
        contains_personal_paths,
    })
}

/// The immutable preview: part counts and warnings only, no settings.
pub fn build_preview(
    preview_id: String,
    manifest: SetupManifest,
    files: &BTreeMap<String, Vec<u8>>,
    expires_unix: u64,
) -> Result<SetupPreview, String> {
    if !is_canonical_uuid(&preview_id) || !crate::setup_types::is_safe_u64(expires_unix) {
        return Err(invalid());
    }
    let mut parts = Vec::new();
    for part in &manifest.parts {
        let name = format!("data/{}.json", part.id());
        let bytes = files.get(&name).ok_or_else(invalid)?;
        let summary = validate_part(*part, bytes)?;
        parts.push(SetupPreviewPart {
            id: *part,
            item_count: summary.item_count,
            warning_codes: summary.warning_codes,
        });
    }
    Ok(SetupPreview {
        preview_id,
        manifest,
        parts,
        expires_unix,
    })
}

/// Remove every explicit custom-folder item from an export. The app never
/// renames or moves the folder itself; this only stops sharing its location.
pub fn strip_personal_paths(navigation: &mut NavigationCustomization) -> bool {
    let mut removed = false;
    for section in &mut navigation.sections {
        let before = section.items.len();
        section.items.retain(|item| !matches!(item.kind, NavigationItemKind::Folder));
        removed |= section.items.len() != before;
    }
    removed
}

pub fn encode_part<T: Serialize>(part: SetupPart, value: &T) -> Result<PartData, String> {
    let bytes = serde_json::to_vec(value).map_err(|_| invalid())?;
    if bytes.len() as u64 > MAX_SETUP_PART_BYTES {
        return Err("setup.too_large".to_string());
    }
    validate_part(part, &bytes)?;
    Ok(PartData { part, bytes })
}

/// Build the manifest and the exact files a writer puts in the ZIP. Assets
/// are owned UUID PNGs, never a source path.
#[allow(clippy::type_complexity)]
pub fn build_export_manifest(
    app_version: &str,
    created_unix: u64,
    parts: Vec<PartData>,
    assets: Vec<(String, Vec<u8>)>,
    contains_personal_paths: bool,
) -> Result<(SetupManifest, Vec<(String, Vec<u8>)>), String> {
    if !crate::setup_types::is_safe_u64(created_unix) {
        return Err(invalid());
    }
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut ids = Vec::new();
    let mut entries = Vec::new();
    let mut total = 0u64;
    for data in parts {
        if ids.contains(&data.part) {
            return Err(invalid());
        }
        ids.push(data.part);
        total = total.saturating_add(data.bytes.len() as u64);
        let name = format!("data/{}.json", data.part.id());
        entries.push(SetupManifestEntry {
            name: name.clone(),
            byte_len: data.bytes.len() as u64,
            sha256: sha256_hex(&data.bytes),
        });
        files.push((name, data.bytes));
    }
    for (name, bytes) in assets {
        if !name.starts_with("assets/") || !name.ends_with(".png") || !is_canonical_uuid(&name[7..name.len() - 4]) {
            return Err(invalid());
        }
        if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            return Err(invalid());
        }
        if bytes.len() as u64 > MAX_SETUP_ASSET_BYTES {
            return Err("setup.too_large".to_string());
        }
        total = total.saturating_add(bytes.len() as u64);
        entries.push(SetupManifestEntry {
            name: name.clone(),
            byte_len: bytes.len() as u64,
            sha256: sha256_hex(&bytes),
        });
        files.push((name, bytes));
    }
    if ids.is_empty() {
        return Err(invalid());
    }
    if total > MAX_SETUP_EXPANDED_BYTES {
        return Err("setup.too_large".to_string());
    }
    let manifest = SetupManifest {
        schema_version: SETUP_SCHEMA_VERSION,
        app_version: app_version.to_string(),
        parts: ids,
        entries,
        contains_personal_paths,
        created_unix,
    };
    crate::setup_types::validate_manifest(&manifest)?;
    Ok((manifest, files))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_custom_types::{NavigationItem, NavigationSectionLayout, StatusCustomization};

    #[test]
    fn personal_default_absent() {
        let mut navigation = NavigationCustomization::default();
        navigation.sections.push(NavigationSectionLayout {
            id: "custom_work".to_string(),
            label: Some("Work".to_string()),
            visible: true,
            items: vec![NavigationItem {
                id: "00000000-0000-4000-a000-000000000001".to_string(),
                kind: NavigationItemKind::Folder,
                target_id: "C:\\Work\\Data".to_string(),
                display_label: Some("Data".to_string()),
                visible: true,
                section_id: "custom_work".to_string(),
            }],
        });
        let summary = validate_part(SetupPart::Navigation, &serde_json::to_vec(&navigation).unwrap()).unwrap();
        assert!(summary.contains_personal_paths);
        assert!(strip_personal_paths(&mut navigation));
        assert!(navigation
            .sections
            .iter()
            .flat_map(|section| section.items.iter())
            .all(|item| !matches!(item.kind, NavigationItemKind::Folder)));
        let stripped = serde_json::to_vec(&navigation).unwrap();
        let summary = validate_part(SetupPart::Navigation, &stripped).unwrap();
        assert!(!summary.contains_personal_paths);
    }

    #[test]
    fn empty_status_part_is_valid() {
        let status = StatusCustomization::default();
        let bytes = serde_json::to_vec(&status).unwrap();
        let summary = validate_part(SetupPart::Status, &bytes).unwrap();
        assert_eq!(summary.item_count, 5);
    }

    #[test]
    fn oversized_part_refused() {
        let bytes = vec![b' '; MAX_SETUP_PART_BYTES as usize + 1];
        assert_eq!(validate_part(SetupPart::Layout, &bytes).unwrap_err(), "setup.too_large");
    }

    #[test]
    fn manifest_hashes_every_file() {
        let part = encode_part(SetupPart::Status, &StatusCustomization::default()).unwrap();
        let (manifest, files) = build_export_manifest("0.1.16", 1_800_000_000, vec![part], Vec::new(), false).unwrap();
        assert_eq!(manifest.entries.len(), 1);
        assert_eq!(manifest.entries[0].name, "data/status.json");
        assert_eq!(files.len(), 1);
        assert_eq!(manifest.entries[0].sha256, sha256_hex(&files[0].1));
    }
}
