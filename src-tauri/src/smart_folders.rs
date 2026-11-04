//! Smart folder catalog (Step 11b decision 6 and E4). A smart folder stores
//! only the id of a Step 11a saved search; its results always come from a
//! live indexed query. The catalog lives at `<profile>/smart-folders.json`
//! schema 1, bounded to 100 entries and 256 KiB.

use std::path::{Path, PathBuf};

use search_index::limits::unix_now;
use search_index::types::validate_uuid;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::saved_searches::SavedSearchStore;
use crate::search_index::SearchIndexState;
use crate::smart_view_types::{
    SmartFolder, MAX_SMART_FOLDERS, MAX_SMART_FOLDER_BYTES, SMART_FOLDER_SCHEMA_VERSION,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SmartFolderCatalog {
    #[serde(default = "default_schema")]
    schema_version: u32,
    #[serde(default)]
    folders: Vec<SmartFolder>,
}

fn default_schema() -> u32 {
    SMART_FOLDER_SCHEMA_VERSION
}

impl Default for SmartFolderCatalog {
    fn default() -> Self {
        Self {
            schema_version: SMART_FOLDER_SCHEMA_VERSION,
            folders: Vec::new(),
        }
    }
}

pub struct SmartFolderStore {
    profile_dir: PathBuf,
    path: PathBuf,
}

impl SmartFolderStore {
    pub fn new(profile_dir: &Path) -> Self {
        Self {
            profile_dir: profile_dir.to_path_buf(),
            path: profile_dir.join("smart-folders.json"),
        }
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list(&self) -> Result<Vec<SmartFolder>, String> {
        Ok(self.load()?.folders)
    }

    /// Save one folder. The saved search must already exist: a smart folder is
    /// a view of a saved query, never a second copy of the query itself.
    pub fn save(&self, mut folder: SmartFolder) -> Result<SmartFolder, String> {
        folder.name = folder.name.trim().to_string();
        folder.validate()?;
        let searches = SavedSearchStore::new(&self.profile_dir)
            .list()
            .map_err(|_| "views.unavailable".to_string())?;
        if !searches
            .iter()
            .any(|search| search.id == folder.saved_search_id)
        {
            return Err("views.invalid".to_string());
        }
        let mut catalog = self.load()?;
        let now = unix_now();
        if let Some(existing) = catalog
            .folders
            .iter_mut()
            .find(|entry| entry.id == folder.id)
        {
            folder.created_unix = existing.created_unix;
            folder.modified_unix = now;
            *existing = folder.clone();
        } else {
            if catalog.folders.len() >= MAX_SMART_FOLDERS {
                return Err("views.invalid".to_string());
            }
            folder.created_unix = if folder.created_unix == 0 {
                now
            } else {
                folder.created_unix
            };
            folder.modified_unix = now;
            catalog.folders.push(folder.clone());
        }
        self.write(&catalog)?;
        Ok(folder)
    }

    /// Remove one folder. `remove_saved_query == false` (the default) keeps the
    /// saved query and every file on disk, as decision 6 requires.
    pub fn remove(&self, id: &str, remove_saved_query: bool) -> Result<(), String> {
        validate_uuid(id).map_err(|_| "views.invalid".to_string())?;
        let mut catalog = self.load()?;
        let Some(position) = catalog.folders.iter().position(|entry| entry.id == id) else {
            return Ok(());
        };
        let saved_search_id = catalog.folders[position].saved_search_id.clone();
        catalog.folders.remove(position);
        self.write(&catalog)?;
        if remove_saved_query {
            SavedSearchStore::new(&self.profile_dir)
                .remove(&saved_search_id)
                .map_err(|_| "views.unavailable".to_string())?;
        }
        Ok(())
    }

    fn load(&self) -> Result<SmartFolderCatalog, String> {
        let metadata = match std::fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SmartFolderCatalog::default())
            }
            Err(_) => return Err("views.unavailable".to_string()),
        };
        if metadata.len() > MAX_SMART_FOLDER_BYTES as u64 {
            return Err("views.invalid".to_string());
        }
        let bytes = std::fs::read(&self.path).map_err(|_| "views.unavailable".to_string())?;
        let catalog: SmartFolderCatalog =
            serde_json::from_slice(&bytes).map_err(|_| "views.invalid".to_string())?;
        if catalog.schema_version != SMART_FOLDER_SCHEMA_VERSION
            || catalog.folders.len() > MAX_SMART_FOLDERS
            || catalog.folders.iter().any(|folder| folder.validate().is_err())
        {
            return Err("views.invalid".to_string());
        }
        Ok(catalog)
    }

    fn write(&self, catalog: &SmartFolderCatalog) -> Result<(), String> {
        let bytes = serde_json::to_vec(catalog).map_err(|_| "views.invalid".to_string())?;
        if bytes.len() > MAX_SMART_FOLDER_BYTES {
            return Err("views.invalid".to_string());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "views.unavailable".to_string())?;
        }
        fs_service::atomic_write(&self.path, &bytes)
            .map_err(|_| "views.unavailable".to_string())
    }
}

#[tauri::command]
pub async fn smart_folders_list(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
) -> Result<Vec<SmartFolder>, String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || SmartFolderStore::new(&directory).list())
        .await
        .map_err(|_| "views.unavailable".to_string())?
}

#[tauri::command]
pub async fn smart_folder_save(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    folder: SmartFolder,
) -> Result<SmartFolder, String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || SmartFolderStore::new(&directory).save(folder))
        .await
        .map_err(|_| "views.unavailable".to_string())?
}

#[tauri::command]
pub async fn smart_folder_remove(
    window: WebviewWindow,
    state: State<'_, SearchIndexState>,
    id: String,
    remove_saved_query: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let directory = state.profile_dir().clone();
    tauri::async_runtime::spawn_blocking(move || {
        SmartFolderStore::new(&directory).remove(&id, remove_saved_query)
    })
    .await
    .map_err(|_| "views.unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::SmartFolderStore;
    use crate::saved_searches::SavedSearchStore;
    use crate::smart_view_types::{SmartFolder, MAX_SMART_FOLDERS};
    use search_index::types::{SavedSearch, SearchMode, SearchQuery};

    fn saved_search(name: &str) -> SavedSearch {
        SavedSearch {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            query: SearchQuery {
                mode: SearchMode::Name,
                text: "port".to_string(),
                ..SearchQuery::default()
            },
            created_unix: 0,
            modified_unix: 0,
            version: 1,
        }
    }

    fn folder(name: &str, saved_search_id: &str) -> SmartFolder {
        SmartFolder {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            saved_search_id: saved_search_id.to_string(),
            created_unix: 0,
            modified_unix: 0,
        }
    }

    #[test]
    fn save_requires_an_existing_saved_search() {
        let directory = tempfile::tempdir().unwrap();
        let searches = SavedSearchStore::new(directory.path());
        let saved = searches.save(saved_search("Ports")).unwrap();
        let store = SmartFolderStore::new(directory.path());
        let saved_folder = store.save(folder("Ports folder", &saved.id)).unwrap();
        assert!(saved_folder.created_unix > 0);
        assert_eq!(store.list().unwrap().len(), 1);

        let dangling = store
            .save(folder("Missing", &uuid::Uuid::new_v4().to_string()))
            .unwrap_err();
        assert_eq!(dangling, "views.invalid");
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn removing_keeps_the_saved_query_unless_both_are_chosen() {
        let directory = tempfile::tempdir().unwrap();
        let searches = SavedSearchStore::new(directory.path());
        let first = searches.save(saved_search("First")).unwrap();
        let second = searches.save(saved_search("Second")).unwrap();
        let store = SmartFolderStore::new(directory.path());
        let keep = store.save(folder("Keep", &first.id)).unwrap();
        let both = store.save(folder("Both", &second.id)).unwrap();

        store.remove(&keep.id, false).unwrap();
        assert_eq!(searches.list().unwrap().len(), 2);

        store.remove(&both.id, true).unwrap();
        let left = searches.list().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, first.id);
    }

    #[test]
    fn the_catalog_stops_at_one_hundred_entries() {
        let directory = tempfile::tempdir().unwrap();
        let saved = SavedSearchStore::new(directory.path())
            .save(saved_search("Shared"))
            .unwrap();
        let store = SmartFolderStore::new(directory.path());
        for index in 0..MAX_SMART_FOLDERS {
            store
                .save(folder(&format!("Folder {index}"), &saved.id))
                .unwrap();
        }
        assert_eq!(store.list().unwrap().len(), MAX_SMART_FOLDERS);
        assert_eq!(
            store.save(folder("One more", &saved.id)).unwrap_err(),
            "views.invalid"
        );
    }

    #[test]
    fn a_foreign_or_oversized_catalog_is_refused_without_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("smart-folders.json");
        std::fs::write(&path, vec![b'{'; 256 * 1024 + 1]).unwrap();
        let before = std::fs::read(&path).unwrap();
        let store = SmartFolderStore::new(directory.path());
        assert_eq!(store.list().unwrap_err(), "views.invalid");
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
