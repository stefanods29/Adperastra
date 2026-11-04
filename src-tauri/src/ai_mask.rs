//! Deterministic image-mask math for Step 17b (D3/D4).
//!
//! This module is deliberately dependency-free (`std` only) so the same code
//! is exercised by `crates/ai-runtime/tests/step17b_images.rs` through a
//! `#[path]` include. It never guesses model output: probabilities and
//! generated pixels arrive from the confined helper, and only the exact
//! compositing rules live here.
#![allow(dead_code)]

pub const MAX_IMAGE_EDGE: u32 = 32_768;
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000;
pub const MAX_ENCODED_BYTES: u64 = 268_435_456;
/// A mask may mark at most half of the image for erasing.
pub const MAX_ERASE_PERCENT: u32 = 50;
pub const MAX_BRUSH_RADIUS: u32 = 256;
pub const DEFAULT_BRUSH_RADIUS: u32 = 24;
pub const MAX_BLUR_RADIUS: u8 = 64;

pub const ERR_INVALID: &str = "ai_actions.invalid";
pub const ERR_TOO_LARGE: &str = "ai_actions.too_large";
pub const ERR_EMPTY_MASK: &str = "ai_actions.empty_mask";
pub const ERR_MASK_TOO_LARGE: &str = "ai_actions.image_mask_too_large";
pub const ERR_SOURCE_CHANGED: &str = "ai_actions.source_changed";
pub const ERR_FAILED: &str = "ai_actions.failed";

/// One soft, 8-bit mask exactly the size of its source image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoftMask {
    width: u32,
    height: u32,
    alpha: Vec<u8>,
}

impl SoftMask {
    pub fn new(width: u32, height: u32, alpha: Vec<u8>) -> Result<Self, String> {
        validate_source_size(width, height, 0)?;
        if alpha.len() != width as usize * height as usize {
            return Err(ERR_INVALID.to_string());
        }
        Ok(Self {
            width,
            height,
            alpha,
        })
    }

    pub fn empty(width: u32, height: u32) -> Result<Self, String> {
        validate_source_size(width, height, 0)?;
        Ok(Self {
            width,
            height,
            alpha: vec![0; width as usize * height as usize],
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn alpha(&self) -> &[u8] {
        &self.alpha
    }

    pub fn alpha_mut(&mut self) -> &mut [u8] {
        &mut self.alpha
    }

    pub fn at(&self, x: u32, y: u32) -> u8 {
        if x >= self.width || y >= self.height {
            return 0;
        }
        self.alpha[y as usize * self.width as usize + x as usize]
    }

    pub fn is_empty(&self) -> bool {
        self.alpha.iter().all(|value| *value == 0)
    }

    /// Percentage of pixels marked for erasing (0..=100, rounded down).
    pub fn erased_percent(&self) -> u32 {
        let total = self.alpha.len() as u64;
        if total == 0 {
            return 0;
        }
        let marked = self.alpha.iter().filter(|value| **value >= 128).count() as u64;
        ((marked * 100) / total) as u32
    }
}

/// Shared image bounds for every action that touches pixels (D5).
pub fn validate_source_size(width: u32, height: u32, encoded_bytes: u64) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err(ERR_INVALID.to_string());
    }
    if width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if width as u64 * height as u64 > MAX_IMAGE_PIXELS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if encoded_bytes > MAX_ENCODED_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    Ok(())
}

fn rgba_len(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

/// `final_alpha = round(original_alpha * mask_alpha / 255)`; RGB untouched.
pub fn apply_alpha_mask(rgba: &[u8], mask: &SoftMask) -> Result<Vec<u8>, String> {
    if rgba.len() != rgba_len(mask.width, mask.height) {
        return Err(ERR_INVALID.to_string());
    }
    let mut out = rgba.to_vec();
    for (index, alpha) in mask.alpha.iter().enumerate() {
        let original = out[index * 4 + 3] as u32;
        let mixed = (original * (*alpha as u32) + 127) / 255;
        out[index * 4 + 3] = mixed as u8;
    }
    Ok(out)
}

fn gaussian_kernel(radius: u8) -> Vec<f32> {
    let radius = radius.clamp(1, MAX_BLUR_RADIUS) as i32;
    let sigma = radius as f32 / 3.0;
    let mut kernel = Vec::with_capacity((radius * 2 + 1) as usize);
    let mut sum = 0.0f32;
    for offset in -radius..=radius {
        let value = (-(offset as f32 * offset as f32) / (2.0 * sigma * sigma)).exp();
        kernel.push(value);
        sum += value;
    }
    for value in kernel.iter_mut() {
        *value /= sum;
    }
    kernel
}

fn blur_axis(
    rgba: &[u8],
    width: usize,
    height: usize,
    kernel: &[f32],
    horizontal: bool,
) -> Vec<u8> {
    let radius = (kernel.len() / 2) as i32;
    let mut out = vec![0u8; rgba.len()];
    for y in 0..height {
        for x in 0..width {
            for channel in 0..4 {
                let mut value = 0.0f32;
                for (index, weight) in kernel.iter().enumerate() {
                    let offset = index as i32 - radius;
                    let (sx, sy) = if horizontal {
                        ((x as i32 + offset).clamp(0, width as i32 - 1) as usize, y)
                    } else {
                        (x, (y as i32 + offset).clamp(0, height as i32 - 1) as usize)
                    };
                    value += weight * rgba[(sy * width + sx) * 4 + channel] as f32;
                }
                out[(y * width + x) * 4 + channel] = value.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// 14b Gaussian: radius 1..64 source pixels, sigma = radius / 3, edge clamp.
pub fn gaussian_blur_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    radius: u8,
) -> Result<Vec<u8>, String> {
    validate_source_size(width, height, 0)?;
    if rgba.len() != rgba_len(width, height) {
        return Err(ERR_INVALID.to_string());
    }
    if !(1..=MAX_BLUR_RADIUS).contains(&radius) {
        return Err(ERR_INVALID.to_string());
    }
    let kernel = gaussian_kernel(radius);
    let (w, h) = (width as usize, height as usize);
    let horizontal = blur_axis(rgba, w, h, &kernel, true);
    Ok(blur_axis(&horizontal, w, h, &kernel, false))
}

/// `mask * original + (1 - mask) * blurred`; the original alpha is unchanged.
pub fn composite_blur(
    rgba: &[u8],
    width: u32,
    height: u32,
    mask: &SoftMask,
    radius: u8,
) -> Result<Vec<u8>, String> {
    if mask.width != width || mask.height != height {
        return Err(ERR_INVALID.to_string());
    }
    let blurred = gaussian_blur_rgba(rgba, width, height, radius)?;
    let mut out = rgba.to_vec();
    for index in 0..mask.alpha.len() {
        let weight = mask.alpha[index] as u32;
        for channel in 0..3 {
            let original = rgba[index * 4 + channel] as u32;
            let background = blurred[index * 4 + channel] as u32;
            out[index * 4 + channel] =
                ((original * weight + background * (255 - weight) + 127) / 255) as u8;
        }
        out[index * 4 + 3] = rgba[index * 4 + 3];
    }
    Ok(out)
}

/// Binary erase hole: `>= 128` means erase, `0` keeps the source pixel.
pub fn binary_hole(mask: &SoftMask) -> Result<Vec<bool>, String> {
    if mask.is_empty() {
        return Err(ERR_EMPTY_MASK.to_string());
    }
    if mask.erased_percent() > MAX_ERASE_PERCENT {
        return Err(ERR_MASK_TOO_LARGE.to_string());
    }
    Ok(mask.alpha.iter().map(|value| *value >= 128).collect())
}

/// Inside the hole the generated RGB is used; outside, every byte is copied.
/// Alpha always comes from the original image (D3/D4).
pub fn composite_inpaint(
    original: &[u8],
    generated: &[u8],
    mask: &SoftMask,
) -> Result<Vec<u8>, String> {
    let expected = rgba_len(mask.width, mask.height);
    if original.len() != expected || generated.len() != expected {
        return Err(ERR_INVALID.to_string());
    }
    let hole = binary_hole(mask)?;
    let mut out = original.to_vec();
    for (index, erase) in hole.iter().enumerate() {
        if *erase {
            out[index * 4] = generated[index * 4];
            out[index * 4 + 1] = generated[index * 4 + 1];
            out[index * 4 + 2] = generated[index * 4 + 2];
        }
    }
    Ok(out)
}

/// One rectangular keyboard alternative: coordinates in image space.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaskRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl MaskRect {
    pub fn validate(self, image_width: u32, image_height: u32) -> Result<Self, String> {
        if self.width == 0 || self.height == 0 {
            return Err(ERR_INVALID.to_string());
        }
        if self
            .x
            .checked_add(self.width)
            .is_none_or(|right| right > image_width)
        {
            return Err(ERR_INVALID.to_string());
        }
        if self
            .y
            .checked_add(self.height)
            .is_none_or(|bottom| bottom > image_height)
        {
            return Err(ERR_INVALID.to_string());
        }
        Ok(self)
    }
}

/// Marks a rectangle as erase (255) in place; used by the keyboard path.
pub fn paint_rect(mask: &mut SoftMask, rect: MaskRect) -> Result<(), String> {
    let checked = rect.validate(mask.width, mask.height)?;
    for y in checked.y..checked.y + checked.height {
        for x in checked.x..checked.x + checked.width {
            mask.alpha[y as usize * mask.width as usize + x as usize] = 255;
        }
    }
    Ok(())
}

/// One straight brush segment in image coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BrushSegment {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub radius: u32,
}

/// Paints a round, hard-edged brush segment (`alpha >= 128` means erase).
pub fn paint_brush(mask: &mut SoftMask, segment: BrushSegment) -> Result<(), String> {
    if !(1..=MAX_BRUSH_RADIUS).contains(&segment.radius) {
        return Err(ERR_INVALID.to_string());
    }
    let radius = segment.radius as i64;
    let left = (segment.x0.min(segment.x1) as i64 - radius).max(0);
    let right = (segment.x0.max(segment.x1) as i64 + radius).min(mask.width as i64 - 1);
    let top = (segment.y0.min(segment.y1) as i64 - radius).max(0);
    let bottom = (segment.y0.max(segment.y1) as i64 + radius).min(mask.height as i64 - 1);
    if right < left || bottom < top {
        return Ok(());
    }
    let dx = (segment.x1 - segment.x0) as i64;
    let dy = (segment.y1 - segment.y0) as i64;
    let length_squared = (dx * dx + dy * dy).max(1);
    for y in top..=bottom {
        for x in left..=right {
            let px = x - segment.x0 as i64;
            let py = y - segment.y0 as i64;
            let t = ((px * dx + py * dy) as f64 / length_squared as f64).clamp(0.0, 1.0);
            let nearest_x = segment.x0 as f64 + t * dx as f64;
            let nearest_y = segment.y0 as f64 + t * dy as f64;
            let distance = ((x as f64 - nearest_x).powi(2) + (y as f64 - nearest_y).powi(2)).sqrt();
            if distance <= radius as f64 {
                mask.alpha[y as usize * mask.width as usize + x as usize] = 255;
            }
        }
    }
    Ok(())
}

/// Bilinear resample of one f32 plane; used for model masks and probabilities.
pub fn resize_plane_bilinear(
    src: &[f32],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Vec<f32> {
    if src_width == 0 || src_height == 0 || dst_width == 0 || dst_height == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0f32; dst_width as usize * dst_height as usize];
    if dst_width == src_width && dst_height == src_height {
        out.copy_from_slice(src);
        return out;
    }
    let scale_x = (src_width - 1) as f32 / (dst_width - 1).max(1) as f32;
    let scale_y = (src_height - 1) as f32 / (dst_height - 1).max(1) as f32;
    for y in 0..dst_height {
        let sy = y as f32 * scale_y;
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(src_height - 1);
        let fy = sy - y0 as f32;
        for x in 0..dst_width {
            let sx = x as f32 * scale_x;
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(src_width - 1);
            let fx = sx - x0 as f32;
            let p00 = src[(y0 * src_width + x0) as usize];
            let p10 = src[(y0 * src_width + x1) as usize];
            let p01 = src[(y1 * src_width + x0) as usize];
            let p11 = src[(y1 * src_width + x1) as usize];
            let top = p00 + (p10 - p00) * fx;
            let bottom = p01 + (p11 - p01) * fx;
            out[(y * dst_width + x) as usize] = top + (bottom - top) * fy;
        }
    }
    out
}

/// A capture is valid only for the revision it was made from.
pub fn require_same_revision(captured: u64, expected: u64) -> Result<(), String> {
    if captured != expected || expected == 0 {
        return Err(ERR_SOURCE_CHANGED.to_string());
    }
    Ok(())
}

/// Nearest allowed `image_mask_too_large` check before inference starts.
pub fn check_mask_budget(mask: &SoftMask) -> Result<(), String> {
    if mask.is_empty() {
        return Err(ERR_EMPTY_MASK.to_string());
    }
    if mask.erased_percent() > MAX_ERASE_PERCENT {
        return Err(ERR_MASK_TOO_LARGE.to_string());
    }
    Ok(())
}

/// The compact UI description the native side paints itself, so a mask never
/// crosses IPC as megabytes of pixels (pitfall P-10).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaskSpec {
    Rect(MaskRect),
    Strokes(Vec<BrushSegment>),
}

/// Paints a UI mask spec in image coordinates.
pub fn mask_from_spec(width: u32, height: u32, spec: &MaskSpec) -> Result<SoftMask, String> {
    let mut mask = SoftMask::empty(width, height)?;
    match spec {
        MaskSpec::Rect(rect) => paint_rect(&mut mask, *rect)?,
        MaskSpec::Strokes(strokes) => {
            if strokes.is_empty() || strokes.len() > 4_096 {
                return Err(ERR_EMPTY_MASK.to_string());
            }
            for stroke in strokes {
                paint_brush(&mut mask, *stroke)?;
            }
        }
    }
    check_mask_budget(&mask)?;
    Ok(mask)
}
