//! Safe uninstall data choice (Step 08d T2).
//!
//! The NSIS uninstaller defaults to keeping settings and data. Only after an
//! explicit Remove choice does it call `Adperastra.exe --recycle-app-data
//! <folder> remove`. This helper accepts only the standard per-user data
//! folder, refuses reparse points and folders with foreign content, and sends
//! the whole folder to the Recycle Bin with the existing, tested operation.
//! There is no recursive delete and no path supplied by a user interface.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// Helper flag handled in `main()` before Tauri starts.
pub const RECYCLE_DATA_FLAG: &str = "--recycle-app-data";
/// Standard per-user data folder name under `%LOCALAPPDATA%`.
pub const DATA_DIR_NAME: &str = "Adperastra";

/// App-owned entries that may appear in the standard data folder. A
/// non-empty folder without at least one of them is treated as foreign.
pub const KNOWN_ENTRIES: [&str; 12] = [
    "settings.json",
    "session.json",
    "explorer-state.json",
    "webview",
    "logs",
    "versions",
    "cache",
    "recovery",
    "archive-create",
    "packs",
    "profiles",
    "profiles.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataRemovalChoice {
    Keep,
    Remove,
}

/// Missing or unrecognized UI answers keep the data (the safe default).
pub fn parse_uninstall_choice(answer: Option<&str>) -> Result<DataRemovalChoice, String> {
    match answer.map(str::trim) {
        None | Some("") | Some("keep") => Ok(DataRemovalChoice::Keep),
        Some("remove") => Ok(DataRemovalChoice::Remove),
        _ => Err("uninstall.invalid_choice".to_string()),
    }
}

pub fn expected_installed_data_dir(local_app_data: &Path) -> PathBuf {
    local_app_data.join(DATA_DIR_NAME)
}

/// Case-insensitive comparison with separators normalized.
fn same_path(left: &Path, right: &Path) -> bool {
    fn normalized(path: &Path) -> String {
        let mut text = path
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        while text.len() > 3 && text.ends_with('\\') {
            text.pop();
        }
        text
    }
    normalized(left) == normalized(right)
}

#[cfg(windows)]
fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_reparse_point(_path: &Path) -> bool {
    false
}

/// Refuses anything except the expected folder and any path that passes
/// through a junction or symlink. Nothing is read from the folder's files.
pub fn validate_data_dir_for_removal(
    path: &Path,
    expected: &Path,
    is_reparse: &dyn Fn(&Path) -> bool,
) -> Result<(), String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("uninstall.bad_path".to_string());
    }
    if !same_path(path, expected) {
        return Err("uninstall.unknown_data_dir".to_string());
    }
    let mut current = Some(path);
    while let Some(item) = current {
        if is_reparse(item) {
            return Err("uninstall.reparse_point".to_string());
        }
        current = item.parent();
    }
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err("uninstall.not_a_dir".to_string());
    }
    let mut has_any = false;
    let mut has_known = false;
    for entry in fs::read_dir(path).map_err(|_| "uninstall.failed".to_string())? {
        let entry = entry.map_err(|_| "uninstall.failed".to_string())?;
        has_any = true;
        let name = entry.file_name().to_string_lossy().into_owned();
        if KNOWN_ENTRIES
            .iter()
            .any(|known| known.eq_ignore_ascii_case(&name))
        {
            has_known = true;
        }
    }
    if has_any && !has_known {
        return Err("uninstall.foreign_data".to_string());
    }
    Ok(())
}

/// Validates, then hands the whole folder to an injected recycle operation.
pub fn remove_data_dir_with(
    path: &Path,
    expected: &Path,
    is_reparse: &dyn Fn(&Path) -> bool,
    recycle: &dyn Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    validate_data_dir_for_removal(path, expected, is_reparse)?;
    if !path.exists() {
        return Ok(());
    }
    recycle(path)
}

fn recycle_via_bin(path: &Path) -> Result<(), String> {
    let token = fs_service::new_cancellation_token();
    let mut progress = |_progress: &fs_service::OpProgress| {};
    let report = fs_service::recycle_items(&[path.to_path_buf()], &token, &mut progress)
        .map_err(|_| "uninstall.failed".to_string())?;
    if report.cancelled || !report.skipped.is_empty() || report.completed.len() != 1 {
        return Err("uninstall.failed".to_string());
    }
    Ok(())
}

/// Recycles the standard data folder; any other path is refused untouched.
pub fn recycle_data_dir(path: &Path) -> Result<(), String> {
    let local = std::env::var("LOCALAPPDATA")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "uninstall.failed".to_string())?;
    let expected = expected_installed_data_dir(Path::new(&local));
    remove_data_dir_with(path, &expected, &is_reparse_point, &recycle_via_bin)
}

/// `--recycle-app-data <folder> remove|keep`; no argument never deletes.
pub fn run_helper() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    let choice = parse_uninstall_choice(args.get(1).map(String::as_str));
    let choice = match choice {
        Ok(choice) if args.len() == 2 => choice,
        _ => return 2,
    };
    if choice == DataRemovalChoice::Keep {
        return 0;
    }
    let path = PathBuf::from(&args[0]);
    match recycle_data_dir(&path) {
        Ok(()) => 0,
        Err(code) => {
            eprintln!("{code}");
            3
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn expected(temp: &tempfile::TempDir) -> PathBuf {
        expected_installed_data_dir(temp.path())
    }

    #[test]
    fn default_answer_keeps_data() {
        assert_eq!(parse_uninstall_choice(None), Ok(DataRemovalChoice::Keep));
        assert_eq!(
            parse_uninstall_choice(Some("keep")),
            Ok(DataRemovalChoice::Keep)
        );
        assert_eq!(
            parse_uninstall_choice(Some("remove")),
            Ok(DataRemovalChoice::Remove)
        );
        assert!(parse_uninstall_choice(Some("delete everything")).is_err());
    }

    #[test]
    fn unknown_folder_is_refused_without_touching_it() {
        let local = tempfile::tempdir().unwrap();
        let expected = expected(&local);
        let foreign = local.path().join("Personal");
        fs::create_dir(&foreign).unwrap();
        fs::write(foreign.join("note.txt"), b"keep me").unwrap();
        let calls = Cell::new(0);
        let recycle = |_path: &Path| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        assert_eq!(
            remove_data_dir_with(&foreign, &expected, &|_| false, &recycle),
            Err("uninstall.unknown_data_dir".to_string())
        );
        assert_eq!(calls.get(), 0);
        assert_eq!(fs::read(foreign.join("note.txt")).unwrap(), b"keep me");
    }

    #[test]
    fn junction_or_symlink_in_the_path_is_refused() {
        let local = tempfile::tempdir().unwrap();
        let expected = expected(&local);
        fs::create_dir(&expected).unwrap();
        fs::write(expected.join("settings.json"), b"{}").unwrap();
        let calls = Cell::new(0);
        let recycle = |_path: &Path| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        assert_eq!(
            remove_data_dir_with(&expected, &expected, &|_| true, &recycle),
            Err("uninstall.reparse_point".to_string())
        );
        assert_eq!(calls.get(), 0);
        assert!(expected.join("settings.json").exists());
    }

    #[test]
    fn folder_with_only_foreign_files_is_refused() {
        let local = tempfile::tempdir().unwrap();
        let expected = expected(&local);
        fs::create_dir(&expected).unwrap();
        fs::write(expected.join("personal.txt"), b"not ours").unwrap();
        assert_eq!(
            validate_data_dir_for_removal(&expected, &expected, &|_| false),
            Err("uninstall.foreign_data".to_string())
        );
    }

    #[test]
    fn empty_or_known_data_folder_is_recycled_once() {
        let local = tempfile::tempdir().unwrap();
        let expected = expected(&local);
        fs::create_dir(&expected).unwrap();
        fs::write(expected.join("settings.json"), b"{}").unwrap();
        let calls = Cell::new(0);
        let seen = std::cell::RefCell::new(PathBuf::new());
        let recycle = |path: &Path| {
            calls.set(calls.get() + 1);
            *seen.borrow_mut() = path.to_path_buf();
            Ok(())
        };
        assert!(remove_data_dir_with(&expected, &expected, &|_| false, &recycle).is_ok());
        assert_eq!(calls.get(), 1);
        assert_eq!(*seen.borrow(), expected);
    }

    #[test]
    fn missing_folder_is_a_no_op() {
        let local = tempfile::tempdir().unwrap();
        let expected = expected(&local);
        let calls = Cell::new(0);
        let recycle = |_path: &Path| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        assert!(remove_data_dir_with(&expected, &expected, &|_| false, &recycle).is_ok());
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn expected_folder_is_under_local_app_data() {
        let local = Path::new(r"C:\Users\me\AppData\Local");
        assert_eq!(
            expected_installed_data_dir(local),
            local.join("Adperastra")
        );
    }

    #[test]
    fn installer_hooks_never_elevate_or_recursively_delete_data() {
        let hooks = include_str!("../../installer/adperastra-hooks.nsh").to_ascii_lowercase();
        assert!(!hooks.contains("requestexecutionlevel admin"));
        assert!(!hooks.contains("rmdir /r \"$localappdata\\adperastra\""));
        assert!(!hooks.contains("remove-item -recurse"));
        assert!(!hooks.contains(".adperastra"));
        assert!(!hooks.contains("signing"));
        assert!(hooks.contains("--recycle-app-data"));
        assert!(hooks.contains("mb_defbutton2"));
        assert!(hooks.contains("langstring adpremovequestion ${lang_spanish}"));
    }
}
