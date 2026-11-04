//! Commands and fixed entry points for Windows integration (Step 16, T2).
//!
//! Explorer starts the app with only `--open` or `--convert` plus literal
//! file arguments. The parser accepts nothing else. `Convert` only opens the
//! shared conversion review; it never converts a file automatically.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{State, WebviewWindow};

use crate::ensure_main;
use crate::registry_ledger::{
    identity, LedgerStore, RegistryBackend, StoredValue, WindowsRegistry,
};
use crate::windows_integration::{self, quote_executable};
use crate::windows_integration_types::{
    validate_activation_path, validate_integration_request, ActivationIntent, IntegrationRequest,
    IntegrationStatus,
};

/// The fixed helper flag the uninstaller uses before deleting the app files.
pub const RESTORE_FLAG: &str = "--restore-integration";
/// Most paths one activation may carry (guide D2).
pub const MAX_ACTIVATION_PATHS: usize = 256;
/// Largest one activation request, matching the 09c pipe budget (768 KiB).
pub const MAX_ACTIVATION_BYTES: usize = 768 * 1024;

/// What one activation will do. `review_required` is always true for
/// conversion; `auto_convert` is never true.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationPlan {
    pub intent: ActivationIntent,
    pub paths: Vec<String>,
    pub review_required: bool,
    pub auto_convert: bool,
}

/// The host the coordinator supplies: normal opening and the conversion
/// review dialog. There is deliberately no "start conversion" method.
pub trait ActivationSink {
    fn open_paths(&mut self, paths: &[String]) -> Result<(), String>;
    fn open_convert_review(&mut self, paths: &[String]) -> Result<(), String>;
}

/// Missing intent keeps the pre-Step-16 behavior: open the files.
pub fn resolve_intent(intent: Option<ActivationIntent>) -> ActivationIntent {
    intent.unwrap_or(ActivationIntent::Open)
}

/// Validate and deduplicate the paths of one activation.
pub fn plan_activation(
    intent: Option<ActivationIntent>,
    paths: &[String],
) -> Result<ActivationPlan, String> {
    if paths.is_empty() || paths.len() > MAX_ACTIVATION_PATHS {
        return Err("windows_integration.bad_request".to_string());
    }
    let intent = resolve_intent(intent);
    let mut unique: Vec<String> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut total_bytes = 0usize;
    for path in paths {
        validate_activation_path(path)?;
        total_bytes = total_bytes.saturating_add(path.len());
        if total_bytes > MAX_ACTIVATION_BYTES {
            return Err("windows_integration.bad_request".to_string());
        }
        let key = path.to_lowercase();
        if seen.insert(key) {
            unique.push(path.clone());
        }
    }
    Ok(ActivationPlan {
        intent,
        paths: unique,
        review_required: intent == ActivationIntent::Convert,
        auto_convert: false,
    })
}

/// Parse the arguments after the executable. Only one of the two fixed
/// intent flags and a literal `--` terminator are accepted; anything else,
/// including a second intent flag, is refused instead of being forwarded to
/// a shell.
pub fn classify_arguments(
    arguments: &[String],
) -> Result<(ActivationIntent, Vec<String>), String> {
    let mut intent: Option<ActivationIntent> = None;
    let mut paths = Vec::new();
    let mut end_of_options = false;
    for argument in arguments {
        if !end_of_options {
            match argument.as_str() {
                "--open" => {
                    if intent.is_some() {
                        return Err("windows_integration.bad_request".to_string());
                    }
                    intent = Some(ActivationIntent::Open);
                    continue;
                }
                "--convert" => {
                    if intent.is_some() {
                        return Err("windows_integration.bad_request".to_string());
                    }
                    intent = Some(ActivationIntent::Convert);
                    continue;
                }
                "--" => {
                    end_of_options = true;
                    continue;
                }
                other if other.starts_with('-') => {
                    return Err("windows_integration.bad_request".to_string());
                }
                _ => {}
            }
        }
        paths.push(argument.clone());
    }
    Ok((resolve_intent(intent), paths))
}

/// Dispatch a plan. Conversion only opens the review; nothing is written.
pub fn dispatch_plan(
    plan: &ActivationPlan,
    sink: &mut dyn ActivationSink,
) -> Result<(), String> {
    match plan.intent {
        ActivationIntent::Convert => sink.open_convert_review(&plan.paths),
        ActivationIntent::Open => sink.open_paths(&plan.paths),
    }
}

/// Build a plan from the 09c activation request. The optional `intent` field
/// is the fixed Explorer verb carried as data; when it is absent the request
/// keeps the old behavior and opens. Convert only ever opens the shared
/// review: `auto_convert` stays false, so nothing is converted before the
/// user confirms.
pub fn plan_from_request(
    request: &crate::activation::ActivationRequest,
) -> Result<ActivationPlan, String> {
    plan_activation(request.intent, &request.paths)
}

/// The exact pre-call value of every key one apply touches.
type RegistrySnapshot = Vec<(String, String, Option<StoredValue>)>;

/// The ledger belongs to the profile-independent data root, not the folder
/// that holds the binaries: an upgrade replaces the binaries and the
/// uninstaller deletes them, while the ledger must survive both. The setup
/// call site still passes the executable folder, so that exact value is
/// mapped to the same portable/explicit data root the uninstall helper uses.
fn ledger_base(base_dir: PathBuf) -> PathBuf {
    let Some(app_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return base_dir;
    };
    if base_dir != app_dir {
        return base_dir;
    }
    let installed = crate::absolute_data_dir(crate::resolve_data_dir());
    crate::portable::locate(&app_dir, &installed)
        .map(|location| location.data_dir)
        .unwrap_or(installed)
}

/// Shared state for the integration commands. `base_dir` is the
/// profile-independent installation base (guide U3), never a profile folder.
#[derive(Clone)]
pub struct IntegrationState {
    base_dir: PathBuf,
    app_version: String,
    registry: Arc<dyn RegistryBackend>,
    lock: Arc<Mutex<()>>,
}

impl IntegrationState {
    pub fn new(base_dir: PathBuf, app_version: String) -> Self {
        Self {
            base_dir: ledger_base(base_dir),
            app_version,
            registry: Arc::new(WindowsRegistry),
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn store(&self) -> LedgerStore {
        LedgerStore::in_base(&self.base_dir)
    }

    /// Read the exact value of every key one call will touch before it runs.
    /// A failed ledger save then restores the registry to the pre-call state,
    /// including a foreign value that must never be replaced by old app
    /// bytes. Only app-owned keys and names are ever planned.
    fn snapshot(&self, keys: &[(String, String)]) -> Result<RegistrySnapshot, String> {
        keys.iter()
            .map(|(key, name)| {
                self.registry
                    .read(key, name)
                    .map(|before| (key.clone(), name.clone(), before))
            })
            .collect()
    }

    fn restore_snapshot(&self, snapshot: &RegistrySnapshot) {
        for (key, name, before) in snapshot {
            match before {
                Some(value) => {
                    let _ = self.registry.write(key, name, value);
                }
                None => {
                    let _ = self.registry.delete(key, name);
                }
            }
        }
    }

    pub fn status(&self) -> Result<IntegrationStatus, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "windows_integration.failed".to_string())?;
        let ledger = self.store().load()?;
        Ok(windows_integration::status(self.registry.as_ref(), &ledger))
    }

    pub fn apply(&self, request: &IntegrationRequest) -> Result<IntegrationStatus, String> {
        validate_integration_request(request)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "windows_integration.failed".to_string())?;
        let ledger = self.store().load()?;
        let previous = ledger.clone();
        let exe = std::env::current_exe()
            .map_err(|_| "windows_integration.failed".to_string())?;
        // Snapshot every value this call can change: the new plan and the
        // ledger rows the plan removes. A rare save failure then returns the
        // registry to exactly what it held before the call, foreign values
        // included, and the old ledger stays true.
        let planned = windows_integration::build_plan(&exe, &self.app_version, request)?;
        let planned_ids: std::collections::BTreeSet<String> = planned
            .iter()
            .map(|value| identity(&value.key, &value.name))
            .collect();
        let mut keys: Vec<(String, String)> = planned
            .iter()
            .map(|value| (value.key.clone(), value.name.clone()))
            .collect();
        for entry in &ledger.values {
            if !planned_ids.contains(&identity(&entry.key, &entry.name)) {
                keys.push((entry.key.clone(), entry.name.clone()));
            }
        }
        let snapshot = self.snapshot(&keys)?;
        let next = windows_integration::apply(
            self.registry.as_ref(),
            ledger,
            request,
            &exe,
            &self.app_version,
        )?;
        if self.store().save(&next).is_err() {
            // The registry changed but the ledger could not be recorded.
            // Put every touched value back and keep the old ledger.
            self.restore_snapshot(&snapshot);
            let _ = self.store().save(&previous);
            return Err("windows_integration.failed".to_string());
        }
        Ok(windows_integration::status(self.registry.as_ref(), &next))
    }

    pub fn set_start_with_windows(&self, enabled: bool) -> Result<IntegrationStatus, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "windows_integration.failed".to_string())?;
        let ledger = self.store().load()?;
        let previous = ledger.clone();
        let exe = std::env::current_exe()
            .map_err(|_| "windows_integration.failed".to_string())?;
        let snapshot = self.snapshot(&[(
            windows_integration::RUN_KEY.to_string(),
            windows_integration::RUN_VALUE_NAME.to_string(),
        )])?;
        let next = windows_integration::apply_start_with_windows(
            self.registry.as_ref(),
            ledger,
            enabled,
            &exe,
            &self.app_version,
        )?;
        if self.store().save(&next).is_err() {
            self.restore_snapshot(&snapshot);
            let _ = self.store().save(&previous);
            return Err("windows_integration.failed".to_string());
        }
        Ok(windows_integration::status(self.registry.as_ref(), &next))
    }
}

#[tauri::command]
pub async fn windows_integration_status(
    window: WebviewWindow,
    state: State<'_, IntegrationState>,
) -> Result<IntegrationStatus, String> {
    ensure_main(window.label())?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.status())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn windows_integration_apply(
    window: WebviewWindow,
    state: State<'_, IntegrationState>,
    request: IntegrationRequest,
) -> Result<IntegrationStatus, String> {
    ensure_main(window.label())?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply(&request))
        .await
        .map_err(|error| error.to_string())?
}

/// Open Windows' own Default apps page. It is a fixed URI, never user text;
/// the user makes the default choice there.
#[tauri::command]
pub async fn windows_integration_open_defaults(window: WebviewWindow) -> Result<(), String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(open_default_apps_settings)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
pub fn open_default_apps_settings() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let uri = crate::explorer::wide_null("ms-settings:defaultapps");
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOASYNC,
        lpFile: PCWSTR(uri.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    let _com = crate::explorer::ComGuard::new();
    // SAFETY: every pointer in `info` refers to a buffer that outlives the
    // call, and the fixed URI is not built from user input.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(()),
        Err(error) if crate::shell::is_cancelled(&error) => Ok(()),
        Err(_) => Err("windows_integration.failed".to_string()),
    }
}

#[cfg(not(windows))]
pub fn open_default_apps_settings() -> Result<(), String> {
    Err("windows_integration.failed".to_string())
}

/// Restore the owned registry values before the uninstaller removes files.
/// Only values that still match the installed value are restored; foreign
/// replacements stay. The ledger is cleared only after a successful pass.
pub fn restore_for_uninstall(base_dir: &Path) -> Result<IntegrationStatus, String> {
    let store = LedgerStore::in_base(base_dir);
    let ledger = store.load()?;
    let (next, status) = windows_integration::restore_with_backend(&WindowsRegistry, &ledger)?;
    store.save(&next)?;
    Ok(status)
}

/// Entry point of `Adperastra.exe --restore-integration`. The installer spec
/// keeps data in the resolved installation data root, not beside the
/// binaries, so the helper resolves the same portable/explicit location the
/// app used before reading the ledger.
pub fn run_restore_helper() -> i32 {
    let installed = crate::absolute_data_dir(crate::resolve_data_dir());
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| installed.clone());
    let base = crate::portable::locate(&app_dir, &installed)
        .map(|location| location.data_dir)
        .unwrap_or(installed);
    match restore_for_uninstall(&base) {
        Ok(_) => 0,
        Err(_) => 1,
    }
}

/// Build the registry command for one intent. Kept here so the T2 test can
/// prove a path with spaces stays one quoted argument.
pub fn command_for_intent(exe: &Path, intent: ActivationIntent) -> Result<String, String> {
    windows_integration::registration_command(exe, intent.flag())
}

/// The fixed activation argument pair the T2 test inspects. `%1` is
/// Explorer's placeholder, never a file name supplied by the UI.
pub fn activation_arguments(intent: ActivationIntent) -> [&'static str; 2] {
    [intent.flag(), "%1"]
}

/// The quoted executable used in the registry command. Exposed for tests and
/// the installer specification.
pub fn quoted_executable(exe: &Path) -> Result<String, String> {
    quote_executable(exe)
}

#[cfg(test)]
#[path = "windows_activation_step16_tests.rs"]
mod step16_tests;
