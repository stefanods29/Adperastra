//! Durable setup-apply journal (Step 10e T6, D9-D10).
//!
//! `prepared` means no part was written; `applying` means a prefix may have
//! been committed; `committed` means every part was written. A crash leaves
//! exactly one of these states, so recovery never guesses from file contents.
//! Only app-owned `<uuid>.json` files and `<uuid>/` backup dirs are touched.
#![allow(dead_code)]


use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::setup_types::{is_canonical_uuid, SetupPart};

pub const MAX_JOURNAL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalState {
    Prepared,
    Applying,
    Committed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JournalPart {
    pub part: SetupPart,
    pub old_sha256: Option<String>,
    pub new_sha256: String,
    pub backup_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupJournal {
    pub id: String,
    pub state: JournalState,
    /// How many parts are committed; the next part to apply is this index.
    pub next_index: usize,
    pub parts: Vec<JournalPart>,
    pub created_unix: u64,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryAction {
    /// No part was written: delete only the journal and its staging.
    DiscardStaged,
    /// Roll back the first `committed` parts in reverse order, checking each
    /// current hash first.
    RollbackFrom { committed: usize },
    /// Every part was written: keep the new configuration and clean up.
    Finalize,
    /// A rollback cannot prove it still owns the current bytes.
    RecoveryRequired,
}

impl SetupJournal {
    pub fn validate(&self) -> Result<(), String> {
        if !is_canonical_uuid(&self.id)
            || self.parts.len() > 8
            || self.next_index > self.parts.len()
            || !crate::setup_types::is_safe_u64(self.created_unix)
        {
            return Err("setup.invalid".to_string());
        }
        let mut seen = Vec::new();
        for part in &self.parts {
            if seen.contains(&part.part) || !is_sha256(&part.new_sha256) {
                return Err("setup.invalid".to_string());
            }
            if let Some(old) = &part.old_sha256 {
                if !is_sha256(old) {
                    return Err("setup.invalid".to_string());
                }
            }
            if part.backup_name.is_empty() || part.backup_name.contains("..") || part.backup_name.contains('\\') {
                return Err("setup.invalid".to_string());
            }
            seen.push(part.part);
        }
        Ok(())
    }

    pub fn recovery_action(&self) -> RecoveryAction {
        match self.state {
            JournalState::Prepared => RecoveryAction::DiscardStaged,
            JournalState::Applying => {
                if self.next_index == 0 {
                    RecoveryAction::DiscardStaged
                } else if self.next_index <= self.parts.len() {
                    RecoveryAction::RollbackFrom {
                        committed: self.next_index,
                    }
                } else {
                    RecoveryAction::RecoveryRequired
                }
            }
            JournalState::Committed => RecoveryAction::Finalize,
        }
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn journal_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_canonical_uuid(id) {
        return Err("setup.invalid".to_string());
    }
    Ok(directory.join(format!("{id}.json")))
}

fn ensure_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|_| "setup.io".to_string())
}

pub fn write(directory: &Path, journal: &SetupJournal) -> Result<(), String> {
    journal.validate()?;
    ensure_directory(directory)?;
    let bytes = serde_json::to_vec(journal).map_err(|_| "setup.invalid".to_string())?;
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err("setup.too_large".to_string());
    }
    fs_service::atomic_write(&journal_path(directory, &journal.id)?, &bytes).map_err(|_| "setup.io".to_string())
}

pub fn read(directory: &Path, id: &str) -> Result<SetupJournal, String> {
    let path = journal_path(directory, id)?;
    let metadata = fs::metadata(&path).map_err(|_| "setup.invalid".to_string())?;
    if metadata.len() > MAX_JOURNAL_BYTES {
        return Err("setup.too_large".to_string());
    }
    let bytes = fs::read(&path).map_err(|_| "setup.invalid".to_string())?;
    let journal: SetupJournal = serde_json::from_slice(&bytes).map_err(|_| "setup.invalid".to_string())?;
    journal.validate()?;
    Ok(journal)
}

/// Pending journals in one app-owned directory, oldest first.
pub fn list_pending(directory: &Path) -> Vec<SetupJournal> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut journals = Vec::new();
    for entry in entries.flatten().take(64) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if !is_canonical_uuid(id) {
            continue;
        }
        if let Ok(journal) = read(directory, id) {
            journals.push(journal);
        }
    }
    journals.sort_by_key(|journal| journal.created_unix);
    journals
}

/// Remove only the journal file and its UUID-named backup directory.
pub fn remove(directory: &Path, id: &str) -> Result<(), String> {
    let path = journal_path(directory, id)?;
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("setup.invalid".to_string());
    }
    let _ = fs::remove_file(path);
    let backups = directory.join(id);
    if fs::symlink_metadata(&backups).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("setup.invalid".to_string());
    }
    if backups.exists() {
        fs::remove_dir_all(backups).map_err(|_| "setup.io".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn journal(state: JournalState, next_index: usize) -> SetupJournal {
        SetupJournal {
            id: "00000000-0000-4000-a000-000000000001".to_string(),
            state,
            next_index,
            parts: vec![
                JournalPart {
                    part: SetupPart::Theme,
                    old_sha256: None,
                    new_sha256: "a".repeat(64),
                    backup_name: "theme.bak".to_string(),
                },
                JournalPart {
                    part: SetupPart::Layout,
                    old_sha256: Some("b".repeat(64)),
                    new_sha256: "c".repeat(64),
                    backup_name: "layout.bak".to_string(),
                },
                JournalPart {
                    part: SetupPart::Keyboard,
                    old_sha256: Some("d".repeat(64)),
                    new_sha256: "e".repeat(64),
                    backup_name: "keyboard.bak".to_string(),
                },
            ],
            created_unix: 1_800_000_000,
            restart_required: false,
        }
    }

    #[test]
    fn crash_prepared_discards_staged_files() {
        assert_eq!(journal(JournalState::Prepared, 0).recovery_action(), RecoveryAction::DiscardStaged);
    }

    #[test]
    fn crash_applying_rolls_back_the_committed_prefix() {
        assert_eq!(
            journal(JournalState::Applying, 2).recovery_action(),
            RecoveryAction::RollbackFrom { committed: 2 }
        );
    }

    #[test]
    fn crash_committed_finalizes() {
        assert_eq!(journal(JournalState::Committed, 3).recovery_action(), RecoveryAction::Finalize);
    }

    #[test]
    fn journal_roundtrip_and_pending_list() {
        let dir = tempdir().unwrap();
        let value = journal(JournalState::Applying, 1);
        write(dir.path(), &value).unwrap();
        assert_eq!(read(dir.path(), &value.id).unwrap(), value);
        assert_eq!(list_pending(dir.path()).len(), 1);
        remove(dir.path(), &value.id).unwrap();
        assert!(list_pending(dir.path()).is_empty());
    }

    #[test]
    fn non_uuid_id_refused() {
        let dir = tempdir().unwrap();
        let mut value = journal(JournalState::Prepared, 0);
        value.id = "../escape".to_string();
        assert_eq!(write(dir.path(), &value).unwrap_err(), "setup.invalid");
    }
}
