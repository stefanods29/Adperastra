//! Export and import of `.adpgroups` files (Step 09b T4, D7).
//!
//! Export serializes selected saved groups and publishes them through
//! an owned, no-replace output: an existing destination is never
//! overwritten. Import reads at most 4 MiB, validates every group
//! before the catalog is touched, assigns fresh group IDs under the
//! catalog lock, and never opens a saved path or starts another app.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use tauri::{Manager, WebviewWindow};

use crate::saved_group_store::{apply_import, list_groups};
use crate::saved_group_types::{
    SavedGroupCatalog, SavedGroupExportResult, MAX_CATALOG_BYTES, MAX_SAFE_INTEGER,
    MAX_SAVED_GROUPS, SAVED_GROUPS_SCHEMA,
};
use crate::saved_group_validation::{validate_catalog, ERR_INVALID, ERR_IO, ERR_LIMIT};
use crate::{ensure_main, validate_absolute_path};

pub const SAVED_GROUPS_FILE_EXTENSION: &str = "adpgroups";
const MAX_DIALOG_TEXT: usize = 200;

pub fn export_groups(
    data_dir: &Path,
    ids: &[String],
    dest: &Path,
) -> Result<SavedGroupExportResult, String> {
    if ids.is_empty() || ids.len() > MAX_SAVED_GROUPS {
        return Err(ERR_INVALID.to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        if uuid::Uuid::try_parse(id).is_err() || !seen.insert(id) {
            return Err(ERR_INVALID.to_string());
        }
    }
    let catalog = list_groups(data_dir)?;
    let mut selected = Vec::new();
    for id in ids {
        let group = catalog
            .groups
            .iter()
            .find(|group| &group.id == id)
            .ok_or_else(|| ERR_INVALID.to_string())?;
        selected.push(group.clone());
    }
    let export = SavedGroupCatalog {
        schema_version: SAVED_GROUPS_SCHEMA,
        groups: selected,
        revision: 1,
    };
    validate_catalog(&export)?;
    let bytes = serde_json::to_vec_pretty(&export).map_err(|_| ERR_INVALID.to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(ERR_LIMIT.to_string());
    }
    let parent = dest.parent().ok_or_else(|| ERR_INVALID.to_string())?;
    let file_name = dest
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ERR_INVALID.to_string())?;
    let directory = PinnedDirectory::open(parent).map_err(|_| ERR_IO.to_string())?;
    let mut output = OwnedOutput::create(&directory, file_name).map_err(map_owned)?;
    output
        .file_mut()
        .write_all(&bytes)
        .map_err(|_| ERR_IO.to_string())?;
    output.flush_sync().map_err(map_owned)?;
    let published = output.publish_name(file_name).map_err(map_owned)?;
    Ok(SavedGroupExportResult {
        path: published.to_string_lossy().into_owned(),
        bytes: bytes.len() as u64,
    })
}

/// Read and fully validate an import file. Parsing happens before the
/// catalog lock is taken, so a bad file changes nothing.
pub fn parse_import(bytes: &[u8]) -> Result<SavedGroupCatalog, String> {
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(ERR_LIMIT.to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| ERR_INVALID.to_string())?;
    if let Some(schema) = value.get("schema_version").and_then(|v| v.as_u64()) {
        if schema > u64::from(SAVED_GROUPS_SCHEMA) {
            return Err(crate::saved_group_validation::ERR_UNSUPPORTED.to_string());
        }
    }
    let catalog: SavedGroupCatalog =
        serde_json::from_value(value).map_err(|_| ERR_INVALID.to_string())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

pub fn import_groups(
    data_dir: &Path,
    source: &Path,
    expected_revision: u64,
) -> Result<SavedGroupCatalog, String> {
    if expected_revision > MAX_SAFE_INTEGER {
        return Err(ERR_INVALID.to_string());
    }
    let mut file = std::fs::File::open(source).map_err(|_| ERR_IO.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ERR_IO.to_string())?;
    let imported = parse_import(&bytes)?;
    apply_import(data_dir, &imported, expected_revision)
}

fn map_owned(error: OwnedIoError) -> String {
    match error {
        // A destination that appeared meanwhile is left untouched,
        // and so is the file that was already there.
        OwnedIoError::TargetExists => ERR_INVALID.to_string(),
        _ => ERR_IO.to_string(),
    }
}

fn parse_dest_path(dest: &str) -> Result<PathBuf, String> {
    validate_absolute_path(dest).map_err(|_| ERR_INVALID.to_string())?;
    Ok(PathBuf::from(dest))
}

/// A picked file must be absolute and its extension must be exactly
/// `.adpgroups`; the dialog filter alone is not trusted.
fn check_picked_path(path: &str) -> Result<(), String> {
    validate_absolute_path(path).map_err(|_| ERR_INVALID.to_string())?;
    let has_extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(SAVED_GROUPS_FILE_EXTENSION));
    if !has_extension {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn saved_groups_export(
    window: WebviewWindow,
    ids: Vec<String>,
    dest_path: String,
) -> Result<SavedGroupExportResult, String> {
    ensure_main(window.label())?;
    let dest = parse_dest_path(&dest_path)?;
    if ids.is_empty() || ids.len() > MAX_SAVED_GROUPS {
        return Err(ERR_INVALID.to_string());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        export_groups(&data_dir, &ids, &dest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn saved_groups_import(
    window: WebviewWindow,
    path: String,
    expected_revision: u64,
) -> Result<SavedGroupCatalog, String> {
    ensure_main(window.label())?;
    let source = parse_dest_path(&path)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<crate::AppState>().data_dir.clone();
        import_groups(&data_dir, &source, expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pick one `.adpgroups` file for import. Main-window only; a cancelled
/// dialog is `Ok(None)`. The chosen path must be absolute and carry the
/// bounded `.adpgroups` extension. The import command still validates
/// the file's schema and every group before touching the catalog.
#[tauri::command]
pub async fn saved_groups_pick_import(
    window: WebviewWindow,
    title: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    if title.is_empty()
        || title.chars().count() > MAX_DIALOG_TEXT
        || filter_name.is_empty()
        || filter_name.chars().count() > MAX_DIALOG_TEXT
    {
        return Err(ERR_INVALID.to_string());
    }
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, "*.adpgroups")
            .map_err(|_| ERR_IO.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(path) = chosen else {
        return Ok(None);
    };
    check_picked_path(&path)?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saved_group_store::{catalog_file, write_catalog};
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

    fn group(id: &str) -> SavedTabGroup {
        SavedTabGroup {
            id: id.to_string(),
            name: "Work".to_string(),
            color: GroupColor::Purple,
            tabs: vec![descriptor(r"C:\notes.txt")],
            active_index: 0,
            created_unix: 10,
            modified_unix: 20,
            version: 1,
        }
    }

    const ID_A: &str = "00000000-0000-4000-8000-000000000001";

    fn catalog_with_one() -> SavedGroupCatalog {
        SavedGroupCatalog {
            schema_version: 1,
            groups: vec![group(ID_A)],
            revision: 3,
        }
    }

    #[test]
    fn picker_requires_adpgroups_extension() {
        let absolute = std::env::temp_dir().join("in.adpgroups");
        assert!(check_picked_path(&absolute.to_string_lossy()).is_ok());
        let other = std::env::temp_dir().join("in.txt");
        assert_eq!(
            check_picked_path(&other.to_string_lossy()).unwrap_err(),
            ERR_INVALID
        );
        assert_eq!(check_picked_path("in.adpgroups").unwrap_err(), ERR_INVALID);
    }

    #[test]
    fn import_assigns_fresh_ids() {
        let dir = tempfile::tempdir().unwrap();
        let import_path = dir.path().join("in.adpgroups");
        let imported = catalog_with_one();
        std::fs::write(
            &import_path,
            serde_json::to_vec_pretty(&imported).unwrap(),
        )
        .unwrap();
        let result = import_groups(dir.path(), &import_path, 1).unwrap();
        assert_eq!(result.groups.len(), 1);
        assert_ne!(result.groups[0].id, ID_A);
        assert!(uuid::Uuid::try_parse(&result.groups[0].id).is_ok());
        assert_eq!(result.groups[0].name, "Work");
        assert_eq!(result.revision, 2);
    }

    #[test]
    fn four_mib_plus_one_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let import_path = dir.path().join("big.adpgroups");
        std::fs::write(&import_path, vec![b' '; MAX_CATALOG_BYTES + 1]).unwrap();
        let error = import_groups(dir.path(), &import_path, 1).unwrap_err();
        assert_eq!(error, ERR_LIMIT);
        // The catalog was never created or altered.
        assert!(!catalog_file(dir.path()).exists());
    }

    #[test]
    fn export_collision_keeps_both_files() {
        let dir = tempfile::tempdir().unwrap();
        write_catalog(&catalog_file(dir.path()), &catalog_with_one()).unwrap();
        let dest = dir.path().join("out.adpgroups");
        std::fs::write(&dest, b"keep me").unwrap();
        let error = export_groups(dir.path(), &[ID_A.to_string()], &dest).unwrap_err();
        assert_eq!(error, ERR_INVALID);
        assert_eq!(std::fs::read(&dest).unwrap(), b"keep me");
        // No staging file is left behind in the destination folder.
        let names = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(names.iter().all(|name| !name.ends_with(".partial")));
        // A fresh destination works and reports its size.
        let fresh = dir.path().join("fresh.adpgroups");
        let result = export_groups(dir.path(), &[ID_A.to_string()], &fresh).unwrap();
        assert!(result.bytes > 0);
        assert_eq!(std::fs::metadata(&fresh).unwrap().len(), result.bytes);
    }
}
