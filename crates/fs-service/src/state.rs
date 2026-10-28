use crate::{FsError, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const EXPLORER_STATE_SCHEMA: u32 = 1;
pub const MAX_PINNED: usize = 200;
pub const MAX_RECENT: usize = 20;
const MAX_PATH_LEN: usize = 32767;

fn default_schema() -> u32 {
    EXPLORER_STATE_SCHEMA
}

/// Explorer-owned state kept beside (not inside) settings.json by owner
/// decision in Step 02: pinned folders and our own recent-folder history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplorerState {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub pinned_folders: Vec<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

impl Default for ExplorerState {
    fn default() -> Self {
        Self {
            schema_version: EXPLORER_STATE_SCHEMA,
            pinned_folders: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}

fn same_path(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn clean(list: &[String], cap: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for entry in list {
        let entry = entry.trim();
        if entry.is_empty() || entry.chars().count() > MAX_PATH_LEN {
            continue;
        }
        if out.iter().any(|existing| same_path(existing, entry)) {
            continue;
        }
        out.push(entry.to_string());
        if out.len() >= cap {
            break;
        }
    }
    out
}

impl ExplorerState {
    pub fn normalized(mut self) -> Self {
        self.schema_version = EXPLORER_STATE_SCHEMA;
        self.pinned_folders = clean(&self.pinned_folders, MAX_PINNED);
        self.recent_folders = clean(&self.recent_folders, MAX_RECENT);
        self
    }

    pub fn pin(&mut self, path: String) {
        if path.trim().is_empty() {
            return;
        }
        if !self.pinned_folders.iter().any(|p| same_path(p, &path)) {
            self.pinned_folders.push(path);
            self.pinned_folders = clean(&self.pinned_folders, MAX_PINNED);
        }
    }

    pub fn unpin(&mut self, path: &str) {
        self.pinned_folders.retain(|p| !same_path(p, path));
    }

    /// Most-recent-first, de-duplicated, capped at MAX_RECENT.
    pub fn record_recent(&mut self, path: String) {
        if path.trim().is_empty() {
            return;
        }
        self.recent_folders.retain(|p| !same_path(p, &path));
        self.recent_folders.insert(0, path);
        self.recent_folders = clean(&self.recent_folders, MAX_RECENT);
    }

    /// A missing or corrupt state file loads as defaults: it can never
    /// stop the app from starting.
    pub fn load(path: &Path) -> Self {
        match fs::read_to_string(path) {
            Ok(content) => serde_json::from_str::<ExplorerState>(&content)
                .map(|s| s.normalized())
                .unwrap_or_default(),
            Err(_) => ExplorerState::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.clone().normalized())?;
        atomic_write(path, json.as_bytes())
    }
}

/// Same temp-file-then-rename pattern as the app settings writer.
pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp_path = path.with_file_name(format!(".{file_name}.tmp-{}", std::process::id()));
    fs::write(&tmp_path, contents)?;
    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            // Windows rename does not replace an existing destination.
            if path.exists() {
                let _ = fs::remove_file(path);
                fs::rename(&tmp_path, path).map_err(|_| {
                    let _ = fs::remove_file(&tmp_path);
                    FsError::Io(first_error)
                })
            } else {
                let _ = fs::remove_file(&tmp_path);
                Err(FsError::Io(first_error))
            }
        }
    }
}
