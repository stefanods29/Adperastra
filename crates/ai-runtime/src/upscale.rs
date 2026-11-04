//! Non-tiled enlargement rules: dimensions, crop, metadata and parity (D4-D6).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::types::{ImageRect, UpscaleModel, UpscaleScale, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS};
use crate::validation::{validate_rect_inside, validate_rect_shape};

pub const MAX_4X_INPUT_PIXELS: u64 = 6_250_000;
pub const MAX_2X_INPUT_PIXELS: u64 = 25_000_000;
pub const PREVIEW_SOURCE_EDGE: u32 = 256;
pub const PREVIEW_OUTPUT_EDGE: u32 = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpscaleDimensions {
    pub width: u32,
    pub height: u32,
}

impl UpscaleDimensions {
    pub fn pixels(self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpscaleLimitError {
    pub code: &'static str,
    pub output: UpscaleDimensions,
    pub output_pixels: u64,
}

/// D6: every edge and pixel product is checked before allocation.
pub fn check_upscale_limits(
    input_width: u32,
    input_height: u32,
    scale: UpscaleScale,
) -> Result<UpscaleDimensions, UpscaleLimitError> {
    let factor = match scale {
        UpscaleScale::Two => 2u32,
        UpscaleScale::Four => 4u32,
    };
    let output = UpscaleDimensions {
        width: input_width.saturating_mul(factor),
        height: input_height.saturating_mul(factor),
    };
    let output_pixels = uint64_product(input_width, input_height, factor);
    let source_pixels = u64::from(input_width) * u64::from(input_height);
    let source_limit = match scale {
        UpscaleScale::Two => MAX_2X_INPUT_PIXELS,
        UpscaleScale::Four => MAX_4X_INPUT_PIXELS,
    };
    let fail = |code: &'static str| UpscaleLimitError {
        code,
        output,
        output_pixels,
    };
    if input_width == 0 || input_height == 0 {
        return Err(fail("ai.bad_request"));
    }
    if output.width > MAX_IMAGE_EDGE || output.height > MAX_IMAGE_EDGE {
        return Err(fail("ai.unsupported"));
    }
    if source_pixels > source_limit || output_pixels > MAX_IMAGE_PIXELS {
        return Err(fail("ai.unsupported"));
    }
    Ok(output)
}

fn uint64_product(width: u32, height: u32, factor: u32) -> u64 {
    let factor = u64::from(factor);
    u64::from(width)
        .saturating_mul(factor)
        .saturating_mul(u64::from(height).saturating_mul(factor))
}

/// A whole small image is the default crop; otherwise a centered square.
pub fn default_preview_region(width: u32, height: u32) -> Result<ImageRect, String> {
    if width == 0 || height == 0 {
        return Err("ai.bad_request".into());
    }
    if width <= PREVIEW_SOURCE_EDGE && height <= PREVIEW_SOURCE_EDGE {
        return Ok(ImageRect {
            x: 0,
            y: 0,
            width,
            height,
        });
    }
    let side = width.min(height).min(PREVIEW_SOURCE_EDGE);
    Ok(ImageRect {
        x: (width - side) / 2,
        y: (height - side) / 2,
        width: side,
        height: side,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreviewPlan {
    pub region: ImageRect,
    pub output: UpscaleDimensions,
}

pub fn plan_preview(
    width: u32,
    height: u32,
    scale: UpscaleScale,
    requested: Option<ImageRect>,
) -> Result<PreviewPlan, String> {
    let region = match requested {
        Some(rect) => {
            validate_rect_shape(&rect)?;
            validate_rect_inside(&rect, width, height)?;
            if rect.width > PREVIEW_SOURCE_EDGE || rect.height > PREVIEW_SOURCE_EDGE {
                return Err("ai.bad_request".into());
            }
            rect
        }
        None => default_preview_region(width, height)?,
    };
    // Only the crop is inferred, so the full-image 4x pixel limit does not
    // apply to a preview of a larger source. The crop's own output bound does.
    let factor = match scale {
        UpscaleScale::Two => 2u32,
        UpscaleScale::Four => 4u32,
    };
    let output = UpscaleDimensions {
        width: region.width.saturating_mul(factor),
        height: region.height.saturating_mul(factor),
    };
    if output.width > PREVIEW_OUTPUT_EDGE || output.height > PREVIEW_OUTPUT_EDGE {
        return Err("ai.unsupported".into());
    }
    Ok(PreviewPlan { region, output })
}

/// D5 metadata policy. A declared loss must be acknowledged by the normal
/// export/apply confirmation; otherwise `metadata_loss` is reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataDecision {
    pub keep_metadata: bool,
    pub orientation: u8,
    pub dimensions_updated: bool,
    pub acknowledged_loss: bool,
}

pub fn decide_metadata(
    keep_requested: bool,
    metadata_preservable: bool,
    acknowledged_loss: bool,
) -> MetadataDecision {
    MetadataDecision {
        keep_metadata: keep_requested && metadata_preservable,
        orientation: 1,
        dimensions_updated: true,
        acknowledged_loss: acknowledged_loss || !keep_requested,
    }
}

pub fn metadata_loss_unacknowledged(decision: &MetadataDecision) -> bool {
    !decision.keep_metadata && !decision.acknowledged_loss
}

/// Validated PNG header. No pixel decoder runs in the parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PngInfo {
    pub width: u32,
    pub height: u32,
    pub has_alpha: bool,
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

pub fn validate_png(bytes: &[u8]) -> Result<PngInfo, String> {
    if bytes.len() < 33 || bytes[..8] != PNG_SIGNATURE {
        return Err("ai.model_output".into());
    }
    let length = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if length != 13 || &bytes[12..16] != b"IHDR" {
        return Err("ai.model_output".into());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    let bit_depth = bytes[24];
    let color_type = bytes[25];
    if width == 0
        || height == 0
        || width > MAX_IMAGE_EDGE
        || height > MAX_IMAGE_EDGE
        || bit_depth != 8
        || !matches!(color_type, 0 | 2 | 3 | 4 | 6)
    {
        return Err("ai.model_output".into());
    }
    let has_alpha = matches!(color_type, 4 | 6);
    Ok(PngInfo {
        width,
        height,
        has_alpha,
    })
}

/// Independent output check: exact expected dimensions, PNG mime, source
/// untouched and alpha retained when the source had transparency.
pub fn validate_upscale_output(
    source_width: u32,
    source_height: u32,
    expected: UpscaleDimensions,
    source_had_alpha: bool,
    bytes: &[u8],
) -> Result<PngInfo, String> {
    // The 256 MiB cap belongs to the encoded *input*; an ordinary encoded
    // result may use the 1 GiB protocol/artifact output budget.
    if bytes.len() as u64 > crate::protocol::MAX_OUTPUT_BYTES {
        return Err("ai.unsupported".into());
    }
    let png = validate_png(bytes)?;
    if png.width != expected.width || png.height != expected.height {
        return Err("ai.model_output".into());
    }
    if png.width <= source_width || png.height <= source_height {
        return Err("ai.model_output".into());
    }
    if source_had_alpha && !png.has_alpha {
        return Err("ai.model_output".into());
    }
    Ok(png)
}

impl UpscaleModel {
    /// Fixed catalog model ids (D4); the UI shows translated labels, not these.
    pub fn model_id(self) -> &'static str {
        match self {
            UpscaleModel::General => "realesr-general-x4v3",
            UpscaleModel::Photo => "RealESRGAN_x4plus",
            UpscaleModel::Drawing => "RealESRGAN_x4plus_anime_6B",
        }
    }
}

/// A model that fails its parity fixture is disabled until a new build passes.
#[derive(Debug, Default)]
pub struct ModelParityRegistry {
    state: std::sync::Mutex<BTreeMap<&'static str, bool>>,
}

impl ModelParityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, model_id: &'static str, passed: bool) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "ai-parity lock poisoned".to_string())?;
        state.insert(model_id, passed);
        Ok(())
    }

    pub fn is_enabled(&self, model_id: &str) -> bool {
        self.state
            .lock()
            .map(|state| state.get(model_id).copied().unwrap_or(false))
            .unwrap_or(false)
    }
}
