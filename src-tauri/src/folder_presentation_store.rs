//! Additive envelope over the existing legacy DTO, in the same file and lock.
use crate::folder_presentation_types::FolderPresentation;
use crate::folder_views::FolderViewsLock;
use crate::{ensure_main, validate_absolute_path};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::{Manager, WebviewWindow};

const MAX_BYTES: u64 = 4 * 1024 * 1024;
fn default_schema() -> u32 { fs_service::FOLDER_VIEWS_SCHEMA }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentedFolderView {
    #[serde(flatten)]
    pub legacy: fs_service::FolderView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<FolderPresentation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationStore {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub folders: Vec<PresentedFolderView>,
}
impl Default for PresentationStore {
    fn default() -> Self { Self { schema_version: fs_service::FOLDER_VIEWS_SCHEMA, folders: Vec::new() } }
}
// Reuse the public legacy comparison, rather than importing its private helpers
// or creating a second Windows path-normalization implementation.
fn matches_path(entry: &PresentedFolderView, path: &str) -> bool {
    fs_service::FolderViews { schema_version: fs_service::FOLDER_VIEWS_SCHEMA, folders: vec![entry.legacy.clone()] }.get(path).is_some()
}
impl PresentationStore {
    pub fn load(path: &Path) -> Result<Self, String> {
        let mut bytes = Vec::new();
        match File::open(path) {
            Ok(file) => { file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "presentation.io")?; }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("presentation.io".into()),
        }
        if bytes.len() as u64 > MAX_BYTES { return Err("presentation.invalid".into()); }
        let mut store: Self = serde_json::from_slice(&bytes).map_err(|_| "presentation.invalid")?;
        if store.schema_version != fs_service::FOLDER_VIEWS_SCHEMA { return Err("presentation.invalid".into()); }
        store.folders.sort_by_key(|entry| std::cmp::Reverse(entry.legacy.used_unix));
        let legacy = fs_service::FolderViews {
            schema_version: store.schema_version,
            folders: store.folders.iter().map(|entry| entry.legacy.clone()).collect(),
        }.normalized();
        let mut retained: HashSet<String> = legacy.folders.into_iter().map(|entry| entry.path).collect();
        store.folders.retain(|entry| retained.remove(&entry.legacy.path));
        for entry in &store.folders { if let Some(value) = &entry.presentation { value.validate()?; } }
        Ok(store)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if self.schema_version != fs_service::FOLDER_VIEWS_SCHEMA || self.folders.len() > fs_service::MAX_FOLDER_VIEWS { return Err("presentation.invalid".into()); }
        for entry in &self.folders {
            check_path(&entry.legacy.path)?;
            if entry.legacy.path.chars().count() > fs_service::MAX_FOLDER_VIEW_PATH || !fs_service::is_view_mode(&entry.legacy.mode) { return Err("presentation.invalid".into()); }
            if let Some(value) = &entry.presentation { value.validate()?; }
        }
        let bytes = serde_json::to_vec(self).map_err(|_| "presentation.invalid")?;
        if bytes.len() as u64 > MAX_BYTES { return Err("presentation.invalid".into()); }
        fs_service::atomic_write(path, &bytes).map_err(|_| "presentation.io".into())
    }
    pub fn get(&self, path: &str) -> Option<FolderPresentation> {
        self.folders.iter().find(|entry| matches_path(entry, path))
            .map(|entry| entry.presentation.clone().unwrap_or_else(|| FolderPresentation::legacy(&entry.legacy.mode)))
    }
    pub fn set(&mut self, path: &str, value: FolderPresentation, now: u64) -> Result<(), String> {
        value.validate()?;
        if path.chars().count() > fs_service::MAX_FOLDER_VIEW_PATH { return Ok(()); }
        let mut legacy = fs_service::FolderViews::default();
        if !legacy.set(path, &value.view_mode, now) { return Err("presentation.invalid".into()); }
        let entry = legacy.folders.pop().ok_or("presentation.invalid")?;
        self.folders.retain(|entry| !matches_path(entry, path));
        self.folders.insert(0, PresentedFolderView { legacy: entry, presentation: Some(value) });
        self.folders.truncate(fs_service::MAX_FOLDER_VIEWS);
        Ok(())
    }
}
fn check_path(path: &str) -> Result<(), String> {
    if path.encode_utf16().count() > 32768 { return Err("presentation.invalid".into()); }
    validate_absolute_path(path).map_err(|_| "presentation.invalid".into())
}
#[tauri::command]
pub async fn folder_presentation_get(window: WebviewWindow, path: String) -> Result<Option<FolderPresentation>, String> {
    ensure_main(window.label())?;
    check_path(&path)?;
    if path.chars().count() > fs_service::MAX_FOLDER_VIEW_PATH { return Ok(None); }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock.lock.lock().map_err(|_| "presentation.io")?;
        let file = app.state::<crate::AppState>().data_dir.join("folder-views.json");
        Ok(PresentationStore::load(&file)?.get(&path))
    }).await.map_err(|_| "presentation.io".to_string())?
}
#[tauri::command]
pub async fn folder_presentation_set(window: WebviewWindow, path: String, presentation: FolderPresentation) -> Result<(), String> {
    ensure_main(window.label())?;
    check_path(&path)?;
    presentation.validate()?;
    if path.chars().count() > fs_service::MAX_FOLDER_VIEW_PATH { return Ok(()); }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock.lock.lock().map_err(|_| "presentation.io")?;
        let file = app.state::<crate::AppState>().data_dir.join("folder-views.json");
        let mut store = PresentationStore::load(&file)?;
        store.set(&path, presentation, crate::unix_now())?;
        store.save(&file)
    }).await.map_err(|_| "presentation.io".to_string())?
}
#[tauri::command]
pub async fn folder_presentation_clear(window: WebviewWindow) -> Result<(), String> {
    ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<FolderViewsLock>();
        let _guard = lock.lock.lock().map_err(|_| "presentation.io")?;
        let file = app.state::<crate::AppState>().data_dir.join("folder-views.json");
        // Read first: never downgrade an unknown/newer or corrupt store.
        let mut store = PresentationStore::load(&file)?;
        store.folders.clear();
        store.save(&file)
    }).await.map_err(|_| "presentation.io".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn long_path_not_persisted_but_browsable() {
        let mut store = PresentationStore::default();
        let path = format!("C:\\{}", "a".repeat(1100));
        assert!(check_path(&path).is_ok());
        store.set(&path, FolderPresentation::legacy("list"), 1).unwrap();
        assert!(store.folders.is_empty());
    }
    #[test] fn legacy_mode_retained() {
        let store: PresentationStore = serde_json::from_str(r#"{"schema_version":1,"folders":[{"path":"C:\\A","mode":"list","used_unix":7}]}"#).unwrap();
        assert_eq!(store.get(r"C:\A\").unwrap().view_mode, "list");
        assert_eq!(store.folders[0].legacy.used_unix, 7);
    }
    #[test] fn normalized_folder_key_updates_one_entry() {
        let mut store = PresentationStore::default();
        store.set(r"C:\Pictures", FolderPresentation::legacy("list"), 1).unwrap();
        store.set(r"\\?\C:\PICTURES\", FolderPresentation::legacy("details"), 2).unwrap();
        assert_eq!(store.folders.len(), 1);
        assert_eq!(store.get(r"c:\pictures").unwrap().view_mode, "details");
    }
    #[test] fn one_thousand_entries_newest_first() {
        let mut store = PresentationStore::default();
        for index in 0..1001 { store.set(&format!(r"C:\{index}"), FolderPresentation::legacy("list"), index).unwrap(); }
        assert_eq!(store.folders.len(), 1000);
        assert_eq!(store.folders[0].legacy.used_unix, 1000);
        assert!(store.get(r"C:\0").is_none());
    }
    #[test] fn atomic_round_trip_retains_legacy_and_presentation() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("folder-views.json");
        let mut store = PresentationStore::default();
        let mut value = FolderPresentation::legacy("details");
        value.group_by = crate::folder_presentation_types::GroupBy::Size;
        store.set(r"C:\A", value.clone(), 7).unwrap(); store.save(&file).unwrap();
        let loaded = PresentationStore::load(&file).unwrap();
        assert_eq!(loaded.get(r"c:\a").unwrap(), value);
        assert_eq!(loaded.folders[0].legacy.used_unix, 7);
    }
    #[test] fn newer_schema_is_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("folder-views.json");
        let bytes = br#"{"schema_version":2,"folders":[]}"#;
        std::fs::write(&file, bytes).unwrap();
        assert!(PresentationStore::load(&file).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), bytes.to_vec());
    }
    #[test] fn four_mib_plus_one_refused() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("folder-views.json");
        std::fs::write(&file, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(PresentationStore::load(&file).unwrap_err(), "presentation.invalid");
    }
    #[test] fn invalid_save_keeps_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("folder-views.json");
        let mut store = PresentationStore::default();
        store.set(r"C:\A", FolderPresentation::legacy("list"), 1).unwrap();
        store.save(&file).unwrap();
        let original = std::fs::read(&file).unwrap();
        store.folders[0].presentation.as_mut().unwrap().columns[0].width = 1;
        assert_eq!(store.save(&file).unwrap_err(), "presentation.invalid");
        assert_eq!(std::fs::read(&file).unwrap(), original);
    }
}
