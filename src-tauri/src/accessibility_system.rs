//! Windows accessibility snapshot (Step 10f E1): forced colors, reduced
//! motion, text scale and the double-click time, read from the OS each time
//! so a Windows change is never persisted over the user's own choices.
#![allow(dead_code)]


use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::accessibility_types::{validate_system_accessibility, SystemAccessibility};
use crate::ensure_main;

static GENERATION: AtomicU64 = AtomicU64::new(0);

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

/// WinRT (`UISettings`) needs an initialized apartment on the calling
/// thread. The command runs on a blocking-pool thread, which has none, so
/// text scale would silently fall back to 1.0 without this guard.
#[cfg(windows)]
struct ComApartment {
    uninit: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn enter() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            uninit: result.is_ok(),
        }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninit {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

/// Reads the current OS values. Pure queries only; nothing is written to
/// settings here (U6: Windows state never overwrites stored preferences).
#[cfg(windows)]
pub fn current_system_accessibility() -> Result<SystemAccessibility, String> {
    use windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SPI_GETHIGHCONTRAST,
        SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    let _apartment = ComApartment::enter();
    let mut contrast = HIGHCONTRASTW {
        cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
        ..Default::default()
    };
    // SAFETY: `contrast` is a correctly sized, writable HIGHCONTRASTW that
    // outlives the call; the action only fills it.
    let contrast_ok = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some(&mut contrast as *mut HIGHCONTRASTW as *mut core::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    }
    .is_ok();
    let forced_colors = contrast_ok && (contrast.dwFlags & HCF_HIGHCONTRASTON).0 != 0;

    let mut animations_enabled = windows::core::BOOL(1);
    // SAFETY: `animations_enabled` is a writable BOOL that outlives the
    // call; SPI_GETCLIENTAREAANIMATION only fills it.
    let motion_ok = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some(&mut animations_enabled as *mut windows::core::BOOL as *mut core::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    }
    .is_ok();
    let reduced_motion = motion_ok && !animations_enabled.as_bool();

    // WinRT text scale (1.0 = 100%). A failure leaves the neutral factor;
    // the webview media queries still report forced colors/motion (D1).
    let text_scale = windows::UI::ViewManagement::UISettings::new()
        .and_then(|settings| settings.TextScaleFactor())
        .unwrap_or(1.0)
        .clamp(1.0, 3.0);

    let system = SystemAccessibility {
        forced_colors,
        reduced_motion,
        text_scale,
        double_click_ms: unsafe { GetDoubleClickTime() }.min(u32::from(u16::MAX)) as u16,
        generation: next_generation(),
    };
    validate_system_accessibility(&system)?;
    Ok(system)
}

#[cfg(not(windows))]
pub fn current_system_accessibility() -> Result<SystemAccessibility, String> {
    Err("accessibility.invalid".to_string())
}

/// Emits the fresh snapshot to the UI (`accessibility-system`, E1). Called
/// by the coordinator's Windows setting-change hook; emitting is the only
/// effect, stored preferences are untouched.
pub fn emit_system_accessibility(app: &AppHandle) -> Result<(), String> {
    let system = current_system_accessibility()?;
    app.emit("accessibility-system", system)
        .map_err(|_| "accessibility.invalid".to_string())
}

/// Current Windows accessibility snapshot for the main window.
#[tauri::command]
pub async fn accessibility_system_state(
    window: WebviewWindow,
) -> Result<SystemAccessibility, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(current_system_accessibility)
        .await
        .map_err(|_| "accessibility.invalid".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generations_increase() {
        let first = next_generation();
        let second = next_generation();
        assert!(second > first);
    }
}
