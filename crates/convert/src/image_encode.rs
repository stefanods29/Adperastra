//! Explicit encoders for the six approved image outputs (Step 08a D1/D2).
//!
//! WebP is lossless only; its quality option is not advertised. JPEG and
//! BMP have no alpha, so transparent pixels are composited on the chosen
//! background (the loss is acknowledged before this runs).

use image::codecs::bmp::BmpEncoder;
use image::codecs::gif::GifEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::tiff::TiffEncoder;
use image::codecs::webp::WebPEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbImage};

use crate::error::ConvertError;
use crate::types::{FormatId, ImageOptions};

/// Encode one image with the exact options the preview used.
pub fn encode_image(
    image: &DynamicImage,
    target: FormatId,
    options: &ImageOptions,
) -> Result<Vec<u8>, ConvertError> {
    let mut out = Vec::new();
    match target {
        FormatId::Jpeg => {
            let rgb = flatten(image, options.background_rgba);
            JpegEncoder::new_with_quality(&mut out, options.quality).write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )?;
        }
        FormatId::Png => {
            let rgba = image.to_rgba8();
            PngEncoder::new(&mut out).write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ExtendedColorType::Rgba8,
            )?;
        }
        FormatId::Webp => {
            // Lossless only: no fake quality control.
            let rgba = image.to_rgba8();
            WebPEncoder::new_lossless(&mut out).write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ExtendedColorType::Rgba8,
            )?;
        }
        FormatId::Bmp => {
            let rgb = flatten(image, options.background_rgba);
            BmpEncoder::new(&mut out).write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )?;
        }
        FormatId::Tiff => {
            let rgba = image.to_rgba8();
            TiffEncoder::new(std::io::Cursor::new(&mut out)).write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ExtendedColorType::Rgba8,
            )?;
        }
        FormatId::Gif => {
            let rgba = image.to_rgba8();
            GifEncoder::new(&mut out).write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ExtendedColorType::Rgba8,
            )?;
        }
        _ => return Err(ConvertError::Unsupported),
    }
    Ok(out)
}

/// Encode all frames of an animated GIF in the same option box.
pub fn encode_gif_frames(
    frames: Vec<image::Frame>,
    _options: &ImageOptions,
) -> Result<Vec<u8>, ConvertError> {
    let mut out = Vec::new();
    let mut encoder = GifEncoder::new_with_speed(&mut out, 10);
    for frame in frames {
        encoder.encode_frame(frame)?;
    }
    drop(encoder);
    Ok(out)
}

/// Composite RGBA over an opaque background.
pub fn flatten(image: &DynamicImage, background: [u8; 4]) -> RgbImage {
    let rgba = image.to_rgba8();
    let mut rgb = RgbImage::new(rgba.width(), rgba.height());
    for (pixel, source) in rgb.pixels_mut().zip(rgba.pixels()) {
        let alpha = u32::from(source.0[3]);
        let inverse = 255 - alpha;
        let mix = |channel: usize| -> u8 {
            ((u32::from(source.0[channel]) * alpha
                + u32::from(background[channel]) * inverse
                + 127)
                / 255) as u8
        };
        *pixel = image::Rgb([mix(0), mix(1), mix(2)]);
    }
    rgb
}

/// A quick, honest estimate: source bytes scaled by the output/source pixel
/// ratio, then adjusted for the target's compression family.
pub fn estimated_bytes(
    source_bytes: u64,
    source_pixels: u64,
    output_pixels: u64,
    target: FormatId,
) -> u64 {
    if source_pixels == 0 {
        return source_bytes;
    }
    let scaled = source_bytes.saturating_mul(output_pixels) / source_pixels;
    match target {
        FormatId::Jpeg => scaled.saturating_mul(6) / 10,
        FormatId::Webp => scaled.saturating_mul(8) / 10,
        FormatId::Gif => scaled.saturating_mul(9) / 10,
        _ => scaled,
    }
}
