//! The isolated thumbnail helper (Step 07a, T5).
//!
//! `Adperastra.exe --thumbnail-helper` reads one JSON request from stdin,
//! re-checks the source revision through a guarded handle, decodes and
//! encodes without ever touching the app's memory, writes one bounded PNG to
//! the owned staging path the parent passed, and answers with bounded
//! metadata only. No path or secret is placed on a command line.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

use fs_service::owned_io::{OwnedIoError, PinnedSource, SourceIdentity};
use fs_service::source_stamp::{attributes_are_online_only, capture_source_stamp, SourceStamp};
use fs_service::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::helper::{drive, read_capped_line, DriveEnd, DriveTimings, HelperIo, HelperLine};
#[path = "thumbnail_staging.rs"]
mod staging;
use staging::{
    file_identity, is_owned_staging_path, open_staged_read, open_staging_for_write, GuardedStaging,
    StagingIdentity,
};

/// The flag that turns this executable into the thumbnail helper.
pub const HELPER_FLAG: &str = "--thumbnail-helper";
/// The helper runs inside a 256 MiB job object (plan D5).
pub const HELPER_MEMORY_LIMIT: usize = 268_435_456;
/// The longest request line the helper accepts.
pub const MAX_REQUEST_LINE: usize = 1_048_576;
/// Edge sizes the UI asks for (plan D8).
pub const THUMBNAIL_EDGES: [u32; 3] = [64, 128, 256];
/// How long one helper may work before it counts as hung (plan D5).
pub const HELPER_IDLE: std::time::Duration = std::time::Duration::from_secs(5);
/// How long a cancelled helper has to stop by itself.
pub const HELPER_GRACE: std::time::Duration = std::time::Duration::from_millis(250);

/// What the app asks the helper to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThumbnailHelperRequest {
    pub path: String,
    pub expected_stamp: SourceStamp,
    pub edge: u32,
    /// The owned staging file held by the parent's delete-on-close guard.
    pub output_path: String,
    pub output_identity: StagingIdentity,
}

/// What the helper reports back. Bytes stay on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ThumbnailHelperReply {
    Done {
        source: SourceStamp,
        byte_len: u64,
        width: u32,
        height: u32,
    },
    Failed {
        code: String,
    },
}

/// A validated helper result, open for the cache store to copy.
pub struct HelperRendered {
    pub file: File,
    pub width: u32,
    pub height: u32,
    pub source: SourceStamp,
}

/// Entry point of the helper process; returns its exit code.
pub fn run_helper() -> i32 {
    let mut input = BufReader::new(std::io::stdin());
    let request: ThumbnailHelperRequest = match read_capped_line(&mut input, MAX_REQUEST_LINE) {
        HelperLine::Line(line) => match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(_) => {
                return send(&ThumbnailHelperReply::Failed {
                    code: "thumbnail.bad_request".to_string(),
                })
            }
        },
        _ => {
            return send(&ThumbnailHelperReply::Failed {
                code: "thumbnail.bad_request".to_string(),
            })
        }
    };
    let reply = match render_to_output(&request) {
        Ok((source, byte_len, width, height)) => ThumbnailHelperReply::Done {
            source,
            byte_len,
            width,
            height,
        },
        Err(code) => ThumbnailHelperReply::Failed { code },
    };
    send(&reply)
}

fn send(reply: &ThumbnailHelperReply) -> i32 {
    let Ok(line) = serde_json::to_string(reply) else {
        return 1;
    };
    let mut output = std::io::stdout();
    let written = output
        .write_all(line.as_bytes())
        .and_then(|()| output.write_all(b"\n"))
        .and_then(|()| output.flush());
    if written.is_err() {
        1
    } else {
        0
    }
}

fn render_to_output(
    request: &ThumbnailHelperRequest,
) -> Result<(SourceStamp, u64, u32, u32), String> {
    crate::validate_absolute_path(&request.path)
        .map_err(|_| "thumbnail.bad_request".to_string())?;
    crate::validate_absolute_path(&request.output_path)
        .map_err(|_| "thumbnail.bad_request".to_string())?;
    request
        .expected_stamp
        .validate()
        .map_err(|_| "thumbnail.bad_request".to_string())?;
    if !THUMBNAIL_EDGES.contains(&request.edge) {
        return Err("thumbnail.bad_request".to_string());
    }
    if !is_owned_staging_path(Path::new(&request.output_path)) {
        return Err("thumbnail.bad_request".to_string());
    }
    let path = Path::new(&request.path);
    let identity = SourceIdentity::capture(path).map_err(source_error)?;
    if attributes_are_online_only(identity.attributes) {
        return Err("thumbnail.online_only".to_string());
    }
    let pinned = PinnedSource::open_background(path, &identity).map_err(source_error)?;
    let before = capture_source_stamp(path).map_err(source_error)?;
    if before != request.expected_stamp {
        return Err("thumbnail.changed".to_string());
    }
    let decoded = crate::thumbnail_decode::decode_pixels(
        pinned.file(),
        request.edge,
        crate::thumbnail_decode::MAX_PIXELS_LIMIT,
    )?;
    let after = capture_source_stamp(path).map_err(source_error)?;
    if after != before {
        return Err("thumbnail.changed".to_string());
    }
    pinned.verify_after_read().map_err(source_error)?;
    let png =
        crate::thumbnail_encode::encode_png(&decoded, crate::thumbnail_encode::MAX_OUTPUT_BYTES)?;

    let mut output =
        open_staging_for_write(Path::new(&request.output_path), &request.output_identity)?;
    output
        .write_all(&png)
        .and_then(|()| output.set_len(png.len() as u64))
        .and_then(|()| output.flush())
        .and_then(|()| output.sync_all())
        .map_err(|_| "thumbnail.failed".to_string())?;
    drop(output);
    Ok((before, png.len() as u64, decoded.width, decoded.height))
}

fn source_error(error: OwnedIoError) -> String {
    match error {
        OwnedIoError::SourceChanged => "thumbnail.changed".to_string(),
        OwnedIoError::ReparseRefused => "thumbnail.failed".to_string(),
        _ => "thumbnail.failed".to_string(),
    }
}

/// Parent side: create owned staging, run one helper, validate the report and
/// leave the PNG open (marked for deletion when that handle closes).
pub fn render_thumbnail(
    cache: &crate::cache::CacheService,
    path: &Path,
    expected: &SourceStamp,
    edge: u32,
    token: &CancellationToken,
) -> Result<HelperRendered, String> {
    if !THUMBNAIL_EDGES.contains(&edge) {
        return Err("thumbnail.bad_request".to_string());
    }
    expected
        .validate()
        .map_err(|_| "thumbnail.bad_request".to_string())?;
    let staging = cache.with_store(|store| {
        store
            .with_staging_budget(crate::thumbnail_encode::MAX_OUTPUT_BYTES, || {
                GuardedStaging::create_reserved(
                    &cache.pending_dir(),
                    crate::thumbnail_encode::MAX_OUTPUT_BYTES,
                )
                .map_err(|_| cache_store::CacheError::Unavailable)
            })
            .map_err(|_| "thumbnail.failed".to_string())
    })?;
    let request = ThumbnailHelperRequest {
        path: path.to_string_lossy().into_owned(),
        expected_stamp: expected.clone(),
        edge,
        output_path: staging.path.to_string_lossy().into_owned(),
        output_identity: staging.identity.clone(),
    };
    let reply = run_process(&request, token)?;
    // validate_reply opens a separate read handle denying writes before the
    // delete-on-close guard drops. That reader retains the file through copy.
    validate_reply(&staging, &reply, expected, &staging.identity)
}

fn run_process(
    request: &ThumbnailHelperRequest,
    token: &CancellationToken,
) -> Result<ThumbnailHelperReply, String> {
    let mut process = crate::helper::HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)?;
    let line = serde_json::to_string(request).map_err(|_| "thumbnail.bad_request".to_string())?;
    process
        .send_line(&line)
        .map_err(|_| "thumbnail.failed".to_string())?;
    let timings = DriveTimings {
        tick: std::time::Duration::from_millis(100),
        idle: HELPER_IDLE,
        grace: HELPER_GRACE,
    };
    drive_helper(&mut process, token, timings)
}

/// Drive one helper conversation and parse its single answer. Kept separate
/// so timeout and cancel tests can inject a fake transport.
pub fn drive_helper(
    io: &mut dyn HelperIo,
    token: &CancellationToken,
    timings: DriveTimings,
) -> Result<ThumbnailHelperReply, String> {
    let mut reply: Option<ThumbnailHelperReply> = None;
    let end = drive(io, token, timings, &mut |line| {
        let parsed: ThumbnailHelperReply =
            serde_json::from_str(line).map_err(|_| "helper.failed".to_string())?;
        reply = Some(parsed);
        Ok(true)
    })
    .map_err(|error| {
        if error == "helper.timeout" {
            "thumbnail.failed".to_string()
        } else {
            error
        }
    })?;
    match end {
        DriveEnd::Finished => reply.ok_or_else(|| "thumbnail.failed".to_string()),
        DriveEnd::Cancelled => Err("background.cancelled".to_string()),
    }
}

fn validate_reply(
    staged: &GuardedStaging,
    reply: &ThumbnailHelperReply,
    expected: &SourceStamp,
    staging: &StagingIdentity,
) -> Result<HelperRendered, String> {
    let (source, byte_len, width, height) = match reply {
        ThumbnailHelperReply::Done {
            source,
            byte_len,
            width,
            height,
        } => (source, *byte_len, *width, *height),
        ThumbnailHelperReply::Failed { code } => {
            return Err(match code.as_str() {
                "thumbnail.bad_request"
                | "thumbnail.changed"
                | "thumbnail.too_large"
                | "thumbnail.online_only" => code.clone(),
                _ => "thumbnail.failed".to_string(),
            })
        }
    };
    if source != expected {
        return Err("thumbnail.changed".to_string());
    }
    if byte_len == 0 || byte_len > crate::thumbnail_encode::MAX_OUTPUT_BYTES {
        return Err("thumbnail.too_large".to_string());
    }
    let mut file = open_staged_read(&staged.path)?;
    if file_identity(&file)? != *staging
        || !file
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == byte_len)
    {
        return Err("thumbnail.failed".to_string());
    }
    let mut head = [0u8; 24];
    file.read_exact(&mut head)
        .map_err(|_| "thumbnail.failed".to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "thumbnail.failed".to_string())?;
    let Some((png_width, png_height)) = png_size_bytes(&head) else {
        return Err("thumbnail.failed".to_string());
    };
    if png_width != width
        || png_height != height
        || width == 0
        || height == 0
        || width > 256
        || height > 256
    {
        return Err("thumbnail.failed".to_string());
    }
    Ok(HelperRendered {
        file,
        width,
        height,
        source: source.clone(),
    })
}

/// Width and height from a PNG signature and IHDR chunk. Pure so the parent
/// can check the helper's report without trusting it.
pub fn png_size_bytes(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 13, 10, 26, 10];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE[..] {
        return None;
    }
    if bytes[8..12] != 13u32.to_be_bytes()[..] || bytes[12..16] != b"IHDR"[..] {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

#[cfg(test)]
#[path = "thumbnail_helper_tests.rs"]
mod tests;
