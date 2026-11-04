//! Local object erase (Step 17b D4).
//!
//! MI-GAN needs the full frame, so the action accepts at most 4096 px per
//! edge and 16 MP; a larger picture must first be cropped. The deterministic
//! part here is the mask polarity, the size budget and the final composite:
//! outside the binary hole every source byte is copied exactly.
#![allow(dead_code)]

use crate::ai_mask::{
    binary_hole, composite_inpaint, require_same_revision, validate_source_size, SoftMask,
    ERR_INVALID, ERR_TOO_LARGE,
};

/// MI-GAN is bounded to a full frame pipeline.
pub const MAX_INPAINT_EDGE: u32 = 4_096;
pub const MAX_INPAINT_PIXELS: u64 = 16_000_000;

/// A verified, confined MI-GAN adapter.
pub trait InpaintModel: Send + Sync {
    /// Receives RGB `NCHW 1x3xHxW` and a uint8 mask `N1HW` (255 erase,
    /// 0 keep); returns RGB pixels in the same order.
    fn generate(&self, rgb: &[u8], mask: &SoftMask) -> Result<Vec<u8>, String>;
}

/// Refuses an image MI-GAN cannot process whole; the UI offers a crop.
pub fn validate_inpaint_size(width: u32, height: u32) -> Result<(), String> {
    validate_source_size(width, height, 0)?;
    if width > MAX_INPAINT_EDGE || height > MAX_INPAINT_EDGE {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if width as u64 * height as u64 > MAX_INPAINT_PIXELS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    Ok(())
}

/// The UI brush uses `alpha >= 128` as "erase"; convert the polarity once.
pub fn mask_value_from_ui_alpha(alpha: u8) -> u8 {
    if alpha >= 128 {
        255
    } else {
        0
    }
}

/// Builds the native binary mask from UI brush alpha values.
pub fn mask_from_ui_alpha(width: u32, height: u32, alpha: &[u8]) -> Result<SoftMask, String> {
    if alpha.len() != width as usize * height as usize {
        return Err(ERR_INVALID.to_string());
    }
    let converted = alpha
        .iter()
        .map(|value| mask_value_from_ui_alpha(*value))
        .collect();
    SoftMask::new(width, height, converted)
}

/// The source revision the mask was captured from must still be current.
pub fn check_mask_source(captured_revision: u64, expected_revision: u64) -> Result<(), String> {
    require_same_revision(captured_revision, expected_revision)
}

/// Runs the model and returns the final RGBA: outside bytes exact, inside
/// generated RGB with the original alpha.
pub fn erase_object(
    rgba: &[u8],
    width: u32,
    height: u32,
    mask: &SoftMask,
    model: &dyn InpaintModel,
) -> Result<Vec<u8>, String> {
    validate_inpaint_size(width, height)?;
    if mask.width() != width || mask.height() != height {
        return Err(ERR_INVALID.to_string());
    }
    if rgba.len() != width as usize * height as usize * 4 {
        return Err(ERR_INVALID.to_string());
    }
    // Refuses an empty or over-half mask before any inference is queued.
    binary_hole(mask)?;
    let rgb: Vec<u8> = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    let generated = model.generate(&rgb, mask)?;
    if generated.len() != rgb.len() {
        return Err("ai_actions.failed".to_string());
    }
    let mut generated_rgba = vec![0u8; rgba.len()];
    for (index, pixel) in generated.as_chunks::<3>().0.iter().enumerate() {
        generated_rgba[index * 4] = pixel[0];
        generated_rgba[index * 4 + 1] = pixel[1];
        generated_rgba[index * 4 + 2] = pixel[2];
        generated_rgba[index * 4 + 3] = rgba[index * 4 + 3];
    }
    composite_inpaint(rgba, &generated_rgba, mask)
}

/// A larger picture offers a crop instead of silently downsampling (D5).
pub fn crop_required(width: u32, height: u32) -> bool {
    width > MAX_INPAINT_EDGE
        || height > MAX_INPAINT_EDGE
        || width as u64 * height as u64 > MAX_INPAINT_PIXELS
}
