//! Tested reference for the installer's upgrade rollback (Step 08d T2).
//!
//! The NSIS hook keeps the installed `Adperastra.exe` as
//! `Adperastra.exe.previous` before writing the new binary. If the new binary
//! is missing, empty or has the wrong version, the hook restores the previous
//! file and leaves the data folder completely untouched. This module models
//! those steps over a real temporary file system so the rules are tested
//! without running NSIS. It is compiled for tests only.
#![allow(dead_code)]


use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const APP_BINARY: &str = "Adperastra.exe";
pub const PREVIOUS_BINARY: &str = "Adperastra.exe.previous";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeStage {
    pub app_dir: PathBuf,
    pub target: PathBuf,
    pub previous: PathBuf,
    pub had_previous: bool,
}

pub fn begin_upgrade(app_dir: &Path) -> Result<UpgradeStage, String> {
    let target = app_dir.join(APP_BINARY);
    let previous = app_dir.join(PREVIOUS_BINARY);
    let had_previous = target.is_file();
    if had_previous {
        remove_if_exists(&previous)?;
        fs::copy(&target, &previous).map_err(|_| "upgrade.backup_failed".to_string())?;
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&previous)
            .map_err(|_| "upgrade.backup_failed".to_string())?;
        file.sync_all()
            .map_err(|_| "upgrade.backup_failed".to_string())?;
    }
    Ok(UpgradeStage {
        app_dir: app_dir.to_path_buf(),
        target,
        previous,
        had_previous,
    })
}

pub fn verify_new_binary(stage: &UpgradeStage, minimum_bytes: u64) -> Result<(), String> {
    let metadata =
        fs::metadata(&stage.target).map_err(|_| "upgrade.binary_missing".to_string())?;
    if !metadata.is_file() || metadata.len() < minimum_bytes || metadata.len() == 0 {
        return Err("upgrade.binary_invalid".to_string());
    }
    Ok(())
}

pub fn commit_upgrade(stage: &UpgradeStage) -> Result<(), String> {
    verify_new_binary(stage, 1)?;
    if stage.previous.exists() {
        fs::remove_file(&stage.previous).map_err(|_| "upgrade.commit_failed".to_string())?;
    }
    Ok(())
}

pub fn rollback_upgrade(stage: &UpgradeStage) -> Result<(), String> {
    if stage.had_previous {
        if !stage.previous.is_file() {
            return Err("upgrade.backup_missing".to_string());
        }
        remove_if_exists(&stage.target)?;
        fs::rename(&stage.previous, &stage.target)
            .map_err(|_| "upgrade.rollback_failed".to_string())?;
        return Ok(());
    }
    // A failed first install has no previous binary; remove only the partial
    // app binary, never the data folder beside it.
    remove_if_exists(&stage.target)
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err("upgrade.remove_failed".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_with_binary(temp: &tempfile::TempDir, bytes: &[u8]) -> std::path::PathBuf {
        let app = temp.path().join("Programs").join("Adperastra");
        fs::create_dir_all(&app).unwrap();
        fs::write(app.join(APP_BINARY), bytes).unwrap();
        app
    }

    fn data_with_settings(temp: &tempfile::TempDir) -> std::path::PathBuf {
        let data = temp.path().join("AdperastraData");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("settings.json"), b"settings stay").unwrap();
        data
    }

    #[test]
    fn failed_upgrade_restores_previous_binary_and_keeps_data() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_binary(&temp, b"old binary");
        let data = data_with_settings(&temp);
        let stage = begin_upgrade(&app).unwrap();
        assert_eq!(stage.app_dir, app);
        fs::write(&stage.target, b"partial new binary").unwrap();

        rollback_upgrade(&stage).unwrap();

        assert_eq!(fs::read(app.join(APP_BINARY)).unwrap(), b"old binary");
        assert!(!app.join(PREVIOUS_BINARY).exists());
        assert_eq!(
            fs::read(data.join("settings.json")).unwrap(),
            b"settings stay"
        );
    }

    #[test]
    fn successful_upgrade_removes_the_backup_only_after_verification() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_binary(&temp, b"old binary");
        let stage = begin_upgrade(&app).unwrap();
        fs::write(&stage.target, b"new binary").unwrap();
        assert!(verify_new_binary(&stage, 1).is_ok());
        commit_upgrade(&stage).unwrap();
        assert_eq!(fs::read(app.join(APP_BINARY)).unwrap(), b"new binary");
        assert!(!app.join(PREVIOUS_BINARY).exists());
    }

    #[test]
    fn clean_install_failure_removes_only_the_partial_binary() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path().join("Programs").join("Adperastra");
        fs::create_dir_all(&app).unwrap();
        let data = data_with_settings(&temp);
        let stage = begin_upgrade(&app).unwrap();
        fs::write(&stage.target, b"partial").unwrap();

        rollback_upgrade(&stage).unwrap();

        assert!(!stage.target.exists());
        assert_eq!(
            fs::read(data.join("settings.json")).unwrap(),
            b"settings stay"
        );
    }

    #[test]
    fn invalid_new_binary_is_refused_before_commit() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_binary(&temp, b"old binary");
        let stage = begin_upgrade(&app).unwrap();
        fs::write(&stage.target, b"").unwrap();
        assert_eq!(
            verify_new_binary(&stage, 1),
            Err("upgrade.binary_invalid".to_string())
        );
        rollback_upgrade(&stage).unwrap();
        assert_eq!(fs::read(app.join(APP_BINARY)).unwrap(), b"old binary");
    }
}
