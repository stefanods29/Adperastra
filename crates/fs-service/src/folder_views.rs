//! Remembered view per folder (Step 05a): `folder-views.json` in the data
//! folder. Newest first and capped; paths compare like pinned folders.

use crate::state::{atomic_write, normalize_for_compare, without_verbatim_prefix};
use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub const FOLDER_VIEWS_SCHEMA: u32 = 1;
pub const MAX_FOLDER_VIEWS: usize = 1000;
/// Characters, counted with `chars().count()`.
pub const MAX_FOLDER_VIEW_PATH: usize = 1024;

/// The nine view modes, in Windows' View-menu order (Step 05a D1,
/// Step 05b D1 adds `columns` last).
pub const VIEW_MODES: [&str; 9] = [
    "extraLargeIcons",
    "largeIcons",
    "mediumIcons",
    "smallIcons",
    "list",
    "details",
    "tiles",
    "content",
    "columns",
];

fn default_schema() -> u32 {
    FOLDER_VIEWS_SCHEMA
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderView {
    /// Display form (no `\\?\` prefix), in the user's case.
    pub path: String,
    /// A view id from [`VIEW_MODES`].
    pub mode: String,
    /// Seconds since 1970 when the view was chosen; 0 when missing.
    #[serde(default)]
    pub used_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderViews {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub folders: Vec<FolderView>,
}

impl Default for FolderViews {
    fn default() -> Self {
        Self {
            schema_version: FOLDER_VIEWS_SCHEMA,
            folders: Vec::new(),
        }
    }
}

/// True when `mode` is one of the nine view ids, case-sensitively.
pub fn is_view_mode(mode: &str) -> bool {
    VIEW_MODES.contains(&mode)
}

fn valid_path(path: &str) -> bool {
    let trimmed = path.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= MAX_FOLDER_VIEW_PATH
}

impl FolderViews {
    /// Keep valid entries only, newest first, one per folder, capped.
    pub fn normalized(mut self) -> Self {
        self.folders
            .retain(|entry| valid_path(&entry.path) && is_view_mode(&entry.mode));
        self.folders
            .sort_by_key(|entry| std::cmp::Reverse(entry.used_unix));
        let mut seen: HashSet<String> = HashSet::new();
        self.folders
            .retain(|entry| seen.insert(normalize_for_compare(&entry.path)));
        self.folders.truncate(MAX_FOLDER_VIEWS);
        self.schema_version = FOLDER_VIEWS_SCHEMA;
        self
    }

    /// The mode remembered for `path`, if any.
    pub fn get(&self, path: &str) -> Option<&str> {
        let key = normalize_for_compare(path);
        self.folders
            .iter()
            .find(|entry| normalize_for_compare(&entry.path) == key)
            .map(|entry| entry.mode.as_str())
    }

    /// Remember `mode` for `path`; false when either is invalid.
    pub fn set(&mut self, path: &str, mode: &str, now_unix: u64) -> bool {
        if !valid_path(path) || !is_view_mode(mode) {
            return false;
        }
        let key = normalize_for_compare(path);
        self.folders
            .retain(|entry| normalize_for_compare(&entry.path) != key);
        self.folders.insert(
            0,
            FolderView {
                path: without_verbatim_prefix(path),
                mode: mode.to_string(),
                used_unix: now_unix,
            },
        );
        self.folders.truncate(MAX_FOLDER_VIEWS);
        true
    }

    /// Forget every remembered view.
    pub fn clear(&mut self) {
        self.folders.clear();
    }

    /// A missing or corrupt file loads as the default value.
    pub fn load(path: &Path) -> Self {
        match fs::read_to_string(path) {
            Ok(content) => serde_json::from_str::<FolderViews>(&content)
                .map(|views| views.normalized())
                .unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.clone().normalized())?;
        Ok(atomic_write(path, json.as_bytes())?)
    }
}
