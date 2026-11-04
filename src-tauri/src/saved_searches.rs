//! Saved search catalog (Step 11a decision 9 and E3). The catalog stores
//! queries only, never results or file content, at
//! `<profile>/saved-searches.json` schema 1.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use search_index::limits::{
    unix_now, MAX_SAVED_SEARCHES, MAX_SAVED_SEARCH_BYTES,
};
use search_index::types::SavedSearch;
use serde::{Deserialize, Serialize};

const CATALOG_SCHEMA: u32 = 1;

/// Commands build a fresh store per call, so the load-modify-write sequence
/// is serialized process-wide. Without it two concurrent saves read the same
/// catalog and the last writer drops the other entry.
static CATALOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedSearchCatalog {
    #[serde(default = "default_schema")]
    schema_version: u32,
    #[serde(default)]
    searches: Vec<SavedSearch>,
}

fn default_schema() -> u32 {
    CATALOG_SCHEMA
}

impl Default for SavedSearchCatalog {
    fn default() -> Self {
        Self {
            schema_version: CATALOG_SCHEMA,
            searches: Vec::new(),
        }
    }
}

pub struct SavedSearchStore {
    path: PathBuf,
}

fn catalog_lock() -> MutexGuard<'static, ()> {
    // A panic while holding the lock cannot corrupt the catalog: the file is
    // only replaced by an atomic write, so the next save may proceed.
    CATALOG_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl SavedSearchStore {
    pub fn new(profile_dir: &Path) -> Self {
        Self {
            path: profile_dir.join("saved-searches.json"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list(&self) -> Result<Vec<SavedSearch>, String> {
        Ok(self.load()?.searches)
    }

    pub fn save(&self, mut search: SavedSearch) -> Result<SavedSearch, String> {
        search.validate().map_err(|error| error.code().to_string())?;
        let _serialized = catalog_lock();
        let mut catalog = self.load()?;
        let now = unix_now();
        if let Some(existing) = catalog
            .searches
            .iter_mut()
            .find(|entry| entry.id == search.id)
        {
            search.created_unix = existing.created_unix;
            search.modified_unix = now;
            *existing = search.clone();
        } else {
            if catalog.searches.len() >= MAX_SAVED_SEARCHES {
                return Err("search.too_large".to_string());
            }
            search.created_unix = if search.created_unix == 0 {
                now
            } else {
                search.created_unix
            };
            search.modified_unix = now;
            catalog.searches.push(search.clone());
        }
        self.write(&catalog)?;
        Ok(search)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        search_index::types::validate_uuid(id)
            .map_err(|error| error.code().to_string())?;
        let _serialized = catalog_lock();
        let mut catalog = self.load()?;
        let before = catalog.searches.len();
        catalog.searches.retain(|entry| entry.id != id);
        if before != catalog.searches.len() {
            self.write(&catalog)?;
        }
        Ok(())
    }

    fn load(&self) -> Result<SavedSearchCatalog, String> {
        let metadata = match std::fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SavedSearchCatalog::default())
            }
            Err(_) => return Err("search.unavailable".to_string()),
        };
        if metadata.len() > MAX_SAVED_SEARCH_BYTES as u64 {
            return Err("search.too_large".to_string());
        }
        let bytes = std::fs::read(&self.path).map_err(|_| "search.unavailable".to_string())?;
        let catalog: SavedSearchCatalog =
            serde_json::from_slice(&bytes).map_err(|_| "search.failed".to_string())?;
        if catalog.schema_version != CATALOG_SCHEMA
            || catalog.searches.len() > MAX_SAVED_SEARCHES
            || catalog.searches.iter().any(|entry| entry.validate().is_err())
        {
            return Err("search.failed".to_string());
        }
        Ok(catalog)
    }

    fn write(&self, catalog: &SavedSearchCatalog) -> Result<(), String> {
        let bytes = serde_json::to_vec(catalog).map_err(|_| "search.failed".to_string())?;
        if bytes.len() > MAX_SAVED_SEARCH_BYTES {
            return Err("search.too_large".to_string());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "search.unavailable".to_string())?;
        }
        fs_service::atomic_write(&self.path, &bytes).map_err(|_| "search.unavailable".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::SavedSearchStore;
    use search_index::limits::MAX_SAVED_SEARCHES;
    use search_index::types::{SavedSearch, SearchMode, SearchQuery};

    fn search(name: &str) -> SavedSearch {
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

    #[test]
    fn save_list_and_remove_keep_queries_not_results() {
        let directory = tempfile::tempdir().unwrap();
        let store = SavedSearchStore::new(directory.path());
        let saved = store.save(search("Ports")).unwrap();
        assert!(saved.created_unix > 0);
        let listed = store.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].query.text, "port");
        store.remove(&saved.id).unwrap();
        assert!(store.list().unwrap().is_empty());
        store.remove(&saved.id).unwrap();
    }

    #[test]
    fn the_catalog_stops_at_one_hundred_entries() {
        let directory = tempfile::tempdir().unwrap();
        let store = SavedSearchStore::new(directory.path());
        for index in 0..MAX_SAVED_SEARCHES {
            store.save(search(&format!("Q{index}"))).unwrap();
        }
        assert_eq!(store.list().unwrap().len(), MAX_SAVED_SEARCHES);
        assert_eq!(
            store.save(search("one more")).unwrap_err(),
            "search.too_large"
        );
    }

    #[test]
    fn a_foreign_or_oversized_catalog_is_refused_without_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("saved-searches.json");
        std::fs::write(&path, vec![b'{'; 1024 * 1024 + 1]).unwrap();
        let before = std::fs::read(&path).unwrap();
        let store = SavedSearchStore::new(directory.path());
        assert!(store.list().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn concurrent_saves_keep_every_entry() {
        let directory = tempfile::tempdir().unwrap();
        let mut workers = Vec::new();
        for worker in 0..8 {
            let profile = directory.path().to_path_buf();
            workers.push(std::thread::spawn(move || {
                let store = SavedSearchStore::new(&profile);
                for entry in 0..4 {
                    store
                        .save(search(&format!("Q{worker}-{entry}")))
                        .unwrap();
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
        let store = SavedSearchStore::new(directory.path());
        assert_eq!(store.list().unwrap().len(), 8 * 4);
    }
}
