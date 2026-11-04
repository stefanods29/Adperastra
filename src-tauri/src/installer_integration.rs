//! Installer policy for clean upgrade, uninstall and offline packs
//! (Step 16, T5; guide D4/D5).
//!
//! The NSIS uninstaller and the portable/offline catalogs are executed by
//! coordinator-owned package scripts. This module holds the decisions those
//! scripts must use: verify every offline artifact against its catalog hash
//! before offering it, never force-terminate a running app, keep data on
//! uninstall by default, and never remove a root the app does not own.
#![allow(dead_code)]


use std::path::{Component, Path, PathBuf};

/// Largest offline pack artifact the catalog accepts.
pub const MAX_OFFLINE_ARTIFACT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// Most optional packs one offline catalog may list.
pub const MAX_OFFLINE_PACKS: usize = 64;
/// The offline catalog format.
pub const OFFLINE_CATALOG_SCHEMA: u32 = 1;

fn bad_request() -> String {
    "installer.invalid".to_string()
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 255
        && !name
            .chars()
            .any(|character| matches!(character, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        && name != "."
        && name != ".."
}

/// One optional signed pack shipped inside the offline installer.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OfflinePackEntry {
    pub id: String,
    pub version: String,
    pub file_name: String,
    pub sha256: String,
    pub byte_len: u64,
    pub signed: bool,
}

impl OfflinePackEntry {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.chars().count() > 128
            || !crate::windows_integration_types::is_semver(&self.version)
            || self.version.chars().count() > 64
            || !is_safe_file_name(&self.file_name)
            || !is_sha256(&self.sha256)
            || self.byte_len == 0
            || self.byte_len > MAX_OFFLINE_ARTIFACT_BYTES
        {
            return Err(bad_request());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OfflineCatalog {
    pub schema_version: u32,
    pub packs: Vec<OfflinePackEntry>,
}

impl OfflineCatalog {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != OFFLINE_CATALOG_SCHEMA
            || self.packs.len() > MAX_OFFLINE_PACKS
        {
            return Err(bad_request());
        }
        let mut seen = std::collections::BTreeSet::new();
        for pack in &self.packs {
            pack.validate()?;
            if !seen.insert(pack.id.clone()) {
                return Err(bad_request());
            }
        }
        Ok(())
    }
}

/// What the installer measured from a file it actually has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableArtifact {
    pub file_name: String,
    pub sha256: String,
    pub byte_len: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfflineArtifactState {
    Verified,
    Missing,
    HashMismatch,
    Unsigned,
}

/// One choice the offline installer may show. A missing or changed artifact
/// disables that choice; there is no unsigned download fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfflinePackChoice {
    pub id: String,
    pub enabled: bool,
    pub state: OfflineArtifactState,
    pub error_code: Option<String>,
}

/// Verify every catalog entry against the files present on the installation
/// media. The caller supplies hashes it computed from the real bytes.
pub fn verify_offline_catalog(
    catalog: &OfflineCatalog,
    available: &[AvailableArtifact],
) -> Result<Vec<OfflinePackChoice>, String> {
    catalog.validate()?;
    let mut choices = Vec::with_capacity(catalog.packs.len());
    for pack in &catalog.packs {
        let artifact = available
            .iter()
            .find(|artifact| artifact.file_name == pack.file_name);
        let (enabled, state, error_code) = match artifact {
            None => (
                false,
                OfflineArtifactState::Missing,
                Some("installer.offline_missing".to_string()),
            ),
            Some(artifact) if artifact.byte_len != pack.byte_len => (
                false,
                OfflineArtifactState::HashMismatch,
                Some("installer.offline_hash_mismatch".to_string()),
            ),
            Some(artifact) if artifact.sha256 != pack.sha256 => (
                false,
                OfflineArtifactState::HashMismatch,
                Some("installer.offline_hash_mismatch".to_string()),
            ),
            Some(_) if !pack.signed => (
                false,
                OfflineArtifactState::Unsigned,
                Some("installer.offline_unsigned".to_string()),
            ),
            Some(_) => (true, OfflineArtifactState::Verified, None),
        };
        choices.push(OfflinePackChoice {
            id: pack.id.clone(),
            enabled,
            state,
            error_code,
        });
    }
    Ok(choices)
}

/// The app's answer when the installer asks a running instance to exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitAnswer {
    /// The app settled its dirty documents and is ready to close.
    ExitNow,
    /// The user kept the app open (dirty decision cancelled).
    KeepOpen,
    /// The user cancelled the installation.
    CancelInstall,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradePlan {
    pub proceed: bool,
    pub request_graceful_exit: bool,
    pub wait_for_exit: bool,
    /// Always false: unsaved work is never killed.
    pub force_terminate: bool,
    pub error_code: Option<String>,
}

/// Decide what an upgrade does. A running app is asked to exit; a dirty app
/// that answers KeepOpen or Cancel stops the upgrade without killing it.
pub fn plan_upgrade(running: bool, dirty: bool, answer: Option<ExitAnswer>) -> UpgradePlan {
    if !running {
        return UpgradePlan {
            proceed: true,
            request_graceful_exit: false,
            wait_for_exit: false,
            force_terminate: false,
            error_code: None,
        };
    }
    match answer {
        None => UpgradePlan {
            proceed: false,
            request_graceful_exit: true,
            wait_for_exit: true,
            force_terminate: false,
            error_code: None,
        },
        Some(ExitAnswer::ExitNow) => UpgradePlan {
            proceed: true,
            request_graceful_exit: true,
            wait_for_exit: true,
            force_terminate: false,
            error_code: None,
        },
        Some(ExitAnswer::KeepOpen) => UpgradePlan {
            proceed: false,
            request_graceful_exit: true,
            wait_for_exit: false,
            force_terminate: false,
            error_code: if dirty {
                Some("installer.dirty_still_open".to_string())
            } else {
                Some("installer.still_open".to_string())
            },
        },
        Some(ExitAnswer::CancelInstall) => UpgradePlan {
            proceed: false,
            request_graceful_exit: false,
            wait_for_exit: false,
            force_terminate: false,
            error_code: Some("installer.cancelled".to_string()),
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UninstallChoice {
    /// The default: keep settings, versions, caches and packs.
    KeepData,
    /// The explicit second choice, after the loss warning.
    RemoveData,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UninstallPlan {
    /// Registry values go through `integration_commands::restore_for_uninstall`;
    /// only values still matching the installed value are restored.
    pub restore_owned_registry: bool,
    pub remove_data: bool,
    /// Removing data uses the Recycle Bin, never a permanent delete.
    pub recycle_data: bool,
    pub data_root: Option<PathBuf>,
    pub error_code: Option<String>,
}

fn normalize_root(path: &Path) -> Option<String> {
    if !path.is_absolute() {
        return None;
    }
    // Never own a removal root on a UNC share or a verbatim path; the app
    // data root is local.
    if path.to_string_lossy().starts_with("\\\\") {
        return None;
    }
    let mut text = String::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => text.push_str(&prefix.as_os_str().to_string_lossy()),
            Component::RootDir => text.push('\\'),
            Component::CurDir => {}
            Component::ParentDir => return None,
            Component::Normal(part) => {
                if !text.ends_with('\\') {
                    text.push('\\');
                }
                text.push_str(&part.to_string_lossy());
            }
        }
    }
    Some(text.to_ascii_lowercase())
}

/// A drive root, the Windows folder or Program Files are never removed.
pub fn is_protected_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }
    let text = path.to_string_lossy().to_ascii_lowercase();
    let text = text.trim_end_matches('\\');
    text.ends_with(":\\windows")
        || text.contains(":\\windows\\")
        || text.ends_with(":\\program files")
        || text.contains(":\\program files\\")
        || text.ends_with(":\\program files (x86)")
        || text.contains(":\\program files (x86)\\")
}

/// Decide the uninstall plan. The recorded root is the exact directory the
/// installer created; anything else (a junction, another drive, a moved
/// folder) is refused even when the user chose Remove.
pub fn plan_uninstall(
    choice: UninstallChoice,
    recorded_root: &Path,
    actual_root: &Path,
    is_reparse_point: bool,
) -> UninstallPlan {
    let base = UninstallPlan {
        restore_owned_registry: true,
        remove_data: false,
        recycle_data: false,
        data_root: None,
        error_code: None,
    };
    if choice == UninstallChoice::KeepData {
        return base;
    }
    if is_reparse_point || is_protected_root(actual_root) {
        return UninstallPlan {
            error_code: Some("installer.unsafe_root".to_string()),
            ..base
        };
    }
    match (normalize_root(recorded_root), normalize_root(actual_root)) {
        (Some(recorded), Some(actual)) if recorded == actual => UninstallPlan {
            remove_data: true,
            recycle_data: true,
            data_root: Some(actual_root.to_path_buf()),
            ..base
        },
        _ => UninstallPlan {
            error_code: Some("installer.foreign_root".to_string()),
            ..base
        },
    }
}

#[cfg(test)]
#[path = "installer_step16_tests.rs"]
mod step16_tests;
