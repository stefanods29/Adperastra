//! `--special-image-helper`: RAW/codec decoding in its own process.
//!
//! The parent sends one bounded request line with a source path, kind, edge,
//! expected size/modified second and an owned staging output path. This
//! process pins the source, decodes through WIC, writes a bounded PNG with
//! CREATE_NEW, and reports only dimensions. No path is accepted from a URL
//! and no shell is used.

use std::io::{Read, Write};
#[path = "special_staging.rs"]
pub(crate) mod staging;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::helper::{HelperLine, HelperProcess};
use crate::special_images::{
    decode_special_image, encode_png_rgba, is_codec_image_extension, is_raw_extension,
};
use crate::special_view_types::SpecialKind;

pub const HELPER_FLAG: &str = "--special-image-helper";
pub const MAX_REQUEST_LINE: usize = 32768;
pub const HELPER_MEMORY_LIMIT: usize = 768 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawRequest {
    pub path: String,
    pub kind: String,
    pub edge: u32,
    pub full_resolution: bool,
    pub output: String,
    pub output_identity: staging::StagingIdentity,
    #[serde(default)]
    pub expected_size: u64,
    pub expected_stamp: Option<fs_service::SourceStamp>,
    #[serde(default)]
    pub expected_modified_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawReply {
    pub ok: bool,
    pub width: u32,
    pub height: u32,
    pub byte_len: u64,
    pub error: String,
}

fn reply(error: &str) -> RawReply {
    RawReply {
        ok: false,
        width: 0,
        height: 0,
        byte_len: 0,
        error: error.to_string(),
    }
}

pub fn validate_request(request: &RawRequest) -> Result<SpecialKind, String> {
    let kind = SpecialKind::parse(&request.kind)?;
    if !staging::is_owned_staging_path(Path::new(&request.output)) {
        return Err("special_view.bad_request".into());
    }
    let extension = Path::new(&request.path)
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match kind {
        SpecialKind::Raw if !is_raw_extension(&extension) => {
            return Err("special_view.bad_request".to_string())
        }
        SpecialKind::CodecImage if !is_codec_image_extension(&extension) => {
            return Err("special_view.bad_request".to_string())
        }
        SpecialKind::Raw | SpecialKind::CodecImage => {}
        _ => return Err("special_view.bad_request".to_string()),
    }
    if request.path.len() > 32768 || request.output.len() > 32768 {
        return Err("special_view.bad_request".to_string());
    }
    if request.edge == 0 || request.edge > crate::special_view_types::SPECIAL_MAX_EDGE {
        return Err("special_view.bad_request".to_string());
    }
    Ok(kind)
}

pub fn handle_line(line: &str) -> RawReply {
    let request: RawRequest = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return reply("special_view.bad_request"),
    };
    let kind = match validate_request(&request) {
        Ok(kind) => kind,
        Err(error) => return reply(&error),
    };
    let identity = match fs_service::owned_io::SourceIdentity::capture(Path::new(&request.path)) {
        Ok(identity) => identity,
        Err(_) => return reply("special_view.unavailable"),
    };
    if request.expected_size != 0 && identity.size != request.expected_size {
        return reply("special_view.changed");
    }
    if request.expected_modified_unix != 0
        && identity.modified_unix != request.expected_modified_unix
    {
        return reply("special_view.changed");
    }
    let pinned = match fs_service::owned_io::PinnedSource::open_background(
        Path::new(&request.path),
        &identity,
    ) {
        Ok(pinned) => pinned,
        Err(_) => return reply("special_view.changed"),
    };
    let current = match fs_service::capture_source_stamp(Path::new(&request.path)) {
        Ok(value) => value,
        Err(_) => return reply("special_view.changed"),
    };
    if request.expected_stamp.as_ref() != Some(&current) {
        return reply("special_view.changed");
    }
    let pixels =
        match decode_special_image(pinned.file(), kind, request.edge, request.full_resolution) {
            Ok(value) => value,
            Err(error) => return reply(&error),
        };
    if pinned.verify_after_read().is_err() {
        return reply("special_view.changed");
    }
    let png = match encode_png_rgba(&pixels) {
        Ok(value) => value,
        Err(error) => return reply(&error),
    };
    let mut output =
        match staging::open_staging_for_write(Path::new(&request.output), &request.output_identity)
        {
            Ok(file) => file,
            Err(_) => return reply("special_view.unavailable"),
        };
    if output.write_all(&png).is_err()
        || output.set_len(png.len() as u64).is_err()
        || output.flush().is_err()
        || output.sync_all().is_err()
    {
        return reply("special_view.unavailable");
    }
    RawReply {
        ok: true,
        width: pixels.width,
        height: pixels.height,
        byte_len: png.len() as u64,
        error: String::new(),
    }
}

/// Helper process entry. One request line, one reply line.
pub fn run_helper() -> i32 {
    let mut input = std::io::BufReader::new(std::io::stdin());
    let line = match crate::helper::read_capped_line(&mut input, MAX_REQUEST_LINE) {
        HelperLine::Line(line) => line,
        _ => return 1,
    };
    let result = handle_line(line.trim_end());
    let text = serde_json::to_string(&result)
        .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"special_view.corrupt\"}".to_string());
    if writeln!(std::io::stdout(), "{text}").is_err() {
        return 1;
    }
    0
}

/// Parent side: run one isolated decode and return the bounded PNG bytes.
/// The temporary output name is parent-owned; the helper uses CREATE_NEW.
pub fn decode_in_helper(
    cache: &crate::cache::CacheService,
    path: &Path,
    kind: SpecialKind,
    edge: u32,
    full_resolution: bool,
    cancel: &fs_service::CancellationToken,
) -> Result<(Vec<u8>, u32, u32), String> {
    if !matches!(kind, SpecialKind::Raw | SpecialKind::CodecImage) {
        return Err("special_view.bad_request".to_string());
    }
    let identity = fs_service::owned_io::SourceIdentity::capture(path)
        .map_err(|_| "special_view.changed".to_string())?;
    let guarded = cache.with_store(|store| {
        store
            .with_staging_budget(crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES, || {
                staging::GuardedStaging::create_reserved(
                    &cache.pending_dir(),
                    crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES,
                )
                .map_err(|_| cache_store::CacheError::Unavailable)
            })
            .map_err(|_| "special_view.unavailable".to_string())
    })?;
    let output = guarded.path.clone();
    let request = RawRequest {
        path: path.to_string_lossy().into_owned(),
        kind: kind.as_str().to_string(),
        edge,
        full_resolution,
        output: output.to_string_lossy().into_owned(),
        output_identity: guarded.identity.clone(),
        expected_size: identity.size,
        expected_stamp: Some(
            fs_service::capture_source_stamp(path).map_err(|_| "special_view.changed")?,
        ),
        expected_modified_unix: identity.modified_unix,
    };
    let text =
        serde_json::to_string(&request).map_err(|_| "special_view.unavailable".to_string())?;
    let mut helper = HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)?;
    helper.send_line(&text)?;
    let mut answer = None;
    let end = crate::helper::drive(
        &mut helper,
        cancel,
        crate::helper::DriveTimings {
            tick: Duration::from_millis(25),
            idle: Duration::from_secs(15),
            grace: Duration::from_millis(250),
        },
        &mut |line| {
            answer = Some(line.to_string());
            Ok(true)
        },
    )?;
    if matches!(end, crate::helper::DriveEnd::Cancelled) {
        return Err("background.cancelled".into());
    }
    let answer = answer.ok_or("special_view.unavailable")?;

    let reply: RawReply = match serde_json::from_str(&answer) {
        Ok(reply) => reply,
        Err(_) => {
            return Err("special_view.corrupt".to_string());
        }
    };
    if !reply.ok {
        return Err(match reply.error.as_str() {
            "special_view.codec_required"
            | "special_view.too_large"
            | "special_view.changed"
            | "special_view.corrupt"
            | "special_view.unsupported" => reply.error,
            _ => "special_view.unavailable".to_string(),
        });
    }
    let mut reader = staging::open_staged_read(&output)?;
    if staging::file_identity(&reader)? != guarded.identity
        || reader
            .metadata()
            .map_err(|_| "special_view.unavailable")?
            .len()
            != reply.byte_len
        || reply.byte_len > crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES
    {
        return Err("special_view.corrupt".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut reader)
        .take(crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "special_view.unavailable".to_string())?;
    let (width, height) = crate::special_images::validate_png(&bytes)?;
    Ok((bytes, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_kind_extension_mismatch() {
        let request = RawRequest {
            path: "C:\\a.psd".to_string(),
            kind: "raw".to_string(),
            edge: 128,
            full_resolution: false,
            output: "C:\\~adp-thumbnail-00000000-0000-4000-8000-000000000001.partial".to_string(),
            output_identity: serde_json::from_value(
                serde_json::json!({"volume":1,"index":"0000000000000001"}),
            )
            .unwrap(),
            expected_size: 0,
            expected_stamp: None,
            expected_modified_unix: 0,
        };
        assert_eq!(
            validate_request(&request).err().as_deref(),
            Some("special_view.bad_request")
        );
    }

    #[test]
    fn accepts_a_bounded_raw_request() {
        let request = RawRequest {
            path: "C:\\a.cr2".to_string(),
            kind: "raw".to_string(),
            edge: 2048,
            full_resolution: false,
            output: "C:\\~adp-thumbnail-00000000-0000-4000-8000-000000000001.partial".to_string(),
            output_identity: serde_json::from_value(
                serde_json::json!({"volume":1,"index":"0000000000000001"}),
            )
            .unwrap(),
            expected_size: 0,
            expected_stamp: None,
            expected_modified_unix: 0,
        };
        assert_eq!(validate_request(&request), Ok(SpecialKind::Raw));
    }
}
