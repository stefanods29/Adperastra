//! Native encoded-capture support for the image editor (Step 14b T6).
//!
//! This module validates the capture policy before any bytes are published,
//! composes an explicit background for alpha-less formats and delegates final
//! encoding to the workspace `image` crate (already approved for Step 08a).
//!
//! The editor service reaches the encoder through two commands bound here:
//! `image_encode_plan` returns the native metadata/ICC policy and
//! `image_encode` takes one bounded raw RGBA body and returns the encoded
//! bytes as a raw response. Neither command sends image bytes through JSON,
//! reads a path or publishes a snapshot; 08a keeps the exact-length
//! reservation and 09a keeps the no-replace save-copy publication.
#![allow(dead_code)]


use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use tauri::http::HeaderMap;
use tauri::WebviewWindow;

pub const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_IMAGE_EDGE: u32 = 32_768;
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureMime {
    Png,
    Jpeg,
    Webp,
}

impl CaptureMime {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "image/png" => Ok(Self::Png),
            "image/jpeg" => Ok(Self::Jpeg),
            "image/webp" => Ok(Self::Webp),
            _ => Err("image_edit.bad_request".to_string()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }

    fn preserves_alpha(self) -> bool {
        !matches!(self, Self::Jpeg)
    }

    fn supports_icc(self) -> bool {
        true
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadKind {
    /// Encoded bytes, never a raw RGBA payload.
    Encoded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeRequest {
    pub mime: CaptureMime,
    pub width: u32,
    pub height: u32,
    pub quality: u8,
    pub background_rgba: [u8; 4],
    pub metadata_keep: bool,
    pub source_has_icc: bool,
    /// The user explicitly accepted a metadata loss shown before capture.
    pub accepted_metadata_loss: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodePlan {
    pub mime: CaptureMime,
    pub payload_kind: PayloadKind,
    pub width: u32,
    pub height: u32,
    pub alpha_preserved: bool,
    pub background: Option<[u8; 4]>,
    pub icc_preserved: bool,
    pub metadata_loss_accepted: bool,
    pub max_encoded_bytes: u64,
}

/// D9/T6: alpha, background and metadata policy are decided before encoding.
pub fn plan_encode(request: &EncodeRequest) -> Result<EncodePlan, String> {
    if request.width == 0 || request.height == 0 {
        return Err("image_edit.bad_request".to_string());
    }
    if request.width > MAX_IMAGE_EDGE
        || request.height > MAX_IMAGE_EDGE
        || u64::from(request.width) * u64::from(request.height) > MAX_IMAGE_PIXELS
    {
        return Err("image_edit.too_large".to_string());
    }
    if request.quality < 1 || request.quality > 100 {
        return Err("image_edit.bad_request".to_string());
    }
    let supports_alpha = request.mime.preserves_alpha();
    let expected_loss = request.source_has_icc && !(request.metadata_keep && request.mime.supports_icc());
    if expected_loss && !request.accepted_metadata_loss {
        return Err("convert.metadata_loss".to_string());
    }
    Ok(EncodePlan {
        mime: request.mime,
        payload_kind: PayloadKind::Encoded,
        width: request.width,
        height: request.height,
        alpha_preserved: supports_alpha,
        background: if supports_alpha {
            None
        } else {
            Some(request.background_rgba)
        },
        icc_preserved: request.metadata_keep && request.mime.supports_icc() && request.source_has_icc,
        metadata_loss_accepted: request.accepted_metadata_loss,
        max_encoded_bytes: MAX_SNAPSHOT_BYTES,
    })
}

/// The encoded length is checked before the snapshot is published. A 257 MiB
/// payload never reaches `beginExportSnapshot`.
pub fn validate_encoded_length(byte_len: u64) -> Result<(), String> {
    if byte_len == 0 {
        return Err("image_edit.bad_request".to_string());
    }
    if byte_len > MAX_SNAPSHOT_BYTES {
        return Err("snapshots.too_large".to_string());
    }
    Ok(())
}

fn composite(rgba: &[u8], background: [u8; 4]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.as_chunks::<4>().0 {
        let alpha = f32::from(pixel[3]) / 255.0;
        for (index, channel) in pixel.iter().take(3).enumerate() {
            let value = f32::from(*channel) * alpha + f32::from(background[index]) * (1.0 - alpha);
            rgb.push(value.round().clamp(0.0, 255.0) as u8);
        }
    }
    rgb
}

/// Encodes validated straight RGBA8 bytes. JPEG never keeps transparency and
/// always uses the planned background.
pub fn encode_rgba(request: &EncodeRequest, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let plan = plan_encode(request)?;
    let expected = request.width as usize * request.height as usize * 4;
    if rgba.len() != expected {
        return Err("image_edit.bad_request".to_string());
    }
    let mut out = Vec::new();
    match plan.mime {
        CaptureMime::Png => {
            PngEncoder::new(&mut out)
                .write_image(
                    rgba,
                    plan.width,
                    plan.height,
                    ExtendedColorType::Rgba8,
                )
                .map_err(|_| "image_edit.failed".to_string())?;
        }
        CaptureMime::Jpeg => {
            let background = plan
                .background
                .ok_or_else(|| "image_edit.failed".to_string())?;
            let rgb = composite(rgba, background);
            JpegEncoder::new_with_quality(&mut out, request.quality)
                .encode(&rgb, plan.width, plan.height, ExtendedColorType::Rgb8)
                .map_err(|_| "image_edit.failed".to_string())?;
        }
        CaptureMime::Webp => {
            WebPEncoder::new_lossless(&mut out)
                .write_image(
                    rgba,
                    plan.width,
                    plan.height,
                    ExtendedColorType::Rgba8,
                )
                .map_err(|_| "image_edit.failed".to_string())?;
        }
    }
    validate_encoded_length(out.len() as u64)?;
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveMode {
    Save,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitPolicy {
    pub marks_clean: bool,
    pub rebinds_source: bool,
}

/// Saving captured revision R while the current model is R+1 marks only R as
/// saved. Save a copy never rebinds the source and never clears dirty.
pub fn commit_policy(
    mode: SaveMode,
    captured_revision: u64,
    current_revision: u64,
) -> CommitPolicy {
    match mode {
        SaveMode::Save => CommitPolicy {
            marks_clean: true,
            rebinds_source: false,
        },
        SaveMode::Copy => CommitPolicy {
            marks_clean: false,
            rebinds_source: false,
        },
    }
    .with_revision_check(captured_revision, current_revision)
}

impl CommitPolicy {
    fn with_revision_check(self, captured: u64, current: u64) -> Self {
        if captured == 0 || captured > current {
            Self {
                marks_clean: false,
                rebinds_source: false,
            }
        } else {
            self
        }
    }
}

/// Native policy request (D9/T6). The native encoder writes no metadata
/// chunks, so the policy below never claims ICC, EXIF or XMP preservation.
#[derive(Debug, Clone, Deserialize)]
pub struct ImageEncodePlanRequest {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_quality")]
    pub quality: u8,
    #[serde(default = "default_background")]
    pub background_rgba: [u8; 4],
    #[serde(default)]
    pub source_has_icc: bool,
    #[serde(default)]
    pub accepted_metadata_loss: bool,
}

fn default_quality() -> u8 {
    90
}

fn default_background() -> [u8; 4] {
    [255, 255, 255, 255]
}

/// The exact policy the native encoder delivers. `icc_preserved` is false
/// even when the source carried a profile because no chunk is embedded.
#[derive(Debug, Clone, Serialize)]
pub struct ImageEncodePolicy {
    pub mime: String,
    pub payload_kind: String,
    pub width: u32,
    pub height: u32,
    pub alpha_preserved: bool,
    pub background: Option<[u8; 4]>,
    pub icc_preserved: bool,
    pub metadata_kept: Vec<String>,
    pub metadata_lost: Vec<String>,
    pub metadata_loss_accepted: bool,
    pub max_encoded_bytes: u64,
}

/// Builds the native encode request. `metadata_keep` is always false: the
/// native encoder has no metadata writer, so a source ICC profile is either
/// an accepted loss or the command refuses before encoding.
fn native_encode_request(request: &ImageEncodePlanRequest) -> Result<EncodeRequest, String> {
    let mime = CaptureMime::parse(&request.mime)?;
    Ok(EncodeRequest {
        mime,
        width: request.width,
        height: request.height,
        quality: request.quality,
        background_rgba: request.background_rgba,
        metadata_keep: false,
        source_has_icc: request.source_has_icc,
        accepted_metadata_loss: request.accepted_metadata_loss,
    })
}

fn native_policy(request: &ImageEncodePlanRequest) -> Result<ImageEncodePolicy, String> {
    let encode = native_encode_request(request)?;
    let plan = plan_encode(&encode)?;
    Ok(ImageEncodePolicy {
        mime: plan.mime.as_str().to_string(),
        payload_kind: "encoded".to_string(),
        width: plan.width,
        height: plan.height,
        alpha_preserved: plan.alpha_preserved,
        background: plan.background,
        icc_preserved: false,
        metadata_kept: Vec::new(),
        metadata_lost: if request.source_has_icc {
            vec!["icc".to_string()]
        } else {
            Vec::new()
        },
        metadata_loss_accepted: plan.metadata_loss_accepted,
        max_encoded_bytes: plan.max_encoded_bytes,
    })
}

/// Returns the metadata loss / ICC policy before the service starts a
/// capture. A source ICC profile without an accepted loss is refused here
/// with `convert.metadata_loss`, so the service can keep the PNG metadata
/// writer instead of silently stripping the profile.
#[tauri::command]
pub fn image_encode_plan(
    window: WebviewWindow,
    request: ImageEncodePlanRequest,
) -> Result<ImageEncodePolicy, String> {
    crate::ensure_main(window.label())?;
    native_policy(&request)
}

const HEADER_MIME: &str = "x-adp-image-mime";
const HEADER_WIDTH: &str = "x-adp-image-width";
const HEADER_HEIGHT: &str = "x-adp-image-height";
const HEADER_QUALITY: &str = "x-adp-image-quality";
const HEADER_BACKGROUND: &str = "x-adp-image-background";
const HEADER_SOURCE_ICC: &str = "x-adp-image-source-has-icc";
const HEADER_ACCEPTED_LOSS: &str = "x-adp-image-accepted-metadata-loss";

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "image_edit.bad_request".to_string())
}

fn header_flag(headers: &HeaderMap, name: &str) -> Result<bool, String> {
    match headers.get(name).and_then(|value| value.to_str().ok()) {
        None | Some("0") | Some("false") => Ok(false),
        Some("1") | Some("true") => Ok(true),
        Some(_) => Err("image_edit.bad_request".to_string()),
    }
}

fn parse_background(value: &str) -> Result<[u8; 4], String> {
    let mut channels = [255u8; 4];
    let mut count = 0;
    for part in value.split(',') {
        if count == 4 {
            return Err("image_edit.bad_request".to_string());
        }
        channels[count] = part
            .trim()
            .parse::<u8>()
            .map_err(|_| "image_edit.bad_request".to_string())?;
        count += 1;
    }
    if count != 4 {
        return Err("image_edit.bad_request".to_string());
    }
    Ok(channels)
}

fn encode_request_from_headers(headers: &HeaderMap) -> Result<EncodeRequest, String> {
    let mime = CaptureMime::parse(header_text(headers, HEADER_MIME)?)?;
    let width = header_text(headers, HEADER_WIDTH)?
        .parse::<u32>()
        .map_err(|_| "image_edit.bad_request".to_string())?;
    let height = header_text(headers, HEADER_HEIGHT)?
        .parse::<u32>()
        .map_err(|_| "image_edit.bad_request".to_string())?;
    let quality = headers
        .get(HEADER_QUALITY)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .parse::<u8>()
                .map_err(|_| "image_edit.bad_request".to_string())
        })
        .transpose()?
        .unwrap_or(90);
    let background_rgba = headers
        .get(HEADER_BACKGROUND)
        .and_then(|value| value.to_str().ok())
        .map(parse_background)
        .transpose()?
        .unwrap_or([255, 255, 255, 255]);
    Ok(EncodeRequest {
        mime,
        width,
        height,
        quality,
        background_rgba,
        metadata_keep: false,
        source_has_icc: header_flag(headers, HEADER_SOURCE_ICC)?,
        accepted_metadata_loss: header_flag(headers, HEADER_ACCEPTED_LOSS)?,
    })
}

/// One bounded raw RGBA body in, one bounded encoded body out. The body is
/// never JSON and never touches a path. The 256 MiB cap is checked before
/// encoding, and `encode_rgba` rechecks the encoded length before the
/// response leaves Rust; 08a then reserves exactly that length.
#[tauri::command]
pub async fn image_encode(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    crate::ensure_main(window.label())?;
    let encode = encode_request_from_headers(request.headers())?;
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else {
        return Err("image_edit.bad_request".to_string());
    };
    if rgba.is_empty() || rgba.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err("image_edit.too_large".to_string());
    }
    let encoded = encode_rgba(&encode, rgba)?;
    Ok(tauri::ipc::Response::new(encoded))
}

#[cfg(test)]
#[path = "image_encode_step14b_tests.rs"]
mod step14b_tests;
