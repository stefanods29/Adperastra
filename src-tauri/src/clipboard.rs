//! Windows clipboard for file operations (Step 03b): the file list
//! format (`CF_HDROP`) plus the "Preferred DropEffect" value that tells
//! receivers whether the files were cut or copied, so Cut/Copy/Paste
//! interoperate with Windows Explorer in both directions. Clipboard
//! contents are untrusted input: lists are length-capped and text is
//! size-limited before it crosses to the UI.

use serde::{Deserialize, Serialize};

/// Most file paths one clipboard request may carry.
pub const MAX_CLIPBOARD_FILES: usize = 10_000;
/// Largest clipboard text handed to the UI (paste-as-file), in bytes.
pub const MAX_CLIPBOARD_TEXT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipboardData {
    /// Files on the clipboard (empty when it holds something else).
    pub files: Vec<String>,
    /// True when the files were cut (Preferred DropEffect = move).
    pub cut: bool,
    pub has_text: bool,
    pub has_image: bool,
}

#[cfg(windows)]
mod imp {
    use super::{ClipboardData, MAX_CLIPBOARD_FILES, MAX_CLIPBOARD_TEXT_BYTES};
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows::Win32::UI::Shell::{DragQueryFileW, DROPFILES, HDROP};

    // Standard clipboard format ids (WinUser.h).
    const CF_BITMAP_ID: u32 = 2;
    const CF_DIB_ID: u32 = 8;
    const CF_UNICODETEXT_ID: u32 = 13;
    const CF_HDROP_ID: u32 = 15;
    const CF_DIBV5_ID: u32 = 17;

    pub fn hwnd_from(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Open the clipboard, retrying briefly: another app may hold it for
    /// a moment (Explorer does while copying).
    fn open(owner: isize) -> Result<(), String> {
        for attempt in 0..10 {
            // SAFETY: the handle is the live main window or null.
            let result = unsafe {
                if owner != 0 {
                    OpenClipboard(Some(hwnd_from(owner)))
                } else {
                    OpenClipboard(None)
                }
            };
            if result.is_ok() {
                return Ok(());
            }
            if attempt == 9 {
                return Err("clipboard.busy".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        Err("clipboard.busy".to_string())
    }

    fn close() {
        // SAFETY: pairs with a successful OpenClipboard on this thread.
        unsafe {
            let _ = CloseClipboard();
        }
    }

    /// Copy bytes into a movable global block the clipboard takes over.
    fn alloc_copy(bytes: &[u8]) -> Result<HGLOBAL, String> {
        // SAFETY: the block is locked only while copying; on success the
        // clipboard owns it and it must not be freed by us.
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))
                .map_err(|_| "clipboard.failed".to_string())?;
            let ptr = GlobalLock(handle) as *mut u8;
            if ptr.is_null() {
                return Err("clipboard.failed".to_string());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            let _ = GlobalUnlock(handle);
            Ok(handle)
        }
    }

    fn drop_effect_format() -> u32 {
        let name = wide("Preferred DropEffect");
        // SAFETY: `name` is NUL-terminated and outlives the call.
        unsafe { RegisterClipboardFormatW(PCWSTR(name.as_ptr())) }
    }

    fn png_format() -> u32 {
        let name = wide("PNG");
        // SAFETY: `name` is NUL-terminated and outlives the call.
        unsafe { RegisterClipboardFormatW(PCWSTR(name.as_ptr())) }
    }

    pub fn set_files(owner: isize, paths: &[String], cut: bool) -> Result<(), String> {
        if paths.is_empty() || paths.len() > MAX_CLIPBOARD_FILES {
            return Err("clipboard.failed".to_string());
        }
        // DROPFILES header, then the double-NUL-terminated wide list.
        let header = std::mem::size_of::<DROPFILES>();
        let mut bytes = vec![0u8; header];
        for path in paths {
            bytes.extend_from_slice(
                &path
                    .encode_utf16()
                    .flat_map(|unit| unit.to_le_bytes())
                    .collect::<Vec<u8>>(),
            );
        }
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        let dropfiles = DROPFILES {
            pFiles: header as u32,
            fWide: true.into(),
            ..Default::default()
        };
        // SAFETY: writing the POD header into the buffer we own.
        unsafe {
            std::ptr::copy_nonoverlapping(
                &dropfiles as *const DROPFILES as *const u8,
                bytes.as_mut_ptr(),
                header,
            );
        }
        open(owner)?;
        let result = (|| {
            // SAFETY: this thread opened the clipboard; SetClipboardData
            // takes ownership of each block it accepts.
            unsafe {
                EmptyClipboard().map_err(|_| "clipboard.failed".to_string())?;
                let hdrop = alloc_copy(&bytes)?;
                SetClipboardData(CF_HDROP_ID, Some(HANDLE(hdrop.0)))
                    .map_err(|_| "clipboard.failed".to_string())?;
                let effect: u32 = if cut { 2 } else { 1 };
                let heffect = alloc_copy(&effect.to_le_bytes())?;
                SetClipboardData(drop_effect_format(), Some(HANDLE(heffect.0)))
                    .map_err(|_| "clipboard.failed".to_string())?;
            }
            Ok(())
        })();
        close();
        result
    }

    #[allow(clippy::redundant_closure_call)] // the closure scopes the unsafe block's early returns
    pub fn read(owner: isize) -> Result<ClipboardData, String> {
        open(owner)?;
        let result = (|| {
            let mut data = ClipboardData::default();
            // SAFETY: this thread opened the clipboard; handles borrowed
            // from it are only read while it stays open.
            unsafe {
                data.has_text = IsClipboardFormatAvailable(CF_UNICODETEXT_ID).is_ok();
                data.has_image = IsClipboardFormatAvailable(CF_BITMAP_ID).is_ok()
                    || IsClipboardFormatAvailable(CF_DIB_ID).is_ok()
                    || IsClipboardFormatAvailable(CF_DIBV5_ID).is_ok()
                    || IsClipboardFormatAvailable(png_format()).is_ok();
                if let Ok(handle) = GetClipboardData(CF_HDROP_ID) {
                    if !handle.is_invalid() {
                        let hdrop = HDROP(handle.0);
                        let count = DragQueryFileW(hdrop, u32::MAX, None);
                        let take = (count as usize).min(MAX_CLIPBOARD_FILES);
                        for index in 0..take as u32 {
                            let len = DragQueryFileW(hdrop, index, None);
                            let mut buffer = vec![0u16; (len as usize) + 1];
                            let written = DragQueryFileW(hdrop, index, Some(&mut buffer));
                            if written > 0 {
                                data.files
                                    .push(String::from_utf16_lossy(&buffer[..written as usize]));
                            }
                        }
                    }
                }
                if !data.files.is_empty() {
                    if let Ok(handle) = GetClipboardData(drop_effect_format()) {
                        if !handle.is_invalid() {
                            let ptr = GlobalLock(HGLOBAL(handle.0)) as *const u32;
                            if !ptr.is_null() {
                                // DROPEFFECT_MOVE alone means cut.
                                data.cut = *ptr == 2;
                                let _ = GlobalUnlock(HGLOBAL(handle.0));
                            }
                        }
                    }
                }
            }
            Ok(data)
        })();
        close();
        result
    }

    pub fn text(owner: isize) -> Result<Option<String>, String> {
        open(owner)?;
        let result = (|| {
            // SAFETY: as in `read`; the text block is copied out before
            // the clipboard closes.
            unsafe {
                let Ok(handle) = GetClipboardData(CF_UNICODETEXT_ID) else {
                    return Ok(None);
                };
                if handle.is_invalid() {
                    return Ok(None);
                }
                let hglobal = HGLOBAL(handle.0);
                let size = GlobalSize(hglobal);
                if size > MAX_CLIPBOARD_TEXT_BYTES {
                    return Err("ops.too_large".to_string());
                }
                let ptr = GlobalLock(hglobal) as *const u16;
                if ptr.is_null() {
                    return Ok(None);
                }
                let units = size / 2;
                let slice = std::slice::from_raw_parts(ptr, units);
                let text = String::from_utf16_lossy(slice)
                    .trim_end_matches('\0')
                    .to_string();
                let _ = GlobalUnlock(hglobal);
                Ok(Some(text))
            }
        })();
        close();
        result
    }

    /// Save the clipboard image as PNG or JPG in `parent` under
    /// `base_name` (a numbered name is chosen when taken). Screenshots
    /// usually arrive as a bitmap; browsers may also offer ready PNG
    /// data, which is decoded with the same Windows imaging path.
    pub fn save_image(
        owner: isize,
        parent: &std::path::Path,
        base_name: &str,
        format: &str,
    ) -> Result<String, String> {
        use windows::core::{Interface, PCWSTR};
        use windows::Win32::Graphics::Gdi::HBITMAP;
        use windows::Win32::Graphics::Imaging::{
            CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_ContainerFormatPng,
            GUID_WICPixelFormat24bppBGR, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource,
            IWICImagingFactory, WICBitmapEncoderNoCache, WICBitmapUseAlpha,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        };

        let extension = if format == "jpg" { "jpg" } else { "png" };
        let target = fs_service::unique_destination(parent, &format!("{base_name}.{extension}"));
        open(owner)?;
        // SAFETY: COM is balanced below; clipboard handles are only used
        // while the clipboard stays open on this thread.
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 >= 0;
        let result = unsafe {
            (|| -> windows::core::Result<String> {
                let factory: IWICImagingFactory =
                    CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
                // Source: ready PNG data when offered, else the bitmap.
                let source: IWICBitmapSource = 'source: {
                    if let Ok(handle) = GetClipboardData(png_format()) {
                        if !handle.is_invalid() {
                            let hglobal = HGLOBAL(handle.0);
                            let size = GlobalSize(hglobal);
                            if size > 0 && size <= 512 * 1024 * 1024 {
                                let ptr = GlobalLock(hglobal) as *const u8;
                                if !ptr.is_null() {
                                    let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
                                    let _ = GlobalUnlock(hglobal);
                                    let stream = factory.CreateStream()?;
                                    stream.InitializeFromMemory(&bytes)?;
                                    let decoder = factory.CreateDecoderFromStream(
                                        &stream,
                                        std::ptr::null(),
                                        windows::Win32::Graphics::Imaging::WICDecodeMetadataCacheOnLoad,
                                    )?;
                                    let frame = decoder.GetFrame(0)?;
                                    break 'source frame.cast::<IWICBitmapSource>()?;
                                }
                            }
                        }
                    }
                    let handle = GetClipboardData(CF_BITMAP_ID).map_err(|_| {
                        windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL)
                    })?;
                    let bitmap = factory.CreateBitmapFromHBITMAP(
                        HBITMAP(handle.0),
                        windows::Win32::Graphics::Gdi::HPALETTE::default(),
                        WICBitmapUseAlpha,
                    )?;
                    bitmap.cast::<IWICBitmapSource>()?
                };
                let container = if extension == "jpg" {
                    &GUID_ContainerFormatJpeg
                } else {
                    &GUID_ContainerFormatPng
                };
                let stream = factory.CreateStream()?;
                let target_wide = wide(&target.to_string_lossy());
                // GENERIC_WRITE
                stream.InitializeFromFilename(PCWSTR(target_wide.as_ptr()), 0x4000_0000)?;
                let encoder = factory.CreateEncoder(container, std::ptr::null())?;
                encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
                let mut frame: Option<windows::Win32::Graphics::Imaging::IWICBitmapFrameEncode> =
                    None;
                encoder.CreateNewFrame(&mut frame, std::ptr::null_mut())?;
                let frame = frame.ok_or_else(|| {
                    windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL)
                })?;
                frame.Initialize(None)?;
                let (mut width, mut height) = (0u32, 0u32);
                source.GetSize(&mut width, &mut height)?;
                frame.SetSize(width, height)?;
                let mut pixel_format = if extension == "jpg" {
                    GUID_WICPixelFormat24bppBGR
                } else {
                    GUID_WICPixelFormat32bppBGRA
                };
                frame.SetPixelFormat(&mut pixel_format)?;
                frame.WriteSource(&source, std::ptr::null())?;
                frame.Commit()?;
                encoder.Commit()?;
                Ok(target.to_string_lossy().into_owned())
            })()
        };
        if initialized {
            // SAFETY: pairs with the successful CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
        close();
        match result {
            Ok(path) => Ok(path),
            Err(_) => {
                let _ = std::fs::remove_file(&target);
                Err("image.failed".to_string())
            }
        }
    }
}

#[cfg(windows)]
pub fn set_files(owner: isize, paths: &[String], cut: bool) -> Result<(), String> {
    imp::set_files(owner, paths, cut)
}

#[cfg(not(windows))]
pub fn set_files(_owner: isize, _paths: &[String], _cut: bool) -> Result<(), String> {
    Err("clipboard.failed".to_string())
}

#[cfg(windows)]
pub fn read(owner: isize) -> Result<ClipboardData, String> {
    imp::read(owner)
}

#[cfg(not(windows))]
pub fn read(_owner: isize) -> Result<ClipboardData, String> {
    Ok(ClipboardData::default())
}

#[cfg(windows)]
pub fn text(owner: isize) -> Result<Option<String>, String> {
    imp::text(owner)
}

#[cfg(not(windows))]
pub fn text(_owner: isize) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(windows)]
pub fn save_image(
    owner: isize,
    parent: &std::path::Path,
    base_name: &str,
    format: &str,
) -> Result<String, String> {
    imp::save_image(owner, parent, base_name, format)
}

#[cfg(not(windows))]
pub fn save_image(
    _owner: isize,
    _parent: &std::path::Path,
    _base_name: &str,
    _format: &str,
) -> Result<String, String> {
    Err("image.failed".to_string())
}
