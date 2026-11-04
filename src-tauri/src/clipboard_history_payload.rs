//! Bounded clipboard payloads (Step 09j T4/T5).
//!
//! Everything that enters history is validated here: text by Unicode
//! scalar count and UTF-8 bytes, files by count and absolute paths, images
//! by pixels and encoded bytes. The preview is the only text the renderer
//! receives, and it is escaped before it leaves Rust.

use std::sync::Arc;

use crate::clipboard_history_types::{
    CapturedPayload, ClipboardHistoryKind, ClipboardHistorySource, HistoryItem, HistoryPayload,
    MAX_FILE_PATHS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_PATH_UNITS, MAX_PREVIEW_CHARS,
    MAX_SOURCE_LABEL_CHARS, MAX_TEXT_BYTES, MAX_TEXT_SCALARS,
};
use uuid::Uuid;

/// One entry ready for the encrypted store. Payload bytes stay in shared
/// memory; a pin or list never copies them.
#[derive(Clone)]
pub struct PersistEntry {
    pub id: Uuid,
    pub kind: ClipboardHistoryKind,
    pub created_unix: u64,
    pub source: ClipboardHistorySource,
    pub source_label: Option<String>,
    pub preview: String,
    pub byte_len: u64,
    pub pinned: bool,
    pub missing: bool,
    pub content_hash: String,
    pub payload: PersistPayload,
}

#[derive(Clone)]
pub enum PersistPayload {
    Text(Arc<str>),
    Files(Arc<[String]>),
    Image {
        mime: String,
        width: u32,
        height: u32,
        bytes: Arc<[u8]>,
    },
}

pub fn persist_entry(item: &HistoryItem) -> PersistEntry {
    PersistEntry {
        id: item.id,
        kind: item.kind,
        created_unix: item.created_unix,
        source: item.source,
        source_label: item.source_label.clone(),
        preview: item.preview.clone(),
        byte_len: item.byte_len,
        pinned: item.pinned,
        missing: item.missing,
        content_hash: item.content_hash.clone(),
        payload: match &item.payload {
            HistoryPayload::Text(text) => PersistPayload::Text(text.clone()),
            HistoryPayload::Files(paths) => PersistPayload::Files(paths.clone()),
            HistoryPayload::Image {
                mime,
                width,
                height,
                bytes,
            } => PersistPayload::Image {
                mime: mime.clone(),
                width: *width,
                height: *height,
                bytes: bytes.clone(),
            },
        },
    }
}

impl PersistEntry {
    /// The bytes the store encrypts for this entry.
    pub fn payload_bytes(&self) -> Result<Vec<u8>, String> {
        match &self.payload {
            PersistPayload::Text(text) => Ok(text.as_bytes().to_vec()),
            PersistPayload::Files(paths) => {
                serde_json::to_vec(paths.as_ref()).map_err(|_| "clipboard_history.io".to_string())
            }
            PersistPayload::Image { bytes, .. } => Ok(bytes.as_ref().to_vec()),
        }
    }
}

/// Validate one captured payload, build its preview, length and hash.
pub fn build_item(
    id: Uuid,
    captured: CapturedPayload,
    source: ClipboardHistorySource,
    source_label: Option<String>,
    created_unix: u64,
) -> Result<HistoryItem, String> {
    if let Some(label) = &source_label {
        if label.chars().count() > MAX_SOURCE_LABEL_CHARS || label.chars().any(char::is_control) {
            return Err("clipboard_history.invalid".to_string());
        }
    }
    let (kind, preview, byte_len, content_hash, payload) = match captured {
        CapturedPayload::Text(text) => {
            validate_text(&text)?;
            let preview = preview_text(&text);
            let hash = hash_text(&text);
            let bytes = text.len() as u64;
            (
                ClipboardHistoryKind::Text,
                preview,
                bytes,
                hash,
                HistoryPayload::text(text),
            )
        }
        CapturedPayload::Files(paths) => {
            let paths = validate_files(paths)?;
            let preview = preview_files(&paths);
            let hash = hash_files(&paths);
            let bytes = paths.iter().map(|path| path.len() as u64 + 1).sum();
            (
                ClipboardHistoryKind::Files,
                preview,
                bytes,
                hash,
                HistoryPayload::files(paths),
            )
        }
        CapturedPayload::Image {
            mime,
            width,
            height,
            bytes,
        } => {
            validate_image(&mime, width, height, &bytes)?;
            let hash = hash_bytes(&bytes);
            let bytes_len = bytes.len() as u64;
            (
                ClipboardHistoryKind::Image,
                String::new(),
                bytes_len,
                hash,
                HistoryPayload::image(mime, width, height, bytes),
            )
        }
    };
    Ok(HistoryItem {
        id,
        kind,
        created_unix,
        source,
        source_label,
        preview,
        byte_len,
        pinned: false,
        missing: false,
        sensitive: false,
        content_hash,
        payload,
    })
}

pub fn validate_text(text: &str) -> Result<(), String> {
    if text.is_empty() || text.chars().count() > MAX_TEXT_SCALARS {
        return Err("clipboard_history.too_large".to_string());
    }
    if text.len() > MAX_TEXT_BYTES {
        return Err("clipboard_history.too_large".to_string());
    }
    if text.chars().any(|c| c == '\0') {
        return Err("clipboard_history.invalid".to_string());
    }
    Ok(())
}

pub fn validate_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > MAX_FILE_PATHS {
        return Err("clipboard_history.too_large".to_string());
    }
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if !valid_file_path(&path) {
            return Err("clipboard_history.invalid".to_string());
        }
        let key = normalized_file(&path);
        if seen.insert(key) {
            out.push(path);
        }
    }
    if out.is_empty() {
        return Err("clipboard_history.invalid".to_string());
    }
    Ok(out)
}

pub fn validate_image(
    mime: &str,
    width: u32,
    height: u32,
    bytes: &[u8],
) -> Result<(), String> {
    if !mime.starts_with("image/")
        || mime.len() > 128
        || !mime.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err("clipboard_history.invalid".to_string());
    }
    if width == 0 || height == 0 {
        return Err("clipboard_history.invalid".to_string());
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err("clipboard_history.too_large".to_string());
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("clipboard_history.too_large".to_string());
    }
    Ok(())
}

/// One absolute local or UNC path, no traversal and no control characters.
pub fn valid_file_path(path: &str) -> bool {
    let units = path.encode_utf16().count();
    if units == 0 || units > MAX_PATH_UNITS || path.contains('\0') {
        return false;
    }
    if path.chars().any(char::is_control) {
        return false;
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let unc = path.starts_with(r"\\");
    if !drive && !unc {
        return false;
    }
    !path.split(['\\', '/']).any(|part| part == "..")
}

/// Comparison form for deduplication, never shown to the user.
pub fn normalized_file(path: &str) -> String {
    path.strip_prefix(r"\\?\")
        .unwrap_or(path)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub fn preview_text(text: &str) -> String {
    let mut lines = text
        .split('\n')
        .take(2)
        .map(|line| escape_preview(line.trim_end_matches('\r')))
        .collect::<Vec<String>>();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    truncate_chars(&lines.join("\n"), MAX_PREVIEW_CHARS)
}

fn preview_files(paths: &[String]) -> String {
    let names: Vec<String> = paths
        .iter()
        .take(3)
        .map(|path| {
            path.rsplit(['\\', '/'])
                .find(|part| !part.is_empty())
                .unwrap_or(path)
                .to_string()
        })
        .collect();
    truncate_chars(&escape_preview(&names.join(" · ")), MAX_PREVIEW_CHARS)
}

fn escape_preview(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '\t' | '\r' => ' ',
            c if c.is_control() && c != '\n' => ' ',
            c => c,
        })
        .collect()
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    text.chars().take(limit).collect()
}

pub fn hash_text(text: &str) -> String {
    hash_parts(1, &[text.as_bytes()])
}

pub fn hash_files(paths: &[String]) -> String {
    let mut normalized: Vec<String> = paths.iter().map(|path| normalized_file(path)).collect();
    normalized.sort();
    normalized.dedup();
    let mut hasher = blake3::Hasher::new();
    hasher.update(&[2u8]);
    for path in normalized {
        hasher.update(&(path.len() as u64).to_le_bytes());
        hasher.update(path.as_bytes());
    }
    hasher.finalize().to_hex().to_string()
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    hash_parts(3, &[bytes])
}

fn hash_parts(tag: u8, parts: &[&[u8]]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&[tag]);
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    hasher.finalize().to_hex().to_string()
}

/// True when a local referenced file is gone. UNC and device paths are
/// skipped: checking those can block on a sleeping server.
pub fn any_file_missing(paths: &[String]) -> bool {
    paths.iter().any(|path| {
        if path.starts_with(r"\\") {
            return false;
        }
        !std::path::Path::new(path).exists()
    })
}

/// The dimensions of a PNG, read from the IHDR header without decoding.
pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

#[cfg(test)]
#[path = "clipboard_history_payload_step09j_tests.rs"]
mod step09j_tests;
