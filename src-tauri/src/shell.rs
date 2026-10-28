//! Windows shell actions for the Explorer (Step 03a): open with the default
//! app, the Windows "Open with" chooser, Properties, and Open in Terminal.
//! Tauri commands run these on blocking threads with COM initialized, so
//! the UI never waits on them. Paths are passed to Windows as data only
//! (never inside a command line).

use serde::{Deserialize, Serialize};
use std::path::Path;
#[cfg(windows)]
use windows::core::Interface;

/// What the UI should do after "Open": folders, and shortcuts that point
/// at folders, open inside the Explorer instead of a Windows window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenOutcome {
    pub navigate_to: Option<String>,
}

/// Most items a single Properties request may name.
pub const MAX_PROPERTIES_ITEMS: usize = 512;

#[cfg(windows)]
const ERROR_CANCELLED_HRESULT: i32 = 0x8007_04C7_u32 as i32;

#[cfg(windows)]
fn is_cancelled(error: &windows::core::Error) -> bool {
    error.code().0 == ERROR_CANCELLED_HRESULT
}

#[cfg(windows)]
fn hwnd_from(raw: isize) -> windows::Win32::Foundation::HWND {
    windows::Win32::Foundation::HWND(raw as *mut std::ffi::c_void)
}

/// Open a file with its Windows default app (the open pipeline replaces
/// this in Step 04a). Windows shows its own "How do you want to open this
/// file?" chooser for types without an app.
pub fn open_item(path: &str) -> Result<OpenOutcome, String> {
    let target = Path::new(path);
    let details = fs_service::item_details(target).map_err(|_| "open.not_found".to_string())?;
    if details.kind == fs_service::ItemKind::Folder {
        return Ok(OpenOutcome {
            navigate_to: Some(path.to_string()),
        });
    }
    #[cfg(windows)]
    {
        let _com = crate::explorer::ComGuard::new();
        let is_shortcut = target
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
        if is_shortcut {
            if let Some(resolved) = crate::explorer::resolve_shortcut(target) {
                if resolved.is_dir() {
                    return Ok(OpenOutcome {
                        navigate_to: Some(resolved.to_string_lossy().into_owned()),
                    });
                }
            }
        }
        shell_execute_default(path)?;
    }
    Ok(OpenOutcome { navigate_to: None })
}

#[cfg(windows)]
fn shell_execute_default(path: &str) -> Result<(), String> {
    use crate::explorer::wide_null;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file = wide_null(path);
    let directory = Path::new(path)
        .parent()
        .map(|parent| wide_null(&parent.to_string_lossy()));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        // NOASYNC: this worker thread ends right after the call.
        fMask: SEE_MASK_NOASYNC,
        lpFile: PCWSTR(file.as_ptr()),
        lpDirectory: directory
            .as_ref()
            .map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: every pointer in `info` refers to a buffer that outlives the
    // call; COM is initialized on this thread by the caller.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(()),
        Err(error) if is_cancelled(&error) => Ok(()),
        Err(_) => Err("open.failed".to_string()),
    }
}

/// The Windows "Open with" chooser for one file, owned by the app window.
#[cfg(windows)]
pub fn open_with_dialog(owner: isize, path: &str) -> Result<(), String> {
    use crate::explorer::wide_null;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{
        SHOpenWithDialog, OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OAIF_REGISTER_EXT, OPENASINFO,
    };

    let _com = crate::explorer::ComGuard::new();
    let file = wide_null(path);
    let info = OPENASINFO {
        pcszFile: PCWSTR(file.as_ptr()),
        pcszClass: PCWSTR::null(),
        oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT | OAIF_EXEC,
    };
    // SAFETY: `info` and `file` outlive the modal call; `owner` is the
    // live main window.
    match unsafe { SHOpenWithDialog(Some(hwnd_from(owner)), &info) } {
        Ok(()) => Ok(()),
        Err(error) if is_cancelled(&error) => Ok(()),
        Err(_) => Err("openWith.failed".to_string()),
    }
}

#[cfg(not(windows))]
pub fn open_with_dialog(_owner: isize, _path: &str) -> Result<(), String> {
    Err("openWith.failed".to_string())
}

/// The Windows Properties window for one or several items. Windows shows
/// it on its own thread, so this returns as soon as it is requested.
#[cfg(windows)]
pub fn show_properties(owner: isize, paths: &[String]) -> Result<(), String> {
    use crate::explorer::wide_null;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        ILFree, SHCreateDataObject, SHMultiFileProperties, SHObjectProperties, SHParseDisplayName,
        SHOP_FILEPATH,
    };

    let _com = crate::explorer::ComGuard::new();
    if let [single] = paths {
        let wide = wide_null(single);
        // SAFETY: `wide` outlives the call; `owner` is the live main window.
        let shown = unsafe {
            SHObjectProperties(
                Some(hwnd_from(owner)),
                SHOP_FILEPATH,
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
            )
        };
        return if shown.as_bool() {
            Ok(())
        } else {
            Err("properties.failed".to_string())
        };
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
    let mut pidls = Pidls(Vec::with_capacity(paths.len()));
    for path in paths {
        let wide = wide_null(path);
        let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
        // SAFETY: `wide` outlives the call and `pidl` receives a new PIDL
        // owned by `pidls`.
        unsafe { SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None) }
            .map_err(|_| "properties.failed".to_string())?;
        pidls.0.push(pidl);
    }
    let absolute: Vec<*const ITEMIDLIST> =
        pidls.0.iter().map(|p| *p as *const ITEMIDLIST).collect();
    // SAFETY: with no parent folder the PIDLs are absolute (relative to the
    // desktop), which SHCreateDataObject accepts; they outlive the call.
    let data: IDataObject = unsafe { SHCreateDataObject(None, Some(&absolute), None) }
        .map_err(|_| "properties.failed".to_string())?;
    // SAFETY: `data` is a valid data object for the items.
    unsafe { SHMultiFileProperties(&data, 0) }.map_err(|_| "properties.failed".to_string())
}

#[cfg(not(windows))]
pub fn show_properties(_owner: isize, _paths: &[String]) -> Result<(), String> {
    Err("properties.failed".to_string())
}

/// The Windows share sheet for files, owned by the app window. Must run on
/// the window's own (main) thread. The files are resolved on a worker
/// thread after Windows asks for them, so the UI never waits.
#[cfg(windows)]
pub fn show_share_sheet(owner: isize, paths: Vec<String>, title: String) -> Result<(), String> {
    use std::cell::Cell;
    use windows::core::{Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    thread_local! {
        static TOKEN: Cell<Option<i64>> = const { Cell::new(None) };
    }
    let failed = |_| "share.failed".to_string();
    let interop: IDataTransferManagerInterop =
        windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()
            .map_err(failed)?;
    // SAFETY: `owner` is the live main window and this is its thread.
    let manager: DataTransferManager =
        unsafe { interop.GetForWindow(hwnd_from(owner)) }.map_err(failed)?;
    if let Some(previous) = TOKEN.with(Cell::take) {
        let _ = manager.RemoveDataRequested(previous);
    }
    let handler =
        TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            let Some(args) = args.as_ref() else {
                return Ok(());
            };
            let request = args.Request()?;
            let data = request.Data()?;
            data.Properties()?
                .SetTitle(&HSTRING::from(title.as_str()))?;
            let deferral = request.GetDeferral()?;
            let paths = paths.clone();
            std::thread::spawn(move || {
                let items: Vec<Option<IStorageItem>> = paths
                    .iter()
                    .filter_map(|path| {
                        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_str()))
                            .ok()?
                            .get()
                            .ok()?;
                        file.cast::<IStorageItem>().ok()
                    })
                    .map(Some)
                    .collect();
                let list = windows_collections::IIterable::<IStorageItem>::from(items);
                let _ = data.SetStorageItemsReadOnly(&list);
                let _ = deferral.Complete();
            });
            Ok(())
        });
    let token = manager.DataRequested(&handler).map_err(failed)?;
    TOKEN.with(|slot| slot.set(Some(token)));
    // SAFETY: same window and thread as GetForWindow above.
    unsafe { interop.ShowShareUIForWindow(hwnd_from(owner)) }.map_err(failed)
}

#[cfg(not(windows))]
pub fn show_share_sheet(_owner: isize, _paths: Vec<String>, _title: String) -> Result<(), String> {
    Err("share.failed".to_string())
}

/// Open Windows Terminal in `folder`, or PowerShell when Windows Terminal is
/// not installed. The folder becomes the new process's working directory;
/// it is never put on a command line.
pub fn open_in_terminal(folder: &str) -> Result<(), String> {
    use std::process::Command;
    let dir = Path::new(folder);
    if !dir.is_dir() {
        return Err("terminal.notFolder".to_string());
    }
    match Command::new("wt.exe")
        .args(["-d", "."])
        .current_dir(dir)
        .spawn()
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut fallback = Command::new("powershell.exe");
            fallback.arg("-NoExit").current_dir(dir);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // CREATE_NEW_CONSOLE: the app has no console to share.
                fallback.creation_flags(0x0000_0010);
            }
            fallback
                .spawn()
                .map(|_| ())
                .map_err(|_| "terminal.failed".to_string())
        }
        Err(_) => Err("terminal.failed".to_string()),
    }
}

/// Create a Windows shortcut (.lnk) to `target` inside `folder`, named
/// `name` (without extension). Returns the shortcut's path.
#[cfg(windows)]
pub fn create_shortcut(
    owner: isize,
    target: &str,
    folder: &str,
    name: &str,
) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let _com = crate::explorer::ComGuard::new();
    let target_path = Path::new(target);
    let parent = target_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned());
    let destination = fs_service::unique_destination(Path::new(folder), &format!("{name}.lnk"));
    let wide = |value: &str| {
        value
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    };
    // SAFETY: COM is initialized on this thread; buffers outlive the calls.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| "shortcut.failed".to_string())?;
        let target_wide = wide(target);
        link.SetPath(PCWSTR(target_wide.as_ptr()))
            .map_err(|_| "shortcut.failed".to_string())?;
        if let Some(parent) = &parent {
            let parent_wide = wide(parent);
            let _ = link.SetWorkingDirectory(PCWSTR(parent_wide.as_ptr()));
        }
        let file: IPersistFile = link.cast().map_err(|_| "shortcut.failed".to_string())?;
        let dest_wide = wide(&destination.to_string_lossy());
        file.Save(PCWSTR(dest_wide.as_ptr()), true)
            .map_err(|_| "shortcut.failed".to_string())?;
    }
    let _ = owner;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
pub fn create_shortcut(
    _owner: isize,
    _target: &str,
    _folder: &str,
    _name: &str,
) -> Result<String, String> {
    Err("shortcut.failed".to_string())
}
