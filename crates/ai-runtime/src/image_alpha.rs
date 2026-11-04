//! Alpha handling for enlargement (D5).
//!
//! Colour is inferred from RGB; the original alpha plane is resized with
//! Lanczos3 and reattached. A fully transparent pixel stays fully transparent.

use crate::upscale_tiles::RgbaImage;

pub const ALPHA_BACKGROUND_WHITE: [u8; 4] = [255, 255, 255, 255];

fn lanczos3(x: f64) -> f64 {
    if x.abs() < f64::EPSILON {
        return 1.0;
    }
    if x.abs() >= 3.0 {
        return 0.0;
    }
    let pi = std::f64::consts::PI;
    let px = pi * x;
    (3.0 * px.sin() * (px / 3.0).sin()) / (px * px)
}

fn sample(plane: &[u8], width: u32, height: u32, x: i64, y: i64) -> f64 {
    let px = if width <= 1 {
        0
    } else {
        x.clamp(0, i64::from(width) - 1)
    };
    let py = if height <= 1 {
        0
    } else {
        y.clamp(0, i64::from(height) - 1)
    };
    f64::from(plane[py as usize * width as usize + px as usize])
}

/// Lanczos3 resize of one 8-bit alpha plane.
#[allow(clippy::needless_range_loop)]
pub fn resize_alpha_lanczos3(
    source: &[u8],
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> Result<Vec<u8>, String> {
    if source_width == 0
        || source_height == 0
        || target_width == 0
        || target_height == 0
        || source.len() != source_width as usize * source_height as usize
    {
        return Err("ai.bad_request".into());
    }
    if source_width == target_width && source_height == target_height {
        return Ok(source.to_vec());
    }
    let mut out = vec![0u8; target_width as usize * target_height as usize];
    let x_ratio = f64::from(source_width) / f64::from(target_width);
    let y_ratio = f64::from(source_height) / f64::from(target_height);
    for oy in 0..target_height {
        let center_y = (f64::from(oy) + 0.5) * y_ratio - 0.5;
        let top = (center_y - 3.0 * y_ratio.max(1.0)).floor() as i64;
        let bottom = (center_y + 3.0 * y_ratio.max(1.0)).ceil() as i64;
        for ox in 0..target_width {
            let center_x = (f64::from(ox) + 0.5) * x_ratio - 0.5;
            let left = (center_x - 3.0 * x_ratio.max(1.0)).floor() as i64;
            let right = (center_x + 3.0 * x_ratio.max(1.0)).ceil() as i64;
            let mut sum = 0.0f64;
            let mut weights = 0.0f64;
            for sy in top..=bottom {
                let wy = lanczos3((sy as f64 - center_y) / y_ratio.max(1.0));
                if wy == 0.0 {
                    continue;
                }
                for sx in left..=right {
                    let wx = lanczos3((sx as f64 - center_x) / x_ratio.max(1.0));
                    let weight = wx * wy;
                    if weight == 0.0 {
                        continue;
                    }
                    sum += sample(source, source_width, source_height, sx, sy) * weight;
                    weights += weight;
                }
            }
            if weights.abs() < f64::EPSILON {
                return Err("ai.model_output".into());
            }
            out[oy as usize * target_width as usize + ox as usize] =
                (sum / weights).clamp(0.0, 255.0).round() as u8;
        }
    }
    Ok(out)
}

/// Reattach the resized alpha plane. RGB is never changed by the model's
/// alpha channel and a pixel whose resized alpha rounds to zero stays zero.
#[allow(clippy::needless_range_loop)]
pub fn attach_alpha(rgb: &RgbaImage, alpha: &[u8]) -> Result<RgbaImage, String> {
    let expected = rgb.width as usize * rgb.height as usize;
    if alpha.len() != expected || rgb.pixels.len() != expected * 4 {
        return Err("ai.bad_request".into());
    }
    let mut pixels = rgb.pixels.clone();
    for index in 0..expected {
        pixels[index * 4 + 3] = alpha[index];
    }
    RgbaImage::new(rgb.width, rgb.height, pixels)
}

/// Formats without an alpha channel need an explicit, acknowledged background.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlphaPolicy {
    pub retain_alpha: bool,
    pub background: [u8; 4],
    pub acknowledged_transparency_loss: bool,
}

pub fn resolve_alpha_policy(
    output_supports_alpha: bool,
    source_has_alpha: bool,
    acknowledged_transparency_loss: bool,
) -> AlphaPolicy {
    AlphaPolicy {
        retain_alpha: output_supports_alpha && source_has_alpha,
        background: ALPHA_BACKGROUND_WHITE,
        acknowledged_transparency_loss: acknowledged_transparency_loss || !source_has_alpha,
    }
}

pub fn transparency_loss_unacknowledged(policy: &AlphaPolicy) -> bool {
    !policy.retain_alpha && !policy.acknowledged_transparency_loss
}
