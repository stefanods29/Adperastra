//! The saved-group catalog store (Step 09b T3): bounded reads,
//! revision-checked writes and atomic publication of
//! `<data>/saved-tab-groups.json`.
//!
//! Every operation takes the cross-process catalog lock first, so two
//! app instances can never interleave a read and a write. The lock is
//! released before any descriptor is parsed by a viewer or opened:
//! this module only moves catalog data, never file content.

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::{Manager, WebviewWindow};

use crate::saved_group_types::{
    SavedGroupCatalog, SavedGroupWrite, MAX_CATALOG_BYTES, MAX_SAFE_INTEGER, MAX_SAVED_GROUPS,
};
use crate::saved_group_validation::{
    validate_catalog, validate_group, ERR_CHANGED, ERR_INVALID, ERR_IO, ERR_LIMIT,
    ERR_UNSUPPORTED,
};
use crate::ensure_main;

pub fn catalog_file(data_dir: &Path) -> PathBuf {
    data_dir.join("saved-tab-groups.json")
}

fn lock_file(data_dir: &Path) -> PathBuf {
    data_dir.join("saved-tab-groups.lock")
}

/// The exclusive catalog lock. The lock file is never removed:
/// unlinking it would let two processes hold different locks.
pub struct CatalogLock {
    _file: File,
}

impl CatalogLock {
    pub fn acquire(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|_| ERR_IO.to_string())?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_file(data_dir))
            .map_err(|_| ERR_IO.to_string())?;
        file.lock().map_err(|_| ERR_IO.to_string())?;
        Ok(Self { _file: file })
    }
}

/// Read and validate the catalog. A missing file is the empty catalog
/// at revision 1; an oversize, malformed or newer file is refused and
/// left exactly as it was.
pub fn read_catalog(path: &Path) -> Result<SavedGroupCatalog, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SavedGroupCatalog::default());
        }
        Err(_) => return Err(ERR_IO.to_string()),
    };
    let mut bytes = Vec::new();
    file.by_ref()
        .take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ERR_IO.to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(ERR_INVALID.to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ERR_INVALID.to_string())?;
    if let Some(schema) = value.get("schema_version").and_then(|v| v.as_u64()) {
        if schema > u64::from(crate::saved_group_types::SAVED_GROUPS_SCHEMA) {
            return Err(ERR_UNSUPPORTED.to_string());
        }
    }
    let catalog: SavedGroupCatalog =
        serde_json::from_value(value).map_err(|_| ERR_INVALID.to_string())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

/// Validate, then publish the whole catalog atomically: a crash or a
/// failed write always leaves the previous catalog in place.
pub fn write_catalog(path: &Path, catalog: &SavedGroupCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|_| ERR_INVALID.to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(ERR_LIMIT.to_string());
    }
    fs_service::atomic_write(path, &bytes).map_err(|_| ERR_IO.to_string())
}

pub fn list_groups(data_dir: &Path) -> Result<SavedGroupCatalog, String> {
    let _lock = CatalogLock::acquire(data_dir)?;
    read_catalog(&catalog_file(data_dir))
}

/// E4 write: the caller's revision must still be current. An existing
/// group keeps its `created_unix`; a new group must fit the limit.
pub fn write_group(data_dir: &Path, request: &SavedGroupWrite) -> Result<SavedGroupCatalog, String> {
    if request.expected_revision > MAX_SAFE_INTEGER {
        return Err(ERR_INVALID.to_string());
    }
    validate_group(&request.group)?;
    let _lock = CatalogLock::acquire(data_dir)?;
    let path = catalog_file(data_dir);
    let current = read_catalog(&path)?;
    if current.revision != request.expected_revision {
        return Err(ERR_CHANGED.to_string());
    }
    let mut next = current.clone();
    let mut group = request.group.clone();
    if let Some(existing) = next.groups.iter_mut().find(|g| g.id == group.id) {
        group.created_unix = existing.created_unix;
        *existing = group;
    } else {
        if next.groups.len() >= MAX_SAVED_GROUPS {
            return Err(ERR_LIMIT.to_string());
        }
        next.groups.push(group);
    }
    next.revision = current
        .revision
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_INTEGER)
        .ok_or_else(|| ERR_INVALID.to_string())?;
    write_catalog(&path, &next)?;
    Ok(next)
}

pub fn remove_group(
    data_dir: &Path,
    id: &str,
    expected_revision: u64,
) -> Result<SavedGroupCatalog, String> {
    if uuid::Uuid::try_parse(id).is_err() || expected_revision > MAX_SAFE_INTEGER {
        return Err(ERR_INVALID.to_string());
    }
    let _lock = CatalogLock::acquire(data_dir)?;
    let path = catalog_file(data_dir);
    let current = read_catalog(&path)?;
    if current.revision != expected_revision {
        return Err(ERR_CHANGED.to_string());
    }
    let mut next = current.clone();
    let before = next.groups.len();
    next.groups.retain(|group| group.id != id);
    if next.groups.len() == before {
        return Err(ERR_INVALID.to_string());
    }
    next.revision = current
        .revision
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_INTEGER)
        .ok_or_else(|| ERR_INVALID.to_string())?;
    write_catalog(&path, &next)?;
    Ok(next)
}

/// Merge an already-validated imported catalog under the same lock:
/// revision check, capacity check, fresh group IDs, one atomic write.
/// Duplicate names are allowed; nothing is opened or executed here.
pub fn apply_import(
    data_dir: &Path,
    imported: &SavedGroupCatalog,
    expected_revision: u64,
) -> Result<SavedGroupCatalog, String> {
    let _lock = CatalogLock::acquire(data_dir)?;
    let path = catalog_file(data_dir);
    let current = read_catalog(&path)?;
    if current.revision != expected_revision {
        return Err(ERR_CHANGED.to_string());
    }
    if current.groups.len() + imported.groups.len() > MAX_SAVED_GROUPS {
        return Err(ERR_LIMIT.to_string());
    }
    let mut next = current.clone();
    for group in &imported.groups {
        let mut fresh = group.clone();
        fresh.id = uuid::Uuid::new_v4().to_string();
        next.groups.push(fresh);
    }
    next.revision = current
        .revision
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_INTEGER)
        .ok_or_else(|| ERR_INVALID.to_string())?;
    write_catalog(&path, &next)?;
    Ok(next)
}

#[tauri::command]
pub async fn saved_groups_list(window: WebviewWindow) -> Result<SavedGroupCatalog, String> {
    ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        list_groups(&data_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn saved_group_write(
    window: WebviewWindow,
    request: SavedGroupWrite,
) -> Result<SavedGroupCatalog, String> {
    ensure_main(window.label())?;
    validate_group(&request.group)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        write_group(&data_dir, &request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn saved_group_remove(
    window: WebviewWindow,
    id: String,
    expected_revision: u64,
) -> Result<SavedGroupCatalog, String> {
    ensure_main(window.label())?;
    if uuid::Uuid::try_parse(&id).is_err() {
        return Err(ERR_INVALID.to_string());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        remove_group(&data_dir, &id, expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saved_group_types::{GroupColor, SavedTabDescriptor, SavedTabGroup};

    fn descriptor(path: &str) -> SavedTabDescriptor {
        SavedTabDescriptor {
            kind: "file".to_string(),
            title: Some("notes.txt".to_string()),
            path: Some(path.to_string()),
            handler: Some("text".to_string()),
            source: None,
            folder: None,
            view: None,
            view_version: None,
            split: None,
            content_view_id: None,
            pinned: false,
        }
    }

    fn group(id: &str, name: &str) -> SavedTabGroup {
        SavedTabGroup {
            id: id.to_string(),
            name: name.to_string(),
            color: GroupColor::Purple,
            tabs: vec![descriptor(r"C:\notes.txt")],
            active_index: 0,
            created_unix: 10,
            modified_unix: 20,
            version: 1,
        }
    }

    fn uuid_at(index: u32) -> String {
        format!("00000000-0000-4000-8000-{index:012}")
    }

    fn write_request(expected: u64, group: SavedTabGroup) -> SavedGroupWrite {
        SavedGroupWrite {
            expected_revision: expected,
            group,
        }
    }

    #[test]
    fn revision_conflict_keeps_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = SavedGroupCatalog {
            schema_version: 1,
            groups: vec![group(&uuid_at(1), "Work")],
            revision: 4,
        };
        write_catalog(&catalog_file(dir.path()), &catalog).unwrap();
        let before = std::fs::read(catalog_file(dir.path())).unwrap();
        let error = write_group(
            dir.path(),
            &write_request(3, group(&uuid_at(2), "Other")),
        )
        .unwrap_err();
        assert_eq!(error, ERR_CHANGED);
        assert_eq!(std::fs::read(catalog_file(dir.path())).unwrap(), before);
    }

    #[test]
    fn one_hundred_and_first_group_refused() {
        let dir = tempfile::tempdir().unwrap();
        let groups = (1..=100u32)
            .map(|index| group(&uuid_at(index), "Work"))
            .collect::<Vec<_>>();
        let catalog = SavedGroupCatalog {
            schema_version: 1,
            groups,
            revision: 7,
        };
        write_catalog(&catalog_file(dir.path()), &catalog).unwrap();
        let error = write_group(
            dir.path(),
            &write_request(7, group(&uuid_at(101), "Extra")),
        )
        .unwrap_err();
        assert_eq!(error, ERR_LIMIT);
        assert_eq!(list_groups(dir.path()).unwrap().groups.len(), 100);
    }

    #[test]
    fn virtual_names_and_tokens_not_saved() {
        let dir = tempfile::tempdir().unwrap();
        let mut virtual_group = group(&uuid_at(1), "Locked");
        virtual_group.tabs[0].source = Some(serde_json::json!({
            "kind": "virtual",
            "container_path": r"C:\locked.adplock",
            "entry_id": uuid_at(9),
        }));
        // A plaintext title on a virtual entry is refused...
        let error = write_group(dir.path(), &write_request(1, virtual_group.clone())).unwrap_err();
        assert_eq!(error, ERR_INVALID);
        // ...and so is a token hiding in the view state.
        virtual_group.tabs[0].title = None;
        virtual_group.tabs[0].path = None;
        virtual_group.tabs[0].view = Some(serde_json::json!({ "token": "abc" }));
        let error = write_group(dir.path(), &write_request(1, virtual_group)).unwrap_err();
        assert_eq!(error, ERR_INVALID);
        assert!(list_groups(dir.path()).unwrap().groups.is_empty());
    }

    #[test]
    fn failed_write_keeps_old_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = SavedGroupCatalog {
            schema_version: 1,
            groups: vec![group(&uuid_at(1), "Work")],
            revision: 2,
        };
        let path = catalog_file(dir.path());
        write_catalog(&path, &catalog).unwrap();
        let before = std::fs::read(&path).unwrap();
        // A refused group changes nothing on disk.
        let mut bad = group(&uuid_at(2), "Other");
        bad.name = "   ".to_string();
        assert!(write_group(dir.path(), &write_request(2, bad)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        // A destination that cannot be written reports groups.io and
        // the real catalog is still readable and unchanged.
        let blocked = dir.path().join("saved-tab-groups.json");
        let mut bad_path_parent = dir.path().to_path_buf();
        bad_path_parent.push("not-a-folder");
        std::fs::write(&bad_path_parent, b"x").unwrap();
        let bad_path = bad_path_parent.join("saved-tab-groups.json");
        assert_eq!(write_catalog(&bad_path, &catalog).unwrap_err(), ERR_IO);
        assert_eq!(std::fs::read(&blocked).unwrap(), before);
    }
}
