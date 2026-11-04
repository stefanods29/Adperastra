//! Bounded metadata inspection and preservation (Step 08a D5/D6).
//!
//! little_exif 0.6.0 owns EXIF on bytes: `Metadata::new_from_vec` and
//! `Metadata::write_to_vec`. A user path is never reopened. ICC, XMP and
//! IPTC are copied as opaque JPEG APP segments only when both sides are
//! JPEG; every other combination reports those categories as lost instead
//! of claiming they were kept.

use std::collections::BTreeSet;

use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;

use crate::error::ConvertError;
use crate::types::{FormatId, MetadataCategory};

/// Metadata this module is willing to buffer or copy.
pub const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;
/// A JPEG APP segment payload never exceeds 65,533 bytes.
const MAX_APP_PAYLOAD: usize = 65_533;

fn file_extension(format: FormatId) -> Option<FileExtension> {
    Some(match format {
        FormatId::Jpeg => FileExtension::JPEG,
        FormatId::Png => FileExtension::PNG {
            as_zTXt_chunk: false,
        },
        FormatId::Tiff => FileExtension::TIFF,
        FormatId::Webp => FileExtension::WEBP,
        _ => return None,
    })
}

fn read_exif(bytes: &Vec<u8>, format: FormatId) -> Option<Metadata> {
    let extension = file_extension(format)?;
    Metadata::new_from_vec(bytes, extension).ok()
}

/// Every metadata category present in the source bytes, whether or not this
/// build can rewrite it. A category that cannot be kept becomes an explicit
/// loss the user must accept.
pub fn present_categories(
    bytes: &Vec<u8>,
    format: FormatId,
) -> Result<Vec<MetadataCategory>, ConvertError> {
    if bytes.len() > crate::types::MAX_IMAGE_INPUT_BYTES as usize {
        return Err(ConvertError::TooLarge);
    }
    let mut present = BTreeSet::new();
    let mut exif_bytes = false;
    if let Some(metadata) = read_exif(bytes, format) {
        for tag in &metadata {
            present.insert(classify(tag));
            exif_bytes = true;
        }
    }
    match format {
        FormatId::Jpeg => {
            for segment in jpeg_segments(bytes)? {
                if segment.payload.starts_with(b"Exif\0\0") {
                    exif_bytes = true;
                } else if segment.payload.starts_with(b"http://ns.adobe.com/xap/1.0/")
                    || segment
                        .payload
                        .starts_with(b"http://ns.adobe.com/xmp/extension/")
                {
                    present.insert(MetadataCategory::Xmp);
                } else if segment.payload.starts_with(b"ICC_PROFILE\0") {
                    present.insert(MetadataCategory::Icc);
                } else if segment.payload.starts_with(b"Photoshop 3.0\0") {
                    present.insert(MetadataCategory::Iptc);
                }
            }
        }
        FormatId::Png => {
            for chunk in png_chunks(bytes)? {
                if chunk.kind == *b"iCCP" {
                    present.insert(MetadataCategory::Icc);
                } else if chunk.kind == *b"eXIf" {
                    exif_bytes = true;
                } else if chunk.kind == *b"iTXt"
                    && chunk.payload.starts_with(b"XML:com.adobe.xmp\0")
                {
                    present.insert(MetadataCategory::Xmp);
                }
            }
        }
        FormatId::Webp => {
            if contains_ascii(bytes, b"EXIF") {
                exif_bytes = true;
            }
            if contains_ascii(bytes, b"XMP ") {
                present.insert(MetadataCategory::Xmp);
            }
            if contains_ascii(bytes, b"ICCP") {
                present.insert(MetadataCategory::Icc);
            }
        }
        FormatId::Tiff => {
            if contains_ascii(bytes, b"ICC_PROFILE") {
                present.insert(MetadataCategory::Icc);
            }
            if contains_ascii(bytes, b"<x:xmpmeta") {
                present.insert(MetadataCategory::Xmp);
            }
        }
        _ => {}
    }
    if exif_bytes {
        present.insert(MetadataCategory::Exif);
    }
    Ok(present.into_iter().collect())
}

fn classify(tag: &ExifTag) -> MetadataCategory {
    use ExifTag::*;
    match tag {
        GPSLatitude(_) | GPSLongitude(_) | GPSAltitude(_) | GPSTimeStamp(_) | GPSLatitudeRef(_)
        | GPSLongitudeRef(_) | GPSAltitudeRef(_) | GPSMapDatum(_) | GPSDestLatitude(_)
        | GPSDestLongitude(_) => MetadataCategory::Gps,
        Make(_) | Model(_) | LensMake(_) | LensModel(_) | SerialNumber(_) | LensSerialNumber(_) => {
            MetadataCategory::Camera
        }
        ModifyDate(_)
        | CreateDate(_)
        | DateTimeOriginal(_)
        | OffsetTime(_)
        | OffsetTimeOriginal(_)
        | OffsetTimeDigitized(_) => MetadataCategory::Date,
        Artist(_) | Copyright(_) => MetadataCategory::Author,
        ImageDescription(_) | UserComment(_) => MetadataCategory::Comments,
        _ => MetadataCategory::Exif,
    }
}

/// Write the source's EXIF (orientation normalized to 1) onto an encoded
/// output and copy the JPEG opaque segments where this round supports them.
/// The returned list is what actually could not be kept.
pub fn attach_metadata(
    output: &mut Vec<u8>,
    target: FormatId,
    source: &Vec<u8>,
    source_format: FormatId,
    metadata_keep: bool,
) -> Result<Vec<MetadataCategory>, ConvertError> {
    let present = present_categories(source, source_format)?;
    if !metadata_keep {
        return Ok(Vec::new());
    }
    let kept = crate::options::preserved_for(source_format, target);
    let mut lost: BTreeSet<MetadataCategory> = present
        .iter()
        .copied()
        .filter(|category| !kept.contains(category))
        .collect();
    let wanted_exif = present.iter().any(|category| {
        *category != MetadataCategory::Icc
            && *category != MetadataCategory::Xmp
            && *category != MetadataCategory::Iptc
            && kept.contains(category)
    });
    let Some(extension) = file_extension(target) else {
        return Ok(lost.into_iter().collect());
    };
    if wanted_exif {
        match read_exif(source, source_format) {
            Some(mut metadata) => {
                metadata.set_tag(ExifTag::Orientation(vec![1]));
                metadata
                    .write_to_vec(output, extension)
                    .map_err(ConvertError::Io)?;
            }
            None => {
                for category in kept.iter() {
                    if present.contains(category) {
                        lost.insert(*category);
                    }
                }
            }
        }
    }
    if source_format == FormatId::Jpeg && target == FormatId::Jpeg {
        let segments: Vec<OpaqueSegment> = jpeg_segments(source)?
            .into_iter()
            .filter(|segment| {
                segment.payload.starts_with(b"ICC_PROFILE\0")
                    || segment.payload.starts_with(b"http://ns.adobe.com/xap/1.0/")
                    || segment
                        .payload
                        .starts_with(b"http://ns.adobe.com/xmp/extension/")
                    || segment.payload.starts_with(b"Photoshop 3.0\0")
            })
            .collect();
        if !segments.is_empty() {
            insert_jpeg_segments(output, &segments)?;
        }
    }
    // Never report a kept category whose bytes did not actually land.
    let after = present_categories(output, target)?;
    for category in kept {
        if present.contains(&category) && !after.contains(&category) {
            lost.insert(category);
        }
    }
    Ok(lost.into_iter().collect())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpaqueSegment {
    /// The APP marker number (1 for APP1, 2 for APP2, ...).
    pub marker: u8,
    pub payload: Vec<u8>,
}

/// Walk a bounded JPEG marker list without decoding pixels.
pub fn jpeg_segments(bytes: &[u8]) -> Result<Vec<OpaqueSegment>, ConvertError> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err(ConvertError::Unsupported);
    }
    let mut segments = Vec::new();
    let mut total = 0usize;
    let mut offset = 2usize;
    let mut steps = 0usize;
    while offset + 4 <= bytes.len() && steps < 4096 {
        steps += 1;
        if bytes[offset] != 0xFF {
            break;
        }
        let mut marker = bytes[offset + 1];
        let mut header = offset + 2;
        // Fill bytes: any number of 0xFF before the marker code.
        while marker == 0xFF && header + 1 < bytes.len() {
            marker = bytes[header];
            header += 1;
        }
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if (0xD0..=0xD8).contains(&marker) || marker == 0x01 {
            offset = header;
            continue;
        }
        if header + 2 > bytes.len() {
            break;
        }
        let length = usize::from(u16::from_be_bytes([bytes[header], bytes[header + 1]]));
        if length < 2 || header + length > bytes.len() {
            break;
        }
        let payload = &bytes[header + 2..header + length];
        if (0xE0..=0xEF).contains(&marker) && !payload.is_empty() {
            total = total.saturating_add(payload.len());
            if total > MAX_METADATA_BYTES || payload.len() > MAX_APP_PAYLOAD {
                return Err(ConvertError::TooLarge);
            }
            segments.push(OpaqueSegment {
                marker: marker - 0xE0,
                payload: payload.to_vec(),
            });
        }
        offset = header + length;
    }
    Ok(segments)
}

/// Insert opaque APP segments right after SOI, skipping exact duplicates.
fn insert_jpeg_segments(
    output: &mut Vec<u8>,
    segments: &[OpaqueSegment],
) -> Result<(), ConvertError> {
    if output.len() < 2 || output[0] != 0xFF || output[1] != 0xD8 {
        return Err(ConvertError::Unsupported);
    }
    let existing = jpeg_segments(output)?;
    let mut inserted = Vec::new();
    for segment in segments {
        if segment.payload.len() > MAX_APP_PAYLOAD {
            return Err(ConvertError::TooLarge);
        }
        if existing
            .iter()
            .any(|item| item.marker == segment.marker && item.payload == segment.payload)
        {
            continue;
        }
        let mut bytes = Vec::with_capacity(segment.payload.len() + 4);
        bytes.push(0xFF);
        bytes.push(0xE0 + segment.marker);
        bytes.extend_from_slice(&((segment.payload.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(&segment.payload);
        inserted.extend_from_slice(&bytes);
    }
    if inserted.is_empty() {
        return Ok(());
    }
    let mut result = Vec::with_capacity(output.len() + inserted.len());
    result.extend_from_slice(&output[..2]);
    result.extend_from_slice(&inserted);
    result.extend_from_slice(&output[2..]);
    *output = result;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PngChunk {
    pub kind: [u8; 4],
    pub payload: Vec<u8>,
}

/// Walk PNG chunks with declared lengths only; no pixel work.
pub fn png_chunks(bytes: &[u8]) -> Result<Vec<PngChunk>, ConvertError> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(ConvertError::Unsupported);
    }
    let mut chunks = Vec::new();
    let mut offset = 8usize;
    let mut total = 0usize;
    while offset + 12 <= bytes.len() && chunks.len() < 10_000 {
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        if offset + 12 + length > bytes.len() || length > MAX_METADATA_BYTES {
            return Err(ConvertError::TooLarge);
        }
        let kind: [u8; 4] = [
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ];
        let payload = bytes[offset + 8..offset + 8 + length].to_vec();
        total = total.saturating_add(payload.len());
        if total > MAX_METADATA_BYTES {
            return Err(ConvertError::TooLarge);
        }
        let end = kind == *b"IEND";
        chunks.push(PngChunk { kind, payload });
        offset += 12 + length;
        if end {
            break;
        }
    }
    Ok(chunks)
}

fn contains_ascii(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
