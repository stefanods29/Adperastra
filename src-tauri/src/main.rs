//! Adperastra main application backend (Tauri 2).
//!
//! State choice: settings are kept in a small in-memory cache
//! (`AppState.settings`, a `Mutex<Settings>`) loaded once at startup and
//! written through to disk atomically on every save. Everything else
//! (session, help) is intentionally stateless file-per-call work, so no
//! other locks are needed and a crash can never leave a lock poisoned.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![recursion_limit = "256"]

mod window_chrome;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use thiserror::Error;

mod appearance;
mod archive;
mod archive_create;
mod archive_create_publish;
mod archive_create_spool;
mod archive_helper;
mod archive_passwords;
mod archive_rar;
mod archive_read_jobs;
pub mod background;
pub mod background_queue;
mod background_windows;
mod cache;
#[cfg(test)]
mod cache_lease_tests;
mod cache_leases;
mod cache_stamp;
mod classic_menu;
mod clipboard;
mod conversion_settings;
use conversion_settings::ConversionSettings;
pub mod convert;
mod convert_helper;
mod convert_jobs;
mod convert_publish;
mod convert_reports;
mod export_snapshot_types;
pub mod export_snapshots;
mod export_upload;
mod pdf_export_snapshot_resolver;
pub mod snapshot_authorities;

mod preview_setup;
mod psd_raster;
mod raw_helper;
mod special_3mf;
mod special_images;
mod special_metadata;
pub mod special_model_resources;
mod special_output;
pub mod special_scene;
mod special_thumbnails;
mod special_view_backend;
pub mod special_view_jobs;
mod special_view_session;
pub mod special_view_types;
mod special_views;
mod thumbnail_decode;
mod thumbnail_encode;
mod thumbnail_helper;
mod thumbnail_jobs;
mod thumbnail_providers;
mod thumbnails;
#[cfg(windows)]
pub(crate) use clipboard::bounded_stream;
mod app_resident;
mod book_backend;
mod book_loader;
mod book_settings;
#[cfg(windows)]
mod clipboard_image_helper;
mod data_views;
mod drag;
mod explorer;
mod extra_view_backend;
mod extra_view_helper;
mod extra_view_sessions;
mod extra_view_types;
mod extra_views;
mod file_dialogs;
mod file_grant_backing;
mod files;
mod folder_views;
mod font_helper;
mod font_view;
mod gallery;
mod gallery_order;
mod gallery_pages;
mod gallery_scan;
mod gallery_sessions;
mod gallery_source;
mod gallery_types;
mod gallery_watch;
mod helper;
mod helper_frames;
mod integrated_setup;
mod jobs;
mod links;
mod media;
mod metadata;
mod metadata_cache;
mod metadata_helper;
mod metadata_jobs;
mod metadata_preview;
mod metadata_properties;
mod metadata_providers;
mod metadata_source;
mod metadata_types;
mod metadata_windows;
mod ocr;
mod ocr_cache;
mod ocr_helper;
mod ocr_jobs;
mod ocr_languages;
mod ocr_pdf;
mod ocr_pixels;
#[cfg(test)]
mod ocr_step07e_tests;
mod ocr_types;
mod ocr_windows;
mod operation_safety;
mod pdf;
mod pdf_edit;
mod pdf_edit_types;
mod pdf_helper;
mod pdf_helper_process;
mod pdf_helper_types;
mod pdf_jobs;
mod pdf_print;
mod pdf_sessions;
mod pdf_snapshot_resolver;
mod pdf_types;
mod recovery;
mod settings_file;
mod shell;
mod template_jobs;
mod templates;
mod text_save;
mod transfer_history;
mod versions;
mod webview_helper;
mod webview_helper_inputs;
mod webview_helper_protocol;
mod webview_helper_types;
mod webview_private;
mod zone;
include!("integrated_modules.rs");

pub const CURRENT_SCHEMA: u32 = 56;

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
/// (same location the setup launcher uses), else `adperastra-data` under the
/// process folder.
pub fn resolve_data_dir() -> PathBuf {
    if let Ok(value) = std::env::var("ADPERASTRA_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    installed_data_fallback()
}

/// The installed data folder, anchored to the process folder when even
/// `%LOCALAPPDATA%` is unavailable.
fn installed_data_fallback() -> PathBuf {
    if let Ok(value) = std::env::var("LOCALAPPDATA") {
        if !value.trim().is_empty() {
            return PathBuf::from(value).join("Adperastra");
        }
    }
    match std::env::current_dir() {
        Ok(cwd) => cwd.join("adperastra-data"),
        Err(_) => PathBuf::from("adperastra-data"),
    }
}

/// Step 10c E5: the profile base is always absolute and free of `..`.
/// `portable::locate` refuses a traversing explicit base; keeping the
/// installed default here prevents the profile resolver from failing startup.
fn absolute_data_dir(path: PathBuf) -> PathBuf {
    let absolute = if path.is_absolute() {
        path
    } else {
        match std::env::current_dir() {
            Ok(cwd) => cwd.join(&path),
            Err(_) => installed_data_fallback(),
        }
    };
    if absolute
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return installed_data_fallback();
    }
    absolute
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

fn default_light_theme() -> String {
    "light".to_string()
}

fn default_dark_theme() -> String {
    "dark".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeSettings {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_accent_source")]
    pub accent_source: String,
    #[serde(default = "default_accent_custom")]
    pub accent_custom: String,
    /// The theme light mode uses (schema 9, Step 05d).
    #[serde(default = "default_light_theme")]
    pub light_theme: String,
    /// The theme dark mode uses (schema 9, Step 05d).
    #[serde(default = "default_dark_theme")]
    pub dark_theme: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            accent_source: default_accent_source(),
            accent_custom: default_accent_custom(),
            light_theme: default_light_theme(),
            dark_theme: default_dark_theme(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_group_by() -> String {
    "none".to_string()
}

fn default_view_mode() -> String {
    "details".to_string()
}

/// Column view's narrowest column, in pixels (Step 05b D13).
pub const COLUMN_WIDTH_MIN: u32 = 160;
/// Column view's widest column, in pixels (Step 05b D13).
pub const COLUMN_WIDTH_MAX: u32 = 480;

fn default_column_width() -> u32 {
    240
}

/// Every view id in Windows' View-menu order (Step 05a D1).
fn default_view_mode_order() -> Vec<String> {
    fs_service::VIEW_MODES
        .iter()
        .map(|mode| mode.to_string())
        .collect()
}

/// Explorer view options (schema 3, Step 03a): the View menu's toggles and
/// the Sort menu's grouping. Defaults follow the Figma frame (extensions
/// shown) and Windows (hidden items hidden, no check boxes, no Details
/// pane).
/// Schema 6 (Step 05a) adds the view mode, per-folder memory, and the View
/// menu's order and hidden views.
/// Schema 7 (Step 05b) adds the Column view's column width and preview column.
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
    /// The view folders without their own use, and the default view.
    #[serde(default = "default_view_mode")]
    pub view_mode: String,
    /// Remember a view per folder when this is on (Step 05a D7).
    #[serde(default = "default_true")]
    pub remember_view_per_folder: bool,
    /// The View menu's order: all eight view ids, each once.
    #[serde(default = "default_view_mode_order")]
    pub view_mode_order: Vec<String>,
    /// Views left out of the View menu; never `"details"`.
    #[serde(default)]
    pub hidden_view_modes: Vec<String>,
    /// Column view's column width in pixels (schema 7).
    #[serde(default = "default_column_width")]
    pub column_width: u32,
    /// Column view shows a preview of the selected file (schema 7).
    #[serde(default = "default_true")]
    pub column_preview: bool,
    /// Folder backgrounds (schema 31, Step 10d). Off by default.
    #[serde(default)]
    pub folder_backgrounds: bool,
    /// Custom column sets (schema 31, Step 10d). Off by default.
    #[serde(default)]
    pub column_sets_enabled: bool,
}

impl Default for ExplorerViewSettings {
    fn default() -> Self {
        Self {
            show_hidden: false,
            show_extensions: true,
            item_checkboxes: false,
            details_pane: false,
            group_by: default_group_by(),
            view_mode: default_view_mode(),
            remember_view_per_folder: true,
            view_mode_order: default_view_mode_order(),
            hidden_view_modes: Vec::new(),
            column_width: default_column_width(),
            column_preview: true,
            folder_backgrounds: false,
            column_sets_enabled: false,
        }
    }
}

/// Most saved layout presets (Step 05c).
pub const MAX_SAVED_LAYOUTS: usize = 20;
/// Longest saved layout preset name, in characters (Step 05c).
pub const MAX_LAYOUT_NAME: usize = 60;

fn default_toolbar_position() -> String {
    "top".to_string()
}

fn default_toolbar_mode() -> String {
    "full".to_string()
}

fn default_tab_bar_position() -> String {
    "top".to_string()
}

fn default_nav_pane_position() -> String {
    "left".to_string()
}

fn default_details_pane_position() -> String {
    "right".to_string()
}

/// One saved layout preset (schema 8, Step 05c).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedLayout {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_toolbar_position")]
    pub toolbar_position: String,
    #[serde(default = "default_toolbar_mode")]
    pub toolbar_mode: String,
    #[serde(default = "default_tab_bar_position")]
    pub tab_bar_position: String,
    #[serde(default)]
    pub tab_bar_collapsed: bool,
    #[serde(default = "default_nav_pane_position")]
    pub nav_pane_position: String,
    #[serde(default = "default_details_pane_position")]
    pub details_pane_position: String,
}

impl Default for SavedLayout {
    fn default() -> Self {
        Self {
            name: String::new(),
            toolbar_position: default_toolbar_position(),
            toolbar_mode: default_toolbar_mode(),
            tab_bar_position: default_tab_bar_position(),
            tab_bar_collapsed: false,
            nav_pane_position: default_nav_pane_position(),
            details_pane_position: default_details_pane_position(),
        }
    }
}

/// Where the toolbar, tabs and panes go (schema 8, Step 05c). The Details
/// pane's visibility stays `explorer.details_pane`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayoutSettings {
    #[serde(default = "default_toolbar_position")]
    pub toolbar_position: String,
    #[serde(default = "default_toolbar_mode")]
    pub toolbar_mode: String,
    #[serde(default = "default_tab_bar_position")]
    pub tab_bar_position: String,
    #[serde(default)]
    pub tab_bar_collapsed: bool,
    #[serde(default = "default_nav_pane_position")]
    pub nav_pane_position: String,
    #[serde(default = "default_details_pane_position")]
    pub details_pane_position: String,
    #[serde(default)]
    pub saved_presets: Vec<SavedLayout>,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            toolbar_position: default_toolbar_position(),
            toolbar_mode: default_toolbar_mode(),
            tab_bar_position: default_tab_bar_position(),
            tab_bar_collapsed: false,
            nav_pane_position: default_nav_pane_position(),
            details_pane_position: default_details_pane_position(),
            saved_presets: Vec::new(),
        }
    }
}

/// Every UI scale, in percent (schema 9, Step 05d; schema 33 adds 225-300).
pub const UI_SCALES: [u32; 12] = [75, 90, 100, 110, 125, 150, 175, 200, 225, 250, 275, 300];

fn default_ui_scale() -> u32 {
    100
}

fn default_density() -> String {
    "comfortable".to_string()
}

fn default_corner_radius() -> String {
    "standard".to_string()
}

fn default_animations() -> String {
    "full".to_string()
}

/// UI scale, density, corner radius and animations (schema 9, Step 05d).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearanceSettings {
    /// The webview's page zoom in percent, one of `UI_SCALES`.
    #[serde(default = "default_ui_scale")]
    pub ui_scale: u32,
    /// "compact", "comfortable" or "spacious".
    #[serde(default = "default_density")]
    pub density: String,
    /// "square", "standard" or "round".
    #[serde(default = "default_corner_radius")]
    pub corner_radius: String,
    /// "full", "reduced" or "off".
    #[serde(default = "default_animations")]
    pub animations: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            ui_scale: default_ui_scale(),
            density: default_density(),
            corner_radius: default_corner_radius(),
            animations: default_animations(),
        }
    }
}

/// The lengths Settings > Version history offers, in days (schema 10,
/// Step 06b).
pub const KEEP_DAYS: [u32; 4] = [7, 30, 90, 365];

/// The space Settings > Version history offers, in megabytes (schema 10,
/// Step 06b).
pub const MAX_VERSIONS_MB: [u32; 5] = [256, 512, 1024, 2048, 5120];

fn default_keep_days() -> u32 {
    30
}

fn default_max_versions_mb() -> u32 {
    1024
}

/// The versions kept of files the app changes (schema 10, Step 06b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionSettings {
    /// Keep a version before every change the app makes.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// One of `KEEP_DAYS`: how long a version is kept.
    #[serde(default = "default_keep_days")]
    pub keep_days: u32,
    /// One of `MAX_VERSIONS_MB`: how much space versions may use.
    #[serde(default = "default_max_versions_mb")]
    pub max_mb: u32,
}

impl Default for VersionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            keep_days: default_keep_days(),
            max_mb: default_max_versions_mb(),
        }
    }
}

/// Longest My templates folder path the settings accept, in characters
/// (schema 11, Step 06c).
pub const MAX_TEMPLATE_FOLDER_CHARS: usize = 1024;

fn default_my_folder() -> String {
    String::new()
}

/// The folder the user keeps their own file templates in (schema 11,
/// Step 06c).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateSettings {
    /// Empty when no folder is chosen; otherwise an absolute path.
    #[serde(default = "default_my_folder")]
    pub my_folder: String,
}

impl Default for TemplateSettings {
    fn default() -> Self {
        Self {
            my_folder: default_my_folder(),
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

/// Most entries in `open_with`.
pub const MAX_OPEN_WITH: usize = 500;

/// How files open (schema 5, Step 04c): Settings > Opening files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenSettings {
    /// Files from the internet open in protected view.
    #[serde(default = "default_true")]
    pub protected_view: bool,
    /// Extension (lower case, no dot) to "builtin" or "windows". An
    /// extension that is not listed opens in the built-in viewer when
    /// there is one.
    #[serde(default)]
    pub open_with: BTreeMap<String, String>,
}

impl Default for OpenSettings {
    fn default() -> Self {
        Self {
            protected_view: true,
            open_with: BTreeMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Settings sections added by steps 08b-22b, in schema order.
// ---------------------------------------------------------------------------

/// Startup behavior (schema 20, Step 09a; schema 43, Step 16).
fn default_startup_mode() -> String {
    "home".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartupSettings {
    /// `home`, `restore` or `folder`.
    #[serde(default = "default_startup_mode")]
    pub mode: String,
    /// Empty unless `mode` is `folder`; otherwise an absolute path.
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub stay_in_background: bool,
    #[serde(default)]
    pub start_with_windows: bool,
}

impl Default for StartupSettings {
    fn default() -> Self {
        Self {
            mode: default_startup_mode(),
            folder: String::new(),
            stay_in_background: false,
            start_with_windows: false,
        }
    }
}

/// Tabs behavior (schema 21, Step 09c D2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TabsSettings {
    /// Delay before a file drag over a tab activates it; 200..2000 ms.
    #[serde(default = "default_drag_hover_ms")]
    pub drag_hover_ms: u32,
}

fn default_drag_hover_ms() -> u32 {
    600
}

impl Default for TabsSettings {
    fn default() -> Self {
        Self {
            drag_hover_ms: default_drag_hover_ms(),
        }
    }
}

/// Command palette state (schema 22, Step 09d). Only ids are stored.
pub const PALETTE_MAX_RECENT_IDS: usize = 50;
pub const PALETTE_MAX_ID_CHARS: usize = 32_768;

fn default_palette_show_disabled() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaletteSettings {
    #[serde(default)]
    pub recent_ids: Vec<String>,
    #[serde(default = "default_palette_show_disabled")]
    pub show_disabled: bool,
}

impl Default for PaletteSettings {
    fn default() -> Self {
        Self {
            recent_ids: Vec::new(),
            show_disabled: true,
        }
    }
}

/// Copy and move safety (schema 23, Step 09f).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferSettings {
    /// Hash and compare every copy before it is published.
    #[serde(default)]
    pub verify_copies: bool,
    /// One transfer per destination volume at a time. Always true: it is a
    /// safety property, not a preference (the UI shows it disabled).
    #[serde(default = "default_true")]
    pub queue_per_volume: bool,
    /// How many transfers may run at once (1 or 2).
    #[serde(default = "default_transfer_parallel")]
    pub max_parallel: u8,
}

fn default_transfer_parallel() -> u8 {
    2
}

impl Default for TransferSettings {
    fn default() -> Self {
        Self {
            verify_copies: false,
            queue_per_volume: true,
            max_parallel: default_transfer_parallel(),
        }
    }
}

/// Shelf side values (schema 24, Step 09g).
pub const SHELF_WIDTH_DEFAULT: u32 = 320;
pub const SHELF_WIDTH_MIN: u32 = 240;
pub const SHELF_WIDTH_MAX: u32 = 600;
pub const SHELF_HEIGHT_DEFAULT: u32 = 180;
pub const SHELF_HEIGHT_MIN: u32 = 120;
pub const SHELF_HEIGHT_MAX: u32 = 400;

fn default_shelf_side() -> String {
    "bottom".to_string()
}

fn default_shelf_size() -> u32 {
    SHELF_HEIGHT_DEFAULT
}

/// The dockable shelf (schema 24, Step 09g). `size` is a width on the
/// left or right and a height at the bottom; `visible` is the panel's
/// visibility. The shelf is a panel, not a toolbar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShelfSettings {
    #[serde(default)]
    pub visible: bool,
    #[serde(default = "default_shelf_side")]
    pub side: String,
    #[serde(default = "default_shelf_size")]
    pub size: u32,
}

impl Default for ShelfSettings {
    fn default() -> Self {
        Self {
            visible: false,
            side: default_shelf_side(),
            size: default_shelf_size(),
        }
    }
}

/// Crash recovery and diagnostics (schema 25, Step 09h).
fn default_recovery_enabled() -> bool {
    true
}

fn default_recovery_interval() -> u16 {
    10
}

fn default_recovery_max_mib() -> u32 {
    1024
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoverySettings {
    #[serde(default = "default_recovery_enabled")]
    pub enabled: bool,
    #[serde(default = "default_recovery_interval")]
    pub interval_seconds: u16,
    #[serde(default = "default_recovery_max_mib")]
    pub max_mib: u32,
    #[serde(default)]
    pub diagnostics_include_dumps: bool,
}

impl Default for RecoverySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_seconds: default_recovery_interval(),
            max_mib: default_recovery_max_mib(),
            diagnostics_include_dumps: false,
        }
    }
}

impl RecoverySettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(10..=300).contains(&self.interval_seconds) {
            return Err("recovery interval must be 10..=300".to_string());
        }
        if !(128..=4096).contains(&self.max_mib) {
            return Err("recovery max_mib must be 128..=4096".to_string());
        }
        Ok(())
    }
}

/// Folder size measurement (schema 36, Step 11c).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct FolderSizeSettings {
    pub enabled: bool,
    pub network: bool,
    pub details: bool,
}

/// Pack catalog state (schema 37, Step 12a).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PackCatalogSettings {
    pub last_checked_unix: Option<u64>,
}

/// Office viewer preferences (schema 38, Step 13).
fn default_office_idle() -> u16 {
    60
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeViewSettings {
    #[serde(default = "default_true")]
    pub prefer_accurate: bool,
    #[serde(default)]
    pub show_comments: bool,
    #[serde(default = "default_true")]
    pub keep_engine_warm: bool,
    #[serde(default = "default_office_idle")]
    pub idle_seconds: u16,
}

impl Default for OfficeViewSettings {
    fn default() -> Self {
        Self {
            prefer_accurate: true,
            show_comments: false,
            keep_engine_warm: true,
            idle_seconds: default_office_idle(),
        }
    }
}

/// PDF annotation author (schema 39, Step 14a). Never read from the login.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PdfToolsSettings {
    pub author: String,
}

impl PdfToolsSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.author.chars().count() > 128 {
            return Err(AppError::Validation(
                "pdf_tools.author is too long".to_string(),
            ));
        }
        Ok(())
    }
}

/// Image editor preferences (schema 40, Step 14b; schema 48, Step 18a).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageEditorSettings {
    pub default_mode: String,
    pub background_rgba: [u8; 4],
    pub history_limit_mb: u32,
    pub advanced: bool,
    pub selection_tolerance: u8,
    pub show_history: bool,
}

impl Default for ImageEditorSettings {
    fn default() -> Self {
        Self {
            default_mode: "edit".to_string(),
            background_rgba: [255, 255, 255, 255],
            history_limit_mb: 256,
            advanced: false,
            selection_tolerance: 15,
            show_history: false,
        }
    }
}

/// Media editor preferences (schema 42, Step 15).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaEditorSettings {
    #[serde(default = "default_media_preview_quality")]
    pub preview_quality: String,
    #[serde(default = "default_true")]
    pub waveform: bool,
    #[serde(default = "default_true")]
    pub keep_pitch: bool,
}

fn default_media_preview_quality() -> String {
    "960".to_string()
}

impl Default for MediaEditorSettings {
    fn default() -> Self {
        Self {
            preview_quality: default_media_preview_quality(),
            waveform: true,
            keep_pitch: true,
        }
    }
}

/// AI writing preferences (schema 47, Step 17d D8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Default)]
pub struct AiInlineEnabledTypes {
    #[serde(default)]
    pub text: bool,
    #[serde(default)]
    pub markdown: bool,
    #[serde(default)]
    pub code: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Default)]
pub struct AiInlineSettings {
    #[serde(default)]
    pub inline_enabled: bool,
    #[serde(default)]
    pub enabled_types: AiInlineEnabledTypes,
}

/// Sheet AI opt-ins (schema 54, Step 21b).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SheetAiSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub experimental_actions: Vec<office_sheet_ai_types::SheetAiAction>,
}

/// Deck AI opt-ins (schema 56, Step 22b).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeckAiSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub experimental_actions: Vec<String>,
}

/// Nested AI preferences. Each block arrived in its own schema:
/// writing 47, documents 52, sheets 54, decks 56.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct AiSettings {
    #[serde(default)]
    pub writing: AiInlineSettings,
    #[serde(default)]
    pub documents: office_document_ai_types::DocumentAiSettings,
    #[serde(default)]
    pub sheets: SheetAiSettings,
    #[serde(default)]
    pub decks: DeckAiSettings,
}

/// Timeline preview quality (schema 49, Step 19a).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelinePreviewQuality {
    Source,
    #[serde(rename = "512")]
    Edge512,
    #[serde(rename = "960")]
    Edge960,
}

fn default_timeline_quality() -> TimelinePreviewQuality {
    TimelinePreviewQuality::Edge960
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelineSettings {
    #[serde(default = "default_timeline_quality")]
    pub preview_quality: TimelinePreviewQuality,
    #[serde(default = "default_true")]
    pub snap_enabled: bool,
    #[serde(default)]
    pub proxy_enabled: bool,
}

impl Default for TimelineSettings {
    fn default() -> Self {
        Self {
            preview_quality: default_timeline_quality(),
            snap_enabled: true,
            proxy_enabled: false,
        }
    }
}

/// Office editing (schema 50, Step 20a). Loading settings never grants a
/// capability: the engine approval and the explicit switch stay separate.
fn default_office_edit_idle() -> u16 {
    5
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeEditSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub autosave_default: bool,
    #[serde(default = "default_office_edit_idle")]
    pub idle_minutes: u16,
}

impl Default for OfficeEditSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            autosave_default: false,
            idle_minutes: default_office_edit_idle(),
        }
    }
}

/// Document editor preferences (schema 51, Step 20b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentEditorSettings {
    #[serde(default)]
    pub autosave_default: bool,
    #[serde(default = "default_true")]
    pub show_ruler: bool,
    #[serde(default)]
    pub show_navigation: bool,
    #[serde(default = "default_true")]
    pub spelling: bool,
}

impl Default for DocumentEditorSettings {
    fn default() -> Self {
        Self {
            autosave_default: false,
            show_ruler: true,
            show_navigation: false,
            spelling: true,
        }
    }
}

/// Sheet editor preferences (schema 53, Step 21a).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetEditorSettings {
    #[serde(default = "default_true")]
    pub show_formula_bar: bool,
    #[serde(default = "default_true")]
    pub show_gridlines: bool,
    #[serde(default = "default_true")]
    pub show_headings: bool,
    #[serde(default = "default_sheet_zoom")]
    pub default_zoom: f64,
}

fn default_sheet_zoom() -> f64 {
    100.0
}

impl Default for SheetEditorSettings {
    fn default() -> Self {
        Self {
            show_formula_bar: true,
            show_gridlines: true,
            show_headings: true,
            default_zoom: default_sheet_zoom(),
        }
    }
}

/// Deck editor preferences (schema 55, Step 22a).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeckEditorSettings {
    #[serde(default = "default_true")]
    pub show_notes: bool,
    #[serde(default)]
    pub snap_to_grid: bool,
    #[serde(default = "default_deck_aspect")]
    pub default_aspect: String,
    #[serde(default = "default_true")]
    pub presenter_view: bool,
}

fn default_deck_aspect() -> String {
    "wide".to_string()
}

impl Default for DeckEditorSettings {
    fn default() -> Self {
        Self {
            show_notes: true,
            snap_to_grid: false,
            default_aspect: default_deck_aspect(),
            presenter_view: true,
        }
    }
}

/// An extension as `open_with` stores it: 1 to 16 characters from a-z,
/// 0-9, `_`, `+` and `-`.
fn is_valid_extension_key(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 16
        && ext
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '+' | '-'))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    #[serde(default)]
    pub open: OpenSettings,
    #[serde(default)]
    pub layout: LayoutSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub versions: VersionSettings,
    #[serde(default)]
    pub templates: TemplateSettings,
    #[serde(default)]
    pub background: background::BackgroundSettings,
    #[serde(default)]
    pub cache: background::CacheSettings,
    #[serde(default)]
    pub gallery: gallery_types::GallerySettings,
    #[serde(default)]
    pub ocr: ocr_types::OcrSettings,
    #[serde(default)]
    pub reading: book_settings::ReadingSettings,
    #[serde(default)]
    pub conversion: ConversionSettings,
    /// Schema 18 (Step 08c).
    #[serde(default)]
    pub privacy: privacy::PrivacySettings,
    /// Schema 19 (Step 08d).
    #[serde(default)]
    pub updates: updates::UpdateSettings,
    /// Schema 20 (Step 09a); schema 43 adds the two resident switches.
    #[serde(default)]
    pub startup: StartupSettings,
    /// Schema 21 (Step 09c).
    #[serde(default)]
    pub tabs: TabsSettings,
    /// Schema 22 (Step 09d).
    #[serde(default)]
    pub palette: PaletteSettings,
    /// Schema 23 (Step 09f).
    #[serde(default)]
    pub transfers: TransferSettings,
    /// Schema 24 (Step 09g).
    #[serde(default)]
    pub shelf: ShelfSettings,
    /// Schema 25 (Step 09h).
    #[serde(default)]
    pub recovery: RecoverySettings,
    /// Schema 26 (Step 09j).
    #[serde(default)]
    pub clipboard_history: clipboard_history_types::ClipboardHistorySettings,
    /// Schema 27 (Step 09k).
    #[serde(default)]
    pub locked: locked_store::types::LockedSettings,
    /// Schema 28 (Step 10a).
    #[serde(default)]
    pub theme_custom: fs_service::theme_data::ThemeCustomSettings,
    /// Schema 29 (Step 10b).
    #[serde(default)]
    pub toolbar_custom: command_layout_types::ToolbarCustomSettings,
    /// Schema 29 (Step 10b).
    #[serde(default)]
    pub keyboard_custom: keyboard_map_types::KeyboardCustomSettings,
    /// Schema 30 (Step 10c).
    #[serde(default)]
    pub tab_options: preferences_validation::TabOptions,
    /// Schema 30 (Step 10c).
    #[serde(default)]
    pub format_options: preferences_validation::FormatOptions,
    /// Schema 30 (Step 10c).
    #[serde(default)]
    pub behavior: preferences_validation::BehaviorSettings,
    /// Schema 32 (Step 10e).
    #[serde(default)]
    pub shell_custom: shell_custom_types::ShellCustomization,
    /// Schema 33 (Step 10f).
    #[serde(default)]
    pub accessibility: accessibility_types::AccessibilitySettings,
    /// Schema 34 (Step 11a).
    #[serde(default)]
    pub search: search_index::SearchSettings,
    /// Schema 35 (Step 11b).
    #[serde(default)]
    pub views: crate::smart_view_types::ViewsSettings,
    /// Schema 36 (Step 11c).
    #[serde(default)]
    pub folder_sizes: FolderSizeSettings,
    /// Schema 37 (Step 12a).
    #[serde(default)]
    pub pack_catalog: PackCatalogSettings,
    /// Schema 38 (Step 13).
    #[serde(default)]
    pub office_view: OfficeViewSettings,
    /// Schema 39 (Step 14a).
    #[serde(default)]
    pub pdf_tools: PdfToolsSettings,
    /// Schema 40 (Step 14b); schema 48 adds layers and selections.
    #[serde(default)]
    pub image_editor: ImageEditorSettings,
    /// Schema 41 (Step 14c).
    #[serde(default)]
    pub local_ai: ai_runtime::types_ui::LocalAiSettings,
    /// Schema 42 (Step 15).
    #[serde(default)]
    pub media_editor: MediaEditorSettings,
    /// Schema 44 (Step 17a).
    #[serde(default)]
    pub assistant: crate::assistant_types::AssistantSettings,
    /// Schema 45 (Step 17b).
    #[serde(default)]
    pub ai_actions: ai_action_types::AiActionsSettings,
    /// Schema 46 (Step 17c).
    #[serde(default)]
    pub ai_search: ai_search_types::AiSearchSettings,
    /// Schema 47 (Step 17d); 52/54/56 add documents, sheets and decks.
    #[serde(default)]
    pub ai: AiSettings,
    /// Schema 49 (Step 19a).
    #[serde(default)]
    pub timeline: TimelineSettings,
    /// Schema 50 (Step 20a).
    #[serde(default)]
    pub office_edit: OfficeEditSettings,
    /// Schema 51 (Step 20b).
    #[serde(default)]
    pub document_editor: DocumentEditorSettings,
    /// Schema 53 (Step 21a).
    #[serde(default)]
    pub sheet_editor: SheetEditorSettings,
    /// Schema 55 (Step 22a).
    #[serde(default)]
    pub deck_editor: DeckEditorSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA,
            language: default_language(),
            theme: ThemeSettings::default(),
            explorer: ExplorerViewSettings::default(),
            files: FileSettings::default(),
            open: OpenSettings::default(),
            layout: LayoutSettings::default(),
            appearance: AppearanceSettings::default(),
            versions: VersionSettings::default(),
            templates: TemplateSettings::default(),
            background: background::BackgroundSettings::default(),
            cache: background::CacheSettings::default(),
            gallery: gallery_types::GallerySettings::default(),
            ocr: ocr_types::OcrSettings::default(),
            reading: book_settings::ReadingSettings::default(),
            conversion: ConversionSettings::default(),
            privacy: privacy::PrivacySettings::default(),
            updates: updates::UpdateSettings::default(),
            startup: StartupSettings::default(),
            tabs: TabsSettings::default(),
            palette: PaletteSettings::default(),
            transfers: TransferSettings::default(),
            shelf: ShelfSettings::default(),
            recovery: RecoverySettings::default(),
            clipboard_history: clipboard_history_types::ClipboardHistorySettings::default(),
            locked: locked_store::types::LockedSettings::default(),
            theme_custom: fs_service::theme_data::ThemeCustomSettings::default(),
            toolbar_custom: command_layout_types::ToolbarCustomSettings::default(),
            keyboard_custom: keyboard_map_types::KeyboardCustomSettings::default(),
            tab_options: preferences_validation::TabOptions::default(),
            format_options: preferences_validation::FormatOptions::default(),
            behavior: preferences_validation::BehaviorSettings::default(),
            shell_custom: shell_custom_types::ShellCustomization::default(),
            accessibility: accessibility_types::AccessibilitySettings::default(),
            search: search_index::SearchSettings::default(),
            views: crate::smart_view_types::ViewsSettings::default(),
            folder_sizes: FolderSizeSettings::default(),
            pack_catalog: PackCatalogSettings::default(),
            office_view: OfficeViewSettings::default(),
            pdf_tools: PdfToolsSettings::default(),
            image_editor: ImageEditorSettings::default(),
            local_ai: ai_runtime::types_ui::LocalAiSettings::default(),
            media_editor: MediaEditorSettings::default(),
            assistant: crate::assistant_types::AssistantSettings::default(),
            ai_actions: ai_action_types::AiActionsSettings::default(),
            ai_search: ai_search_types::AiSearchSettings::default(),
            ai: AiSettings::default(),
            timeline: TimelineSettings::default(),
            office_edit: OfficeEditSettings::default(),
            document_editor: DocumentEditorSettings::default(),
            sheet_editor: SheetEditorSettings::default(),
            deck_editor: DeckEditorSettings::default(),
        }
    }
}

fn is_valid_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// One layout choice must be one of its allowed values.
fn check_layout_choice(
    what: &str,
    field: &str,
    value: &str,
    allowed: &[&str],
) -> Result<(), AppError> {
    if !allowed.contains(&value) {
        return Err(AppError::Validation(format!(
            "{what}: unsupported {field} {value:?} (expected {})",
            allowed.join(", ")
        )));
    }
    Ok(())
}

/// The five layout choices of one layout (a section or a saved preset).
fn check_layout_values(
    toolbar_position: &str,
    toolbar_mode: &str,
    tab_bar_position: &str,
    nav_pane_position: &str,
    details_pane_position: &str,
    what: &str,
) -> Result<(), AppError> {
    check_layout_choice(
        what,
        "toolbar_position",
        toolbar_position,
        &["top", "bottom", "left", "right"],
    )?;
    check_layout_choice(
        what,
        "toolbar_mode",
        toolbar_mode,
        &["full", "compact", "iconsOnly", "autoHide"],
    )?;
    check_layout_choice(
        what,
        "tab_bar_position",
        tab_bar_position,
        &["top", "bottom", "left", "right"],
    )?;
    check_layout_choice(
        what,
        "nav_pane_position",
        nav_pane_position,
        &["left", "right", "hidden"],
    )?;
    check_layout_choice(
        what,
        "details_pane_position",
        details_pane_position,
        &["right", "bottom"],
    )?;
    Ok(())
}

pub fn validate(settings: &Settings) -> Result<(), AppError> {
    settings
        .background
        .validate()
        .map_err(AppError::Validation)?;
    settings.cache.validate().map_err(AppError::Validation)?;
    if !matches!(
        settings.conversion.default_destination.as_str(),
        "source" | "ask"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported conversion.default_destination {:?}",
            settings.conversion.default_destination
        )));
    }
    if !(1..=100).contains(&settings.conversion.default_quality) {
        return Err(AppError::Validation(
            "conversion.default_quality must be 1-100".to_string(),
        ));
    }
    if !matches!(settings.conversion.concurrent_jobs, 1 | 2) {
        return Err(AppError::Validation(
            "conversion.concurrent_jobs must be 1 or 2".to_string(),
        ));
    }
    if let Some(preset) = &settings.conversion.last_preset {
        if uuid::Uuid::parse_str(preset).is_err() {
            return Err(AppError::Validation(
                "conversion.last_preset is not a UUID".to_string(),
            ));
        }
    }
    if !settings.conversion.prompt_for_losses {
        return Err(AppError::Validation(
            "conversion.prompt_for_losses must stay true".to_string(),
        ));
    }
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
    if !matches!(
        settings.theme.light_theme.as_str(),
        "light" | "bright" | "paper"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported light_theme {:?} (expected light, bright or paper)",
            settings.theme.light_theme
        )));
    }
    if !matches!(
        settings.theme.dark_theme.as_str(),
        "dark" | "amoled" | "highContrast"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported dark_theme {:?} (expected dark, amoled or highContrast)",
            settings.theme.dark_theme
        )));
    }
    if !UI_SCALES.contains(&settings.appearance.ui_scale) {
        return Err(AppError::Validation(format!(
            "unsupported ui_scale {} (expected one of {UI_SCALES:?})",
            settings.appearance.ui_scale
        )));
    }
    if !matches!(
        settings.appearance.density.as_str(),
        "compact" | "comfortable" | "spacious"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported density {:?} (expected compact, comfortable or spacious)",
            settings.appearance.density
        )));
    }
    if !matches!(
        settings.appearance.corner_radius.as_str(),
        "square" | "standard" | "round"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported corner_radius {:?} (expected square, standard or round)",
            settings.appearance.corner_radius
        )));
    }
    if !matches!(
        settings.appearance.animations.as_str(),
        "full" | "reduced" | "off"
    ) {
        return Err(AppError::Validation(format!(
            "unsupported animations {:?} (expected full, reduced or off)",
            settings.appearance.animations
        )));
    }
    if !KEEP_DAYS.contains(&settings.versions.keep_days) {
        return Err(AppError::Validation(format!(
            "unsupported versions.keep_days {} (expected one of {KEEP_DAYS:?})",
            settings.versions.keep_days
        )));
    }
    if !MAX_VERSIONS_MB.contains(&settings.versions.max_mb) {
        return Err(AppError::Validation(format!(
            "unsupported versions.max_mb {} (expected one of {MAX_VERSIONS_MB:?})",
            settings.versions.max_mb
        )));
    }
    if !settings.templates.my_folder.is_empty() {
        if settings.templates.my_folder.chars().count() > MAX_TEMPLATE_FOLDER_CHARS {
            return Err(AppError::Validation(format!(
                "templates.my_folder is longer than {MAX_TEMPLATE_FOLDER_CHARS} characters"
            )));
        }
        validate_absolute_path(&settings.templates.my_folder).map_err(|_| {
            AppError::Validation(format!(
                "templates.my_folder {:?} is not an absolute path",
                settings.templates.my_folder
            ))
        })?;
    }
    gallery_types::validate_gallery_settings(&settings.gallery)
        .map_err(|code| AppError::Validation(format!("gallery settings: {code}")))?;
    settings
        .search
        .validate()
        .map_err(|_| AppError::Validation("search: invalid settings".to_string()))?;
    settings.ocr.validate().map_err(AppError::Validation)?;
    if let Some(error) = settings.reading.validate() {
        return Err(AppError::Validation(format!("reading: {error}")));
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
    if !fs_service::is_view_mode(&settings.explorer.view_mode) {
        return Err(AppError::Validation(format!(
            "unsupported view_mode {:?} (expected one of {})",
            settings.explorer.view_mode,
            fs_service::VIEW_MODES.join(", ")
        )));
    }
    if settings.explorer.view_mode_order.len() > 16 {
        return Err(AppError::Validation(format!(
            "view_mode_order has {} entries (at most 16)",
            settings.explorer.view_mode_order.len()
        )));
    }
    let mut seen_order: Vec<&str> = Vec::new();
    for mode in &settings.explorer.view_mode_order {
        if !fs_service::is_view_mode(mode) {
            return Err(AppError::Validation(format!(
                "unsupported view_mode_order entry {mode:?}"
            )));
        }
        if seen_order.contains(&mode.as_str()) {
            return Err(AppError::Validation(format!(
                "view_mode_order lists {mode:?} twice"
            )));
        }
        seen_order.push(mode.as_str());
    }
    let mut seen_hidden: Vec<&str> = Vec::new();
    for mode in &settings.explorer.hidden_view_modes {
        if !fs_service::is_view_mode(mode) || mode == "details" {
            return Err(AppError::Validation(format!(
                "unsupported hidden_view_modes entry {mode:?}"
            )));
        }
        if seen_hidden.contains(&mode.as_str()) {
            return Err(AppError::Validation(format!(
                "hidden_view_modes lists {mode:?} twice"
            )));
        }
        seen_hidden.push(mode.as_str());
    }
    if !(COLUMN_WIDTH_MIN..=COLUMN_WIDTH_MAX).contains(&settings.explorer.column_width) {
        return Err(AppError::Validation(format!(
            "column_width {} is outside {COLUMN_WIDTH_MIN}..={COLUMN_WIDTH_MAX}",
            settings.explorer.column_width
        )));
    }
    if settings.open.open_with.len() > MAX_OPEN_WITH {
        return Err(AppError::Validation(format!(
            "open_with has {} entries (at most {MAX_OPEN_WITH})",
            settings.open.open_with.len()
        )));
    }
    for (ext, choice) in &settings.open.open_with {
        if !is_valid_extension_key(ext) || !matches!(choice.as_str(), "builtin" | "windows") {
            return Err(AppError::Validation(format!(
                "unsupported open_with entry {ext:?}: {choice:?} (expected builtin or windows)"
            )));
        }
    }
    check_layout_values(
        &settings.layout.toolbar_position,
        &settings.layout.toolbar_mode,
        &settings.layout.tab_bar_position,
        &settings.layout.nav_pane_position,
        &settings.layout.details_pane_position,
        "layout",
    )?;
    if settings.layout.saved_presets.len() > MAX_SAVED_LAYOUTS {
        return Err(AppError::Validation(format!(
            "layout.saved_presets has {} entries (at most {MAX_SAVED_LAYOUTS})",
            settings.layout.saved_presets.len()
        )));
    }
    let mut seen_layout_names: Vec<String> = Vec::new();
    for preset in &settings.layout.saved_presets {
        if preset.name.is_empty() {
            return Err(AppError::Validation(
                "layout: a saved preset has no name".to_string(),
            ));
        }
        if preset.name != preset.name.trim() {
            return Err(AppError::Validation(format!(
                "layout: saved preset name {:?} has spaces at its ends",
                preset.name
            )));
        }
        if preset.name.chars().count() > MAX_LAYOUT_NAME {
            return Err(AppError::Validation(format!(
                "layout: saved preset name {:?} is longer than {MAX_LAYOUT_NAME} characters",
                preset.name
            )));
        }
        let lower_name = preset.name.to_lowercase();
        if seen_layout_names.contains(&lower_name) {
            return Err(AppError::Validation(format!(
                "layout: saved preset name {:?} is used twice",
                preset.name
            )));
        }
        seen_layout_names.push(lower_name);
        check_layout_values(
            &preset.toolbar_position,
            &preset.toolbar_mode,
            &preset.tab_bar_position,
            &preset.nav_pane_position,
            &preset.details_pane_position,
            "saved preset",
        )?;
    }
    settings.privacy.validate().map_err(AppError::Validation)?;
    settings.updates.validate().map_err(AppError::Validation)?;
    check_layout_choice(
        "startup",
        "mode",
        &settings.startup.mode,
        &["home", "restore", "folder"],
    )?;
    if !settings.startup.folder.is_empty() {
        validate_absolute_path(&settings.startup.folder).map_err(|_| {
            AppError::Validation(format!(
                "startup.folder {:?} is not an absolute path",
                settings.startup.folder
            ))
        })?;
    }
    if settings.startup.start_with_windows && !settings.startup.stay_in_background {
        return Err(AppError::Validation(
            "startup.start_with_windows requires startup.stay_in_background".to_string(),
        ));
    }
    if !(200..=2000).contains(&settings.tabs.drag_hover_ms) {
        return Err(AppError::Validation(format!(
            "unsupported tabs.drag_hover_ms {} (expected 200..2000)",
            settings.tabs.drag_hover_ms
        )));
    }
    if settings.palette.recent_ids.len() > PALETTE_MAX_RECENT_IDS
        || settings.palette.recent_ids.iter().any(|id| {
            id.is_empty() || id.chars().count() > PALETTE_MAX_ID_CHARS || id.contains('\0')
        })
    {
        return Err(AppError::Validation("palette.invalid".to_string()));
    }
    if !(1..=2).contains(&settings.transfers.max_parallel) {
        return Err(AppError::Validation(
            "transfers.max_parallel must be 1 or 2".to_string(),
        ));
    }
    if !settings.transfers.queue_per_volume {
        return Err(AppError::Validation(
            "transfers.queue_per_volume must stay true".to_string(),
        ));
    }
    check_layout_choice(
        "shelf",
        "side",
        &settings.shelf.side,
        &["left", "right", "bottom"],
    )?;
    let (shelf_min, shelf_max) = if settings.shelf.side == "bottom" {
        (SHELF_HEIGHT_MIN, SHELF_HEIGHT_MAX)
    } else {
        (SHELF_WIDTH_MIN, SHELF_WIDTH_MAX)
    };
    if settings.shelf.size < shelf_min || settings.shelf.size > shelf_max {
        return Err(AppError::Validation(format!(
            "shelf: size {} is outside {}..={} for side {}",
            settings.shelf.size, shelf_min, shelf_max, settings.shelf.side
        )));
    }
    settings.recovery.validate().map_err(AppError::Validation)?;
    settings
        .clipboard_history
        .validate()
        .map_err(AppError::Validation)?;
    settings
        .locked
        .validate()
        .map_err(|_| AppError::Validation("locked.auto_lock_minutes is invalid".to_string()))?;
    fs_service::theme_data::validate_theme_custom_settings(&settings.theme_custom)
        .map_err(|_| AppError::Validation("theme_custom is not valid".to_string()))?;
    command_layout_types::validate_toolbar_custom_settings(&settings.toolbar_custom)
        .map_err(AppError::Validation)?;
    keyboard_map_types::validate_keyboard_custom_settings(&settings.keyboard_custom)
        .map_err(AppError::Validation)?;
    preferences_validation::validate_tab_options(&settings.tab_options)
        .map_err(AppError::Validation)?;
    preferences_validation::validate_format_options(&settings.format_options)
        .map_err(AppError::Validation)?;
    preferences_validation::validate_behavior(&settings.behavior).map_err(AppError::Validation)?;
    shell_custom_validation::validate_shell_custom(&settings.shell_custom)
        .map_err(AppError::Validation)?;
    accessibility_types::validate_accessibility_settings(&settings.accessibility)
        .map_err(AppError::Validation)?;
    settings
        .search
        .validate()
        .map_err(|error| AppError::Validation(error.code().to_string()))?;
    if let Some(unix) = settings.pack_catalog.last_checked_unix {
        if unix > 9_007_199_254_740_991 {
            return Err(AppError::Validation(
                "pack_catalog.last_checked_unix is unsafe".to_string(),
            ));
        }
    }
    crate::background_policy::validate_quiet_hours(&crate::background_policy::QuietHours {
        enabled: settings.background.quiet_hours.enabled,
        start_minute: settings.background.quiet_hours.start_minute,
        end_minute: settings.background.quiet_hours.end_minute,
    })
    .map_err(AppError::Validation)?;
    crate::background_policy::validate_cpu_percent(settings.background.cpu_percent)
        .map_err(AppError::Validation)?;
    if settings.office_view.idle_seconds != default_office_idle() {
        return Err(AppError::Validation(
            "office_view.idle_seconds is fixed at 60".to_string(),
        ));
    }
    settings.pdf_tools.validate()?;
    if !matches!(settings.image_editor.default_mode.as_str(), "edit" | "draw") {
        return Err(AppError::Validation(
            "image_editor.default_mode is invalid".to_string(),
        ));
    }
    if !(64..=256).contains(&settings.image_editor.history_limit_mb) {
        return Err(AppError::Validation(
            "image_editor.history_limit_mb is invalid".to_string(),
        ));
    }
    if settings.image_editor.selection_tolerance > 100 {
        return Err(AppError::Validation(
            "image_editor.selection_tolerance is invalid".to_string(),
        ));
    }
    settings
        .local_ai
        .validate()
        .map_err(|_| AppError::Validation("settings.local_ai".to_string()))?;
    if !matches!(
        settings.media_editor.preview_quality.as_str(),
        "source" | "960" | "512"
    ) {
        return Err(AppError::Validation(
            "media_editor.preview_quality is invalid".to_string(),
        ));
    }
    settings
        .assistant
        .validate()
        .map_err(AppError::Validation)?;
    settings
        .ai_actions
        .validate()
        .map_err(AppError::Validation)?;
    settings
        .ai_search
        .validate(&settings.search.roots, &[])
        .map_err(|error| AppError::Validation(error.code().to_string()))?;
    {
        let mut seen: Vec<office_document_ai_types::DocumentAiAction> = Vec::new();
        for action in &settings.ai.documents.experimental_actions {
            if seen.contains(action) {
                return Err(AppError::Validation(
                    "ai.documents.experimental_actions lists an action twice".to_string(),
                ));
            }
            seen.push(*action);
        }
    }
    if !settings.sheet_editor.default_zoom.is_finite()
        || !(25.0..=400.0).contains(&settings.sheet_editor.default_zoom)
    {
        return Err(AppError::Validation(
            "sheet_editor.default_zoom must be 25..=400".to_string(),
        ));
    }
    {
        let mut seen: Vec<office_sheet_ai_types::SheetAiAction> = Vec::new();
        for action in &settings.ai.sheets.experimental_actions {
            if seen.contains(action) {
                return Err(AppError::Validation(
                    "ai.sheets.experimental_actions lists an action twice".to_string(),
                ));
            }
            seen.push(action.clone());
        }
    }
    if !matches!(settings.deck_editor.default_aspect.as_str(), "wide") {
        return Err(AppError::Validation(
            "deck_editor.default_aspect must stay wide".to_string(),
        ));
    }
    {
        let allowed = ["create", "add", "shorten", "notes", "layout", "style"];
        let mut seen = Vec::new();
        for action in &settings.ai.decks.experimental_actions {
            if !allowed.contains(&action.as_str()) || seen.contains(action) {
                return Err(AppError::Validation(
                    "ai.decks.experimental_actions is invalid".to_string(),
                ));
            }
            seen.push(action.clone());
        }
    }
    if settings.office_edit.idle_minutes != default_office_edit_idle() {
        return Err(AppError::Validation(
            "office_edit.idle_minutes is fixed at 5".to_string(),
        ));
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
    let mut settings = Settings {
        language,
        theme: ThemeSettings {
            mode,
            ..ThemeSettings::default()
        },
        ..Settings::default()
    };
    // A v1 file predates size options and keeps the legacy KB/MB labels.
    settings.format_options.size_base = "legacy".to_string();
    settings
}

/// Schema 3 had no file-operation choices; schema 4 adds them with the
/// PNG default. A v3 file keeps its language, theme and view options.
fn migrate_v3(value: serde_json::Value) -> Settings {
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            settings.files = FileSettings::default();
            settings.format_options.size_base = "legacy".to_string();
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
            settings.format_options.size_base = "legacy".to_string();
            if validate(&settings).is_ok() {
                settings
            } else {
                Settings::default()
            }
        }
        Err(_) => Settings::default(),
    }
}

/// Schema 27 predates the day/night section (schema 28): keep the actual
/// light/dark choices and the legacy size labels while adding the new
/// defaults.
fn migrate_v27(value: serde_json::Value) -> Settings {
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            settings.theme_custom = fs_service::theme_data::ThemeCustomSettings::from_legacy(
                &settings.theme.light_theme,
                &settings.theme.dark_theme,
                &settings.theme.mode,
            );
            settings.format_options.size_base = "legacy".to_string();
            if validate(&settings).is_ok() {
                settings
            } else {
                Settings::default()
            }
        }
        Err(_) => Settings::default(),
    }
}

/// Older files keep everything they have; fields added since then
/// come from their serde defaults. A file without `format_options`
/// predates schema 30 and keeps the legacy KB/MB labels.
fn migrate_keep_known(value: serde_json::Value) -> Settings {
    let legacy_sizes = value.get("format_options").is_none();
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            if legacy_sizes {
                settings.format_options.size_base = "legacy".to_string();
            }
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
            Some(27) => Ok(migrate_v27(value.clone())),
            Some(v) if (4..=55).contains(&v) => Ok(migrate_keep_known(value.clone())),
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
    /// File tabs (Step 04a): the file's path and the handler that shows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
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
static TITLEBAR_DRAG_RECT: Mutex<Option<[f64; 4]>> = Mutex::new(None);

#[tauri::command]
fn set_titlebar_drag_rect(window: WebviewWindow, rect: Option<[f64; 4]>) -> Result<(), String> {
    ensure_main(window.label())?;
    if !window_chrome::valid_caption_rect(rect) {
        return Err("ops.invalid_request".to_string());
    }
    *TITLEBAR_DRAG_RECT
        .lock()
        .map_err(|_| "ops.invalid_request".to_string())? = rect;
    Ok(())
}

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
    use windows::Win32::UI::WindowsAndMessaging::{
        HTCAPTION, HTMAXBUTTON, WM_NCDESTROY, WM_NCHITTEST,
    };

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
            let caption = TITLEBAR_DRAG_RECT
                .lock()
                .ok()
                .and_then(|stored| *stored)
                .is_some_and(|rect| point_in_rect(f64::from(point.x), f64::from(point.y), rect));
            if caption {
                return LRESULT(HTCAPTION as isize);
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

impl AppState {
    /// The active profile's data folder: settings, sessions, caches,
    /// versions and helper profiles (Step 10c). The catalog and shared
    /// packs stay at the base location outside this folder.
    pub fn data_dir(&self) -> &std::path::Path {
        &self.data_dir
    }

    /// The Step 11b views section, read under the same lock as every setting.
    pub fn views_settings(&self) -> Result<crate::smart_view_types::ViewsSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.views.clone())
            .map_err(|_| "views.unavailable".to_string())
    }

    /// Folder size measurement switches (schema 36). A lock failure keeps
    /// both walks and network roots off.
    pub fn folder_size_options(&self) -> folder_sizes::FolderSizeOptions {
        match self.settings.lock() {
            Ok(settings) => folder_sizes::FolderSizeOptions {
                enabled: settings.folder_sizes.enabled,
                network: settings.folder_sizes.network,
            },
            Err(_) => folder_sizes::FolderSizeOptions {
                enabled: false,
                network: false,
            },
        }
    }

    /// Schema 23: the default for `TransferRequest.verify` when it is omitted.
    pub fn verify_copies(&self) -> bool {
        self.settings
            .lock()
            .map(|settings| settings.transfers.verify_copies)
            .unwrap_or(false)
    }
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
    app: AppHandle,
    state: State<'_, AppState>,
    safe: State<'_, safe_mode::SafeMode>,
    settings: Settings,
) -> Result<Settings, String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode uses default settings in memory and never
    // rewrites the saved file (the original bytes stay for the restart).
    safe.settings_writable()?;
    validate(&settings).map_err(String::from)?;
    save_settings_to_dir(&state.data_dir, &settings).map_err(String::from)?;
    let mut cached = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    *cached = settings.clone();
    drop(cached);
    preview_setup::apply_settings(&app, &settings);
    Ok(settings)
}

/// Saves one custom keyboard map, or activates a builtin preset, through the
/// ordinary atomic settings save (Step 10b E4). The map is validated and
/// normalized again here; builtin presets never enter custom_maps, so preset
/// activation stays on the settings path. Returns the stored map.
#[tauri::command]
fn keyboard_map_save(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    safe: State<'_, safe_mode::SafeMode>,
    map: keyboard_map_types::KeyboardMap,
) -> Result<keyboard_map_types::KeyboardMap, String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the saved settings read-only, so a custom
    // keyboard map is refused before it can reach settings.json.
    safe.settings_writable()?;
    let mut cached = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    let mut next = cached.clone();
    let saved = keyboard_map_types::apply_keyboard_map(&mut next.keyboard_custom, &map)?;
    // save_settings_to_dir validates again and replaces settings.json
    // atomically through atomic_write; the cached session follows only after
    // the file is written.
    save_settings_to_dir(&state.data_dir, &next).map_err(String::from)?;
    *cached = next.clone();
    drop(cached);
    preview_setup::apply_settings(&app, &next);
    Ok(saved)
}

#[tauri::command]
fn get_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Option<SessionState>, String> {
    ensure_main(window.label())?;
    // Step 09h: reading the session is read-only. The launch becomes ready
    // only through `startup_ready` after the restored tabs painted and clean
    // only on a normal app exit, so a failed or repeated startup restore can
    // never hide a crash loop.
    Ok(load_session_from_dir(&state.data_dir))
}

/// Step 09h: the first successful paint/session restore. A reload calls it
/// again; `StartupHealth::mark_ready` is idempotent and never downgrades a
/// clean launch. The first call returns the 30-second deadline result; a
/// marker write error leaves the launch unclean (fail-closed).
#[tauri::command]
fn startup_ready(
    window: WebviewWindow,
    health: State<'_, startup_health::StartupHealth>,
) -> Result<bool, String> {
    ensure_main(window.label())?;
    health.mark_ready(unix_now())
}

#[tauri::command]
fn save_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, safe_mode::SafeMode>,
    session: SessionState,
) -> Result<(), String> {
    ensure_main(window.label())?;
    // Step 09h: safe mode keeps the saved session read-only; the in-memory
    // tabs still work and only the explicit "Restart normally" leaves it.
    safe.state_writable()?;
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

/// Cancel a listing and forget it at once: nobody polls a cancelled listing
/// again, so leaving it in the table would keep its items in memory.
pub fn cancel_list_job(jobs: &mut HashMap<String, ListJob>, request_id: &str) -> bool {
    let Some(job) = jobs.get(request_id) else {
        return false;
    };
    job.token.store(true, Ordering::Relaxed);
    jobs.remove(request_id);
    true
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
    if let Ok(mut jobs) = state.list_jobs.lock() {
        cancel_list_job(&mut jobs, &request_id);
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
        // Replace stays unavailable until recycling can be bound to the
        // exact item the user approved (contract 10, full conflict window).
        "replace" => Err("ops.replace_unavailable".to_string()),
        "skip" => Ok(fs_service::ConflictPolicy::Skip),
        "keepBoth" => Ok(fs_service::ConflictPolicy::KeepBoth),
        "merge" => Ok(fs_service::ConflictPolicy::Merge),
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
#[derive(Debug, Clone, Serialize)]
pub struct ConflictInfo {
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
async fn check_conflicts(
    window: WebviewWindow,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<ConflictInfo>, String> {
    ensure_main(window.label())?;
    let sources = validate_op_sources(&sources)?;
    validate_absolute_path(&dest_dir).map_err(|_| "ops.not_found".to_string())?;
    let dest = PathBuf::from(dest_dir);
    tauri::async_runtime::spawn_blocking(move || {
        fs_service::check_conflicts(&sources, &dest)
            .into_iter()
            .map(|conflict| ConflictInfo {
                path: conflict.path.to_string_lossy().into_owned(),
                is_dir: conflict.is_dir,
            })
            .collect::<Vec<ConflictInfo>>()
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
    state: State<'_, AppState>,
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
    // The page zoom changes how many screen pixels a CSS pixel covers.
    let ui_scale = state
        .settings
        .lock()
        .map_err(|_| "moreOptions.failed".to_string())?
        .appearance
        .ui_scale;
    let (x, y) = appearance::screen_point((origin.x, origin.y), (x, y), scale, ui_scale);
    let request = classic_menu::MenuRequest {
        paths,
        background,
        x,
        y,
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

/// Fixed switches startup consumes itself: `--background` (Step 16) and
/// every helper/static flag handled before instance arbitration. A helper
/// launch exits before the queue exists, so one that still reaches a normal
/// launch is dropped instead of being read as a file path (Step 09c D10).
fn is_startup_switch(argument: &str) -> bool {
    if argument == "--background" {
        return true;
    }
    #[cfg(windows)]
    {
        if argument == clipboard_image_helper::HELPER_FLAG {
            return true;
        }
    }
    argument == convert_helper::HELPER_FLAG
        || argument == office_ooxml_worker::FLAG
        || argument == office_ooxml_check::FLAG
        || argument == raw_helper::HELPER_FLAG
        || argument == pdf_helper::HELPER_FLAG
        || argument == extra_view_helper::HELPER_FLAG
        || argument == ocr_helper::HELPER_FLAG
        || argument == webview_helper::HELPER_FLAG
        || argument == thumbnail_helper::HELPER_FLAG
        || argument == metadata_helper::HELPER_FLAG
        || argument == classic_menu::HELPER_FLAG
        || argument == archive_helper::HELPER_FLAG
        || argument == pack_helper::HELPER_FLAG
        || argument == font_helper::HELPER_FLAG
        || argument == office_sheet::HELPER_FLAG
        || argument == disk_broker::HELPER_FLAG
        || argument == privacy_helper::HELPER_FLAG
        || argument == file_locks::HELPER_FLAG
        || argument == artifact_inventory::HELPER_FLAG
        || argument == usn_index_helper::HELPER_FLAG
        || argument == portable::MARKER_HELPER_FLAG
        || argument == installer_data::RECYCLE_DATA_FLAG
        || argument == integration_commands::RESTORE_FLAG
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some(office_ooxml_check::FLAG) {
        std::process::exit(office_ooxml_check::main());
    }
    if std::env::args().nth(1).as_deref() == Some(convert_helper::HELPER_FLAG) {
        std::process::exit(convert_helper::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(raw_helper::HELPER_FLAG) {
        std::process::exit(raw_helper::run_helper());
    }
    // The PDF helper (Step 07d) is this executable with a static flag; it
    // never starts the Explorer and owns one hidden, incognito webview.
    if std::env::args().nth(1).as_deref() == Some(pdf_helper::HELPER_FLAG) {
        pdf_helper::run_helper(resolve_data_dir());
    }
    // Other trusted WebView helpers are started by the same host with a
    // static kind argument from this fixed list (never a user string).
    // The OCR helper (Step 07e) decodes one image and runs Windows OCR in
    // its own memory-limited process.
    if std::env::args().nth(1).as_deref() == Some(extra_view_helper::HELPER_FLAG) {
        std::process::exit(extra_view_helper::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(ocr_helper::HELPER_FLAG) {
        std::process::exit(ocr_helper::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(webview_helper::HELPER_FLAG) {
        let kind = match std::env::args().nth(2).as_deref() {
            Some("book") => webview_helper_types::WebviewHelperKind::Book,
            Some("notebook") => webview_helper_types::WebviewHelperKind::Notebook,
            Some("model") => webview_helper_types::WebviewHelperKind::Model,
            Some("psd") => webview_helper_types::WebviewHelperKind::Psd,
            Some("pdf_write") => webview_helper_types::WebviewHelperKind::PdfWrite,
            Some("office_quick") => webview_helper_types::WebviewHelperKind::OfficeQuick,
            Some("presentation") => webview_helper_types::WebviewHelperKind::Presentation,
            _ => std::process::exit(2),
        };
        webview_helper::run_helper_process(kind, resolve_data_dir().join("webview-helper"));
    }
    if std::env::args().nth(1).as_deref() == Some(thumbnail_helper::HELPER_FLAG) {
        std::process::exit(thumbnail_helper::run_helper());
    }
    // The metadata helper (Step 07b) reads the fixed Windows property
    // allowlist in its own memory-limited process.
    if std::env::args().nth(1).as_deref() == Some(metadata_helper::HELPER_FLAG) {
        std::process::exit(metadata_helper::run_helper());
    }
    #[cfg(windows)]
    if std::env::args().nth(1).as_deref() == Some(clipboard_image_helper::HELPER_FLAG) {
        std::process::exit(clipboard_image_helper::run(
            std::env::args().nth(2).as_deref(),
        ));
    }
    // The classic-menu helper is this executable started with a flag; it
    // never starts the app itself.
    if std::env::args().nth(1).as_deref() == Some(classic_menu::HELPER_FLAG) {
        std::process::exit(classic_menu::run_helper());
    }
    // The archive helper (Step 06d) is this executable with its own flag: it
    // reads archives in a separate process, inside a memory-limited job.
    if std::env::args().nth(1).as_deref() == Some(archive_helper::HELPER_FLAG) {
        std::process::exit(archive_helper::run_helper());
    }
    // The pack helper (Step 12a H04) parses one signed pack ZIP in its own
    // memory-limited process and exits; the app process never extracts it.
    if std::env::args().nth(1).as_deref() == Some(pack_helper::HELPER_FLAG) {
        std::process::exit(pack_helper::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(office_ooxml_worker::FLAG) {
        std::process::exit(office_ooxml_worker::helper());
    }
    // The font helper (Step 06f) reads font files in its own process, inside
    // a memory-limited job.
    if std::env::args().nth(1).as_deref() == Some(font_helper::HELPER_FLAG) {
        std::process::exit(font_helper::run_helper());
    }
    // The sheet helper (Step 13) is this executable with a static flag: it
    // reads one bounded request line on stdin, answers once on stdout and
    // exits, inside the parent's 256 MiB / 5 s helper limits. The workbook
    // path travels in the request, never on the command line.
    if std::env::args().nth(1).as_deref() == Some(office_sheet::HELPER_FLAG) {
        std::process::exit(match office_sheet::run_sheet_helper() {
            Ok(()) => 0,
            Err(code) => {
                eprintln!("{code}");
                2
            }
        });
    }
    // Helpers integrated after Step 08a are the same executable with a
    // static flag; each one exits before any window or app state exists.
    if std::env::args().nth(1).as_deref() == Some(disk_broker::HELPER_FLAG) {
        let pipe_name = std::env::args().nth(2).unwrap_or_default();
        let parent_pid = std::env::args()
            .nth(3)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let parent_ticks = std::env::args().nth(4).unwrap_or_default();
        std::process::exit(
            match disk_broker::run_disk_broker(&pipe_name, parent_pid, &parent_ticks) {
                Ok(()) => 0,
                Err(_) => 2,
            },
        );
    }
    if std::env::args().nth(1).as_deref() == Some(privacy_helper::HELPER_FLAG) {
        std::process::exit(privacy_helper::run_privacy_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(file_locks::HELPER_FLAG) {
        std::process::exit(file_locks::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(artifact_inventory::HELPER_FLAG) {
        std::process::exit(artifact_inventory::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(usn_index_helper::HELPER_FLAG) {
        std::process::exit(match usn_index_helper::run() {
            Ok(()) => 0,
            Err(code) => {
                eprintln!("{code}");
                2
            }
        });
    }
    if std::env::args().nth(1).as_deref() == Some(portable::MARKER_HELPER_FLAG) {
        std::process::exit(portable::run_marker_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(installer_data::RECYCLE_DATA_FLAG) {
        std::process::exit(installer_data::run_helper());
    }
    if std::env::args().nth(1).as_deref() == Some(integration_commands::RESTORE_FLAG) {
        std::process::exit(integration_commands::run_restore_helper());
    }
    // Step 09c D10: the helper flags above are handled before arbitration
    // and can never travel through the activation pipe. The per-user mutex
    // decides the primary; a second instance forwards only validated
    // absolute file paths and exits after the ack.
    let mut activation_args: Vec<String> = std::env::args().skip(1).collect();
    // Step 16: `--background` is the fixed flag the owned HKCU Run value
    // writes. Parse it before arbitration and remove it, so a second
    // instance never forwards it as if it were a file path.
    let background_start = activation_args.iter().any(|arg| arg == "--background");
    activation_args.retain(|arg| arg != "--background");
    let _instance_guard = match activation_security::acquire_instance() {
        Ok(activation_security::Instance::Primary(guard)) => Some(guard),
        Ok(activation_security::Instance::Secondary) => {
            activation_pipe::run_secondary(&activation_args)
        }
        Err(_) => None,
    };
    // Step 10c: resolve the portable/installed base and then the active
    // profile before any profile-owned folder is opened. The catalog is
    // read-only here: a missing file is the fresh default, and a damaged
    // one keeps its bytes while the legacy default root keeps the app
    // usable.
    let installed_data_dir = absolute_data_dir(resolve_data_dir());
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| installed_data_dir.clone());
    let mut location = portable::locate(&app_dir, &installed_data_dir).unwrap_or_else(|error| {
        eprintln!("portable location: {error}");
        portable::PortableLocation {
            app_dir: app_dir.clone(),
            data_dir: installed_data_dir.clone(),
            portable: false,
            writable: portable::writable_preflight(&installed_data_dir),
        }
    });
    let base_dir = location.data_dir.clone();
    let _ = fs::create_dir_all(&base_dir);
    // `locate` probes before the base may exist; check the created folder so
    // a nested data location is not mistaken for a read-only one.
    location.writable = portable::writable_preflight(&base_dir);
    let catalog = profile_catalog::load_catalog(&base_dir).unwrap_or_else(|error| {
        eprintln!("profile catalog: {error}");
        profile_types::ProfileCatalog::new(profile_types::now_unix())
    });
    let selection = profile_switch::startup_selection(&catalog).unwrap_or_else(|error| {
        eprintln!("profile selection: {error}");
        profile_switch::StartupSelection {
            profile_id: profile_types::DEFAULT_PROFILE_ID.to_string(),
            pending: false,
        }
    });
    let mut opened_profile = selection.profile_id.clone();
    let startup_was_pending = selection.pending;
    let mut active_root =
        profile_root::resolve_profile_root_for(&location, &catalog, &opened_profile)
            .expect("resolve the active profile root");
    if profile_root::ensure_profile_writable(&location, &active_root).is_err()
        && startup_was_pending
    {
        // A pending target that cannot store data must not become active:
        // clear the marker and keep the previous profile (Step 10c).
        let _ = profile_switch::commit_startup_profile(&base_dir, &opened_profile, false);
        opened_profile = catalog.active_id.clone();
        active_root = profile_root::resolve_profile_root_for(&location, &catalog, &opened_profile)
            .expect("resolve the previous profile root");
        let _ = profile_root::ensure_profile_writable(&location, &active_root);
    }
    let data_dir = active_root.profile_dir.clone();
    let logs = logs_dir(&data_dir);
    let _ = fs::create_dir_all(&logs);
    // Step 09h: record this launch before any settings, session, cleanup or
    // window work, so an early crash is still evidence and the decision sees
    // only earlier launches. A marker that cannot be written never blocks
    // startup: the decision already computed in memory is used, so a failed
    // write can neither invent a clean launch nor hide a recorded crash loop.
    let startup_health = startup_health::StartupHealth::open(&data_dir);
    let startup_decision = match startup_health.begin_launch(unix_now()) {
        Ok(decision) => decision,
        Err(error) => {
            eprintln!("startup health: {error}");
            startup_health.decision()
        }
    };
    // The local name never shadows the `safe_mode` module, whose commands
    // are still registered by path below.
    let safe_mode_state = safe_mode::SafeMode::new(startup_decision.failed_starts);
    // Copies of files opened from archives are the app's own temporary
    // files; the ones a day old go at every start (Step 06d).
    archive::start_cleanup(data_dir.clone());
    // Clean recovery records past their seven-day retention go at every
    // start, then once a day while the app runs (Step 09h).
    recovery_store::start_cleanup(data_dir.clone());
    // Recovered plaintext copies are trimmed to their 1 GiB budget before any
    // window or grant exists; this must never run while the app is in use.
    let _ = recovery_open::cleanup_open_copies(&data_dir);
    install_panic_hook(logs);
    if std::env::var_os("ADPERASTRA_FORCE_CRASH").is_some() {
        panic!("forced crash (test)");
    }
    let initial_settings = load_settings(&data_dir);
    let pdf_resolvers = std::sync::Arc::new(pdf_snapshot_resolver::PdfSnapshotResolvers::new());
    let pdf_sessions = pdf_sessions::PdfSessions::new(std::sync::Arc::clone(&pdf_resolvers));
    let export_snapshots = Arc::new(
        export_snapshots::ExportSnapshots::new(data_dir.join("export-input"))
            .expect("initialize export snapshots"),
    );
    export_snapshots.cleanup_expired();
    export_snapshots::ExportSnapshots::start_cleanup(&export_snapshots);
    pdf_resolvers
        .register(Arc::new(
            pdf_export_snapshot_resolver::NativePdfSnapshotResolver::new(Arc::clone(
                &export_snapshots,
            )),
        ))
        .expect("register snapshot resolver");
    // Integrated states (steps after 08a). Each one is the single app-wide
    // instance; the 07a-08a cache, jobs and grant registries stay the ones
    // `preview_setup` and the existing builder entries already create.
    // Step 10c: every profile-owned service below receives the resolved
    // profile root; only the catalog and shared engine packs stay at the
    // base.
    let state_profile_dir = data_dir.clone();
    let shared_packs_dir = active_root.shared_packs_dir.clone();
    // The Office preview release pins its signed offline catalog public key.
    // A portable debug build may explicitly choose a separate test catalog.
    let pack_public_key = if cfg!(debug_assertions) && location.portable {
        option_env!("ADPERASTRA_LOCAL_OFFICE_PACK_PUBLIC_KEY")
            .unwrap_or(include_str!("../../assets/office-preview-pack.pub").trim())
    } else {
        include_str!("../../assets/office-preview-pack.pub").trim()
    };
    let transfer_history = Arc::new(Mutex::new(transfer_history::TransferHistory::default()));
    let transfer_coordinator = Arc::new(transfer_control::TransferCoordinator::default());
    transfer_coordinator.set_history(Arc::clone(&transfer_history));
    let activation_queue = Arc::new(activation::ActivationQueue::new());
    // Step 09c D9: a primary launch that carries file paths is the initial
    // activation. It goes through the same parser, request shape and bounded
    // queue as a second instance, and stays queued until `activation_ready`
    // drains it after the window listener (and the helpers it needs) exist,
    // so nothing opens while the window is still starting.
    if let Some(request) =
        activation::initial_activation_request(&activation_args, is_startup_switch)
    {
        if let Err(error) = activation::process_activation(request, &activation_queue) {
            eprintln!("activation: {error}");
        }
    }
    let snapshot_authority: Arc<dyn documents::SnapshotAuthorityPort> = export_snapshots.clone();
    let snapshot_port: Arc<dyn documents::SnapshotPort> = export_snapshots.clone();
    let snapshot_upload: Arc<dyn documents::SnapshotUploadPort> = export_snapshots.clone();
    let document_store = Arc::new(documents::DocumentStore::new(
        snapshot_authority,
        snapshot_port,
        snapshot_upload,
    ));
    let transfer_source: Arc<dyn content_transfer::TransferSourcePort> = document_store.clone();
    let transfer_snapshot: Arc<dyn content_transfer::TransferSnapshotPort> =
        export_snapshots.clone();
    let content_transfers = Arc::new(content_transfer::ContentTransfers::new(
        transfer_source,
        transfer_snapshot,
    ));
    let storage_providers = storage::StorageProviders::new();
    // The semantic tables are the only implemented provider so far; every
    // other category stays absent instead of reporting invented bytes.
    let _ = storage_providers.register(Arc::new(
        ai_semantic_storage::AiSemanticStorageProvider::new(&state_profile_dir),
    ));
    // Pack download partials live under the shared packs root (Step 12a).
    let _ = storage_providers.register(Arc::new(storage::PackDownloadsProvider::new(
        &shared_packs_dir,
    )));
    let exe_dir = app_dir.clone();
    // Step 10c: profile commands resolve the catalog against the same base
    // location startup used; the resolved root above never replaces it, so
    // `profiles.json` stays at the base.
    let profile_service = profile_root::ProfileServiceState {
        location,
        switch: profile_switch::ProfileSwitchState::default(),
    };
    tauri::Builder::default()
        .manage(AppState {
            data_dir,
            settings: Mutex::new(initial_settings),
            list_jobs: Mutex::new(HashMap::new()),
            file_jobs: Mutex::new(HashMap::new()),
            transfer_history: Arc::clone(&transfer_history),
            explorer_state_lock: Mutex::new(()),
            watch: Mutex::new(None),
            watch_next_id: AtomicU64::new(0),
        })
        .manage(Arc::new(files::FileGrants::default()))
        .manage(folder_views::FolderViewsLock::default())
        .manage(folder_customization_store::FolderCustomizationLock::default())
        .manage(jobs::Jobs::default())
        .manage(setups::SetupPreviews::default())
        .manage(bulk_rename::RenamePlans::default())
        .manage(archive::ArchiveSessions::default())
        .manage(archive_passwords::ArchivePasswords::default())
        .manage(data_views::DataSessions::default())
        .manage(gallery::GallerySessions::default())
        .manage(export_snapshots)
        .manage(image_project_jobs::ProjectPayloadSessions::default())
        .manage(convert_jobs::ConvertGate::default())
        .manage(convert_reports::ConversionReports::default())
        .manage(pdf_resolvers)
        .manage(pdf_sessions)
        .manage(ocr::OcrService::new())
        .manage(transfer_coordinator)
        .manage(activation_queue)
        .manage(document_store)
        .manage(content_transfers)
        .manage(storage_providers)
        .manage(profile_service)
        .manage(startup_health)
        .manage(safe_mode_state)
        .manage(Arc::new(
            duplicate_cleanup::DuplicateCleanupService::default(),
        ))
        .manage(Arc::new(duplicates::DuplicatesState::new()))
        .manage(Arc::new(folder_sizes::FolderSizeState::new(
            state_profile_dir.clone(),
        )))
        .manage(Arc::new(storage_scan::StorageState::new(
            state_profile_dir.clone(),
        )))
        .manage(Arc::new(waveforms::WaveformService::default()))
        .manage(Arc::new(media_recipe_export::MediaRecipeExport::default()))
        .manage(Arc::new(proxy::ProxyService::default()))
        .manage(Arc::new(local_ai_artifacts::AiArtifactStore::default()))
        .manage(search_index::SearchIndexState::new(
            state_profile_dir.clone(),
        ))
        .manage(integrated_setup::ai_semantic_state(
            state_profile_dir.clone(),
        ))
        .manage(ai_extraction_runtime::AiExtractionRuntime::default())
        .manage(assistant::AssistantService::new(
            assistant_types::AssistantSettings::default(),
            None,
            None,
        ))
        // History is off until the assistant settings coordinator enables
        // it; a disabled store reads and writes no bytes.
        .manage(assistant_history_store::HistoryStore::new(
            state_profile_dir.clone(),
            Arc::new(assistant_credentials::WindowsDpapi),
            false,
        ))
        // Step 17a provider/outbound states. The native editor, origin prompt,
        // outbound approval and inference host are design adapters that are
        // not registered yet. Meta Test/List has a bounded native transport;
        // while another port is `None`
        // its command fails closed instead of inventing a result. The
        // credential store is registered in `setup` for the resolved active
        // profile root, so the default profile and UUID profiles both work.
        .manage(assistant_provider::ProviderConfig::new(Some(Arc::new(
            assistant_http::MetaHttp,
        ))))
        .manage(assistant_provider::CredentialEditorState::default())
        .manage(assistant_provider::OriginPromptState::default())
        .manage(assistant_outbound::OutboundRegistry::default())
        .manage(assistant_outbound::OutboundApprovalState::default())
        .manage(assistant_outbound::InferenceRuntime::new(None))
        // Step 17a action drafts. No native confirmation dialog or producer
        // execution adapter is registered yet, so Apply fails closed instead
        // of inventing a write; Preview and Cancel stay on the draft store.
        .manage(assistant_actions::AssistantActionState::new(None, None))
        .manage(conversion_presets::ConversionPresetsStore::from_data_dir(
            &state_profile_dir,
        ))
        .manage(conversion_documents::DocumentBlockPages::default())
        .manage(diagnostics_sessions::DiagnosticsSessions::default())
        .manage(integration_commands::IntegrationState::new(
            exe_dir,
            env!("CARGO_PKG_VERSION").to_string(),
        ))
        .manage(map_tiles::MapViewLeases::default())
        .manage(indexed_views::ViewCursorStore::default())
        .manage(geo_points::GeoCursorStore::default())
        .manage(office_view_sessions::OfficeViewSessions::default())
        // Step 20a: one edit registry for the active profile; no engine is
        // installed here, so engine-dependent commands fail closed.
        .manage(office_edit_sessions::OfficeEditState::new(&opened_profile))
        // Draft creation and deck-template parsing have no approved provider
        // in this build: both registries are empty and the commands fail
        // closed instead of fabricating a document or a theme.
        .manage(office_drafts::OfficeDraftState::default())
        .manage(office_deck_template::DeckTemplateState::default())
        .manage(Arc::new(document_drafts::DocumentDrafts::default()))
        // Steps 20c/21b/22b shared AI boundary. No proposal/generation
        // provider is installed here, so every AI start fails closed with
        // `office_ai.engine_missing`.
        .manage(office_ai::OfficeAiState::new())
        .manage(privacy_sessions::PrivacySessions::default())
        .manage(read_aloud::ReadAloudSessions::default())
        .manage(tag_transfer::TagTransfer::default())
        .manage(updates::UpdatesService::default())
        .manage(watcher_sessions::WatcherSessions::default())
        .manage(speech_dictation::DictationController::new())
        .manage(speech_microphone::MicrophoneConsent::default())
        // The honest platform device for this build; AudioGraph stays
        // unavailable until its signatures are verified, so Start fails
        // closed with `speech.device_unavailable` instead of opening an
        // unverified path.
        .manage(speech_dictation::DictationDeviceState::platform())
        .register_asynchronous_uri_scheme_protocol(files::SCHEME, files::protocol)
        .setup(move |app| {
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
            // Step 16: only the fixed `--background` flag combined with the
            // user's saved opt-in creates the window hidden. A stale Run
            // value without the setting still starts visibly.
            let (stay_in_background, start_with_windows) =
                match app.state::<AppState>().settings.lock() {
                    Ok(settings) => (
                        settings.startup.stay_in_background,
                        settings.startup.start_with_windows,
                    ),
                    Err(_) => (false, false),
                };
            let start_resident = background_start && stay_in_background;
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(profile)
                .visible(!start_resident)
                .build()?;
            // The one resident runtime for the app. Every resident or tray
            // command reads this managed state; a missing runtime fails
            // closed instead of inventing a host.
            let resident_active_jobs = Arc::new(AtomicU32::new(0));
            let resident_host: Arc<dyn resident_state::ResidentHost> =
                Arc::new(app_resident::AppResidentHost::new(
                    app.handle().clone(),
                    Arc::clone(&resident_active_jobs),
                ));
            let resident_coordinator = Arc::new(resident_state::ResidentCoordinator::new(
                resident_host,
                stay_in_background,
                start_with_windows,
            ));
            if start_resident {
                resident_coordinator
                    .mark_started_resident()
                    .map_err(|error| error.to_string())?;
            }
            app.manage(resident::ResidentRuntime::new(
                Arc::clone(&resident_coordinator),
                resident_active_jobs,
            ));
            app.manage(resident::TrayLabelsState::default());
            // A window close asks the coordinator first. While residence is
            // off the normal UI close flow stays in charge; while it is on
            // the coordinator decides between hiding and exiting without
            // ever discarding unsaved work.
            window.on_window_event({
                let coordinator = Arc::clone(&resident_coordinator);
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if coordinator.enabled() {
                            api.prevent_close();
                            let _ = coordinator.request_close_now();
                        }
                    }
                }
            });
            // Step 10c: if startup aborts after this pending target opened,
            // keep the previous profile instead of retrying a broken target
            // on every launch. The successful commit disarms this.
            struct PendingStartupCommit<'a> {
                base: &'a Path,
                opened: &'a str,
                armed: bool,
            }
            impl Drop for PendingStartupCommit<'_> {
                fn drop(&mut self) {
                    if self.armed {
                        let _ =
                            profile_switch::commit_startup_profile(self.base, self.opened, false);
                    }
                }
            }
            let mut startup_commit = PendingStartupCommit {
                base: &base_dir,
                opened: &opened_profile,
                armed: startup_was_pending,
            };
            // The saved UI scale, before the page paints (Step 05d D5).
            let ui_scale = match app.state::<AppState>().settings.lock() {
                Ok(settings) => settings.appearance.ui_scale,
                Err(_) => 100,
            };
            appearance::apply_startup_zoom(&window, ui_scale);
            // Snap layouts: subclass the main window so Windows treats the
            // custom maximize button as the native maximize button.
            #[cfg(windows)]
            install_snap_subclass(&window);
            // The clipboard-history listener is a second subclass of the same
            // window; it stays idle until Windows capture is enabled.
            #[cfg(windows)]
            let _ = clipboard_history_listener::install(&window, app.handle().clone());
            #[cfg(not(windows))]
            let _ = window;
            // Keep versions of file changes in the background (Step 06b).
            let worker = versions::VersionWorker::start(app.handle().clone());
            app.manage(worker);
            preview_setup::initialize(app)?;
            app.state::<ocr::OcrService>()
                .register_pdf(std::sync::Arc::new(pdf::PdfOcrAdapter::new(
                    app.handle().clone(),
                )))?;
            // The single-instance activation pipe owns the per-user queue.
            activation_pipe::start_pipe_server(
                app.handle().clone(),
                Arc::clone(app.state::<Arc<activation::ActivationQueue>>().inner()),
            );
            // States whose constructor can fail stay unmanaged on error, so
            // their commands report "state not managed" instead of running on
            // an empty or invented registry.
            let setup_data_dir = app.state::<AppState>().data_dir.clone();
            app.state::<office_edit_sessions::OfficeEditState>()
                .install_engine(Arc::new(office_ooxml_binding::BasicOfficeEngine::new(
                    setup_data_dir.clone(),
                )))
                .map_err(|error| error.code().to_owned())?;
            // Step 12a: one pack manager. No catalog URL pair is configured
            // by this build, so refresh stays unavailable; listing, leases
            // and removal still work. Install/resume fail closed until the
            // bounded pack helper exists (H04).
            if let Ok(packs) =
                packs::Packs::new(shared_packs_dir, pack_public_key.to_string(), None)
            {
                // Step 12b: one engine host over that same pack manager and
                // the active profile's own data folder. Preview, probe,
                // capability and conversion commands resolve this exact
                // `Arc<EngineHost>`; a missing or unsigned media/office pack
                // stays `engines.pack_missing`/`engines.unsafe_build` through
                // `Packs::acquire`, never a fallback launcher.
                app.manage(Arc::new(engine_process::EngineHost::new(
                    Arc::new(packs.clone()),
                    setup_data_dir.clone(),
                )));
                app.manage(Arc::new(
                    office_pool::OfficeReadPool::new(
                        Arc::new(office_pool_actor::EngineHostSessionFactory::new(
                            app.state::<Arc<engine_process::EngineHost>>()
                                .inner()
                                .clone(),
                        )),
                        office_pool::OfficeWarmOptions {
                            keep_warm: false,
                            idle_seconds: 60,
                        },
                    )
                    .map_err(std::io::Error::other)?,
                ));
                app.manage(packs);
            }
            // Step 17b: speech does not depend on the assistant. The 12a
            // registry exposes no verified `ai_speech` record to this build
            // (pack activation stays out of process, H04), so the installed
            // source carries no pack and reports `pack_missing` instead of
            // inventing a model. The whisper adapter and PCM source have no
            // concrete provider yet and therefore stay uninstalled, which
            // keeps every speech command fail-closed.
            let _ = speech::install_capability_source(Box::new(speech::VerifiedSpeechPack {
                pack: None,
                model_id: None,
            }));
            // Step 17a/D3: credentials are stored inside the active profile
            // root. The default profile keeps the legacy base directory and
            // every other profile lives under `profiles/<uuid>`, so the
            // store receives the already-resolved root instead of assuming
            // a UUID. A root it cannot confine stays unmanaged so its
            // commands fail closed.
            if let Ok(credentials) = assistant_credentials::CredentialStore::new(
                setup_data_dir.clone(),
                Arc::new(assistant_credentials::WindowsDpapi),
                None,
            ) {
                app.manage(credentials);
            }
            let ai_settings = app
                .state::<AppState>()
                .settings
                .lock()
                .map(|settings| settings.local_ai.clone())
                .unwrap_or_default();
            if let Some(packs) = app.try_state::<packs::Packs>() {
                if let Ok(runtime) = local_ai::LocalAiRuntime::for_app(
                    ai_settings,
                    Arc::clone(
                        app.state::<Arc<local_ai_artifacts::AiArtifactStore>>()
                            .inner(),
                    ),
                    Arc::clone(app.state::<Arc<documents::DocumentStore>>().inner()),
                    Arc::clone(app.state::<Arc<files::FileGrants>>().inner()),
                    packs.inner().clone(),
                    Arc::clone(
                        app.state::<Arc<export_snapshots::ExportSnapshots>>()
                            .inner(),
                    ),
                    setup_data_dir.join("local-ai-jobs"),
                ) {
                    app.manage(runtime);
                }
            }
            // Step 17b: one capability source and the active profile scope.
            // The model executor is not registered: this build has no
            // verified action producer, so rows stay typed unavailable.
            if let Err(error) = ai_action_wiring::install(app.handle(), &opened_profile) {
                eprintln!("ai actions: {error}");
            }
            if let Ok(store) = tag_store::TagStore::open(&setup_data_dir) {
                // Startup crash recovery (Step 11b): the mirror queue is in
                // memory only, so replay every membership once and drain it
                // into the search index. Both steps are best effort; the tag
                // database stays authoritative. A store that cannot be opened
                // stays unmanaged, so tag commands fail closed instead of
                // running on invented state.
                let _ = tag_identity_effects::reconcile_mirrors(&store);
                app.manage(store);
                let _ = tag_search_bridge::flush_after_commit(app.handle());
            }
            if let Ok(store) =
                map_tiles::MapTileStore::new(&setup_data_dir, env!("CARGO_PKG_VERSION"))
            {
                app.manage(store);
            }
            if let Ok(sessions) = locked_sessions::LockedSessions::new(
                setup_data_dir.join("locked-pending"),
                locked_store::types::LockedSettings::default(),
            ) {
                app.manage(Arc::new(sessions));
            }
            // Disk-image mounts (Step 09j). The registry is managed only
            // with the live document store behind its eject guard: without
            // exact open-document paths an eject could detach a volume
            // whose files are still open. A missing store leaves the state
            // unmanaged, so the mount and eject commands fail closed.
            struct OpenDocumentsAdapter(Arc<documents::DocumentStore>);
            impl disk_images::OpenDocuments for OpenDocumentsAdapter {
                fn under(&self, roots: &[String]) -> Vec<String> {
                    self.0
                        .open_documents_under(roots)
                        .into_iter()
                        .map(|(_, path)| path)
                        .collect()
                }
            }
            if let Some(document_store) = app.try_state::<Arc<documents::DocumentStore>>() {
                let host = disk_images::WindowsDiskHost::new(Arc::new(OpenDocumentsAdapter(
                    document_store.inner().clone(),
                )));
                app.manage(Arc::new(disk_mounts::DiskMounts::new(Arc::new(host))));
            } else {
                eprintln!("disk mounts: document store missing; state stays unmanaged");
            }
            let snapshots = app
                .state::<Arc<export_snapshots::ExportSnapshots>>()
                .inner()
                .clone();
            let transfers = app
                .state::<Arc<content_transfer::ContentTransfers>>()
                .inner()
                .clone();
            if let Ok(history) = clipboard_history::ClipboardHistoryState::new(
                clipboard_history_types::ClipboardHistorySettings::default(),
                setup_data_dir.join("clipboard-history"),
                transfers,
                snapshots,
            ) {
                app.manage(history);
            }
            let extra_app = app.handle().clone();
            app.manage(extra_view_sessions::ExtraViewSessions::new(
                Box::new(book_backend::ExtraViewFactory {
                    native: extra_view_backend::NativeBackendFactory {
                        app: extra_app.clone(),
                    },
                    book: book_backend::BookBackendFactory { app: extra_app },
                }),
                Box::new(extra_view_sessions::FsStampProvider),
                setup_data_dir.join("extra-view-open"),
            ));
            crate::search_index::ensure_started(app.handle().clone());
            // Step 17b: recordings, transcripts and caption tracks all have
            // idle bounds, but a viewer that is never touched again must
            // still release them. This follows the same bounded background
            // loop as the export snapshots and calls only the cleanup methods
            // those stores already expose.
            {
                let cleanup_app = app.handle().clone();
                let _ = std::thread::Builder::new()
                    .name("speech-cleanup".to_string())
                    .spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(60));
                        if cleanup_app.get_webview_window("main").is_none() {
                            break;
                        }
                        cleanup_app
                            .state::<speech_dictation::DictationController>()
                            .cleanup_idle();
                        speech::transcript_store().cleanup();
                        speech_captions::caption_generations().cleanup();
                    });
            }
            // Step 10c: a pending profile becomes active only after every
            // startup step above succeeded; this is a no-op when no switch
            // was pending. A failed commit keeps the pending marker for the
            // next launch instead of clearing it as a failed open.
            startup_commit.armed = false;
            if let Err(error) =
                profile_switch::commit_startup_profile(&base_dir, &opened_profile, true)
            {
                eprintln!("profile startup commit: {error}");
            }
            Ok(())
        })
        .manage(special_view_session::SpecialViews::default())
        .invoke_handler(tauri::generate_handler![
            convert_jobs::convert_start,
            convert_jobs::convert_preview_start,
            convert_jobs::convert_report_page,
            export_snapshots::export_snapshot_authorize_file,
            export_snapshots::export_snapshot_authorize_new,
            export_snapshots::export_snapshot_begin,
            image_encode::image_encode_plan,
            image_encode::image_encode,
            image_project_jobs::image_project_open_start,
            image_project_jobs::image_project_payload_start,
            image_project_jobs::image_project_payload_page,
            image_project_jobs::image_project_payload_release,
            image_project_jobs::image_project_capture_start,
            image_project_jobs::image_project_psd_scan_start,
            image_project_jobs::image_project_psd_import_start,
            export_snapshots::export_snapshot_finish,
            export_snapshots::export_snapshot_release,
            export_snapshots::export_snapshot_abort,
            export_snapshots::export_snapshot_authority_release,
            special_views::special_view_open_start,
            special_views::special_view_scene,
            special_views::special_view_raw_start,
            special_views::special_view_layers,
            special_views::special_view_close,
            get_settings,
            save_settings,
            keyboard_map_save,
            get_session,
            startup_ready,
            save_session,
            list_help,
            get_help_page,
            search_help,
            get_windows_accent,
            open_help_window,
            set_maximize_rect,
            set_titlebar_drag_rect,
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
            create_shortcut,
            files::file_detect,
            files::file_grant,
            files::file_revoke,
            folder_views::folder_views_get,
            folder_views::folder_view_set,
            folder_views::folder_views_clear,
            links::open_external_url,
            zone::file_unblock,
            media::media_sidecars,
            appearance::appearance_set_zoom,
            settings_file::settings_export,
            settings_file::settings_import,
            setups::setup_pick_import,
            setups::setup_preview_start,
            setups::setup_apply_start,
            setups::setup_release,
            setups::setup_export_start,
            text_save::text_save,
            text_save::text_pick_save_path,
            versions::versions_list,
            versions::versions_extract,
            versions::versions_restore,
            versions::versions_save_copy,
            versions::versions_delete_all,
            versions::versions_store_size,
            jobs::job_poll,
            jobs::job_cancel,
            archive::archive_open_start,
            archive::archive_folder,
            archive::archive_search,
            archive::archive_close,
            archive::archive_open_entry_start,
            archive::archive_extract_start,
            archive::archive_pick_folder,
            archive_rar::archive_rar_status,
            archive_create::archive_create_start,
            templates::templates_list,
            templates::template_create,
            template_jobs::template_create_start,
            templates::templates_pick_folder,
            data_views::table_open_start,
            data_views::table_view_start,
            data_views::table_rows,
            data_views::table_close,
            data_views::json_open_start,
            data_views::json_children,
            data_views::json_find,
            data_views::json_copy,
            data_views::json_close,
            font_view::font_info_start,
            font_view::font_install,
            gallery::gallery_start,
            gallery::gallery_page,
            gallery::gallery_close,
            gallery::gallery_active,
            gallery::gallery_pick_source,
            pdf::pdf_open_start,
            pdf::pdf_open_input_start,
            pdf::pdf_close,
            pdf::pdf_render_start,
            pdf::pdf_text_page,
            pdf::pdf_outline,
            pdf::pdf_search_start,
            pdf_edit::pdf_edit_inspect_start,
            pdf_edit::pdf_edit_serialize_start,
            pdf_print::pdf_print_start,
            ocr::ocr_languages,
            ocr::ocr_start,
            ocr::ocr_page,
            ocr::ocr_release,
            extra_views::extra_view_open_start,
            extra_views::extra_view_page,
            extra_views::extra_view_close,
            extra_views::extra_view_attachment_start,
            extra_views::extra_view_subtitles,
            extra_views::extra_view_sqlite_tables,
            extra_views::extra_view_book_contents,
            cache_stamp::file_identity,
            cache::cache_usage,
            cache::cache_clear,
            cache::cache_release,
            background::background_status,
            background::background_tasks,
            background::background_pause_all,
            thumbnails::thumbnail_request_start,
            thumbnails::thumbnail_lookup,
            thumbnails::thumbnail_release,
            metadata_jobs::metadata_read_start,
            metadata_jobs::metadata_release,
            metadata_preview::preview_detect,
            metadata_preview::preview_grant,
            metadata_preview::preview_revoke,
            accessibility_system::accessibility_system_state,
            activation_pipe::activation_ready,
            activity::activity_status,
            activity::activity_list,
            activity::activity_clear,
            activity::activity_set_paused,
            ai_actions::ai_action_start,
            ai_action_sources::ai_action_sources,
            ai_actions::ai_mask_artifact_create,
            ai_actions::ai_action_result,
            ai_actions::ai_action_result_release,
            ai_action_export::ai_action_result_export_start,
            ai_extraction_commands::ai_extract_prepare_start,
            ai_extraction_commands::ai_extract_start,
            ai_extraction_commands::ai_extract_page,
            ai_extraction_commands::ai_extract_correct,
            ai_extraction_commands::ai_extract_capture_start,
            ai_extraction_commands::ai_extract_release,
            ai_extraction_commands::ai_inline_start,
            ai_eval_commands::ai_eval_start,
            ai_eval_commands::ai_eval_page,
            ai_name_suggestions::ai_names_suggest_start,
            ai_query_preview::ai_query_preview_start,
            ai_semantic_search::ai_semantic_search_start,
            ai_semantic_search::ai_semantic_status,
            ai_semantic_search::ai_semantic_rebuild_start,
            ai_sort_history::ai_sort_history_reset,
            ai_sort_suggestions::ai_sort_suggest_start,
            assistant::assistant_chat_create,
            assistant::assistant_messages,
            assistant::assistant_turn_start,
            assistant::assistant_turn_stop,
            assistant::assistant_scope_request,
            assistant::assistant_scope,
            assistant::assistant_scope_revoke,
            assistant_history::assistant_history_list,
            assistant_history::assistant_history_clear,
            assistant_history::assistant_history_export,
            assistant_provider::assistant_credential_status,
            assistant_provider::assistant_credential_edit,
            assistant_provider::assistant_credential_remove,
            assistant_provider::assistant_provider_models,
            assistant_provider::assistant_provider_test,
            assistant_provider::assistant_endpoint_configure,
            assistant_provider::assistant_endpoint_status,
            assistant_provider::assistant_endpoint_probe,
            assistant_outbound::assistant_inference_prepare,
            assistant_outbound::assistant_outbound_confirm,
            assistant_outbound::assistant_inference_start,
            assistant_actions::assistant_action_preview,
            assistant_actions::assistant_action_apply,
            assistant_actions::assistant_action_cancel,
            assistant_recycle::assistant_recycle_confirm,
            clipboard_history_commands::clipboard_history_list,
            clipboard_history_commands::clipboard_history_patch,
            clipboard_history_commands::clipboard_history_resolve,
            clipboard_history_commands::clipboard_history_record,
            content_transfer::transfer_create,
            content_transfer::transfer_get,
            content_transfer::transfer_release,
            conversion_documents::doc_blocks_start,
            conversion_documents::doc_blocks_page,
            conversion_presets::conversion_presets_list,
            conversion_presets::conversion_preset_save,
            conversion_presets::conversion_preset_remove,
            conversion_presets::conversion_presets_replace,
            conversion_presets::conversion_presets_import,
            custom_theme_store::theme_list,
            custom_theme_store::theme_read,
            custom_theme_store::theme_save,
            custom_theme_store::theme_remove,
            deck_style_application::deck_style_prepare,
            deck_style_application::deck_style_apply,
            deck_style_exchange::deck_style_file_import_start,
            deck_style_exchange::deck_style_file_export_start,
            deck_style_import::deck_style_import_start,
            deck_styles::deck_styles_list,
            deck_styles::deck_styles_save,
            deck_styles::deck_styles_remove,
            diagnostics_archive::diagnostics_open_issue,
            diagnostics_sessions::diagnostics_create_start,
            diagnostics_sessions::diagnostics_edit,
            diagnostics_sessions::diagnostics_save_start,
            diagnostics_sessions::diagnostics_close,
            disk_mounts_commands::disk_mount_start,
            disk_mounts_commands::disk_eject_start,
            disk_mounts_commands::disk_mounts,
            document_commit::document_commit_start,
            document_rebind::document_save_as_new_start,
            documents::document_open,
            documents::document_release,
            documents::document_snapshot_begin,
            duplicates::duplicates_start,
            duplicates::duplicates_page,
            duplicates::duplicates_release,
            duplicates::duplicates_cleanup_prepare,
            duplicates::duplicates_cleanup_start,
            engine_process::engines_capabilities,
            file_locks::locks_inspect_start,
            file_locks::locks_close_start,
            folder_presentation_store::folder_presentation_get,
            folder_presentation_store::folder_presentation_set,
            folder_presentation_store::folder_presentation_clear,
            folder_customization_store::folder_decorations,
            folder_customization_store::folder_customize_start,
            folder_customization_store::folder_reset_start,
            folder_customization_store::column_sets_list,
            folder_customization_store::column_set_save,
            folder_customization_store::column_set_remove,
            folder_sizes::folder_size_request,
            folder_sizes::folder_size_release,
            geo_points::geo_points_start,
            indexed_views::indexed_view_start,
            integration_commands::windows_integration_status,
            integration_commands::windows_integration_apply,
            integration_commands::windows_integration_open_defaults,
            local_ai::ai_capabilities,
            local_ai::ai_hardware,
            local_ai::ai_task_start,
            local_ai::ai_text_page,
            local_ai::ai_shutdown,
            local_ai::ai_input_acquire,
            local_ai::ai_document_input_acquire,
            local_ai::ai_input_release,
            local_ai_artifacts::ai_artifact_describe,
            local_ai_artifacts::ai_artifact_read,
            local_ai_artifacts::ai_artifact_release,
            locked_create::locked_create_start,
            locked_create::locked_unlock_start,
            locked_create::locked_pick_recovery_path,
            locked_lock::locked_persist_start,
            locked_lock::locked_lock_start,
            locked_lock::locked_save_copy_start,
            locked_lock::locked_recovery_list,
            locked_lock::locked_recovery_choose,
            locked_lock::locked_mark_dirty,
            locked_lock::locked_touch,
            locked_lock::locked_idle_check,
            locked_provider::locked_list,
            locked_provider::locked_entry_info,
            locked_provider::locked_entry_grant,
            locked_provider::locked_entry_release,
            locked_provider::locked_export_start,
            map_tiles::map_view_open,
            map_tiles::map_view_close,
            map_tiles::map_tile_get,
            map_tiles::map_tile_release,
            map_tiles::map_tile_clear,
            media_probe::media_probe_start,
            media_preview::media_preview_start,
            media_recipe_export::media_recipe_export_start,
            office_ai::office_ai_context_start,
            office_ai::office_ai_context_release,
            office_ai::office_ai_proposal_evaluate_start,
            office_ai::office_ai_proposal_page,
            office_ai::office_ai_proposal_release,
            office_ai::office_ai_proposal_confirm,
            office_ai::office_ai_proposal_apply,
            office_edit::office_edit_open_start,
            office_edit::office_edit_close,
            office_edit::office_edit_state,
            office_edit_basic::office_edit_basic_page,
            office_edit::office_edit_transact,
            office_edit::office_edit_undo,
            office_edit::office_edit_redo,
            office_edit::office_edit_mode,
            office_edit::office_edit_discard_saved,
            office_edit::office_edit_items,
            office_edit::office_edit_formatting,
            office_edit::office_edit_cell_window,
            office_edit::office_edit_formula_parse,
            office_edit::office_edit_formula_format,
            office_edit::office_edit_find,
            office_edit::office_edit_spelling,
            office_edit::office_edit_document_stats,
            office_edit::office_edit_functions,
            office_edit::office_edit_release_lease,
            office_edit::office_edit_print_start,
            office_edit_render::office_edit_render_start,
            office_edit_capture::office_edit_capture_start,
            office_edit_capture::office_edit_export_start,
            office_drafts::office_draft_create_start,
            office_drafts::office_blank_draft_create_start,
            office_deck_template::office_deck_template_inspect_start,
            office_deck_template::office_deck_template_import,
            office_view::office_view_open_start,
            office_view::office_view_page_start,
            office_view_text::office_view_text_start,
            office_view::office_view_sections,
            office_view::office_view_comments,
            office_view::office_view_cells,
            office_view::office_view_close,
            packs::pack_list,
            packs::catalog_refresh_start,
            packs::install_start,
            packs::download_pause,
            packs::download_resume_start,
            packs::remove_start,
            portable_copy::portable_copy_start,
            presentation::office_presentation_displays,
            presentation::office_presentation_start,
            presentation::office_presentation_navigate,
            presentation::office_presentation_end,
            privacy_jobs::privacy_inspect_start,
            privacy_jobs::privacy_inspection_page,
            privacy_jobs::privacy_effective_categories,
            privacy_jobs::privacy_clean_start,
            privacy_jobs::privacy_release,
            profile_catalog::profiles_list,
            profile_catalog::profile_create,
            profile_catalog::profile_rename,
            profile_root::profile_root,
            profile_switch::profile_switch_prepare,
            profile_switch::profile_switch_commit,
            proxy::media_proxy_start,
            read_aloud::read_voices,
            read_aloud::read_aloud_start,
            read_aloud::read_aloud_chunk,
            read_aloud::read_aloud_stop,
            recovery_open::recovery_open_start,
            recovery_store::recovery_save_start,
            recovery_store::recovery_list,
            recovery_store::recovery_legacy_count,
            recovery_store::recovery_legacy_import_start,
            recovery_store::recovery_discard,
            recovery_store::recovery_legacy_read,
            resident::resident_status,
            resident::resident_set,
            resident::resident_show,
            resident::resident_close_confirmed,
            resident::resident_tray_labels,
            safe_mode::safe_mode_status,
            safe_mode::restart_normal,
            saved_group_store::saved_groups_list,
            saved_group_store::saved_group_write,
            saved_group_store::saved_group_remove,
            saved_group_transfer::saved_groups_export,
            saved_group_transfer::saved_groups_import,
            saved_group_transfer::saved_groups_pick_import,
            crate::search_index::search_start,
            crate::search_index::search_page_start,
            crate::search_index::index_status,
            crate::search_index::index_rebuild_start,
            crate::search_index::index_pause,
            crate::search_index::saved_searches_list,
            crate::search_index::saved_search_save,
            crate::search_index::saved_search_remove,
            shelf_store::shelf_get,
            shelf_store::shelf_patch,
            shelf_store::shelf_refresh_start,
            smart_folders::smart_folders_list,
            smart_folders::smart_folder_save,
            smart_folders::smart_folder_remove,
            speech::speech_transcribe_start,
            speech::speech_captions_start,
            speech::speech_transcript_page,
            speech::speech_transcript_release,
            speech_dictation::speech_dictation_start,
            speech_dictation::speech_dictation_stop,
            speech_dictation::speech_dictation_cancel,
            storage::storage_report,
            storage::storage_clear_start,
            storage::storage_set_limit,
            crate::storage_scan::storage_scan_start,
            crate::storage_scan::storage_page,
            crate::storage_scan::storage_release,
            tag_identity_effects::tag_identity_apply,
            tag_transactions::tags_catalog,
            tag_transactions::tag_save,
            tag_transactions::tag_merge,
            tag_transactions::tag_delete,
            tag_transactions::tag_assignments,
            tag_transactions::tag_mutate_start,
            tag_transactions::tag_undo,
            tag_transfer::tags_import_preview,
            tag_transfer::tags_import_apply,
            tag_transfer::tags_export_start,
            tag_transfer::tags_write_start,
            tag_transfer::tags_pick_import,
            tag_transfer::tags_pick_export,
            theme_assets::theme_background_import,
            theme_assets::theme_background_lease,
            theme_assets::theme_pick_background,
            theme_fonts::theme_system_fonts,
            theme_material::theme_apply_material,
            theme_transfer::theme_import,
            theme_transfer::theme_export,
            theme_transfer::theme_pick_import,
            theme_transfer::theme_pick_export,
            theme_wallpaper::theme_wallpaper_palette,
            timeline_export::timeline_export_preview_start,
            timeline_export::timeline_export_start,
            timeline_proxy::timeline_proxy_start,
            timeline_proxy::timeline_proxy_release,
            timeline_types::timeline_open_start,
            transfer_commands::transfer_start,
            transfer_commands::transfer_state,
            transfer_commands::transfer_control,
            transfer_commands::transfer_decide,
            transfer_commands::transfer_report_page,
            transfer_commands::transfer_replay_check,
            crate::bulk_rename::rename_preview_start,
            crate::bulk_rename::rename_preview_page,
            crate::bulk_rename::rename_execute_start,
            crate::bulk_rename::rename_report_page,
            crate::bulk_rename::rename_plan_release,
            rename_presets::rename_presets_list,
            rename_presets::rename_preset_write,
            rename_presets::rename_preset_remove,
            updates::update_check,
            updates::update_mark_seen,
            updates::update_open_page,
            waveforms::media_waveform_page,
            watcher_sessions::watch_subscribe,
            watcher_sessions::watch_unsubscribe,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Adperastra")
        .run(|app_handle, event| {
            // A normal exit stops queued and running transfers; completed
            // files stay. Nothing is cancelled while a shutdown is merely
            // requested, because that request may still be cancelled.
            if matches!(event, tauri::RunEvent::Exit) {
                // Step 09h: the event loop exits only after the one window
                // close destroyed the window (the UI runs the dirty-close
                // decision first) or after the accepted resident quit. A
                // crash or a killed process never reaches this event, so the
                // launch stays unclean. Safe mode keeps its launch unclean
                // until the explicit "Restart normally".
                if let Some(health) = app_handle.try_state::<startup_health::StartupHealth>() {
                    // The existing safe-mode guard is fail-closed: an active
                    // or poisoned safe-mode state refuses the marker write.
                    let launch_writable = app_handle
                        .try_state::<safe_mode::SafeMode>()
                        .map(|safe| safe.state_writable().is_ok())
                        .unwrap_or(false);
                    if launch_writable {
                        if let Err(error) = health.mark_clean(unix_now()) {
                            eprintln!("startup health: {error}");
                        }
                    }
                }
                if let Some(coordinator) =
                    app_handle.try_state::<Arc<transfer_control::TransferCoordinator>>()
                {
                    coordinator.cancel_all();
                }
            }
        });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_keeps_file_tab_path_and_handler() {
        let json = serde_json::json!({
            "tabs": [
                { "id": "explorer", "kind": "explorer" },
                { "id": "f1", "kind": "file", "title": "a.png", "path": "C:\\Pictures\\a.png", "handler": "image" }
            ],
            "active_tab": "f1",
            "saved_unix": 1
        });
        let session: SessionState = serde_json::from_value(json).unwrap();
        assert_eq!(session.tabs[1].path.as_deref(), Some("C:\\Pictures\\a.png"));
        assert_eq!(session.tabs[1].handler.as_deref(), Some("image"));
        let back = serde_json::to_value(&session).unwrap();
        assert_eq!(back["tabs"][1]["handler"], "image");
        assert!(back["tabs"][0].get("path").is_none());
    }

    #[test]
    fn startup_switches_never_become_activation_paths() {
        for flag in [
            "--background",
            convert_helper::HELPER_FLAG,
            raw_helper::HELPER_FLAG,
            pdf_helper::HELPER_FLAG,
            extra_view_helper::HELPER_FLAG,
            ocr_helper::HELPER_FLAG,
            webview_helper::HELPER_FLAG,
            thumbnail_helper::HELPER_FLAG,
            metadata_helper::HELPER_FLAG,
            classic_menu::HELPER_FLAG,
            archive_helper::HELPER_FLAG,
            pack_helper::HELPER_FLAG,
            font_helper::HELPER_FLAG,
            office_sheet::HELPER_FLAG,
            disk_broker::HELPER_FLAG,
            privacy_helper::HELPER_FLAG,
            file_locks::HELPER_FLAG,
            artifact_inventory::HELPER_FLAG,
            usn_index_helper::HELPER_FLAG,
            portable::MARKER_HELPER_FLAG,
            installer_data::RECYCLE_DATA_FLAG,
            integration_commands::RESTORE_FLAG,
        ] {
            assert!(is_startup_switch(flag), "{flag} must stay a startup switch");
        }
        for argument in [r"C:\alpha.txt", "--open", "--convert", "--", "--shell"] {
            assert!(!is_startup_switch(argument), "{argument} is not startup");
        }
        // The real predicate feeds the primary-startup request: a startup
        // switch beside one path is dropped, never opened as a file.
        let args = vec![
            "--background".to_string(),
            font_helper::HELPER_FLAG.to_string(),
            r"C:\alpha.txt".to_string(),
        ];
        let request =
            activation::initial_activation_request(&args, is_startup_switch).expect("one request");
        assert_eq!(request.paths, vec![r"C:\alpha.txt".to_string()]);
    }

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
    fn schema_11_import_keeps_existing_values_and_adds_background_defaults() {
        let value = serde_json::json!({
            "schema_version": 11,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "templates": { "my_folder": "C:\\T" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.templates.my_folder, "C:\\T");
        assert_eq!(
            settings.background,
            background::BackgroundSettings::default()
        );
        assert_eq!(settings.cache, background::CacheSettings::default());
    }

    #[test]
    fn settings_v12_migrates_to_v13_keeping_language_theme_and_background() {
        let json = serde_json::json!({
            "schema_version": 12,
            "language": "es",
            "theme": { "mode": "dark" },
            "background": { "enabled": false, "paused": true },
            "cache": { "max_mb": 256 }
        });
        let settings = migrate(json).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(!settings.background.enabled);
        assert_eq!(settings.cache.max_mb, 256);
        assert!(settings.gallery.sources.is_empty());
        assert_eq!(settings.gallery.date_source, "taken");
    }

    #[test]
    fn settings_validate_rejects_more_than_32_gallery_sources() {
        let mut settings = Settings::default();
        for index in 0..33u32 {
            settings.gallery.sources.push(gallery_types::GallerySource {
                id: format!("00000000-0000-4000-8000-{index:012}"),
                path: format!("C:\\Pictures\\set{index}"),
                recursive: true,
            });
        }
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn settings_defaults() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.reading, book_settings::ReadingSettings::default());
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
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
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
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
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
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
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
                ..ThemeSettings::default()
            },
            explorer: ExplorerViewSettings {
                show_hidden: true,
                show_extensions: false,
                item_checkboxes: true,
                details_pane: true,
                group_by: "type".to_string(),
                ..ExplorerViewSettings::default()
            },
            ..Settings::default()
        };
        let value = serde_json::to_value(&original).unwrap();
        assert_eq!(migrate(value).unwrap(), original);
    }

    #[test]
    fn settings_v4_migrates_to_v5_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 4,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "explorer": { "show_hidden": true, "show_extensions": true, "item_checkboxes": false, "details_pane": true, "group_by": "none" },
            "files": { "paste_image_format": "jpg" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
        assert_eq!(settings.files.paste_image_format, "jpg");
        assert_eq!(settings.open, OpenSettings::default());
        assert!(settings.open.protected_view);
    }

    #[test]
    fn settings_v5_migrates_to_v6_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 5,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "explorer": { "show_hidden": true, "show_extensions": true, "item_checkboxes": false, "details_pane": true, "group_by": "type" },
            "files": { "paste_image_format": "jpg" },
            "open": { "protected_view": false, "open_with": { "txt": "windows" } }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
        assert_eq!(settings.explorer.group_by, "type");
        assert_eq!(settings.explorer.view_mode, "details");
        assert!(settings.explorer.remember_view_per_folder);
        assert_eq!(settings.explorer.view_mode_order, default_view_mode_order());
        assert!(settings.explorer.hidden_view_modes.is_empty());
        assert!(!settings.open.protected_view);
        assert_eq!(
            settings.open.open_with.get("txt").map(String::as_str),
            Some("windows")
        );
    }

    #[test]
    fn settings_v6_migrates_to_v7_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 6,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "explorer": {
                "show_hidden": true,
                "show_extensions": true,
                "item_checkboxes": false,
                "details_pane": true,
                "group_by": "type",
                "view_mode": "tiles",
                "remember_view_per_folder": false,
                "view_mode_order": [
                    "extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons",
                    "list", "details", "tiles", "content"
                ],
                "hidden_view_modes": ["list"]
            },
            "files": { "paste_image_format": "jpg" },
            "open": { "protected_view": false, "open_with": { "txt": "windows" } }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
        assert_eq!(settings.explorer.group_by, "type");
        assert_eq!(settings.explorer.view_mode, "tiles");
        assert!(!settings.explorer.remember_view_per_folder);
        assert_eq!(
            settings.explorer.view_mode_order,
            vec![
                "extraLargeIcons",
                "largeIcons",
                "mediumIcons",
                "smallIcons",
                "list",
                "details",
                "tiles",
                "content"
            ]
        );
        assert_eq!(settings.explorer.hidden_view_modes, vec!["list"]);
        assert_eq!(settings.explorer.column_width, 240);
        assert!(settings.explorer.column_preview);
        assert!(!settings.open.protected_view);
        assert_eq!(
            settings.open.open_with.get("txt").map(String::as_str),
            Some("windows")
        );
    }

    #[test]
    fn settings_v7_migrates_to_v8_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 7,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "explorer": {
                "show_hidden": true,
                "show_extensions": true,
                "item_checkboxes": false,
                "details_pane": true,
                "group_by": "type",
                "view_mode": "columns",
                "remember_view_per_folder": false,
                "view_mode_order": [
                    "extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons",
                    "list", "details", "tiles", "content", "columns"
                ],
                "hidden_view_modes": ["list"],
                "column_width": 300,
                "column_preview": false
            },
            "files": { "paste_image_format": "jpg" },
            "open": { "protected_view": false, "open_with": { "txt": "windows" } }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.explorer.view_mode, "columns");
        assert_eq!(settings.explorer.column_width, 300);
        assert!(settings.explorer.details_pane);
        assert_eq!(settings.files.paste_image_format, "jpg");
        assert!(!settings.open.protected_view);
        assert_eq!(settings.layout, LayoutSettings::default());
    }

    #[test]
    fn settings_v8_migrates_to_v9_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 8,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "custom", "accent_custom": "#FF00AA" },
            "explorer": {
                "show_hidden": true,
                "show_extensions": true,
                "item_checkboxes": false,
                "details_pane": true,
                "group_by": "type",
                "view_mode": "tiles",
                "remember_view_per_folder": false,
                "view_mode_order": [
                    "extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons",
                    "list", "details", "tiles", "content", "columns"
                ],
                "hidden_view_modes": ["list"],
                "column_width": 300,
                "column_preview": false
            },
            "files": { "paste_image_format": "jpg" },
            "open": { "protected_view": false, "open_with": { "txt": "windows" } },
            "layout": {
                "toolbar_position": "left",
                "toolbar_mode": "compact",
                "tab_bar_position": "top",
                "tab_bar_collapsed": false,
                "nav_pane_position": "left",
                "details_pane_position": "right",
                "saved_presets": []
            }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_custom, "#FF00AA");
        assert_eq!(settings.layout.toolbar_position, "left");
        assert_eq!(settings.explorer.view_mode, "tiles");
        assert_eq!(settings.theme.light_theme, "light");
        assert_eq!(settings.theme.dark_theme, "dark");
        assert_eq!(settings.appearance, AppearanceSettings::default());
    }

    #[test]
    fn settings_v9_migrates_to_v10_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 9,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "appearance": {
                "ui_scale": 125,
                "density": "compact",
                "corner_radius": "round",
                "animations": "reduced"
            }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.appearance.density, "compact");
        assert_eq!(settings.appearance.ui_scale, 125);
        assert_eq!(settings.versions, VersionSettings::default());
    }

    #[test]
    fn settings_v10_migrates_to_v11_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 10,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "versions": { "enabled": true, "keep_days": 90, "max_mb": 1024 }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.versions.keep_days, 90);
        assert_eq!(settings.templates.my_folder, "");
    }

    #[test]
    fn schema14_keeps_language_and_dark_theme_and_adds_reading_defaults() {
        let value = serde_json::json!({
            "schema_version": 14,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "ocr": { "language": "auto", "enabled": true }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(
            settings.ocr,
            ocr_types::OcrSettings {
                language: "auto".to_string(),
                enabled: true
            }
        );
        assert_eq!(settings.reading.font_px, 18);
        assert_eq!(settings.reading.theme, book_settings::ReadingTheme::App);
    }

    #[test]
    fn settings_validate_rejects_bad_templates_folder() {
        let mut relative = Settings::default();
        relative.templates.my_folder = r"relative\folder".to_string();
        assert!(validate(&relative).is_err());

        let mut too_long = Settings::default();
        too_long.templates.my_folder = "a".repeat(1025);
        assert!(validate(&too_long).is_err());

        let mut empty = Settings::default();
        empty.templates.my_folder = String::new();
        assert!(validate(&empty).is_ok());

        let mut good = Settings::default();
        good.templates.my_folder = r"C:\Users\Ana\Templates".to_string();
        assert!(validate(&good).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_versions() {
        let mut bad_days = Settings::default();
        bad_days.versions.keep_days = 14;
        assert!(validate(&bad_days).is_err());

        let mut bad_size = Settings::default();
        bad_size.versions.max_mb = 100;
        assert!(validate(&bad_size).is_err());

        let mut good = Settings::default();
        good.versions.keep_days = 365;
        good.versions.max_mb = 5120;
        assert!(validate(&good).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_appearance() {
        let mut light_theme = Settings::default();
        light_theme.theme.light_theme = "dark".to_string();
        assert!(validate(&light_theme).is_err());

        let mut dark_theme = Settings::default();
        dark_theme.theme.dark_theme = "paper".to_string();
        assert!(validate(&dark_theme).is_err());

        let mut small_scale = Settings::default();
        small_scale.appearance.ui_scale = 80;
        assert!(validate(&small_scale).is_err());

        let mut zero_scale = Settings::default();
        zero_scale.appearance.ui_scale = 0;
        assert!(validate(&zero_scale).is_err());

        let mut density = Settings::default();
        density.appearance.density = "tiny".to_string();
        assert!(validate(&density).is_err());

        let mut corner_radius = Settings::default();
        corner_radius.appearance.corner_radius = "oval".to_string();
        assert!(validate(&corner_radius).is_err());

        let mut animations = Settings::default();
        animations.appearance.animations = "some".to_string();
        assert!(validate(&animations).is_err());

        let mut good = Settings::default();
        good.theme.light_theme = "paper".to_string();
        good.theme.dark_theme = "highContrast".to_string();
        good.appearance.ui_scale = 75;
        good.appearance.density = "spacious".to_string();
        good.appearance.corner_radius = "square".to_string();
        good.appearance.animations = "off".to_string();
        assert!(validate(&good).is_ok());
        good.appearance.ui_scale = 200;
        assert!(validate(&good).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_layout() {
        let mut toolbar_position = Settings::default();
        toolbar_position.layout.toolbar_position = "middle".to_string();
        assert!(validate(&toolbar_position).is_err());

        let mut toolbar_mode = Settings::default();
        toolbar_mode.layout.toolbar_mode = "tiny".to_string();
        assert!(validate(&toolbar_mode).is_err());

        let mut tab_bar_position = Settings::default();
        tab_bar_position.layout.tab_bar_position = "center".to_string();
        assert!(validate(&tab_bar_position).is_err());

        let mut nav_pane_position = Settings::default();
        nav_pane_position.layout.nav_pane_position = "top".to_string();
        assert!(validate(&nav_pane_position).is_err());

        let mut details_pane_position = Settings::default();
        details_pane_position.layout.details_pane_position = "left".to_string();
        assert!(validate(&details_pane_position).is_err());

        let mut no_name = Settings::default();
        no_name.layout.saved_presets = vec![SavedLayout::default()];
        assert!(validate(&no_name).is_err());

        let mut padded_name = Settings::default();
        padded_name.layout.saved_presets = vec![SavedLayout {
            name: " Work".to_string(),
            ..SavedLayout::default()
        }];
        assert!(validate(&padded_name).is_err());

        let mut long_name = Settings::default();
        long_name.layout.saved_presets = vec![SavedLayout {
            name: "a".repeat(61),
            ..SavedLayout::default()
        }];
        assert!(validate(&long_name).is_err());

        let mut same_name = Settings::default();
        same_name.layout.saved_presets = vec![
            SavedLayout {
                name: "Work".to_string(),
                ..SavedLayout::default()
            },
            SavedLayout {
                name: "work".to_string(),
                ..SavedLayout::default()
            },
        ];
        assert!(validate(&same_name).is_err());

        let mut too_many = Settings::default();
        too_many.layout.saved_presets = (0..=MAX_SAVED_LAYOUTS)
            .map(|n| SavedLayout {
                name: format!("p{n}"),
                ..SavedLayout::default()
            })
            .collect();
        assert!(validate(&too_many).is_err());

        let mut bad_preset_value = Settings::default();
        bad_preset_value.layout.saved_presets = vec![SavedLayout {
            name: "Work".to_string(),
            toolbar_mode: "tiny".to_string(),
            ..SavedLayout::default()
        }];
        assert!(validate(&bad_preset_value).is_err());

        let mut side_preset = Settings::default();
        side_preset.layout.saved_presets = vec![SavedLayout {
            name: "Work".to_string(),
            toolbar_position: "left".to_string(),
            ..SavedLayout::default()
        }];
        assert!(validate(&side_preset).is_ok());

        let mut twenty = Settings::default();
        twenty.layout.saved_presets = (0..MAX_SAVED_LAYOUTS)
            .map(|n| SavedLayout {
                name: format!("p{n}"),
                ..SavedLayout::default()
            })
            .collect();
        assert!(validate(&twenty).is_ok());

        let mut longest_ok = Settings::default();
        longest_ok.layout.saved_presets = vec![SavedLayout {
            name: "a".repeat(MAX_LAYOUT_NAME),
            ..SavedLayout::default()
        }];
        assert!(validate(&longest_ok).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_column_width() {
        for bad in [159, 481, 0] {
            let mut settings = Settings::default();
            settings.explorer.column_width = bad;
            assert!(validate(&settings).is_err(), "{bad}");
        }
        for ok in [160, 480] {
            let mut settings = Settings::default();
            settings.explorer.column_width = ok;
            assert!(validate(&settings).is_ok(), "{ok}");
        }
        let mut columns = Settings::default();
        columns.explorer.view_mode = "columns".to_string();
        assert!(validate(&columns).is_ok());
        let mut hidden = Settings::default();
        hidden.explorer.hidden_view_modes = vec!["columns".to_string()];
        assert!(validate(&hidden).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_view_settings() {
        let mut bad_mode = Settings::default();
        bad_mode.explorer.view_mode = "huge".to_string();
        assert!(validate(&bad_mode).is_err());

        let mut twice = Settings::default();
        twice.explorer.view_mode_order = vec!["list".to_string(), "list".to_string()];
        assert!(validate(&twice).is_err());

        let mut unknown = Settings::default();
        unknown.explorer.view_mode_order = vec!["giant".to_string()];
        assert!(validate(&unknown).is_err());

        let mut too_long = Settings::default();
        too_long.explorer.view_mode_order = (0..17).map(|_| "list".to_string()).collect();
        assert!(validate(&too_long).is_err());

        let mut hide_details = Settings::default();
        hide_details.explorer.hidden_view_modes = vec!["details".to_string()];
        assert!(validate(&hide_details).is_err());

        let mut hidden_twice = Settings::default();
        hidden_twice.explorer.hidden_view_modes = vec!["tiles".to_string(), "tiles".to_string()];
        assert!(validate(&hidden_twice).is_err());

        let mut hidden_tiles = Settings::default();
        hidden_tiles.explorer.hidden_view_modes = vec!["tiles".to_string()];
        assert!(validate(&hidden_tiles).is_ok());

        let mut content = Settings::default();
        content.explorer.view_mode = "content".to_string();
        assert!(validate(&content).is_ok());

        let mut details_only = Settings::default();
        details_only.explorer.view_mode_order = vec!["details".to_string()];
        assert!(validate(&details_only).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_open_with() {
        let mut settings = Settings::default();
        settings
            .open
            .open_with
            .insert("txt".to_string(), "windows".to_string());
        settings
            .open
            .open_with
            .insert("c++".to_string(), "builtin".to_string());
        assert!(validate(&settings).is_ok());
        for (ext, choice) in [
            ("txt", "notepad"),
            ("TXT", "windows"),
            ("", "windows"),
            ("a.b", "windows"),
            ("abcdefghijklmnopq", "windows"),
        ] {
            let mut bad = Settings::default();
            bad.open
                .open_with
                .insert(ext.to_string(), choice.to_string());
            assert!(validate(&bad).is_err(), "{ext:?} {choice:?}");
        }
        let mut many = Settings::default();
        for n in 0..=MAX_OPEN_WITH {
            many.open
                .open_with
                .insert(format!("x{n}"), "windows".to_string());
        }
        assert!(validate(&many).is_err());
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
                    path: None,
                    handler: None,
                },
                SessionTab {
                    id: "tab-1".to_string(),
                    kind: "help".to_string(),
                    title: Some("Getting started".to_string()),
                    path: None,
                    handler: None,
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
    fn cancelling_a_listing_drops_its_job() {
        let job = ListJob {
            batches: std::collections::VecDeque::from(vec![vec![]]),
            done: false,
            outcome: None,
            error: None,
            token: fs_service::new_cancellation_token(),
        };
        let token = job.token.clone();
        let mut jobs = HashMap::new();
        jobs.insert("list-a".to_string(), job);
        assert!(cancel_list_job(&mut jobs, "list-a"));
        assert!(jobs.is_empty());
        assert!(token.load(Ordering::Relaxed));
        assert!(!cancel_list_job(&mut jobs, "list-a"));
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
        // Replace is refused until exact approved targets exist; the UI
        // offers Merge, Skip and Keep both instead.
        assert_eq!(
            parse_conflict_policy("replace").err().as_deref(),
            Some("ops.replace_unavailable")
        );
        assert_eq!(
            parse_conflict_policy("keepBoth").unwrap(),
            fs_service::ConflictPolicy::KeepBoth
        );
        assert_eq!(
            parse_conflict_policy("merge").unwrap(),
            fs_service::ConflictPolicy::Merge
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

    #[test]
    fn settings_v55_migrates_to_v56_and_preserves_existing_sections() {
        let value = serde_json::json!({
            "schema_version": 55,
            "language": "es",
            "theme": { "mode": "dark" },
            "tabs": { "drag_hover_ms": 800 },
            "shelf": { "visible": true, "side": "left", "size": 400 },
            "startup": { "mode": "restore", "folder": "C:\\Work" },
            "transfers": { "verify_copies": true, "queue_per_volume": true, "max_parallel": 1 },
            "ai": {
                "writing": { "inline_enabled": true, "enabled_types": { "text": true } },
                "documents": { "enabled": true, "experimental_actions": ["rewrite"] },
                "sheets": { "enabled": true, "experimental_actions": ["formula"] }
            }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.tabs.drag_hover_ms, 800);
        assert!(settings.shelf.visible);
        assert_eq!(settings.shelf.side, "left");
        assert_eq!(settings.shelf.size, 400);
        assert_eq!(settings.startup.mode, "restore");
        assert_eq!(settings.startup.folder, "C:\\Work");
        assert!(settings.transfers.verify_copies);
        assert_eq!(settings.transfers.max_parallel, 1);
        assert!(settings.ai.writing.inline_enabled);
        assert_eq!(
            settings.ai.documents.experimental_actions,
            vec![office_document_ai_types::DocumentAiAction::Rewrite]
        );
        assert_eq!(
            settings.ai.sheets.experimental_actions,
            vec![office_sheet_ai_types::SheetAiAction::Formula]
        );
        assert_eq!(settings.ai.decks, DeckAiSettings::default());
    }

    #[test]
    fn settings_v27_migrates_to_v28_keeping_day_night_refs() {
        let value = serde_json::json!({
            "schema_version": 27,
            "language": "es",
            "theme": {
                "mode": "dark",
                "accent_source": "design",
                "accent_custom": "#0067C0",
                "light_theme": "paper",
                "dark_theme": "amoled"
            }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.language, "es");
        assert_eq!(
            settings.theme_custom.day,
            fs_service::theme_data::ThemeRef::builtin("paper")
        );
        assert_eq!(
            settings.theme_custom.night,
            fs_service::theme_data::ThemeRef::builtin("amoled")
        );
        assert_eq!(settings.theme_custom.mode, "manual");
        assert_eq!(settings.theme_custom.manual_scheme, "dark");
    }

    #[test]
    fn settings_v29_migrates_to_v30_keeping_language_and_theme_and_legacy_sizes() {
        let value = serde_json::json!({
            "schema_version": 29,
            "language": "es",
            "theme": { "mode": "dark" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.format_options.size_base, "legacy");
        assert_eq!(
            settings.tab_options,
            preferences_validation::TabOptions::default()
        );
        assert_eq!(
            settings.behavior,
            preferences_validation::BehaviorSettings::default()
        );
    }

    #[test]
    fn settings_v40_migrates_to_v41_adding_local_ai() {
        let value = serde_json::json!({
            "schema_version": 40,
            "language": "es",
            "theme": { "mode": "dark" },
            "templates": { "my_folder": "C:\\T" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.templates.my_folder, "C:\\T");
        assert_eq!(
            settings.local_ai,
            ai_runtime::types_ui::LocalAiSettings::default()
        );
    }

    #[test]
    fn settings_v46_migrates_to_v47_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 46,
            "language": "es",
            "theme": { "mode": "dark" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(!settings.ai.writing.inline_enabled);
        assert_eq!(
            settings.ai.writing.enabled_types,
            AiInlineEnabledTypes::default()
        );
    }

    #[test]
    fn settings_defaults_for_new_sections() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, 56);
        assert_eq!(settings.startup, StartupSettings::default());
        assert_eq!(settings.tabs.drag_hover_ms, 600);
        assert_eq!(settings.palette, PaletteSettings::default());
        assert_eq!(settings.transfers, TransferSettings::default());
        assert_eq!(settings.shelf, ShelfSettings::default());
        assert_eq!(settings.recovery, RecoverySettings::default());
        assert_eq!(settings.folder_sizes, FolderSizeSettings::default());
        assert_eq!(settings.pack_catalog, PackCatalogSettings::default());
        assert_eq!(settings.office_view.idle_seconds, 60);
        assert_eq!(settings.pdf_tools.author, "");
        assert_eq!(settings.image_editor.selection_tolerance, 15);
        assert_eq!(settings.media_editor.preview_quality, "960");
        assert_eq!(settings.office_edit.idle_minutes, 5);
        assert_eq!(settings.sheet_editor.default_zoom, 100.0);
        assert_eq!(settings.deck_editor.default_aspect, "wide");
        assert!(!settings.ai.decks.enabled);
        assert!(settings.ai.decks.experimental_actions.is_empty());
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn settings_validate_rejects_bad_new_sections() {
        let mut startup_mode = Settings::default();
        startup_mode.startup.mode = "elsewhere".to_string();
        assert!(validate(&startup_mode).is_err());

        let mut startup_folder = Settings::default();
        startup_folder.startup.folder = "relative".to_string();
        assert!(validate(&startup_folder).is_err());

        let mut startup_resident = Settings::default();
        startup_resident.startup.start_with_windows = true;
        assert!(validate(&startup_resident).is_err());

        let mut tab_hover = Settings::default();
        tab_hover.tabs.drag_hover_ms = 199;
        assert!(validate(&tab_hover).is_err());

        let mut palette = Settings::default();
        palette.palette.recent_ids = (0..=PALETTE_MAX_RECENT_IDS)
            .map(|index| format!("command.{index}"))
            .collect();
        assert!(validate(&palette).is_err());

        let mut transfer_parallel = Settings::default();
        transfer_parallel.transfers.max_parallel = 3;
        assert!(validate(&transfer_parallel).is_err());

        let mut transfer_queue = Settings::default();
        transfer_queue.transfers.queue_per_volume = false;
        assert!(validate(&transfer_queue).is_err());

        let mut shelf_side = Settings::default();
        shelf_side.shelf.side = "top".to_string();
        assert!(validate(&shelf_side).is_err());

        let mut shelf_size = Settings::default();
        shelf_size.shelf.size = 119;
        assert!(validate(&shelf_size).is_err());

        let mut recovery = Settings::default();
        recovery.recovery.interval_seconds = 9;
        assert!(validate(&recovery).is_err());

        let mut clipboard = Settings::default();
        clipboard.clipboard_history.max_items = 9;
        assert!(validate(&clipboard).is_err());

        let mut locked = Settings::default();
        locked.locked.auto_lock_minutes = 2;
        assert!(validate(&locked).is_err());

        let mut tab_options = Settings::default();
        tab_options.tab_options.title_limit = 11;
        assert!(validate(&tab_options).is_err());

        let mut format_options = Settings::default();
        format_options.format_options.decimals = 5;
        assert!(validate(&format_options).is_err());

        let mut accessibility = Settings::default();
        accessibility.accessibility.focus_px = 5;
        assert!(validate(&accessibility).is_err());

        let mut search = Settings::default();
        search.search.index_limit_mb = 100;
        assert!(validate(&search).is_err());

        let mut pack_catalog = Settings::default();
        pack_catalog.pack_catalog.last_checked_unix = Some(9_007_199_254_740_992);
        assert!(validate(&pack_catalog).is_err());

        let mut cpu = Settings::default();
        cpu.background.cpu_percent = 4;
        assert!(validate(&cpu).is_err());

        let mut office_view = Settings::default();
        office_view.office_view.idle_seconds = 30;
        assert!(validate(&office_view).is_err());

        let mut pdf_author = Settings::default();
        pdf_author.pdf_tools.author = "a".repeat(129);
        assert!(validate(&pdf_author).is_err());

        let mut image_mode = Settings::default();
        image_mode.image_editor.default_mode = "crop".to_string();
        assert!(validate(&image_mode).is_err());

        let mut image_tolerance = Settings::default();
        image_tolerance.image_editor.selection_tolerance = 101;
        assert!(validate(&image_tolerance).is_err());

        let mut media_quality = Settings::default();
        media_quality.media_editor.preview_quality = "480".to_string();
        assert!(validate(&media_quality).is_err());

        let mut assistant = Settings::default();
        assistant.assistant.local_server_port = 80;
        assert!(validate(&assistant).is_err());

        let mut ai_actions = Settings::default();
        ai_actions.ai_actions.caption_window_seconds = 10;
        assert!(validate(&ai_actions).is_err());

        let mut ai_search = Settings::default();
        ai_search.ai_search.roots = vec![ai_search_types::AiSemanticRoot {
            root_id: "not-a-uuid".to_string(),
            text: true,
            photos: false,
        }];
        assert!(validate(&ai_search).is_err());

        let mut document_ai = Settings::default();
        document_ai.ai.documents.experimental_actions = vec![
            office_document_ai_types::DocumentAiAction::Rewrite,
            office_document_ai_types::DocumentAiAction::Rewrite,
        ];
        assert!(validate(&document_ai).is_err());

        let mut sheet_zoom = Settings::default();
        sheet_zoom.sheet_editor.default_zoom = 500.0;
        assert!(validate(&sheet_zoom).is_err());

        let mut sheet_ai = Settings::default();
        sheet_ai.ai.sheets.experimental_actions = vec![
            office_sheet_ai_types::SheetAiAction::Formula,
            office_sheet_ai_types::SheetAiAction::Formula,
        ];
        assert!(validate(&sheet_ai).is_err());

        let mut deck_aspect = Settings::default();
        deck_aspect.deck_editor.default_aspect = "4:3".to_string();
        assert!(validate(&deck_aspect).is_err());

        let mut deck_ai = Settings::default();
        deck_ai.ai.decks.experimental_actions = vec!["delete".to_string()];
        assert!(validate(&deck_ai).is_err());

        let mut office_edit = Settings::default();
        office_edit.office_edit.idle_minutes = 10;
        assert!(validate(&office_edit).is_err());
    }

    #[test]
    fn settings_round_trip_keeps_all_sections() {
        let settings = Settings::default();
        let value = serde_json::to_value(&settings).unwrap();
        let back: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(back, settings);
        assert!(validate(&back).is_ok());
    }

    #[test]
    fn app_state_accessors_use_current_settings_fields() {
        let state = AppState {
            data_dir: PathBuf::from("."),
            settings: Mutex::new(Settings::default()),
            list_jobs: Mutex::new(HashMap::new()),
            file_jobs: Mutex::new(HashMap::new()),
            transfer_history: Arc::new(Mutex::new(transfer_history::TransferHistory::default())),
            explorer_state_lock: Mutex::new(()),
            watch: Mutex::new(None),
            watch_next_id: AtomicU64::new(0),
        };
        {
            let mut settings = state.settings.lock().unwrap();
            settings.views.map_online_enabled = true;
            settings.folder_sizes.enabled = true;
            settings.folder_sizes.network = true;
            settings.transfers.verify_copies = true;
        }
        assert!(state.views_settings().unwrap().map_online_enabled);
        let options = state.folder_size_options();
        assert!(options.enabled);
        assert!(options.network);
        assert!(state.verify_copies());
    }
}
