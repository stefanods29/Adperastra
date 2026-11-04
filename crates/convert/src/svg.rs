//! SVG to PNG with no external resources (Step 08a D1).
//!
//! resvg 0.49 is built without system fonts, SVGZ and raster image decoding.
//! Both image href resolvers return `None`, `resources_dir` is unset, and a
//! DOCTYPE or stylesheet processing instruction is refused before parsing.
//! There is no network client in this crate, so an `https:` href has nothing
//! that could fetch it.

use image::{DynamicImage, RgbaImage};
use resvg::tiny_skia;
use resvg::usvg;

use crate::error::ConvertError;
use crate::types::{ImageOptions, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS};

/// Refuse declarations that could ask for external entities or styles.
pub fn validate_svg(bytes: &[u8]) -> Result<(), ConvertError> {
    if bytes.len() as u64 > crate::types::MAX_IMAGE_INPUT_BYTES {
        return Err(ConvertError::TooLarge);
    }
    let head = bytes;
    if contains_ignore_case(head, b"<!doctype") || contains_ignore_case(head, b"<?xml-stylesheet") {
        return Err(ConvertError::Unsupported);
    }
    if bytes.starts_with(&[0x1F, 0x8B]) {
        // SVGZ is a feature this build does not enable.
        return Err(ConvertError::Unsupported);
    }
    Ok(())
}

/// Render an SVG into pixels. `edge` limits the preview; `None` uses the
/// user's width/height options.
pub fn render_svg(
    bytes: &[u8],
    options: &ImageOptions,
    edge: Option<u32>,
) -> Result<DynamicImage, ConvertError> {
    validate_svg(bytes)?;
    let resolve_data =
        Box::new(|_: &str, _: std::sync::Arc<Vec<u8>>, _: &usvg::Options| None::<usvg::ImageKind>);
    let resolve_string = Box::new(|_: &str, _: &usvg::Options| None::<usvg::ImageKind>);
    let opt = usvg::Options {
        resources_dir: None,
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data,
            resolve_string,
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(bytes, &opt).map_err(|_| ConvertError::Unsupported)?;
    let intrinsic = tree.size().to_int_size();
    let source_width = intrinsic.width().max(1);
    let source_height = intrinsic.height().max(1);
    let (mut target_width, mut target_height) = if let Some(edge) = edge {
        fit(
            source_width,
            source_height,
            Some(edge),
            Some(edge),
            true,
            true,
        )
    } else {
        // A vector may legitimately be enlarged; only the absolute bounds
        // and the 100 MP product still apply.
        fit(
            source_width,
            source_height,
            options.width,
            options.height,
            options.keep_aspect,
            true,
        )
    };
    if target_width > MAX_IMAGE_DIMENSION {
        target_width = MAX_IMAGE_DIMENSION;
    }
    if target_height > MAX_IMAGE_DIMENSION {
        target_height = MAX_IMAGE_DIMENSION;
    }
    if u64::from(target_width) * u64::from(target_height) > MAX_IMAGE_PIXELS {
        return Err(ConvertError::TooLarge);
    }
    let mut pixmap =
        tiny_skia::Pixmap::new(target_width, target_height).ok_or(ConvertError::TooLarge)?;
    let scale_x = target_width as f32 / source_width as f32;
    let scale_y = target_height as f32 / source_height as f32;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale_x, scale_y),
        &mut pixmap.as_mut(),
    );
    // tiny-skia stores premultiplied alpha; image buffers are straight
    // alpha, so undo the multiply before the pixels leave this module.
    let mut rgba = pixmap.data().to_vec();
    for pixel in rgba.as_chunks_mut::<4>().0 {
        let alpha = u32::from(pixel[3]);
        if alpha > 0 && alpha < 255 {
            for channel in pixel.iter_mut().take(3) {
                let straight = (u32::from(*channel) * 255 + alpha / 2) / alpha;
                *channel = straight.min(255) as u8;
            }
        }
    }
    let image =
        RgbaImage::from_raw(target_width, target_height, rgba).ok_or(ConvertError::TooLarge)?;
    Ok(DynamicImage::ImageRgba8(image))
}

fn fit(
    width: u32,
    height: u32,
    box_width: Option<u32>,
    box_height: Option<u32>,
    keep_aspect: bool,
    allow_upscale: bool,
) -> (u32, u32) {
    let mut scale = 1.0_f64;
    if let Some(max_width) = box_width {
        scale = scale.min(f64::from(max_width) / f64::from(width));
    }
    if let Some(max_height) = box_height {
        scale = scale.min(f64::from(max_height) / f64::from(height));
    }
    if !keep_aspect {
        if let (Some(max_width), Some(max_height)) = (box_width, box_height) {
            let (mut target_width, mut target_height) = (max_width, max_height);
            if !allow_upscale {
                target_width = target_width.min(width);
                target_height = target_height.min(height);
            }
            return (target_width.max(1), target_height.max(1));
        }
    }
    if !allow_upscale {
        scale = scale.min(1.0);
    }
    (
        (f64::from(width) * scale).round().max(1.0) as u32,
        (f64::from(height) * scale).round().max(1.0) as u32,
    )
}

fn contains_ignore_case(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}
