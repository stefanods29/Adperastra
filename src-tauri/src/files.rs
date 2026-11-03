//! File access for file tabs (Step 04a): file-type detection, one access
//! token per open file, and the `adpfile` protocol that serves file bytes
//! to the UI (contract 13).
//!
//! Security (plan/rules.md R-SEC-5): the UI never puts a path in a URL. It
//! asks for a token for one file (`file_grant`); the protocol serves only
//! files that have a live token, and only to the main window.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, State, UriSchemeContext, UriSchemeResponder, WebviewWindow, Wry};

use crate::file_grant_backing::{serve_backing, GrantedBacking};
use crate::{ensure_main, validate_absolute_path};

/// The protocol name. On Windows the UI reaches it at
/// `http://adpfile.localhost/<token>/<file name>`.
pub const SCHEME: &str = "adpfile";
/// Most files open at the same time (one token each).
pub const MAX_GRANTS: usize = 1000;
/// Bytes read from the start of a file to recognize its type.
pub const HEAD_BYTES: usize = 8192;
/// Largest part of a file sent for one range request.
pub const MAX_CHUNK: u64 = 4 * 1024 * 1024;
/// Largest file sent whole (requests without a Range header).
pub const MAX_FULL_RESPONSE: u64 = 256 * 1024 * 1024;

/// What the open pipeline needs to choose a handler (mirrored in
/// `src/handlers/types.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileTypeInfo {
    pub path: String,
    pub name: String,
    /// Lower-case extension without the dot; "" when there is none.
    pub ext: String,
    /// From the file's first bytes when recognizable, else from the
    /// extension, else "application/octet-stream".
    pub mime: String,
    pub size: u64,
    pub modified_unix: u64,
    pub online_only: bool,
    pub read_only: bool,
    /// Windows marked the file as downloaded from the internet (Step 04c,
    /// `crate::zone`): file tabs show it in protected view.
    pub from_internet: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileGrant {
    pub token: String,
}

/// Live access tokens: token -> file path. Managed Tauri state.
#[derive(Default)]
pub struct FileGrants {
    map: Mutex<HashMap<String, PathBuf>>,
    /// Memory results and guarded backings (Step 07d E8). Kept apart so
    /// `path_for` keeps answering only for path grants.
    backings: Mutex<HashMap<String, Arc<GrantedBacking>>>,
}

impl FileGrants {
    pub fn grant(&self, path: PathBuf) -> Result<String, String> {
        let mut map = self
            .map
            .lock()
            .map_err(|_| "file grants lock poisoned".to_string())?;
        if map.len() >= MAX_GRANTS {
            return Err("files.too_many_open".to_string());
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        map.insert(token.clone(), path);
        Ok(token)
    }

    pub fn revoke(&self, token: &str) {
        if let Ok(mut map) = self.map.lock() {
            map.remove(token);
        }
        if let Ok(mut backings) = self.backings.lock() {
            backings.remove(token);
        }
    }

    pub fn path_for(&self, token: &str) -> Option<PathBuf> {
        self.map.lock().ok().and_then(|map| map.get(token).cloned())
    }

    /// Grant a guarded backing (a memory page or a pinned file).
    pub fn grant_backing(&self, backing: Arc<GrantedBacking>) -> Result<String, String> {
        if !backing.is_consistent() {
            return Err("files.invalid_request".to_string());
        }
        let mut backings = self
            .backings
            .lock()
            .map_err(|_| "file grants lock poisoned".to_string())?;
        let paths = self.map.lock().map(|map| map.len()).unwrap_or(0);
        if paths + backings.len() >= MAX_GRANTS {
            return Err("files.too_many_open".to_string());
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        backings.insert(token.clone(), backing);
        Ok(token)
    }

    /// Resolve a token to guarded bytes. A memory grant is found here; an
    /// ordinary path grant is materialized lazily through the fs-service
    /// guards and is never inserted (so `path_for` keeps its old value).
    pub fn resolve_backing(&self, token: &str) -> Option<Arc<GrantedBacking>> {
        if !is_valid_token(token) {
            return None;
        }
        if let Some(found) = self
            .backings
            .lock()
            .ok()
            .and_then(|backings| backings.get(token).cloned())
        {
            return Some(found);
        }
        let path = self.path_for(token)?;
        let identity = fs_service::owned_io::SourceIdentity::capture(&path).ok()?;
        let length = identity.size;
        let pinned = fs_service::owned_io::PinnedSource::open(&path, &identity).ok()?;
        Some(Arc::new(GrantedBacking::Disk {
            source: Arc::new(pinned),
            length,
        }))
    }
}

/// A token is exactly 32 lower-case hex characters (a simple UUID).
pub fn is_valid_token(token: &str) -> bool {
    token.len() == 32
        && token
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// Lower-case extension of a file name, without the dot ("" when none).
pub fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < name.len() => name[dot + 1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// Content type by extension, used for protocol responses (browsers need
/// the right type to show SVG and play media).
pub fn mime_from_ext(ext: &str) -> &'static str {
    match ext {
        "txt" | "log" | "ini" | "cfg" | "conf" | "env" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "tsv" => "text/tab-separated-values; charset=utf-8",
        "json" | "ipynb" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "weba" => "audio/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "vtt" => "text/vtt; charset=utf-8",
        "srt" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn unix_seconds(time: std::io::Result<std::time::SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Recognize a file the user asked to open. Reads at most `HEAD_BYTES`
/// from the start of the file. Only for explicit opens: background work
/// must not call this on online-only files (plan/rules.md R-FS-1).
pub fn detect(path: &Path) -> Result<FileTypeInfo, String> {
    let meta = fs::metadata(path).map_err(|_| "files.not_found".to_string())?;
    if !meta.is_file() {
        return Err("files.not_a_file".to_string());
    }
    let item = fs_service::stat_path(path).map_err(|_| "files.not_found".to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = extension_of(&name);
    let mut head = Vec::with_capacity(HEAD_BYTES);
    let mut file = fs::File::open(path).map_err(|e| read_error_code(&e))?;
    (&mut file)
        .take(HEAD_BYTES as u64)
        .read_to_end(&mut head)
        .map_err(|e| read_error_code(&e))?;
    let by_ext = mime_from_ext(&ext)
        .split(';')
        .next()
        .unwrap_or("application/octet-stream");
    let mime = match infer::get(&head) {
        Some(kind) => kind.mime_type().to_string(),
        // Unknown extension, but the content looks like text (README,
        // LICENSE, .log.1, ...): show it in the text viewer (Step 04b).
        None if by_ext == "application/octet-stream" && looks_like_text(&head) => {
            "text/plain".to_string()
        }
        None => by_ext.to_string(),
    };
    Ok(FileTypeInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        ext,
        mime,
        size: meta.len(),
        modified_unix: unix_seconds(meta.modified()),
        online_only: item.attrs.online_only,
        read_only: meta.permissions().readonly(),
        from_internet: crate::zone::is_from_internet(path),
    })
}

/// True when the first bytes look like text: a UTF-16 byte-order mark, or
/// no zero bytes and almost no control characters (Step 04b).
pub fn looks_like_text(head: &[u8]) -> bool {
    if head.starts_with(&[0xFF, 0xFE]) || head.starts_with(&[0xFE, 0xFF]) {
        return true;
    }
    if head.contains(&0) {
        return false;
    }
    let controls = head
        .iter()
        .filter(|&&byte| byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0C | 0x1B))
        .count();
    controls * 100 <= head.len()
}

fn read_error_code(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "files.not_found".to_string(),
        std::io::ErrorKind::PermissionDenied => "files.access_denied".to_string(),
        _ => "files.read_failed".to_string(),
    }
}

/// How to answer a request, from its Range header and the file size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeAnswer {
    /// No usable Range header: send the whole file.
    Full,
    /// Send bytes `start..=end` (206 Partial Content).
    Part { start: u64, end: u64 },
    /// The range starts past the end of the file (416).
    Unsatisfiable,
}

/// Parse `Range: bytes=a-b` (only the first range is used). Every part is
/// capped at `MAX_CHUNK` bytes; the response says which bytes it holds.
pub fn parse_range(value: Option<&str>, total: u64) -> RangeAnswer {
    let Some(value) = value else {
        return RangeAnswer::Full;
    };
    let Some(spec) = value.trim().strip_prefix("bytes=") else {
        return RangeAnswer::Full;
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((from, to)) = first.split_once('-') else {
        return RangeAnswer::Full;
    };
    let (from, to) = (from.trim(), to.trim());
    if total == 0 {
        return RangeAnswer::Unsatisfiable;
    }
    let (start, end) = if from.is_empty() {
        // "bytes=-500": the last 500 bytes.
        match to.parse::<u64>() {
            Ok(count) if count > 0 => (total.saturating_sub(count), total - 1),
            _ => return RangeAnswer::Unsatisfiable,
        }
    } else {
        let Ok(start) = from.parse::<u64>() else {
            return RangeAnswer::Full;
        };
        if start >= total {
            return RangeAnswer::Unsatisfiable;
        }
        let end = if to.is_empty() {
            total - 1
        } else {
            match to.parse::<u64>() {
                Ok(end) => end.min(total - 1),
                Err(_) => return RangeAnswer::Full,
            }
        };
        if end < start {
            return RangeAnswer::Unsatisfiable;
        }
        (start, end)
    };
    RangeAnswer::Part {
        start,
        end: end.min(start + MAX_CHUNK - 1),
    }
}

fn base_response(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        // If a response is ever opened as a page, it can never run scripts.
        .header(header::CONTENT_SECURITY_POLICY, "sandbox")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    base_response(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Build the response for one protocol request. Pure apart from reading
/// the file, so it is unit-tested without a window.
pub fn serve(path: Option<PathBuf>, method: &Method, range: Option<&str>) -> Response<Vec<u8>> {
    if method == Method::OPTIONS {
        return base_response(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    if method != Method::GET && method != Method::HEAD {
        return empty(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some(path) = path else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(mut file) = fs::File::open(&path) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let content_type = mime_from_ext(&extension_of(&name));
    let (status, start, len) = match parse_range(range, total) {
        RangeAnswer::Unsatisfiable => {
            return base_response(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
        RangeAnswer::Full => {
            if total > MAX_FULL_RESPONSE {
                return empty(StatusCode::PAYLOAD_TOO_LARGE);
            }
            (StatusCode::OK, 0, total)
        }
        RangeAnswer::Part { start, end } => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
    };
    let mut body = Vec::new();
    if method == Method::GET {
        if file.seek(SeekFrom::Start(start)).is_err() {
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
        if (&mut file).take(len).read_to_end(&mut body).is_err() {
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    let mut builder = base_response(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len.to_string());
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, start + len - 1, total),
        );
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// The `adpfile` protocol handler (registered in `main()`). URL path:
/// `/<token>/<file name>`; the name is only for readability.
pub fn protocol(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if ctx.webview_label() != "main" {
        responder.respond(empty(StatusCode::FORBIDDEN));
        return;
    }
    let app = ctx.app_handle().clone();
    let method = request.method().clone();
    let request_name = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .nth(1)
        .unwrap_or("")
        .to_string();
    let token = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    std::thread::spawn(move || {
        let grants = app.state::<Arc<FileGrants>>();
        if is_valid_token(&token) && grants.path_for(&token).is_none() {
            if let Some(backing) = grants.resolve_backing(&token) {
                let mime = mime_from_ext(&extension_of(&request_name)).to_string();
                responder.respond(serve_backing(&backing, &mime, &method, range.as_deref()));
                return;
            }
        }
        let path = if is_valid_token(&token) {
            grants.path_for(&token)
        } else {
            None
        };
        responder.respond(serve(path, &method, range.as_deref()));
    });
}

/// Recognize a file before opening it in a tab.
#[tauri::command]
pub async fn file_detect(window: WebviewWindow, path: String) -> Result<FileTypeInfo, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "files.not_found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || detect(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Give the UI a token for one existing file; its bytes are then served
/// at `http://adpfile.localhost/<token>/<name>` until `file_revoke`.
#[tauri::command]
pub async fn file_grant(
    window: WebviewWindow,
    grants: State<'_, Arc<FileGrants>>,
    path: String,
) -> Result<FileGrant, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "files.not_found".to_string())?;
    let checked = path.clone();
    let is_file = tauri::async_runtime::spawn_blocking(move || Path::new(&checked).is_file())
        .await
        .map_err(|e| e.to_string())?;
    if !is_file {
        return Err("files.not_found".to_string());
    }
    let token = grants.grant(PathBuf::from(path))?;
    Ok(FileGrant { token })
}

/// Forget a token (the tab closed). Unknown tokens are ignored.
#[tauri::command]
pub fn file_revoke(
    window: WebviewWindow,
    grants: State<'_, Arc<FileGrants>>,
    token: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if !is_valid_token(&token) {
        return Err("files.invalid_request".to_string());
    }
    grants.revoke(&token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "adperastra-test-{}-files-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn range_without_header_is_full() {
        assert_eq!(parse_range(None, 100), RangeAnswer::Full);
        assert_eq!(parse_range(Some("items=0-5"), 100), RangeAnswer::Full);
    }

    #[test]
    fn range_forms() {
        assert_eq!(
            parse_range(Some("bytes=0-9"), 100),
            RangeAnswer::Part { start: 0, end: 9 }
        );
        assert_eq!(
            parse_range(Some("bytes=90-"), 100),
            RangeAnswer::Part { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range(Some("bytes=-10"), 100),
            RangeAnswer::Part { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range(Some("bytes=50-500"), 100),
            RangeAnswer::Part { start: 50, end: 99 }
        );
        assert_eq!(
            parse_range(Some("bytes=0-1, 5-9"), 100),
            RangeAnswer::Part { start: 0, end: 1 }
        );
    }

    #[test]
    fn range_past_the_end_is_unsatisfiable() {
        assert_eq!(
            parse_range(Some("bytes=100-"), 100),
            RangeAnswer::Unsatisfiable
        );
        assert_eq!(
            parse_range(Some("bytes=9-3"), 100),
            RangeAnswer::Unsatisfiable
        );
        assert_eq!(parse_range(Some("bytes=0-"), 0), RangeAnswer::Unsatisfiable);
    }

    #[test]
    fn open_ended_range_is_capped() {
        let total = 10 * MAX_CHUNK;
        assert_eq!(
            parse_range(Some("bytes=0-"), total),
            RangeAnswer::Part {
                start: 0,
                end: MAX_CHUNK - 1
            }
        );
    }

    #[test]
    fn tokens_are_32_lowercase_hex() {
        let grants = FileGrants::default();
        let token = grants.grant(PathBuf::from("C:\\a.txt")).unwrap();
        assert!(is_valid_token(&token));
        assert!(!is_valid_token("../../etc"));
        assert!(!is_valid_token(&token.to_uppercase()));
        assert_eq!(grants.path_for(&token), Some(PathBuf::from("C:\\a.txt")));
        grants.revoke(&token);
        assert_eq!(grants.path_for(&token), None);
    }

    #[test]
    fn grants_are_limited() {
        let grants = FileGrants::default();
        for _ in 0..MAX_GRANTS {
            grants.grant(PathBuf::from("C:\\a.txt")).unwrap();
        }
        assert_eq!(
            grants.grant(PathBuf::from("C:\\a.txt")),
            Err("files.too_many_open".to_string())
        );
    }

    #[test]
    fn detect_recognizes_content_and_reports_errors() {
        let dir = temp_dir("detect");
        let png = dir.join("picture.dat");
        fs::write(
            &png,
            b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0",
        )
        .unwrap();
        let info = detect(&png).unwrap();
        assert_eq!(info.mime, "image/png");
        assert_eq!(info.ext, "dat");
        assert_eq!(info.name, "picture.dat");
        let text = dir.join("notes.TXT");
        fs::write(&text, "hello").unwrap();
        let info = detect(&text).unwrap();
        assert_eq!(info.ext, "txt");
        assert_eq!(info.mime, "text/plain");
        assert_eq!(info.size, 5);
        assert_eq!(
            detect(&dir.join("missing.txt")),
            Err("files.not_found".to_string())
        );
        assert_eq!(detect(&dir), Err("files.not_a_file".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn serve_answers_ranges_and_refuses_unknown_tokens() {
        let dir = temp_dir("serve");
        let file = dir.join("data.bin");
        fs::write(&file, b"0123456789").unwrap();
        let full = serve(Some(file.clone()), &Method::GET, None);
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.body(), b"0123456789");
        let part = serve(Some(file.clone()), &Method::GET, Some("bytes=2-4"));
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body(), b"234");
        assert_eq!(
            part.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 2-4/10"
        );
        let past = serve(Some(file.clone()), &Method::GET, Some("bytes=20-"));
        assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        let head = serve(Some(file.clone()), &Method::HEAD, None);
        assert_eq!(head.status(), StatusCode::OK);
        assert!(head.body().is_empty());
        assert_eq!(
            serve(None, &Method::GET, None).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            serve(Some(file), &Method::POST, None).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn text_is_recognized_by_content() {
        assert!(looks_like_text(b"Hello\r\nWorld\tdone\n"));
        assert!(looks_like_text("año ñandú".as_bytes()));
        assert!(looks_like_text(&[0xFF, 0xFE, b'h', 0, b'i', 0]));
        assert!(!looks_like_text(&[b'M', b'Z', 0x90, 0, 3, 0]));
        assert!(!looks_like_text(&[1, 2, 3, 4, 5, 6, 7, 8]));
        let dir = temp_dir("text");
        let readme = dir.join("README");
        fs::write(&readme, "Read me first.\n").unwrap();
        assert_eq!(detect(&readme).unwrap().mime, "text/plain");
        let binary = dir.join("data.bin");
        fs::write(&binary, [0u8, 1, 2, 3, 0, 0, 7]).unwrap();
        assert_eq!(detect(&binary).unwrap().mime, "application/octet-stream");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extensions_and_types() {
        assert_eq!(extension_of("photo.JPG"), "jpg");
        assert_eq!(extension_of(".gitignore"), "");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        assert_eq!(extension_of("noext"), "");
        assert_eq!(mime_from_ext("svg"), "image/svg+xml");
        assert_eq!(mime_from_ext("unknown"), "application/octet-stream");
    }
}
