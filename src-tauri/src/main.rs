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
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use thiserror::Error;

mod classic_menu;
mod clipboard;
mod drag;
mod explorer;
mod operation_safety;
mod shell;
mod transfer_history;

pub const CURRENT_SCHEMA: u32 = 4;

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

/// The WebView2 profile (cache, storage) of the main window.
fn webview_profile_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("webview")
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

fn default_true() -> bool {
    true
}

fn default_group_by() -> String {
    "none".to_string()
}

/// Explorer view options (schema 3, Step 03a): the View menu's toggles and
/// the Sort menu's grouping. Defaults follow the Figma frame (extensions
/// shown) and Windows (hidden items hidden, no check boxes, no Details
/// pane).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplorerViewSettings {
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default = "default_true")]
    pub show_extensions: bool,
    #[serde(default)]
    pub item_checkboxes: bool,
    #[serde(default)]
    pub details_pane: bool,
    #[serde(default = "default_group_by")]
    pub group_by: String,
}

impl Default for ExplorerViewSettings {
    fn default() -> Self {
        Self {
            show_hidden: false,
            show_extensions: true,
            item_checkboxes: false,
            details_pane: false,
            group_by: default_group_by(),
        }
    }
}

fn default_paste_image_format() -> String {
    "png".to_string()
}

/// File-operation choices (schema 4, Step 03b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileSettings {
    /// What Paste as file saves clipboard images as: "png" or "jpg".
    #[serde(default = "default_paste_image_format")]
    pub paste_image_format: String,
}

impl Default for FileSettings {
    fn default() -> Self {
        Self {
            paste_image_format: default_paste_image_format(),
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
    #[serde(default)]
    pub explorer: ExplorerViewSettings,
    #[serde(default)]
    pub files: FileSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA,
            language: default_language(),
            theme: ThemeSettings::default(),
            explorer: ExplorerViewSettings::default(),
            files: FileSettings::default(),
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
    if !matches!(settings.files.paste_image_format.as_str(), "png" | "jpg") {
        return Err(AppError::Validation(format!(
            "unsupported paste_image_format {:?} (expected png or jpg)",
            settings.files.paste_image_format
        )));
    }
    if !matches!(
        settings.explorer.group_by.as_str(),
        "none" | "name" | "modified" | "type" | "size"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported group_by {:?} (expected none, name, modified, type or size)",
            settings.explorer.group_by
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
        explorer: ExplorerViewSettings::default(),
        files: FileSettings::default(),
    }
}

/// Schema 3 had no file-operation choices; schema 4 adds them with the
/// PNG default. A v3 file keeps its language, theme and view options.
fn migrate_v3(value: serde_json::Value) -> Settings {
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            settings.files = FileSettings::default();
            if validate(&settings).is_ok() {
                settings
            } else {
                Settings::default()
            }
        }
        Err(_) => Settings::default(),
    }
}

/// Schema 2 had language and theme only; schema 3 adds the Explorer view
/// options with their defaults. A v2 file keeps its language and theme.
fn migrate_v2(value: serde_json::Value) -> Settings {
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            settings.explorer = ExplorerViewSettings::default();
            if validate(&settings).is_ok() {
                settings
            } else {
                Settings::default()
            }
        }
        Err(_) => Settings::default(),
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
            Some(3) => Ok(migrate_v3(value.clone())),
            Some(2) => Ok(migrate_v2(value.clone())),
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
            let handle = HANDLE(file.as_raw_handle());
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
    file_jobs: Mutex<HashMap<String, FileJob>>,
    transfer_history: Arc<Mutex<transfer_history::TransferHistory>>,
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

/// Size, times, and attributes for the Details pane (no file is opened).
#[tauri::command]
async fn item_details(
    window: WebviewWindow,
    path: String,
) -> Result<fs_service::ItemDetails, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs_service::item_details(Path::new(&path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Paths for the Step 03a commands must be absolute and have no `..`
/// parts, so a path from the UI can only mean what it says. They are not
/// resolved to a link's target: a link is renamed or described itself.
fn validate_absolute_path(path: &str) -> Result<(), String> {
    fs_service::validate_path_input(path).map_err(|e| e.to_string())?;
    let parsed = Path::new(path);
    let has_parent_part = parsed
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir));
    if !parsed.is_absolute() || has_parent_part {
        return Err("path must be absolute, without '..'".to_string());
    }
    Ok(())
}

/// Rename in place; returns the new path. Favorites follow the item.
/// Errors are `rename.<reason>` codes the UI translates.
#[tauri::command]
async fn rename_item(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "rename.not_found".to_string())?;
    if new_name.chars().count() > 255 {
        return Err("rename.invalid_name".to_string());
    }
    let old_path = path.clone();
    let new_path = tauri::async_runtime::spawn_blocking(move || {
        if operation_safety::protected_path(Path::new(&path)) {
            return Err("rename.protected_path".to_string());
        }
        fs_service::rename_in_place(Path::new(&path), &new_name)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| format!("rename.{}", fs_service::rename_error_reason(&e)))
    })
    .await
    .map_err(|e| e.to_string())??;
    // The file is already renamed; a failure to update favorites must not
    // turn that into an error.
    let _ = update_explorer_state(&state, |s| s.move_favorites(&old_path, &new_path));
    Ok(new_path)
}

/// Most sources one file operation may name at once.
pub const MAX_OP_SOURCES: usize = 10_000;

pub struct FileJob {
    progress: fs_service::OpProgress,
    done: bool,
    report: Option<fs_service::OpReport>,
    error: Option<String>,
    token: fs_service::CancellationToken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOpPoll {
    pub progress: fs_service::OpProgress,
    pub done: bool,
    pub report: Option<fs_service::OpReport>,
    pub error: Option<String>,
}

fn parse_conflict_policy(value: &str) -> Result<fs_service::ConflictPolicy, String> {
    match value {
        "replace" => Ok(fs_service::ConflictPolicy::Replace),
        "skip" => Ok(fs_service::ConflictPolicy::Skip),
        "keepBoth" => Ok(fs_service::ConflictPolicy::KeepBoth),
        _ => Err(format!("invalid conflict policy {value:?}")),
    }
}

fn validate_op_sources(sources: &[String]) -> Result<Vec<PathBuf>, String> {
    if sources.is_empty() || sources.len() > MAX_OP_SOURCES {
        return Err("ops.invalid_request".to_string());
    }
    let mut paths = Vec::with_capacity(sources.len());
    for source in sources {
        validate_absolute_path(source).map_err(|_| "ops.not_found".to_string())?;
        paths.push(PathBuf::from(source));
    }
    Ok(paths)
}

/// Existing items a copy/move would land on; the UI asks the user first.
#[tauri::command]
async fn check_conflicts(
    window: WebviewWindow,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<String>, String> {
    ensure_main(window.label())?;
    let sources = validate_op_sources(&sources)?;
    validate_absolute_path(&dest_dir).map_err(|_| "ops.not_found".to_string())?;
    let dest = PathBuf::from(dest_dir);
    tauri::async_runtime::spawn_blocking(move || {
        fs_service::check_conflicts(&sources, &dest)
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<String>>()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Create an empty folder or file ("New"); returns its real path, which
/// has a numbered name if the wanted name was taken. Errors are
/// `ops.<reason>` codes the UI translates.
#[tauri::command]
async fn create_item(
    window: WebviewWindow,
    parent: String,
    name: String,
    kind: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&parent).map_err(|_| "ops.not_found".to_string())?;
    if name.chars().count() > 255 {
        return Err("ops.invalid_name".to_string());
    }
    let kind = match kind.as_str() {
        "folder" => fs_service::CreateKind::Folder,
        "file" => fs_service::CreateKind::File,
        _ => return Err("ops.invalid_request".to_string()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        fs_service::create_item(Path::new(&parent), &name, kind)
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| format!("ops.{}", fs_service::op_error_reason(&e)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One file-operation request (a single argument keeps the command
/// inside clippy's argument limit and groups what belongs together).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOpRequest {
    pub kind: String,
    pub sources: Vec<String>,
    pub dest_dir: Option<String>,
    #[serde(default = "default_conflict_policy")]
    pub conflict: String,
    /// For `restore`: the exact Recycle Bin entries (one per source) that
    /// a Replace sent there, so Undo restores those and not a newer item
    /// with the same original path.
    #[serde(default)]
    pub bin_ids: Option<Vec<String>>,
    /// "foreground" (the user is waiting), "normal" (default) or
    /// "background" (later background tasks: low CPU and disk priority).
    #[serde(default = "default_job_priority")]
    pub priority: String,
    /// The UI may set this only after the separate system-item warning.
    #[serde(default)]
    pub allow_system: bool,
    /// Opaque, in-memory transfer plan used by Undo/Redo.
    #[serde(default)]
    pub transfer_id: Option<String>,
    #[serde(default)]
    pub reverse: bool,
    /// Absent for direct developer callers; present for the UI history.
    #[serde(default)]
    pub retained_transfers: Option<Vec<String>>,
}

fn default_job_priority() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobPriority {
    Foreground,
    Normal,
    Background,
}

fn parse_job_priority(value: &str) -> Result<JobPriority, String> {
    match value {
        "foreground" => Ok(JobPriority::Foreground),
        "normal" => Ok(JobPriority::Normal),
        "background" => Ok(JobPriority::Background),
        _ => Err("ops.invalid_request".to_string()),
    }
}

/// Runs the current worker thread at a job's priority until dropped
/// (pool threads are reused, so the priority is always put back).
struct ThreadPriorityGuard(JobPriority);

impl ThreadPriorityGuard {
    fn enter(priority: JobPriority) -> Self {
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::{
                GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
                THREAD_PRIORITY_ABOVE_NORMAL,
            };
            // SAFETY: the pseudo-handle of the calling thread is always valid.
            unsafe {
                let _ = match priority {
                    JobPriority::Foreground => {
                        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL)
                    }
                    JobPriority::Background => {
                        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN)
                    }
                    JobPriority::Normal => Ok(()),
                };
            }
        }
        Self(priority)
    }
}

impl Drop for ThreadPriorityGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::{
                GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_END,
                THREAD_PRIORITY_NORMAL,
            };
            // SAFETY: as in `enter`.
            unsafe {
                let _ = match self.0 {
                    JobPriority::Foreground => {
                        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL)
                    }
                    JobPriority::Background => {
                        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END)
                    }
                    JobPriority::Normal => Ok(()),
                };
            }
        }
    }
}

/// Validate Recycle Bin entry ids sent by the UI: one per source, each an
/// absolute `$R...` path inside a `$Recycle.Bin` folder.
fn validate_bin_ids(ids: &[String], sources: &[PathBuf]) -> Result<(), String> {
    if ids.len() != sources.len() {
        return Err("ops.invalid_request".to_string());
    }
    for id in ids {
        validate_absolute_path(id).map_err(|_| "ops.invalid_request".to_string())?;
        let path = Path::new(id);
        let in_bin = path
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("$Recycle.Bin"));
        let data_name = path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("$R"));
        if !in_bin || !data_name {
            return Err("ops.invalid_request".to_string());
        }
    }
    Ok(())
}

fn default_conflict_policy() -> String {
    "skip".to_string()
}

/// Create a text file with contents (Paste as file for clipboard text).
/// The wanted name is numbered when taken. Errors are `ops.<reason>`.
#[tauri::command]
async fn create_text_file(
    window: WebviewWindow,
    parent: String,
    name: String,
    contents: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&parent).map_err(|_| "ops.not_found".to_string())?;
    if contents.len() > clipboard::MAX_CLIPBOARD_TEXT_BYTES {
        return Err("ops.too_large".to_string());
    }
    fs_service::validate_new_name(&name).map_err(|_| "ops.invalid_name".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&parent);
        let target = fs_service::unique_destination(dir, &name);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| format!("ops.{}", fs_service::op_error_reason(&e.into())))?;
        use std::io::Write;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("ops.{}", fs_service::op_error_reason(&e.into())))?;
        Ok::<String, String>(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start a file operation as a background job (contract 10). Kinds:
/// copy, move, recycle, restore, permanent. Progress and the final
/// report are drained with `file_op_poll`; `file_op_cancel` asks the
/// engine to stop between chunks and items.
#[tauri::command]
fn file_op_start(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: AppHandle,
    request: FileOpRequest,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let FileOpRequest {
        kind,
        sources,
        dest_dir,
        conflict,
        bin_ids,
        priority,
        allow_system,
        transfer_id,
        reverse,
        retained_transfers,
    } = request;
    let priority = parse_job_priority(&priority)?;
    if !matches!(
        kind.as_str(),
        "copy" | "move" | "recycle" | "restore" | "permanent" | "transfer"
    ) {
        return Err("ops.invalid_request".to_string());
    }
    if let Some(ids) = &retained_transfers {
        if ids.len() > 1024 {
            return Err("ops.undo_limit".to_string());
        }
        for id in ids {
            valid_request_id(id).map_err(|_| "ops.invalid_request".to_string())?;
        }
    }
    let sources = if kind == "transfer" {
        if !sources.is_empty() || bin_ids.is_some() || dest_dir.is_some() {
            return Err("ops.invalid_request".to_string());
        }
        Vec::new()
    } else {
        if transfer_id.is_some() || reverse {
            return Err("ops.invalid_request".to_string());
        }
        validate_op_sources(&sources)?
    };
    let transfer_plan = if kind == "transfer" {
        let id = transfer_id
            .as_deref()
            .ok_or_else(|| "ops.invalid_request".to_string())?;
        valid_request_id(id).map_err(|_| "ops.invalid_request".to_string())?;
        Some(
            state
                .transfer_history
                .lock()
                .map_err(|_| "ops.other".to_string())?
                .get(id)?,
        )
    } else {
        None
    };
    let replaced: Option<Vec<fs_service::ReplacedItem>> = match (kind.as_str(), bin_ids) {
        ("restore", Some(ids)) => {
            validate_bin_ids(&ids, &sources)?;
            Some(
                sources
                    .iter()
                    .zip(ids)
                    .map(|(path, id)| fs_service::ReplacedItem {
                        path: path.clone(),
                        bin_id: Some(id),
                    })
                    .collect(),
            )
        }
        (_, Some(_)) => return Err("ops.invalid_request".to_string()),
        (_, None) => None,
    };
    let policy = parse_conflict_policy(&conflict).map_err(|_| "ops.invalid_request".to_string())?;
    let dest = match (kind.as_str(), dest_dir) {
        ("copy" | "move", Some(dest)) => {
            validate_absolute_path(&dest).map_err(|_| "ops.not_found".to_string())?;
            Some(PathBuf::from(dest))
        }
        ("copy" | "move", None) => return Err("ops.invalid_request".to_string()),
        _ => None,
    };
    let history = Arc::clone(&state.transfer_history);
    let reserve_transfer = matches!(kind.as_str(), "copy" | "move");
    if reserve_transfer {
        history
            .lock()
            .map_err(|_| "ops.other".to_string())?
            .reserve(&request_id, retained_transfers.as_deref())?;
    }
    let token = fs_service::new_cancellation_token();
    {
        let mut jobs = match state.file_jobs.lock() {
            Ok(jobs) => jobs,
            Err(_) => {
                if reserve_transfer {
                    if let Ok(mut history) = history.lock() {
                        history.abort(&request_id);
                    }
                }
                return Err("ops.other".to_string());
            }
        };
        if jobs.contains_key(&request_id) {
            if reserve_transfer {
                if let Ok(mut history) = history.lock() {
                    history.abort(&request_id);
                }
            }
            return Err("ops.invalid_request".to_string());
        }
        jobs.insert(
            request_id.clone(),
            FileJob {
                progress: fs_service::OpProgress {
                    items_done: 0,
                    items_total: sources.len(),
                    bytes_done: 0,
                    bytes_total: 0,
                    current: String::new(),
                },
                done: false,
                report: None,
                error: None,
                token: token.clone(),
            },
        );
    }
    let job_id = request_id;
    tauri::async_runtime::spawn_blocking(move || {
        let _priority = ThreadPriorityGuard::enter(priority);
        let job_state = app.state::<AppState>();
        let set_progress = |progress: &fs_service::OpProgress| {
            if let Ok(mut jobs) = job_state.file_jobs.lock() {
                if let Some(job) = jobs.get_mut(&job_id) {
                    job.progress = progress.clone();
                }
            }
        };
        let mut result = (|| -> Result<fs_service::OpReport, String> {
            let safety_paths: Vec<PathBuf> = if let Some(plan) = &transfer_plan {
                plan.iter()
                    .flat_map(|effect| [effect.from.clone(), effect.to.clone()])
                    .collect()
            } else {
                sources.clone()
            };
            let checked = operation_safety::check(
                &kind,
                &safety_paths,
                dest.as_deref(),
                policy,
                allow_system,
                &token,
                &mut |progress| set_progress(progress),
            )?;
            if checked.cancelled {
                return Ok(fs_service::OpReport {
                    cancelled: true,
                    skipped: checked.skipped,
                    ..Default::default()
                });
            }
            if kind == "transfer" && !checked.skipped.is_empty() {
                return Ok(fs_service::OpReport {
                    skipped: checked.skipped,
                    ..Default::default()
                });
            }
            let sources = checked.sources;
            let mut report = match kind.as_str() {
                "copy" => fs_service::copy_items(
                    &sources,
                    dest.as_ref().expect("dest checked"),
                    policy,
                    &token,
                    &mut |progress| set_progress(progress),
                ),
                "move" => fs_service::move_items(
                    &sources,
                    dest.as_ref().expect("dest checked"),
                    policy,
                    &token,
                    &mut |progress| set_progress(progress),
                ),
                "recycle" => fs_service::recycle_items(&sources, &token, &mut |progress| {
                    set_progress(progress)
                }),
                "restore" => match &replaced {
                    Some(items) => fs_service::restore_bin_items(items),
                    None => fs_service::restore_items(&sources),
                },
                "transfer" => fs_service::ops::apply_transfer(
                    transfer_plan.as_ref().expect("transfer checked"),
                    reverse,
                    &token,
                    &mut |progress| set_progress(progress),
                ),
                _ => fs_service::delete_permanently(&sources, &token, &mut |progress| {
                    set_progress(progress)
                }),
            }
            .map_err(|error| format!("ops.{}", fs_service::op_error_reason(&error)))?;
            report.skipped.extend(checked.skipped);
            Ok(report)
        })();
        if reserve_transfer {
            match history.lock() {
                Ok(mut history) => match &mut result {
                    Ok(report) => {
                        match history.finish(&job_id, std::mem::take(&mut report.transfer)) {
                            Ok(id) => report.transfer_id = id,
                            Err(error) => result = Err(error),
                        }
                    }
                    Err(_) => history.abort(&job_id),
                },
                Err(_) => result = Err("ops.other".to_string()),
            }
        }
        let (report, error) = match result {
            Ok(report) => (Some(report), None),
            Err(error) => (None, Some(error)),
        };
        // Favorites follow completed moves; state failure cannot undo disk work.
        if kind == "move" {
            if let Some(report) = &report {
                let pairs: Vec<(String, String)> = report
                    .completed
                    .iter()
                    .map(|item| {
                        (
                            item.from.to_string_lossy().into_owned(),
                            item.to.to_string_lossy().into_owned(),
                        )
                    })
                    .collect();
                if !pairs.is_empty() {
                    let _ = update_explorer_state(&job_state, |state| {
                        for (from, to) in &pairs {
                            state.move_favorites(from, to);
                        }
                    });
                }
            }
        }
        if let Ok(mut jobs) = job_state.file_jobs.lock() {
            if let Some(job) = jobs.get_mut(&job_id) {
                job.done = true;
                job.report = report;
                job.error = error;
            }
        };
    });
    Ok(())
}

#[tauri::command]
fn file_op_poll(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<FileOpPoll, String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let mut jobs = state
        .file_jobs
        .lock()
        .map_err(|_| "file jobs lock poisoned".to_string())?;
    let Some(job) = jobs.get(&request_id) else {
        return Err(format!("unknown file job {request_id:?}"));
    };
    let poll = FileOpPoll {
        progress: job.progress.clone(),
        done: job.done,
        report: job.report.clone(),
        error: job.error.clone(),
    };
    if poll.done {
        if let Some(id) = poll
            .report
            .as_ref()
            .and_then(|report| report.transfer_id.as_deref())
        {
            state
                .transfer_history
                .lock()
                .map_err(|_| "ops.other".to_string())?
                .delivered(id);
        }
        jobs.remove(&request_id);
    }
    Ok(poll)
}

#[tauri::command]
fn file_op_cancel(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if let Ok(jobs) = state.file_jobs.lock() {
        if let Some(job) = jobs.get(&request_id) {
            job.token.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

/// Favorites are stored exactly as the list shows them (not resolved), so
/// items on mapped drives, subst drives and junctions match later.
#[tauri::command]
async fn add_favorite(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path)?;
    let checked = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs::symlink_metadata(Path::new(&checked))
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    update_explorer_state(&state, |s| s.add_favorite(path))
}

#[tauri::command]
fn remove_favorite(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<fs_service::ExplorerState, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path)?;
    update_explorer_state(&state, |s| s.remove_favorite(&path))
}

#[tauri::command]
async fn list_favorite_items(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<explorer::RecentItem>, String> {
    ensure_main(window.label())?;
    let favorites = {
        let _guard = state
            .explorer_state_lock
            .lock()
            .map_err(|_| "explorer state lock poisoned".to_string())?;
        fs_service::ExplorerState::load(&explorer_state_file(&state.data_dir)).favorites
    };
    tauri::async_runtime::spawn_blocking(move || explorer::favorite_items(&favorites))
        .await
        .map_err(|e| e.to_string())
}

/// The main window's handle as a plain number, so it can cross into the
/// blocking thread that shows a Windows dialog owned by it.
#[cfg(windows)]
fn window_handle(window: &WebviewWindow) -> isize {
    window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
fn window_handle(_window: &WebviewWindow) -> isize {
    0
}

#[tauri::command]
async fn open_item(window: WebviewWindow, path: String) -> Result<shell::OpenOutcome, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || shell::open_item(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_with_dialog(window: WebviewWindow, path: String) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path)?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || shell::open_with_dialog(owner, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn show_properties(window: WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    ensure_main(window.label())?;
    if paths.is_empty() || paths.len() > shell::MAX_PROPERTIES_ITEMS {
        return Err("properties.failed".to_string());
    }
    for path in &paths {
        validate_absolute_path(path)?;
    }
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || shell::show_properties(owner, &paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_in_terminal(window: WebviewWindow, folder: String) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_absolute_path(&folder)?;
    tauri::async_runtime::spawn_blocking(move || shell::open_in_terminal(&folder))
        .await
        .map_err(|e| e.to_string())?
}

/// Put files on the Windows clipboard (Cut or Copy), so Paste works in
/// Explorer and other apps. Errors are `clipboard.<reason>` codes.
#[tauri::command]
async fn clipboard_set_files(
    window: WebviewWindow,
    paths: Vec<String>,
    cut: bool,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if paths.is_empty() || paths.len() > clipboard::MAX_CLIPBOARD_FILES {
        return Err("clipboard.failed".to_string());
    }
    for path in &paths {
        validate_absolute_path(path)?;
    }
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || clipboard::set_files(owner, &paths, cut))
        .await
        .map_err(|e| e.to_string())?
}

/// What the Windows clipboard holds right now (files and how they got
/// there, or text/image flags), without reading any file contents.
#[tauri::command]
async fn clipboard_read(window: WebviewWindow) -> Result<clipboard::ClipboardData, String> {
    ensure_main(window.label())?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || clipboard::read(owner))
        .await
        .map_err(|e| e.to_string())?
}

/// The clipboard's text (size-limited in Rust), for Paste and Paste as file.
#[tauri::command]
async fn clipboard_text(window: WebviewWindow) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || clipboard::text(owner))
        .await
        .map_err(|e| e.to_string())?
}

/// Save the clipboard image as a PNG/JPG file in `parent` (Paste as
/// file). Returns the created path. Errors are `image.<reason>` codes.
#[tauri::command]
async fn clipboard_image_file(
    window: WebviewWindow,
    parent: String,
    base_name: String,
    format: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&parent).map_err(|_| "image.failed".to_string())?;
    if !matches!(format.as_str(), "png" | "jpg") || base_name.chars().count() > 200 {
        return Err("image.failed".to_string());
    }
    fs_service::validate_new_name(&format!("{base_name}.{format}"))
        .map_err(|_| "image.failed".to_string())?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        clipboard::save_image(owner, Path::new(&parent), &base_name, &format)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Empty the Windows clipboard (a cut-paste clears what it consumed).
#[tauri::command]
async fn clipboard_clear(window: WebviewWindow) -> Result<(), String> {
    ensure_main(window.label())?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || clipboard::clear(owner))
        .await
        .map_err(|e| e.to_string())?
}

/// Start a native file drag to other apps; resolves with the effect
/// the drop target chose. A "move" result means the caller finishes
/// the move (the target copied the files; sources are removed).
#[tauri::command]
async fn start_external_drag(window: WebviewWindow, paths: Vec<String>) -> Result<String, String> {
    ensure_main(window.label())?;
    if paths.is_empty() || paths.len() > drag::MAX_DRAG_FILES {
        return Err("drag.failed".to_string());
    }
    for path in &paths {
        validate_absolute_path(path).map_err(|_| "drag.failed".to_string())?;
    }
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || drag::start_drag(owner, &paths))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a shortcut (.lnk) to `target` in `folder` (Alt-drag).
#[tauri::command]
async fn create_shortcut(
    window: WebviewWindow,
    target: String,
    folder: String,
    name: String,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&target).map_err(|_| "shortcut.failed".to_string())?;
    validate_absolute_path(&folder).map_err(|_| "shortcut.failed".to_string())?;
    if name.chars().count() > 200 {
        return Err("shortcut.failed".to_string());
    }
    fs_service::validate_new_name(&format!("{name}.lnk"))
        .map_err(|_| "shortcut.failed".to_string())?;
    let owner = window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        shell::create_shortcut(owner, &target, &folder, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Windows share sheet for files. Windows UI for a window has to be
/// shown from that window's thread, so the work hops to the main thread.
#[tauri::command]
async fn share_items(
    app: AppHandle,
    window: WebviewWindow,
    paths: Vec<String>,
    title: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if paths.is_empty() || paths.len() > shell::MAX_PROPERTIES_ITEMS || title.chars().count() > 260
    {
        return Err("share.failed".to_string());
    }
    for path in &paths {
        validate_absolute_path(path)?;
    }
    let owner = window_handle(&window);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(shell::show_share_sheet(owner, paths, title));
    })
    .map_err(|_| "share.failed".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap_or_else(|_| Err("share.failed".to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Show more options": the classic Windows menu at a point in the window
/// (CSS pixels), run by a helper process with a timeout.
#[tauri::command]
async fn show_classic_menu(
    window: WebviewWindow,
    paths: Vec<String>,
    background: bool,
    x: i32,
    y: i32,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if paths.is_empty() || paths.len() > classic_menu::MAX_ITEMS || (background && paths.len() != 1)
    {
        return Err("moreOptions.failed".to_string());
    }
    for path in &paths {
        validate_absolute_path(path)?;
    }
    let origin = window
        .inner_position()
        .map_err(|_| "moreOptions.failed".to_string())?;
    let scale = window
        .scale_factor()
        .map_err(|_| "moreOptions.failed".to_string())?;
    let request = classic_menu::MenuRequest {
        paths,
        background,
        x: origin.x + (f64::from(x) * scale).round() as i32,
        y: origin.y + (f64::from(y) * scale).round() as i32,
    };
    tauri::async_runtime::spawn_blocking(move || classic_menu::show(&request))
        .await
        .map_err(|e| e.to_string())?
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
    // The classic-menu helper is this executable started with a flag; it
    // never starts the app itself.
    if std::env::args().nth(1).as_deref() == Some(classic_menu::HELPER_FLAG) {
        std::process::exit(classic_menu::run_helper());
    }
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
            file_jobs: Mutex::new(HashMap::new()),
            transfer_history: Arc::new(Mutex::new(transfer_history::TransferHistory::default())),
            explorer_state_lock: Mutex::new(()),
            watch: Mutex::new(None),
            watch_next_id: AtomicU64::new(0),
        })
        .setup(|app| {
            // The main window is created here, not from tauri.conf.json, so
            // its WebView2 profile lives under the app's data folder
            // (R-BG-2): ADPERASTRA_DATA_DIR then isolates every instance,
            // and nothing is written to a second folder in %LOCALAPPDATA%.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or("main window missing from tauri.conf.json")?;
            let profile = webview_profile_dir(&app.state::<AppState>().data_dir);
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(profile)
                .build()?;
            // Snap layouts: subclass the main window so Windows treats the
            // custom maximize button as the native maximize button.
            #[cfg(windows)]
            install_snap_subclass(&window);
            #[cfg(not(windows))]
            let _ = window;
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
            watch_stop,
            item_details,
            rename_item,
            check_conflicts,
            create_item,
            create_text_file,
            file_op_start,
            file_op_poll,
            file_op_cancel,
            add_favorite,
            remove_favorite,
            list_favorite_items,
            open_item,
            open_with_dialog,
            show_properties,
            open_in_terminal,
            share_items,
            show_classic_menu,
            clipboard_set_files,
            clipboard_read,
            clipboard_text,
            clipboard_image_file,
            clipboard_clear,
            start_external_drag,
            create_shortcut
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
    fn webview_profile_lives_under_the_data_folder() {
        // R-BG-2: one data folder per instance, nothing elsewhere. The main
        // window must be built in setup (create: false) to use this folder.
        let data = Path::new(r"C:\data\Adperastra");
        assert_eq!(webview_profile_dir(data), data.join("webview"));
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &config["app"]["windows"][0];
        assert_eq!(main["label"], "main");
        assert_eq!(main["create"], false);
    }

    #[test]
    fn settings_defaults() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.schema_version, 4);
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
        assert_eq!(settings.schema_version, 4);
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
    fn migrate_v2_keeps_language_and_theme_and_adds_view_options() {
        let value = serde_json::json!({
            "schema_version": 2,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "custom", "accent_custom": "#112233" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_custom, "#112233");
        assert_eq!(settings.explorer, ExplorerViewSettings::default());
        assert!(settings.explorer.show_extensions);
        assert!(!settings.explorer.show_hidden);
    }

    #[test]
    fn view_options_validate_group_by() {
        let mut settings = Settings::default();
        for ok in ["none", "name", "modified", "type", "size"] {
            settings.explorer.group_by = ok.to_string();
            assert!(validate(&settings).is_ok(), "{ok}");
        }
        settings.explorer.group_by = "colour".to_string();
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn migrate_v3_keeps_everything_and_adds_file_choices() {
        let value = serde_json::json!({
            "schema_version": 3,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "custom", "accent_custom": "#112233" },
            "explorer": { "show_hidden": true, "show_extensions": false, "item_checkboxes": true, "details_pane": true, "group_by": "type" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
        assert_eq!(settings.explorer.group_by, "type");
        assert_eq!(settings.files.paste_image_format, "png");
        let mut custom = Settings::default();
        custom.files.paste_image_format = "jpg".to_string();
        assert!(validate(&custom).is_ok());
        custom.files.paste_image_format = "gif".to_string();
        assert!(validate(&custom).is_err());
    }

    #[test]
    fn migrate_v3_round_trips() {
        let original = Settings {
            language: "es".to_string(),
            theme: ThemeSettings {
                mode: "light".to_string(),
                accent_source: "custom".to_string(),
                accent_custom: "#FF00AA".to_string(),
            },
            explorer: ExplorerViewSettings {
                show_hidden: true,
                show_extensions: false,
                item_checkboxes: true,
                details_pane: true,
                group_by: "type".to_string(),
            },
            ..Settings::default()
        };
        let value = serde_json::to_value(&original).unwrap();
        assert_eq!(migrate(value).unwrap(), original);
    }

    #[test]
    fn validation_rejects_bad_language() {
        let mut settings = Settings {
            language: "fr".to_string(),
            ..Settings::default()
        };
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
    fn step_03a_commands_take_only_absolute_paths() {
        assert!(validate_absolute_path(r"C:\Users\me\file.txt").is_ok());
        assert!(validate_absolute_path(r"\\?\C:\Users\me").is_ok());
        assert!(validate_absolute_path(r"\\server\share\a.txt").is_ok());
        assert!(validate_absolute_path(r"relative\file.txt").is_err());
        assert!(validate_absolute_path(r"C:\Users\..\Windows").is_err());
        assert!(validate_absolute_path("").is_err());
    }

    #[test]
    fn file_op_request_parsing() {
        assert_eq!(
            parse_conflict_policy("replace").unwrap(),
            fs_service::ConflictPolicy::Replace
        );
        assert_eq!(
            parse_conflict_policy("keepBoth").unwrap(),
            fs_service::ConflictPolicy::KeepBoth
        );
        assert!(parse_conflict_policy("mergeEverything").is_err());
        // The conflict policy defaults to the safe choice.
        let request: FileOpRequest = serde_json::from_value(serde_json::json!({
            "kind": "copy", "sources": ["C:\\a.txt"], "dest_dir": "D:\\out"
        }))
        .unwrap();
        assert_eq!(request.conflict, "skip");
        assert!(!request.allow_system);
        assert!(request.transfer_id.is_none());
        assert!(request.retained_transfers.is_none());
        assert!(!request.reverse);
        let sources = validate_op_sources(&[r"C:\a.txt".to_string()]).unwrap();
        assert_eq!(sources.len(), 1);
        assert!(validate_op_sources(&[]).is_err());
        assert!(validate_op_sources(&[r"relative\a.txt".to_string()]).is_err());
        assert!(validate_op_sources(&[r"C:\a\..\b.txt".to_string()]).is_err());
    }

    #[test]
    fn bin_ids_must_be_recycle_bin_entries_one_per_source() {
        let sources = vec![PathBuf::from(r"C:\docs\a.txt")];
        let good = vec![r"C:\$Recycle.Bin\S-1-5-21-1\$RABC123.txt".to_string()];
        assert!(validate_bin_ids(&good, &sources).is_ok());
        // Wrong count, outside the bin, the $I record, or a relative path.
        assert!(validate_bin_ids(&[], &sources).is_err());
        assert!(validate_bin_ids(&[r"C:\docs\$Rnot-bin.txt".to_string()], &sources).is_err());
        assert!(
            validate_bin_ids(&[r"C:\$Recycle.Bin\S-1\$IABC123.txt".to_string()], &sources).is_err()
        );
        assert!(validate_bin_ids(&[r"$Recycle.Bin\$RABC.txt".to_string()], &sources).is_err());
        // Only restore takes bin ids; the request field is optional.
        let request: FileOpRequest = serde_json::from_value(serde_json::json!({
            "kind": "restore", "sources": ["C:\\a.txt"]
        }))
        .unwrap();
        assert!(request.bin_ids.is_none());
        assert_eq!(request.priority, "normal");
    }

    #[test]
    fn job_priorities_parse_and_reset_the_thread() {
        assert_eq!(
            parse_job_priority("foreground").unwrap(),
            JobPriority::Foreground
        );
        assert_eq!(parse_job_priority("normal").unwrap(), JobPriority::Normal);
        assert_eq!(
            parse_job_priority("background").unwrap(),
            JobPriority::Background
        );
        assert!(parse_job_priority("realtime").is_err());
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::{
                GetCurrentThread, GetThreadPriority, THREAD_PRIORITY_NORMAL,
            };
            let normal = THREAD_PRIORITY_NORMAL.0;
            for priority in [JobPriority::Foreground, JobPriority::Background] {
                let guard = ThreadPriorityGuard::enter(priority);
                // SAFETY: the calling thread's pseudo-handle is always valid.
                let inside = unsafe { GetThreadPriority(GetCurrentThread()) };
                assert!(inside != normal, "{priority:?} did not change the thread");
                drop(guard);
                // SAFETY: as above.
                let after = unsafe { GetThreadPriority(GetCurrentThread()) };
                assert_eq!(after, normal, "{priority:?} was not put back");
            }
        }
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
