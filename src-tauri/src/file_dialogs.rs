//! Windows open and save dialogs (Step 05d, shared since Step 06a).
//! Call from a blocking thread.

/// Shows a save dialog and returns the chosen path. A cancelled dialog is
/// `Ok(None)`; a failure is the plain code `dialog.failed`.
#[cfg(windows)]
pub fn pick_save_path(
    owner: isize,
    title: &str,
    file_name: &str,
    filter_name: &str,
    pattern: &str,
    default_extension: &str,
) -> Result<Option<String>, String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT,
        FOS_PATHMUSTEXIST,
    };

    let _com = ComApartment::enter();
    // SAFETY: COM is initialized on this thread by `_com`; the dialog and the
    // strings passed to it stay alive for the whole call.
    let shown = unsafe {
        CoCreateInstance::<_, IFileSaveDialog>(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)
            .and_then(|dialog| {
                dialog.SetFileName(&HSTRING::from(file_name))?;
                run_dialog(
                    &dialog,
                    owner,
                    title,
                    filter_name,
                    pattern,
                    default_extension,
                    FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST,
                )
            })
    };
    dialog_result(shown)
}

/// Shows an open dialog and returns the chosen path. A cancelled dialog is
/// `Ok(None)`; a failure is the plain code `dialog.failed`.
#[cfg(windows)]
pub fn pick_open_path(
    owner: isize,
    title: &str,
    filter_name: &str,
    pattern: &str,
) -> Result<Option<String>, String> {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM,
    };

    let _com = ComApartment::enter();
    // SAFETY: COM is initialized on this thread by `_com`; the dialog and the
    // strings passed to it stay alive for the whole call.
    let shown = unsafe {
        CoCreateInstance::<_, IFileOpenDialog>(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .and_then(|dialog| {
                run_dialog(
                    &dialog,
                    owner,
                    title,
                    filter_name,
                    pattern,
                    "",
                    FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM,
                )
            })
    };
    dialog_result(shown)
}

/// Shows Windows' folder picker and returns the chosen folder. A cancelled
/// dialog is `Ok(None)`; a failure is the plain code `dialog.failed`.
#[cfg(windows)]
pub fn pick_folder_path(owner: isize, title: &str) -> Result<Option<String>, String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::E_FAIL;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };

    let _com = ComApartment::enter();
    // SAFETY: COM is initialized on this thread by `_com`; the dialog and the
    // strings passed to it stay alive for the whole call.
    let shown = unsafe {
        CoCreateInstance::<_, IFileOpenDialog>(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .and_then(|dialog| {
                dialog.SetTitle(&HSTRING::from(title))?;
                dialog.SetOptions(
                    dialog.GetOptions()?
                        | FOS_PICKFOLDERS
                        | FOS_FORCEFILESYSTEM
                        | FOS_PATHMUSTEXIST,
                )?;
                dialog.Show(Some(crate::shell::hwnd_from(owner)))?;
                let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = raw.to_string();
                CoTaskMemFree(Some(raw.0 as *const _));
                path.map_err(|_| windows::core::Error::from(E_FAIL))
            })
    };
    dialog_result(shown)
}

/// A cancelled dialog is `None`; any other COM error is a code for the UI.
#[cfg(windows)]
fn dialog_result(shown: windows::core::Result<String>) -> Result<Option<String>, String> {
    match shown {
        Ok(path) => Ok(Some(path)),
        Err(error) if crate::shell::is_cancelled(&error) => Ok(None),
        Err(_) => Err("dialog.failed".to_string()),
    }
}

/// Sets up a save or open dialog, shows it, and returns the chosen path.
///
/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn run_dialog(
    dialog: &windows::Win32::UI::Shell::IFileDialog,
    owner: isize,
    title: &str,
    filter_name: &str,
    pattern: &str,
    default_extension: &str,
    extra_options: windows::Win32::UI::Shell::FILEOPENDIALOGOPTIONS,
) -> windows::core::Result<String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::SIGDN_FILESYSPATH;

    dialog.SetTitle(&HSTRING::from(title))?;
    let filter_name = HSTRING::from(filter_name);
    let pattern = HSTRING::from(pattern);
    dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
        pszName: PCWSTR(filter_name.as_ptr()),
        pszSpec: PCWSTR(pattern.as_ptr()),
    }])?;
    if !default_extension.is_empty() {
        dialog.SetDefaultExtension(&HSTRING::from(default_extension))?;
    }
    dialog.SetOptions(dialog.GetOptions()? | extra_options)?;
    dialog.Show(Some(crate::shell::hwnd_from(owner)))?;
    let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
    let path = raw.to_string();
    CoTaskMemFree(Some(raw.0 as *const _));
    path.map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
}

/// COM for one dialog call: uninitialized at the end only when it succeeded.
#[cfg(windows)]
struct ComApartment {
    initialized: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn enter() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // SAFETY: called on this blocking thread, and paired with
        // `CoUninitialize` in `drop` when it succeeds.
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        Self { initialized }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized {
            // SAFETY: pairs with the successful `CoInitializeEx` in `enter`,
            // on the same thread.
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(not(windows))]
pub fn pick_save_path(
    _owner: isize,
    _title: &str,
    _file_name: &str,
    _filter_name: &str,
    _pattern: &str,
    _default_extension: &str,
) -> Result<Option<String>, String> {
    Err("dialog.failed".to_string())
}

#[cfg(not(windows))]
pub fn pick_open_path(
    _owner: isize,
    _title: &str,
    _filter_name: &str,
    _pattern: &str,
) -> Result<Option<String>, String> {
    Err("dialog.failed".to_string())
}

#[cfg(not(windows))]
pub fn pick_folder_path(_owner: isize, _title: &str) -> Result<Option<String>, String> {
    Err("dialog.failed".to_string())
}
