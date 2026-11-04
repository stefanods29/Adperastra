//! The metadata helper (Step 07b D4): `Adperastra.exe --metadata-helper`
//! reads the fixed property allowlist in its own memory-limited process, so
//! a damaged property handler can never take the app down (R-SEC-9).
//!
//! One JSON request line arrives on stdin and exactly one JSON answer line
//! leaves on stdout. The helper never writes a property store and never
//! writes source content: cloud placeholders and links are refused before the
//! property store is opened (R-FS-1).

use serde::{Deserialize, Serialize};
use std::io::{BufReader, Write};
use std::path::{Component, Path};

use fs_service::SourceStamp;

use crate::helper::{read_capped_line, HelperLine};
use crate::metadata_types::{MetadataInfo, MAX_PATH_UNITS};

/// The flag that turns this executable into the metadata helper.
pub const HELPER_FLAG: &str = "--metadata-helper";
/// How much memory the helper may use (a 256 MiB job object limit, D4).
pub const HELPER_MEMORY_LIMIT: usize = 268_435_456;
/// The longest request line the helper accepts.
pub const MAX_REQUEST_LINE: usize = 512 * 1024;
pub const MAX_REPLY_BYTES: usize = crate::metadata_types::MAX_SERIALIZED_BYTES + 128;

/// What the app asks the helper to read. The expected stamp is the source
/// revision the app saw; the helper re-derives and compares it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperRequest {
    pub path: String,
    pub source: SourceStamp,
}

/// What the helper tells the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HelperMessage {
    Info { info: Box<MetadataInfo> },
    Failed { code: String },
}

/// Parse and validate one request line. Nothing user-selected can become a
/// property name: the request only carries a path and an expected stamp.
pub fn parse_request(line: &str) -> Result<HelperRequest, String> {
    if line.len() > MAX_REQUEST_LINE {
        return Err("metadata.bad_request".into());
    }
    let request: HelperRequest =
        serde_json::from_str(line).map_err(|_| "metadata.bad_request".to_string())?;
    validate_request(&request)?;
    Ok(request)
}

fn validate_request(request: &HelperRequest) -> Result<(), String> {
    request
        .source
        .validate()
        .map_err(|_| "metadata.bad_request".to_string())?;
    fs_service::validate_path_input(&request.path)
        .map_err(|_| "metadata.bad_request".to_string())?;
    if request.path.encode_utf16().count() > MAX_PATH_UNITS {
        return Err("metadata.bad_request".to_string());
    }
    let path = Path::new(&request.path);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("metadata.bad_request".to_string());
    }
    Ok(())
}

/// Entry point of the helper process; returns its exit code.
pub fn run_helper() -> i32 {
    let mut input = BufReader::new(std::io::stdin());
    let request = match read_capped_line(&mut input, MAX_REQUEST_LINE) {
        HelperLine::Line(line) => match parse_request(&line) {
            Ok(request) => request,
            Err(code) => {
                return send(&HelperMessage::Failed { code });
            }
        },
        _ => {
            return send(&HelperMessage::Failed {
                code: "metadata.bad_request".to_string(),
            });
        }
    };

    #[cfg(windows)]
    {
        // The property system needs COM on this thread; the guard balances
        // CoUninitialize before the process exits.
        let _com = crate::explorer::ComGuard::new();
        let cancel = fs_service::new_cancellation_token();
        // The parent says "cancel" on stdin; the reader stops the field loop
        // and the parent kills the process after its grace period.
        let stop = cancel.clone();
        std::thread::spawn(move || loop {
            match read_capped_line(&mut input, MAX_REQUEST_LINE) {
                HelperLine::Line(line) => {
                    if line.trim() == "cancel" {
                        stop.store(true, std::sync::atomic::Ordering::Relaxed);
                        return;
                    }
                }
                _ => {
                    stop.store(true, std::sync::atomic::Ordering::Relaxed);
                    return;
                }
            }
        });
        let message = match crate::metadata_windows::read_properties(
            Path::new(&request.path),
            &request.source,
            &cancel,
        ) {
            Ok(info) => HelperMessage::Info {
                info: Box::new(info),
            },
            Err(code) => HelperMessage::Failed { code },
        };
        send(&message)
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        send(&HelperMessage::Failed {
            code: "metadata.failed".to_string(),
        })
    }
}

fn send(message: &HelperMessage) -> i32 {
    let Ok(line) = serde_json::to_string(message) else {
        return 1;
    };
    if line.len() > MAX_REPLY_BYTES {
        return send(&HelperMessage::Failed {
            code: "metadata.too_large".into(),
        });
    }
    let mut output = std::io::stdout();
    let written = output
        .write_all(line.as_bytes())
        .and_then(|()| output.write_all(b"\n"))
        .and_then(|()| output.flush());
    if written.is_err() {
        return 1;
    }
    0
}

#[cfg(test)]
#[path = "metadata_helper_tests.rs"]
mod metadata_helper_tests;
