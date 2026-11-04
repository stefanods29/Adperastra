//! Step 10d native folder customization catalog and column sets.
//!
//! One bounded JSON document lives in the active profile folder. Every
//! mutation is read-modify-write under one lock and published with a single
//! atomic replace. No command here writes a user folder, desktop.ini, the
//! registry or a Windows attribute. Image icons/backgrounds are refused:
//! there is no owned-asset import/lease authority yet, so colours, static
//! icons, emoji and column sets are the parts that are real.

use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fs_service::FileIdentityKey;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::column_sets::validate_column_set;
use crate::folder_customization_types::{
    canonical_uuid, is_rgb, BackgroundKind, ColumnSet, FolderBackground, FolderCustomization,
    FolderCustomizeFailure, FolderCustomizeRequest, FolderCustomizeResult, FolderDecoration,
    FolderIcon, FolderScope,
};
use crate::jobs::{spawn_job, Jobs};

pub const CATALOG_SCHEMA: u32 = 1;
pub const MAX_FOLDERS: usize = 10_000;
pub const MAX_COLUMN_SETS: usize = 100;
pub const MAX_CATALOG_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_CUSTOMIZE_PATHS: usize = 1_000;
pub const MAX_DECORATION_PATHS: usize = 256;
pub const MAX_FAILURES: usize = 256;
pub const MAX_ANCESTOR_DEPTH: usize = 256;
const MAX_WARNING_CODES: usize = 8;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const STORE_FILE: &str = "folder-customization.json";

fn catalog_schema() -> u32 {
    CATALOG_SCHEMA
}

/// The one lock for the catalog document.
#[derive(Default)]
pub struct FolderCustomizationLock {
    pub lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderCustomizationStore {
    #[serde(default = "catalog_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub folders: Vec<FolderCustomization>,
    #[serde(default)]
    pub column_sets: Vec<ColumnSet>,
}

impl Default for FolderCustomizationStore {
    fn default() -> Self {
        Self {
            schema_version: CATALOG_SCHEMA,
            folders: Vec::new(),
            column_sets: Vec::new(),
        }
    }
}

impl FolderCustomizationStore {
    pub fn load(path: &Path) -> Result<Self, String> {
        let mut bytes = Vec::new();
        match File::open(path) {
            Ok(file) => {
                file.take(MAX_CATALOG_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "folder_custom.io")?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(_) => return Err("folder_custom.io".into()),
        }
        if bytes.len() as u64 > MAX_CATALOG_BYTES {
            return Err("folder_custom.limit".into());
        }
        let store: Self =
            serde_json::from_slice(&bytes).map_err(|_| "folder_custom.invalid")?;
        store.validate()?;
        Ok(store)
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| "folder_custom.invalid")?;
        if bytes.len() as u64 > MAX_CATALOG_BYTES {
            return Err("folder_custom.limit".into());
        }
        fs_service::atomic_write(path, &bytes).map_err(|_| "folder_custom.io".into())
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != CATALOG_SCHEMA {
            return Err("folder_custom.invalid".into());
        }
        if self.folders.len() > MAX_FOLDERS || self.column_sets.len() > MAX_COLUMN_SETS {
            return Err("folder_custom.limit".into());
        }
        let mut set_ids = HashSet::new();
        for set in &self.column_sets {
            validate_column_set(set)?;
            if !set_ids.insert(set.id.clone()) {
                return Err("folder_custom.invalid".into());
            }
        }
        let mut identities = HashSet::new();
        let mut paths = HashSet::new();
        for record in &self.folders {
            validate_record(record, &set_ids)?;
            if !identities.insert(record_identity(record))
                || !paths.insert(record.key.path_key.as_str())
            {
                return Err("folder_custom.invalid".into());
            }
        }
        Ok(())
    }

    /// One decoration per input path, in the same order. Reads only the
    /// catalog and directory metadata; no user file content is opened.
    pub fn decorations(&self, paths: &[String]) -> Vec<FolderDecoration> {
        paths.iter().map(|path| self.decoration(path)).collect()
    }

    pub fn customize(
        &mut self,
        request: &FolderCustomizeRequest,
        now: u64,
    ) -> Result<FolderCustomizeResult, String> {
        validate_customize_request(request)?;
        let set_ids = self.set_ids();
        if let Some(id) = &request.patch.column_set_id {
            if !set_ids.contains(id) {
                return Err("folder_custom.invalid".into());
            }
        }
        let mut folders = self.folders.clone();
        let mut failures = Vec::new();
        let mut failure_count = 0usize;
        let mut changed_count = 0u32;
        for (path, expected) in request.paths.iter().zip(&request.expected_keys) {
            let current = match capture_identity(path) {
                Ok(key) => key,
                Err(code) => {
                    failure_count += 1;
                    push_failure(&mut failures, path, &code);
                    continue;
                }
            };
            if !identity_matches(&current, expected) {
                failure_count += 1;
                push_failure(&mut failures, path, "folder_custom.changed");
                continue;
            }
            let index = find_write_index(&folders, &current);
            let mut record = index
                .map(|index| folders.remove(index))
                .unwrap_or_else(|| new_record(&current, path, now));
            // A replaced folder at the same path, or a duplicate identity
            // reached through an alias, must not survive as a second record.
            folders.retain(|existing| !record_matches(existing, &current));
            record.key = current;
            record.display_path = path.clone();
            record.apply_patch(&request.patch);
            record.modified_unix = now;
            validate_record_shape(&record, &set_ids)?;
            folders.insert(0, record);
            changed_count += 1;
        }
        if folders.len() > MAX_FOLDERS {
            return Err("folder_custom.limit".into());
        }
        if changed_count > 0 {
            self.folders = folders;
        }
        Ok(customize_result(changed_count, failure_count, failures))
    }

    pub fn reset(
        &mut self,
        paths: &[String],
        expected_keys: &[FileIdentityKey],
    ) -> Result<FolderCustomizeResult, String> {
        let path_keys = validate_paths(paths, MAX_CUSTOMIZE_PATHS, true)?;
        validate_expected(&path_keys, expected_keys)?;
        let mut folders = self.folders.clone();
        let mut failures = Vec::new();
        let mut failure_count = 0usize;
        let mut removed_count = 0u32;
        for (path, expected) in paths.iter().zip(expected_keys) {
            let current = match capture_identity(path) {
                Ok(key) => key,
                Err(code) => {
                    failure_count += 1;
                    push_failure(&mut failures, path, &code);
                    continue;
                }
            };
            if !identity_matches(&current, expected) {
                failure_count += 1;
                push_failure(&mut failures, path, "folder_custom.changed");
                continue;
            }
            let before = folders.len();
            folders.retain(|record| !record_matches(record, &current));
            removed_count += (before - folders.len()) as u32;
        }
        if removed_count > 0 {
            self.folders = folders;
        }
        Ok(customize_result(removed_count, failure_count, failures))
    }

    pub fn column_sets_sorted(&self) -> Vec<ColumnSet> {
        let mut sets = self.column_sets.clone();
        sets.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        sets
    }

    pub fn save_column_set(&mut self, value: ColumnSet) -> Result<ColumnSet, String> {
        validate_column_set(&value)?;
        if let Some(existing) = self
            .column_sets
            .iter_mut()
            .find(|set| set.id == value.id)
        {
            *existing = value.clone();
        } else {
            if self.column_sets.len() >= MAX_COLUMN_SETS {
                return Err("folder_custom.limit".into());
            }
            self.column_sets.push(value.clone());
        }
        Ok(value)
    }

    pub fn remove_column_set(&mut self, id: &str) -> Result<(), String> {
        if !canonical_uuid(id) {
            return Err("folder_custom.invalid".into());
        }
        self.column_sets.retain(|set| set.id.as_str() != id);
        // Assignments are cleared in the same save, so no record points at a
        // deleted set.
        for record in &mut self.folders {
            if record.column_set_id.as_deref() == Some(id) {
                record.column_set_id = None;
            }
        }
        Ok(())
    }

    fn set_ids(&self) -> HashSet<String> {
        self.column_sets
            .iter()
            .map(|set| set.id.clone())
            .collect()
    }

    fn column_set(&self, id: &str) -> Option<ColumnSet> {
        self.column_sets
            .iter()
            .find(|set| set.id == id)
            .cloned()
    }

    fn decoration(&self, path: &str) -> FolderDecoration {
        let path_key = fs_service::path_key_of(Path::new(path)).unwrap_or_default();
        if !std::fs::metadata(Path::new(path))
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
            || is_reparse_boundary(Path::new(path))
            || has_reparse_ancestor(Path::new(path))
        {
            return FolderDecoration {
                color: None,
                icon: FolderIcon::Default,
                background: None,
                column_set: None,
                inherited_from: None,
                warning_codes: Vec::new(),
            };
        }
        let captured = capture_identity(path).ok();
        let mut warnings = Vec::new();
        if !captured.as_ref().is_some_and(|key| key.stable) {
            push_warning(&mut warnings, "unstable");
        }
        let exact = match &captured {
            Some(key) => self.find_exact(key),
            None => self
                .folders
                .iter()
                .find(|record| record.key.path_key == path_key),
        };
        if let Some(record) = exact {
            let mut value = self.exact_decoration(record);
            merge_warnings(&mut warnings, &mut value.warning_codes);
            value.warning_codes = warnings;
            return value;
        }
        if let Some(mut value) = self.inherited_decoration(path) {
            merge_warnings(&mut warnings, &mut value.warning_codes);
            value.warning_codes = warnings;
            return value;
        }
        FolderDecoration {
            color: None,
            icon: FolderIcon::Default,
            background: None,
            column_set: None,
            inherited_from: None,
            warning_codes: warnings,
        }
    }

    fn exact_decoration(&self, record: &FolderCustomization) -> FolderDecoration {
        let mut warning_codes = Vec::new();
        let column_set = record.column_set_id.as_ref().and_then(|id| {
            let set = self.column_set(id);
            if set.is_none() {
                push_warning(&mut warning_codes, "column_set_missing");
            }
            set
        });
        FolderDecoration {
            color: record.color.clone(),
            icon: record.icon.clone(),
            background: visible_background(&record.background),
            column_set,
            inherited_from: None,
            warning_codes,
        }
    }

    /// Nearest ancestors supply only the fields they explicitly inherit:
    /// colour/icon/column set with `scope=subtree`, background with
    /// `background.inherit`. A path field from different ancestors can combine.
    fn inherited_decoration(&self, path: &str) -> Option<FolderDecoration> {
        let mut color = None;
        let mut icon = None;
        let mut background = None;
        let mut column_set = None;
        let mut missing_column_set = false;
        let mut inherited_from = None;
        let mut current = Path::new(path);
        for _ in 0..MAX_ANCESTOR_DEPTH {
            let parent = match current.parent() {
                Some(parent) if parent != current => parent,
                _ => break,
            };
            if is_reparse_boundary(parent) {
                break;
            }
            let key = match fs_service::path_key_of(parent) {
                Ok(key) => key,
                Err(_) => break,
            };
            if let Some(record) = self
                .folders
                .iter()
                .find(|record| record.key.path_key == key)
            {
                let subtree = matches!(record.scope, FolderScope::Subtree);
                let mut contributed = false;
                if subtree {
                    if color.is_none() {
                        if let Some(value) = &record.color {
                            color = Some(value.clone());
                            contributed = true;
                        }
                    }
                    if icon.is_none() && !matches!(&record.icon, FolderIcon::Default) {
                        icon = Some(record.icon.clone());
                        contributed = true;
                    }
                    if column_set.is_none() {
                        if let Some(id) = &record.column_set_id {
                            match self.column_set(id) {
                                Some(set) => column_set = Some(set),
                                None => missing_column_set = true,
                            }
                            contributed = true;
                        }
                    }
                }
                if background.is_none()
                    && record.background.inherit
                    && !matches!(record.background.kind, BackgroundKind::None)
                {
                    background = Some(record.background.clone());
                    contributed = true;
                }
                if contributed && inherited_from.is_none() {
                    inherited_from = Some(record.display_path.clone());
                }
                if color.is_some()
                    && icon.is_some()
                    && background.is_some()
                    && column_set.is_some()
                {
                    break;
                }
            }
            current = parent;
        }
        inherited_from.map(|inherited_from| {
            let mut warning_codes = Vec::new();
            if missing_column_set && column_set.is_none() {
                push_warning(&mut warning_codes, "column_set_missing");
            }
            FolderDecoration {
                color,
                icon: icon.unwrap_or(FolderIcon::Default),
                background,
                column_set,
                inherited_from: Some(inherited_from),
                warning_codes,
            }
        })
    }

    fn find_exact(&self, key: &FileIdentityKey) -> Option<&FolderCustomization> {
        if key.stable {
            self.folders
                .iter()
                .find(|record| record.key.stable && same_stable_id(&record.key, key))
                .or_else(|| {
                    self.folders
                        .iter()
                        .find(|record| !record.key.stable && record.key.path_key == key.path_key)
                })
        } else {
            self.folders
                .iter()
                .find(|record| record.key.path_key == key.path_key)
        }
    }
}

fn visible_background(background: &FolderBackground) -> Option<FolderBackground> {
    if matches!(background.kind, BackgroundKind::None) {
        None
    } else {
        Some(background.clone())
    }
}

fn same_stable_id(left: &FileIdentityKey, right: &FileIdentityKey) -> bool {
    left.volume_id == right.volume_id && left.file_id == right.file_id
}

fn record_identity(record: &FolderCustomization) -> String {
    if record.key.stable {
        format!("id:{}:{}", record.key.volume_id, record.key.file_id)
    } else {
        format!("path:{}", record.key.path_key)
    }
}

/// A record applies to the current folder identity, or to the same path when
/// the identity is unstable. Stale records for a replacement folder at the
/// same path are also matched so a write can replace them.
fn record_matches(record: &FolderCustomization, key: &FileIdentityKey) -> bool {
    record.key.path_key == key.path_key
        || (record.key.stable && key.stable && same_stable_id(&record.key, key))
}

fn find_write_index(folders: &[FolderCustomization], key: &FileIdentityKey) -> Option<usize> {
    folders
        .iter()
        .position(|record| record.key.stable && key.stable && same_stable_id(&record.key, key))
        .or_else(|| {
            folders
                .iter()
                .position(|record| !record.key.stable && record.key.path_key == key.path_key)
        })
        .or_else(|| {
            folders
                .iter()
                .position(|record| record.key.path_key == key.path_key)
        })
}

fn new_record(key: &FileIdentityKey, path: &str, now: u64) -> FolderCustomization {
    FolderCustomization {
        key: key.clone(),
        display_path: path.to_string(),
        color: None,
        icon: FolderIcon::Default,
        background: FolderBackground::default(),
        column_set_id: None,
        scope: FolderScope::Exact,
        modified_unix: now,
    }
}

fn customize_result(
    changed_count: u32,
    failure_count: usize,
    mut failures: Vec<FolderCustomizeFailure>,
) -> FolderCustomizeResult {
    let complete = failure_count <= MAX_FAILURES;
    failures.truncate(MAX_FAILURES);
    FolderCustomizeResult {
        changed_count,
        windows_applied_count: 0,
        failures,
        next_cursor: None,
        history_id: Uuid::new_v4().to_string(),
        complete,
    }
}

fn push_failure(failures: &mut Vec<FolderCustomizeFailure>, path: &str, code: &str) {
    if failures.len() < MAX_FAILURES {
        failures.push(FolderCustomizeFailure {
            path: path.to_string(),
            code: code.to_string(),
        });
    }
}

fn push_warning(codes: &mut Vec<String>, code: &str) {
    if codes.len() < MAX_WARNING_CODES && !codes.iter().any(|existing| existing == code) {
        codes.push(code.to_string());
    }
}

fn merge_warnings(target: &mut Vec<String>, source: &mut Vec<String>) {
    for code in source.drain(..) {
        push_warning(target, &code);
    }
}

#[cfg(windows)]
fn is_reparse_boundary(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_reparse_boundary(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn has_reparse_ancestor(path: &Path) -> bool {
    let mut current = path;
    while let Some(parent) = current.parent() {
        if parent == current {
            break;
        }
        if is_reparse_boundary(parent) {
            return true;
        }
        current = parent;
    }
    false
}

fn capture_identity(path: &str) -> Result<FileIdentityKey, String> {
    if has_reparse_ancestor(Path::new(path)) {
        return Err("folder_custom.unsupported".into());
    }
    match std::fs::metadata(Path::new(path)) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err("folder_custom.unsupported".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("folder_custom.changed".into())
        }
        Err(_) => return Err("folder_custom.changed".into()),
    }
    match fs_service::capture_file_identity(Path::new(path)) {
        Ok(key) => {
            validate_identity_key(&key)?;
            Ok(key)
        }
        Err(fs_service::owned_io::OwnedIoError::ReparseRefused) => {
            Err("folder_custom.unsupported".into())
        }
        Err(_) => Err("folder_custom.changed".into()),
    }
}

fn identity_matches(current: &FileIdentityKey, expected: &FileIdentityKey) -> bool {
    if current.path_key != expected.path_key {
        return false;
    }
    if current.stable && expected.stable {
        return same_stable_id(current, expected);
    }
    true
}

pub fn validate_identity_key(key: &FileIdentityKey) -> Result<(), String> {
    if !is_lower_hex(&key.volume_id, 8) || !is_lower_hex(&key.file_id, 16) {
        return Err("folder_custom.invalid".into());
    }
    let normalized = fs_service::path_key_of(Path::new(&key.path_key))
        .map_err(|_| "folder_custom.invalid")?;
    if normalized != key.path_key {
        return Err("folder_custom.invalid".into());
    }
    if key.stable
        && (key.volume_id == "00000000" || key.file_id == "0000000000000000")
    {
        return Err("folder_custom.invalid".into());
    }
    Ok(())
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn check_path(path: &str) -> Result<String, String> {
    crate::validate_absolute_path(path).map_err(|_| "folder_custom.invalid")?;
    fs_service::path_key_of(Path::new(path)).map_err(|_| "folder_custom.invalid".into())
}

fn validate_paths(
    paths: &[String],
    max: usize,
    unique: bool,
) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > max {
        return Err("folder_custom.invalid".into());
    }
    let mut keys = Vec::with_capacity(paths.len());
    let mut seen = HashSet::new();
    for path in paths {
        let key = check_path(path)?;
        if unique && !seen.insert(key.clone()) {
            return Err("folder_custom.invalid".into());
        }
        keys.push(key);
    }
    Ok(keys)
}

fn validate_expected(
    path_keys: &[String],
    expected_keys: &[FileIdentityKey],
) -> Result<(), String> {
    if path_keys.len() != expected_keys.len() {
        return Err("folder_custom.invalid".into());
    }
    for (path_key, expected) in path_keys.iter().zip(expected_keys) {
        validate_identity_key(expected)?;
        if &expected.path_key != path_key {
            return Err("folder_custom.changed".into());
        }
    }
    Ok(())
}

fn validate_customize_request(request: &FolderCustomizeRequest) -> Result<(), String> {
    let path_keys = validate_paths(&request.paths, MAX_CUSTOMIZE_PATHS, true)?;
    validate_expected(&path_keys, &request.expected_keys)?;
    request.patch.validate()?;
    if request.apply_windows {
        return Err("folder_custom.windows_unavailable".into());
    }
    Ok(())
}

fn validate_record(
    record: &FolderCustomization,
    set_ids: &HashSet<String>,
) -> Result<(), String> {
    validate_identity_key(&record.key)?;
    if check_path(&record.display_path)? != record.key.path_key {
        return Err("folder_custom.invalid".into());
    }
    validate_record_shape(record, set_ids)
}

fn validate_record_shape(
    record: &FolderCustomization,
    set_ids: &HashSet<String>,
) -> Result<(), String> {
    if record.modified_unix > MAX_SAFE_JSON_INTEGER {
        return Err("folder_custom.invalid".into());
    }
    if let Some(color) = &record.color {
        if !is_rgb(color) {
            return Err("folder_custom.invalid".into());
        }
    }
    record.icon.validate()?;
    record.background.validate()?;
    if let Some(id) = &record.column_set_id {
        if !canonical_uuid(id) || !set_ids.contains(id) {
            return Err("folder_custom.invalid".into());
        }
    }
    Ok(())
}

fn store_path(app: &tauri::AppHandle) -> PathBuf {
    app.state::<crate::AppState>()
        .data_dir()
        .join(STORE_FILE)
}

#[tauri::command]
pub async fn folder_decorations(
    window: WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<FolderDecoration>, String> {
    crate::ensure_main(window.label())?;
    validate_paths(&paths, MAX_DECORATION_PATHS, false)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FolderCustomizationLock>();
        let _guard = state.lock.lock().map_err(|_| "folder_custom.io")?;
        let store = FolderCustomizationStore::load(&store_path(&app))?;
        Ok(store.decorations(&paths))
    })
    .await
    .map_err(|_| "folder_custom.io".to_string())?
}

#[tauri::command]
pub async fn folder_customize_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: FolderCustomizeRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_customize_request(&request)?;
    let total = request.paths.len();
    let token = jobs.begin(&request_id, total)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |_context| {
        let lock = _context.app().state::<FolderCustomizationLock>();
        let _guard = lock.lock.lock().map_err(|_| "folder_custom.io")?;
        let file = store_path(_context.app());
        let mut store = FolderCustomizationStore::load(&file)?;
        let result = store.customize(&request, crate::unix_now())?;
        if result.changed_count > 0 {
            store.save(&file)?;
        }
        serde_json::to_value(result).map_err(|_| "folder_custom.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn folder_reset_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    request_id: String,
    paths: Vec<String>,
    expected_keys: Vec<FileIdentityKey>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let path_keys = validate_paths(&paths, MAX_CUSTOMIZE_PATHS, true)?;
    validate_expected(&path_keys, &expected_keys)?;
    let total = paths.len();
    let token = jobs.begin(&request_id, total)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |_context| {
        let lock = _context.app().state::<FolderCustomizationLock>();
        let _guard = lock.lock.lock().map_err(|_| "folder_custom.io")?;
        let file = store_path(_context.app());
        let mut store = FolderCustomizationStore::load(&file)?;
        let result = store.reset(&paths, &expected_keys)?;
        if result.changed_count > 0 {
            store.save(&file)?;
        }
        serde_json::to_value(result).map_err(|_| "folder_custom.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn column_sets_list(window: WebviewWindow) -> Result<Vec<ColumnSet>, String> {
    crate::ensure_main(window.label())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FolderCustomizationLock>();
        let _guard = state.lock.lock().map_err(|_| "folder_custom.io")?;
        let store = FolderCustomizationStore::load(&store_path(&app))?;
        Ok(store.column_sets_sorted())
    })
    .await
    .map_err(|_| "folder_custom.io".to_string())?
}

#[tauri::command]
pub async fn column_set_save(
    window: WebviewWindow,
    value: ColumnSet,
) -> Result<ColumnSet, String> {
    crate::ensure_main(window.label())?;
    validate_column_set(&value)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FolderCustomizationLock>();
        let _guard = state.lock.lock().map_err(|_| "folder_custom.io")?;
        let file = store_path(&app);
        let mut store = FolderCustomizationStore::load(&file)?;
        let saved = store.save_column_set(value)?;
        store.save(&file)?;
        Ok(saved)
    })
    .await
    .map_err(|_| "folder_custom.io".to_string())?
}

#[tauri::command]
pub async fn column_set_remove(window: WebviewWindow, id: String) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if !canonical_uuid(&id) {
        return Err("folder_custom.invalid".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FolderCustomizationLock>();
        let _guard = state.lock.lock().map_err(|_| "folder_custom.io")?;
        let file = store_path(&app);
        let mut store = FolderCustomizationStore::load(&file)?;
        store.remove_column_set(&id)?;
        store.save(&file)
    })
    .await
    .map_err(|_| "folder_custom.io".to_string())?
}
