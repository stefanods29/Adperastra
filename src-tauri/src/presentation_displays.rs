//! Live monitor enumeration for Step 22a T7.
//!
//! Monitor ids are opaque device names from the OS and are never turned into
//! shell text. A request must name a display that is live at start time, and
//! the rectangle is revalidated by the child before it creates its fullscreen
//! audience window. Negative origins (a display left of or above the primary)
//! are valid.
#![allow(dead_code)]


use windows::Win32::Foundation::{LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

use crate::presentation::{PresentationDisplay, PresentationRect};

/// The validated display a presentation may occupy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayChoice {
    pub id: String,
    pub rect: PresentationRect,
}

impl DisplayChoice {
    pub fn as_placement_rect(&self) -> crate::webview_helper_types::HelperDisplayRect {
        crate::webview_helper_types::HelperDisplayRect {
            left: self.rect.left,
            top: self.rect.top,
            width: self.rect.width.max(0) as u32,
            height: self.rect.height.max(0) as u32,
        }
    }
}

fn escaped_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(128)
        .collect()
}

/// Enumerate the current monitors. Called off the UI thread; a transient
/// enumeration failure is a typed error, never an empty "success".
pub fn list_displays() -> Result<Vec<PresentationDisplay>, String> {
    let mut displays: Vec<PresentationDisplay> = Vec::new();
    let pointer = &mut displays as *mut Vec<PresentationDisplay> as isize;
    // SAFETY: the callback receives a valid pointer to `displays` for the
    // duration of the call and only appends owned values through it.
    let ok = unsafe {
        EnumDisplayMonitors(None, None, Some(monitor_callback), LPARAM(pointer))
    };
    if !ok.as_bool() || displays.is_empty() {
        return Err("presentation.display_missing".to_string());
    }
    Ok(displays)
}

unsafe extern "system" fn monitor_callback(
    monitor: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    data: LPARAM,
) -> windows::core::BOOL {
    let displays = &mut *(data.0 as *mut Vec<PresentationDisplay>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    // SAFETY: `info` is a live MONITORINFOEXW; its first member is the
    // MONITORINFO the API writes, and cbSize names the full buffer.
    let filled = unsafe {
        GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO)
    };
    if !filled.as_bool() {
        return TRUE;
    }
    let device = String::from_utf16_lossy(&info.szDevice)
        .trim_end_matches('\0')
        .to_string();
    let index = displays.len() + 1;
    let id = if device.is_empty() { format!("monitor-{index}") } else { device.clone() };
    let name = if device.is_empty() { format!("Display {index}") } else { device };
    let rect = info.monitorInfo.rcMonitor;
    displays.push(PresentationDisplay {
        id: escaped_name(&id),
        name: escaped_name(&name),
        rect: PresentationRect {
            left: rect.left,
            top: rect.top,
            width: rect.right.saturating_sub(rect.left),
            height: rect.bottom.saturating_sub(rect.top),
        },
        primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
    });
    TRUE
}

/// A request must name exactly one live display. `expected` is the rectangle
/// the parent announced; when present it must still match the live monitor.
pub fn validate_display_choice(
    displays: &[PresentationDisplay],
    display_id: &str,
    expected: Option<&PresentationRect>,
) -> Result<DisplayChoice, String> {
    if display_id.is_empty() || display_id.len() > 128 {
        return Err("presentation.invalid".to_string());
    }
    let display = displays
        .iter()
        .find(|entry| entry.id == display_id)
        .ok_or_else(|| "presentation.display_missing".to_string())?;
    if display.rect.width <= 0 || display.rect.height <= 0 {
        return Err("presentation.display_missing".to_string());
    }
    if let Some(expected) = expected {
        if expected != &display.rect {
            return Err("presentation.display_missing".to_string());
        }
    }
    Ok(DisplayChoice { id: display.id.clone(), rect: display.rect.clone() })
}

/// Re-check before a new frame or after a wake: a disconnected monitor
/// pauses the presentation instead of silently painting into a dead window.
pub fn choice_is_live(choice: &DisplayChoice, displays: &[PresentationDisplay]) -> bool {
    displays.iter().any(|display| display.id == choice.id && display.rect == choice.rect)
}

/// The primary display, used only when the user explicitly accepts moving a
/// disconnected output; it is never assumed as the original presentation
/// target.
pub fn primary_display(displays: &[PresentationDisplay]) -> Option<DisplayChoice> {
    displays
        .iter()
        .find(|display| display.primary)
        .map(|display| DisplayChoice { id: display.id.clone(), rect: display.rect.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: &str, left: i32, width: i32, primary: bool) -> PresentationDisplay {
        PresentationDisplay {
            id: id.to_string(),
            name: id.to_string(),
            rect: PresentationRect { left, top: 0, width, height: 1080 },
            primary,
        }
    }

    #[test]
    fn negative_origin_is_valid() {
        let displays = vec![display("\\\\.\\DISPLAY2", -1920, 1920, false)];
        let choice = validate_display_choice(&displays, "\\\\.\\DISPLAY2", None).unwrap();
        assert_eq!(choice.rect.left, -1920);
        assert_eq!(choice.rect.width, 1920);
    }

    #[test]
    fn display_id_must_be_live_and_rect_must_match() {
        let displays = vec![display("\\\\.\\DISPLAY1", 0, 2560, true)];
        assert!(validate_display_choice(&displays, "monitor-0", None).is_err());
        let expected = PresentationRect { left: 1, top: 0, width: 2560, height: 1080 };
        assert!(validate_display_choice(&displays, "\\\\.\\DISPLAY1", Some(&expected)).is_err());
        assert!(primary_display(&displays).is_some());
    }
}
