//! Strict validation for the shell customization data (Step 10e T1).
//!
//! Unknown fields are refused by serde's `deny_unknown_fields`; this module
//! checks ids, labels, depth, duplicate targets/nodes and every count bound.
//! Error codes are stable so the UI can translate them.

use std::collections::HashSet;

use crate::shell_custom_types::{
    HomeCustomization, MenuNode, NavigationCustomization, NavigationItemKind, ShellCustomization,
    StatusCustomization, BUILTIN_NAV_SECTIONS, MAX_COMMAND_ID_CHARS, MAX_CUSTOM_NAV_ITEMS,
    MAX_CUSTOM_NAV_SECTIONS, MAX_HOME_LIMIT, MAX_HOME_SECTIONS, MAX_MENU_DEPTH, MAX_MENU_NODES,
    MAX_NAV_LABEL_CHARS, MAX_NAV_ROW_HEIGHT, MAX_NAV_SECTIONS, MAX_NAV_WIDTH,
    MAX_STATUS_FIELDS_PER_KIND, MAX_STATUS_ID_CHARS, MAX_SUBMENU_CHILDREN, MAX_SUBMENU_LABEL_CHARS,
    MAX_TOTAL_MENU_NODES, MIN_NAV_ROW_HEIGHT, MIN_NAV_WIDTH, NAV_ICON_SIZES,
};

fn is_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || value.starts_with(r"\\")
}

pub const MAX_SHELL_RECORD_BYTES: usize = 1024 * 1024;
pub const MAX_SHELL_TOTAL_BYTES: usize = 4 * 1024 * 1024;

fn json_len<T: serde::Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

pub fn is_canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}

pub fn is_safe_label(value: &str, max: usize) -> bool {
    if value.trim() != value || value.is_empty() {
        return false;
    }
    let mut count = 0;
    for character in value.chars() {
        count += 1;
        let code = character as u32;
        if code < 0x20 || code == 0x7f {
            return false;
        }
    }
    count <= max
}

fn is_safe_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= max
        && value
            .chars()
            .all(|character| character as u32 >= 0x20 && character != '\x7f')
}

fn is_registered_section_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() || value.len() > 64 {
        return false;
    }
    characters.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_')
}

fn check_menu_node(
    node: &MenuNode,
    depth: usize,
    ids: &mut HashSet<String>,
    count: &mut usize,
) -> Result<(), &'static str> {
    if depth > MAX_MENU_DEPTH {
        return Err("catalog.invalid");
    }
    *count += 1;
    if *count > MAX_MENU_NODES {
        return Err("catalog.limit");
    }
    let (id, children) = match node {
        MenuNode::Command { id, command_id, .. } => {
            if !is_canonical_uuid(id) || !is_safe_text(command_id, MAX_COMMAND_ID_CHARS) {
                return Err("catalog.invalid");
            }
            (id, None)
        }
        MenuNode::Separator { id } => {
            if !is_canonical_uuid(id) {
                return Err("catalog.invalid");
            }
            (id, None)
        }
        MenuNode::Submenu {
            id, label, children, ..
        } => {
            if !is_canonical_uuid(id) || !is_safe_label(label, MAX_SUBMENU_LABEL_CHARS) {
                return Err("catalog.invalid");
            }
            if children.len() > MAX_SUBMENU_CHILDREN {
                return Err("catalog.limit");
            }
            (id, Some(children))
        }
    };
    if !ids.insert(id.clone()) {
        return Err("catalog.invalid");
    }
    if let Some(children) = children {
        for child in children {
            check_menu_node(child, depth + 1, ids, count)?;
        }
    }
    Ok(())
}

fn check_home(home: &HomeCustomization) -> Result<(), &'static str> {
    if home.sections.len() > MAX_HOME_SECTIONS {
        return Err("catalog.limit");
    }
    let mut ids = HashSet::new();
    for section in &home.sections {
        if !is_registered_section_id(&section.id) || !ids.insert(section.id.clone()) {
            return Err("catalog.invalid");
        }
        if section.limit == 0 || section.limit > MAX_HOME_LIMIT {
            return Err("catalog.invalid");
        }
    }
    Ok(())
}

fn check_navigation(navigation: &NavigationCustomization) -> Result<(), &'static str> {
    if navigation.sections.len() > MAX_NAV_SECTIONS {
        return Err("catalog.limit");
    }
    if navigation.row_height_px < MIN_NAV_ROW_HEIGHT
        || navigation.row_height_px > MAX_NAV_ROW_HEIGHT
        || !NAV_ICON_SIZES.contains(&navigation.icon_size_px)
        || navigation.width_px < MIN_NAV_WIDTH
        || navigation.width_px > MAX_NAV_WIDTH
    {
        return Err("catalog.invalid");
    }
    let mut section_ids = HashSet::new();
    let mut item_ids = HashSet::new();
    let mut custom_sections = 0;
    let mut custom_items = 0;
    for section in &navigation.sections {
        if !is_registered_section_id(&section.id) || !section_ids.insert(section.id.clone()) {
            return Err("catalog.invalid");
        }
        if let Some(label) = &section.label {
            if !is_safe_label(label, MAX_NAV_LABEL_CHARS) {
                return Err("catalog.invalid");
            }
        }
        if !BUILTIN_NAV_SECTIONS.contains(&section.id.as_str()) {
            custom_sections += 1;
            if custom_sections > MAX_CUSTOM_NAV_SECTIONS {
                return Err("catalog.limit");
            }
        }
        for item in &section.items {
            if item.section_id != section.id || !item_ids.insert(item.id.clone()) {
                return Err("catalog.invalid");
            }
            let builtin = matches!(item.kind, NavigationItemKind::Builtin);
            if builtin {
                if !item.id.starts_with("builtin:") {
                    return Err("catalog.invalid");
                }
            } else {
                custom_items += 1;
                if custom_items > MAX_CUSTOM_NAV_ITEMS {
                    return Err("catalog.limit");
                }
                if !is_canonical_uuid(&item.id) || !is_absolute_path(&item.target_id) {
                    return Err("catalog.invalid");
                }
            }
            if !is_safe_text(&item.target_id, 32768) {
                return Err("catalog.invalid");
            }
            if let Some(label) = &item.display_label {
                if !is_safe_label(label, MAX_NAV_LABEL_CHARS) {
                    return Err("catalog.invalid");
                }
            }
        }
    }
    Ok(())
}

fn check_status(status: &StatusCustomization) -> Result<(), &'static str> {
    let orders = [
        &status.orders.explorer,
        &status.orders.text,
        &status.orders.pdf,
        &status.orders.image,
        &status.orders.media,
        &status.orders.office,
    ];
    for order in orders {
        if order.len() > MAX_STATUS_FIELDS_PER_KIND {
            return Err("catalog.limit");
        }
        let mut ids = HashSet::new();
        for entry in order {
            if entry.id.is_empty() || entry.id.chars().count() > MAX_STATUS_ID_CHARS || !ids.insert(entry.id.clone()) {
                return Err("catalog.invalid");
            }
        }
    }
    Ok(())
}

/// Validate the whole section. Error codes only, as the UI translates them.
pub fn validate_shell_custom(value: &ShellCustomization) -> Result<(), String> {
    if value.menus.len() > 5 {
        return Err("catalog.limit".to_string());
    }
    let mut targets = HashSet::new();
    let mut ids = HashSet::new();
    let mut total = 0usize;
    for menu in &value.menus {
        if !targets.insert(format!("{:?}", menu.target)) || menu.nodes.len() > MAX_MENU_NODES {
            return Err("catalog.invalid".to_string());
        }
        let mut menu_nodes = 0usize;
        for node in &menu.nodes {
            check_menu_node(node, 1, &mut ids, &mut menu_nodes).map_err(str::to_string)?;
        }
        total += menu_nodes;
        if total > MAX_TOTAL_MENU_NODES {
            return Err("catalog.limit".to_string());
        }
    }
    check_home(&value.home).map_err(str::to_string)?;
    check_navigation(&value.navigation).map_err(str::to_string)?;
    check_status(&value.status).map_err(str::to_string)?;
    if json_len(&value.menus) > MAX_SHELL_RECORD_BYTES
        || json_len(&value.home) > MAX_SHELL_RECORD_BYTES
        || json_len(&value.navigation) > MAX_SHELL_RECORD_BYTES
        || json_len(&value.status) > MAX_SHELL_RECORD_BYTES
        || json_len(value) > MAX_SHELL_TOTAL_BYTES
    {
        return Err("catalog.limit".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_custom_types::*;

    fn command(id: &str) -> MenuNode {
        MenuNode::Command {
            id: id.to_string(),
            command_id: "explorer.copy".to_string(),
            visible: true,
            placement: MenuPlacement::Direct,
        }
    }

    fn submenu(id: &str, children: Vec<MenuNode>) -> MenuNode {
        MenuNode::Submenu {
            id: id.to_string(),
            label: "Example".to_string(),
            children,
            visible: true,
            placement: MenuPlacement::Direct,
        }
    }

    #[test]
    fn depth_four_refused() {
        let mut value = ShellCustomization::default();
        value.menus.push(MenuCustomization {
            target: MenuTarget::File,
            nodes: vec![submenu(
                "00000000-0000-4000-a000-000000000001",
                vec![submenu(
                    "00000000-0000-4000-a000-000000000002",
                    vec![submenu(
                        "00000000-0000-4000-a000-000000000003",
                        vec![command("00000000-0000-4000-a000-000000000004")],
                    )],
                )],
            )],
        });
        assert_eq!(validate_shell_custom(&value).unwrap_err(), "catalog.invalid");
    }

    #[test]
    fn duplicate_node_id_refused() {
        let mut value = ShellCustomization::default();
        value.menus.push(MenuCustomization {
            target: MenuTarget::File,
            nodes: vec![
                command("00000000-0000-4000-a000-000000000001"),
                command("00000000-0000-4000-a000-000000000001"),
            ],
        });
        assert_eq!(validate_shell_custom(&value).unwrap_err(), "catalog.invalid");
    }

    #[test]
    fn too_many_menu_nodes_refused() {
        let mut value = ShellCustomization::default();
        let nodes = (0..=MAX_MENU_NODES)
            .map(|index| command(&format!("00000000-0000-4000-a000-{index:012}")))
            .collect();
        value.menus.push(MenuCustomization {
            target: MenuTarget::File,
            nodes,
        });
        assert_eq!(validate_shell_custom(&value).unwrap_err(), "catalog.invalid");
    }

    #[test]
    fn callback_field_refused() {
        let parsed: Result<MenuNode, _> = serde_json::from_value(serde_json::json!({
            "kind": "command",
            "id": "00000000-0000-4000-a000-000000000001",
            "command_id": "explorer.copy",
            "visible": true,
            "placement": "direct",
            "run": "malicious()"
        }));
        assert!(parsed.is_err(), "an unknown callback field must be refused");
    }

    #[test]
    fn defaults_keep_home_order() {
        let home = HomeCustomization::default();
        let ids: Vec<&str> = home.sections.iter().map(|section| section.id.as_str()).collect();
        assert_eq!(ids, ["quick_access", "recent", "favorites"]);
    }

    #[test]
    fn navigation_folder_must_be_absolute() {
        let mut value = ShellCustomization::default();
        value.navigation.sections[2].items.push(NavigationItem {
            id: "00000000-0000-4000-a000-000000000001".to_string(),
            kind: NavigationItemKind::Folder,
            target_id: "relative\\folder".to_string(),
            display_label: None,
            visible: true,
            section_id: "pinned".to_string(),
        });
        assert_eq!(validate_shell_custom(&value).unwrap_err(), "catalog.invalid");
    }

    #[test]
    fn status_order_duplicates_refused() {
        let mut value = ShellCustomization::default();
        value.status.orders.explorer.push(StatusFieldOrderEntry {
            id: "item_count".to_string(),
            visible: false,
        });
        assert_eq!(validate_shell_custom(&value).unwrap_err(), "catalog.invalid");
    }
}
