//! Pure option rules: target size, naming, preflight losses and acceptance
//! (Step 08a D4-D7).
//!
//! The parent and the helper both call `preflight`; a conversion never
//! starts its first output until every required category and warning is in
//! the request's accepted lists.

use std::collections::BTreeSet;
use std::io::Cursor;
use std::time::{SystemTime, UNIX_EPOCH};

use image::metadata::Orientation;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader};

use crate::error::ConvertError;
use crate::registry::ConvertSource;
use crate::types::{
    ConversionWarningCode, ConvertOptions, ConverterSpec, FormatId, ImageOptions, MetadataCategory,
    MAX_IMAGE_DIMENSION, MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_PIXELS, MAX_NAME_UNITS,
};

/// The image facts a preflight needs without keeping decoded pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageFacts {
    pub width: u32,
    pub height: u32,
    pub orientation: Orientation,
    pub transparent: bool,
    pub animated: bool,
}

/// The losses and warnings one exact input/options combination requires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredChanges {
    pub metadata_lost: Vec<MetadataCategory>,
    pub warnings: Vec<ConversionWarningCode>,
}

/// Fit source pixels into the option box. Never upscales unless allowed.
pub fn target_size(width: u32, height: u32, options: &ImageOptions) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let mut scale = 1.0_f64;
    if let Some(max_width) = options.width {
        scale = scale.min(f64::from(max_width) / f64::from(width));
    }
    if let Some(max_height) = options.height {
        scale = scale.min(f64::from(max_height) / f64::from(height));
    }
    if !options.keep_aspect {
        // Both axes were given: use each one exactly.
        if let (Some(max_width), Some(max_height)) = (options.width, options.height) {
            let (mut target_width, mut target_height) = (max_width, max_height);
            if !options.allow_upscale {
                target_width = target_width.min(width);
                target_height = target_height.min(height);
            }
            return (target_width.max(1), target_height.max(1));
        }
    }
    if !options.allow_upscale {
        scale = scale.min(1.0);
    }
    let target_width = (f64::from(width) * scale).round().max(1.0) as u32;
    let target_height = (f64::from(height) * scale).round().max(1.0) as u32;
    (
        target_width.min(MAX_IMAGE_DIMENSION),
        target_height.min(MAX_IMAGE_DIMENSION),
    )
}

/// Decode enough of an image to know its size, orientation, alpha and
/// animation. The source bytes are helper-owned and already bounded.
pub fn inspect_image(bytes: &[u8], format: FormatId) -> Result<ImageFacts, ConvertError> {
    if bytes.len() as u64 > MAX_IMAGE_INPUT_BYTES {
        return Err(ConvertError::TooLarge);
    }
    if format == FormatId::Svg {
        return Err(ConvertError::BadRequest);
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(ConvertError::Io)?;
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
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let animated = is_animated(bytes, format);
    let decoded = DynamicImage::from_decoder(decoder)?;
    let transparent = if decoded.color().has_alpha() {
        match decoded.as_rgba8() {
            Some(image) => image.pixels().any(|pixel| pixel.0[3] < 255),
            None => decoded.to_rgba8().pixels().any(|pixel| pixel.0[3] < 255),
        }
    } else {
        false
    };
    Ok(ImageFacts {
        width,
        height,
        orientation,
        transparent,
        animated,
    })
}

/// Container-level animation detection. GIF is read as frames (at most two);
/// PNG and WebP expose an animation flag in their header.
pub fn is_animated(bytes: &[u8], format: FormatId) -> bool {
    match format {
        FormatId::Gif => {
            let Ok(decoder) = image::codecs::gif::GifDecoder::new(Cursor::new(bytes)) else {
                return false;
            };
            let mut frames = decoder.into_frames();
            frames.next().is_some() && frames.next().is_some()
        }
        FormatId::Png => png_has_chunk(bytes, b"acTL"),
        FormatId::Webp => webp_is_animated(bytes),
        _ => false,
    }
}

fn png_has_chunk(bytes: &[u8], name: &[u8; 4]) -> bool {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    let mut offset = 8_usize;
    let mut chunks = 0;
    while offset + 8 <= bytes.len() && chunks < 64 {
        chunks += 1;
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        if offset + 8 + length + 4 > bytes.len() {
            return false;
        }
        if &bytes[offset + 4..offset + 8] == name {
            return true;
        }
        if &bytes[offset + 4..offset + 8] == b"IDAT" {
            return false;
        }
        offset += 12 + length;
    }
    false
}

fn webp_is_animated(bytes: &[u8]) -> bool {
    if bytes.len() < 21 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return false;
    }
    &bytes[12..16] == b"VP8X" && bytes[20] & 0x02 != 0
}

/// The source format an adapter names, from the extension first and the
/// MIME second. A mismatch with the real bytes is caught by the decoder.
pub fn source_format(source: &ConvertSource) -> Result<FormatId, ConvertError> {
    let extension = source
        .name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("");
    if let Some(format) = FormatId::from_extension(extension) {
        return Ok(format);
    }
    FormatId::from_mime(&source.mime).ok_or(ConvertError::Unsupported)
}

/// The per-source metadata categories this adapter really keeps. ICC, XMP
/// and IPTC are copied only between JPEG files in this round; everywhere
/// else they are reported lost instead of claimed.
pub fn preserved_for(source: FormatId, target: FormatId) -> BTreeSet<MetadataCategory> {
    let mut kept = BTreeSet::new();
    if matches!(
        target,
        FormatId::Jpeg | FormatId::Png | FormatId::Tiff | FormatId::Webp
    ) && matches!(
        source,
        FormatId::Jpeg | FormatId::Png | FormatId::Tiff | FormatId::Webp
    ) {
        for category in [
            MetadataCategory::Exif,
            MetadataCategory::Gps,
            MetadataCategory::Camera,
            MetadataCategory::Date,
            MetadataCategory::Author,
            MetadataCategory::Comments,
        ] {
            kept.insert(category);
        }
    }
    if source == FormatId::Jpeg && target == FormatId::Jpeg {
        kept.insert(MetadataCategory::Icc);
        kept.insert(MetadataCategory::Xmp);
        kept.insert(MetadataCategory::Iptc);
    }
    kept
}

/// Compute every change the user must accept for this exact request.
pub fn preflight(
    spec: &ConverterSpec,
    sources: &mut [ConvertSource],
    options: &ConvertOptions,
) -> Result<RequiredChanges, ConvertError> {
    let ConvertOptions::Image(image_options) = options else {
        return Err(ConvertError::BadRequest);
    };
    if !spec.available || !spec.output.is_writable_image() {
        return Err(ConvertError::Unsupported);
    }
    let mut lost = BTreeSet::new();
    let mut warnings = BTreeSet::new();
    for source in sources.iter_mut() {
        let format = source_format(source)?;
        if !spec.inputs.contains(&format) {
            return Err(ConvertError::Unsupported);
        }
        let bytes = source.read_bounded(spec.max_input_bytes)?;
        if format == FormatId::Svg {
            if spec.inputs.contains(&FormatId::Svg) && spec.output == FormatId::Png {
                continue;
            }
            return Err(ConvertError::Unsupported);
        }
        let facts = inspect_image(&bytes, format)?;
        if image_options.metadata_keep {
            let present = crate::metadata::present_categories(&bytes, format)?;
            let kept = preserved_for(format, spec.output);
            for category in present {
                if !kept.contains(&category) {
                    lost.insert(category);
                }
            }
        }
        if facts.transparent && !spec.output.supports_alpha() {
            warnings.insert(ConversionWarningCode::TransparencyLoss);
        }
        if facts.animated && !(format == FormatId::Gif && spec.output == FormatId::Gif) {
            warnings.insert(ConversionWarningCode::AnimationFirstFrame);
        }
        if spec.output == FormatId::Gif {
            warnings.insert(ConversionWarningCode::PaletteReduction);
        }
        if facts.width > MAX_IMAGE_DIMENSION || facts.height > MAX_IMAGE_DIMENSION {
            return Err(ConvertError::TooLarge);
        }
    }
    Ok(RequiredChanges {
        metadata_lost: lost.into_iter().collect(),
        warnings: warnings.into_iter().collect(),
    })
}

/// Refuse before the first output when any required item was not accepted.
pub fn verify_accepted(
    required: &RequiredChanges,
    accepted_losses: &[MetadataCategory],
    accepted_warnings: &[ConversionWarningCode],
) -> Result<(), ConvertError> {
    let losses: BTreeSet<_> = accepted_losses.iter().copied().collect();
    if required
        .metadata_lost
        .iter()
        .any(|item| !losses.contains(item))
    {
        return Err(ConvertError::MetadataLoss);
    }
    let warnings: BTreeSet<_> = accepted_warnings.iter().copied().collect();
    if required
        .warnings
        .iter()
        .any(|item| !warnings.contains(item))
    {
        return Err(ConvertError::WarningRequired);
    }
    Ok(())
}

/// `photo.png` -> `photo`; an empty stem becomes `output`.
pub fn output_stem(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = match base.rfind('.') {
        Some(dot) if dot > 0 => &base[..dot],
        _ => base,
    };
    if stem.trim().is_empty() {
        "output".to_string()
    } else {
        stem.to_string()
    }
}

/// `report` + png -> `report.png`, never longer than a Windows name.
pub fn output_name(stem: &str, format: FormatId) -> String {
    let extension = format.extension();
    let mut budget = MAX_NAME_UNITS.saturating_sub(extension.len() + 1);
    let mut kept = String::new();
    for character in stem.chars() {
        let units = character.len_utf16();
        if units > budget {
            break;
        }
        budget -= units;
        kept.push(character);
    }
    if kept.is_empty() {
        kept.push_str("output");
    }
    format!("{kept}.{extension}")
}

/// `photo (1).png`, `photo (2).png`, ...; attempt 0 is the plain name.
pub fn collision_name(name: &str, attempt: u32) -> String {
    if attempt == 0 {
        return name.to_string();
    }
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({}){}", &name[..dot], attempt, &name[dot..]),
        _ => format!("{name} ({attempt})"),
    }
}

/// Today's UTC date as `YYYY-MM-DD`, calculated without a time crate.
pub fn current_utc_date() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0) as i64;
    let days = seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant's `civil_from_days`, for UTC dates.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The decoder format a source names, for error routing in tests.
pub fn image_format_of(format: FormatId) -> Option<ImageFormat> {
    Some(match format {
        FormatId::Png => ImageFormat::Png,
        FormatId::Jpeg => ImageFormat::Jpeg,
        FormatId::Webp => ImageFormat::WebP,
        FormatId::Bmp => ImageFormat::Bmp,
        FormatId::Gif => ImageFormat::Gif,
        FormatId::Tiff => ImageFormat::Tiff,
        FormatId::Ico => ImageFormat::Ico,
        _ => return None,
    })
}
