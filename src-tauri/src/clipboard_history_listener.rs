//! Private-aware Windows clipboard listener (Step 09j T4).
//!
//! The listener inspects privacy formats before it reads any payload. If
//! an app marked the item private, or history/cloud inclusion is disabled,
//! nothing is read. Only plain text, a validated file list and a bounded
//! bitmap are captured; HTML, RTF and OLE objects are never parsed. A copy
//! that changes while it is being read is discarded by sequence number.
#![allow(dead_code)]


use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::clipboard_history_payload::{png_dimensions, validate_files, validate_image, validate_text};
use crate::clipboard_history_types::{
    CapturedPayload, MAX_IMAGE_BYTES, MAX_TEXT_BYTES,
};

/// How many times OpenClipboard is tried before an update is skipped.
pub const OPEN_ATTEMPTS: usize = 3;
/// Delay between clipboard attempts.
pub const OPEN_RETRY_MS: u64 = 50;
/// The event the renderer listens to after a capture.
pub const CHANGED_EVENT: &str = "clipboard-history-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivateMarker {
    ExcludeFromMonitor,
    ClipboardViewerIgnore,
    HistoryDisabled,
    CloudDisabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProbeSnapshot {
    pub sequence: u32,
    pub private: Option<PrivateMarker>,
    pub has_text: bool,
    pub has_files: bool,
    pub has_image: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardImage {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

/// The clipboard operations the capture logic needs, so tests can prove
/// the order and the privacy gate without touching Windows.
pub trait ClipboardProbe {
    fn snapshot(&mut self) -> Result<ProbeSnapshot, String>;
    fn read_text(&mut self) -> Result<Option<String>, String>;
    fn read_files(&mut self) -> Result<Option<Vec<String>>, String>;
    fn read_image(&mut self) -> Result<Option<ClipboardImage>, String>;
    fn sequence(&self) -> u32;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureSkip {
    Disabled,
    Busy,
    Private,
    Changed,
    TooLarge,
    Invalid,
    Empty,
}

#[derive(Debug)]
pub enum CaptureOutcome {
    Captured(CapturedPayload),
    Skipped(CaptureSkip),
}

/// Try OpenClipboard at most three times, fifty milliseconds apart.
pub fn open_with_retries(
    mut attempt: impl FnMut() -> bool,
    mut wait: impl FnMut(),
) -> bool {
    for index in 0..OPEN_ATTEMPTS {
        if attempt() {
            return true;
        }
        if index + 1 < OPEN_ATTEMPTS {
            wait();
        }
    }
    false
}

fn skip_for(code: &str) -> CaptureSkip {
    if code == "clipboard_history.too_large" {
        CaptureSkip::TooLarge
    } else {
        CaptureSkip::Invalid
    }
}

/// Read one clipboard generation. Privacy is checked before any payload
/// read; files win over text, text over an image-only bitmap.
pub fn capture_once(probe: &mut dyn ClipboardProbe, enabled: bool) -> CaptureOutcome {
    if !enabled {
        return CaptureOutcome::Skipped(CaptureSkip::Disabled);
    }
    let snapshot = match probe.snapshot() {
        Ok(snapshot) => snapshot,
        Err(_) => return CaptureOutcome::Skipped(CaptureSkip::Busy),
    };
    if snapshot.private.is_some() {
        return CaptureOutcome::Skipped(CaptureSkip::Private);
    }
    let before = snapshot.sequence;
    let payload = if snapshot.has_files {
        match probe.read_files() {
            Ok(Some(paths)) if !paths.is_empty() => {
                if let Err(code) = validate_files(paths.clone()) {
                    return CaptureOutcome::Skipped(skip_for(&code));
                }
                Some(CapturedPayload::Files(paths))
            }
            _ => None,
        }
    } else {
        None
    };
    let payload = match payload {
        Some(payload) => Some(payload),
        None if snapshot.has_text => match probe.read_text() {
            Ok(Some(text)) if !text.is_empty() => {
                if let Err(code) = validate_text(&text) {
                    return CaptureOutcome::Skipped(skip_for(&code));
                }
                Some(CapturedPayload::Text(text))
            }
            _ => None,
        },
        None => None,
    };
    let payload = match payload {
        Some(payload) => Some(payload),
        None if snapshot.has_image => match probe.read_image() {
            Ok(Some(image)) => {
                if let Err(code) =
                    validate_image(&image.mime, image.width, image.height, &image.bytes)
                {
                    return CaptureOutcome::Skipped(skip_for(&code));
                }
                Some(CapturedPayload::Image {
                    mime: image.mime,
                    width: image.width,
                    height: image.height,
                    bytes: image.bytes,
                })
            }
            _ => None,
        },
        None => None,
    };
    let Some(payload) = payload else {
        return CaptureOutcome::Skipped(CaptureSkip::Empty);
    };
    if probe.sequence() != before {
        return CaptureOutcome::Skipped(CaptureSkip::Changed);
    }
    CaptureOutcome::Captured(payload)
}

/// The process-wide clipboard update hook. Tauri's setup calls `install`
/// once; disabling capture removes the format listener.
static APP: OnceLock<AppHandle> = OnceLock::new();
/// True only after the window subclass really accepted our callback. The
/// Windows-wide listener is never enabled without it.
static SUBCLASS_INSTALLED: AtomicBool = AtomicBool::new(false);
const SUBCLASS_ID: usize = 0x09_4A;
const WM_CLIPBOARDUPDATE: u32 = 0x031D;

/// Install the window subclass. It never registers the format listener
/// until `set_capture_enabled(true)` is called from settings.
#[cfg(windows)]
pub fn install(window: &WebviewWindow, app: AppHandle) -> Result<(), String> {
    use windows::Win32::UI::Shell::SetWindowSubclass;
    let _ = APP.set(app);
    let raw = window.hwnd().map_err(|_| "clipboard_history.io".to_string())?;
    let hwnd = windows::Win32::Foundation::HWND(raw.0);
    // SAFETY: the main window lives for the app's lifetime; the subclass
    // only reads settings and forwards every message.
    let installed = unsafe {
        SetWindowSubclass(hwnd, Some(clipboard_subclass_proc), SUBCLASS_ID, 0)
    };
    if installed.as_bool() {
        SUBCLASS_INSTALLED.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("clipboard_history.io".to_string())
    }
}

/// Start or stop the Windows-wide capture hook.
#[cfg(windows)]
pub fn set_capture_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use windows::Win32::System::DataExchange::{
        AddClipboardFormatListener, RemoveClipboardFormatListener,
    };
    let Some(window) = app.get_webview_window("main") else {
        return Err("clipboard_history.io".to_string());
    };
    let raw = window.hwnd().map_err(|_| "clipboard_history.io".to_string())?;
    let hwnd = windows::Win32::Foundation::HWND(raw.0);
    // SAFETY: the handle is the live main window.
    let result = unsafe {
        if enabled {
            AddClipboardFormatListener(hwnd)
        } else {
            RemoveClipboardFormatListener(hwnd)
        }
    };
    result.map_err(|_| "clipboard_history.io".to_string())
}

#[cfg(not(windows))]
pub fn install(_window: &WebviewWindow, _app: AppHandle) -> Result<(), String> {
    Err("clipboard_history.io".to_string())
}

#[cfg(not(windows))]
pub fn set_capture_enabled(_app: &AppHandle, _enabled: bool) -> Result<(), String> {
    Err("clipboard_history.io".to_string())
}

#[cfg(windows)]
unsafe extern "system" fn clipboard_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::System::DataExchange::RemoveClipboardFormatListener;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    if msg == WM_CLIPBOARDUPDATE {
        if let Some(app) = APP.get() {
            refresh_from_clipboard(app.clone());
        }
    } else if msg == 0x0082 {
        // WM_NCDESTROY
        // SAFETY: same window/subclass pair as `install`.
        unsafe {
            let _ = RemoveClipboardFormatListener(hwnd);
            let _ = RemoveWindowSubclass(hwnd, Some(clipboard_subclass_proc), SUBCLASS_ID);
        }
    }
    // SAFETY: forwarding unhandled messages is the subclass contract.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Read one update on a blocking thread; a slow clipboard or image helper
/// never delays typing. The settings are checked again after the read so a
/// disable during the read discards its result.
pub fn refresh_from_clipboard(app: AppHandle) {
    let Some(managed) = app.try_state::<Arc<crate::clipboard_history::ClipboardHistoryState>>() else {
        return;
    };
    let state = managed.inner().clone();
    if !state.wants_windows_capture() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut probe = WindowsClipboardProbe;
        let outcome = capture_once(&mut probe, true);
        if let CaptureOutcome::Captured(payload) = outcome {
            if !state.wants_windows_capture() {
                return;
            }
            if let Ok(generation) = state.capture_window(payload) {
                let _ = app.emit(CHANGED_EVENT, generation);
            }
        }
    });
}

/// The real clipboard, bound to the current Windows clipboard.
#[cfg(windows)]
struct WindowsClipboardProbe;

#[cfg(windows)]
struct OpenClipboardGuard;

#[cfg(windows)]
impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        // SAFETY: pairs with a successful OpenClipboard on this thread.
        let _ = unsafe { windows::Win32::System::DataExchange::CloseClipboard() };
    }
}

#[cfg(windows)]
impl WindowsClipboardProbe {
    fn open(&self) -> Option<OpenClipboardGuard> {
        use windows::Win32::System::DataExchange::OpenClipboard;
        let opened = open_with_retries(
            || unsafe { OpenClipboard(None) }.is_ok(),
            || std::thread::sleep(std::time::Duration::from_millis(OPEN_RETRY_MS)),
        );
        opened.then_some(OpenClipboardGuard)
    }

    fn format(name: &str) -> u32 {
        use windows::core::PCWSTR;
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
        let wide = crate::explorer::wide_null(name);
        unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) }
    }

    fn has(&self, format: u32) -> bool {
        use windows::Win32::System::DataExchange::IsClipboardFormatAvailable;
        format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok()
    }

    fn policy_disabled(&self, name: &str) -> bool {
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::GetClipboardData;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        let format = Self::format(name);
        if format == 0 {
            return false;
        }
        // SAFETY: this thread holds the clipboard open; the block is only
        // read while it stays open.
        unsafe {
            let Ok(handle) = GetClipboardData(format) else {
                return false;
            };
            if handle.is_invalid() || GlobalSize(HGLOBAL(handle.0)) < 4 {
                return false;
            }
            let ptr = GlobalLock(HGLOBAL(handle.0)) as *const u32;
            if ptr.is_null() {
                return false;
            }
            let value = *ptr;
            let _ = GlobalUnlock(HGLOBAL(handle.0));
            value == 0
        }
    }
}

#[cfg(windows)]
impl ClipboardProbe for WindowsClipboardProbe {
    fn snapshot(&mut self) -> Result<ProbeSnapshot, String> {
        use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
        let _guard = self.open().ok_or_else(|| "clipboard_history.cancelled".to_string())?;
        // SAFETY: format availability and the sequence number are queries.
        let sequence = unsafe { GetClipboardSequenceNumber() };
        let private = if self.has(Self::format("ExcludeClipboardContentFromMonitorProcessing")) {
            Some(PrivateMarker::ExcludeFromMonitor)
        } else if self.has(Self::format("Clipboard Viewer Ignore")) {
            Some(PrivateMarker::ClipboardViewerIgnore)
        } else if self.policy_disabled("CanIncludeInClipboardHistory") {
            Some(PrivateMarker::HistoryDisabled)
        } else if self.policy_disabled("CanUploadToCloudClipboard") {
            Some(PrivateMarker::CloudDisabled)
        } else {
            None
        };
        let png = Self::format("PNG");
        Ok(ProbeSnapshot {
            sequence,
            private,
            has_text: self.has(13),
            has_files: self.has(15),
            has_image: self.has(2) || self.has(8) || self.has(17) || (png != 0 && self.has(png)),
        })
    }

    fn read_text(&mut self) -> Result<Option<String>, String> {
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::GetClipboardData;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        let _guard = self.open().ok_or_else(|| "clipboard_history.cancelled".to_string())?;
        // SAFETY: the clipboard is open on this thread and the block is
        // copied out before the guard closes it.
        unsafe {
            let Ok(handle) = GetClipboardData(13) else {
                return Ok(None);
            };
            if handle.is_invalid() {
                return Ok(None);
            }
            let size = GlobalSize(HGLOBAL(handle.0)) as usize;
            if size == 0 || size > MAX_TEXT_BYTES + 2 {
                return Err("clipboard_history.too_large".to_string());
            }
            let ptr = GlobalLock(HGLOBAL(handle.0)) as *const u16;
            if ptr.is_null() {
                return Ok(None);
            }
            let units = size / 2;
            let slice = std::slice::from_raw_parts(ptr, units);
            let text = String::from_utf16_lossy(slice)
                .trim_end_matches('\0')
                .to_string();
            let _ = GlobalUnlock(HGLOBAL(handle.0));
            Ok((!text.is_empty()).then_some(text))
        }
    }

    fn read_files(&mut self) -> Result<Option<Vec<String>>, String> {
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
        let _guard = self.open().ok_or_else(|| "clipboard_history.cancelled".to_string())?;
        // SAFETY: the clipboard is open on this thread; the HDROP is
        // borrowed only while the guard keeps it open.
        unsafe {
            let Ok(handle) = windows::Win32::System::DataExchange::GetClipboardData(15) else {
                return Ok(None);
            };
            if handle.is_invalid() {
                return Ok(None);
            }
            let drop = HDROP(handle.0);
            let count = DragQueryFileW(drop, u32::MAX, None) as usize;
            if count == 0 {
                return Ok(None);
            }
            if count > crate::clipboard_history_types::MAX_FILE_PATHS {
                return Err("clipboard_history.too_large".to_string());
            }
            let mut paths = Vec::with_capacity(count);
            for index in 0..count as u32 {
                let length = DragQueryFileW(drop, index, None);
                let mut buffer = vec![0u16; length as usize + 1];
                let written = DragQueryFileW(drop, index, Some(&mut buffer));
                if written > 0 {
                    paths.push(String::from_utf16_lossy(&buffer[..written as usize]));
                }
            }
            Ok((!paths.is_empty()).then_some(paths))
        }
    }

    fn read_image(&mut self) -> Result<Option<ClipboardImage>, String> {
        let bytes = match crate::clipboard_image_helper::encode("png") {
            Ok(bytes) => bytes,
            Err(_) => return Ok(None),
        };
        if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
            return Err("clipboard_history.too_large".to_string());
        }
        let Some((width, height)) = png_dimensions(&bytes) else {
            return Ok(None);
        };
        Ok(Some(ClipboardImage {
            mime: "image/png".to_string(),
            width,
            height,
            bytes,
        }))
    }

    fn sequence(&self) -> u32 {
        // SAFETY: the sequence number is a read-only query.
        unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
    }
}

#[cfg(test)]
#[path = "clipboard_history_listener_step09j_tests.rs"]
mod step09j_tests;
