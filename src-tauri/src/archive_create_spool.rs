//! App-owned spool folders for archive creation (Step 06e D6, D7). Every
//! folder carries an ownership marker; a foreign entry is never removed and
//! an over-budget spool is refused before the helper writes anything.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The marker that proves the app created a spool folder.
pub const OWNER_MARKER: &str = "owner.json";
pub const OWNER_TEXT: &str = "{\"kind\":\"adperastra-archive-spool\",\"version\":1}";
/// The spool file name inside its request folder.
pub const SPOOL_NAME: &str = "archive.spool";
/// The lock file that serializes creation across processes.
pub const LOCK_NAME: &str = "create.lock";
/// The hard cap for all stored spool data.
pub const MAX_SPOOL_TOTAL: u64 = 8_589_934_592;
/// Free space kept unused under the data folder.
pub const SPOOL_MARGIN: u64 = 67_108_864;

/// The bounds one spool check obeys; tests inject small numbers.
#[derive(Debug, Clone, Copy)]
pub struct SpoolBudget {
    pub max_total: u64,
    pub margin: u64,
    pub max_output: u64,
}

impl Default for SpoolBudget {
    fn default() -> Self {
        Self {
            max_total: MAX_SPOOL_TOTAL,
            margin: SPOOL_MARGIN,
            max_output: MAX_SPOOL_TOTAL,
        }
    }
}

/// Take the per-data-folder creation lock. A second creation fails with
/// `archive.create_busy` instead of waiting.
pub fn take_creation_lock(base: &Path) -> Result<File, String> {
    std::fs::create_dir_all(base).map_err(|_| "archive.other".to_string())?;
    let path = base.join(LOCK_NAME);
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // No sharing at all: another app instance cannot open it.
        options.share_mode(0);
    }
    options
        .open(&path)
        .map_err(|error| match error.raw_os_error() {
            Some(32) | Some(33) => "archive.create_busy".to_string(),
            _ => "archive.other".to_string(),
        })
}

/// Check the stored spool total and the free space before one creation.
pub fn check_budget(base: &Path, needed: u64, budget: SpoolBudget) -> Result<(), String> {
    if needed > budget.max_output {
        return Err("archive.create_too_large".to_string());
    }
    let stored = stored_bytes(base);
    if stored.saturating_add(needed) > budget.max_total {
        return Err("archive.create_busy".to_string());
    }
    if let Some(free) = free_bytes(base) {
        if needed.saturating_add(budget.margin) > free {
            return Err("archive.no_space".to_string());
        }
    }
    Ok(())
}

/// The total bytes of spool files below `base`, never following links.
pub fn stored_bytes(base: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(base) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
            continue;
        }
        if metadata.is_dir() {
            total = total.saturating_add(stored_bytes(&entry.path()));
        }
    }
    total
}

/// Make the unique folder for one creation and its ownership marker.
pub fn prepare_spool_folder(base: &Path, request_id: &str) -> Result<PathBuf, String> {
    crate::valid_request_id(request_id)?;
    let folder = base.join(request_id);
    match std::fs::create_dir(&folder) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("archive.create_busy".to_string())
        }
        Err(_) => return Err("archive.other".to_string()),
    }
    let marker = folder.join(OWNER_MARKER);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
        .map_err(|_| "archive.other".to_string())?;
    file.write_all(OWNER_TEXT.as_bytes())
        .map_err(|_| "archive.other".to_string())?;
    Ok(folder.join(SPOOL_NAME))
}

/// Remove only a folder this app owns: its marker is exact and its name is a
/// valid request id. Anything else is retained.
pub fn release_spool_folder(spool: &Path) {
    let Some(folder) = spool.parent() else {
        return;
    };
    let Some(name) = folder.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    if crate::valid_request_id(name).is_err() {
        return;
    }
    let marker = folder.join(OWNER_MARKER);
    let owned = std::fs::read_to_string(&marker)
        .map(|text| text == OWNER_TEXT)
        .unwrap_or(false);
    if !owned {
        return;
    }
    let _ = std::fs::remove_file(folder.join(SPOOL_NAME));
    let _ = std::fs::remove_file(marker);
    let _ = std::fs::remove_dir(folder);
}

fn free_bytes(path: &Path) -> Option<u64> {
    archive::free_bytes(path)
}

#[cfg(test)]
mod tests {
    use super::{
        check_budget, prepare_spool_folder, release_spool_folder, stored_bytes, SpoolBudget,
    };

    #[test]
    fn spool_budget_is_shared_and_bounded() {
        let folder = tempfile::tempdir().unwrap();
        let base = folder.path().join("archive-create");
        std::fs::create_dir_all(&base).unwrap();
        let small = SpoolBudget {
            max_total: 10,
            margin: 0,
            max_output: 8,
        };
        assert_eq!(
            check_budget(&base, 9, small).unwrap_err(),
            "archive.create_too_large"
        );
        std::fs::write(base.join("old.spool"), [0u8; 6]).unwrap();
        assert_eq!(
            check_budget(&base, 6, small).unwrap_err(),
            "archive.create_busy"
        );
        assert_eq!(stored_bytes(&base), 6);
        assert!(check_budget(&base, 2, small).is_ok());
    }

    #[test]
    fn spool_folders_are_owned_and_released() {
        let folder = tempfile::tempdir().unwrap();
        let base = folder.path().join("archive-create");
        let spool = prepare_spool_folder(&base, "arccreate-1-1").unwrap();
        assert!(spool.ends_with("archive.spool"));
        assert!(spool.parent().unwrap().join("owner.json").exists());
        std::fs::write(&spool, b"data").unwrap();
        release_spool_folder(&spool);
        assert!(!spool.exists());
        assert!(!spool.parent().unwrap().exists());

        // A folder without the exact marker is never removed.
        let foreign = base.join("arccreate-2-2");
        std::fs::create_dir_all(&foreign).unwrap();
        std::fs::write(foreign.join("archive.spool"), b"foreign").unwrap();
        release_spool_folder(&foreign.join("archive.spool"));
        assert!(foreign.join("archive.spool").exists());
    }
}
