#![allow(dead_code)] // Public producer API; consumed from later steps.
//! Bounded pixel preparation for Windows OCR (Step 07e plan D4).
//!
//! The decoder itself is 07a E8 (`thumbnail_decode::decode_pixels`): it opens
//! the guarded source, applies EXIF orientation and scales inside the
//! requested square. This module only performs the OCR-specific steps:
//! clamp the longest edge to 4096 and the product to 16,777,216 pixels,
//! never upscale, composite transparent pixels onto white, and hand Windows
//! a BGRA8 buffer. Raw pixels never cross IPC.

use crate::thumbnail_decode::DecodedPixels;

/// One prepared BGRA8 image for `SoftwareBitmap.CreateCopyFromBuffer`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedPixels {
    pub width: u32,
    pub height: u32,
    /// BGRA8, white background, alpha 255. Length is `width*height*4`.
    pub bgra: Vec<u8>,
    /// Orientation-corrected original dimensions (plan E2 mapping).
    pub original_width: u32,
    pub original_height: u32,
    /// EXIF orientation the decoder applied (1 = upright).
    pub orientation: u8,
}

/// The target size for an image given the OCR limits. Never upscales and
/// keeps at least one pixel in each dimension.
pub fn downscale_target(
    width: u32,
    height: u32,
    max_edge: u32,
    max_pixels: u64,
) -> Result<(u32, u32), String> {
    if width == 0 || height == 0 || max_edge == 0 || max_pixels == 0 {
        return Err("ocr.bad_request".to_string());
    }
    let longest = u64::from(width.max(height));
    let pixels = u64::from(width) * u64::from(height);
    let mut scale = 1.0f64;
    if longest > u64::from(max_edge) {
        scale = scale.min(f64::from(max_edge) / longest as f64);
    }
    if pixels > max_pixels {
        scale = scale.min((max_pixels as f64 / pixels as f64).sqrt());
    }
    if scale >= 1.0 {
        return Ok((width, height));
    }
    let mut target_width = ((f64::from(width) * scale).round() as u32).max(1);
    let mut target_height = ((f64::from(height) * scale).round() as u32).max(1);
    // Rounding may overshoot a cap by one pixel; shrink until it fits.
    while u64::from(target_width) * u64::from(target_height) > max_pixels
        || target_width.max(target_height) > max_edge
    {
        if target_width >= target_height && target_width > 1 {
            target_width -= 1;
        } else if target_height > 1 {
            target_height -= 1;
        } else {
            break;
        }
    }
    Ok((target_width, target_height))
}

fn checked_rgba_length(width: u32, height: u32) -> Result<usize, String> {
    let expected = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|value| value.checked_mul(4))
        .ok_or_else(|| "ocr.too_large".to_string())?;
    usize::try_from(expected).map_err(|_| "ocr.too_large".to_string())
}

/// A box-filter downscale of RGBA pixels (never upscales).
pub fn downscale_rgba(
    source: &[u8],
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || target_width == 0 || target_height == 0 {
        return Err("ocr.bad_request".to_string());
    }
    if target_width > width || target_height > height {
        return Err("ocr.bad_request".to_string());
    }
    let source_len = checked_rgba_length(width, height)?;
    if source.len() != source_len {
        return Err("ocr.bad_request".to_string());
    }
    let target_len = checked_rgba_length(target_width, target_height)?;
    if target_width == width && target_height == height {
        let mut copy = Vec::with_capacity(source_len);
        copy.extend_from_slice(source);
        return Ok(copy);
    }
    let mut output = vec![0u8; target_len];
    for target_y in 0..target_height {
        let top = u64::from(target_y) * u64::from(height) / u64::from(target_height);
        let bottom = ((u64::from(target_y) + 1) * u64::from(height) / u64::from(target_height))
            .max(top + 1)
            .min(u64::from(height));
        for target_x in 0..target_width {
            let left = u64::from(target_x) * u64::from(width) / u64::from(target_width);
            let right = ((u64::from(target_x) + 1) * u64::from(width) / u64::from(target_width))
                .max(left + 1)
                .min(u64::from(width));
            let mut sums = [0u64; 4];
            let mut count = 0u64;
            for y in top..bottom {
                for x in left..right {
                    let index = ((y * u64::from(width) + x) * 4) as usize;
                    sums[0] += u64::from(source[index]);
                    sums[1] += u64::from(source[index + 1]);
                    sums[2] += u64::from(source[index + 2]);
                    sums[3] += u64::from(source[index + 3]);
                    count += 1;
                }
            }
            let target_index = ((u64::from(target_y) * u64::from(target_width)
                + u64::from(target_x))
                * 4) as usize;
            for channel in 0..4 {
                output[target_index + channel] = ((sums[channel] + count / 2) / count) as u8;
            }
        }
    }
    Ok(output)
}

/// Composite BGRA pixels (the order 07a E8 produces) onto white with alpha
/// 255. Windows OCR ignores alpha, so transparent areas must already be
/// white. Channel order is kept; nothing is swapped twice.
pub fn composite_bgra_on_white(source: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let expected = checked_rgba_length(width, height)?;
    if source.len() != expected {
        return Err("ocr.bad_request".to_string());
    }
    let mut output = vec![0u8; expected];
    for pixel in 0..expected / 4 {
        let index = pixel * 4;
        let blue = u32::from(source[index]);
        let green = u32::from(source[index + 1]);
        let red = u32::from(source[index + 2]);
        let alpha = u32::from(source[index + 3]);
        let blend =
            |channel: u32| -> u8 { ((channel * alpha + 255 * (255 - alpha) + 127) / 255) as u8 };
        output[index] = blend(blue);
        output[index + 1] = blend(green);
        output[index + 2] = blend(red);
        output[index + 3] = 255;
    }
    Ok(output)
}

/// Validate decoded pixels and prepare the OCR bitmap.
pub fn prepare_pixels(
    decoded: &DecodedPixels,
    max_edge: u32,
    max_pixels: u64,
) -> Result<PreparedPixels, String> {
    if decoded.width == 0 || decoded.height == 0 {
        return Err("ocr.bad_request".to_string());
    }
    if decoded.stride != decoded.width.saturating_mul(4) {
        return Err("ocr.bad_request".to_string());
    }
    let expected = checked_rgba_length(decoded.width, decoded.height)?;
    if decoded.rgba.len() != expected {
        return Err("ocr.bad_request".to_string());
    }
    if decoded.original_width == 0 || decoded.original_height == 0 {
        return Err("ocr.bad_request".to_string());
    }
    let (width, height) = downscale_target(decoded.width, decoded.height, max_edge, max_pixels)?;
    let rgba = downscale_rgba(&decoded.rgba, decoded.width, decoded.height, width, height)?;
    let bgra = composite_bgra_on_white(&rgba, width, height)?;
    Ok(PreparedPixels {
        width,
        height,
        bgra,
        original_width: decoded.original_width,
        original_height: decoded.original_height,
        orientation: decoded.orientation,
    })
}

#[cfg(test)]
mod tests {
    use super::{composite_bgra_on_white, downscale_rgba, downscale_target, prepare_pixels};
    use crate::thumbnail_decode::DecodedPixels;

    #[test]
    fn ten_thousand_by_five_thousand_fits_the_4096_edge() {
        assert_eq!(
            downscale_target(10_000, 5_000, 4_096, 16_777_216),
            Ok((4_096, 2_048))
        );
    }

    #[test]
    fn small_images_are_never_upscaled() {
        assert_eq!(downscale_target(20, 10, 4_096, 16_777_216), Ok((20, 10)));
    }

    #[test]
    fn zero_and_invalid_dimensions_are_rejected() {
        assert!(downscale_target(0, 10, 4_096, 16_777_216).is_err());
        assert!(downscale_target(10, 0, 4_096, 16_777_216).is_err());
        assert!(downscale_target(10, 10, 0, 16_777_216).is_err());
        assert!(downscale_target(10, 10, 4_096, 0).is_err());
        let decoded = DecodedPixels {
            width: 2,
            height: 2,
            stride: 9,
            rgba: vec![0; 16],
            original_width: 2,
            original_height: 2,
            orientation: 1,
        };
        assert!(prepare_pixels(&decoded, 4_096, 16_777_216).is_err());
    }

    #[test]
    fn transparent_pixels_become_white_bgra() {
        // 07a E8 names the buffer `rgba` but documents it as BGRA from WIC.
        let bgra = [0u8, 0, 0, 0, 30, 20, 10, 255];
        let composited = composite_bgra_on_white(&bgra, 2, 1).unwrap();
        assert_eq!(&composited[0..4], &[255, 255, 255, 255]);
        assert_eq!(&composited[4..8], &[30, 20, 10, 255]);
    }

    #[test]
    fn box_downscale_averages_four_pixels() {
        let rgba = [0, 0, 0, 255, 100, 0, 0, 255, 0, 100, 0, 255, 0, 0, 100, 255];
        let scaled = downscale_rgba(&rgba, 2, 2, 1, 1).unwrap();
        assert_eq!(scaled, vec![25, 25, 25, 255]);
    }
}
