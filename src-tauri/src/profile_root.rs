//! Resolve the current profile root from the portable location (Step 10c
//! T4, profile-root-1).
//!
//! `location.data_dir` is always the base. The default profile keeps the
//! legacy base directory; every other profile lives under
//! `<base>/profiles/<UUID>`. Shared engine packs stay at `<base>/packs` and
//! no profile category may clear or replace them.
#![allow(dead_code)]


use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::ensure_main;
use crate::portable::PortableLocation;
use crate::profile_catalog::load_catalog;
use crate::profile_types::{validate_catalog, ProfileCatalog, DEFAULT_PROFILE_ID};
use crate::profile_switch::ProfileSwitchState;

/// The managed state every profile command receives.
pub struct ProfileServiceState {
    pub location: PortableLocation,
    pub switch: ProfileSwitchState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileRoot {
    pub base_dir: PathBuf,
    pub profile_dir: PathBuf,
    pub shared_packs_dir: PathBuf,
    pub profile_id: String,
    pub portable: bool,
}

/// Categories a profile may own. `packs` and `shared` are deliberately
/// absent: shared engine packs are not a profile category.
pub const PROFILE_CATEGORIES: &[&str] = &[
    "cache",
    "versions",
    "recovery",
    "index",
    "tags",
    "logs",
    "themes",
    "sessions",
    "locked-pending",
];

/// Only disposable caches may be cleared. Versions, recovery, themes,
/// sessions, tags and locked pending data are user data and are never
/// deleted by a profile maintenance action.
pub const CLEARABLE_PROFILE_CATEGORIES: &[&str] = &["cache", "index", "logs"];

fn safe_absolute(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

/// E5: resolve the active profile root; never let a catalog id traverse.
pub fn resolve_profile_root(
    location: &PortableLocation,
    catalog: &ProfileCatalog,
) -> Result<ProfileRoot, String> {
    resolve_profile_root_for(location, catalog, &catalog.active_id)
}

/// Resolve one validated profile id without changing the catalog.
pub fn resolve_profile_root_for(
    location: &PortableLocation,
    catalog: &ProfileCatalog,
    profile_id: &str,
) -> Result<ProfileRoot, String> {
    validate_catalog(catalog)?;
    if !safe_absolute(&location.data_dir) {
        return Err("profiles.invalid".to_string());
    }
    if !catalog.profiles.iter().any(|profile| profile.id == profile_id) {
        return Err("profiles.invalid".to_string());
    }
    let base_dir = location.data_dir.clone();
    let profile_id = profile_id.to_string();
    let profile_dir = if profile_id == DEFAULT_PROFILE_ID {
        base_dir.clone()
    } else {
        // `validate_catalog` guarantees a canonical UUID here, so this join
        // cannot contain a separator, a parent component or an ADS name.
        base_dir.join("profiles").join(&profile_id)
    };
    if !safe_absolute(&profile_dir) {
        return Err("profiles.invalid".to_string());
    }
    Ok(ProfileRoot {
        profile_dir,
        shared_packs_dir: base_dir.join("packs"),
        base_dir,
        profile_id,
        portable: location.portable,
    })
}

/// The startup/switch writable check. The probe is app-owned and removed
/// through its exact path; no other file is ever created or deleted.
pub fn ensure_profile_writable(
    location: &PortableLocation,
    root: &ProfileRoot,
) -> Result<(), String> {
    if !location.writable {
        return Err("profiles.not_writable".to_string());
    }
    std::fs::create_dir_all(&root.profile_dir)
        .map_err(|_| "profiles.not_writable".to_string())?;
    let probe = root
        .profile_dir
        .join(format!("~adp-write-probe-{}.tmp", uuid::Uuid::new_v4()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Ok(())
        }
        Err(_) => Err("profiles.not_writable".to_string()),
    }
}

impl ProfileRoot {
    /// An allowlisted category directory owned by this profile.
    pub fn category_dir(&self, category: &str) -> Result<PathBuf, String> {
        if !PROFILE_CATEGORIES.contains(&category) {
            return Err("profiles.invalid".to_string());
        }
        let path = self.profile_dir.join(category);
        if !safe_absolute(&path) || path == self.shared_packs_dir {
            return Err("profiles.invalid".to_string());
        }
        Ok(path)
    }
}

/// Delete one app-owned profile category. Shared packs are never touched.
pub fn clear_profile_category(root: &ProfileRoot, category: &str) -> Result<(), String> {
    if category == "packs"
        || category == "shared"
        || !CLEARABLE_PROFILE_CATEGORIES.contains(&category)
    {
        return Err("profiles.invalid".to_string());
    }
    let path = root.category_dir(category)?;
    if path == root.shared_packs_dir || path.starts_with(&root.shared_packs_dir) {
        return Err("profiles.invalid".to_string());
    }
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("profiles.invalid".to_string());
            }
            if metadata.is_dir() {
                std::fs::remove_dir_all(&path).map_err(|_| "profiles.io".to_string())
            } else {
                Err("profiles.invalid".to_string())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("profiles.io".to_string()),
    }
}

/// `profile_root` command: the same root for every category consumer.
#[tauri::command]
pub async fn profile_root(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
) -> Result<ProfileRoot, String> {
    ensure_main(window.label())?;
    let location = state.location.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = load_catalog(&location.data_dir)?;
        resolve_profile_root(&location, &catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile_types::ProfileDescriptor;

    fn location(base: &Path) -> PortableLocation {
        PortableLocation {
            app_dir: base.join("app"),
            data_dir: base.to_path_buf(),
            portable: false,
            writable: true,
        }
    }

    #[test]
    fn the_default_profile_keeps_the_legacy_base() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = ProfileCatalog::new(10);
        let root = resolve_profile_root(&location(dir.path()), &catalog).unwrap();
        assert_eq!(root.profile_id, "default");
        assert_eq!(root.base_dir, dir.path());
        assert_eq!(root.profile_dir, dir.path());
        assert_eq!(root.shared_packs_dir, dir.path().join("packs"));
        assert!(!root.portable);
    }

    #[test]
    fn another_profile_lives_under_profiles_uuid() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = ProfileCatalog::new(10);
        let id = uuid::Uuid::new_v4().to_string();
        catalog.profiles.push(ProfileDescriptor {
            id: id.clone(),
            name: "Work".to_string(),
            created_unix: 1,
            modified_unix: 1,
        });
        catalog.active_id = id.clone();
        let root = resolve_profile_root(&location(dir.path()), &catalog).unwrap();
        assert_eq!(root.profile_dir, dir.path().join("profiles").join(&id));
        assert_eq!(root.base_dir, dir.path());
    }

    #[test]
    fn a_traversing_id_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = ProfileCatalog::new(10);
        catalog.active_id = "../escape".to_string();
        assert_eq!(
            resolve_profile_root(&location(dir.path()), &catalog),
            Err("profiles.invalid".to_string())
        );
    }

    #[test]
    fn a_non_writable_location_is_refused_before_a_switch() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = ProfileCatalog::new(10);
        let mut place = location(dir.path());
        place.writable = false;
        let root = resolve_profile_root(&place, &catalog).unwrap();
        assert_eq!(
            ensure_profile_writable(&place, &root),
            Err("profiles.not_writable".to_string())
        );
        place.writable = true;
        assert!(ensure_profile_writable(&place, &root).is_ok());
    }

    #[test]
    fn clearing_a_category_cannot_touch_shared_packs() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = ProfileCatalog::new(10);
        let root = resolve_profile_root(&location(dir.path()), &catalog).unwrap();
        let packs = root.shared_packs_dir.clone();
        std::fs::create_dir_all(&packs).unwrap();
        std::fs::write(packs.join("engine.dll"), b"shared").unwrap();
        assert_eq!(
            clear_profile_category(&root, "packs"),
            Err("profiles.invalid".to_string())
        );
        assert!(packs.join("engine.dll").exists());
        let versions = root.category_dir("versions").unwrap();
        std::fs::create_dir_all(&versions).unwrap();
        std::fs::write(versions.join("keep.bin"), b"user version").unwrap();
        assert_eq!(
            clear_profile_category(&root, "versions"),
            Err("profiles.invalid".to_string())
        );
        assert!(versions.join("keep.bin").exists());
        std::fs::create_dir_all(root.category_dir("cache").unwrap()).unwrap();
        assert!(clear_profile_category(&root, "cache").is_ok());
        assert!(!root.category_dir("cache").unwrap().exists());
    }
}
