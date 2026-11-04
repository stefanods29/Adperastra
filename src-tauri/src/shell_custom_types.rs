//! Native mirror of the shell customization data (Step 10e, shell-sections-1).
//!
//! The canonical TypeScript types live in `src/shell/types.ts`. Persisted
//! values are data only: no callbacks, paths used as commands, shell strings
//! or URLs. Validation is in `shell_custom_validation.rs` to keep both files
//! within the repository's 400-line limit.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

pub const MAX_MENU_NODES: usize = 100;
pub const MAX_TOTAL_MENU_NODES: usize = 500;
pub const MAX_MENU_DEPTH: usize = 3;
pub const MAX_SUBMENU_CHILDREN: usize = 50;
pub const MAX_COMMAND_ID_CHARS: usize = 128;
pub const MAX_SUBMENU_LABEL_CHARS: usize = 60;
pub const MAX_HOME_SECTIONS: usize = 32;
pub const MAX_HOME_LIMIT: u32 = 100;
pub const MAX_HOME_SECTION_ID_CHARS: usize = 64;
pub const MAX_NAV_SECTIONS: usize = 32;
pub const MAX_CUSTOM_NAV_SECTIONS: usize = 20;
pub const MAX_CUSTOM_NAV_ITEMS: usize = 200;
pub const MAX_NAV_LABEL_CHARS: usize = 60;
pub const MIN_NAV_ROW_HEIGHT: u32 = 28;
pub const MAX_NAV_ROW_HEIGHT: u32 = 48;
pub const NAV_ICON_SIZES: [u32; 3] = [16, 20, 24];
pub const MIN_NAV_WIDTH: u32 = 160;
pub const MAX_NAV_WIDTH: u32 = 480;
pub const MAX_STATUS_FIELDS_PER_KIND: usize = 64;
pub const MAX_STATUS_ID_CHARS: usize = 128;
pub const MAX_STATUS_TEXT_CHARS: usize = 512;

pub const BUILTIN_NAV_SECTIONS: &[&str] = &[
    "home",
    "gallery",
    "pinned",
    "this_pc",
    "network",
    "saved_groups",
];
pub const STATUS_KIND_NAMES: &[&str] = &["explorer", "text", "pdf", "image", "media", "office"];

fn default_true() -> bool {
    true
}

fn default_home_limit() -> u32 {
    12
}

fn default_row_height() -> u32 {
    32
}

fn default_icon_size() -> u32 {
    20
}

fn default_width() -> u32 {
    240
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MenuTarget {
    #[default]
    File,
    Folder,
    Background,
    Tab,
    Group,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MenuPlacement {
    #[default]
    Direct,
    More,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MenuNode {
    Command {
        id: String,
        command_id: String,
        #[serde(default = "default_true")]
        visible: bool,
        #[serde(default)]
        placement: MenuPlacement,
    },
    Separator {
        id: String,
    },
    Submenu {
        id: String,
        label: String,
        #[serde(default)]
        children: Vec<MenuNode>,
        #[serde(default = "default_true")]
        visible: bool,
        #[serde(default)]
        placement: MenuPlacement,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuCustomization {
    pub target: MenuTarget,
    pub nodes: Vec<MenuNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum HomeSectionSize {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HomeSectionLayout {
    pub id: String,
    pub visible: bool,
    pub collapsed: bool,
    #[serde(default)]
    pub size: HomeSectionSize,
    #[serde(default = "default_home_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HomeCustomization {
    pub sections: Vec<HomeSectionLayout>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NavigationItemKind {
    Builtin,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationItem {
    pub id: String,
    pub kind: NavigationItemKind,
    pub target_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_label: Option<String>,
    pub visible: bool,
    pub section_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationSectionLayout {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub visible: bool,
    #[serde(default)]
    pub items: Vec<NavigationItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationCustomization {
    pub sections: Vec<NavigationSectionLayout>,
    #[serde(default = "default_row_height")]
    pub row_height_px: u32,
    #[serde(default = "default_icon_size")]
    pub icon_size_px: u32,
    #[serde(default = "default_width")]
    pub width_px: u32,
    #[serde(default)]
    pub auto_collapse: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusFieldOrderEntry {
    pub id: String,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusOrders {
    #[serde(default)]
    pub explorer: Vec<StatusFieldOrderEntry>,
    #[serde(default)]
    pub text: Vec<StatusFieldOrderEntry>,
    #[serde(default)]
    pub pdf: Vec<StatusFieldOrderEntry>,
    #[serde(default)]
    pub image: Vec<StatusFieldOrderEntry>,
    #[serde(default)]
    pub media: Vec<StatusFieldOrderEntry>,
    #[serde(default)]
    pub office: Vec<StatusFieldOrderEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusCustomization {
    pub visible: bool,
    pub orders: StatusOrders,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Default)]
pub struct ShellCustomization {
    #[serde(default)]
    pub menus: Vec<MenuCustomization>,
    #[serde(default)]
    pub home: HomeCustomization,
    #[serde(default)]
    pub navigation: NavigationCustomization,
    #[serde(default)]
    pub status: StatusCustomization,
}

impl Default for HomeCustomization {
    fn default() -> Self {
        Self {
            sections: ["quick_access", "recent", "favorites"]
                .iter()
                .map(|id| HomeSectionLayout {
                    id: id.to_string(),
                    visible: true,
                    collapsed: false,
                    size: HomeSectionSize::Medium,
                    limit: default_home_limit(),
                })
                .collect(),
        }
    }
}

fn builtin_item(section: &str) -> NavigationItem {
    NavigationItem {
        id: format!("builtin:{section}"),
        kind: NavigationItemKind::Builtin,
        target_id: section.to_string(),
        display_label: None,
        visible: true,
        section_id: section.to_string(),
    }
}

fn section_with(id: &str, items: Vec<NavigationItem>) -> NavigationSectionLayout {
    NavigationSectionLayout {
        id: id.to_string(),
        label: None,
        visible: true,
        items,
    }
}

impl Default for NavigationCustomization {
    fn default() -> Self {
        Self {
            sections: vec![
                section_with("home", vec![builtin_item("home")]),
                section_with("gallery", vec![builtin_item("gallery")]),
                section_with("pinned", Vec::new()),
                section_with("this_pc", vec![builtin_item("this_pc")]),
                section_with("network", vec![builtin_item("network")]),
                section_with("saved_groups", vec![builtin_item("saved_groups")]),
            ],
            row_height_px: default_row_height(),
            icon_size_px: default_icon_size(),
            width_px: default_width(),
            auto_collapse: false,
        }
    }
}

impl Default for StatusCustomization {
    fn default() -> Self {
        let explorer = ["item_count", "selection_count", "selection_size", "free_space", "view_buttons"]
            .iter()
            .map(|id| StatusFieldOrderEntry {
                id: id.to_string(),
                visible: true,
            })
            .collect();
        Self {
            visible: true,
            orders: StatusOrders {
                explorer,
                text: Vec::new(),
                pdf: Vec::new(),
                image: Vec::new(),
                media: Vec::new(),
                office: Vec::new(),
            },
        }
    }
}

