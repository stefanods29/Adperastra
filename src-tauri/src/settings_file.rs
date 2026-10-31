//! Export and import settings.json through the Windows file dialogs (Step 05d).

use std::path::{Path, PathBuf};
use tauri::{State, WebviewWindow};

use crate::{ensure_main, AppState, Settings};

/// Largest file `settings_import` reads.
pub const MAX_SETTINGS_FILE: u64 = 1_048_576;
/// Longest dialog title or filter name, in characters.
pub const MAX_DIALOG_TEXT: usize = 200;

/// Validates the texts the UI passes for a dialog.
pub fn check_texts(title: &str, file_name: Option<&str>, filter_name: &str) -> Result<(), String> {
    let bad = || "settingsFile.bad_request".to_string();
    for text in [title, filter_name] {
        if text.is_empty() || text.chars().count() > MAX_DIALOG_TEXT {
            return Err(bad());
        }
    }
    if let Some(name) = file_name {
        if name.chars().count() > 255 || fs_service::validate_new_name(name).is_err() {
            return Err(bad());
        }
        if !has_json_extension(name) {
            return Err(bad());
        }
    }
    Ok(())
}

/// Validates the path the save dialog returned.
pub fn check_export_path(path: &str) -> Result<(), String> {
    crate::validate_absolute_path(path).map_err(|_| "settingsFile.bad_request".to_string())?;
    if !has_json_extension(path) {
        return Err("settingsFile.bad_extension".to_string());
    }
    Ok(())
}

fn has_json_extension(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
}

/// The settings in a file's text, migrated to the current schema. Saves nothing.
pub fn parse_import(text: &str) -> Result<Settings, String> {
    let invalid = || "settingsFile.invalid".to_string();
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| invalid())?;
    let version = value
        .as_object()
        .and_then(|object| object.get("schema_version"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(invalid)?;
    if version == 0 {
        return Err(invalid());
    }
    if version > u64::from(crate::CURRENT_SCHEMA) {
        return Err("settingsFile.newer".to_string());
    }
    crate::migrate(value).map_err(|_| invalid())
}

/// Sends an existing file to the Recycle Bin before it is replaced (R-SAFE-2).
fn recycle_existing(path: &Path) -> Result<(), String> {
    let failed = || "settingsFile.recycle_failed".to_string();
    if !path.try_exists().map_err(|_| failed())? {
        return Ok(());
    }
    let token = fs_service::new_cancellation_token();
    let report = fs_service::recycle_items(&[path.to_path_buf()], &token, &mut |_| {})
        .map_err(|_| failed())?;
    if report.completed.is_empty() {
        return Err(failed());
    }
    Ok(())
}

fn export_to_chosen_file(
    owner: isize,
    title: &str,
    file_name: &str,
    filter_name: &str,
    settings: &Settings,
) -> Result<Option<String>, String> {
    let Some(path) = show_save_dialog(owner, title, file_name, filter_name)? else {
        return Ok(None);
    };
    check_export_path(&path)?;
    let target = PathBuf::from(&path);
    recycle_existing(&target)?;
    let text =
        serde_json::to_vec_pretty(settings).map_err(|_| "settingsFile.write_failed".to_string())?;
    crate::atomic_write(&target, &text).map_err(|_| "settingsFile.write_failed".to_string())?;
    Ok(Some(path.trim_start_matches(r"\\?\").to_string()))
}

fn import_from_chosen_file(
    owner: isize,
    title: &str,
    filter_name: &str,
) -> Result<Option<Settings>, String> {
    let Some(path) = show_open_dialog(owner, title, filter_name)? else {
        return Ok(None);
    };
    let invalid = || "settingsFile.invalid".to_string();
    let size = std::fs::metadata(&path).map_err(|_| invalid())?.len();
    if size > MAX_SETTINGS_FILE {
        return Err("settingsFile.too_large".to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|_| invalid())?;
    parse_import(&text).map(Some)
}

#[tauri::command]
pub async fn settings_export(
    window: WebviewWindow,
    state: State<'_, AppState>,
    title: String,
    file_name: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    check_texts(&title, Some(&file_name), &filter_name)?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settingsFile.other".to_string())?
        .clone();
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        export_to_chosen_file(owner, &title, &file_name, &filter_name, &settings)
    })
    .await
    .map_err(|_| "settingsFile.other".to_string())?
}

#[tauri::command]
pub async fn settings_import(
    window: WebviewWindow,
    title: String,
    filter_name: String,
) -> Result<Option<Settings>, String> {
    ensure_main(window.label())?;
    check_texts(&title, None, &filter_name)?;
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        import_from_chosen_file(owner, &title, &filter_name)
    })
    .await
    .map_err(|_| "settingsFile.other".to_string())?
}

#[cfg(windows)]
fn show_save_dialog(
    owner: isize,
    title: &str,
    file_name: &str,
    filter_name: &str,
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
                    FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST,
                )
            })
    };
    dialog_result(shown)
}

#[cfg(windows)]
fn show_open_dialog(
    owner: isize,
    title: &str,
    filter_name: &str,
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
                    FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM,
                )
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
        Err(_) => Err("settingsFile.other".to_string()),
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
    extra_options: windows::Win32::UI::Shell::FILEOPENDIALOGOPTIONS,
) -> windows::core::Result<String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::SIGDN_FILESYSPATH;

    dialog.SetTitle(&HSTRING::from(title))?;
    let filter_name = HSTRING::from(filter_name);
    let pattern = HSTRING::from("*.json");
    dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
        pszName: PCWSTR(filter_name.as_ptr()),
        pszSpec: PCWSTR(pattern.as_ptr()),
    }])?;
    dialog.SetDefaultExtension(&HSTRING::from("json"))?;
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
fn show_save_dialog(
    _owner: isize,
    _title: &str,
    _file_name: &str,
    _filter_name: &str,
) -> Result<Option<String>, String> {
    Err("settingsFile.other".to_string())
}

#[cfg(not(windows))]
fn show_open_dialog(
    _owner: isize,
    _title: &str,
    _filter_name: &str,
) -> Result<Option<String>, String> {
    Err("settingsFile.other".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(result: Result<Settings, String>) -> String {
        result.expect_err("the file must be refused")
    }

    #[test]
    fn parse_import_accepts_current_and_older_files() {
        let current = serde_json::to_string(&Settings::default()).unwrap();
        assert_eq!(parse_import(&current).unwrap(), Settings::default());

        let older = parse_import(r#"{"schema_version":2,"language":"es","theme":{"mode":"dark"}}"#)
            .unwrap();
        assert_eq!(older.language, "es");
        assert_eq!(older.theme.mode, "dark");
        assert_eq!(older.schema_version, crate::CURRENT_SCHEMA);
    }

    #[test]
    fn parse_import_refuses_other_files() {
        assert_eq!(code(parse_import("not json")), "settingsFile.invalid");
        assert_eq!(code(parse_import("[1,2]")), "settingsFile.invalid");
        assert_eq!(
            code(parse_import(r#"{"language":"es"}"#)),
            "settingsFile.invalid"
        );
        assert_eq!(
            code(parse_import(r#"{"schema_version":0}"#)),
            "settingsFile.invalid"
        );
        let newer = format!(r#"{{"schema_version":{}}}"#, crate::CURRENT_SCHEMA + 1);
        assert_eq!(code(parse_import(&newer)), "settingsFile.newer");
    }

    #[test]
    fn check_texts_and_paths() {
        let bad = Err("settingsFile.bad_request".to_string());
        assert_eq!(check_texts("Export", Some("s.json"), "Settings"), Ok(()));
        assert_eq!(check_texts("Export", Some("s.txt"), "Settings"), bad);
        assert_eq!(check_texts("Export", Some("CON.json"), "Settings"), bad);
        assert_eq!(check_texts("", Some("s.json"), "Settings"), bad);

        assert_eq!(check_export_path(r"C:\x\s.json"), Ok(()));
        assert_eq!(check_export_path(r"C:\x\s.JSON"), Ok(()));
        assert_eq!(
            check_export_path(r"C:\x\s.txt"),
            Err("settingsFile.bad_extension".to_string())
        );
        assert_eq!(check_export_path("relative.json"), bad);
    }
}
