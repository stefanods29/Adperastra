//! Rename preset catalog (Step 09e E3): pure validation/CAS plus the atomic
//! native store. `<data>/rename-presets.json` is schema 1, revision-checked,
//! bounded to 100 presets and 1 MiB; it never contains source paths.
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use bulk_rename::{
    operations::validate_preset,
    types::{RenamePreset, RenamePresetCatalog},
};
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

use crate::ensure_main;

pub const PRESETS_FILE: &str = "rename-presets.json";
const PRESETS_LOCK: &str = "rename-presets.lock";
pub const MAX_CATALOG_BYTES: usize = 1024 * 1024;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub fn validate_catalog(catalog: &RenamePresetCatalog) -> Result<(), String> {
    if catalog.schema_version != 1 || catalog.revision > MAX_SAFE_INTEGER || catalog.presets.len() > 100 { return Err("rename.bad_request".into()); }
    let mut ids = std::collections::HashSet::new();
    for preset in &catalog.presets {
        validate_preset(preset)?;
        if !ids.insert(preset.id) { return Err("rename.bad_request".into()); }
    }
    if serde_json::to_vec(catalog).map_err(|_| "rename.failed")?.len() > MAX_CATALOG_BYTES { return Err("rename.too_large".into()); }
    Ok(())
}

/// Returns the next catalog without modifying the old one. `save_preset`
/// locks, rereads, calls this and atomically persists within one transaction.
pub fn write(catalog: &RenamePresetCatalog, preset: RenamePreset, expected_revision: u64) -> Result<RenamePresetCatalog, String> {
    validate_catalog(catalog)?;
    if catalog.revision != expected_revision { return Err("rename.changed".into()); }
    validate_preset(&preset)?;
    let mut next = catalog.clone();
    if let Some(existing) = next.presets.iter_mut().find(|p| p.id == preset.id) { *existing = preset; }
    else { next.presets.push(preset); }
    next.revision = next.revision.checked_add(1).ok_or("rename.too_large")?;
    validate_catalog(&next)?;
    Ok(next)
}
pub fn remove(catalog: &RenamePresetCatalog, id: Uuid, expected_revision: u64) -> Result<RenamePresetCatalog, String> {
    validate_catalog(catalog)?;
    if catalog.revision != expected_revision { return Err("rename.changed".into()); }
    let mut next = catalog.clone();
    if !next.presets.iter().any(|p| p.id == id) { return Err("rename.bad_request".into()); }
    next.presets.retain(|p| p.id != id);
    next.revision = next.revision.checked_add(1).ok_or("rename.too_large")?;
    validate_catalog(&next)?;
    Ok(next)
}

pub fn catalog_file(data_dir: &Path) -> PathBuf {
    data_dir.join(PRESETS_FILE)
}

fn lock_file(data_dir: &Path) -> PathBuf {
    data_dir.join(PRESETS_LOCK)
}

/// The exclusive catalog lock. The lock file is never removed: unlinking it
/// would let two processes hold different locks.
pub struct CatalogLock {
    _file: File,
}

impl CatalogLock {
    pub fn acquire(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|_| "rename.failed".to_string())?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_file(data_dir))
            .map_err(|_| "rename.failed".to_string())?;
        file.lock().map_err(|_| "rename.failed".to_string())?;
        Ok(Self { _file: file })
    }
}

/// Read and validate the catalog. A missing file is the empty catalog at
/// revision 0; an oversize or malformed file is refused and left untouched.
pub fn read_catalog(path: &Path) -> Result<RenamePresetCatalog, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RenamePresetCatalog {
                schema_version: 1,
                revision: 0,
                presets: Vec::new(),
            });
        }
        Err(_) => return Err("rename.failed".to_string()),
    };
    let mut bytes = Vec::new();
    file.by_ref()
        .take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "rename.failed".to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err("rename.too_large".to_string());
    }
    let catalog: RenamePresetCatalog =
        serde_json::from_slice(&bytes).map_err(|_| "rename.failed".to_string())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

/// Validate, then publish the whole catalog atomically: a crash or a failed
/// write always leaves the previous catalog in place.
pub fn write_catalog(path: &Path, catalog: &RenamePresetCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    let bytes = serde_json::to_vec(catalog).map_err(|_| "rename.failed".to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err("rename.too_large".to_string());
    }
    fs_service::atomic_write(path, &bytes).map_err(|_| "rename.failed".to_string())
}

pub fn list_presets(data_dir: &Path) -> Result<RenamePresetCatalog, String> {
    let _lock = CatalogLock::acquire(data_dir)?;
    read_catalog(&catalog_file(data_dir))
}

/// Write one preset under the caller's revision. The catalog read, CAS and
/// atomic publication all happen while holding the cross-process lock.
pub fn save_preset(
    data_dir: &Path,
    preset: RenamePreset,
    expected_revision: u64,
) -> Result<RenamePresetCatalog, String> {
    if expected_revision > MAX_SAFE_INTEGER {
        return Err("rename.bad_request".to_string());
    }
    validate_preset(&preset)?;
    let _lock = CatalogLock::acquire(data_dir)?;
    let path = catalog_file(data_dir);
    let current = read_catalog(&path)?;
    let next = write(&current, preset, expected_revision)?;
    write_catalog(&path, &next)?;
    Ok(next)
}

pub fn remove_preset(
    data_dir: &Path,
    id: Uuid,
    expected_revision: u64,
) -> Result<RenamePresetCatalog, String> {
    if expected_revision > MAX_SAFE_INTEGER {
        return Err("rename.bad_request".to_string());
    }
    let _lock = CatalogLock::acquire(data_dir)?;
    let path = catalog_file(data_dir);
    let current = read_catalog(&path)?;
    let next = remove(&current, id, expected_revision)?;
    write_catalog(&path, &next)?;
    Ok(next)
}

#[tauri::command]
pub async fn rename_presets_list(window: WebviewWindow) -> Result<RenamePresetCatalog, String> {
    ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        list_presets(&data_dir)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_preset_write(
    window: WebviewWindow,
    preset: RenamePreset,
    expected_revision: u64,
) -> Result<RenamePresetCatalog, String> {
    ensure_main(window.label())?;
    validate_preset(&preset)?;
    if expected_revision > MAX_SAFE_INTEGER {
        return Err("rename.bad_request".to_string());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        save_preset(&data_dir, preset, expected_revision)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_preset_remove(
    window: WebviewWindow,
    id: String,
    expected_revision: u64,
) -> Result<RenamePresetCatalog, String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&id).map_err(|_| "rename.bad_request".to_string())?;
    if expected_revision > MAX_SAFE_INTEGER {
        return Err("rename.bad_request".to_string());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        remove_preset(&data_dir, id, expected_revision)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use bulk_rename::types::{DateZone, RenameOperation};
    #[test]
    fn catalog_revision_conflict() {
        let catalog = RenamePresetCatalog { schema_version: 1, revision: 2, presets: vec![] };
        let preset = RenamePreset { id: Uuid::new_v4(), name: "Photos".into(), operations: vec![RenameOperation::Prefix { text: "Photo-".into() }], include_extension: false, date_zone: DateZone::Utc, version: 1 };
        assert_eq!(write(&catalog, preset, 1).unwrap_err(), "rename.changed");
        assert!(catalog.presets.is_empty());
    }
    #[test]
    fn catalog_never_accepts_source_path_field() {
        assert!(serde_json::from_value::<RenamePresetCatalog>(serde_json::json!({"schema_version":1,"revision":1,"presets":[],"paths":["C:\\private"]})).is_err());
    }
}
