#![allow(dead_code)] // Public producer API; consumed from later steps.
//! The `--ocr-helper` process (Step 07e plan D1).
//!
//! `Adperastra.exe --ocr-helper` reads one JSON request line (plus, for a
//! memory image, an exact byte body), decodes the image with 07a E8, runs
//! Windows.Media.Ocr, and writes one bounded JSON reply line. It never
//! writes a source file, never opens a network resource and never executes
//! anything it reads (plan D8). The parent owns a 512 MiB job object and a
//! 30 s wall limit; it kills this process on cancellation.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::SourceStamp;

use crate::ocr_pixels::prepare_pixels;
use crate::ocr_types::{
    OcrLanguage, ERR_BAD_REQUEST, ERR_CHANGED, ERR_FAILED, ERR_ONLINE_ONLY, ERR_TOO_LARGE,
    MAX_OCR_PIXELS,
};

/// The static flag that selects this helper (never a user-provided path).
pub const HELPER_FLAG: &str = "--ocr-helper";
/// Largest request line accepted from the parent.
pub const MAX_OCR_HELPER_LINE: usize = 1024 * 1024;
/// Largest memory image accepted (07d render PNG cap is 8 MiB).
pub const MAX_OCR_MEMORY_BYTES: u64 = 8 * 1024 * 1024;
/// Largest reply line this helper writes (bounded page + envelope).
pub const MAX_OCR_HELPER_REPLY: usize = 6 * 1024 * 1024;

/// The helper-only request. `expected` binds the file mode to the exact
/// revision the parent validated; the memory mode carries no path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum OcrHelperRequest {
    Languages,
    File {
        path: String,
        expected: SourceStamp,
        language: String,
    },
    Memory {
        language: String,
        format: String,
        byte_len: u64,
    },
}

/// What the helper prints back. `status` is `ok`, `languages` or `error`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrHelperReply {
    pub status: String,
    #[serde(default)]
    pub languages: Vec<OcrLanguage>,
    #[serde(default)]
    pub user_profile: Option<String>,
    #[serde(default)]
    pub page: Option<crate::ocr_windows::OcrPayload>,
    #[serde(default)]
    pub error: Option<String>,
}

impl OcrHelperReply {
    fn error(code: String) -> Self {
        Self {
            status: "error".to_string(),
            languages: Vec::new(),
            user_profile: None,
            page: None,
            error: Some(code),
        }
    }

    fn page(page: crate::ocr_windows::OcrPayload) -> Self {
        Self {
            status: "ok".to_string(),
            languages: Vec::new(),
            user_profile: None,
            page: Some(page),
            error: None,
        }
    }
}

fn map_decode_error(error: String) -> String {
    if error.contains("too_large") {
        ERR_TOO_LARGE.to_string()
    } else if error.contains("changed") {
        ERR_CHANGED.to_string()
    } else if error.contains("online_only") {
        ERR_ONLINE_ONLY.to_string()
    } else {
        ERR_FAILED.to_string()
    }
}

fn read_image_file(
    path: &str,
    expected: &SourceStamp,
) -> Result<crate::thumbnail_decode::DecodedPixels, String> {
    let path = PathBuf::from(path);
    crate::validate_absolute_path(path.to_string_lossy().as_ref())
        .map_err(|_| ERR_BAD_REQUEST.to_string())?;
    // Metadata only: never hydrates a cloud placeholder (plan R-FS-1).
    let item = fs_service::stat_path(&path).map_err(|_| ERR_CHANGED.to_string())?;
    if item.attrs.online_only {
        return Err(ERR_ONLINE_ONLY.to_string());
    }
    if item.kind != fs_service::ItemKind::File {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    let identity = SourceIdentity::capture(&path).map_err(|_| ERR_CHANGED.to_string())?;
    let mut pinned = PinnedSource::open(&path, &identity).map_err(|_| ERR_CHANGED.to_string())?;
    let stamp = fs_service::capture_source_stamp(&path).map_err(|_| ERR_CHANGED.to_string())?;
    if &stamp != expected {
        return Err(ERR_CHANGED.to_string());
    }
    // The decoder's pixel cap checks the frame before scaling; OCR's
    // 16,777,216 cap applies to the prepared bitmap in `prepare_pixels`.
    let decoded = crate::thumbnail_decode::decode_pixels(
        pinned.file_mut(),
        crate::ocr_types::OCR_MAX_EDGE,
        crate::thumbnail_decode::MAX_PIXELS_LIMIT,
    )
    .map_err(map_decode_error)?;
    pinned
        .verify_after_read()
        .map_err(|_| ERR_CHANGED.to_string())?;
    Ok(decoded)
}

fn read_image_memory(
    reader: &mut impl Read,
    byte_len: u64,
    format: &str,
) -> Result<crate::thumbnail_decode::DecodedPixels, String> {
    if format != "png" || byte_len == 0 || byte_len > MAX_OCR_MEMORY_BYTES {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    let length = usize::try_from(byte_len).map_err(|_| ERR_TOO_LARGE.to_string())?;
    // Sensitive/snapshot pages arrive here; wipe the copy on every path.
    let mut bytes = zeroize::Zeroizing::new(vec![0u8; length]);
    reader
        .read_exact(bytes.as_mut_slice())
        .map_err(|_| ERR_BAD_REQUEST.to_string())?;
    // Additive 07a E8 export: WIC decode from bounded memory (the PDF
    // adapter's sensitive/snapshot route never writes a temp file).
    crate::thumbnail_decode::decode_pixels_from_memory(
        bytes.as_slice(),
        crate::ocr_types::OCR_MAX_EDGE,
        crate::thumbnail_decode::MAX_PIXELS_LIMIT,
    )
    .map_err(map_decode_error)
}

fn recognize_decoded(
    decoded: &crate::thumbnail_decode::DecodedPixels,
    language: &str,
) -> Result<crate::ocr_windows::OcrPayload, String> {
    let prepared = prepare_pixels(decoded, crate::ocr_types::OCR_MAX_EDGE, MAX_OCR_PIXELS)?;
    let token = fs_service::new_cancellation_token();
    let mut payload = crate::ocr_windows::recognize(&prepared, language, &token)?;
    payload.original_width = prepared.original_width;
    payload.original_height = prepared.original_height;
    Ok(payload)
}

fn validate_helper_language(language: &str) -> Result<(), String> {
    // `auto` is resolved by the service; the helper always gets a tag.
    if language == "auto" {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    crate::ocr_types::validate_language_preference(language)
}

fn handle_request(
    request: OcrHelperRequest,
    reader: &mut impl Read,
) -> Result<OcrHelperReply, String> {
    match request {
        OcrHelperRequest::Languages => {
            let reply = crate::ocr_windows::available_languages()?;
            Ok(OcrHelperReply {
                status: "languages".to_string(),
                languages: reply.languages,
                user_profile: reply.user_profile,
                page: None,
                error: None,
            })
        }
        OcrHelperRequest::File {
            path,
            expected,
            language,
        } => {
            validate_helper_language(&language)?;
            let decoded = read_image_file(&path, &expected)?;
            Ok(OcrHelperReply::page(recognize_decoded(
                &decoded, &language,
            )?))
        }
        OcrHelperRequest::Memory {
            language,
            format,
            byte_len,
        } => {
            validate_helper_language(&language)?;
            let decoded = read_image_memory(reader, byte_len, &format)?;
            Ok(OcrHelperReply::page(recognize_decoded(
                &decoded, &language,
            )?))
        }
    }
}

fn write_reply(reply: &OcrHelperReply) -> Result<(), String> {
    let bytes = serde_json::to_vec(reply).map_err(|_| ERR_FAILED.to_string())?;
    if bytes.len() > MAX_OCR_HELPER_REPLY {
        let fallback = OcrHelperReply::error(ERR_TOO_LARGE.to_string());
        let bytes = serde_json::to_vec(&fallback).map_err(|_| ERR_FAILED.to_string())?;
        let mut stdout = std::io::stdout().lock();
        stdout
            .write_all(&bytes)
            .and_then(|_| stdout.write_all(b"\n"))
            .and_then(|_| stdout.flush())
            .map_err(|_| ERR_FAILED.to_string())?;
        return Ok(());
    }
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&bytes)
        .and_then(|_| stdout.write_all(b"\n"))
        .and_then(|_| stdout.flush())
        .map_err(|_| ERR_FAILED.to_string())
}

fn read_request_line(reader: &mut impl BufRead) -> Result<String, String> {
    let mut line = String::new();
    reader
        .take((MAX_OCR_HELPER_LINE + 1) as u64)
        .read_line(&mut line)
        .map_err(|_| ERR_BAD_REQUEST.to_string())?;
    if line.len() > MAX_OCR_HELPER_LINE || line.trim().is_empty() {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    Ok(line)
}

fn run(reader: &mut impl BufRead) -> Result<OcrHelperReply, String> {
    let line = read_request_line(reader)?;
    let request: OcrHelperRequest =
        serde_json::from_str(line.trim()).map_err(|_| ERR_BAD_REQUEST.to_string())?;
    handle_request(request, reader)
}

/// Helper entry point. Returns the process exit code; every parsed request,
/// including a refused one, answers with exactly one bounded reply line.
pub fn run_helper() -> i32 {
    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let reply = match run(&mut reader) {
        Ok(reply) => reply,
        Err(code) => OcrHelperReply::error(code),
    };
    match write_reply(&reply) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

/// True when the helper would be allowed to read this local image without
/// hydrating it. Kept pure so the cloud rule is testable without Windows.
pub fn file_is_local(online_only: bool) -> bool {
    !online_only
}

/// The helper's view of a path: absolute and long enough for the wire.
pub fn valid_helper_path(path: &str) -> bool {
    !path.is_empty()
        && path.encode_utf16().count() <= crate::ocr_types::MAX_OCR_PATH_UNITS
        && Path::new(path).is_absolute()
}

#[cfg(test)]
mod tests {
    use super::{file_is_local, valid_helper_path};

    #[test]
    fn cloud_placeholders_are_never_read() {
        assert!(file_is_local(false));
        assert!(!file_is_local(true));
    }

    #[test]
    fn helper_paths_are_absolute_and_bounded() {
        assert!(valid_helper_path(r"C:\Pictures\a.png"));
        assert!(!valid_helper_path(r"Pictures\a.png"));
        assert!(!valid_helper_path(""));
    }
}
