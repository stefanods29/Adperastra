//! Recovery copies of unsaved text (Step 06a): one JSON file per document
//! in `<data>/recovery`.

use std::path::Path;

use serde::{Deserialize, Serialize};

pub const DRAFTS_SCHEMA: u32 = 1;
pub const MAX_DRAFT_BYTES: u64 = 33_554_432;
pub const MAX_DRAFTS: usize = 50;

fn default_schema() -> u32 {
    DRAFTS_SCHEMA
}

/// One document's unsaved text, kept off the user's file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    /// The file's display path.
    pub path: String,
    /// The editor's text, with `\n` line breaks.
    pub text: String,
    /// When the copy was written.
    pub saved_unix: u64,
    /// The file's modified time when the tab last read or saved it.
    pub file_modified_unix: u64,
}

/// 16 lower-case hex digits of the 64-bit FNV-1a hash of the lower-case
/// display path.
pub fn draft_key(path: &str) -> String {
    let normalized = crate::state::normalize_for_compare(path);
    let mut hash: u64 = 14_695_981_039_346_656_037;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    format!("{hash:016x}")
}

fn draft_file(dir: &Path, path: &str) -> std::path::PathBuf {
    dir.join(format!("{}.json", draft_key(path)))
}

/// Write a document's copy and keep at most `MAX_DRAFTS` of them.
pub fn write_draft(dir: &Path, draft: &Draft) -> Result<(), String> {
    if draft.text.len() as u64 > MAX_DRAFT_BYTES {
        return Err("recovery.too_large".to_string());
    }
    std::fs::create_dir_all(dir).map_err(|_| "recovery.other".to_string())?;
    let json = serde_json::to_vec_pretty(draft).map_err(|_| "recovery.other".to_string())?;
    crate::state::atomic_write(&draft_file(dir, &draft.path), &json)
        .map_err(|_| "recovery.other".to_string())?;
    trim_drafts(dir);
    Ok(())
}

/// The copy kept for a path, when there is one.
pub fn read_draft(dir: &Path, path: &str) -> Option<Draft> {
    let content = std::fs::read_to_string(draft_file(dir, path)).ok()?;
    let draft: Draft = serde_json::from_str(&content).ok()?;
    if crate::state::normalize_for_compare(&draft.path) == crate::state::normalize_for_compare(path)
    {
        Some(draft)
    } else {
        None
    }
}

/// Remove a document's copy. This is our own file in the data folder.
pub fn delete_draft(dir: &Path, path: &str) -> Result<(), String> {
    let file = draft_file(dir, path);
    match file.try_exists() {
        Ok(true) => std::fs::remove_file(&file).map_err(|_| "recovery.other".to_string()),
        Ok(false) => Ok(()),
        Err(_) => Err("recovery.other".to_string()),
    }
}

/// Keep the newest `MAX_DRAFTS` copies; the oldest are removed.
pub fn trim_drafts(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();
    if files.len() <= MAX_DRAFTS {
        return;
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let remove = files.len() - MAX_DRAFTS;
    for (_, file) in files.into_iter().take(remove) {
        let _ = std::fs::remove_file(file);
    }
}
