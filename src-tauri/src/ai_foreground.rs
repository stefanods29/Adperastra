//! Local background removal and blur (Step 17b D2/D3).
//!
//! BiRefNet is pinned by 14c. This module owns the deterministic input
//! preparation, the sigmoid/resize rules and the two composites. Inference
//! itself is supplied by a confined `ForegroundModel` adapter; without a
//! verified adapter the action fails instead of inventing a mask.
#![allow(dead_code)]


use crate::ai_mask::{
    apply_alpha_mask, composite_blur, resize_plane_bilinear, validate_source_size, SoftMask,
    ERR_FAILED, ERR_INVALID, DEFAULT_BRUSH_RADIUS,
};

/// Fixed model input edge (`1x3x1024x1024`).
pub const FOREGROUND_EDGE: u32 = 1_024;
pub const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
pub const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];
/// The binary selection threshold; the soft alpha is kept for compositing.
pub const FOREGROUND_THRESHOLD: f32 = 0.5;
pub const DEFAULT_BLUR_RADIUS: u8 = 16;
pub const MIN_BLUR_RADIUS: u8 = 1;
pub const MAX_BLUR_RADIUS: u8 = 64;

/// A verified, confined foreground model.
pub trait ForegroundModel: Send + Sync {
    /// `input` is normalized RGB `NCHW 1x3x1024x1024`; returns mask logits
    /// `N1HW` with exactly `1024 * 1024` finite values.
    fn predict(&self, input: &[f32]) -> Result<Vec<f32>, String>;
}

fn f32_len(width: u32, height: u32) -> usize {
    width as usize * height as usize
}

/// Bilinear RGB resize followed by the exact ImageNet normalization.
pub fn model_input(rgba: &[u8], width: u32, height: u32) -> Result<Vec<f32>, String> {
    validate_source_size(width, height, 0)?;
    if rgba.len() != f32_len(width, height) * 4 {
        return Err(ERR_INVALID.to_string());
    }
    let mut planes = [
        vec![0.0f32; width as usize * height as usize],
        vec![0.0f32; width as usize * height as usize],
        vec![0.0f32; width as usize * height as usize],
    ];
    for (index, pixel) in rgba.as_chunks::<4>().0.iter().enumerate() {
        for channel in 0..3 {
            planes[channel][index] = pixel[channel] as f32 / 255.0;
        }
    }
    let mut input = vec![0.0f32; 3 * f32_len(FOREGROUND_EDGE, FOREGROUND_EDGE)];
    for channel in 0..3 {
        let resized = resize_plane_bilinear(&planes[channel], width, height, FOREGROUND_EDGE, FOREGROUND_EDGE);
        let offset = channel * f32_len(FOREGROUND_EDGE, FOREGROUND_EDGE);
        for (index, value) in resized.iter().enumerate() {
            input[offset + index] = (*value - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel];
        }
    }
    Ok(input)
}

/// `1 / (1 + exp(-x))`, clamped so no NaN or infinity leaves the model.
pub fn sigmoid(logits: &[f32]) -> Vec<f32> {
    logits
        .iter()
        .map(|value| {
            if value.is_nan() {
                return 0.0;
            }
            if *value >= 0.0 {
                1.0 / (1.0 + (-value.min(60.0)).exp())
            } else {
                let exp = value.max(-60.0).exp();
                exp / (1.0 + exp)
            }
        })
        .collect()
}

/// Resizes the model mask to the source and stores soft alpha 0..255 exactly.
pub fn soft_mask_from_logits(logits: &[f32], width: u32, height: u32) -> Result<SoftMask, String> {
    if logits.len() != f32_len(FOREGROUND_EDGE, FOREGROUND_EDGE) {
        return Err(ERR_FAILED.to_string());
    }
    let probabilities = sigmoid(logits);
    let resized = resize_plane_bilinear(&probabilities, FOREGROUND_EDGE, FOREGROUND_EDGE, width, height);
    let alpha = resized
        .iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();
    SoftMask::new(width, height, alpha)
}

/// The hard selection other consumers use; the soft mask stays for composites.
pub fn binary_selection(mask: &SoftMask, threshold: f32) -> Vec<bool> {
    let threshold = if (0.0..=1.0).contains(&threshold) { threshold } else { FOREGROUND_THRESHOLD };
    mask.alpha().iter().map(|value| *value as f32 / 255.0 >= threshold).collect()
}

/// Remove background: keep RGB, multiply alpha by the soft mask (D3).
pub fn remove_background(rgb: &[u8], width: u32, height: u32, model: &dyn ForegroundModel) -> Result<Vec<u8>, String> {
    let input = model_input(rgb, width, height)?;
    let logits = model.predict(&input)?;
    let mask = soft_mask_from_logits(&logits, width, height)?;
    apply_alpha_mask(rgb, &mask)
}

/// Blur background: composite mask * original + (1 - mask) * blurred.
pub fn blur_background(
    rgba: &[u8],
    width: u32,
    height: u32,
    radius: u8,
    model: &dyn ForegroundModel,
) -> Result<Vec<u8>, String> {
    if !(MIN_BLUR_RADIUS..=MAX_BLUR_RADIUS).contains(&radius) {
        return Err(ERR_INVALID.to_string());
    }
    let input = model_input(rgba, width, height)?;
    let logits = model.predict(&input)?;
    let mask = soft_mask_from_logits(&logits, width, height)?;
    composite_blur(rgba, width, height, &mask, radius)
}

/// Range check shared by the dialog and the native command.
pub fn validate_radius(radius: u8) -> Result<u8, String> {
    if (MIN_BLUR_RADIUS..=MAX_BLUR_RADIUS).contains(&radius) {
        Ok(radius)
    } else {
        Err(ERR_INVALID.to_string())
    }
}

/// The default radius is 16 source pixels; the UI shows the real value.
pub fn default_radius() -> u8 {
    DEFAULT_BLUR_RADIUS
}

/// Brush defaults used by the mask editor (kept next to the mask rules).
pub fn default_brush_radius() -> u32 {
    DEFAULT_BRUSH_RADIUS
}
