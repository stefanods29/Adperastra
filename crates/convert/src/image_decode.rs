//! Bounded raster decoding (Step 08a D3/D6).
//!
//! The parser sees only helper-owned bytes. Limits are applied before any
//! pixel allocation, EXIF orientation is applied to the pixels, and the
//! output never carries an un-applied orientation.

use std::io::Cursor;

use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageReader, Limits, RgbaImage};

use crate::error::ConvertError;
use crate::options::target_size;
use crate::types::{
    FormatId, ImageOptions, MAX_IMAGE_DIMENSION, MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_PIXELS,
};

/// One decoded source with its orientation already baked into the pixels.
pub struct DecodedImage {
    pub image: DynamicImage,
    pub orientation: Orientation,
    pub source_width: u32,
    pub source_height: u32,
}

/// Decode one source and apply the option box. A source larger than the
/// declared limits is refused before pixels are allocated.
pub fn decode_image(
    bytes: &[u8],
    format: FormatId,
    options: &ImageOptions,
) -> Result<DecodedImage, ConvertError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_INPUT_BYTES {
        return Err(ConvertError::TooLarge);
    }
    let mut reader = ImageReader::new(Cursor::new(bytes));
    reader.set_format(image_format(format).ok_or(ConvertError::Unsupported)?);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_PIXELS.saturating_mul(4));
    reader.limits(limits);
    let mut decoder = reader.into_decoder()?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(ConvertError::TooLarge);
    }
    // helper memory stays bounded even at the largest accepted source.
    let decoded_bytes = u64::from(width) * u64::from(height) * 4;
    if decoded_bytes.saturating_add(bytes.len() as u64) > 900 * 1024 * 1024 {
        return Err(ConvertError::TooLarge);
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder)?;
    if orientation != Orientation::NoTransforms {
        image.apply_orientation(orientation);
    }
    let (target_width, target_height) = target_size(image.width(), image.height(), options);
    if (target_width, target_height) != (image.width(), image.height()) {
        image = image.resize_exact(target_width, target_height, FilterType::Lanczos3);
    }
    Ok(DecodedImage {
        image,
        orientation,
        source_width: width,
        source_height: height,
    })
}

/// All frames of an animated GIF, bounded by the same pixel budget.
pub fn decode_gif_frames(
    bytes: &[u8],
    options: &ImageOptions,
) -> Result<Vec<image::Frame>, ConvertError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_INPUT_BYTES {
        return Err(ConvertError::TooLarge);
    }
    let mut decoder = image::codecs::gif::GifDecoder::new(Cursor::new(bytes))
        .map_err(|_| ConvertError::Unsupported)?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(ConvertError::TooLarge);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_PIXELS * 4);
    decoder.set_limits(limits)?;
    let mut total_pixels = 0u64;
    let mut frames = Vec::new();
    for frame in decoder.into_frames() {
        let frame = frame.map_err(|_| ConvertError::Unsupported)?;
        let delay = frame.delay();
        let buffer: RgbaImage = frame.into_buffer();
        total_pixels =
            total_pixels.saturating_add(u64::from(buffer.width()) * u64::from(buffer.height()));
        if total_pixels > MAX_IMAGE_PIXELS {
            return Err(ConvertError::TooLarge);
        }
        let image = DynamicImage::ImageRgba8(buffer);
        let (target_width, target_height) = target_size(image.width(), image.height(), options);
        let resized = if (target_width, target_height) != (image.width(), image.height()) {
            image.resize_exact(target_width, target_height, FilterType::Lanczos3)
        } else {
            image
        };
        let buffer = resized.to_rgba8();
        frames.push(image::Frame::from_parts(buffer, 0, 0, delay));
        if frames.len() > 10_000 {
            return Err(ConvertError::TooLarge);
        }
    }
    if frames.is_empty() {
        return Err(ConvertError::Unsupported);
    }
    Ok(frames)
}

pub fn image_format(format: FormatId) -> Option<image::ImageFormat> {
    crate::options::image_format_of(format)
}

/// A small PNG preview of an already decoded image, never upscaled.
pub fn preview_png(image: &DynamicImage, edge: u32) -> Result<(Vec<u8>, u32, u32), ConvertError> {
    let image = if image.width() > edge || image.height() > edge {
        let scale = (edge as f64 / image.width() as f64).min(edge as f64 / image.height() as f64);
        let width = ((image.width() as f64) * scale).round().max(1.0) as u32;
        let height = ((image.height() as f64) * scale).round().max(1.0) as u32;
        image.resize_exact(width, height, FilterType::Triangle)
    } else {
        image.clone()
    };
    let mut out = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(ConvertError::from)?;
    if out.len() > crate::types::MAX_PREVIEW_BYTES {
        return Err(ConvertError::TooLarge);
    }
    Ok((out, image.width(), image.height()))
}
