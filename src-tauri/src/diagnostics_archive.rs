//! Reviewed diagnostic ZIPs and the fixed issue page (Step 09h T5).
//! Saving is a new no-replace file; a foreign collision is kept. Opening the
//! issue page is one explicit user click and sends no diagnostics content.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::diagnostics_collect::{is_forbidden_path, release_version};
use crate::diagnostics_types::{
    validate_issue_code, validate_relative_name, DiagnosticsFileKind, DiagnosticsSaveResult,
    MAX_ISSUE_CODES, MAX_TITLE_CHARS, MAX_ZIP_BYTES,
};

pub const ISSUE_URL_BASE: &str = "https://github.com/stefanods29/Adperastra/issues/new";

/// One included file, already reviewed or excluded by the user.
#[derive(Debug, Clone)]
pub struct SaveEntry {
    pub relative_name: String,
    pub kind: DiagnosticsFileKind,
    pub text: Option<String>,
    pub dump: Option<PathBuf>,
}

/// Build the reviewed ZIP at a new destination. The destination name must
/// not exist; an existing foreign file is left exactly as it was.
pub fn write_zip(
    data_dir: &Path,
    dest_path: &Path,
    entries: &[SaveEntry],
) -> Result<DiagnosticsSaveResult, String> {
    if entries.is_empty() || entries.len() > crate::diagnostics_types::MAX_FILES {
        return Err("diagnostics.invalid".to_string());
    }
    if !dest_path.is_absolute()
        || dest_path
            .extension()
            .map(|extension| !extension.eq_ignore_ascii_case("zip"))
            .unwrap_or(true)
    {
        return Err("diagnostics.invalid".to_string());
    }
    let mut total = 0u64;
    let mut names = std::collections::HashSet::new();
    for entry in entries {
        validate_relative_name(&entry.relative_name)?;
        if !names.insert(entry.relative_name.clone()) {
            return Err("diagnostics.invalid".to_string());
        }
        total = total.saturating_add(match entry.kind {
            DiagnosticsFileKind::Text => entry.text.as_ref().map(|text| text.len() as u64).unwrap_or(0),
            DiagnosticsFileKind::Dump => entry
                .dump
                .as_ref()
                .and_then(|path| std::fs::metadata(path).ok())
                .map(|metadata| metadata.len())
                .unwrap_or(0),
        });
    }
    if total > MAX_ZIP_BYTES {
        return Err("diagnostics.too_large".to_string());
    }
    let parent = dest_path
        .parent()
        .ok_or_else(|| "diagnostics.invalid".to_string())?;
    let name = dest_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "diagnostics.invalid".to_string())?;
    let directory = fs_service::owned_io::PinnedDirectory::open(parent)
        .map_err(|_| "diagnostics.io".to_string())?;
    let mut output = fs_service::owned_io::OwnedOutput::create(&directory, "diagnostics")
        .map_err(|_| "diagnostics.io".to_string())?;
    {
        let mut writer = zip::ZipWriter::new(output.file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for entry in entries {
            writer
                .start_file(entry.relative_name.clone(), options)
                .map_err(|_| "diagnostics.io".to_string())?;
            match entry.kind {
                DiagnosticsFileKind::Text => {
                    let text = entry.text.as_deref().unwrap_or("");
                    writer
                        .write_all(text.as_bytes())
                        .map_err(|_| "diagnostics.io".to_string())?;
                }
                DiagnosticsFileKind::Dump => {
                    let path = entry
                        .dump
                        .as_ref()
                        .ok_or_else(|| "diagnostics.invalid".to_string())?;
                    if is_forbidden_path(path) || !path.starts_with(data_dir) {
                        return Err("diagnostics.invalid".to_string());
                    }
                    let metadata =
                        std::fs::symlink_metadata(path).map_err(|_| "diagnostics.io".to_string())?;
                    if metadata.file_type().is_symlink() || !metadata.is_file() {
                        return Err("diagnostics.invalid".to_string());
                    }
                    let file = std::fs::File::open(path).map_err(|_| "diagnostics.io".to_string())?;
                    let mut bytes = Vec::new();
                    file.take(crate::diagnostics_types::MAX_DUMP_BYTES + 1)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "diagnostics.io".to_string())?;
                    if bytes.len() as u64 > crate::diagnostics_types::MAX_DUMP_BYTES {
                        return Err("diagnostics.too_large".to_string());
                    }
                    writer
                        .write_all(&bytes)
                        .map_err(|_| "diagnostics.io".to_string())?;
                }
            }
        }
        writer.finish().map_err(|_| "diagnostics.io".to_string())?;
    }
    output.flush_sync().map_err(|_| "diagnostics.io".to_string())?;
    let length = output
        .file_mut()
        .metadata()
        .map_err(|_| "diagnostics.io".to_string())?
        .len();
    if length > MAX_ZIP_BYTES {
        return Err("diagnostics.too_large".to_string());
    }
    let published = output
        .publish_name(name)
        .map_err(|_| "diagnostics.io".to_string())?;
    Ok(DiagnosticsSaveResult {
        path: published
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string(),
        bytes: length,
    })
}

/// The prefilled page. No diagnostics content, path, dump link or automatic
/// submission is part of the URL.
pub fn issue_url(title: &str, issue_codes: &[String]) -> Result<String, String> {
    if title.chars().count() > MAX_TITLE_CHARS
        || title.chars().any(|character| character.is_control())
        || issue_codes.len() > MAX_ISSUE_CODES
    {
        return Err("diagnostics.invalid".to_string());
    }
    for code in issue_codes {
        validate_issue_code(code)?;
    }
    let body = format!(
        "app_version={}\nissue_codes={}\n",
        release_version(),
        issue_codes.join(",")
    );
    if body.len() > 2_048 {
        return Err("diagnostics.invalid".to_string());
    }
    Ok(format!(
        "{ISSUE_URL_BASE}?title={}&body={}",
        encode_component(title),
        encode_component(&body)
    ))
}

fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Open the fixed issue page through Windows' own open action. The URL is
/// built only by `issue_url`; no caller supplies a host or path.
#[tauri::command]
pub fn diagnostics_open_issue(
    window: tauri::WebviewWindow,
    title: String,
    issue_codes: Vec<String>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let url = issue_url(&title, &issue_codes)?;
    open_fixed_url(&url)
}

#[cfg(windows)]
fn open_fixed_url(url: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    if !url.starts_with(ISSUE_URL_BASE) {
        return Err("diagnostics.invalid".to_string());
    }
    let file = crate::explorer::wide_null(url);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOASYNC,
        lpFile: PCWSTR(file.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: `file` outlives the call and the structure is initialized.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(()),
        Err(_) => Err("diagnostics.io".to_string()),
    }
}

#[cfg(not(windows))]
fn open_fixed_url(_url: &str) -> Result<(), String> {
    Err("diagnostics.unsupported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics_types::DiagnosticsFileKind;

    fn text(name: &str, body: &str) -> SaveEntry {
        SaveEntry {
            relative_name: name.to_string(),
            kind: DiagnosticsFileKind::Text,
            text: Some(body.to_string()),
            dump: None,
        }
    }

    #[test]
    fn a_reviewed_zip_is_new_and_contains_included_text() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let dest = folder.path().join("diagnostics.zip");
        let result = write_zip(&data, &dest, &[text("app-info.txt", "app_version=0.1.8\n")]).unwrap();
        assert_eq!(result.path, dest.to_string_lossy());
        assert!(result.bytes > 4);
        assert_eq!(&std::fs::read(&dest).unwrap()[..4], b"PK\x03\x04");
    }

    #[test]
    fn a_collision_keeps_the_foreign_file() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let dest = folder.path().join("diagnostics.zip");
        std::fs::write(&dest, "foreign bytes").unwrap();
        assert_eq!(
            write_zip(&data, &dest, &[text("app-info.txt", "x")]).unwrap_err(),
            "diagnostics.io"
        );
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "foreign bytes");
    }

    #[test]
    fn a_dump_outside_the_app_data_folder_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let outside = folder.path().join("elsewhere.dmp");
        std::fs::write(&outside, b"private bytes").unwrap();
        let dest = folder.path().join("diagnostics.zip");
        let entry = SaveEntry {
            relative_name: "crash.dmp".to_string(),
            kind: DiagnosticsFileKind::Dump,
            text: None,
            dump: Some(outside),
        };
        assert_eq!(
            write_zip(&data, &dest, &[entry]).unwrap_err(),
            "diagnostics.invalid"
        );
        assert!(!dest.exists());
    }

    #[test]
    fn zip_traversal_is_refused_before_a_file_exists() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let dest = folder.path().join("diagnostics.zip");
        let mut entry = text("..\\escape.txt", "x");
        entry.relative_name = "..\\escape.txt".to_string();
        assert_eq!(
            write_zip(&data, &dest, &[entry]).unwrap_err(),
            "diagnostics.invalid"
        );
        assert!(!dest.exists());
    }

    #[test]
    fn the_issue_url_is_fixed_and_has_no_diagnostics_content() {
        let url = issue_url("A problem", &["recovery.corrupt".to_string()]).unwrap();
        assert!(url.starts_with(ISSUE_URL_BASE));
        assert!(url.contains("title=A%20problem"));
        assert!(url.contains("issue_codes%3Drecovery.corrupt"));
        assert!(!url.contains("C%3A"));
        assert!(!url.contains(".zip"));
        assert!(!url.to_lowercase().contains("attach"));
    }

    #[test]
    fn bad_titles_and_codes_are_refused() {
        assert_eq!(
            issue_url(&"x".repeat(MAX_TITLE_CHARS + 1), &[]).unwrap_err(),
            "diagnostics.invalid"
        );
        assert_eq!(
            issue_url("ok", &["Not A Code".to_string()]).unwrap_err(),
            "diagnostics.invalid"
        );
        let codes = vec!["recovery.corrupt".to_string(); MAX_ISSUE_CODES + 1];
        assert_eq!(issue_url("ok", &codes).unwrap_err(), "diagnostics.invalid");
    }
}
