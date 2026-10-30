# Step 04a: File tabs, file access, file-type handlers, image viewer

| | |
|---|---|
| State | ready |
| Difficulty | ★★ |
| Branch | `step-04a-file-tabs` |
| Tag | `v0.0.7-step04a` |
| Depends on | P2 (plan v2 adopted), 03b |

## Goal

Double-clicking a picture in the Explorer opens it in a new tab next to the Explorer tab, fitted to the window, with zoom and pan. Closing the tab goes back to the Explorer exactly as it was (same folder, selection, scroll). Files the app cannot show yet open in their Windows app, as before. Open file tabs come back after a restart. This step builds the open pipeline and the handler registry (contract 13) that every later viewer plugs into.

## Do not do in this step

- No ribbon (Step 04b), no text, Markdown, audio or video viewers (04b, 04c), no "Protected view" (04c), no Settings > Default apps (04c).
- No search box on file tabs yet (04b). No Back/Forward on file tabs.
- No editing, rotating or saving images.
- Do not change how folders open, how `.lnk` shortcuts open, or any file operation.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-01, P-02, P-03, P-10, P-18, P-27, P-28), `plan/recipes/add-tauri-command.md`, `plan/recipes/add-dependency.md`, `plan/recipes/add-translation-keys.md`.
- Code: `src/App.tsx`, `src/views/ExplorerHome.tsx` (the props, `openOne`, the window key handler, the drop handler), `src-tauri/src/main.rs` (`SessionTab`, `main()`), `src-tauri/isolation/index.html`, `src-tauri/tauri.conf.json`.

## Decisions (already made)

- D1. A file's bytes reach the UI only through the custom protocol `adpfile`, at `http://adpfile.localhost/<token>/<name>`. Rust keeps one random token per open file (`file_grant`), serves byte ranges (for video later), refuses other windows, and forgets the token when the tab closes (`file_revoke`).
- D2. File type comes from the first 8 KB (`infer` crate) and the extension. A content match wins over the extension (a PNG named `.dat` opens as an image).
- D3. Handlers live in `src/handlers/`, one folder each, registered in `src/handlers/index.ts`. A handler's view is lazy-loaded. Files bigger than the handler's `maxBytes`, and types with no handler, open in the Windows default app (`open_item`).
- D4. The tab model is pure functions in `src/services/tabs.ts`. Opening a file that is already open switches to its tab. Closing the active tab activates the tab used before it.
- D5. The Explorer view stays mounted while other tabs show (it keeps its folder, selection and scroll). While hidden it ignores keyboard shortcuts and drops; this prevents, for example, Delete in another tab from deleting the Explorer's selection.
- D6. At most 8 file tabs keep their views mounted (the active one and the 7 most recently used); others mount again when activated.
- D7. Image viewer: `<img>` decoded by the browser (`decoding="async"`), fit to window (never enlarged above 100 % by "fit"), zoom steps from 5 % to 1600 %, Ctrl+wheel zooms toward the pointer, Ctrl+= / Ctrl+- / Ctrl+0 (fit), drag to pan, checkerboard behind transparency. Maximum 256 MB.
- D8. Each file tab renders its own status bar (the global status bar is hidden on file tabs).
- D9. Middle-click on a file in the list opens it in a background tab. Right-click > "Open in Windows app" opens files in their Windows app.
- D10. The session file stores file tabs with `path` and `handler`; zoom and scroll are not stored yet (Step 09a).

## Tasks

### T1 - Add the `infer` and `uuid` crates

Follow `plan/recipes/add-dependency.md`.

In `src-tauri/Cargo.toml`, find exactly:

```toml
thiserror = "2"
```

Replace with:

```toml
thiserror = "2"
infer = "0.22"
uuid = { version = "1", features = ["v4"] }
```

Records: `THIRD_PARTY_LICENSES.md` gets two bullets: `- **infer** 0.22 (MIT) - recognizes file types from their first bytes (Step 04a).` and `- **uuid** 1 (Apache-2.0 OR MIT) - random access tokens for open files (Step 04a).`; `docs/dependency-and-license-table.md` gets one row: `| File types and tokens (04a) | infer 0.22 (MIT), uuid 1 (Apache-2.0 OR MIT), both already in the lock file through Tauri, adopted in Step 04a | | |`.

**Commit:** `deps: add infer 0.22 (MIT) and uuid 1 (Apache-2.0 OR MIT) [step-04a/T1]`

### T2 - Rust: file detection, access tokens, and the `adpfile` protocol

**Files:** create `src-tauri/src/files.rs`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src-tauri/tauri.conf.json`.

Create `src-tauri/src/files.rs`:

```rust
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
use std::sync::Mutex;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, State, UriSchemeContext, UriSchemeResponder, WebviewWindow, Wry};

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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileGrant {
    pub token: String,
}

/// Live access tokens: token -> file path. Managed Tauri state.
#[derive(Default)]
pub struct FileGrants {
    map: Mutex<HashMap<String, PathBuf>>,
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
    }

    pub fn path_for(&self, token: &str) -> Option<PathBuf> {
        self.map.lock().ok().and_then(|map| map.get(token).cloned())
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
    let mime = match infer::get(&head) {
        Some(kind) => kind.mime_type().to_string(),
        None => mime_from_ext(&ext)
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .to_string(),
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
    })
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
        let path = if is_valid_token(&token) {
            app.state::<FileGrants>().path_for(&token)
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
    grants: State<'_, FileGrants>,
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
    grants: State<'_, FileGrants>,
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
    fn extensions_and_types() {
        assert_eq!(extension_of("photo.JPG"), "jpg");
        assert_eq!(extension_of(".gitignore"), "");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        assert_eq!(extension_of("noext"), "");
        assert_eq!(mime_from_ext("svg"), "image/svg+xml");
        assert_eq!(mime_from_ext("unknown"), "application/octet-stream");
    }
}
```

Then make these changes (the last two add `path: None, handler: None` to the two `SessionTab` values in the existing test `session_serde_round_trip`, which the compiler would otherwise reject):

In `src-tauri/src/main.rs`, find exactly:

```rust
mod explorer;
```

Replace with:

```rust
mod explorer;
mod files;
```

In `src-tauri/src/main.rs`, find exactly:

```rust
pub struct SessionTab {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}
```

Replace with:

```rust
pub struct SessionTab {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// File tabs (Step 04a): the file's path and the handler that shows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            watch_next_id: AtomicU64::new(0),
        })
```

Replace with:

```rust
            watch_next_id: AtomicU64::new(0),
        })
        .manage(files::FileGrants::default())
        .register_asynchronous_uri_scheme_protocol(files::SCHEME, files::protocol)
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            start_external_drag,
            create_shortcut
        ])
```

Replace with:

```rust
            start_external_drag,
            create_shortcut,
            files::file_detect,
            files::file_grant,
            files::file_revoke,
        ])
```

In `src-tauri/src/main.rs`, find exactly:

```rust
                    kind: "explorer".to_string(),
                    title: None,
                },
```

Replace with:

```rust
                    kind: "explorer".to_string(),
                    title: None,
                    path: None,
                    handler: None,
                },
```

In `src-tauri/src/main.rs`, find exactly:

```rust
                    title: Some("Getting started".to_string()),
                },
```

Replace with:

```rust
                    title: Some("Getting started".to_string()),
                    path: None,
                    handler: None,
                },
```

In `src-tauri/src/main.rs`, find exactly:

```rust
#[cfg(test)]
mod tests {
    use super::*;
```

Replace with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_keeps_file_tab_path_and_handler() {
        let json = serde_json::json!({
            "tabs": [
                { "id": "explorer", "kind": "explorer" },
                { "id": "f1", "kind": "file", "title": "a.png", "path": "C:\\Pictures\\a.png", "handler": "image" }
            ],
            "active_tab": "f1",
            "saved_unix": 1
        });
        let session: SessionState = serde_json::from_value(json).unwrap();
        assert_eq!(session.tabs[1].path.as_deref(), Some("C:\\Pictures\\a.png"));
        assert_eq!(session.tabs[1].handler.as_deref(), Some("image"));
        let back = serde_json::to_value(&session).unwrap();
        assert_eq!(back["tabs"][1]["handler"], "image");
        assert!(back["tabs"][0].get("path").is_none());
    }
```

In `src-tauri/isolation/index.html`, find exactly:

```html
'start_external_drag', 'create_shortcut'
```

Replace with:

```html
'start_external_drag', 'create_shortcut',
          'file_detect', 'file_grant', 'file_revoke'
```

In `src-tauri/tauri.conf.json`, find exactly:

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
```

Replace with:

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://adpfile.localhost; media-src 'self' blob: http://adpfile.localhost; font-src 'self' data: http://adpfile.localhost; connect-src 'self' http://adpfile.localhost; object-src 'none'; base-uri 'none'; form-action 'none'",
```

**Tests:** the 9 tests inside `files.rs` (`range_without_header_is_full`, `range_forms`, `range_past_the_end_is_unsatisfiable`, `open_ended_range_is_capped`, `tokens_are_32_lowercase_hex`, `grants_are_limited`, `detect_recognizes_content_and_reports_errors`, `serve_answers_ranges_and_refuses_unknown_tokens`, `extensions_and_types`) and `session_keeps_file_tab_path_and_handler` in `main.rs`.

**Commit:** `feat(files): file detection, access tokens and the adpfile protocol [step-04a/T2]`

### T3 - TypeScript: file access and error helpers

**Files:** create `src/services/errors.ts`, `src/services/files.ts`, `src/__tests__/errors.test.ts`; add translation keys.

Create `src/services/errors.ts`:

```ts
import type { TFunction } from "i18next";

/** Error codes from Rust look like `files.not_found` (plan/conventions.md
 * 4.2). These helpers turn a rejected `invoke` into a translated message. */

/** The raw code string of a rejected invoke, or "" when there is none. */
export function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

/** `errors.<area>.<reason>` for codes of this area, else `errors.<area>.other`. */
export function errorText(t: TFunction, error: unknown, area: string): string {
  const code = errorCode(error);
  const reason = code.startsWith(`${area}.`) ? code.slice(area.length + 1) : "other";
  return t(`errors.${area}.${reason}`, { defaultValue: t(`errors.${area}.other`) });
}
```

Create `src/services/files.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/** File access for file tabs (Step 04a). Rust gives a token per open file;
 * the bytes are served by the `adpfile` protocol (plan/pitfalls.md P-27). */

/** Mirrors Rust `files::FileTypeInfo` (snake_case fields). */
export interface FileTypeInfo {
  path: string;
  name: string;
  /** Lower-case extension without the dot; "" when there is none. */
  ext: string;
  mime: string;
  size: number;
  modified_unix: number;
  online_only: boolean;
  read_only: boolean;
}

export async function fileDetect(path: string): Promise<FileTypeInfo> {
  return (await invoke("file_detect", { path })) as FileTypeInfo;
}

export async function fileGrant(path: string): Promise<string> {
  const grant = (await invoke("file_grant", { path })) as { token: string };
  return grant.token;
}

export async function fileRevoke(token: string): Promise<void> {
  await invoke("file_revoke", { token });
}

/** URL of a granted file. On Windows, Tauri serves custom schemes at
 * http://<scheme>.localhost/. The name is only there for readability. */
export function fileUrl(token: string, name: string): string {
  return `http://adpfile.localhost/${token}/${encodeURIComponent(name)}`;
}

/** Lower-case extension of a file name, without the dot. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}
```

Create `src/__tests__/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { errorCode, errorText } from "../services/errors";
import { extensionOf, fileUrl } from "../services/files";

describe("error codes", () => {
  it("reads the code from strings and errors", () => {
    expect(errorCode("files.not_found")).toBe("files.not_found");
    expect(errorCode(new Error("files.access_denied"))).toBe("files.access_denied");
    expect(errorCode(42)).toBe("");
  });

  it("translates known reasons and falls back to the area's message", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(i18n.t, "files.not_found", "files")).toBe("This file no longer exists.");
    expect(errorText(i18n.t, "files.something_new", "files")).toBe("This file couldn't be opened.");
    expect(errorText(i18n.t, "ops.exists", "files")).toBe("This file couldn't be opened.");
  });
});

describe("file URLs", () => {
  it("uses the Windows form of the custom protocol", () => {
    expect(fileUrl("0123456789abcdef0123456789abcdef", "My photo #1.png")).toBe(
      "http://adpfile.localhost/0123456789abcdef0123456789abcdef/My%20photo%20%231.png",
    );
  });

  it("finds extensions like the Rust side", () => {
    expect(extensionOf("photo.JPG")).toBe("jpg");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("noext")).toBe("");
  });
});
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `errors.files.not_found` | This file no longer exists. | Este archivo ya no existe. |
| `errors.files.not_a_file` | This is a folder, not a file. | Esto es una carpeta, no un archivo. |
| `errors.files.access_denied` | You don't have permission to open this file. | No tienes permiso para abrir este archivo. |
| `errors.files.read_failed` | This file couldn't be read. | No se pudo leer este archivo. |
| `errors.files.too_many_open` | Too many files are open. Close some tabs and try again. | Hay demasiados archivos abiertos. Cierra algunas pestañas e inténtalo de nuevo. |
| `errors.files.invalid_request` | This file couldn't be opened. | No se pudo abrir este archivo. |
| `errors.files.other` | This file couldn't be opened. | No se pudo abrir este archivo. |

**Commit:** `feat(files): typed wrappers for file access and error codes [step-04a/T3]`

### T4 - Handler registry, open pipeline, and the image viewer

**Files:** create everything under `src/handlers/` listed below, `src/styles/filetabs.css`, `src/__tests__/handlers.test.ts`, `src/__tests__/imageZoom.test.ts`; modify `src/main.tsx`; add translation keys.

Create `src/handlers/types.ts`:

```ts
import type { LucideIcon } from "lucide-react";
import type { ComponentType, LazyExoticComponent } from "react";
import type { FileTypeInfo } from "../services/files";

/** File-type handlers (contract 13, Step 04a). A handler shows one kind of
 * file inside a file tab. Later steps add a ribbon (04b), an editor (06a)
 * and more fields; existing fields never change meaning. */

/** Suffix of the accent token: `var(--adp-accent-<accent>)`. */
export type HandlerAccent = "explorer" | "word" | "excel" | "pdf" | "image" | "powerpoint";

/** What a file tab's status bar shows (texts are already translated). */
export interface FileTabStatus {
  items: string[];
  zoom?: {
    percent: number;
    min: number;
    max: number;
    set: (percent: number) => void;
    fit: () => void;
  };
}

export interface HandlerViewProps {
  info: FileTypeInfo;
  /** Where the file's bytes are served (`fileUrl(token, name)`). */
  url: string;
  /** True while this tab is the visible one; views pause work when false. */
  active: boolean;
  /** State the view saved earlier (zoom, scroll position), or null. */
  savedState: unknown;
  /** Save small view state; it comes back as `savedState` (contract 13 tab_state). */
  onStateChange: (state: unknown) => void;
  onStatus: (status: FileTabStatus) => void;
  /** Open this file in its Windows default app (used by error states). */
  onOpenInWindowsApp: () => void;
}

export interface Handler {
  id: string;
  /** Bump when what the handler shows changes (cache keys from Step 07a). */
  version: number;
  /** Translation key of the type name, for example "handlers.image". */
  labelKey: string;
  icon: LucideIcon;
  accent: HandlerAccent;
  /** Lower-case extensions without the dot. */
  extensions: readonly string[];
  /** Content types recognized from the file's first bytes. A content match
   * wins over an extension match. */
  mimeTypes: readonly string[];
  /** Larger files open in the Windows default app instead. */
  maxBytes: number;
  helpSlug: string;
  speedTier: "fast" | "waiting";
  view: LazyExoticComponent<ComponentType<HandlerViewProps>>;
}
```

Create `src/handlers/registry.ts`:

```ts
import type { FileTypeInfo } from "../services/files";
import type { Handler } from "./types";

/** Score of a handler for a file: 80 when the file's content type is one
 * the handler lists, 50 when only the extension matches, 0 otherwise. */
export function handlerScore(handler: Handler, info: FileTypeInfo): number {
  if (handler.mimeTypes.includes(info.mime)) return 80;
  if (info.ext !== "" && handler.extensions.includes(info.ext)) return 50;
  return 0;
}

export class HandlerRegistry {
  private handlers: Handler[] = [];

  register(handler: Handler): void {
    if (this.handlers.some((existing) => existing.id === handler.id)) {
      throw new Error(`duplicate handler id: ${handler.id}`);
    }
    this.handlers.push(handler);
  }

  get(id: string): Handler | undefined {
    return this.handlers.find((handler) => handler.id === id);
  }

  list(): readonly Handler[] {
    return this.handlers;
  }

  /** The best handler for a file, or null (open it in the Windows app).
   * Ties go to the handler registered first. Files bigger than a
   * handler's `maxBytes` are not given to it. */
  pick(info: FileTypeInfo): Handler | null {
    let best: Handler | null = null;
    let bestScore = 0;
    for (const handler of this.handlers) {
      const score = handlerScore(handler, info);
      if (score > bestScore && info.size <= handler.maxBytes) {
        best = handler;
        bestScore = score;
      }
    }
    return best;
  }
}
```

Create `src/handlers/openPipeline.ts`:

```ts
import { fileDetect, type FileTypeInfo } from "../services/files";
import type { HandlerRegistry } from "./registry";
import type { Handler } from "./types";

/** The open pipeline (contract 13): detect the file, then either show it in
 * a file tab with a built-in handler, or open it in the Windows default app
 * (plan/rules.md R-OPEN). */
export type OpenDecision =
  | { kind: "tab"; handler: Handler; info: FileTypeInfo }
  | { kind: "windows"; info: FileTypeInfo };

/** Pure: what to do with a detected file. `preference` is the user's
 * choice for this extension (Settings > Default apps, Step 04c). */
export function decideOpen(
  info: FileTypeInfo,
  registry: HandlerRegistry,
  preference: "builtin" | "windows" | undefined = undefined,
): OpenDecision {
  if (preference === "windows") return { kind: "windows", info };
  const handler = registry.pick(info);
  return handler ? { kind: "tab", handler, info } : { kind: "windows", info };
}

/** Detect a file and decide. Rejects with a `files.*` code when the file
 * cannot be read (for example `files.not_found`). */
export async function planOpen(path: string, registry: HandlerRegistry): Promise<OpenDecision> {
  const info = await fileDetect(path);
  return decideOpen(info, registry);
}
```

Create `src/handlers/index.ts`:

```ts
import { imageHandler } from "./image";
import { HandlerRegistry } from "./registry";

/** Every built-in handler, in priority order for ties. Later steps add
 * theirs here (04b text and Markdown, 04c media, ...). */
export function createHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register(imageHandler);
  return registry;
}

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
```

Create `src/handlers/image/index.ts`:

```ts
import { Image } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

export const imageHandler: Handler = {
  id: "image",
  version: 1,
  labelKey: "handlers.image",
  icon: Image,
  accent: "image",
  extensions: ["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "svg", "avif"],
  mimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/avif",
    "image/svg+xml",
  ],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-images",
  speedTier: "fast",
  view: lazy(() => import("./ImageView")),
};
```

Create `src/handlers/image/zoom.ts`:

```ts
/** Zoom math for the image viewer (pure, unit-tested). Percent values. */

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 1600;
export const ZOOM_STEPS = [5, 10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1200, 1600];

export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
}

/** The percent that fits the whole image in the box, never above 100 %. */
export function fitPercent(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): number {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 100;
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight, 1);
  return clampZoom(scale * 100);
}

/** The next zoom step above (direction 1) or below (-1) the current value. */
export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((step) => step > current) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < current) ?? MIN_ZOOM;
}
```

Create `src/handlers/image/ImageView.tsx`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { formatSize } from "../../services/format";
import type { HandlerViewProps } from "../types";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "./zoom";

interface SavedImageState {
  mode: "fit" | "manual";
  percent: number;
}

function readSaved(state: unknown): SavedImageState {
  if (state !== null && typeof state === "object") {
    const value = state as Partial<SavedImageState>;
    if (value.mode === "manual" && typeof value.percent === "number") return { mode: "manual", percent: clampZoom(value.percent) };
  }
  return { mode: "fit", percent: 100 };
}

/** Image viewer (Step 04a): fit to window, zoom with Ctrl+wheel and
 * Ctrl+=/Ctrl+-/Ctrl+0, pan by dragging, checkerboard behind transparency.
 * The browser decodes the image off the main thread (`decoding="async"`). */
export default function ImageView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<SavedImageState>(() => readSaved(savedState));
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // Track the visible area so "fit" follows window resizes.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // After 1 s without the image, say what is happening (plan/rules.md R-UI-2).
  useEffect(() => {
    if (natural || failed) return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [natural, failed]);

  const percent = natural
    ? zoom.mode === "fit"
      ? fitPercent(natural.width, natural.height, box.width, box.height)
      : zoom.percent
    : 100;

  const applyZoom = useCallback(
    (next: SavedImageState) => {
      setZoom(next);
      onStateChange(next);
    },
    [onStateChange],
  );
  const setPercent = useCallback((value: number) => applyZoom({ mode: "manual", percent: clampZoom(value) }), [applyZoom]);
  const fit = useCallback(() => applyZoom({ mode: "fit", percent: 100 }), [applyZoom]);

  // Status bar: size, dimensions, zoom control.
  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({ items, zoom: natural ? { percent, min: MIN_ZOOM, max: MAX_ZOOM, set: setPercent, fit } : undefined });
  }, [info.size, i18n.language, natural, percent, onStatus, setPercent, fit, t]);

  // Keyboard zoom, only while this tab is visible and not typing.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setPercent(nextZoom(percent, 1));
      } else if (event.key === "-") {
        event.preventDefault();
        setPercent(nextZoom(percent, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, percent, setPercent, fit]);

  // Ctrl+wheel zooms around the pointer; a plain wheel scrolls. A native
  // listener, because React's wheel listener cannot cancel the event.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  const hasImage = natural !== null;
  useEffect(() => {
    const element = boxRef.current;
    if (!element || !hasImage) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left + element.scrollLeft;
      const pointerY = event.clientY - rect.top + element.scrollTop;
      const current = percentRef.current;
      const next = nextZoom(current, event.deltaY < 0 ? 1 : -1);
      const ratio = next / current;
      setPercent(next);
      requestAnimationFrame(() => {
        element.scrollLeft = pointerX * ratio - (event.clientX - rect.left);
        element.scrollTop = pointerY * ratio - (event.clientY - rect.top);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [hasImage, setPercent]);

  // Drag to pan when the image is larger than the view.
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !boxRef.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: boxRef.current.scrollLeft, top: boxRef.current.scrollTop };
  };
  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!drag.current || !boxRef.current) return;
    boxRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    boxRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (failed) {
    return (
      <div className="adp-viewer-message" role="alert">
        <p>{t("viewer.imageError")}</p>
        <Button variant="primary" onClick={onOpenInWindowsApp}>
          {t("fileTab.openInWindowsApp")}
        </Button>
      </div>
    );
  }

  const width = natural ? Math.max(1, Math.round((natural.width * percent) / 100)) : 0;
  const height = natural ? Math.max(1, Math.round((natural.height * percent) / 100)) : 0;
  return (
    <div
      ref={boxRef}
      className="adp-image-view"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {!natural ? (
        <div className="adp-image-loading" role="status" aria-label={t("components.loading")}>
          <div className="adp-skeleton-tile adp-image-skeleton" />
          {slow ? <p>{t("viewer.loadingImage")}</p> : null}
        </div>
      ) : null}
      <div className="adp-image-stage" style={natural ? { width, height } : undefined}>
        <img
          className="adp-image-checker"
          src={url}
          alt={info.name}
          decoding="async"
          draggable={false}
          style={natural ? { width, height } : { visibility: "hidden" }}
          onLoad={(event) =>
            // SVGs without a size report 0: show them at 800 x 600.
            setNatural({ width: event.currentTarget.naturalWidth || 800, height: event.currentTarget.naturalHeight || 600 })
          }
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
```

Create `src/styles/filetabs.css`:

```css
/* File tabs and viewers (Step 04a). Colors only through tokens. */
.adp-main { position: relative; }
.adp-tabpane { height: 100%; }
/* A hidden tab stays laid out, so it keeps its scroll position, but it is
   invisible and cannot be clicked or focused (display: none would reset
   the scroll position). */
.adp-tabpane[hidden], .adp-filetab[hidden] { visibility: hidden; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.adp-tabpane[hidden] { display: block; }
.adp-filetab[hidden] { display: flex; }
.adp-statusbar[hidden] { display: none; }
.adp-tab--icon-only { padding: var(--adp-space-2) var(--adp-space-3); }

.adp-filetab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.adp-filetab-nav { flex: none; display: flex; align-items: center; gap: var(--adp-space-3); min-height: 56px; padding: 0 var(--adp-space-7); border-bottom: 1px solid var(--adp-color-border-panel); }
.adp-filetab-address { flex: 1; min-width: 0; height: 34px; display: flex; align-items: center; padding: 0 var(--adp-space-3); background: var(--adp-color-surface-chrome); border-radius: var(--adp-radius-md); overflow: hidden; }
.adp-filetab-body { flex: 1; min-height: 0; position: relative; display: flex; background: var(--adp-color-surface-canvas-media); }
.adp-filetab-status { flex: none; align-items: center; }
.adp-filetab-zoom { margin-left: auto; display: inline-flex; align-items: center; gap: var(--adp-space-3); }

.adp-viewer-message { margin: auto; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: var(--adp-space-4); text-align: center; color: var(--adp-color-text-body-muted); font-size: var(--adp-font-command); }
.adp-viewer-detail { color: var(--adp-color-text-secondary); font-size: var(--adp-font-body); word-break: break-all; }

.adp-image-view { flex: 1; min-width: 0; overflow: auto; display: grid; place-items: center; cursor: grab; }
.adp-image-view:active { cursor: grabbing; }
.adp-image-stage { flex: none; }
.adp-image-checker {
  display: block;
  box-shadow: var(--adp-shadow-image);
  background-color: var(--adp-color-surface-window);
  background-image:
    linear-gradient(45deg, var(--adp-color-surface-selected) 25%, transparent 25%),
    linear-gradient(-45deg, var(--adp-color-surface-selected) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--adp-color-surface-selected) 75%),
    linear-gradient(-45deg, transparent 75%, var(--adp-color-surface-selected) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.adp-image-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--adp-space-4); color: var(--adp-color-text-secondary); }
.adp-image-skeleton { width: 320px; height: 220px; }
```

Create `src/__tests__/handlers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHandlerRegistry } from "../handlers";
import { decideOpen } from "../handlers/openPipeline";
import type { FileTypeInfo } from "../services/files";

const info = (name: string, mime: string, size = 1000): FileTypeInfo => ({
  path: `C:\\${name}`,
  name,
  ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
  mime,
  size,
  modified_unix: 0,
  online_only: false,
  read_only: false,
});

describe("handler registry", () => {
  const registry = createHandlerRegistry();

  it("opens images in the image handler", () => {
    expect(registry.pick(info("a.png", "image/png"))?.id).toBe("image");
    expect(registry.pick(info("b.JPG".toLowerCase(), "image/jpeg"))?.id).toBe("image");
    expect(registry.pick(info("c.svg", "image/svg+xml"))?.id).toBe("image");
  });

  it("recognizes an image by its content even with another extension", () => {
    expect(registry.pick(info("photo.dat", "image/png"))?.id).toBe("image");
  });

  it("leaves unknown types to the Windows app", () => {
    expect(registry.pick(info("setup.exe", "application/vnd.microsoft.portable-executable"))).toBeNull();
    expect(decideOpen(info("setup.exe", "application/octet-stream"), registry).kind).toBe("windows");
  });

  it("sends files over the size limit to the Windows app", () => {
    expect(decideOpen(info("huge.png", "image/png", 300 * 1024 * 1024), registry).kind).toBe("windows");
  });

  it("follows a 'windows' preference", () => {
    expect(decideOpen(info("a.png", "image/png"), registry, "windows").kind).toBe("windows");
  });

  it("refuses duplicate handler ids", () => {
    const fresh = createHandlerRegistry();
    expect(() => fresh.register(fresh.get("image")!)).toThrow();
  });
});
```

Create `src/__tests__/imageZoom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "../handlers/image/zoom";

describe("image zoom", () => {
  it("fits large images and never enlarges small ones", () => {
    expect(fitPercent(4000, 2000, 1000, 1000)).toBe(25);
    expect(fitPercent(100, 100, 1000, 1000)).toBe(100);
    expect(fitPercent(0, 100, 1000, 1000)).toBe(100);
  });

  it("steps between zoom levels", () => {
    expect(nextZoom(100, 1)).toBe(125);
    expect(nextZoom(100, -1)).toBe(75);
    expect(nextZoom(110, -1)).toBe(100);
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("clamps any value", () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(99999)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(100);
  });
});
```

In `src/main.tsx`, find exactly:

```tsx
import "./styles/components.css";
```

Replace with:

```tsx
import "./styles/components.css";
import "./styles/filetabs.css";
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `handlers.image` | Image | Imagen |
| `viewer.loadingImage` | Loading image… | Cargando imagen… |
| `viewer.imageError` | This image couldn't be shown. It may be damaged, or in a format the viewer doesn't support. | No se pudo mostrar esta imagen. Puede estar dañada o en un formato que el visor no admite. |
| `viewer.dimensions` | {width} × {height} px | {width} × {height} px |
| `viewer.zoom` | Zoom | Zoom |
| `viewer.fit` | Fit | Ajustar |

**Commit:** `feat(viewer): handler registry, open pipeline and the image viewer [step-04a/T4]`

### T5 - The tab model

**Files:** create `src/services/tabs.ts`, `src/__tests__/tabs.test.ts`.

Create `src/services/tabs.ts`:

```ts
/** The tab model (Step 04a): which tabs exist, which one is active, and the
 * order tabs were used in (closing a tab returns to the one used before).
 * Pure functions only, so every rule is unit-tested. `App.tsx` holds one
 * `TabsState` and replaces it with the result of these functions. */

export type TabKind = "explorer" | "help" | "settings" | "gallery" | "file";

export interface TabState {
  id: string;
  kind: TabKind;
  title?: string;
  /** File tabs: the file's path as the Explorer showed it. */
  path?: string;
  /** File tabs: the handler id that shows the file. */
  handler?: string;
  /** File tabs: small view state from the handler (zoom, scroll). */
  view?: unknown;
}

export interface TabsState {
  tabs: TabState[];
  activeId: string;
  /** Tab ids in the order they were activated, oldest first. */
  history: string[];
}

/** What `session.json` stores (Rust `SessionState`). */
export interface SessionData {
  tabs: { id: string; kind: string; title?: string; path?: string; handler?: string }[];
  active_tab: string;
  saved_unix: number;
}

export const EXPLORER_TAB: TabState = { id: "explorer", kind: "explorer" };
const SINGLE_KINDS: TabKind[] = ["help", "settings", "gallery"];
const HISTORY_LIMIT = 50;

let idCounter = 0;
/** A new unique tab id such as "file-lx3k9a-1". */
export function newTabId(kind: TabKind): string {
  idCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${idCounter}`;
}

export function initialTabs(): TabsState {
  return { tabs: [EXPLORER_TAB], activeId: EXPLORER_TAB.id, history: [EXPLORER_TAB.id] };
}

function samePathText(a: string, b: string): boolean {
  const plain = (path: string) => path.replace(/^\\\\\?\\/, "").toLowerCase();
  return plain(a) === plain(b);
}

/** Make `id` the active tab and remember it in the history. */
export function activateTab(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((tab) => tab.id === id)) return state;
  const history = [...state.history.filter((entry) => entry !== id), id].slice(-HISTORY_LIMIT);
  return { ...state, activeId: id, history };
}

/** Open the single Help, Settings, or Gallery tab, or switch to it. */
export function openSingleTab(state: TabsState, kind: "help" | "settings" | "gallery"): TabsState {
  const existing = state.tabs.find((tab) => tab.kind === kind);
  if (existing) return activateTab(state, existing.id);
  const tab: TabState = { id: newTabId(kind), kind };
  return activateTab({ ...state, tabs: [...state.tabs, tab] }, tab.id);
}

/** Open a file in a tab. The same file with the same handler reuses its
 * tab. `background` keeps the current tab active. New tabs go at the end. */
export function openFileTab(
  state: TabsState,
  file: { path: string; handler: string; title: string },
  background: boolean,
): TabsState {
  const existing = state.tabs.find(
    (tab) => tab.kind === "file" && tab.handler === file.handler && tab.path !== undefined && samePathText(tab.path, file.path),
  );
  if (existing) return background ? state : activateTab(state, existing.id);
  const tab: TabState = { id: newTabId("file"), kind: "file", path: file.path, handler: file.handler, title: file.title };
  const next = { ...state, tabs: [...state.tabs, tab] };
  return background ? next : activateTab(next, tab.id);
}

/** Close a tab (never the Explorer tab). If it was active, the most
 * recently used remaining tab becomes active. */
export function closeTab(state: TabsState, id: string): TabsState {
  if (id === EXPLORER_TAB.id || !state.tabs.some((tab) => tab.id === id)) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId, history };
  const previous = [...history].reverse().find((entry) => tabs.some((tab) => tab.id === entry));
  return activateTab({ tabs, activeId: EXPLORER_TAB.id, history }, previous ?? EXPLORER_TAB.id);
}

/** Store a file tab's view state (from `HandlerViewProps.onStateChange`). */
export function setTabView(state: TabsState, id: string, view: unknown): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, view } : tab)) };
}

/** Rebuild tabs from a stored session. Unknown or broken entries are
 * dropped; the Explorer tab always comes first and exactly once. */
export function tabsFromSession(input: unknown, knownHandlers: readonly string[]): TabsState {
  const raw =
    input !== null && typeof input === "object" && Array.isArray((input as SessionData).tabs)
      ? ((input as SessionData).tabs as unknown[])
      : [];
  const seen = new Set<string>([EXPLORER_TAB.id]);
  const tabs: TabState[] = [EXPLORER_TAB];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = candidate.id;
    const kind = candidate.kind;
    if (typeof id !== "string" || seen.has(id)) continue;
    const title = typeof candidate.title === "string" ? candidate.title : undefined;
    if (kind === "file") {
      const path = candidate.path;
      const handler = candidate.handler;
      if (typeof path !== "string" || path === "" || typeof handler !== "string" || !knownHandlers.includes(handler)) continue;
      tabs.push({ id, kind: "file", path, handler, title });
    } else if (SINGLE_KINDS.includes(kind as TabKind) && !tabs.some((tab) => tab.kind === kind)) {
      tabs.push({ id, kind: kind as TabKind, title });
    } else {
      continue;
    }
    seen.add(id);
  }
  const stored =
    input !== null && typeof input === "object" ? (input as SessionData).active_tab : undefined;
  const activeId = typeof stored === "string" && tabs.some((tab) => tab.id === stored) ? stored : EXPLORER_TAB.id;
  const history = activeId === EXPLORER_TAB.id ? [EXPLORER_TAB.id] : [EXPLORER_TAB.id, activeId];
  return { tabs, activeId, history };
}

/** What to write to `session.json`. View state is not stored yet (Step 09a). */
export function sessionFromTabs(state: TabsState, nowUnix: number): SessionData {
  return {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      path: tab.path,
      handler: tab.handler,
    })),
    active_tab: state.activeId,
    saved_unix: nowUnix,
  };
}

/** Ids of file tabs whose views stay mounted: the active tab plus the most
 * recently used ones, up to `limit`. Others are unmounted to save memory
 * and mount again when activated. */
export function mountedFileTabs(state: TabsState, limit = 8): Set<string> {
  const fileIds = new Set(state.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.id));
  const recent = [...state.history].reverse().filter((id) => fileIds.has(id));
  const keep = new Set(recent.slice(0, limit));
  if (fileIds.has(state.activeId)) keep.add(state.activeId);
  return keep;
}
```

Create `src/__tests__/tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EXPLORER_TAB,
  activateTab,
  closeTab,
  initialTabs,
  mountedFileTabs,
  openFileTab,
  openSingleTab,
  sessionFromTabs,
  tabsFromSession,
} from "../services/tabs";

const file = (path: string, handler = "image") => ({ path, handler, title: path.split("\\").pop() ?? path });

describe("tab model", () => {
  it("opens a file tab, switches to it, and returns to the Explorer on close", () => {
    let state = initialTabs();
    state = openFileTab(state, file("C:\\a.png"), false);
    expect(state.tabs).toHaveLength(2);
    const id = state.activeId;
    expect(state.tabs[1]).toMatchObject({ kind: "file", path: "C:\\a.png", handler: "image" });
    state = closeTab(state, id);
    expect(state.activeId).toBe(EXPLORER_TAB.id);
    expect(state.tabs).toHaveLength(1);
  });

  it("reuses the tab of a file that is already open (ignoring case and \\\\?\\)", () => {
    let state = openFileTab(initialTabs(), file("C:\\Photos\\a.png"), false);
    const first = state.activeId;
    state = activateTab(state, EXPLORER_TAB.id);
    state = openFileTab(state, file("\\\\?\\c:\\photos\\A.PNG"), false);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(first);
  });

  it("opens background tabs without switching", () => {
    const state = openFileTab(initialTabs(), file("C:\\a.png"), true);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(EXPLORER_TAB.id);
  });

  it("closing the active tab returns to the tab used before it", () => {
    let state = openFileTab(initialTabs(), file("C:\\a.png"), false);
    const a = state.activeId;
    state = openFileTab(state, file("C:\\b.png"), false);
    const b = state.activeId;
    state = openSingleTab(state, "settings");
    state = activateTab(state, a);
    state = activateTab(state, b);
    state = closeTab(state, b);
    expect(state.activeId).toBe(a);
  });

  it("never closes the Explorer tab", () => {
    const state = closeTab(initialTabs(), EXPLORER_TAB.id);
    expect(state.tabs).toEqual([EXPLORER_TAB]);
  });

  it("keeps one Help, Settings, and Gallery tab each", () => {
    let state = openSingleTab(initialTabs(), "help");
    state = openSingleTab(state, "help");
    expect(state.tabs.filter((tab) => tab.kind === "help")).toHaveLength(1);
  });

  it("restores file tabs from a session and drops broken entries", () => {
    const session = {
      tabs: [
        { id: "explorer", kind: "explorer" },
        { id: "f1", kind: "file", path: "C:\\a.png", handler: "image", title: "a.png" },
        { id: "f2", kind: "file", path: "C:\\b.xyz", handler: "unknown-handler" },
        { id: "f3", kind: "file", handler: "image" },
        { id: "h1", kind: "help" },
        { id: "h2", kind: "help" },
        { id: "x", kind: "bogus" },
      ],
      active_tab: "f1",
      saved_unix: 1,
    };
    const state = tabsFromSession(session, ["image"]);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["explorer", "f1", "h1"]);
    expect(state.activeId).toBe("f1");
  });

  it("falls back to the Explorer when the session is missing or broken", () => {
    expect(tabsFromSession(null, ["image"]).tabs).toEqual([EXPLORER_TAB]);
    expect(tabsFromSession({ tabs: "nope" }, ["image"]).activeId).toBe("explorer");
  });

  it("writes file paths and handlers to the session", () => {
    const state = openFileTab(initialTabs(), file("C:\\a.png"), false);
    const session = sessionFromTabs(state, 42);
    expect(session.tabs[1]).toMatchObject({ kind: "file", path: "C:\\a.png", handler: "image" });
    expect(session.active_tab).toBe(state.activeId);
    expect(session.saved_unix).toBe(42);
  });

  it("keeps the active and the most recent file tabs mounted", () => {
    let state = initialTabs();
    for (let index = 0; index < 10; index += 1) state = openFileTab(state, file(`C:\\${index}.png`), false);
    const mounted = mountedFileTabs(state, 8);
    expect(mounted.size).toBe(8);
    expect(mounted.has(state.activeId)).toBe(true);
    expect(mounted.has(state.tabs[1].id)).toBe(false);
  });
});
```

**Commit:** `feat(tabs): pure tab model with file tabs and session restore [step-04a/T5]`

### T6 - Help pages

**Files:** create the four help pages below exactly as given.

Create `help/en/opening-files.md`:

```markdown
# Opening files in tabs

Double-click a file (or select it and press **Enter**) to open it in a new tab next to the Explorer tab. Files the app can show open in a tab; every other file opens in the app Windows uses for it.

## Working with file tabs

- Each file opens in its own tab, with the file's type icon and name. Opening a file that is already open switches to its tab.
- **Middle-click** a file to open it in a tab in the background, without leaving the Explorer.
- Close a tab with its **×** button, a middle-click on the tab, or **Ctrl+W**. You go back to the tab you were using before.
- The Explorer tab is always there. While files are open it shrinks to a small house icon, and it remembers the folder, selection and scroll position you left it with.

## The navigation row in a file tab

- **Show in folder** (the up arrow, **Alt+Up**) opens the file's folder in the Explorer tab and selects the file.
- Click a folder in the path to open that folder in the Explorer tab.
- **Reload** (**F5**) shows the file again after another app changed it.

## Opening a file in another app

- Right-click a file and choose **Open in Windows app** to use the app Windows has for that type.
- **Open with…** lets you pick a different app.
- Very large files, and types the app doesn't show yet, always open in the Windows app.

## Good to know

- Opening a file never changes it.
- If a file was moved or deleted while its tab was closed, the tab says so and offers to open the folder where it was.
- Your open file tabs come back when you start the app again.

See also: "Viewing images" and "Browsing folders".
```

Create `help/es/opening-files.md`:

```markdown
# Abrir archivos en pestañas

Haz doble clic en un archivo (o selecciónalo y pulsa **Entrar**) para abrirlo en una pestaña nueva junto a la pestaña del Explorador. Los archivos que la aplicación puede mostrar se abren en una pestaña; los demás se abren en la aplicación que Windows usa para ellos.

## Trabajar con pestañas de archivo

- Cada archivo se abre en su propia pestaña, con el icono de su tipo y su nombre. Si abres un archivo que ya está abierto, se cambia a su pestaña.
- Haz **clic con el botón central** en un archivo para abrirlo en una pestaña en segundo plano, sin salir del Explorador.
- Cierra una pestaña con su botón **×**, con un clic central en la pestaña o con **Ctrl+W**. Vuelves a la pestaña que usabas antes.
- La pestaña del Explorador siempre está ahí. Mientras hay archivos abiertos se reduce a un pequeño icono de casa, y recuerda la carpeta, la selección y la posición en la que la dejaste.

## La fila de navegación en una pestaña de archivo

- **Mostrar en la carpeta** (la flecha hacia arriba, **Alt+Flecha arriba**) abre la carpeta del archivo en la pestaña del Explorador y selecciona el archivo.
- Haz clic en una carpeta de la ruta para abrirla en la pestaña del Explorador.
- **Volver a cargar** (**F5**) vuelve a mostrar el archivo después de que otra aplicación lo cambió.

## Abrir un archivo en otra aplicación

- Haz clic con el botón derecho en un archivo y elige **Abrir en la aplicación de Windows** para usar la aplicación que Windows tiene para ese tipo.
- **Abrir con…** te permite elegir otra aplicación.
- Los archivos muy grandes y los tipos que la aplicación todavía no muestra siempre se abren en la aplicación de Windows.

## Para tener en cuenta

- Abrir un archivo nunca lo cambia.
- Si un archivo se movió o se eliminó mientras su pestaña estaba cerrada, la pestaña lo indica y ofrece abrir la carpeta donde estaba.
- Tus pestañas de archivo vuelven a aparecer cuando inicias la aplicación otra vez.

Consulta también: «Ver imágenes» y «Explorar carpetas».
```

Create `help/en/viewing-images.md`:

```markdown
# Viewing images

Pictures open in a tab: PNG, JPG, GIF (animated too), WebP, BMP, ICO, SVG and AVIF.

## Zoom and move around

- The picture fits the window when it opens. Small pictures are shown at their real size.
- Zoom in and out with **Ctrl** and the mouse wheel (it zooms toward the pointer), **Ctrl++** and **Ctrl+-**, or the zoom slider in the status bar.
- **Ctrl+0** or **Fit** in the status bar fits the whole picture in the window again.
- When the picture is bigger than the window, drag it with the mouse to move around.

## Good to know

- The status bar shows the picture's size in pixels and the file size.
- A checkerboard shows through transparent parts.
- Viewing never changes the file. Editing pictures arrives in a later update.
- If a picture can't be shown (for example a damaged file), use **Open in Windows app**.

See also: "Opening files in tabs".
```

Create `help/es/viewing-images.md`:

```markdown
# Ver imágenes

Las imágenes se abren en una pestaña: PNG, JPG, GIF (también animados), WebP, BMP, ICO, SVG y AVIF.

## Acercar y moverse

- La imagen se ajusta a la ventana al abrirse. Las imágenes pequeñas se muestran a su tamaño real.
- Acerca y aleja con **Ctrl** y la rueda del mouse (acerca hacia el puntero), con **Ctrl++** y **Ctrl+-**, o con el control de zoom de la barra de estado.
- **Ctrl+0** o **Ajustar** en la barra de estado vuelve a mostrar la imagen completa en la ventana.
- Cuando la imagen es más grande que la ventana, arrástrala con el mouse para moverte.

## Para tener en cuenta

- La barra de estado muestra el tamaño de la imagen en píxeles y el tamaño del archivo.
- Las partes transparentes se ven con un fondo de cuadros.
- Ver una imagen nunca cambia el archivo. La edición de imágenes llegará en una actualización posterior.
- Si una imagen no se puede mostrar (por ejemplo, un archivo dañado), usa **Abrir en la aplicación de Windows**.

Consulta también: «Abrir archivos en pestañas».
```

**Commit:** `docs(help): opening files in tabs and viewing images [step-04a/T6]`

### T7 - The file tab view

**Files:** create `src/views/FileTabView.tsx`; add translation keys.

What it does: when it mounts it detects the file and asks for a token; it gives the token back when it unmounts or reloads (pitfall P-28). It shows a skeleton while loading, a "moved or deleted" state with Open folder and Close tab, an error state with Open in Windows app, or the handler's view. Its status bar shows what the handler reports (`onStatus`), plus Fit and the zoom slider when the handler reports a zoom.

Create `src/views/FileTabView.tsx`:

```tsx
import { ArrowUp, FileQuestion, RotateCw } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import Skeleton from "../components/Skeleton";
import Slider from "../components/Slider";
import { handlers } from "../handlers";
import type { FileTabStatus } from "../handlers/types";
import { errorCode, errorText } from "../services/errors";
import { displayPath, openItem, parentPathOf, pathSegments } from "../services/explorer";
import { fileDetect, fileGrant, fileRevoke, fileUrl, type FileTypeInfo } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import type { TabState } from "../services/tabs";

export interface FileTabViewProps {
  tab: TabState;
  active: boolean;
  /** Show the file in the Explorer tab (folder opened, file selected). */
  onShowInFolder: (path: string) => void;
  /** Open a folder in the Explorer tab (breadcrumb segments). */
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
  onViewState: (state: unknown) => void;
  onOpenHelp: (slug: string) => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: FileTypeInfo; token: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** One file tab (Step 04a): navigation row, the handler's view, and the
 * file tab's own status bar. Gets a file token when it mounts and gives it
 * back when it unmounts (plan/pitfalls.md P-28). */
export default function FileTabView({ tab, active, onShowInFolder, onOpenFolder, onClose, onViewState, onOpenHelp }: FileTabViewProps) {
  const { t } = useTranslation();
  const path = tab.path ?? "";
  const handler = tab.handler ? handlers.get(tab.handler) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<FileTabStatus>({ items: [] });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isTauriRuntime() || !path) return;
    let cancelled = false;
    let token: string | null = null;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const info = await fileDetect(path);
        const granted = await fileGrant(path);
        if (cancelled) {
          void fileRevoke(granted).catch(() => undefined);
          return;
        }
        token = granted;
        setPhase({ kind: "ready", info, token: granted });
      } catch (error) {
        if (cancelled) return;
        if (errorCode(error) === "files.not_found") setPhase({ kind: "missing" });
        else setPhase({ kind: "error", message: errorText(t, error, "files") });
      }
    })();
    return () => {
      cancelled = true;
      if (token) void fileRevoke(token).catch(() => undefined);
    };
  }, [path, reloadKey, t]);

  const openInWindowsApp = useCallback(() => {
    if (isTauriRuntime()) void openItem(path).catch(() => undefined);
  }, [path]);

  const folder = parentPathOf(path);
  const segments = pathSegments(path).map((segment, index, all) => ({
    id: index === all.length - 1 ? "" : segment.path,
    label: segment.label,
  }));
  return (
    <div className="adp-filetab" hidden={!active}>
      <div className="adp-filetab-nav">
        <IconButton icon={ArrowUp} labelKey="fileTab.showInFolder" shortcut="Alt+Up" onClick={() => onShowInFolder(path)} />
        <IconButton icon={RotateCw} labelKey="fileTab.reload" shortcut="F5" onClick={() => setReloadKey((value) => value + 1)} />
        <div className="adp-filetab-address">
          <Breadcrumb segments={segments} onNavigate={(id) => (id ? onOpenFolder(id) : undefined)} />
        </div>
        <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "opening-files")} />
      </div>
      <div className="adp-filetab-body">
        {phase.kind === "loading" ? <Skeleton variant="tiles" count={1} /> : null}
        {phase.kind === "missing" ? (
          <div className="adp-viewer-message" role="alert">
            <FileQuestion size={32} aria-hidden="true" />
            <p>{t("fileTab.notFoundTitle")}</p>
            {folder ? <p className="adp-viewer-detail">{t("fileTab.notFoundBody", { folder: displayPath(folder) })}</p> : null}
            <div className="adp-dialog-actions">
              {folder ? <Button onClick={() => onOpenFolder(folder)}>{t("fileTab.openFolder")}</Button> : null}
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          </div>
        ) : null}
        {phase.kind === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{phase.message}</p>
            <Button variant="primary" onClick={openInWindowsApp}>
              {t("fileTab.openInWindowsApp")}
            </Button>
          </div>
        ) : null}
        {phase.kind === "ready" && handler ? (
          <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
            <handler.view
              key={phase.token}
              info={phase.info}
              url={fileUrl(phase.token, phase.info.name)}
              active={active}
              savedState={tab.view ?? null}
              onStateChange={onViewState}
              onStatus={setStatus}
              onOpenInWindowsApp={openInWindowsApp}
            />
          </Suspense>
        ) : null}
      </div>
      <footer className="adp-statusbar adp-filetab-status">
        {status.items.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {status.zoom ? (
          <span className="adp-filetab-zoom">
            <Button variant="subtle" onClick={status.zoom.fit}>
              {t("viewer.fit")}
            </Button>
            <Slider
              value={status.zoom.percent}
              min={status.zoom.min}
              max={status.zoom.max}
              label={t("viewer.zoom")}
              onChange={status.zoom.set}
            />
          </span>
        ) : null}
      </footer>
    </div>
  );
}
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `tabs.file` | File | Archivo |
| `fileTab.showInFolder` | Show in folder | Mostrar en la carpeta |
| `fileTab.reload` | Reload | Volver a cargar |
| `fileTab.notFoundTitle` | This file was moved or deleted. | Este archivo se movió o se eliminó. |
| `fileTab.notFoundBody` | It was in {folder} | Estaba en {folder} |
| `fileTab.openFolder` | Open folder | Abrir carpeta |
| `fileTab.openInWindowsApp` | Open in Windows app | Abrir en la aplicación de Windows |

**Commit:** `feat(tabs): the file tab view with its navigation row and status bar [step-04a/T7]`

### T8 - Explorer: open files through the pipeline; ignore keys and drops while hidden

**Files:** modify `src/views/ExplorerHome.tsx`, `src/views/explorer/AddressBar.tsx`, `src/views/explorer/FileList.tsx`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`; create `src/__tests__/explorerActive.test.tsx`; add a translation key.

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
export interface ExplorerHomeProps {
  onStatsChange?: (stats: ExplorerStats) => void;
  onOpenHelp: (slug?: string) => void;
```

Replace with:

```tsx
/** Ask the Explorer to open a folder (and select one item in it). A new
 * `nonce` makes the same request run again. */
export interface ExplorerNavigateRequest {
  folder: string;
  select: string | null;
  nonce: number;
}

export interface ExplorerHomeProps {
  /** False while another tab is shown: shortcuts and drops are ignored. */
  active?: boolean;
  onStatsChange?: (stats: ExplorerStats) => void;
  onOpenHelp: (slug?: string) => void;
  /** Open a file through the app's open pipeline (Step 04a). Rejects with
   * a `files.*` error code. Without it, files open in their Windows app. */
  onOpenFile?: (path: string, background: boolean) => Promise<void>;
  navigateRequest?: ExplorerNavigateRequest | null;
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
export default function ExplorerHome({ onStatsChange, onOpenHelp, view: viewProp, onViewChange, pasteImageFormat = "png" }: ExplorerHomeProps) {
  const { t, i18n } = useTranslation();
```

Replace with:

```tsx
export default function ExplorerHome({
  active = true,
  onStatsChange,
  onOpenHelp,
  onOpenFile,
  navigateRequest = null,
  view: viewProp,
  onViewChange,
  pasteImageFormat = "png",
}: ExplorerHomeProps) {
  const { t, i18n } = useTranslation();
  const activeRef = useRef(active);
  activeRef.current = active;
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
  const openOne = useCallback(
    (item: ExplorerItem) => {
      if (item.kind === "folder" || item.kind === "drive") {
        goToFolder(item.path);
        return;
      }
      if (!isTauriRuntime()) return;
      openItem(item.path)
```

Replace with:

```tsx
  const openOne = useCallback(
    (item: ExplorerItem, background = false) => {
      if (item.kind === "folder" || item.kind === "drive") {
        goToFolder(item.path);
        return;
      }
      if (!isTauriRuntime()) return;
      // Files open in the app's tabs (Step 04a); shortcuts keep the Windows
      // path because a shortcut to a folder opens that folder here.
      if (onOpenFile && !item.name.toLowerCase().endsWith(".lnk")) {
        onOpenFile(item.path, background).catch((error: unknown) => notifyError(error, "files"));
        return;
      }
      openItem(item.path)
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
    [goToFolder, notifyError],
  );
```

Replace with:

```tsx
    [goToFolder, notifyError, onOpenFile],
  );

  // "Show in folder" and breadcrumbs from file tabs (Step 04a).
  useEffect(() => {
    if (!navigateRequest) return;
    pendingSelectRef.current = navigateRequest.select;
    goToFolder(navigateRequest.folder);
    // Only a new request (new nonce) navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest?.nonce]);
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const ctrl = event.ctrlKey || event.metaKey;
```

Replace with:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Hidden behind another tab: never act on the Explorer's selection.
      if (!activeRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const ctrl = event.ctrlKey || event.metaKey;
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
          if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
```

Replace with:

```tsx
          if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
          // Hidden behind another tab: a drop must not land in this folder.
          if (!activeRef.current) return;
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
        editablePath={location.type === "folder" ? location.path : null}
```

Replace with:

```tsx
        editablePath={location.type === "folder" ? location.path : null}
        shortcutsEnabled={active}
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
    onOpen: openOne,
    onContextMenu: openContextMenu,
```

Replace with:

```tsx
    onOpen: openOne,
    onOpenInBackground: (item: ExplorerItem) => openOne(item, true),
    onContextMenu: openContextMenu,
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
      openWith: () => {
        const paths = live.current.selectedPaths;
```

Replace with:

```tsx
      openInWindowsApp: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        if (!isTauriRuntime()) return;
        for (const path of files.slice(0, OPEN_LIMIT)) void openItem(path).catch((error: unknown) => notifyError(error, "open"));
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openWith: () => {
        const paths = live.current.selectedPaths;
```

In `src/views/explorer/AddressBar.tsx`, find exactly:

```tsx
  editablePath: string | null;
```

Replace with:

```tsx
  editablePath: string | null;
  /** False while the Explorer is hidden behind another tab. */
  shortcutsEnabled?: boolean;
```

In `src/views/explorer/AddressBar.tsx`, find exactly:

```tsx
      if (!isAddressShortcut || props.editablePath === null) return;
```

Replace with:

```tsx
      if (!isAddressShortcut || props.editablePath === null || props.shortcutsEnabled === false) return;
```

In `src/views/explorer/AddressBar.tsx`, find exactly:

```tsx
  }, [props.editablePath]);
```

Replace with:

```tsx
  }, [props.editablePath, props.shortcutsEnabled]);
```

In `src/views/explorer/FileList.tsx`, find exactly:

```tsx
  onOpen: (item: ExplorerItem) => void;
```

Replace with:

```tsx
  onOpen: (item: ExplorerItem) => void;
  /** Middle-click on a file: open it in a background tab (Step 04a). */
  onOpenInBackground?: (item: ExplorerItem) => void;
```

In `src/views/explorer/FileList.tsx`, find exactly:

```tsx
        onContextMenu={(event) => onRowContextMenu(event, item)}
      >
```

Replace with:

```tsx
        onContextMenu={(event) => onRowContextMenu(event, item)}
        onAuxClick={(event) => {
          if (event.button === 1 && item.kind === "file") props.onOpenInBackground?.(item);
        }}
      >
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
  openWith: () => void;
```

Replace with:

```ts
  openWith: () => void;
  /** Open the selected files in their Windows default apps (Step 04a). */
  openInWindowsApp: () => void;
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
    {
      id: "explorer.openWith",
```

Replace with:

```ts
    {
      id: "explorer.openInWindowsApp",
      labelKey: "commands.openInWindowsApp",
      icon: ExternalLink,
      risk: "read-only",
      helpSlug: "opening-files",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openInWindowsApp(),
    },
    {
      id: "explorer.openWith",
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
  Eye,
```

Replace with:

```ts
  ExternalLink,
  Eye,
```

In `src/commands/menus.ts`, find exactly:

```ts
  cmd("explorer.open"),
  cmd("explorer.openWith"),
```

Replace with:

```ts
  cmd("explorer.open"),
  cmd("explorer.openInWindowsApp"),
  cmd("explorer.openWith"),
```

Create `src/__tests__/explorerActive.test.tsx`:

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import ExplorerHome from "../views/ExplorerHome";

/** Step 04a: the Explorer stays mounted behind file tabs. While hidden it
 * must ignore window shortcuts, or Delete in another tab would act on the
 * Explorer's selection. Alt+Shift+P (Details pane) shows the gate. */
describe("Explorer behind another tab", () => {
  const pressDetailsShortcut = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "P", altKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  it("ignores shortcuts while hidden and handles them again when shown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onViewChange = vi.fn();
    await act(async () => {
      root.render(<ExplorerHome active={false} onOpenHelp={() => undefined} onViewChange={onViewChange} />);
    });
    await act(async () => pressDetailsShortcut());
    expect(onViewChange).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<ExplorerHome active={true} onOpenHelp={() => undefined} onViewChange={onViewChange} />);
    });
    await act(async () => pressDetailsShortcut());
    expect(onViewChange).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    container.remove();
  });
});
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `commands.openInWindowsApp` | Open in Windows app | Abrir en la aplicación de Windows |

**Tests:** `explorerActive.test.tsx` fails if the window key handler does not check `activeRef` (this protects the Explorer's selection while another tab is visible). The existing `commands.test.ts` checks that `explorer.openInWindowsApp` has a help page.

**Commit:** `feat(explorer): open files in tabs, Open in Windows app, and no shortcuts or drops while hidden [step-04a/T8]`

### T9 - App: file tabs in the tab bar, the Explorer kept alive, the open pipeline

**Files:** replace `src/App.tsx`.

Guard first (`plan/pitfalls.md` P-29): run `git hash-object src/App.tsx`. It must print `1d5cc307462d942ff58cafbdc00050930a9278cb` (the `App.tsx` this step was written for). If it prints anything else, `App.tsx` changed after this plan was written: stop with `BLOCKED.md` (do not merge by hand). If it prints exactly that, replace the whole file with:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleHelp, Copy, Home, LayoutGrid, Minus, Plus, Settings as SettingsIcon, Square, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "./components/DropdownMenu";
import IconButton from "./components/IconButton";
import { applyLanguage } from "./i18n";
import {
  defaultSettings,
  isTauriRuntime,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "./services/settings";
import { formatSize } from "./services/format";
import { handlers } from "./handlers";
import { planOpen } from "./handlers/openPipeline";
import { openItem, parentPathOf } from "./services/explorer";
import {
  activateTab,
  closeTab as closeTabIn,
  initialTabs,
  mountedFileTabs,
  openFileTab,
  openSingleTab,
  sessionFromTabs,
  setTabView,
  tabsFromSession,
  type TabKind,
  type TabState,
  type TabsState,
} from "./services/tabs";
import ExplorerHome, { type ExplorerNavigateRequest, type ExplorerStats } from "./views/ExplorerHome";
import FileTabView from "./views/FileTabView";
const GalleryView = lazy(() => import("./views/GalleryView"));
const HelpCenter = lazy(() => import("./views/HelpCenter"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const SESSION_KEY = "adperastra-session";
const HELP_SLUGS: Record<TabKind, string> = {
  explorer: "browsing-folders",
  settings: "changing-language-and-theme",
  help: "using-help",
  gallery: "using-help",
  file: "opening-files",
};

export default function App() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const [tabsState, setTabsState] = useState<TabsState>(() => initialTabs());
  const { tabs, activeId } = tabsState;
  const [navigateRequest, setNavigateRequest] = useState<ExplorerNavigateRequest | null>(null);
  const [helpSlug, setHelpSlug] = useState("getting-started");
  const [showKeyTips, setShowKeyTips] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);
  const [explorerStats, setExplorerStats] = useState<ExplorerStats>({ total: 0, selected: 0, selectedBytes: 0, selectedFiles: 0 });
  const readyRef = useRef(false);
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;

  const applyVisual = useCallback(async (next: AppSettings) => {
    const resolved =
      next.theme.mode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next.theme.mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.lang = next.language;
    await applyLanguage(next.language);
    let accent = "var(--adp-accent-explorer)";
    if (next.theme.accent_source === "custom") {
      accent = next.theme.accent_custom ?? "#0067C0";
    } else if (next.theme.accent_source === "windows" && isTauriRuntime()) {
      try {
        const value = (await invoke("get_windows_accent")) as unknown as string | null;
        if (value) accent = value;
      } catch {
        accent = "var(--adp-accent-explorer)";
      }
    }
    document.documentElement.style.setProperty("--adp-accent-current", accent);
  }, []);

  const applySettings = useCallback(
    (next: AppSettings) => {
      const normalized: AppSettings = {
        ...next,
        theme: { ...next.theme, accent_custom: next.theme.accent_custom ?? "#0067C0" },
      };
      setSettings(normalized);
      void applyVisual(normalized);
      void saveSettings(normalized).catch(() => undefined);
    },
    [applyVisual],
  );

  // The Explorer's view options; stable, so the command list isn't rebuilt
  // on every render.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onViewChange = useCallback(
    (patch: Partial<AppSettings["explorer"]>) =>
      applySettings({ ...settingsRef.current, explorer: { ...settingsRef.current.explorer, ...patch } }),
    [applySettings],
  );

  // No browser menu (Back, Refresh, Print...) anywhere in the app; text
  // boxes and help text keep their copy and paste menu.
  useEffect(() => {
    const onMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, .adp-help-body")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  const persistSession = useCallback(async () => {
    if (!readyRef.current) return;
    const data = sessionFromTabs(tabsRef.current, Math.floor(Date.now() / 1000));
    if (isTauriRuntime()) {
      try {
        await invoke("save_session", { session: data });
      } catch {
        // Session persistence is best-effort.
      }
      return;
    }
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable; session stays in memory.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadSettings();
      if (cancelled) return;
      setSettings(loaded);
      await applyVisual(loaded);
      let session: unknown = null;
      if (isTauriRuntime()) {
        try {
          session = await invoke("get_session");
        } catch {
          session = null;
        }
      } else {
        try {
          const raw = window.localStorage.getItem(SESSION_KEY);
          session = raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          session = null;
        }
      }
      if (cancelled) return;
      setTabsState(tabsFromSession(session, handlers.list().map((handler) => handler.id)));
      readyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [applyVisual]);

  useEffect(() => {
    void persistSession();
  }, [tabs, activeId, persistSession]);

  useEffect(() => {
    const timer = window.setInterval(() => void persistSession(), 5000);
    return () => window.clearInterval(timer);
  }, [persistSession]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settings.theme.mode === "system") void applyVisual(settings);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings, applyVisual]);

  const openTab = useCallback((kind: "explorer" | "help" | "settings" | "gallery", slug?: string) => {
    if (kind === "help" && slug) setHelpSlug(slug);
    setTabsState((current) => (kind === "explorer" ? activateTab(current, "explorer") : openSingleTab(current, kind)));
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabsState((current) => closeTabIn(current, id));
  }, []);

  /** The open pipeline (contract 13): a built-in handler opens the file in
   * a tab; anything else opens in the Windows default app. Rejects with a
   * `files.*` code; the Explorer shows the message. */
  const openFile = useCallback(async (path: string, background: boolean) => {
    const decision = await planOpen(path, handlers);
    if (decision.kind === "tab") {
      setTabsState((current) =>
        openFileTab(current, { path, handler: decision.handler.id, title: decision.info.name }, background),
      );
      return;
    }
    await openItem(path);
  }, []);

  /** Switch to the Explorer tab and open a folder there, optionally
   * selecting one item in it. */
  const showInExplorer = useCallback((folder: string, select: string | null) => {
    setNavigateRequest((previous) => ({ folder, select, nonce: (previous?.nonce ?? 0) + 1 }));
    setTabsState((current) => activateTab(current, "explorer"));
  }, []);

  const mounted = useMemo(() => mountedFileTabs(tabsState), [tabsState]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    listen("open-help", (event) => {
        const payload = (event as unknown as { payload: unknown }).payload;
        openTab("help", typeof payload === "string" ? payload : undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [openTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setShowKeyTips(true);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        const state = tabsRef.current;
        const tab = state.tabs.find((entry) => entry.id === state.activeId);
        const handler = tab?.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
        openTab("help", handler?.helpSlug ?? HELP_SLUGS[tab?.kind ?? "explorer"]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "w" || event.key === "W")) {
        event.preventDefault();
        if (tabsRef.current.activeId !== "explorer") closeTab(tabsRef.current.activeId);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setShowKeyTips(false);
    };
    const onBlur = () => setShowKeyTips(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [closeTab, openTab]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const update = () => {
      try {
        void getCurrentWindow()
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => undefined);
      } catch {
        // Browser fallback: window controls are inert.
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Snap layouts: tell Windows where the custom maximize button is, so it
  // can treat that area as the native maximize button (HTMAXBUTTON).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const report = () => {
      const el = maximizeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = window.devicePixelRatio || 1;
      void invoke("set_maximize_rect", {
        x: r.x * s,
        y: r.y * s,
        width: r.width * s,
        height: r.height * s,
      }).catch(() => undefined);
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, []);

  const windowAction = (action: "minimize" | "toggle-maximize" | "close") => {
    if (!isTauriRuntime()) return;
    try {
      const win = getCurrentWindow();
      if (action === "minimize") void win.minimize();
      if (action === "toggle-maximize") {
        void win.toggleMaximize().then(() => {
          void win.isMaximized().then(setIsMaximized).catch(() => undefined);
        });
      }
      if (action === "close") void win.close();
    } catch {
      // No Tauri window in a plain browser.
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const hasFileTabs = tabs.some((tab) => tab.kind === "file");
  const tabLabel = (tab: TabState): string => {
    if (tab.kind === "explorer") return t("tabs.explorer");
    if (tab.kind === "help") return t("help.title");
    if (tab.kind === "settings") return t("settings.title");
    if (tab.kind === "file") return tab.title ?? t("tabs.file");
    return t("gallery.title");
  };
  const TabIcon =
    activeTab.kind === "help"
      ? CircleHelp
      : activeTab.kind === "settings"
        ? SettingsIcon
        : activeTab.kind === "gallery"
          ? LayoutGrid
          : Home;

  return (
    <div className="adp-shell">
      <header className="adp-titlebar" data-tauri-drag-region="">
        <div className="adp-tabbar" role="tablist">
          {tabs.map((tab) => {
            const handler = tab.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
            const Icon =
              tab.kind === "explorer"
                ? Home
                : tab.kind === "help"
                  ? CircleHelp
                  : tab.kind === "settings"
                    ? SettingsIcon
                    : tab.kind === "file"
                      ? (handler?.icon ?? LayoutGrid)
                      : LayoutGrid;
            const iconOnly = tab.kind === "explorer" && hasFileTabs;
            const classes = ["adp-tab", tab.id === activeId ? "adp-tab--active" : "", iconOnly ? "adp-tab--icon-only" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                aria-label={tabLabel(tab)}
                title={tab.kind === "file" ? tab.path : undefined}
                className={classes}
                draggable={false}
                onClick={() => setTabsState((current) => activateTab(current, tab.id))}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id);
                }}
              >
                <Icon
                  size={14}
                  aria-hidden="true"
                  style={handler ? { color: `var(--adp-accent-${handler.accent})` } : undefined}
                />
                {iconOnly ? null : <span className="adp-tab-label">{tabLabel(tab)}</span>}
                {tab.kind !== "explorer" ? (
                  <button
                    type="button"
                    className="adp-tab-close"
                    aria-label={t("tabs.close")}
                    title={t("tabs.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
          <DropdownMenu
            ariaLabel={t("tabs.newTab")}
            icon={Plus}
            items={[
              { id: "help", label: t("help.title") },
              { id: "settings", label: t("settings.title") },
              { id: "gallery", label: t("gallery.title") },
            ]}
            onSelect={(id) => openTab(id as "help" | "settings" | "gallery")}
          />
        </div>
        <div className="adp-button-row">
          <IconButton
            icon={CircleHelp}
            labelKey="help.title"
            keyTip="H"
            showKeyTip={showKeyTips}
            onClick={() => {
              const handler = activeTab.kind === "file" && activeTab.handler ? handlers.get(activeTab.handler) : undefined;
              openTab("help", handler?.helpSlug ?? HELP_SLUGS[activeTab.kind]);
            }}
          />
          <IconButton
            icon={SettingsIcon}
            labelKey="settings.title"
            keyTip="S"
            showKeyTip={showKeyTips}
            onClick={() => openTab("settings")}
          />
        </div>
        <div className="adp-window-controls">
          <button
            type="button"
            className="adp-icon-btn adp-window-btn"
            aria-label={t("window.minimize")}
            title={t("window.minimize")}
            onClick={() => windowAction("minimize")}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="adp-icon-btn adp-window-btn"
            aria-label={isMaximized ? t("window.restore") : t("window.maximize")}
            title={isMaximized ? t("window.restore") : t("window.maximize")}
            onClick={() => windowAction("toggle-maximize")} ref={maximizeRef}
          >
            {isMaximized ? (
              <Copy size={13} aria-hidden="true" />
            ) : (
              <Square size={13} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="adp-icon-btn adp-window-btn adp-window-btn--close"
            aria-label={t("window.close")}
            title={t("window.close")}
            onClick={() => windowAction("close")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="adp-main">
        {/* The Explorer stays mounted so it keeps its folder, selection and
            scroll position; it ignores shortcuts and drops while hidden. */}
        <div className="adp-tabpane" hidden={activeTab.kind !== "explorer"}>
          <ExplorerHome
            active={activeTab.kind === "explorer"}
            onStatsChange={setExplorerStats}
            onOpenHelp={(slug) => openTab("help", slug ?? "browsing-folders")}
            onOpenFile={openFile}
            navigateRequest={navigateRequest}
            view={settings.explorer}
            onViewChange={onViewChange}
            pasteImageFormat={settings.files?.paste_image_format ?? "png"}
          />
        </div>
        {tabs
          .filter((tab) => tab.kind === "file" && mounted.has(tab.id))
          .map((tab) => (
            <FileTabView
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onShowInFolder={(path) => showInExplorer(parentPathOf(path) ?? path, path)}
              onOpenFolder={(folder) => showInExplorer(folder, null)}
              onClose={() => closeTab(tab.id)}
              onViewState={(view) => setTabsState((current) => setTabView(current, tab.id, view))}
              onOpenHelp={(slug) => openTab("help", slug)}
            />
          ))}
        {activeTab.kind === "help" ? (
          <Suspense fallback={null}><HelpCenter
            lang={settings.language}
            requestedSlug={helpSlug}
            onOpenHelp={(slug) => openTab("help", slug)}
          /></Suspense>
        ) : null}
        {activeTab.kind === "settings" ? (
          <Suspense fallback={null}><SettingsView
            settings={settings}
            onApply={applySettings}
            onOpenHelp={() => openTab("help", "changing-language-and-theme")}
          /></Suspense>
        ) : null}
        {activeTab.kind === "gallery" ? (
          <Suspense fallback={null}><GalleryView onOpenHelp={() => openTab("help", "using-help")} /></Suspense>
        ) : null}
      </main>

      <footer className="adp-statusbar" hidden={activeTab.kind === "file"}>
        {activeTab.kind === "explorer" ? (
          <>
            <span>{t("explorer.statusItems", { count: explorerStats.total })}</span>
            {explorerStats.selected > 0 ? (
              <>
                <span className="adp-status-divider" aria-hidden="true" />
                <span>
                  {t("explorer.statusSelected", { count: explorerStats.selected })}
                  {explorerStats.selectedFiles > 0 ? <span className="adp-status-size">{formatSize(explorerStats.selectedBytes, i18n.language)}</span> : null}
                </span>
              </>
            ) : null}
          </>
        ) : (
          <span>{t("common.ready")}</span>
        )}
        <span>
          <TabIcon size={12} aria-hidden="true" />
        </span>
      </footer>
    </div>
  );
}
```

What changed compared to the old file (for review, not extra work): the tab state is one `TabsState` from `src/services/tabs.ts`; the session stores file tabs; `openFile` runs the open pipeline; the Explorer stays mounted inside `<div className="adp-tabpane" hidden=...>` with `active`, `onOpenFile` and `navigateRequest`; file tabs render `FileTabView`; the Explorer tab shows only its icon while file tabs exist; F1 on a file tab opens its handler's help page; the global status bar is hidden on file tabs.

**Commit:** `feat(tabs): open files in tabs from the Explorer and restore them after a restart [step-04a/T9]`

### T10 - Speed measurement, screenshot, design note

**Files:** modify `scripts/measure-ui.mjs`, `DESIGN_DEVIATIONS.md`.

In `scripts/measure-ui.mjs`, find exactly:

```js
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
```

Replace with:

```js
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
```

In `scripts/measure-ui.mjs`, find exactly:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

Replace with:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real PNG (a color gradient), so "open image" measures a real decode. */
function writeGradientPng(path, width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = Math.round((x / width) * 255);
      raw[offset + 1] = Math.round((y / height) * 255);
      raw[offset + 2] = 192;
    }
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
```

In `scripts/measure-ui.mjs`, find exactly:

```js
await openFolder(demo);
const results = [];
```

Replace with:

```js
writeGradientPng(join(demo, "photo-1920.png"), 1920, 1080);
await openFolder(demo);
const results = [];
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  // Classic menu: time until the helper's menu is on screen. The runner
```

Replace with:

```js
  // Step 04a: open a real image in a file tab, and switch tabs.
  try {
    await openFolder(demo);
    const openValues = [];
    for (let run = 0; run < 5; run += 1) {
      openValues.push(
        await page(`window.__m.timeUntil(
          () => [...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
          () => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null)`),
      );
      await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
      await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
      await sleep(200);
    }
    const opened = { name: "open a 1920x1080 PNG in a tab (first view)", median_ms: Math.round(median(openValues) * 10) / 10, max_ms: Math.round(Math.max(...openValues) * 10) / 10, runs: openValues.length };
    console.log(`${opened.name}: median ${opened.median_ms} ms (max ${opened.max_ms})`);
    results.push(opened);
    await page(`[...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); true`);
    await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null)`);
    results.push(
      await measure(
        "switch tab (image tab to Explorer)",
        `true`,
        `document.querySelectorAll(".adp-tab")[0].click()`,
        `document.querySelectorAll(".adp-tab")[1].click(); true`,
      ),
    );
    await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
  } catch (error) {
    console.log(`step 04a measurements failed: ${error.message ?? error}`);
  }

  // Classic menu: time until the helper's menu is on screen. The runner
```

In `scripts/measure-ui.mjs`, find exactly:

```js
    step: "03b",
```

Replace with:

```js
    step: "04a",
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  try { rmSync(join(demo, "Invoices", "notes.txt"), { force: true }); } catch { /* best effort */ }
}
```

Replace with:

```js
  try { rmSync(join(demo, "Invoices", "notes.txt"), { force: true }); } catch { /* best effort */ }
  // Step 04a: an image open in a file tab.
  await openFolder(demo);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null, 15000)`);
  await sleep(300);
  await shot("12-image-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
}
```

In `DESIGN_DEVIATIONS.md`, find exactly:

```markdown
Newest first.
```

Replace with:

```markdown
Newest first.

## YYYY-MM-DD - File tabs and the image viewer (Step 04a)

- **What:** Figma shows file tabs only with Office, PDF and image editors. The Step 04a file tab uses the Figma window chrome: the Explorer tab shrinks to its house icon while files are open; file tabs show the type icon in the type's accent color; the navigation row (56 px) has Show in folder (up arrow), Reload, and the path ending in the file; the image viewer shows the picture on the media canvas color with the image shadow and a checkerboard behind transparency; the file tab has its own status bar with the image size, the file size, and Fit plus a zoom slider at the right.
- **Closest-option differences:** Back, Forward and the search box are not shown on file tabs yet (search arrives with the text viewer in Step 04b); the zoom slider shows the number without a percent sign (shared Slider component).
```

In the new `DESIGN_DEVIATIONS.md` entry, replace `YYYY-MM-DD` with today's date.

Check: `node --check scripts/measure-ui.mjs` prints nothing.

**Commit:** `test(bench): measure opening an image in a tab and switching tabs [step-04a/T10]`

## Check by hand

The owner does these checks in the packaged app (`.\scripts\gate.ps1 -Package`, then `build\Adperastra\Adperastra.exe`), in a folder with a few pictures (PNG, JPG, an animated GIF, an SVG) and a ZIP file, for example their own Pictures folder.

1. Double-click a PNG: a tab opens next to the Explorer tab with the picture fitted to the window; the Explorer tab shrinks to its house icon; the status bar shows "W × H px", the file size, Fit and the zoom slider.
2. Ctrl+mouse wheel zooms toward the pointer; Ctrl+= and Ctrl+- zoom; Ctrl+0 fits again; when zoomed in, dragging moves the picture.
3. An animated GIF animates; an SVG shows; a transparent PNG shows the checkerboard.
4. Double-click the same PNG again in the Explorer: no second tab, its tab is selected.
5. Middle-click another picture in the list: a new tab appears but the Explorer stays visible.
6. Close the picture tab (×, middle-click on the tab, or Ctrl+W): the Explorer comes back in the same folder, with the same selection and scroll position.
7. In a picture tab press Delete and Ctrl+A: nothing happens to the files in the Explorer. Drag a file from Windows Explorer onto the picture tab: nothing is copied anywhere.
8. In a picture tab, click "Show in folder" (up arrow): the Explorer opens the folder with the picture selected. Click a folder in the path: the Explorer opens that folder.
9. Double-click a ZIP (or any type without a viewer): it opens in its Windows app, as before. Right-click a PNG > Open in Windows app: it opens in the Windows photo app.
10. Rename a picture that has an open tab (from the Explorer), then press Reload in the tab: the tab shows "This file was moved or deleted." with Open folder and Close tab.
11. Open two pictures, close the app, start it again: both tabs come back, the active one selected.
12. Spanish and dark theme: repeat 1, 8 and 10.

## Speed

| Interaction | Tier | How |
|---|---|---|
| Open a 1920x1080 PNG in a tab (first view) | Fast (1 s) | `scripts\measure-ui.ps1`, row "open a 1920x1080 PNG in a tab (first view)" |
| Switch from a file tab to the Explorer | Instant (0.1 s) | row "switch tab (image tab to Explorer)" |
| App start (with one restored image tab) | Fast (1 s) | `scripts\measure-startup.ps1 -Step 04a` |
| Earlier rows (selection, menus, folder open) | as before | must not be more than 20 % slower than `docs/benchmarks/2026-10-28-ui-step03b.json` |

## Screenshots

`12-image-tab` (new) plus all earlier ones, in English light, Spanish dark and the pseudo-locale, into `docs/screenshots/step-04a/`.

## Done when

- [ ] `.\scripts\gate.ps1 -Package` prints `GATE PASSED`.
- [ ] The owner has done every "Check by hand" item, in English light and Spanish dark, and all pass.
- [ ] The speed table is met and saved as `docs/benchmarks/<date>-ui-step04a.json`.
- [ ] Screenshots are in `docs/screenshots/step-04a/`.
- [ ] `docs/step-reports/step-04a.md`, `CHANGELOG.md` (Unreleased: "Files open in tabs; picture viewer"), `KNOWN_ISSUES.md` and `plan/STATUS.md` are updated.
