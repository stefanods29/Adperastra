//! Adperastra main application backend (Tauri 2).
//!
//! State choice: settings are kept in a small in-memory cache
//! (`AppState.settings`, a `Mutex<Settings>`) loaded once at startup and
//! written through to disk atomically on every save. Everything else
//! (session, help) is intentionally stateless file-per-call work, so no
//! other locks are needed and a crash can never leave a lock poisoned.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use thiserror::Error;

mod explorer;

pub const CURRENT_SCHEMA: u32 = 2;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("invalid help slug: {0}")]
    InvalidSlug(String),
    #[error("help page not found: {0}")]
    HelpNotFound(String),
}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.to_string()
    }
}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Data dir: `$ADPERASTRA_DATA_DIR`, else `%LOCALAPPDATA%\Adperastra`
/// (same location the setup launcher uses), else `./adperastra-data`.
pub fn resolve_data_dir() -> PathBuf {
    if let Ok(value) = std::env::var("ADPERASTRA_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Ok(value) = std::env::var("LOCALAPPDATA") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("Adperastra");
        }
    }
    PathBuf::from("./adperastra-data")
}

fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join("session.json")
}

fn logs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA
}

fn default_language() -> String {
    "en".to_string()
}

fn default_mode() -> String {
    "system".to_string()
}

fn default_accent_source() -> String {
    "design".to_string()
}

fn default_accent_custom() -> String {
    "#0067C0".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeSettings {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_accent_source")]
    pub accent_source: String,
    #[serde(default = "default_accent_custom")]
    pub accent_custom: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            accent_source: default_accent_source(),
            accent_custom: default_accent_custom(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub theme: ThemeSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA,
            language: default_language(),
            theme: ThemeSettings::default(),
        }
    }
}

fn is_valid_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn validate(settings: &Settings) -> Result<(), AppError> {
    if settings.schema_version != CURRENT_SCHEMA {
        return Err(AppError::Validation(format!(
            "unsupported schema_version {} (expected {CURRENT_SCHEMA})",
            settings.schema_version
        )));
    }
    if !matches!(settings.language.as_str(), "en" | "es" | "pseudo") {
        return Err(AppError::Validation(format!(
            "unsupported language {:?} (expected en, es or pseudo)",
            settings.language
        )));
    }
    if !matches!(settings.theme.mode.as_str(), "light" | "dark" | "system") {
        return Err(AppError::Validation(format!(
            "unsupported theme mode {:?} (expected light, dark or system)",
            settings.theme.mode
        )));
    }
    if !matches!(
        settings.theme.accent_source.as_str(),
        "design" | "windows" | "custom"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported accent_source {:?} (expected design, windows or custom)",
            settings.theme.accent_source
        )));
    }
    if !is_valid_hex_color(&settings.theme.accent_custom) {
        return Err(AppError::Validation(format!(
            "accent_custom {:?} is not a #RRGGBB colour",
            settings.theme.accent_custom
        )));
    }
    Ok(())
}

fn migrate_v1(obj: &serde_json::Map<String, serde_json::Value>) -> Settings {
    let language = obj
        .get("language")
        .and_then(|v| v.as_str())
        .filter(|l| matches!(*l, "en" | "es" | "pseudo"))
        .unwrap_or("en")
        .to_string();
    let mode = obj
        .get("theme")
        .and_then(|v| v.as_str())
        .filter(|m| matches!(*m, "light" | "dark" | "system"))
        .unwrap_or("system")
        .to_string();
    Settings {
        schema_version: CURRENT_SCHEMA,
        language,
        theme: ThemeSettings {
            mode,
            ..ThemeSettings::default()
        },
    }
}

/// Upgrade any on-disk settings value to the current schema.
/// Unknown or invalid shapes fall back to defaults rather than failing,
/// so a corrupt settings file can never stop the app from starting.
pub fn migrate(value: serde_json::Value) -> Result<Settings, AppError> {
    let obj = match value.as_object() {
        Some(obj) => obj,
        None => return Ok(Settings::default()),
    };
    if let Some(version) = obj.get("schema_version") {
        match version.as_u64() {
            Some(v) if v == CURRENT_SCHEMA as u64 => {
                let parsed: Result<Settings, _> = serde_json::from_value(value.clone());
                match parsed {
                    Ok(settings) if validate(&settings).is_ok() => Ok(settings),
                    _ => Ok(Settings::default()),
                }
            }
            Some(1) => Ok(migrate_v1(obj)),
            _ => Ok(Settings::default()),
        }
    } else {
        // v1 files have no schema_version and a flat { language, theme } shape.
        Ok(migrate_v1(obj))
    }
}

/// Crash-safe replace (see `fs_service::atomic_write`).
pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    Ok(fs_service::atomic_write(path, contents)?)
}

pub fn load_settings(data_dir: &Path) -> Settings {
    let path = settings_path(data_dir);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return Settings::default(),
    };
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => migrate(value).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings_to_dir(data_dir: &Path, settings: &Settings) -> Result<(), AppError> {
    validate(settings)?;
    let json = serde_json::to_string_pretty(settings)?;
    atomic_write(&settings_path(data_dir), json.as_bytes())
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionTab {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub active_tab: String,
    #[serde(default)]
    pub saved_unix: u64,
}

pub fn save_session_to_dir(data_dir: &Path, session: &SessionState) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(session)?;
    atomic_write(&session_path(data_dir), json.as_bytes())
}

pub fn load_session_from_dir(data_dir: &Path) -> Option<SessionState> {
    let content = fs::read_to_string(session_path(data_dir)).ok()?;
    serde_json::from_str(&content).ok()
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelpEntry {
    pub slug: String,
    pub title: String,
}

pub fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn validate_slug(slug: &str) -> Result<(), AppError> {
    if is_valid_slug(slug) {
        Ok(())
    } else {
        Err(AppError::InvalidSlug(slug.to_string()))
    }
}

pub fn normalize_lang(lang: &str) -> &'static str {
    let lowered = lang.trim().to_ascii_lowercase();
    if lowered == "es" || lowered.starts_with("es-") {
        "es"
    } else if lowered == "pseudo" {
        "pseudo"
    } else {
        "en"
    }
}

fn help_lang_dir(root: &Path, lang: &str) -> PathBuf {
    let dir = root.join(normalize_lang(lang));
    if dir.is_dir() {
        dir
    } else {
        root.join("en")
    }
}

pub fn parse_help_title(content: &str, slug: &str) -> String {
    for line in content.lines() {
        let line = line.trim();
        if let Some(title) = line.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    slug.to_string()
}

pub fn list_help_in(root: &Path, lang: &str) -> Vec<HelpEntry> {
    let dir = help_lang_dir(root, lang);
    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let slug = match path.file_stem().and_then(|s| s.to_str()) {
                Some(stem) if is_valid_slug(stem) => stem.to_string(),
                _ => continue,
            };
            let content = fs::read_to_string(&path).unwrap_or_default();
            let title = parse_help_title(&content, &slug);
            entries.push(HelpEntry { slug, title });
        }
    }
    entries.sort_by(|a, b| a.slug.cmp(&b.slug));
    entries
}

pub fn get_help_page_in(root: &Path, lang: &str, slug: &str) -> Result<String, AppError> {
    validate_slug(slug)?;
    let lang_path = help_lang_dir(root, lang).join(format!("{slug}.md"));
    if lang_path.is_file() {
        return Ok(fs::read_to_string(&lang_path)?);
    }
    let en_path = root.join("en").join(format!("{slug}.md"));
    if en_path.is_file() {
        return Ok(fs::read_to_string(&en_path)?);
    }
    Err(AppError::HelpNotFound(slug.to_string()))
}

pub fn search_help_in(root: &Path, lang: &str, query: &str) -> Vec<HelpEntry> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let dir = help_lang_dir(root, lang);
    let mut results = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let slug = match path.file_stem().and_then(|s| s.to_str()) {
                Some(stem) if is_valid_slug(stem) => stem.to_string(),
                _ => continue,
            };
            let content = fs::read_to_string(&path).unwrap_or_default();
            let title = parse_help_title(&content, &slug);
            if title.to_lowercase().contains(&needle) || content.to_lowercase().contains(&needle) {
                results.push(HelpEntry { slug, title });
            }
        }
    }
    results.sort_by(|a, b| a.slug.cmp(&b.slug));
    results.truncate(20);
    results
}

fn help_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let push = |roots: &mut Vec<PathBuf>, path: PathBuf| {
        if !roots.contains(&path) {
            roots.push(path);
        }
    };
    if let Ok(resource_dir) = app.path().resource_dir() {
        push(&mut roots, resource_dir.join("help"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push(&mut roots, dir.join("../help"));
            push(&mut roots, dir.join("help"));
        }
    }
    push(&mut roots, PathBuf::from("./help"));
    push(&mut roots, PathBuf::from("help"));
    roots
}

fn resolve_help_root(app: &AppHandle, lang: &str) -> Option<PathBuf> {
    let roots = help_roots(app);
    for root in &roots {
        if root.join(normalize_lang(lang)).is_dir() {
            return Some(root.clone());
        }
    }
    for root in &roots {
        if root.join("en").is_dir() {
            return Some(root.clone());
        }
    }
    roots.into_iter().next()
}

// ---------------------------------------------------------------------------
// Windows accent colour
// ---------------------------------------------------------------------------

pub fn abgr_to_hex(value: u32) -> String {
    let r = value & 0xFF;
    let g = (value >> 8) & 0xFF;
    let b = (value >> 16) & 0xFF;
    format!("#{r:02X}{g:02X}{b:02X}")
}

#[cfg(windows)]
pub fn read_windows_accent() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let subkey = wide("Software\\Microsoft\\Windows\\DWM");
        let name = wide("AccentColor");
        let mut value: u32 = 0;
        let mut size: u32 = std::mem::size_of::<u32>() as u32;
        let result = RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(name.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut std::ffi::c_void),
            Some(&mut size),
        );
        if result.0 != 0 {
            return None;
        }
        Some(abgr_to_hex(value))
    }
}

#[cfg(not(windows))]
pub fn read_windows_accent() -> Option<String> {
    None
}

// ---------------------------------------------------------------------------
// Crash capture
// ---------------------------------------------------------------------------

static CRASH_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

#[cfg(windows)]
fn write_minidump(logs_dir: &Path, timestamp: u64) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Diagnostics::Debug::{MiniDumpWithThreadInfo, MiniDumpWriteDump};
    use windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId};

    let path = logs_dir.join(format!("crash-{timestamp}.dmp"));
    if let Ok(file) = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
    {
        unsafe {
            let handle = HANDLE(file.as_raw_handle() as *mut std::ffi::c_void);
            let _ = MiniDumpWriteDump(
                GetCurrentProcess(),
                GetCurrentProcessId(),
                handle,
                MiniDumpWithThreadInfo,
                None,
                None,
                None,
            );
        }
    }
}

#[cfg(not(windows))]
fn write_minidump(_logs_dir: &Path, _timestamp: u64) {}

fn install_panic_hook(logs_dir: PathBuf) {
    let _ = CRASH_LOG_DIR.set(logs_dir);
    std::panic::set_hook(Box::new(|info| {
        // Never panic inside the hook: every step is best-effort.
        let timestamp = unix_now();
        let message: String = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        eprintln!("Adperastra panic: {message} at {location}");
        if let Some(dir) = CRASH_LOG_DIR.get() {
            let _ = fs::create_dir_all(dir);
            let log_path = dir.join(format!("crash-{timestamp}.log"));
            let content = format!(
                "Adperastra crash\nunix: {timestamp}\nmessage: {message}\nlocation: {location}\n\nbacktrace:\n{backtrace}\n"
            );
            let _ = fs::write(&log_path, content);
            write_minidump(dir, timestamp);
        }
    }));
}

// ---------------------------------------------------------------------------
// Windows snap layouts (custom maximize button)
// ---------------------------------------------------------------------------

/// Screen rectangle of the custom maximize button, in physical pixels
/// relative to the main window's client area: `[x, y, width, height]`.
/// Written by the frontend (`set_maximize_rect`) on mount and on window
/// resize; read by the window subclass below on every `WM_NCHITTEST`.
static MAXIMIZE_RECT: Mutex<Option<[f64; 4]>> = Mutex::new(None);

/// Half-open hit test: left/top edges inclusive, right/bottom exclusive,
/// so two buttons sharing an edge can never both claim the same pixel.
pub fn point_in_rect(x: f64, y: f64, rect: [f64; 4]) -> bool {
    x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]
}

#[tauri::command]
fn set_maximize_rect(
    window: WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return Err("maximize rect values must be finite".to_string());
    }
    if x < 0.0 || y < 0.0 {
        return Err("maximize rect origin must not be negative".to_string());
    }
    if width <= 0.0 || height <= 0.0 {
        return Err("maximize rect size must be positive".to_string());
    }
    let mut stored = MAXIMIZE_RECT
        .lock()
        .map_err(|_| "maximize rect lock poisoned".to_string())?;
    *stored = Some([x, y, width, height]);
    Ok(())
}

#[cfg(windows)]
const SNAP_SUBCLASS_ID: usize = 1;

/// Make Windows treat the custom maximize button as the native maximize
/// caption button. With a borderless window (`decorations: false`) the
/// button is plain HTML, so Windows would never show the Windows 11
/// snap-layouts flyout for it; answering `WM_NCHITTEST` with `HTMAXBUTTON`
/// for its rectangle is what makes the flyout appear on hover and makes
/// the system (not the page) handle the click.
#[cfg(windows)]
fn install_snap_subclass(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    let Ok(raw_hwnd) = window.hwnd() else {
        return;
    };
    // `window.hwnd()` returns the `windows` 0.62 `HWND` that Tauri uses,
    // while this crate pins `windows` 0.61; both are a transparent wrapper
    // around the same raw pointer, so re-wrap the pointer instead of
    // pretending the two types are identical.
    let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0);
    // SAFETY: `hwnd` is the live main window during `setup`, and the
    // subclass proc only reads `MAXIMIZE_RECT` and forwards everything
    // else to `DefSubclassProc`.
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(snap_subclass_proc), SNAP_SUBCLASS_ID, 0);
    }
}

#[cfg(windows)]
unsafe extern "system" fn snap_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{LRESULT, POINT};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{HTMAXBUTTON, WM_NCDESTROY, WM_NCHITTEST};

    if msg == WM_NCHITTEST {
        // `lparam` packs the cursor position in screen coordinates as two
        // signed 16-bit values (low = x, high = y); the truncating casts
        // keep negative coordinates on monitors left of / above the
        // primary one.
        let mut point = POINT {
            x: i32::from(lparam.0 as i16),
            y: i32::from((lparam.0 >> 16) as i16),
        };
        // SAFETY: `hwnd` is the window this subclass is installed on, and
        // `point` is a local that stays valid for the call.
        if unsafe { ScreenToClient(hwnd, &mut point) }.as_bool() {
            let inside = MAXIMIZE_RECT
                .lock()
                .ok()
                .and_then(|stored| *stored)
                .is_some_and(|rect| point_in_rect(f64::from(point.x), f64::from(point.y), rect));
            if inside {
                return LRESULT(HTMAXBUTTON as isize);
            }
        }
    } else if msg == WM_NCDESTROY {
        // SAFETY: same window/subclass pair as `install_snap_subclass`.
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(snap_subclass_proc), SNAP_SUBCLASS_ID);
        }
    }
    // SAFETY: forwarding unhandled messages is the subclass contract.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

pub struct AppState {
    data_dir: PathBuf,
    settings: Mutex<Settings>,
    list_jobs: Mutex<HashMap<String, ListJob>>,
    explorer_state_lock: Mutex<()>,
    watch: Mutex<Option<WatchControl>>,
    watch_next_id: AtomicU64,
}

struct WatchControl {
    stop: std::sync::Arc<AtomicBool>,
    watcher: std::sync::Arc<Mutex<fs_service::FsWatcher>>,
}

fn explorer_state_file(data_dir: &Path) -> PathBuf {
    data_dir.join("explorer-state.json")
}

/// Every command is only callable from the main window. Help (and any
/// future popups) render inside a tab in the main window, so no other
/// webview ever needs these commands.
pub fn ensure_main(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err(format!("command not allowed for window '{label}'"))
    }
}

#[tauri::command]
fn get_settings(window: WebviewWindow, state: State<'_, AppState>) -> Result<Settings, String> {
    ensure_main(window.label())?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
fn save_settings(
    window: WebviewWindow,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    ensure_main(window.label())?;
    validate(&settings).map_err(String::from)?;
    save_settings_to_dir(&state.data_dir, &settings).map_err(String::from)?;
    let mut cached = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    *cached = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn get_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Option<SessionState>, String> {
    ensure_main(window.label())?;
    Ok(load_session_from_dir(&state.data_dir))
}

#[tauri::command]
fn save_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: SessionState,
) -> Result<(), String> {
    ensure_main(window.label())?;
    save_session_to_dir(&state.data_dir, &session).map_err(String::from)
}

#[tauri::command]
fn list_help(
    window: WebviewWindow,
    app: AppHandle,
    lang: String,
) -> Result<Vec<HelpEntry>, String> {
    ensure_main(window.label())?;
    match resolve_help_root(&app, &lang) {
        Some(root) => Ok(list_help_in(&root, &lang)),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
fn get_help_page(
    window: WebviewWindow,
    app: AppHandle,
    lang: String,
    slug: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_slug(&slug).map_err(String::from)?;
    let root =
        resolve_help_root(&app, &lang).ok_or_else(|| "help directory not found".to_string())?;
    get_help_page_in(&root, &lang, &slug).map_err(String::from)
}

#[tauri::command]
fn search_help(
    window: WebviewWindow,
    app: AppHandle,
    lang: String,
    query: String,
) -> Result<Vec<HelpEntry>, String> {
    ensure_main(window.label())?;
    match resolve_help_root(&app, &lang) {
        Some(root) => Ok(search_help_in(&root, &lang, &query)),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
fn get_windows_accent(window: WebviewWindow) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    Ok(read_windows_accent())
}

/// The help centre opens as a tab inside the main window (step 01b), so
/// this simply asks the frontend to open/focus that tab.
#[tauri::command]
fn open_help_window(window: WebviewWindow, slug: Option<String>) -> Result<(), String> {
    ensure_main(window.label())?;
    let slug = slug.unwrap_or_else(|| "getting-started".to_string());
    validate_slug(&slug).map_err(String::from)?;
    window.emit("open-help", slug).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Explorer commands (Step 02, slice 2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirOutcome {
    pub path: String,
    pub total: usize,
    pub skipped: Vec<fs_service::ListIssue>,
}

fn valid_request_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid request id".to_string());
    }
    Ok(())
}

fn parse_sort(key: &str, direction: &str) -> Result<fs_service::SortSpec, String> {
    let key = match key {
        "name" => fs_service::SortKey::Name,
        "modified" => fs_service::SortKey::Modified,
        "size" => fs_service::SortKey::Size,
        "kind" => fs_service::SortKey::Kind,
        _ => return Err(format!("invalid sort key {key:?}")),
    };
    let direction = match direction {
        "ascending" => fs_service::SortDirection::Ascending,
        "descending" => fs_service::SortDirection::Descending,
        _ => return Err(format!("invalid sort direction {direction:?}")),
    };
    Ok(fs_service::SortSpec { key, direction })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListPoll {
    pub batches: Vec<Vec<explorer::ExplorerItem>>,
    pub done: bool,
    pub outcome: Option<ListDirOutcome>,
    pub error: Option<String>,
}

pub struct ListJob {
    batches: std::collections::VecDeque<Vec<explorer::ExplorerItem>>,
    done: bool,
    outcome: Option<ListDirOutcome>,
    error: Option<String>,
    token: fs_service::CancellationToken,
}

/// Batches per poll response. Capped so the frontend paints the first
/// rows (a few thousand items) instead of parsing a 100,000-item
/// response before anything becomes visible (speed.md: render
/// progressively, first view first).
pub const MAX_POLL_BATCHES: usize = 8;

/// Drain a finished/running job into one poll response. Pure so it can be
/// unit-tested without a window. `done` is only reported once the queue
/// is empty, so the outcome never overtakes undelivered batches.
pub fn drain_job(job: &mut ListJob) -> ListPoll {
    let take = job.batches.len().min(MAX_POLL_BATCHES);
    let batches: Vec<Vec<explorer::ExplorerItem>> = job.batches.drain(..take).collect();
    let done = job.done && job.batches.is_empty();
    ListPoll {
        batches,
        done,
        outcome: if done { job.outcome.clone() } else { None },
        error: if done { job.error.clone() } else { None },
    }
}

// NOTE (transport ruling, Step 02): Tauri Channel messages never reached
// the frontend under this app's isolation pattern (probe: Rust listed 57
// items, channel sends reported no error, JS received 0). Lists therefore
// use plain invoke commands - start runs the listing on a blocking
// thread, poll drains queued batches - which the isolation hook already
// allows. Watch uses Tauri events, proven by the open-help flow.

#[tauri::command]
fn list_dir_start(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
    sort_key: String,
    sort_direction: String,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    let sort = parse_sort(&sort_key, &sort_direction)?;
    let token = fs_service::new_cancellation_token();
    {
        let mut jobs = state
            .list_jobs
            .lock()
            .map_err(|_| "list jobs lock poisoned".to_string())?;
        jobs.insert(
            request_id.clone(),
            ListJob {
                batches: std::collections::VecDeque::new(),
                done: false,
                outcome: None,
                error: None,
                token: token.clone(),
            },
        );
    }
    let job_id = request_id;
    tauri::async_runtime::spawn_blocking(move || {
        let job_state = app.state::<AppState>();
        let finish = |outcome: Option<ListDirOutcome>, error: Option<String>| {
            if let Ok(mut jobs) = job_state.list_jobs.lock() {
                if let Some(job) = jobs.get_mut(&job_id) {
                    job.done = true;
                    job.outcome = outcome;
                    job.error = error;
                }
            }
        };
        let canonical = match fs::canonicalize(Path::new(&path)) {
            Ok(canonical) => canonical,
            Err(e) => {
                finish(None, Some(e.to_string()));
                return;
            }
        };
        let job_id_for_batches = job_id.clone();
        let result = fs_service::list_dir_batched(&canonical, sort, 512, &token, |chunk| {
            let dto: Vec<explorer::ExplorerItem> =
                chunk.iter().cloned().map(explorer::explorer_item).collect();
            if let Ok(mut jobs) = job_state.list_jobs.lock() {
                if let Some(job) = jobs.get_mut(&job_id_for_batches) {
                    job.batches.push_back(dto);
                }
            }
        });
        match result {
            Ok(listing) => finish(
                Some(ListDirOutcome {
                    path: listing.path.to_string_lossy().into_owned(),
                    total: listing.items.len(),
                    skipped: listing.skipped,
                }),
                None,
            ),
            Err(e) => finish(None, Some(e.to_string())),
        }
    });
    Ok(())
}

#[tauri::command]
fn list_dir_poll(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<ListPoll, String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let mut jobs = state
        .list_jobs
        .lock()
        .map_err(|_| "list jobs lock poisoned".to_string())?;
    let Some(job) = jobs.get_mut(&request_id) else {
        return Err(format!("unknown list request {request_id:?}"));
    };
    let poll = drain_job(job);
    // drain_job only reports done once the queue is empty, and this
    // response already carries the final drained batches, so the job can
    // be dropped now; the client never needs to poll again.
    if poll.done {
        jobs.remove(&request_id);
    }
    Ok(poll)
}

#[tauri::command]
fn list_dir_cancel(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if let Ok(jobs) = state.list_jobs.lock() {
        if let Some(job) = jobs.get(&request_id) {
            job.token.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
#[tauri::command]
async fn fs_stat(window: WebviewWindow, path: String) -> Result<explorer::ExplorerItem, String> {
    ensure_main(window.label())?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        fs_service::stat_path(Path::new(&path))
            .map(explorer::explorer_item)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_known_folders(window: WebviewWindow) -> Result<Vec<explorer::KnownFolder>, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(explorer::known_folders)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_drives(window: WebviewWindow) -> Result<Vec<explorer::DriveItem>, String> {
    ensure_main(window.label())?;
    // Logical drives only: this never waits on a drive (see explorer.rs).
    Ok(explorer::list_drives())
}

#[tauri::command]
async fn drive_info(window: WebviewWindow, root: String) -> Result<explorer::DriveInfo, String> {
    ensure_main(window.label())?;
    if root.len() > 256 {
        return Err("drive root is too long".to_string());
    }
    fs_service::validate_path_input(&root).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || explorer::drive_info(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_recent_items(
    window: WebviewWindow,
    limit: usize,
) -> Result<Vec<explorer::RecentItem>, String> {
    ensure_main(window.label())?;
    let limit = limit.clamp(1, 100);
    tauri::async_runtime::spawn_blocking(move || explorer::recent_items(limit))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn explorer_state_get(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    // Same lock as writers, so a read never races a save.
    let _guard = state
        .explorer_state_lock
        .lock()
        .map_err(|_| "explorer state lock poisoned".to_string())?;
    Ok(fs_service::ExplorerState::load(&explorer_state_file(
        &state.data_dir,
    )))
}

fn update_explorer_state(
    state: &AppState,
    change: impl FnOnce(&mut fs_service::ExplorerState),
) -> Result<fs_service::ExplorerState, String> {
    let _guard = state
        .explorer_state_lock
        .lock()
        .map_err(|_| "explorer state lock poisoned".to_string())?;
    let path = explorer_state_file(&state.data_dir);
    let mut current = fs_service::ExplorerState::load(&path);
    change(&mut current);
    current.save(&path).map_err(|e| e.to_string())?;
    Ok(current)
}

#[tauri::command]
async fn pin_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    let canonical = tauri::async_runtime::spawn_blocking(move || {
        let canonical = fs::canonicalize(Path::new(&path)).map_err(|e| e.to_string())?;
        if !canonical.is_dir() {
            return Err("only folders can be pinned".to_string());
        }
        Ok::<String, String>(canonical.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())??;
    update_explorer_state(&state, |s| s.pin(canonical))
}

#[tauri::command]
fn unpin_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    update_explorer_state(&state, |s| s.unpin(&path))
}

#[tauri::command]
fn record_recent_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    update_explorer_state(&state, |s| s.record_recent(path))
}

#[tauri::command]
async fn watch_start(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    fs_service::validate_path_input(&path).map_err(|e| e.to_string())?;
    let watcher = tauri::async_runtime::spawn_blocking(move || {
        let canonical = fs::canonicalize(Path::new(&path)).map_err(|e| e.to_string())?;
        let mut watcher = fs_service::FsWatcher::new().map_err(|e| e.to_string())?;
        watcher.watch(&canonical).map_err(|e| e.to_string())?;
        Ok::<fs_service::FsWatcher, String>(watcher)
    })
    .await
    .map_err(|e| e.to_string())??;

    let id = state.watch_next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let control = WatchControl {
        stop: std::sync::Arc::new(AtomicBool::new(false)),
        watcher: std::sync::Arc::new(Mutex::new(watcher)),
    };
    let stop = control.stop.clone();
    let shared = control.watcher.clone();
    {
        let mut slot = state
            .watch
            .lock()
            .map_err(|_| "watch lock poisoned".to_string())?;
        if let Some(old) = slot.take() {
            old.stop.store(true, Ordering::Relaxed);
        }
        *slot = Some(control);
    }
    // Polling on a blocking thread: drain every 250 ms, so a burst of file
    // changes becomes at most four batched UI events per second.
    let window_for_events = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let events = match shared.lock() {
                Ok(watcher) => watcher.drain_batched(),
                Err(_) => break,
            };
            if !events.is_empty() {
                let dto: Vec<explorer::FsEventDto> =
                    events.into_iter().map(explorer::fs_event_dto).collect();
                // Tauri events reach the frontend under the isolation
                // pattern (the open-help flow proves it); Channel did not.
                if window_for_events.emit("watch-events", dto).is_err() {
                    break;
                }
            }
        }
        let _ = id; // generation, kept for future watch debugging
    });
    Ok(())
}

#[tauri::command]
fn watch_stop(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    ensure_main(window.label())?;
    if let Ok(mut slot) = state.watch.lock() {
        if let Some(control) = slot.take() {
            control.stop.store(true, Ordering::Relaxed);
            if let Ok(mut watcher) = control.watcher.lock() {
                watcher.unwatch();
            }
        }
    }
    Ok(())
}
fn main() {
    let data_dir = resolve_data_dir();
    let _ = fs::create_dir_all(&data_dir);
    let logs = logs_dir(&data_dir);
    let _ = fs::create_dir_all(&logs);
    install_panic_hook(logs);
    if std::env::var_os("ADPERASTRA_FORCE_CRASH").is_some() {
        panic!("forced crash (test)");
    }
    let initial_settings = load_settings(&data_dir);
    tauri::Builder::default()
        .manage(AppState {
            data_dir,
            settings: Mutex::new(initial_settings),
            list_jobs: Mutex::new(HashMap::new()),
            explorer_state_lock: Mutex::new(()),
            watch: Mutex::new(None),
            watch_next_id: AtomicU64::new(0),
        })
        .setup(|app| {
            // Snap layouts: subclass the main window so Windows treats the
            // custom maximize button as the native maximize button.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                install_snap_subclass(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_session,
            save_session,
            list_help,
            get_help_page,
            search_help,
            get_windows_accent,
            open_help_window,
            set_maximize_rect,
            list_dir_start,
            list_dir_poll,
            list_dir_cancel,
            fs_stat,
            list_known_folders,
            list_drives,
            drive_info,
            list_recent_items,
            explorer_state_get,
            pin_folder,
            unpin_folder,
            record_recent_folder,
            watch_start,
            watch_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Adperastra");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_defaults() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.schema_version, 2);
        assert_eq!(settings.language, "en");
        assert_eq!(settings.theme.mode, "system");
        assert_eq!(settings.theme.accent_source, "design");
        assert_eq!(settings.theme.accent_custom, "#0067C0");
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn migrate_v1_flat_json() {
        let value = serde_json::json!({ "language": "es", "theme": "dark" });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 2);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_source, "design");
        assert_eq!(settings.theme.accent_custom, "#0067C0");
    }

    #[test]
    fn migrate_unknown_falls_back_to_defaults() {
        let settings = migrate(serde_json::json!({ "schema_version": 99 })).unwrap();
        assert_eq!(settings, Settings::default());
        let settings = migrate(serde_json::json!("nonsense")).unwrap();
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn migrate_v2_round_trips() {
        let original = Settings {
            language: "es".to_string(),
            theme: ThemeSettings {
                mode: "light".to_string(),
                accent_source: "custom".to_string(),
                accent_custom: "#FF00AA".to_string(),
            },
            ..Settings::default()
        };
        let value = serde_json::to_value(&original).unwrap();
        assert_eq!(migrate(value).unwrap(), original);
    }

    #[test]
    fn validation_rejects_bad_language() {
        let mut settings = Settings::default();
        settings.language = "fr".to_string();
        assert!(validate(&settings).is_err());
        settings.language = "".to_string();
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn validation_rejects_bad_accent() {
        for bad in ["0067C0", "#GGGGGG", "#12345", "#1234567", "", "blue"] {
            let mut settings = Settings::default();
            settings.theme.accent_custom = bad.to_string();
            assert!(
                validate(&settings).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
        let mut settings = Settings::default();
        settings.theme.accent_custom = "#a1B2c3".to_string();
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn validation_rejects_bad_mode_and_source() {
        let mut settings = Settings::default();
        settings.theme.mode = "auto".to_string();
        assert!(validate(&settings).is_err());
        let mut settings = Settings::default();
        settings.theme.accent_source = "neon".to_string();
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn session_serde_round_trip() {
        let session = SessionState {
            tabs: vec![
                SessionTab {
                    id: "explorer".to_string(),
                    kind: "explorer".to_string(),
                    title: None,
                },
                SessionTab {
                    id: "tab-1".to_string(),
                    kind: "help".to_string(),
                    title: Some("Getting started".to_string()),
                },
            ],
            active_tab: "tab-1".to_string(),
            saved_unix: 1_727_000_000,
        };
        let json = serde_json::to_string(&session).unwrap();
        let restored: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(session, restored);
    }

    #[test]
    fn slug_validation() {
        assert!(validate_slug("getting-started").is_ok());
        assert!(is_valid_slug("getting-started"));
        assert!(validate_slug("../etc").is_err());
        assert!(validate_slug("a/b").is_err());
        assert!(validate_slug("").is_err());
        assert!(validate_slug("Getting-Started").is_err());
        assert!(validate_slug("a b").is_err());
    }

    #[test]
    fn point_in_rect_inside_and_outside() {
        let rect = [100.0, 10.0, 46.0, 32.0];
        assert!(point_in_rect(100.0, 10.0, rect));
        assert!(point_in_rect(120.0, 25.0, rect));
        assert!(point_in_rect(145.0, 41.0, rect));
        assert!(!point_in_rect(99.0, 25.0, rect));
        assert!(!point_in_rect(120.0, 9.0, rect));
        assert!(!point_in_rect(200.0, 25.0, rect));
        assert!(!point_in_rect(120.0, 100.0, rect));
    }

    #[test]
    fn point_in_rect_edges() {
        // Left/top edges are inside; right/bottom edges are outside, so
        // the close button next to the maximize button never overlaps it.
        let rect = [100.0, 10.0, 46.0, 32.0];
        assert!(point_in_rect(100.0, 25.0, rect));
        assert!(point_in_rect(120.0, 10.0, rect));
        assert!(!point_in_rect(146.0, 25.0, rect));
        assert!(!point_in_rect(120.0, 42.0, rect));
        assert!(!point_in_rect(146.0, 42.0, rect));
        assert!(point_in_rect(145.5, 41.5, rect));
    }

    #[test]
    fn list_job_drain_returns_batches_then_outcome() {
        let mut job = ListJob {
            batches: std::collections::VecDeque::from(vec![vec![], vec![]]),
            done: true,
            outcome: Some(ListDirOutcome {
                path: "C:\\".to_string(),
                total: 0,
                skipped: vec![],
            }),
            error: None,
            token: fs_service::new_cancellation_token(),
        };
        let poll = drain_job(&mut job);
        assert_eq!(poll.batches.len(), 2);
        assert!(poll.done);
        assert_eq!(poll.outcome.map(|o| o.total), Some(0));
        assert!(job.batches.is_empty());
        let mut running = ListJob {
            batches: std::collections::VecDeque::new(),
            done: false,
            outcome: None,
            error: None,
            token: fs_service::new_cancellation_token(),
        };
        let poll = drain_job(&mut running);
        assert!(!poll.done && poll.outcome.is_none());

        // A finished job with more than MAX_POLL_BATCHES queued reports
        // done only after the queue is fully drained.
        let mut big = ListJob {
            batches: std::collections::VecDeque::from(vec![vec![]; MAX_POLL_BATCHES + 2]),
            done: true,
            outcome: None,
            error: None,
            token: fs_service::new_cancellation_token(),
        };
        let first = drain_job(&mut big);
        assert_eq!(first.batches.len(), MAX_POLL_BATCHES);
        assert!(!first.done);
        let second = drain_job(&mut big);
        assert_eq!(second.batches.len(), 2);
        assert!(second.done);
    }
    #[test]
    fn explorer_command_validation() {
        assert!(valid_request_id("req-1_a").is_ok());
        assert!(valid_request_id("").is_err());
        assert!(valid_request_id("bad id!").is_err());
        assert!(valid_request_id(&"x".repeat(65)).is_err());
        assert!(parse_sort("name", "ascending").is_ok());
        assert!(parse_sort("size", "descending").is_ok());
        assert!(parse_sort("bogus", "ascending").is_err());
        assert!(parse_sort("name", "sideways").is_err());
    }
    #[test]
    fn ensure_main_guard() {
        assert!(ensure_main("main").is_ok());
        assert!(ensure_main("help-popup").is_err());
        assert!(ensure_main("").is_err());
    }

    #[test]
    fn abgr_conversion() {
        // DWM AccentColor is ABGR: 0xAABBGGRR.
        assert_eq!(abgr_to_hex(0xFFC06700), "#0067C0");
        assert_eq!(abgr_to_hex(0x00000000), "#000000");
        assert_eq!(abgr_to_hex(0xFFFFFFFF), "#FFFFFF");
    }

    #[test]
    fn settings_and_session_files_round_trip() {
        let dir =
            std::env::temp_dir().join(format!("adperastra-test-{}-settings", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = Settings {
            language: "pseudo".to_string(),
            ..Settings::default()
        };
        save_settings_to_dir(&dir, &settings).unwrap();
        assert_eq!(load_settings(&dir), settings);
        let session = SessionState {
            tabs: vec![],
            active_tab: "explorer".to_string(),
            saved_unix: 42,
        };
        save_session_to_dir(&dir, &session).unwrap();
        assert_eq!(load_session_from_dir(&dir), Some(session));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn help_listing_search_and_fallback() {
        let root =
            std::env::temp_dir().join(format!("adperastra-test-{}-help", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("en")).unwrap();
        fs::write(
            root.join("en/getting-started.md"),
            "# Getting started\n\nWelcome to Adperastra.\n",
        )
        .unwrap();
        fs::write(root.join("en/tabs.md"), "# Tabs\n\nOpen many tabs.\n").unwrap();

        let entries = list_help_in(&root, "es");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].slug, "getting-started");
        assert_eq!(entries[0].title, "Getting started");

        let page = get_help_page_in(&root, "es", "tabs").unwrap();
        assert!(page.contains("Open many tabs."));
        assert!(get_help_page_in(&root, "en", "../etc").is_err());
        assert!(get_help_page_in(&root, "en", "missing-page").is_err());

        let found = search_help_in(&root, "en", "MANY");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].slug, "tabs");
        assert!(search_help_in(&root, "en", "  ").is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
