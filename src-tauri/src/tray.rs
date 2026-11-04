//! The one resident tray icon (Step 16, guide D8).
//!
//! Tauri 2.12 APIs used here: `TrayIconBuilder::with_id`, `.menu()`,
//! `.on_menu_event()`, `.on_tray_icon_event()`, `TrayIcon::set_menu()`.
//! There is one tray with a fixed id; a language change rebuilds its menu and
//! replaces the labels without creating a second icon. The native menu is
//! keyboard accessible through Windows itself.
#![allow(dead_code)]


use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::resident::ResidentRuntime;

pub const TRAY_ID: &str = "adperastra-tray";
pub const MENU_OPEN: &str = "resident.open";
pub const MENU_TURN_OFF: &str = "resident.turnOff";
pub const MENU_QUIT: &str = "resident.quit";
/// Product name shown as the icon tooltip; it is not translated.
pub const APP_TOOLTIP: &str = "Adperastra";

/// The translated labels. The UI sends them after a language change; they
/// are bounded and checked by the command before this module sees them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrayLabels {
    pub open: String,
    pub turn_off: String,
    pub quit: String,
}

/// Serializes creation and label replacement for the single tray.
static TRAY_LOCK: Mutex<()> = Mutex::new(());

fn failed() -> String {
    "resident.failed".to_string()
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, labels: &TrayLabels) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, MENU_OPEN, &labels.open, true, None::<&str>)?;
    let turn_off = MenuItem::with_id(app, MENU_TURN_OFF, &labels.turn_off, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, &labels.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(
        app,
        &[
            &open as &dyn IsMenuItem<R>,
            &turn_off as &dyn IsMenuItem<R>,
            &separator as &dyn IsMenuItem<R>,
            &quit as &dyn IsMenuItem<R>,
        ],
    )
}

fn dispatch_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let runtime = app.state::<ResidentRuntime>();
    match id {
        MENU_OPEN => {
            let _ = runtime.coordinator().restore_window();
        }
        MENU_TURN_OFF => {
            let _ = runtime.coordinator().turn_off();
        }
        MENU_QUIT => {
            let _ = runtime.coordinator().quit();
        }
        _ => {}
    }
}

/// Create the tray once. When it already exists, only the labels change.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> Result<(), String> {
    let _guard = TRAY_LOCK.lock().map_err(|_| failed())?;
    if app.tray_by_id(TRAY_ID).is_some() {
        // A previous disable hid the icon but kept the one tray. Turning
        // residence on again must bring that same icon back, not leave an
        // invisible resident copy.
        refresh_labels_locked(app, labels)?;
        return set_visible(app, true);
    }
    // A tray without an icon would be invisible; refuse instead of leaving
    // the user unable to open or quit the background copy. The package must
    // provide the app's own icon (coordinator-owned bundle assets).
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(failed)?;
    let menu = build_menu(app, &labels).map_err(|_| failed())?;
    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(icon)
        .show_menu_on_left_click(false)
        .tooltip(APP_TOOLTIP)
        .on_menu_event(|app, event| {
            dispatch_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                let app = tray.app_handle();
                let runtime = app.state::<ResidentRuntime>();
                let _ = runtime.coordinator().restore_window();
            }
        })
        .build(app)
        .map_err(|_| failed())?;
    Ok(())
}

/// Replace the three labels of the existing tray menu. A missing tray means
/// the app is not resident, which is not an error.
pub fn refresh_labels<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> Result<(), String> {
    let _guard = TRAY_LOCK.lock().map_err(|_| failed())?;
    refresh_labels_locked(app, labels)
}

fn refresh_labels_locked<R: Runtime>(
    app: &AppHandle<R>,
    labels: TrayLabels,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_menu(app, &labels).map_err(|_| failed())?;
    tray.set_menu(Some(menu)).map_err(|_| failed())
}

/// Show or hide the tray. The icon stays visible for the whole resident
/// lifetime and disappears only when residency ends.
pub fn set_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_visible(visible).map_err(|_| failed())
}
