//! Saved tab group data shapes (Step 09b, revision saved-groups-1).
//!
//! These DTOs mirror `src/services/savedGroups.ts` field for field
//! (snake_case on both sides). A saved descriptor is a session position
//! only: it has no runtime tab/document ID, no grant or token, and no
//! unsaved content. Unknown fields are refused, never persisted.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

use crate::split_types::SplitState;

pub const SAVED_GROUPS_SCHEMA: u32 = 1;
pub const MAX_SAVED_GROUPS: usize = 100;
pub const MAX_SAVED_TABS: usize = 200;
pub const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_GROUP_NAME_CHARS: usize = 60;
pub const MAX_VIEW_BYTES: usize = 64 * 1024;
/// The largest integer the UI can read back exactly.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupColor {
    Purple,
    Blue,
    Green,
    Teal,
    Orange,
    Red,
}

/// One saved tab position: the session tab without `id`, `group_id` or
/// the runtime `document_id`. `source`, `folder` and `view` keep only
/// the fields their registered codecs produce; validation bounds them
/// and refuses secret-shaped keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedTabDescriptor {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_version: Option<u32>,
    /// Split descriptors (Step 09i D7): `kind: "split"` carries both sides
    /// here and no outer title, source, folder or view. Plain positions
    /// never carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<SplitState>,
    /// A promoted survivor's stable leaf view id (file/folder only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_view_id: Option<String>,
    /// Always false: pinning a tab removes its group membership (D1).
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedTabGroup {
    pub id: String,
    pub name: String,
    pub color: GroupColor,
    pub tabs: Vec<SavedTabDescriptor>,
    pub active_index: usize,
    pub created_unix: u64,
    pub modified_unix: u64,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedGroupCatalog {
    pub schema_version: u32,
    #[serde(default)]
    pub groups: Vec<SavedTabGroup>,
    pub revision: u64,
}

impl Default for SavedGroupCatalog {
    fn default() -> Self {
        Self {
            schema_version: SAVED_GROUPS_SCHEMA,
            groups: Vec::new(),
            revision: 1,
        }
    }
}

/// One revision-checked catalog write (E4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedGroupWrite {
    pub expected_revision: u64,
    pub group: SavedTabGroup,
}

/// What reopening a saved group produced (E6): new IDs only, no file
/// bytes or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupRestoreReport {
    pub group_id: String,
    pub tab_ids: Vec<String>,
    pub missing_count: u32,
    pub unsupported_count: u32,
}

/// The live group shape the session stores (schema 2, additive).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveTabGroup {
    pub id: String,
    pub name: String,
    pub color: GroupColor,
    #[serde(default)]
    pub collapsed: bool,
    pub tab_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedGroupExportResult {
    pub path: String,
    pub bytes: u64,
}
