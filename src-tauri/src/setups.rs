//! Native setup-file commands (Step 10e, setup-file-1).
//! Preview reads and quarantines a bounded archive; Apply revalidates every
//! explicitly selected part, then writes the supported parts through the
//! concrete adapter registry and its durable journal; Export publishes with
//! owned no-replace I/O.

use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Mutex, MutexGuard};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use crate::jobs::{spawn_job, Jobs};
use crate::keyboard_map_types::KeyboardMap;
use crate::setup_archive::{
    read_quarantine, read_setup_archive, remove_quarantine, write_quarantine, SetupArchiveContents,
};
use crate::setup_export::write_setup_archive;
use crate::setup_adapters::{unsupported_warning, SetupAdapterRegistry, UNSUPPORTED};
use crate::setup_transaction::{run_setup_transaction, SetupPlanPart};
use crate::setup_types::{
    is_canonical_uuid, validate_apply_request, SetupApplyRequest, SetupApplyResult, SetupPart,
    SetupPreview, SETUP_PARTS,
};
use crate::setup_validation::{
    build_export_manifest, build_preview, encode_part, strip_personal_paths, validate_part,
    PartData,
};
use crate::{ensure_main, unix_now, valid_request_id, validate_absolute_path, AppState, Settings};
const PREVIEW_TTL_SECS: u64 = 300;
const SETUP_EXTENSION: &str = ".adperastra-setup";
const MAX_DIALOG_TEXT: usize = 200;
const UNAVAILABLE: &str = "setup.unavailable";
const CANCELLED: &str = "setup.cancelled";

#[derive(Clone)]
struct PreviewEntry {
    preview: SetupPreview,
    quarantine: PathBuf,
    base_dir: PathBuf,
}

/// Immutable previews and their owned quarantine directories.
#[derive(Default)]
pub struct SetupPreviews {
    entries: Mutex<HashMap<String, PreviewEntry>>,
}

impl SetupPreviews {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, PreviewEntry>>, String> {
        self.entries.lock().map_err(|_| "setup.io".to_string())
    }

    fn prune(entries: &mut HashMap<String, PreviewEntry>) -> Vec<PreviewEntry> {
        let now = unix_now();
        let stale: Vec<String> = entries
            .iter()
            .filter(|(_, entry)| entry.preview.expires_unix <= now)
            .map(|(id, _)| id.clone())
            .collect();
        stale
            .into_iter()
            .filter_map(|id| entries.remove(&id))
            .collect()
    }

    fn cleanup(entry: &PreviewEntry) {
        let _ = remove_quarantine(&entry.base_dir, &entry.preview.preview_id, false);
    }

    fn insert(&self, entry: PreviewEntry) -> Result<(), String> {
        let (expired, duplicate) = {
            let mut entries = self.lock()?;
            let expired = Self::prune(&mut entries);
            let duplicate = match entries.entry(entry.preview.preview_id.clone()) {
                std::collections::hash_map::Entry::Occupied(_) => true,
                std::collections::hash_map::Entry::Vacant(slot) => {
                    slot.insert(entry);
                    false
                }
            };
            (expired, duplicate)
        };
        for stale in expired {
            Self::cleanup(&stale);
        }
        if duplicate {
            return Err("setup.invalid".to_string());
        }
        Ok(())
    }

    fn get(&self, preview_id: &str) -> Result<PreviewEntry, String> {
        let mut entries = self.lock()?;
        let expired = match entries.get(preview_id) {
            Some(entry) => entry.preview.expires_unix <= unix_now(),
            None => false,
        };
        if expired {
            let removed = entries.remove(preview_id);
            drop(entries);
            if let Some(expired) = removed {
                Self::cleanup(&expired);
            }
            return Err("setup.changed".to_string());
        }
        let Some(entry) = entries.get(preview_id) else {
            return Err("setup.invalid".to_string());
        };
        Ok(entry.clone())
    }

    fn release(&self, preview_id: &str) -> Result<(), String> {
        let entry = self.lock()?.remove(preview_id);
        match entry {
            Some(entry) => remove_quarantine(&entry.base_dir, preview_id, false),
            None => Ok(()),
        }
    }
}

fn cancelled(context: &crate::jobs::JobContext) -> bool {
    let token = context.token();
    token.load(std::sync::atomic::Ordering::Relaxed)
}

fn check_setup_extension(path: &str) -> Result<(), String> {
    if !path.to_ascii_lowercase().ends_with(SETUP_EXTENSION) {
        return Err("setup.invalid".to_string());
    }
    Ok(())
}

fn check_dialog_text(title: &str, filter_name: &str) -> Result<(), String> {
    if title.trim().is_empty()
        || title.chars().count() > MAX_DIALOG_TEXT
        || filter_name.trim().is_empty()
        || filter_name.chars().count() > MAX_DIALOG_TEXT
    {
        return Err("setup.invalid".to_string());
    }
    Ok(())
}

/// Shows Windows' open dialog for exactly one `.adperastra-setup` file and
/// returns the chosen absolute path. A cancelled dialog is `None`; the
/// preview command revalidates the path and extension before reading.
#[tauri::command]
pub async fn setup_pick_import(
    window: WebviewWindow,
    title: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    check_dialog_text(&title, &filter_name)?;
    let owner = crate::window_handle(&window);
    let pattern = format!("*{SETUP_EXTENSION}");
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, &pattern)
            .map_err(|_| "setup.other".to_string())
    })
    .await
    .map_err(|_| "setup.other".to_string())??;
    let Some(path) = chosen else {
        return Ok(None);
    };
    validate_absolute_path(&path).map_err(|_| "setup.invalid".to_string())?;
    check_setup_extension(&path)?;
    Ok(Some(path))
}

#[tauri::command]
pub fn setup_preview_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    jobs: State<'_, Jobs>,
    request_id: String,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "setup.invalid".to_string())?;
    validate_absolute_path(&path).map_err(|_| "setup.invalid".to_string())?;
    check_setup_extension(&path)?;
    let base_dir = state.data_dir().to_path_buf();
    if !base_dir.is_absolute() {
        return Err("setup.io".to_string());
    }
    let preview_id = uuid::Uuid::new_v4().to_string();
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |context| {
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let contents = read_setup_archive(std::path::Path::new(&path))?;
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let quarantine = write_quarantine(&base_dir, &preview_id, &contents)?;
        let SetupArchiveContents { manifest, files } = contents;
        let preview = match build_preview(
            preview_id.clone(),
            manifest,
            &files,
            unix_now().saturating_add(PREVIEW_TTL_SECS),
        ) {
            Ok(preview) => preview,
            Err(error) => {
                let _ = remove_quarantine(&base_dir, &preview_id, false);
                return Err(error);
            }
        };
        let entry = PreviewEntry {
            preview: preview.clone(),
            quarantine,
            base_dir: base_dir.clone(),
        };
        if let Err(error) = context.app().state::<SetupPreviews>().insert(entry) {
            let _ = remove_quarantine(&base_dir, &preview_id, false);
            return Err(error);
        }
        context.set_progress(&fs_service::OpProgress {
            items_done: 1,
            items_total: 1,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });
        serde_json::to_value(preview).map_err(|_| "setup.invalid".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn setup_apply_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    previews: State<'_, SetupPreviews>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    request_id: String,
    request: SetupApplyRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    // Settings and the theme store are app-owned configuration: safe mode
    // keeps them read-only, so Apply refuses before reading the archive.
    safe.settings_writable()?;
    valid_request_id(&request_id).map_err(|_| "setup.invalid".to_string())?;
    validate_apply_request(&request)?;
    let entry = previews.get(&request.preview_id)?;
    let preview = entry.preview;
    let mut selected = Vec::with_capacity(request.parts.len());
    for part in &request.parts {
        // Only explicitly named parts that the preview contains are eligible.
        if !preview.manifest.parts.contains(part) {
            return Err("setup.invalid".to_string());
        }
        let Some(details) = preview.parts.iter().find(|candidate| candidate.id == *part) else {
            return Err("setup.invalid".to_string());
        };
        if details
            .warning_codes
            .iter()
            .any(|code| code == "personal_paths")
            && !request.accept_personal_paths
        {
            return Err("setup.invalid".to_string());
        }
        selected.push(*part);
    }
    let quarantine = entry.quarantine;
    let data_dir = entry.base_dir;
    let expected_manifest = preview.manifest;
    let accept_personal_paths = request.accept_personal_paths;
    let token = jobs.begin(&request_id, 1)?;
    let job_app = app.clone();
    spawn_job(job_app, request_id, token, move |context| {
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let contents = read_quarantine(&quarantine)?;
        if contents.manifest != expected_manifest {
            return Err("setup.changed".to_string());
        }
        let mut plan_data = Vec::with_capacity(selected.len());
        for part in &selected {
            let name = format!("data/{}.json", part.id());
            let Some(bytes) = contents.files.get(&name) else {
                return Err("setup.changed".to_string());
            };
            let summary = validate_part(*part, bytes)?;
            if summary.contains_personal_paths && !accept_personal_paths {
                return Err("setup.invalid".to_string());
            }
            plan_data.push(SetupPlanPart {
                part: *part,
                bytes: bytes.clone(),
            });
        }
        let assets = Rc::new(contents.files);
        let mut registry = SetupAdapterRegistry::for_selection(
            app.clone(),
            &data_dir,
            assets,
            &selected,
        )?;
        let (plan, unsupported) = registry.supported_plan(plan_data)?;
        if plan.is_empty() {
            return Err(UNSUPPORTED.to_string());
        }
        // Cancellation is refused once the first journal write exists; the
        // transaction itself rolls back a failed commit.
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let journal_directory = data_dir.join("setups").join("journal");
        let result = run_setup_transaction(
            &journal_directory,
            registry.adapters_mut(),
            plan,
            unix_now(),
        )?;
        // Publish once, after every part committed. The settings cache already
        // holds the new values, so the UI's normal settings reload sees one
        // complete configuration and never an intermediate part.
        let settings = app
            .state::<AppState>()
            .settings
            .lock()
            .map_err(|_| "setup.io".to_string())?
            .clone();
        crate::preview_setup::apply_settings(&app, &settings);
        let mut warning_codes: Vec<String> = unsupported
            .iter()
            .map(|part| unsupported_warning(*part))
            .collect();
        warning_codes.extend(result.warning_codes);
        serde_json::to_value(SetupApplyResult {
            applied_parts: result.applied_parts,
            history_id: result.journal_id,
            restart_required: false,
            pending_recovery: result.pending_recovery,
            warning_codes,
        })
        .map_err(|_| "setup.invalid".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn setup_release(
    window: WebviewWindow,
    previews: State<'_, SetupPreviews>,
    preview_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&preview_id) {
        return Err("setup.invalid".to_string());
    }
    previews.release(&preview_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupExportRequest {
    pub dest_path: String,
    pub parts: Vec<SetupPart>,
    pub include_personal_paths: bool,
}

#[derive(Debug, Clone, Serialize)]
struct SetupExportResult {
    path: String,
    bytes: u64,
}

fn active_keyboard_map(settings: &Settings) -> Option<&KeyboardMap> {
    settings
        .keyboard_custom
        .custom_maps
        .iter()
        .find(|map| map.id == settings.keyboard_custom.active_map)
}

fn collect_export_parts(
    settings: &Settings,
    selected: &[SetupPart],
    include_personal_paths: bool,
) -> Result<(Vec<PartData>, bool), String> {
    let mut parts = Vec::with_capacity(selected.len());
    let mut contains_personal_paths = false;
    for part in selected {
        match part {
            SetupPart::Theme => {
                // No concrete current-theme exporter exists yet.
                return Err(UNAVAILABLE.to_string());
            }
            SetupPart::Keyboard => {
                let active = active_keyboard_map(settings)
                    .ok_or_else(|| UNAVAILABLE.to_string())?;
                parts.push(encode_part(*part, active)?);
            }
            SetupPart::Navigation => {
                let mut navigation = settings.shell_custom.navigation.clone();
                if !include_personal_paths {
                    strip_personal_paths(&mut navigation);
                }
                let data = encode_part(*part, &navigation)?;
                contains_personal_paths |=
                    validate_part(*part, &data.bytes)?.contains_personal_paths;
                parts.push(data);
            }
            SetupPart::Layout => parts.push(encode_part(*part, &settings.layout)?),
            SetupPart::Menus => parts.push(encode_part(*part, &settings.shell_custom.menus)?),
            SetupPart::Toolbars => parts.push(encode_part(*part, &settings.toolbar_custom)?),
            SetupPart::Home => parts.push(encode_part(*part, &settings.shell_custom.home)?),
            SetupPart::Status => parts.push(encode_part(*part, &settings.shell_custom.status)?),
        }
    }
    Ok((parts, contains_personal_paths))
}

#[tauri::command]
pub fn setup_export_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: SetupExportRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "setup.invalid".to_string())?;
    validate_absolute_path(&request.dest_path).map_err(|_| "setup.invalid".to_string())?;
    check_setup_extension(&request.dest_path)?;
    if request.parts.is_empty() || request.parts.len() > SETUP_PARTS.len() {
        return Err("setup.invalid".to_string());
    }
    let mut seen: Vec<SetupPart> = Vec::with_capacity(request.parts.len());
    for part in &request.parts {
        if seen.contains(part) {
            return Err("setup.invalid".to_string());
        }
        seen.push(*part);
    }
    let settings = state
        .settings
        .lock()
        .map_err(|_| "setup.io".to_string())?
        .clone();
    if seen.contains(&SetupPart::Theme) {
        return Err(UNAVAILABLE.to_string());
    }
    if seen.contains(&SetupPart::Keyboard) && active_keyboard_map(&settings).is_none() {
        return Err(UNAVAILABLE.to_string());
    }
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |context| {
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let (parts, contains_personal_paths) =
            collect_export_parts(&settings, &seen, request.include_personal_paths)?;
        if cancelled(context) {
            return Err(CANCELLED.to_string());
        }
        let (manifest, files) = build_export_manifest(
            env!("CARGO_PKG_VERSION"),
            unix_now(),
            parts,
            Vec::new(),
            contains_personal_paths,
        )?;
        context.set_progress(&fs_service::OpProgress {
            items_done: 0,
            items_total: 1,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });
        let bytes =
            write_setup_archive(std::path::Path::new(&request.dest_path), &manifest, &files)?;
        context.set_progress(&fs_service::OpProgress {
            items_done: 1,
            items_total: 1,
            bytes_done: bytes,
            bytes_total: bytes,
            current: String::new(),
        });
        serde_json::to_value(SetupExportResult {
            path: request.dest_path,
            bytes,
        })
        .map_err(|_| "setup.invalid".to_string())
    });
    Ok(())
}
