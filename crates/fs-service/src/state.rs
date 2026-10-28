use crate::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

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

/// Compare two Windows paths the way a user means them: the app's pin
/// command stores `fs::canonicalize` output (`\\?\C:\...` or
/// `\\?\UNC\server\...`), while the UI sends the display form. Both must
/// match, case-insensitively.
fn normalize_for_compare(path: &str) -> String {
    let trimmed = path.trim();
    let stripped = if let Some(unc) = trimmed.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(rest) = trimmed.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        trimmed.to_string()
    };
    stripped.trim_end_matches('\\').to_lowercase()
}

fn same_path(a: &str, b: &str) -> bool {
    normalize_for_compare(a) == normalize_for_compare(b)
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

    pub fn is_pinned(&self, path: &str) -> bool {
        self.pinned_folders.iter().any(|p| same_path(p, path))
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
        Ok(atomic_write(path, json.as_bytes())?)
    }
}

const RENAME_ATTEMPTS: u32 = 5;
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Crash-safe file replace, shared by the Explorer state and the app
/// settings/session writers: write a temp file, flush it to disk, then
/// rename it over the target. `fs::rename` replaces an existing file in
/// one step on Windows (MOVEFILE_REPLACE_EXISTING / POSIX rename), so a
/// crash or a concurrent reader sees either the old or the new file, never
/// a missing one. The target is never deleted first: when another process
/// (antivirus, indexer) briefly holds it open, the rename is retried.
pub fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp_path = path.with_file_name(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(contents)?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }
    let mut attempt = 1;
    loop {
        match fs::rename(&tmp_path, path) {
            Ok(()) => return Ok(()),
            Err(error) if attempt >= RENAME_ATTEMPTS => {
                let _ = fs::remove_file(&tmp_path);
                return Err(error);
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(20 * u64::from(attempt)));
                attempt += 1;
            }
        }
    }
}
