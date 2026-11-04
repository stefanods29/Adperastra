//! Tiled enlargement (D5): 256x256 source cores, 64px context, reflect101.
//!
//! Both scales infer at 4x. A 2x result downsamples each completed 4x tile,
//! including its 64px context, before the core is copied, so filter taps see
//! real neighboring pixels across a core boundary without allocating a global
//! 4x plane for a large source.

use crate::types::{ImageRect, UpscaleScale};
use crate::upscale::UpscaleDimensions;

pub const CORE_EDGE: u32 = 256;
pub const CONTEXT_EDGE: u32 = 64;
pub const MODEL_SCALE: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceRect {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
}

impl SourceRect {
    pub fn right(self) -> i64 {
        self.x + i64::from(self.width)
    }

    pub fn bottom(self) -> i64 {
        self.y + i64::from(self.height)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpscaleTile {
    /// Real source pixels copied into the final result.
    pub core: ImageRect,
    /// Core plus 64px context on every side (may extend outside the source).
    pub input: SourceRect,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilePlan {
    pub width: u32,
    pub height: u32,
    pub scale: UpscaleScale,
    pub output: UpscaleDimensions,
    pub tiles: Vec<UpscaleTile>,
}

/// Row-major cores with a constant 64px context. The same plan is used for
/// preview crops and full images; only the crop rectangle differs.
pub fn plan_tiles(width: u32, height: u32, scale: UpscaleScale) -> Result<TilePlan, String> {
    if width == 0 || height == 0 {
        return Err("ai.bad_request".into());
    }
    let output = crate::upscale::check_upscale_limits(width, height, scale)
        .map_err(|_| "ai.unsupported".to_string())?;
    let mut tiles = Vec::new();
    let mut y = 0;
    while y < height {
        let mut x = 0;
        while x < width {
            let core_width = CORE_EDGE.min(width - x);
            let core_height = CORE_EDGE.min(height - y);
            tiles.push(UpscaleTile {
                core: ImageRect {
                    x,
                    y,
                    width: core_width,
                    height: core_height,
                },
                input: SourceRect {
                    x: i64::from(x) - i64::from(CONTEXT_EDGE),
                    y: i64::from(y) - i64::from(CONTEXT_EDGE),
                    width: core_width + CONTEXT_EDGE * 2,
                    height: core_height + CONTEXT_EDGE * 2,
                },
            });
            x += CORE_EDGE;
        }
        y += CORE_EDGE;
    }
    Ok(TilePlan {
        width,
        height,
        scale,
        output,
        tiles,
    })
}

/// Clamp-once reflected 101 indexing. `-1` maps to `1`, not to `0`.
pub fn reflect101_index(index: i64, size: u32) -> u32 {
    if size <= 1 {
        return 0;
    }
    let period = 2 * (i64::from(size) - 1);
    let mut value = index % period;
    if value < 0 {
        value += period;
    }
    if value >= i64::from(size) {
        value = period - value;
    }
    value as u32
}

#[derive(Debug, Clone)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

impl RgbaImage {
    pub fn new(width: u32, height: u32, pixels: Vec<u8>) -> Result<Self, String> {
        let expected = usize::try_from(width)
            .ok()
            .and_then(|w| usize::try_from(height).ok().and_then(|h| w.checked_mul(h)))
            .and_then(|n| n.checked_mul(4))
            .ok_or("ai.bad_request")?;
        if width == 0 || height == 0 || pixels.len() != expected {
            return Err("ai.bad_request".into());
        }
        Ok(Self {
            width,
            height,
            pixels,
        })
    }

    fn source_pixel(&self, x: i64, y: i64) -> [u8; 4] {
        let px = reflect101_index(x, self.width);
        let py = reflect101_index(y, self.height);
        let offset = ((py as usize * self.width as usize) + px as usize) * 4;
        [
            self.pixels[offset],
            self.pixels[offset + 1],
            self.pixels[offset + 2],
            self.pixels[offset + 3],
        ]
    }
}

/// Planar RGB in 0..1 for the ONNX model (NCHW is added by the helper).
pub fn extract_model_input(image: &RgbaImage, rect: SourceRect) -> Vec<f32> {
    let count = rect.width as usize * rect.height as usize;
    let mut out = vec![0.0f32; count * 3];
    for row in 0..rect.height {
        for column in 0..rect.width {
            let pixel = image.source_pixel(rect.x + i64::from(column), rect.y + i64::from(row));
            let index = row as usize * rect.width as usize + column as usize;
            out[index] = f32::from(pixel[0]) / 255.0;
            out[count + index] = f32::from(pixel[1]) / 255.0;
            out[count * 2 + index] = f32::from(pixel[2]) / 255.0;
        }
    }
    out
}

/// Copy the model's 4x core (after cropping its 64px context) into the
/// assembled 4x plane. `model_output` is RGBA8 at `input * 4`.
pub fn copy_core_output(
    assembled: &mut [u8],
    assembled_width: u32,
    tile: &UpscaleTile,
    model_output: &[u8],
) -> Result<(), String> {
    let scale = MODEL_SCALE as usize;
    let expected = tile.input.width as usize * scale * tile.input.height as usize * scale * 4;
    if model_output.len() != expected {
        return Err("ai.model_output".into());
    }
    let context_out = CONTEXT_EDGE as usize * scale; // pixels, not bytes
    let model_stride = tile.input.width as usize * scale * 4;
    let assembled_stride = assembled_width as usize * 4;
    let core_rows = tile.core.height as usize * scale;
    let core_bytes = tile.core.width as usize * scale * 4;
    for row in 0..core_rows {
        let source = (context_out + row) * model_stride + context_out * 4;
        let target = (tile.core.y as usize * scale + row) * assembled_stride
            + tile.core.x as usize * scale * 4;
        if target + core_bytes > assembled.len() || source + core_bytes > model_output.len() {
            return Err("ai.model_output".into());
        }
        assembled[target..target + core_bytes]
            .copy_from_slice(&model_output[source..source + core_bytes]);
    }
    Ok(())
}

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

/// One global Lanczos3 half-scale pass over one complete 4x tile (or plane).
/// RGB is premultiplied by alpha so transparent edges do not bleed color.
#[allow(clippy::needless_range_loop)]
pub fn downsample_half_lanczos3(source: &RgbaImage) -> Result<RgbaImage, String> {
    if source.width & 1 != 0 || source.height & 1 != 0 {
        return Err("ai.bad_request".into());
    }
    let width = source.width / 2;
    let height = source.height / 2;
    let mut out = vec![0u8; width as usize * height as usize * 4];
    for oy in 0..height {
        for ox in 0..width {
            let mut sums = [0.0f64; 4];
            let mut weight_sum = 0.0f64;
            let center_y = (f64::from(oy) + 0.5) * 2.0 - 0.5;
            let center_x = (f64::from(ox) + 0.5) * 2.0 - 0.5;
            let top = (center_y - 3.0).floor() as i64;
            let bottom = (center_y + 3.0).ceil() as i64;
            let left = (center_x - 3.0).floor() as i64;
            let right = (center_x + 3.0).ceil() as i64;
            for sy in top..=bottom {
                let wy = lanczos3(sy as f64 - center_y);
                if wy == 0.0 {
                    continue;
                }
                for sx in left..=right {
                    let wx = lanczos3(sx as f64 - center_x);
                    let weight = wx * wy;
                    if weight == 0.0 {
                        continue;
                    }
                    let pixel = source.source_pixel(sx, sy);
                    let alpha = f64::from(pixel[3]) / 255.0;
                    sums[0] += f64::from(pixel[0]) * alpha * weight;
                    sums[1] += f64::from(pixel[1]) * alpha * weight;
                    sums[2] += f64::from(pixel[2]) * alpha * weight;
                    sums[3] += f64::from(pixel[3]) * weight;
                    weight_sum += weight;
                }
            }
            if weight_sum.abs() < f64::EPSILON {
                return Err("ai.model_output".into());
            }
            let alpha = (sums[3] / weight_sum).clamp(0.0, 255.0);
            let alpha_unit = alpha / 255.0;
            let offset = ((oy as usize * width as usize) + ox as usize) * 4;
            for channel in 0..3 {
                let value = if alpha_unit <= f64::EPSILON {
                    0.0
                } else {
                    (sums[channel] / weight_sum / alpha_unit).clamp(0.0, 255.0)
                };
                out[offset + channel] = value.round() as u8;
            }
            out[offset + 3] = alpha.round() as u8;
        }
    }
    RgbaImage::new(width, height, out)
}

/// Largest per-channel difference and mean absolute difference (0..255).
pub fn seam_metrics(reference: &RgbaImage, candidate: &RgbaImage) -> Result<(u8, f64), String> {
    if reference.width != candidate.width || reference.height != candidate.height {
        return Err("ai.bad_request".into());
    }
    let mut max = 0u8;
    let mut total = 0u64;
    for (left, right) in reference.pixels.iter().zip(candidate.pixels.iter()) {
        let difference = left.abs_diff(*right);
        max = max.max(difference);
        total += u64::from(difference);
    }
    let mean = if reference.pixels.is_empty() {
        0.0
    } else {
        total as f64 / reference.pixels.len() as f64
    };
    Ok((max, mean))
}
