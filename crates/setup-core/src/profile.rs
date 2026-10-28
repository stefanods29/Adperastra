//! First-run profile (`profile.json`) and disk-space helper.

use crate::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub schema: u32,
    pub language: String,
    pub theme: String,
    pub packs_selected: Vec<String>,
    pub first_run_completed: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            schema: 1,
            language: "en".into(),
            theme: "system".into(),
            packs_selected: Vec::new(),
            first_run_completed: false,
        }
    }
}

pub fn profile_path(data_dir: &Path) -> PathBuf {
    data_dir.join("profile.json")
}

pub fn load_profile(data_dir: &Path) -> Option<Profile> {
    let text = std::fs::read_to_string(profile_path(data_dir)).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{FEFF}')).ok()
}

pub fn save_profile(data_dir: &Path, p: &Profile) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let text = serde_json::to_string_pretty(p)?;
    std::fs::write(profile_path(data_dir), text)?;
    Ok(())
}

/// True when there is no profile yet, or first run was not completed.
pub fn is_first_run(data_dir: &Path) -> bool {
    match load_profile(data_dir) {
        None => true,
        Some(p) => !p.first_run_completed,
    }
}

/// Free bytes on the volume containing `path`; 0 on error.
pub fn free_disk_space(path: &Path) -> u64 {
    fs2::free_space(path).unwrap_or(0)
}
