//! Metadata requests through the isolated property helper (Step 07b E2).
//!
//! No COM call ever runs on the app's UI or async threads: the helper owns
//! the property store, the app only sends a path and the expected source
//! revision and receives the bounded DTO. Cancelling kills the helper.

use std::path::Path;
use std::time::Duration;

use fs_service::{CancellationToken, SourceStamp};

use crate::helper::{self, DriveEnd, DriveTimings, HelperIo, HelperProcess};
use crate::metadata_helper::{HelperMessage, HelperRequest, HELPER_FLAG, HELPER_MEMORY_LIMIT};
use crate::metadata_types::MetadataInfo;

/// The helper's wall budget (D4). The parent kills it after this much
/// silence, then the request fails without touching the app.
pub const HELPER_TIMEOUT: Duration = Duration::from_secs(3);
/// How long a cancelled helper has to stop by itself.
pub const HELPER_GRACE: Duration = Duration::from_millis(250);

/// Timings for one metadata conversation.
pub fn helper_timings() -> DriveTimings {
    DriveTimings {
        tick: Duration::from_millis(100),
        idle: HELPER_TIMEOUT,
        grace: HELPER_GRACE,
    }
}

/// Read one file's fixed facts in the helper process.
///
/// Errors: `metadata.bad_request`, `metadata.changed`, `metadata.failed`,
/// `metadata.online_only`, `background.cancelled`.
pub fn read_metadata(
    path: &Path,
    expected: &SourceStamp,
    token: &CancellationToken,
) -> Result<MetadataInfo, String> {
    expected
        .validate()
        .map_err(|_| "metadata.bad_request".to_string())?;
    let prepared = crate::metadata_source::PreparedMetadataSource::open(path, expected)?;
    let text = path.to_string_lossy().into_owned();
    if text.encode_utf16().count() > crate::metadata_types::MAX_PATH_UNITS {
        return Err("metadata.bad_request".to_string());
    }
    let mut process = HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)
        .map_err(|_| "metadata.failed".to_string())?;
    let request = HelperRequest {
        path: text,
        source: expected.clone(),
    };
    let line = serde_json::to_string(&request).map_err(|_| "metadata.failed".to_string())?;
    process
        .send_line(&line)
        .map_err(|_| "metadata.failed".to_string())?;
    let info = drive_metadata(&mut process, token, helper_timings())?;
    prepared.verify(expected)?;
    if info.source != *expected {
        return Err("metadata.changed".into());
    }
    Ok(info)
}

/// The helper conversation, separated from process creation so tests can
/// drive it with a controlled transport.
pub fn drive_metadata(
    io: &mut dyn HelperIo,
    token: &CancellationToken,
    timings: DriveTimings,
) -> Result<MetadataInfo, String> {
    let mut info: Option<MetadataInfo> = None;
    let mut failure: Option<String> = None;
    let end = helper::drive(io, token, timings, &mut |text| {
        if text.len() > crate::metadata_helper::MAX_REPLY_BYTES {
            return Err("metadata.too_large".into());
        }
        let message: HelperMessage =
            serde_json::from_str(text).map_err(|_| "metadata.failed".to_string())?;
        match message {
            HelperMessage::Info { info: found } => {
                info = Some(found.validated()?);
                Ok(true)
            }
            HelperMessage::Failed { code } => {
                failure = Some(allowed_error(&code).to_string());
                Ok(true)
            }
        }
    });
    match end {
        Ok(DriveEnd::Finished) => match (failure, info) {
            (Some(code), _) => Err(code),
            (None, Some(info)) => Ok(info),
            (None, None) => Err("metadata.failed".to_string()),
        },
        Ok(DriveEnd::Cancelled) => Err("background.cancelled".to_string()),
        // A crash, a too-long line and a silent helper are all failures;
        // the app keeps running because the helper owned the risk.
        Err(error) if error == "metadata.too_large" => Err(error),
        Err(_) => Err("metadata.failed".to_string()),
    }
}

pub fn allowed_error(code: &str) -> &str {
    match code {
        "metadata.bad_request"
        | "metadata.changed"
        | "metadata.too_large"
        | "metadata.online_only"
        | "metadata.failed"
        | "background.cancelled"
        | "background.paused" => code,
        _ => "metadata.failed",
    }
}

#[cfg(test)]
#[path = "metadata_tests.rs"]
mod metadata_tests;
