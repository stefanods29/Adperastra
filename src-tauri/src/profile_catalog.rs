//! The bounded profile catalog at `<base>/profiles.json` (Step 10c T4).
//!
//! Every change takes an exclusive OS lock on `<base>/profiles.lock`,
//! compares the caller's expected revision, writes through
//! `fs_service::atomic_write` and increments the revision once. A newer or
//! damaged catalog is never reset or overwritten.
#![allow(dead_code)]


use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::ensure_main;
use crate::profile_root::ProfileServiceState;
use crate::profile_types::{
    is_valid_profile_id, normalize_profile_name, now_unix, validate_catalog, ProfileCatalog,
    ProfileDescriptor, DEFAULT_PROFILE_ID, MAX_PROFILES,
};

pub const CATALOG_FILE: &str = "profiles.json";
pub const CATALOG_LOCK_FILE: &str = "profiles.lock";
pub const MAX_CATALOG_BYTES: u64 = 256 * 1024;

fn catalog_path(base: &Path) -> PathBuf {
    base.join(CATALOG_FILE)
}

fn lock_path(base: &Path) -> PathBuf {
    base.join(CATALOG_LOCK_FILE)
}

#[cfg(windows)]
fn open_exclusive(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(path)
}

#[cfg(not(windows))]
fn open_exclusive(path: &Path) -> std::io::Result<File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)
}

/// One cross-process app-state lock. The file stays on disk; the OS releases
/// the handle if the process exits, so a crash cannot leave a stale lock.
struct CatalogLock {
    _file: File,
}

impl CatalogLock {
    fn acquire(base: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(base).map_err(|_| "profiles.io".to_string())?;
        let path = lock_path(base);
        for _ in 0..50 {
            match open_exclusive(&path) {
                Ok(file) => return Ok(Self { _file: file }),
                // ERROR_SHARING_VIOLATION: the other app instance holds it.
                Err(error) if error.raw_os_error() == Some(32) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return Err("profiles.io".to_string()),
            }
        }
        Err("profiles.busy".to_string())
    }
}

/// Read and validate the catalog. A missing file is the fresh default; it is
/// not written until the first explicit change.
pub fn load_catalog(base: &Path) -> Result<ProfileCatalog, String> {
    let path = catalog_path(base);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProfileCatalog::new(now_unix()));
        }
        Err(_) => return Err("profiles.io".to_string()),
    };
    if bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err("profiles.invalid".to_string());
    }
    let catalog: ProfileCatalog =
        serde_json::from_slice(&bytes).map_err(|_| "profiles.invalid".to_string())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

pub fn write_catalog(base: &Path, catalog: &ProfileCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|_| "profiles.io".to_string())?;
    if bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err("profiles.invalid".to_string());
    }
    fs_service::atomic_write(&catalog_path(base), &bytes)
        .map_err(|_| "profiles.io".to_string())
}

fn next_profile(catalog: &ProfileCatalog, name: &str, now: u64) -> Result<(ProfileCatalog, String), String> {
    let name = normalize_profile_name(name).ok_or_else(|| "profiles.invalid".to_string())?;
    if catalog.profiles.len() >= MAX_PROFILES {
        return Err("profiles.limit".to_string());
    }
    let id = Uuid::new_v4().to_string();
    let mut next = catalog.clone();
    next.profiles.push(ProfileDescriptor {
        id: id.clone(),
        name,
        created_unix: now,
        modified_unix: now,
    });
    next.revision = catalog
        .revision
        .checked_add(1)
        .ok_or_else(|| "profiles.invalid".to_string())?;
    validate_catalog(&next)?;
    Ok((next, id))
}

fn renamed_profile(
    catalog: &ProfileCatalog,
    id: &str,
    name: &str,
    now: u64,
) -> Result<ProfileCatalog, String> {
    if !is_valid_profile_id(id) {
        return Err("profiles.invalid".to_string());
    }
    let name = normalize_profile_name(name).ok_or_else(|| "profiles.invalid".to_string())?;
    let mut next = catalog.clone();
    let profile = next
        .profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "profiles.invalid".to_string())?;
    profile.name = name;
    profile.modified_unix = now;
    next.revision = catalog
        .revision
        .checked_add(1)
        .ok_or_else(|| "profiles.invalid".to_string())?;
    validate_catalog(&next)?;
    Ok(next)
}

pub fn list_profiles(base: &Path) -> Result<ProfileCatalog, String> {
    let _lock = CatalogLock::acquire(base)?;
    load_catalog(base)
}

/// Run one catalog transaction under the exclusive lock. The closure
/// returns true when the catalog changed and must be written.
pub fn update_catalog<F>(base: &Path, update: F) -> Result<ProfileCatalog, String>
where
    F: FnOnce(&mut ProfileCatalog) -> Result<bool, String>,
{
    let _lock = CatalogLock::acquire(base)?;
    let mut catalog = load_catalog(base)?;
    if update(&mut catalog)? {
        write_catalog(base, &catalog)?;
    }
    Ok(catalog)
}

/// Create one profile under `<base>/profiles/<UUID>`.
pub fn create_profile(base: &Path, name: &str, expected_revision: u64) -> Result<ProfileCatalog, String> {
    let _lock = CatalogLock::acquire(base)?;
    let catalog = load_catalog(base)?;
    if catalog.revision != expected_revision {
        return Err("profiles.changed".to_string());
    }
    let (next, id) = next_profile(&catalog, name, now_unix())?;
    let profile_dir = base.join("profiles").join(&id);
    std::fs::create_dir_all(&profile_dir).map_err(|_| "profiles.io".to_string())?;
    write_catalog(base, &next)?;
    Ok(next)
}

pub fn rename_profile(
    base: &Path,
    id: &str,
    name: &str,
    expected_revision: u64,
) -> Result<ProfileCatalog, String> {
    let _lock = CatalogLock::acquire(base)?;
    let catalog = load_catalog(base)?;
    if catalog.revision != expected_revision {
        return Err("profiles.changed".to_string());
    }
    let next = renamed_profile(&catalog, id, name, now_unix())?;
    write_catalog(base, &next)?;
    Ok(next)
}

/// The default profile id is stable even when its display name changes.
pub fn default_profile(catalog: &ProfileCatalog) -> Option<&ProfileDescriptor> {
    catalog
        .profiles
        .iter()
        .find(|profile| profile.id == DEFAULT_PROFILE_ID)
}

#[tauri::command]
pub async fn profiles_list(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
) -> Result<ProfileCatalog, String> {
    ensure_main(window.label())?;
    let base = state.location.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || list_profiles(&base))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn profile_create(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
    name: String,
    expected_revision: u64,
) -> Result<ProfileCatalog, String> {
    ensure_main(window.label())?;
    if normalize_profile_name(&name).is_none() {
        return Err("profiles.invalid".to_string());
    }
    let base = state.location.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || create_profile(&base, &name, expected_revision))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn profile_rename(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
    id: String,
    name: String,
    expected_revision: u64,
) -> Result<ProfileCatalog, String> {
    ensure_main(window.label())?;
    if !is_valid_profile_id(&id) || normalize_profile_name(&name).is_none() {
        return Err("profiles.invalid".to_string());
    }
    let base = state.location.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || rename_profile(&base, &id, &name, expected_revision))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_catalog_is_the_default_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = load_catalog(dir.path()).unwrap();
        assert_eq!(catalog.profiles.len(), 1);
        assert_eq!(catalog.active_id, DEFAULT_PROFILE_ID);
        assert!(!catalog_path(dir.path()).exists());
    }

    #[test]
    fn the_twenty_first_profile_is_refused() {
        let mut catalog = ProfileCatalog::new(10);
        for index in 0..(MAX_PROFILES - 1) {
            let (next, _) = next_profile(&catalog, &format!("Profile {index}"), 10).unwrap();
            catalog = next;
        }
        assert_eq!(catalog.profiles.len(), MAX_PROFILES);
        assert_eq!(
            next_profile(&catalog, "One too many", 10),
            Err("profiles.limit".to_string())
        );
    }

    #[test]
    fn a_revision_conflict_preserves_the_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = ProfileCatalog::new(10);
        catalog.revision = 4;
        write_catalog(dir.path(), &catalog).unwrap();
        let before = std::fs::read(catalog_path(dir.path())).unwrap();
        assert_eq!(
            create_profile(dir.path(), "Work", 3),
            Err("profiles.changed".to_string())
        );
        assert_eq!(std::fs::read(catalog_path(dir.path())).unwrap(), before);
    }

    #[test]
    fn a_corrupt_catalog_is_refused_without_being_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(catalog_path(dir.path()), b"{not json").unwrap();
        let before = std::fs::read(catalog_path(dir.path())).unwrap();
        assert_eq!(load_catalog(dir.path()), Err("profiles.invalid".to_string()));
        assert_eq!(
            create_profile(dir.path(), "Work", 1),
            Err("profiles.invalid".to_string())
        );
        assert_eq!(std::fs::read(catalog_path(dir.path())).unwrap(), before);
    }

    #[test]
    fn creating_and_renaming_bump_the_revision_once() {
        let dir = tempfile::tempdir().unwrap();
        let created = create_profile(dir.path(), " Work ", 1).unwrap();
        assert_eq!(created.revision, 2);
        assert_eq!(created.profiles[1].name, "Work");
        assert!(dir.path().join("profiles").join(&created.profiles[1].id).is_dir());
        let renamed = rename_profile(dir.path(), &created.profiles[1].id, "Office", 2).unwrap();
        assert_eq!(renamed.revision, 3);
        assert_eq!(renamed.profiles[1].name, "Office");
        assert_eq!(renamed.profiles[1].id, created.profiles[1].id);
    }

    #[test]
    fn the_default_profile_can_be_renamed_but_keeps_its_id() {
        let dir = tempfile::tempdir().unwrap();
        let renamed = rename_profile(dir.path(), DEFAULT_PROFILE_ID, "Main", 1).unwrap();
        assert_eq!(renamed.active_id, DEFAULT_PROFILE_ID);
        assert_eq!(renamed.profiles[0].id, DEFAULT_PROFILE_ID);
        assert_eq!(renamed.profiles[0].name, "Main");
    }
}
