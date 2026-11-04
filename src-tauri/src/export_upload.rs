//! Raw upload route for export snapshots (Step 08a T2).
//!
//! `POST http://adpfile.localhost/export-snapshot/<snapshot_id>` with
//! `X-Adp-Upload-Token` (32 lower-case hex) and `X-Adp-Offset` (decimal,
//! contiguous). Bodies are at most 1 MiB; no bytes ever travel in invoke
//! JSON. The coordinator adds one branch to `files::protocol` before the
//! normal GET token handling.

use std::sync::Arc;

use tauri::http::{header, HeaderMap, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder, Wry};

use crate::export_snapshot_types::{valid_upload_token, MAX_SNAPSHOT_CHUNK};
use crate::export_snapshots::ExportSnapshots;

pub const UPLOAD_PATH_PREFIX: &str = "/export-snapshot/";
pub const UPLOAD_TOKEN_HEADER: &str = "x-adp-upload-token";
pub const UPLOAD_OFFSET_HEADER: &str = "x-adp-offset";

fn base(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, "sandbox")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    base(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn error_status(error: &str) -> StatusCode {
    match error {
        "snapshot.too_large" => StatusCode::PAYLOAD_TOO_LARGE,
        "snapshot.changed" => StatusCode::CONFLICT,
        _ => StatusCode::BAD_REQUEST,
    }
}

/// The protocol entry point. Only the main window may upload.
pub fn protocol(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if ctx.webview_label() != "main" {
        responder.respond(empty(StatusCode::FORBIDDEN));
        return;
    }
    if request.method() == Method::OPTIONS {
        responder.respond(
            base(StatusCode::NO_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS")
                .header(
                    header::ACCESS_CONTROL_ALLOW_HEADERS,
                    "X-Adp-Upload-Token, X-Adp-Offset, Content-Type",
                )
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new())),
        );
        return;
    }
    if request.method() != Method::POST {
        responder.respond(empty(StatusCode::METHOD_NOT_ALLOWED));
        return;
    }
    if request.body().is_empty() || request.body().len() > MAX_SNAPSHOT_CHUNK {
        responder.respond(empty(StatusCode::PAYLOAD_TOO_LARGE));
        return;
    }
    let path = request.uri().path().to_string();
    let headers = request.headers().clone();
    let body = request.body().clone();
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        responder.respond(serve(&app, &path, &headers, &body));
    });
}

/// Pure apart from the registry call, so tests can exercise it directly.
pub fn serve(app: &AppHandle, path: &str, headers: &HeaderMap, body: &[u8]) -> Response<Vec<u8>> {
    if body.is_empty() || body.len() > MAX_SNAPSHOT_CHUNK {
        return empty(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let Some(snapshot_id) = path.strip_prefix(UPLOAD_PATH_PREFIX) else {
        return empty(StatusCode::BAD_REQUEST);
    };
    if snapshot_id.is_empty() || snapshot_id.contains('/') {
        return empty(StatusCode::BAD_REQUEST);
    }
    let Some(token) = headers
        .get(UPLOAD_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
    else {
        return empty(StatusCode::BAD_REQUEST);
    };
    if !valid_upload_token(token) {
        return empty(StatusCode::BAD_REQUEST);
    }
    let Some(offset) = headers
        .get(UPLOAD_OFFSET_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return empty(StatusCode::BAD_REQUEST);
    };
    let snapshots = app.state::<Arc<ExportSnapshots>>();
    match snapshots.append(snapshot_id, token, offset, body) {
        Ok(()) => empty(StatusCode::NO_CONTENT),
        Err(error) => empty(error_status(&error)),
    }
}

#[cfg(test)]
mod tests {
    use super::{error_status, UPLOAD_PATH_PREFIX};
    use tauri::http::StatusCode;

    #[test]
    fn path_prefix_is_narrow() {
        assert_eq!(UPLOAD_PATH_PREFIX, "/export-snapshot/");
    }

    #[test]
    fn errors_map_to_protocol_statuses() {
        assert_eq!(
            error_status("snapshot.too_large"),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(error_status("snapshot.changed"), StatusCode::CONFLICT);
        assert_eq!(
            error_status("snapshot.bad_request"),
            StatusCode::BAD_REQUEST
        );
    }
}
