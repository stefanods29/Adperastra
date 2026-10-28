//! Dragging files out to other apps (Step 03b): a native Windows drag
//! started with the shell's `SHDoDragDrop` and its default drop source.
//! The webview cannot start a real Windows drag, so the UI detects the
//! gesture and asks Rust to take over while the button is still down.
//! Returns the effect the drop target chose ("copy", "move", "link" or
//! "none"), so the caller can finish a move by removing the sources.
//! The data object is the shell's own (`SHCreateDataObject` from PIDLs,
//! the same construction the Properties sheet uses), so no hand-written
//! COM classes are needed.

/// Most files one drag may carry.
pub const MAX_DRAG_FILES: usize = 10_000;

#[cfg(windows)]
pub fn start_drag(owner: isize, paths: &[String]) -> Result<String, String> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{
        OleInitialize, OleUninitialize, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE,
    };
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{ILFree, SHCreateDataObject, SHDoDragDrop, SHParseDisplayName};

    if paths.is_empty() || paths.len() > MAX_DRAG_FILES {
        return Err("drag.failed".to_string());
    }

    struct Pidls(Vec<*mut ITEMIDLIST>);
    impl Drop for Pidls {
        fn drop(&mut self) {
            for pidl in &self.0 {
                // SAFETY: each pidl came from SHParseDisplayName and is
                // freed exactly once here.
                unsafe { ILFree(Some(*pidl as *const ITEMIDLIST)) };
            }
        }
    }

    let hwnd = HWND(owner as *mut c_void);
    // SAFETY: OLE is balanced on this worker thread; the PIDLs and data
    // object outlive SHDoDragDrop, which runs its own modal loop until
    // the drop or the cancel.
    unsafe {
        let _ = OleInitialize(None);
        let result = (|| -> windows::core::Result<String> {
            let mut pidls = Pidls(Vec::with_capacity(paths.len()));
            for path in paths {
                let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
                let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None)?;
                pidls.0.push(pidl);
            }
            let absolute: Vec<*const ITEMIDLIST> =
                pidls.0.iter().map(|p| *p as *const ITEMIDLIST).collect();
            let data: IDataObject = SHCreateDataObject(None, Some(&absolute), None)?;
            let effect = SHDoDragDrop(
                Some(hwnd),
                &data,
                None,
                DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK,
            )?;
            Ok(if effect == DROPEFFECT_MOVE {
                "move".to_string()
            } else if effect == DROPEFFECT_LINK {
                "link".to_string()
            } else if effect == DROPEFFECT_COPY {
                "copy".to_string()
            } else {
                "none".to_string()
            })
        })();
        OleUninitialize();
        result.map_err(|_| "drag.failed".to_string())
    }
}

#[cfg(not(windows))]
pub fn start_drag(_owner: isize, _paths: &[String]) -> Result<String, String> {
    Err("drag.failed".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn empty_drag_is_rejected() {
        assert!(super::start_drag(0, &[]).is_err());
    }
}
