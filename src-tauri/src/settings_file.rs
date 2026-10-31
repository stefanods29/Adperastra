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
    // `migrate` falls back to the defaults so that a damaged settings file can
    // never stop the app from starting. An import must refuse the file instead.
    // Version 1 files have a different, flat shape that `migrate` reads itself.
    if version >= 2 {
        let mut parsed: Settings = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
        parsed.schema_version = crate::CURRENT_SCHEMA;
        crate::validate(&parsed).map_err(|_| invalid())?;
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
    let Some(path) =
        crate::file_dialogs::pick_save_path(owner, title, file_name, filter_name, "*.json", "json")
            .map_err(|_| "settingsFile.other".to_string())?
    else {
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
    let Some(path) = crate::file_dialogs::pick_open_path(owner, title, filter_name, "*.json")
        .map_err(|_| "settingsFile.other".to_string())?
    else {
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
    fn parse_import_refuses_bad_values_instead_of_using_defaults() {
        let wrong_language = format!(
            r#"{{"schema_version":{},"language":"xx"}}"#,
            crate::CURRENT_SCHEMA
        );
        assert_eq!(code(parse_import(&wrong_language)), "settingsFile.invalid");
        assert_eq!(
            code(parse_import(r#"{"schema_version":4,"language":"xx"}"#)),
            "settingsFile.invalid"
        );
        let wrong_type = format!(
            r#"{{"schema_version":{},"theme":"dark"}}"#,
            crate::CURRENT_SCHEMA
        );
        assert_eq!(code(parse_import(&wrong_type)), "settingsFile.invalid");
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
