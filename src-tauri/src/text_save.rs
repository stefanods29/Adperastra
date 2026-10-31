//! Saving text files (Step 06a): encode, version hook, safe replace.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use crate::{ensure_main, versions::ModifyReason};

/// Largest text `text_save` accepts, in UTF-8 bytes.
pub const MAX_SAVE_TEXT_BYTES: usize = 33_554_432;

/// Encodings stored one byte per character, with a 256-entry table.
const SINGLE_BYTE_IDS: [&str; 4] = [
    "windows-1252",
    "iso-8859-15",
    "windows-1250",
    "windows-1251",
];

/// Encodings that save straight from Rust.
const UTF_IDS: [&str; 4] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"];

/// Encodings the reader can show but not save.
const READ_ONLY_IDS: [&str; 4] = ["shift_jis", "gbk", "big5", "euc-kr"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextSaveRequest {
    pub path: String,
    pub text: String,
    pub encoding: String,
    pub table: Option<Vec<String>>,
    pub mode: String,
    pub expected_modified_unix: Option<u64>,
    pub expected_size: Option<u64>,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFile {
    pub path: String,
    pub size: u64,
    pub modified_unix: u64,
}

/// The text as bytes in the chosen encoding. Every character must exist in
/// a single-byte table, or the save stops with `textSave.unmappable`.
pub fn encode_text(
    text: &str,
    encoding: &str,
    table: Option<&[String]>,
) -> Result<Vec<u8>, String> {
    match encoding {
        "utf-8" => Ok(text.as_bytes().to_vec()),
        "utf-8-bom" => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        "utf-16le" => {
            let mut bytes = vec![0xff, 0xfe];
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            Ok(bytes)
        }
        "utf-16be" => {
            let mut bytes = vec![0xfe, 0xff];
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
            Ok(bytes)
        }
        id if SINGLE_BYTE_IDS.contains(&id) => encode_single_byte(text, table),
        id if READ_ONLY_IDS.contains(&id) => Err("textSave.cannot_encode".to_string()),
        _ => Err("textSave.bad_request".to_string()),
    }
}

fn encode_single_byte(text: &str, table: Option<&[String]>) -> Result<Vec<u8>, String> {
    let table = check_table(table)?;
    let mut mapped: Vec<(char, u8)> = Vec::with_capacity(256);
    for (index, entry) in table.iter().enumerate() {
        let mut chars = entry.chars();
        let Some(ch) = chars.next() else { continue };
        if chars.next().is_some() {
            return Err("textSave.bad_request".to_string());
        }
        if ch == '\u{FFFD}' {
            continue;
        }
        mapped.push((ch, index as u8));
    }
    let mut bytes = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let Some((_, byte)) = mapped.iter().find(|(known, _)| *known == ch) else {
            return Err("textSave.unmappable".to_string());
        };
        bytes.push(*byte);
    }
    Ok(bytes)
}

/// The 256 one-character entries a single-byte save needs.
fn check_table(table: Option<&[String]>) -> Result<&[String], String> {
    let bad = || "textSave.bad_request".to_string();
    let table = table.ok_or_else(bad)?;
    if table.len() != 256 {
        return Err(bad());
    }
    for entry in table {
        let mut chars = entry.chars();
        let Some(_) = chars.next() else {
            return Err(bad());
        };
        if chars.next().is_some() {
            return Err(bad());
        }
    }
    Ok(table)
}

/// The validation column of `TextSaveRequest`.
pub fn check_request(request: &TextSaveRequest) -> Result<(), String> {
    let bad = || "textSave.bad_request".to_string();
    crate::validate_absolute_path(&request.path).map_err(|_| bad())?;
    if request.text.len() > MAX_SAVE_TEXT_BYTES {
        return Err("textSave.too_large".to_string());
    }
    let known = UTF_IDS.contains(&request.encoding.as_str())
        || SINGLE_BYTE_IDS.contains(&request.encoding.as_str())
        || READ_ONLY_IDS.contains(&request.encoding.as_str());
    if !known {
        return Err(bad());
    }
    if SINGLE_BYTE_IDS.contains(&request.encoding.as_str()) {
        check_table(request.table.as_deref())?;
    }
    if request.mode != "save" && request.mode != "saveAs" {
        return Err(bad());
    }
    Ok(())
}

/// The UI translation key for a save failure.
pub fn save_error_code(error: &fs_service::SaveError) -> String {
    match error {
        fs_service::SaveError::ChangedOnDisk => "textSave.changed_on_disk".to_string(),
        fs_service::SaveError::ReadOnly => "textSave.read_only".to_string(),
        fs_service::SaveError::InUse => "textSave.in_use".to_string(),
        fs_service::SaveError::FolderMissing => "textSave.not_found".to_string(),
        fs_service::SaveError::RecycleFailed => "textSave.recycle_failed".to_string(),
        fs_service::SaveError::TargetExists => "textSave.write_failed".to_string(),
        fs_service::SaveError::Io(_) => "textSave.write_failed".to_string(),
    }
}

/// Save text into a file through the version hook and the safe replace.
#[tauri::command]
pub async fn text_save(
    window: WebviewWindow,
    request: TextSaveRequest,
) -> Result<SavedFile, String> {
    ensure_main(window.label())?;
    check_request(&request)?;
    tauri::async_runtime::spawn_blocking(move || save_now(request))
        .await
        .map_err(|error| error.to_string())?
}

fn save_now(request: TextSaveRequest) -> Result<SavedFile, String> {
    let bytes = encode_text(&request.text, &request.encoding, request.table.as_deref())?;
    let path = Path::new(&request.path);
    let reason = if request.mode == "saveAs" {
        ModifyReason::SaveAs
    } else {
        ModifyReason::Save
    };
    crate::versions::before_modify(path, reason)?;
    let saved = if request.mode == "saveAs" {
        fs_service::recycle_target(path).map_err(|error| save_error_code(&error))?;
        fs_service::write_new_file(path, &bytes).map_err(|error| save_error_code(&error))?
    } else {
        let expect = match (request.expected_modified_unix, request.expected_size) {
            (Some(modified_unix), Some(size)) if !request.force => Some(fs_service::SaveExpect {
                modified_unix,
                size,
            }),
            _ => None,
        };
        fs_service::replace_contents(path, &bytes, expect)
            .map_err(|error| save_error_code(&error))?
    };
    Ok(SavedFile {
        path: request.path.trim_start_matches(r"\\?\").to_string(),
        size: saved.size,
        modified_unix: saved.modified_unix,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str, encoding: &str, mode: &str) -> TextSaveRequest {
        TextSaveRequest {
            path: path.to_string(),
            text: "text".to_string(),
            encoding: encoding.to_string(),
            table: None,
            mode: mode.to_string(),
            expected_modified_unix: None,
            expected_size: None,
            force: false,
        }
    }

    #[test]
    fn encodes_utf8_and_utf16_with_their_marks() {
        assert_eq!(
            encode_text("Aé", "utf-8", None).unwrap(),
            vec![0x41, 0xc3, 0xa9]
        );
        let bom = encode_text("Aé", "utf-8-bom", None).unwrap();
        assert_eq!(&bom[..3], &[0xef, 0xbb, 0xbf]);
        assert_eq!(
            encode_text("Aé", "utf-16le", None).unwrap(),
            vec![0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]
        );
        assert_eq!(
            encode_text("Aé", "utf-16be", None).unwrap(),
            vec![0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9]
        );
    }

    #[test]
    fn encodes_single_byte_text_with_the_table() {
        let mut table = vec!["\u{FFFD}".to_string(); 256];
        table[65] = "A".to_string();
        table[233] = "é".to_string();
        assert_eq!(
            encode_text("Aé", "windows-1252", Some(&table)).unwrap(),
            vec![0x41, 0xe9]
        );
        assert_eq!(
            encode_text("A€", "windows-1252", Some(&table)),
            Err("textSave.unmappable".to_string())
        );
        let short = vec!["A".to_string(); 255];
        assert_eq!(
            encode_text("A", "windows-1252", Some(&short)),
            Err("textSave.bad_request".to_string())
        );
    }

    #[test]
    fn refuses_encodings_that_cannot_be_saved() {
        assert_eq!(
            encode_text("A", "shift_jis", None),
            Err("textSave.cannot_encode".to_string())
        );
        assert_eq!(
            encode_text("A", "klingon", None),
            Err("textSave.bad_request".to_string())
        );
    }

    #[test]
    fn checks_the_request() {
        assert_eq!(
            check_request(&request("relative.txt", "utf-8", "save")),
            Err("textSave.bad_request".to_string())
        );
        assert_eq!(
            check_request(&request(r"C:\x\a.txt", "utf-8", "append")),
            Err("textSave.bad_request".to_string())
        );
        assert_eq!(
            check_request(&request(r"C:\x\a.txt", "windows-1251", "save")),
            Err("textSave.bad_request".to_string())
        );
        assert_eq!(
            check_request(&request(r"C:\x\a.txt", "utf-8", "save")),
            Ok(())
        );
    }
}
