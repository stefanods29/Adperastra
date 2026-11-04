//! Persistent, bounded shelf references (Step 09g, E4).
//!
//! `<data>/shelf.json` holds schema 1, a monotonic revision and at most
//! 1,000 disk references in 2 MiB. Virtual locked-folder references are
//! returned in memory but never written. Reads and revision-checked
//! writes take one cross-process lock; availability refresh never writes
//! and never opens file content (no cloud hydration).

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::document_types::DocumentRef;
use crate::jobs::{spawn_job, Jobs};
use crate::shelf_types::{
    display_name_for, source_key, validate_patch, validate_persisted_catalog,
    validate_runtime_catalog, ShelfCatalog, ShelfItem, ShelfPatch, ShelfState, ERR_SHELF_CANCELLED,
    ERR_SHELF_CHANGED, ERR_SHELF_INVALID, ERR_SHELF_IO, ERR_SHELF_LIMIT, MAX_SAFE_INTEGER,
    MAX_SHELF_BYTES, MAX_SHELF_ITEMS, SHELF_SCHEMA,
};
use crate::{ensure_main, valid_request_id};

pub fn shelf_file(data_dir: &Path) -> PathBuf {
    data_dir.join("shelf.json")
}

fn lock_file(data_dir: &Path) -> PathBuf {
    data_dir.join("shelf.lock")
}

/// One exclusive app-state lock. The lock file is never removed: unlinking
/// it would let two processes hold different locks.
struct ShelfLock {
    _file: File,
}

impl ShelfLock {
    fn acquire(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|_| ERR_SHELF_IO.to_string())?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_file(data_dir))
            .map_err(|_| ERR_SHELF_IO.to_string())?;
        file.lock().map_err(|_| ERR_SHELF_IO.to_string())?;
        Ok(Self { _file: file })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedShelfItem {
    id: String,
    source: DocumentRef,
    display_name: String,
    added_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedShelfCatalog {
    schema_version: u32,
    revision: u64,
    items: Vec<PersistedShelfItem>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().min(MAX_SAFE_INTEGER))
        .unwrap_or(0)
}

fn read_catalog(path: &Path) -> Result<ShelfCatalog, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ShelfCatalog::default())
        }
        Err(_) => return Err(ERR_SHELF_IO.to_string()),
    };
    let mut bytes = Vec::new();
    file.by_ref()
        .take((MAX_SHELF_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ERR_SHELF_IO.to_string())?;
    if bytes.len() > MAX_SHELF_BYTES {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ERR_SHELF_INVALID.to_string())?;
    if value.get("schema_version").and_then(|schema| schema.as_u64())
        != Some(u64::from(SHELF_SCHEMA))
    {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    let persisted: PersistedShelfCatalog =
        serde_json::from_value(value).map_err(|_| ERR_SHELF_INVALID.to_string())?;
    if persisted.items.len() > MAX_SHELF_ITEMS {
        return Err(ERR_SHELF_LIMIT.to_string());
    }
    let items = persisted
        .items
        .into_iter()
        .map(|item| ShelfItem {
            id: item.id,
            source: item.source,
            display_name: item.display_name,
            added_unix: item.added_unix,
            state: ShelfState::Unavailable,
            last_checked_unix: None,
            runtime_sensitive: false,
        })
        .collect();
    let catalog = ShelfCatalog {
        schema_version: SHELF_SCHEMA,
        revision: persisted.revision,
        items,
    };
    validate_persisted_catalog(&catalog)?;
    Ok(catalog)
}

fn write_catalog(path: &Path, catalog: &ShelfCatalog) -> Result<(), String> {
    validate_runtime_catalog(catalog)?;
    let persisted = PersistedShelfCatalog {
        schema_version: SHELF_SCHEMA,
        revision: catalog.revision,
        items: catalog
            .items
            .iter()
            .filter(|item| matches!(&item.source, DocumentRef::Disk { .. }))
            .map(|item| PersistedShelfItem {
                id: item.id.clone(),
                source: item.source.clone(),
                display_name: item.display_name.clone(),
                added_unix: item.added_unix,
            })
            .collect(),
    };
    let disk_only = ShelfCatalog {
        schema_version: SHELF_SCHEMA,
        revision: catalog.revision,
        items: catalog
            .items
            .iter()
            .filter(|item| matches!(&item.source, DocumentRef::Disk { .. }))
            .cloned()
            .collect(),
    };
    validate_persisted_catalog(&disk_only)?;
    let bytes = serde_json::to_vec_pretty(&persisted).map_err(|_| ERR_SHELF_INVALID.to_string())?;
    if bytes.len() > MAX_SHELF_BYTES {
        return Err(ERR_SHELF_LIMIT.to_string());
    }
    fs_service::atomic_write(path, &bytes).map_err(|_| ERR_SHELF_IO.to_string())
}

pub fn get_catalog(data_dir: &Path) -> Result<ShelfCatalog, String> {
    let _lock = ShelfLock::acquire(data_dir)?;
    read_catalog(&shelf_file(data_dir))
}

fn next_revision(current: u64) -> Result<u64, String> {
    current
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_INTEGER)
        .ok_or_else(|| ERR_SHELF_LIMIT.to_string())
}

/// E4: apply one patch under the revision check. A failed write leaves the
/// previous catalog untouched; a stale revision changes nothing.
pub fn patch_catalog(
    data_dir: &Path,
    patch: &ShelfPatch,
    expected_revision: u64,
) -> Result<ShelfCatalog, String> {
    validate_patch(patch)?;
    if expected_revision == 0 || expected_revision > MAX_SAFE_INTEGER {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    let _lock = ShelfLock::acquire(data_dir)?;
    let path = shelf_file(data_dir);
    let current = read_catalog(&path)?;
    if current.revision != expected_revision {
        return Err(ERR_SHELF_CHANGED.to_string());
    }
    let mut next = current.clone();
    let mut changed = false;
    let now = now_unix();
    match patch {
        ShelfPatch::Add { sources } => {
            let mut keys: std::collections::HashSet<String> = next
                .items
                .iter()
                .map(|item| source_key(&item.source))
                .collect::<Result<_, _>>()?;
            for source in sources {
                source
                    .validate()
                    .map_err(|_| ERR_SHELF_INVALID.to_string())?;
                let key = source_key(source)?;
                if !keys.insert(key) {
                    continue;
                }
                if next.items.len() >= MAX_SHELF_ITEMS {
                    return Err(ERR_SHELF_LIMIT.to_string());
                }
                next.items.push(ShelfItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    source: source.clone(),
                    display_name: display_name_for(source)?,
                    added_unix: now,
                    state: ShelfState::Available,
                    last_checked_unix: Some(now),
                    runtime_sensitive: matches!(source, DocumentRef::Virtual { .. }),
                });
                changed = true;
            }
        }
        ShelfPatch::Remove { ids } => {
            let remove: std::collections::HashSet<String> =
                ids.iter().map(|id| id.to_lowercase()).collect();
            let before = next.items.len();
            next.items.retain(|item| !remove.contains(&item.id.to_lowercase()));
            changed = next.items.len() != before;
        }
        ShelfPatch::Clear {} => {
            changed = !next.items.is_empty();
            next.items.clear();
        }
        ShelfPatch::Reorder { ids } => {
            if ids.len() != next.items.len() {
                return Err(ERR_SHELF_INVALID.to_string());
            }
            let mut by_key = std::collections::HashMap::new();
            for item in &next.items {
                by_key.insert(item.id.to_lowercase(), item.clone());
            }
            let mut ordered = Vec::with_capacity(next.items.len());
            for id in ids {
                ordered.push(
                    by_key
                        .remove(&id.to_lowercase())
                        .ok_or_else(|| ERR_SHELF_INVALID.to_string())?,
                );
            }
            changed = ordered != next.items;
            next.items = ordered;
        }
        ShelfPatch::UpdateMoved { moves } => {
            for item in moves {
                let from = item.from.to_string_lossy().into_owned();
                let to = item.to.to_string_lossy().into_owned();
                let key = source_key(&DocumentRef::Disk { path: from })?;
                if let Some(existing) = next
                    .items
                    .iter_mut()
                    .find(|entry| source_key(&entry.source).ok().as_deref() == Some(key.as_str()))
                {
                    existing.source = DocumentRef::Disk { path: to.clone() };
                    existing.display_name = display_name_for(&existing.source)?;
                    existing.state = ShelfState::Available;
                    existing.last_checked_unix = Some(now);
                    existing.runtime_sensitive = false;
                    changed = true;
                }
            }
        }
    }
    if !changed {
        return Ok(current);
    }
    next.revision = next_revision(current.revision)?;
    validate_runtime_catalog(&next)?;
    write_catalog(&path, &next)?;
    Ok(next)
}

#[cfg(windows)]
fn stat_path(path: &Path) -> (ShelfState, Option<u64>) {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let checked = now_unix();
    let opened = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(
            FILE_FLAG_OPEN_NO_RECALL.0
                | FILE_FLAG_OPEN_REPARSE_POINT.0
                | FILE_FLAG_BACKUP_SEMANTICS.0,
        )
        .open(path);
    match opened {
        Ok(file) => {
            let attributes = file
                .metadata()
                .map(|metadata| metadata.file_attributes())
                .unwrap_or(0);
            if fs_service::source_stamp::attributes_are_online_only(attributes) {
                (ShelfState::Unavailable, Some(checked))
            } else {
                (ShelfState::Available, Some(checked))
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (ShelfState::Missing, Some(checked))
        }
        Err(_) => (ShelfState::Unavailable, Some(checked)),
    }
}

#[cfg(not(windows))]
fn stat_path(_path: &Path) -> (ShelfState, Option<u64>) {
    (ShelfState::Unavailable, Some(now_unix()))
}

/// Refresh selected disk references without content reads. At most eight
/// attribute-only checks run at once; the whole refresh is bounded to
/// three seconds. A timeout leaves an honest `unavailable` state.
pub fn refresh_catalog(
    data_dir: &Path,
    ids: &[String],
    token: &fs_service::CancellationToken,
) -> Result<ShelfCatalog, String> {
    if ids.len() > MAX_SHELF_ITEMS {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    let mut selected = std::collections::HashSet::new();
    for id in ids {
        if uuid::Uuid::try_parse(id).is_err() {
            return Err(ERR_SHELF_INVALID.to_string());
        }
        selected.insert(id.to_lowercase());
    }
    let catalog = get_catalog(data_dir)?;
    let mut next = catalog;
    let jobs: Vec<(usize, String)> = next
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| matches!(&item.source, DocumentRef::Disk { .. }))
        .filter(|(_, item)| selected.is_empty() || selected.contains(&item.id.to_lowercase()))
        .filter_map(|(index, item)| match &item.source {
            DocumentRef::Disk { path } => Some((index, path.clone())),
            _ => None,
        })
        .collect();
    if jobs.is_empty() {
        return Ok(next);
    }
    let total = jobs.len();
    let queue = Arc::new(Mutex::new(jobs));
    let (sender, receiver) = mpsc::channel::<(usize, ShelfState, u64)>();
    let token = token.clone();
    for _ in 0..8.min(queue.lock().map_or(0, |guard| guard.len())) {
        let queue = Arc::clone(&queue);
        let sender = sender.clone();
        let token = token.clone();
        std::thread::spawn(move || loop {
            if token.load(Ordering::Relaxed) {
                return;
            }
            let next = match queue.lock() {
                Ok(mut guard) => guard.pop(),
                Err(_) => None,
            };
            let Some((index, path)) = next else {
                return;
            };
            let (state, checked) = stat_path(Path::new(&path));
            if sender.send((index, state, checked.unwrap_or_else(now_unix))).is_err() {
                return;
            }
        });
    }
    drop(sender);
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut received = 0usize;
    while received < total {
        if token.load(Ordering::Relaxed) {
            return Err(ERR_SHELF_CANCELLED.to_string());
        }
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match receiver.recv_timeout(deadline - now) {
            Ok((index, state, checked)) => {
                if let Some(item) = next.items.get_mut(index) {
                    item.state = state;
                    item.last_checked_unix = Some(checked);
                }
                received += 1;
            }
            Err(_) => break,
        }
    }
    // A check that never answered is reported honestly as unavailable.
    if received < total {
        let checked = now_unix();
        for item in &mut next.items {
            if matches!(&item.source, DocumentRef::Disk { .. })
                && (selected.is_empty() || selected.contains(&item.id.to_lowercase()))
                && item.last_checked_unix.is_none_or(|value| value < checked)
            {
                item.state = ShelfState::Unavailable;
                item.last_checked_unix = Some(checked);
            }
        }
    }
    Ok(next)
}

fn progress(items_done: usize, items_total: usize) -> fs_service::OpProgress {
    fs_service::OpProgress {
        items_done,
        items_total,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    }
}

#[tauri::command]
pub async fn shelf_get(
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
) -> Result<ShelfCatalog, String> {
    ensure_main(window.label())?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || get_catalog(&data_dir))
        .await
        .map_err(|_| ERR_SHELF_IO.to_string())?
}

#[tauri::command]
pub async fn shelf_patch(
    window: WebviewWindow,
    state: State<'_, crate::AppState>,
    patch: ShelfPatch,
    expected_revision: u64,
) -> Result<ShelfCatalog, String> {
    ensure_main(window.label())?;
    validate_patch(&patch)?;
    if expected_revision == 0 || expected_revision > MAX_SAFE_INTEGER {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        patch_catalog(&data_dir, &patch, expected_revision)
    })
    .await
    .map_err(|_| ERR_SHELF_IO.to_string())?
}

#[tauri::command]
pub fn shelf_refresh_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, crate::AppState>,
    request_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if ids.len() > MAX_SHELF_ITEMS {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    for id in &ids {
        if uuid::Uuid::try_parse(id).is_err() {
            return Err(ERR_SHELF_INVALID.to_string());
        }
    }
    let total = ids.len().max(1);
    let data_dir = state.data_dir.clone();
    let token = app.state::<Jobs>().begin(&request_id, total)?;
    spawn_job(app, request_id, token, move |context| {
        let catalog = refresh_catalog(&data_dir, &ids, context.token())?;
        context.set_progress(&progress(catalog.items.len(), catalog.items.len()));
        serde_json::to_value(catalog).map_err(|_| ERR_SHELF_IO.to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{get_catalog, patch_catalog, read_catalog, shelf_file};
    use crate::document_types::DocumentRef;
    use crate::shelf_types::{
        ShelfPatch, ShelfState, MAX_SHELF_BYTES, MAX_SHELF_ITEMS,
    };
    use std::path::PathBuf;

    fn disk(path: &str) -> DocumentRef {
        DocumentRef::Disk {
            path: path.to_string(),
        }
    }

    fn add(data_dir: &std::path::Path, paths: &[&str], revision: u64) -> crate::shelf_types::ShelfCatalog {
        patch_catalog(
            data_dir,
            &ShelfPatch::Add {
                sources: paths.iter().map(|path| disk(path)).collect(),
            },
            revision,
        )
        .unwrap()
    }

    #[test]
    fn no_duplicate_normalized_paths() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = add(
            dir.path(),
            &["C:\\Shelf\\A.TXT", "c:\\shelf\\a.txt", "\\\\?\\C:\\Shelf\\B.txt"],
            1,
        );
        assert_eq!(catalog.items.len(), 2);
        assert_eq!(catalog.revision, 2);
    }

    #[test]
    fn one_thousand_and_first_refused() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<String> = (0..MAX_SHELF_ITEMS)
            .map(|index| format!("C:\\Shelf\\file{index}.txt"))
            .collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let catalog = add(dir.path(), &refs, 1);
        assert_eq!(catalog.items.len(), MAX_SHELF_ITEMS);
        let error = patch_catalog(
            dir.path(),
            &ShelfPatch::Add {
                sources: vec![disk("C:\\Shelf\\one-too-many.txt")],
            },
            catalog.revision,
        )
        .unwrap_err();
        assert_eq!(error, "shelf.limit");
    }

    #[test]
    fn clear_leaves_disk_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("kept.txt");
        std::fs::write(&file, b"unchanged bytes").unwrap();
        let path = file.to_string_lossy().into_owned();
        let catalog = add(dir.path(), &[&path], 1);
        let before = std::fs::read(&file).unwrap();
        let cleared = patch_catalog(dir.path(), &ShelfPatch::Clear {}, catalog.revision).unwrap();
        let after = std::fs::read(&file).unwrap();
        assert!(cleared.items.is_empty());
        assert_eq!(before, after);
        assert!(file.exists());
    }

    #[test]
    fn virtual_never_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let virtual_ref = DocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\Sealed".to_string(),
            entry_id: "00000000-0000-4000-8000-000000000001".to_string(),
        };
        let catalog = patch_catalog(
            dir.path(),
            &ShelfPatch::Add {
                sources: vec![disk("C:\\Shelf\\disk.txt"), virtual_ref],
            },
            1,
        )
        .unwrap();
        assert_eq!(catalog.items.len(), 2);
        assert!(catalog.items.iter().any(|item| item.runtime_sensitive));
        let raw = std::fs::read_to_string(shelf_file(dir.path())).unwrap();
        assert!(!raw.contains("virtual"));
        assert!(!raw.contains("runtime_sensitive"));
        let reloaded = get_catalog(dir.path()).unwrap();
        assert_eq!(reloaded.items.len(), 1);
        assert!(matches!(
            reloaded.items[0].source,
            DocumentRef::Disk { .. }
        ));
    }

    #[test]
    fn revision_race_keeps_original() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = add(dir.path(), &["C:\\Shelf\\a.txt"], 1);
        let before = std::fs::read(shelf_file(dir.path())).unwrap();
        let error = patch_catalog(dir.path(), &ShelfPatch::Clear {}, 1).unwrap_err();
        let after = std::fs::read(shelf_file(dir.path())).unwrap();
        assert_eq!(error, "shelf.changed");
        assert_eq!(before, after);
        assert_eq!(catalog.revision, 2);
    }

    #[test]
    fn update_moved_only_touches_completed_paths() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = add(dir.path(), &["C:\\Shelf\\a.txt", "C:\\Shelf\\b.txt"], 1);
        let moves = vec![fs_service::CompletedItem {
            from: PathBuf::from("C:\\Shelf\\a.txt"),
            to: PathBuf::from("C:\\Shelf\\moved\\a.txt"),
        }];
        let next = patch_catalog(
            dir.path(),
            &ShelfPatch::UpdateMoved { moves },
            catalog.revision,
        )
        .unwrap();
        let a = next
            .items
            .iter()
            .find(|item| item.display_name == "a.txt")
            .unwrap();
        assert!(matches!(&a.source, DocumentRef::Disk { path } if path == "C:\\Shelf\\moved\\a.txt"));
        assert_eq!(a.state, ShelfState::Available);
        let b = next
            .items
            .iter()
            .find(|item| item.display_name == "b.txt")
            .unwrap();
        assert!(matches!(&b.source, DocumentRef::Disk { path } if path == "C:\\Shelf\\b.txt"));
    }

    #[test]
    fn reorder_requires_the_exact_permutation() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = add(dir.path(), &["C:\\Shelf\\a.txt", "C:\\Shelf\\b.txt"], 1);
        let first = catalog.items[0].id.clone();
        let second = catalog.items[1].id.clone();
        assert_eq!(
            patch_catalog(
                dir.path(),
                &ShelfPatch::Reorder {
                    ids: vec![first.clone()]
                },
                catalog.revision,
            )
            .unwrap_err(),
            "shelf.invalid"
        );
        let reordered = patch_catalog(
            dir.path(),
            &ShelfPatch::Reorder {
                ids: vec![second.clone(), first.clone()],
            },
            catalog.revision,
        )
        .unwrap();
        assert_eq!(reordered.items[0].id, second);
    }

    #[test]
    fn a_catalog_larger_than_two_mib_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<String> = (0..MAX_SHELF_ITEMS)
            .map(|index| format!("C:\\Shelf\\{index}-{}.txt", "a".repeat(2400)))
            .collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let result = patch_catalog(
            dir.path(),
            &ShelfPatch::Add {
                sources: refs.iter().map(|path| disk(path)).collect(),
            },
            1,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err() == "shelf.limit");
        let raw = std::fs::read(shelf_file(dir.path()));
        assert!(raw.is_err() || raw.unwrap().len() <= MAX_SHELF_BYTES);
    }

    #[test]
    fn missing_paths_become_missing_after_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("gone.txt");
        std::fs::write(&file, b"x").unwrap();
        let path = file.to_string_lossy().into_owned();
        let catalog = add(dir.path(), &[&path], 1);
        std::fs::remove_file(&file).unwrap();
        let token = fs_service::new_cancellation_token();
        let refreshed = super::refresh_catalog(dir.path(), &[catalog.items[0].id.clone()], &token).unwrap();
        assert_eq!(refreshed.items[0].state, ShelfState::Missing);
        // The unavailable state is memory only; the persisted bytes did not grow.
        let stored = read_catalog(&shelf_file(dir.path())).unwrap();
        assert_eq!(stored.items.len(), 1);
    }
}
