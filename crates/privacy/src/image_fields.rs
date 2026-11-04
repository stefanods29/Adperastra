//! Bounded image metadata inspection and container helpers (Step 08c D2/D4).
//!
//! EXIF is read through `little_exif`'s vector API. XMP, IPTC and ICC are
//! scanned from the JPEG/PNG/WebP/TIFF container with hard caps; nothing is
//! ever reopened from a user path and no pixel data is decoded here.

use convert::MetadataCategory;
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;

use crate::error::PrivacyError;
use crate::iptc;
use crate::types::{Coverage, MetadataContainer, PrivacyContext, PrivacyField};
use crate::xmp_rules;

pub const MAX_IMAGE_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_EXIF_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_XMP_BYTES: usize = xmp_rules::MAX_XMP_BYTES;
pub const MAX_IPTC_BYTES: usize = iptc::MAX_IPTC_BYTES;
pub const MAX_ICC_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_IMAGE_CHUNKS: usize = 100_000;

type ImageMetadataBlobs = (Option<Vec<u8>>, Option<Vec<u8>>, Option<Vec<u8>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Tiff,
    Webp,
}

impl ImageFormat {
    pub fn extension(self) -> FileExtension {
        match self {
            ImageFormat::Jpeg => FileExtension::JPEG,
            ImageFormat::Png => FileExtension::PNG {
                as_zTXt_chunk: false,
            },
            ImageFormat::Tiff => FileExtension::TIFF,
            ImageFormat::Webp => FileExtension::WEBP,
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Png => "image/png",
            ImageFormat::Tiff => "image/tiff",
            ImageFormat::Webp => "image/webp",
        }
    }
}

/// Detect the four supported containers from their magic bytes.
pub fn detect_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(ImageFormat::Jpeg)
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageFormat::Png)
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some(ImageFormat::Tiff)
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(ImageFormat::Webp)
    } else {
        None
    }
}

#[derive(Debug, Clone)]
pub struct ExtractedImage {
    pub format: ImageFormat,
    pub exif: Metadata,
    pub xmp: Option<Vec<u8>>,
    pub iptc: Option<Vec<u8>>,
    pub icc: Option<Vec<u8>>,
}

/// Read EXIF plus bounded XMP/IPTC/ICC bytes from one image.
pub fn extract_image(bytes: &[u8]) -> Result<ExtractedImage, PrivacyError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    let format = detect_format(bytes).ok_or(PrivacyError::Unsupported)?;
    let exif = read_exif(bytes, format)?;
    let (xmp, iptc, icc) = match format {
        ImageFormat::Jpeg => jpeg_metadata(bytes)?,
        ImageFormat::Png => png_metadata(bytes)?,
        ImageFormat::Webp => webp_metadata(bytes)?,
        ImageFormat::Tiff => tiff_metadata(bytes)?,
    };
    if xmp
        .as_ref()
        .is_some_and(|value| value.len() > MAX_XMP_BYTES)
        || iptc
            .as_ref()
            .is_some_and(|value| value.len() > MAX_IPTC_BYTES)
        || icc
            .as_ref()
            .is_some_and(|value| value.len() > MAX_ICC_BYTES)
    {
        return Err(PrivacyError::TooLarge);
    }
    Ok(ExtractedImage {
        format,
        exif,
        xmp,
        iptc,
        icc,
    })
}

fn read_exif(bytes: &[u8], format: ImageFormat) -> Result<Metadata, PrivacyError> {
    if bytes.len() > MAX_EXIF_BYTES.saturating_mul(32) {
        return Err(PrivacyError::TooLarge);
    }
    // little_exif 0.6.0's PNG reader knows only IHDR/PLTE/IDAT/IEND/zTXt.
    // Strip other chunks for the EXIF read; XMP/ICC are read separately and
    // reattached by the container writer.
    if format == ImageFormat::Png {
        for chunk in png_chunks(bytes)? {
            if &chunk.kind == b"eXIf" {
                let tiff = bytes[chunk.data_start..chunk.data_end].to_vec();
                return Metadata::new_from_vec(&tiff, FileExtension::TIFF)
                    .map_err(|_| PrivacyError::Unsupported);
            }
        }
    }
    let buffer = if format == ImageFormat::Png {
        png_exif_buffer(bytes)?
    } else {
        bytes.to_vec()
    };
    Metadata::new_from_vec(&buffer, format.extension()).map_err(|_| PrivacyError::Unsupported)
}

/// A PNG containing only the chunks little_exif 0.6.0 accepts, used for the
/// vector EXIF API. Unknown/XMP/ICC chunks are preserved separately by the
/// caller and are never silently discarded from the final output.
pub fn png_exif_buffer(bytes: &[u8]) -> Result<Vec<u8>, PrivacyError> {
    let chunks = png_chunks(bytes)?;
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    for chunk in chunks {
        if matches!(&chunk.kind, b"IHDR" | b"PLTE" | b"IDAT" | b"IEND" | b"zTXt") {
            output.extend_from_slice(&bytes[chunk.start..chunk.end]);
        }
    }
    Ok(output)
}

fn exif_container() -> Vec<MetadataContainer> {
    vec![MetadataContainer::Exif]
}

fn label_key(category: &MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Exif => "privacy.exif",
        MetadataCategory::Gps => "privacy.gps",
        MetadataCategory::Camera => "privacy.camera",
        MetadataCategory::Date => "privacy.date",
        MetadataCategory::Icc => "privacy.icc",
        MetadataCategory::Xmp => "privacy.xmp",
        MetadataCategory::Iptc => "privacy.iptc",
        MetadataCategory::Author => "privacy.author",
        MetadataCategory::Comments => "privacy.comments",
        MetadataCategory::Attachments => "privacy.attachments",
        MetadataCategory::Forms => "privacy.forms",
        MetadataCategory::Annotations => "privacy.annotations",
        MetadataCategory::Scripts => "privacy.scripts",
        MetadataCategory::Timestamps => "privacy.timestamps",
        _ => "privacy.scope",
    }
}

fn sanitize(value: &str) -> String {
    let mut text = String::new();
    for character in value.chars().take(512) {
        text.push(if character.is_control() {
            ' '
        } else {
            character
        });
    }
    text
}

fn string_tag(tag: &ExifTag) -> Option<&str> {
    match tag {
        ExifTag::Make(value)
        | ExifTag::Model(value)
        | ExifTag::Artist(value)
        | ExifTag::Copyright(value)
        | ExifTag::ImageDescription(value)
        | ExifTag::LensMake(value)
        | ExifTag::LensModel(value)
        | ExifTag::LensSerialNumber(value)
        | ExifTag::SerialNumber(value)
        | ExifTag::OwnerName(value)
        | ExifTag::DateTimeOriginal(value)
        | ExifTag::CreateDate(value)
        | ExifTag::OffsetTime(value)
        | ExifTag::OffsetTimeOriginal(value)
        | ExifTag::OffsetTimeDigitized(value)
        | ExifTag::SubSecTime(value)
        | ExifTag::SubSecTimeOriginal(value)
        | ExifTag::SubSecTimeDigitized(value) => Some(value.as_str()),
        ExifTag::UnknownSTRING(value, _, _) => Some(value.as_str()),
        _ => None,
    }
}

/// The category and disclosed overlaps of one EXIF tag.
pub fn classify_exif_tag(
    group: ExifTagGroup,
    tag: &ExifTag,
) -> (MetadataCategory, Vec<MetadataCategory>) {
    let hex = tag.as_u16();
    if group == ExifTagGroup::GPS {
        return (MetadataCategory::Gps, Vec::new());
    }
    if matches!(
        tag,
        ExifTag::Make(_)
            | ExifTag::Model(_)
            | ExifTag::LensMake(_)
            | ExifTag::LensModel(_)
            | ExifTag::LensSerialNumber(_)
            | ExifTag::SerialNumber(_)
            | ExifTag::OwnerName(_)
    ) {
        let related = if matches!(tag, ExifTag::OwnerName(_)) {
            vec![MetadataCategory::Author]
        } else {
            Vec::new()
        };
        return (MetadataCategory::Camera, related);
    }
    if matches!(
        tag,
        ExifTag::DateTimeOriginal(_)
            | ExifTag::CreateDate(_)
            | ExifTag::OffsetTime(_)
            | ExifTag::OffsetTimeOriginal(_)
            | ExifTag::OffsetTimeDigitized(_)
            | ExifTag::SubSecTime(_)
            | ExifTag::SubSecTimeOriginal(_)
            | ExifTag::SubSecTimeDigitized(_)
    ) || matches!(hex, 0x0132 | 0x9003 | 0x9004)
    {
        return (MetadataCategory::Date, Vec::new());
    }
    if matches!(tag, ExifTag::Artist(_) | ExifTag::Copyright(_)) || matches!(hex, 0x9c9d) {
        return (MetadataCategory::Author, Vec::new());
    }
    if matches!(tag, ExifTag::ImageDescription(_) | ExifTag::UserComment(_))
        || matches!(hex, 0x9c9c | 0x9c9e | 0x9c9f)
    {
        return (MetadataCategory::Comments, Vec::new());
    }
    if matches!(tag, ExifTag::MakerNote(_)) {
        // Strictly unverified for selective categories; broad exif removal
        // removes the whole MakerNote instead of guessing at its contents.
        return (MetadataCategory::Exif, Vec::new());
    }
    (MetadataCategory::Exif, Vec::new())
}

fn exif_field(group: ExifTagGroup, tag: &ExifTag) -> PrivacyField {
    let (category, related) = classify_exif_tag(group, tag);
    PrivacyField {
        category,
        containers: exif_container(),
        related_categories: related,
        field_id: format!("exif.{:04x}", tag.as_u16()),
        label_key: label_key(&category).to_string(),
        preview: string_tag(tag).map(sanitize).unwrap_or_default(),
        count: 1,
        content_affecting: false,
        coverage: if matches!(tag, ExifTag::MakerNote(_)) {
            Coverage::Unknown
        } else {
            Coverage::Complete
        },
    }
}

fn inspect_exif(metadata: &Metadata) -> Vec<PrivacyField> {
    let mut fields = Vec::new();
    for ifd in metadata.get_ifds() {
        for tag in ifd.get_tags() {
            fields.push(exif_field(ifd.get_ifd_type(), tag));
        }
    }
    fields
}

/// Inspect one image without modifying it.
pub fn inspect_image(
    bytes: &[u8],
    context: &mut PrivacyContext,
) -> Result<Vec<PrivacyField>, PrivacyError> {
    context.check_cancelled()?;
    let image = extract_image(bytes)?;
    let mut fields = inspect_exif(&image.exif);
    if let Some(xmp) = &image.xmp {
        match xmp_rules::inspect_fields(xmp) {
            Ok(mut xmp_fields) => fields.append(&mut xmp_fields),
            Err(_) => fields.push(PrivacyField {
                category: MetadataCategory::Xmp,
                containers: vec![MetadataContainer::Xmp],
                related_categories: Vec::new(),
                field_id: "xmp.unreadable".to_string(),
                label_key: "privacy.xmp".to_string(),
                preview: String::new(),
                count: 1,
                content_affecting: false,
                coverage: Coverage::Unknown,
            }),
        }
    }
    if let Some(iptc) = &image.iptc {
        match iptc::inspect_fields(iptc) {
            Ok(mut iptc_fields) => fields.append(&mut iptc_fields),
            Err(_) => fields.push(PrivacyField {
                category: MetadataCategory::Iptc,
                containers: vec![MetadataContainer::Iptc],
                related_categories: Vec::new(),
                field_id: "iptc.unreadable".to_string(),
                label_key: "privacy.iptc".to_string(),
                preview: String::new(),
                count: 1,
                content_affecting: false,
                coverage: Coverage::Unknown,
            }),
        }
    }
    if image.icc.is_some() {
        fields.push(PrivacyField {
            category: MetadataCategory::Icc,
            // ICC lives in its own container (JPEG APP2, PNG iCCP, WebP
            // ICCP). The wire enum has no ICC variant, so the closure code
            // explicitly excludes Icc from EXIF-container expansion.
            containers: exif_container(),
            related_categories: Vec::new(),
            field_id: "image.icc".to_string(),
            label_key: "privacy.icc".to_string(),
            preview: String::new(),
            count: 1,
            content_affecting: false,
            coverage: Coverage::Complete,
        });
    }
    if fields.len() > crate::inspect::MAX_INSPECTION_FIELDS {
        return Err(PrivacyError::TooLarge);
    }
    Ok(fields)
}

// ---------- JPEG ----------

#[derive(Debug, Clone)]
pub struct JpegSegment {
    pub marker: u8,
    pub start: usize,
    pub end: usize,
    pub payload_start: usize,
}

pub fn jpeg_segments(bytes: &[u8]) -> Result<Vec<JpegSegment>, PrivacyError> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err(PrivacyError::Unsupported);
    }
    let mut segments = Vec::new();
    let mut index = 2usize;
    while index + 1 < bytes.len() {
        if segments.len() > MAX_IMAGE_CHUNKS {
            return Err(PrivacyError::TooLarge);
        }
        if bytes[index] != 0xff {
            return Err(PrivacyError::Unsupported);
        }
        let start = index;
        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let marker = bytes[index];
        index += 1;
        if marker == 0xd9 || marker == 0xd8 {
            segments.push(JpegSegment {
                marker,
                start,
                end: index,
                payload_start: index,
            });
            break;
        }
        if (0xd0..=0xd7).contains(&marker) || marker == 0x01 {
            segments.push(JpegSegment {
                marker,
                start,
                end: index,
                payload_start: index,
            });
            continue;
        }
        if index + 2 > bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        let end = index + length;
        segments.push(JpegSegment {
            marker,
            start,
            end,
            payload_start: index + 2,
        });
        index = end;
        if marker == 0xda {
            break;
        }
    }
    Ok(segments)
}

fn jpeg_metadata(bytes: &[u8]) -> Result<ImageMetadataBlobs, PrivacyError> {
    let mut xmp = None;
    let mut iptc_value = None;
    let mut icc = Vec::new();
    for segment in jpeg_segments(bytes)? {
        if segment.payload_start > segment.end {
            continue;
        }
        let payload = &bytes[segment.payload_start..segment.end];
        if segment.marker == 0xe1 && payload.starts_with(b"http://ns.adobe.com/xap/1.0/\0") {
            xmp = Some(payload[29..].to_vec());
        } else if segment.marker == 0xe2 && payload.starts_with(b"ICC_PROFILE\0") {
            if payload.len() > 14 {
                icc.extend_from_slice(&payload[14..]);
            }
        } else if segment.marker == 0xed && payload.starts_with(b"Photoshop 3.0\0") {
            if let Some(value) = iptc::read_resource(payload, 0x0404)? {
                iptc_value = Some(value);
            }
        }
    }
    Ok((xmp, iptc_value, (!icc.is_empty()).then_some(icc)))
}

/// Rebuild a JPEG with selected APP1-XMP/APP13-IPTC/APP2-ICC segments
/// removed or replaced. EXIF is handled by `little_exif` before this call.
pub fn rewrite_jpeg_metadata(
    bytes: &[u8],
    xmp: Option<&[u8]>,
    iptc_value: Option<&[u8]>,
    remove_icc: bool,
) -> Result<Vec<u8>, PrivacyError> {
    let segments = jpeg_segments(bytes)?;
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(&[0xff, 0xd8]);
    let mut copied_to = 2usize;
    for segment in segments {
        if segment.start < copied_to {
            continue;
        }
        if segment.marker == 0xe1 {
            let payload = &bytes[segment.payload_start..segment.end];
            if payload.starts_with(b"http://ns.adobe.com/xap/1.0/\0") {
                output.extend_from_slice(&bytes[copied_to..segment.start]);
                if let Some(value) = xmp {
                    let mut body = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
                    body.extend_from_slice(value);
                    if body.len() + 2 <= u16::MAX as usize {
                        output.extend_from_slice(&[0xff, 0xe1]);
                        output.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
                        output.extend_from_slice(&body);
                    }
                }
                copied_to = segment.end;
            }
        } else if segment.marker == 0xed {
            let payload = &bytes[segment.payload_start..segment.end];
            if payload.starts_with(b"Photoshop 3.0\0") {
                output.extend_from_slice(&bytes[copied_to..segment.start]);
                let rewritten = match iptc_value {
                    Some(value) => Some(iptc::replace_resource(payload, value)?),
                    None => iptc::remove_resource(payload, 0x0404)?,
                };
                if let Some(body) = rewritten {
                    if body.len() + 2 <= u16::MAX as usize {
                        output.extend_from_slice(&[0xff, 0xed]);
                        output.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
                        output.extend_from_slice(&body);
                    }
                }
                copied_to = segment.end;
            }
        } else if segment.marker == 0xe2 && remove_icc {
            let payload = &bytes[segment.payload_start..segment.end];
            if payload.starts_with(b"ICC_PROFILE\0") {
                output.extend_from_slice(&bytes[copied_to..segment.start]);
                copied_to = segment.end;
            }
        }
    }
    output.extend_from_slice(&bytes[copied_to..]);
    Ok(output)
}

/// Hash the encoded scan data; metadata edits must not change it.
pub fn image_payload_hash(format: ImageFormat, bytes: &[u8]) -> Result<[u8; 32], PrivacyError> {
    let mut hasher = blake3::Hasher::new();
    match format {
        ImageFormat::Jpeg => {
            let segments = jpeg_segments(bytes)?;
            if let Some(sos) = segments.iter().find(|segment| segment.marker == 0xda) {
                hasher.update(&bytes[sos.start..]);
            } else {
                return Err(PrivacyError::Unsupported);
            }
        }
        ImageFormat::Png => {
            for chunk in png_chunks(bytes)? {
                if &chunk.kind == b"IDAT" {
                    hasher.update(&bytes[chunk.data_start..chunk.data_end]);
                }
            }
        }
        ImageFormat::Webp => {
            for chunk in webp_chunks(bytes)? {
                if &chunk.kind == b"VP8 " || &chunk.kind == b"VP8L" || &chunk.kind == b"ANMF" {
                    hasher.update(&bytes[chunk.data_start..chunk.data_end]);
                }
            }
        }
        ImageFormat::Tiff => {
            if let Some(data) = tiff_strip_data(bytes)? {
                hasher.update(&data);
            }
        }
    }
    Ok(*hasher.finalize().as_bytes())
}

// ---------- PNG ----------

#[derive(Debug, Clone)]
pub struct PngChunk {
    pub kind: [u8; 4],
    pub start: usize,
    pub data_start: usize,
    pub data_end: usize,
    pub end: usize,
}

pub fn png_chunks(bytes: &[u8]) -> Result<Vec<PngChunk>, PrivacyError> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(PrivacyError::Unsupported);
    }
    let mut chunks = Vec::new();
    let mut index = 8usize;
    while index + 12 <= bytes.len() {
        let start = index;
        let length = u32::from_be_bytes([
            bytes[index],
            bytes[index + 1],
            bytes[index + 2],
            bytes[index + 3],
        ]) as usize;
        if length > MAX_IMAGE_BYTES || index + 12 + length > bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        let kind = [
            bytes[index + 4],
            bytes[index + 5],
            bytes[index + 6],
            bytes[index + 7],
        ];
        let data_start = index + 8;
        let data_end = data_start + length;
        let end = data_end + 4;
        chunks.push(PngChunk {
            kind,
            start,
            data_start,
            data_end,
            end,
        });
        if chunks.len() > MAX_IMAGE_CHUNKS {
            return Err(PrivacyError::TooLarge);
        }
        index = end;
        if &kind == b"IEND" {
            break;
        }
    }
    Ok(chunks)
}

fn png_text(chunk: &[u8]) -> Option<(String, Vec<u8>)> {
    let split = chunk.iter().position(|byte| *byte == 0)?;
    let keyword = String::from_utf8_lossy(&chunk[..split]).to_string();
    Some((keyword, chunk[split + 1..].to_vec()))
}

fn png_metadata(bytes: &[u8]) -> Result<ImageMetadataBlobs, PrivacyError> {
    let mut xmp = None;
    let mut icc = None;
    for chunk in png_chunks(bytes)? {
        let data = &bytes[chunk.data_start..chunk.data_end];
        if &chunk.kind == b"iTXt" {
            if let Some((keyword, rest)) = png_text(data) {
                if keyword == "XML:com.adobe.xmp" && rest.len() > 2 {
                    let compression = rest[0];
                    let method = rest[1];
                    if compression == 0 && method == 0 {
                        // language + translated keyword are NUL terminated.
                        let mut index = 2;
                        let mut parts = 0;
                        while index < rest.len() && parts < 2 {
                            if rest[index] == 0 {
                                parts += 1;
                            }
                            index += 1;
                        }
                        xmp = Some(rest[index..].to_vec());
                    }
                }
            }
        } else if &chunk.kind == b"tEXt" {
            if let Some((keyword, value)) = png_text(data) {
                if keyword == "XML:com.adobe.xmp" {
                    xmp = Some(value);
                }
            }
        } else if &chunk.kind == b"iCCP" {
            icc = Some(data.to_vec());
        }
    }
    Ok((xmp, None, icc))
}

pub fn rewrite_png_metadata(
    bytes: &[u8],
    xmp: Option<&[u8]>,
    icc: Option<&[u8]>,
    remove_icc: bool,
) -> Result<Vec<u8>, PrivacyError> {
    let chunks = png_chunks(bytes)?;
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut inserted_xmp = false;
    let mut inserted_icc = false;
    for chunk in chunks {
        let data = &bytes[chunk.data_start..chunk.data_end];
        if &chunk.kind == b"IDAT" && !remove_icc && !inserted_icc {
            if let Some(value) = icc {
                write_png_chunk(&mut output, b"iCCP", value);
                inserted_icc = true;
            }
        }
        if &chunk.kind == b"iTXt" || &chunk.kind == b"tEXt" {
            let mut is_xmp = false;
            if let Some((keyword, _)) = png_text(data) {
                is_xmp = keyword == "XML:com.adobe.xmp";
            }
            if is_xmp {
                if let Some(value) = xmp {
                    if !inserted_xmp {
                        let mut body = b"XML:com.adobe.xmp\0\0\0\0\0".to_vec();
                        body.extend_from_slice(value);
                        write_png_chunk(&mut output, b"iTXt", &body);
                        inserted_xmp = true;
                    }
                }
                continue;
            }
        }
        if &chunk.kind == b"iCCP" {
            if remove_icc {
                continue;
            }
            if !inserted_icc {
                if let Some(value) = icc {
                    write_png_chunk(&mut output, b"iCCP", value);
                    inserted_icc = true;
                } else {
                    output.extend_from_slice(&bytes[chunk.start..chunk.end]);
                    inserted_icc = true;
                }
            }
            continue;
        }
        if &chunk.kind == b"IEND" {
            if !inserted_xmp {
                if let Some(value) = xmp {
                    let mut body = b"XML:com.adobe.xmp\0\0\0\0\0".to_vec();
                    body.extend_from_slice(value);
                    write_png_chunk(&mut output, b"iTXt", &body);
                    inserted_xmp = true;
                }
            }
            if !remove_icc && !inserted_icc {
                if let Some(value) = icc {
                    write_png_chunk(&mut output, b"iCCP", value);
                    inserted_icc = true;
                }
            }
        }
        output.extend_from_slice(&bytes[chunk.start..chunk.end]);
    }
    Ok(output)
}

pub fn write_png_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    output.extend_from_slice(kind);
    output.extend_from_slice(data);
    let mut crc = crc32_start();
    crc = crc32_update(crc, kind);
    crc = crc32_update(crc, data);
    output.extend_from_slice(&(crc ^ 0xffff_ffff).to_be_bytes());
}

fn crc32_start() -> u32 {
    0xffff_ffff
}

fn crc32_update(mut crc: u32, bytes: &[u8]) -> u32 {
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    crc
}

// ---------- WebP ----------

#[derive(Debug, Clone)]
pub struct WebpChunk {
    pub kind: [u8; 4],
    pub start: usize,
    pub data_start: usize,
    pub data_end: usize,
    pub end: usize,
}

pub fn webp_chunks(bytes: &[u8]) -> Result<Vec<WebpChunk>, PrivacyError> {
    if bytes.len() < 12 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return Err(PrivacyError::Unsupported);
    }
    let mut chunks = Vec::new();
    let mut index = 12usize;
    while index + 8 <= bytes.len() {
        let start = index;
        let kind = [
            bytes[index],
            bytes[index + 1],
            bytes[index + 2],
            bytes[index + 3],
        ];
        let length = u32::from_le_bytes([
            bytes[index + 4],
            bytes[index + 5],
            bytes[index + 6],
            bytes[index + 7],
        ]) as usize;
        if length > MAX_IMAGE_BYTES || index + 8 + length > bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        let data_start = index + 8;
        let data_end = data_start + length;
        let end = data_end + (length & 1);
        chunks.push(WebpChunk {
            kind,
            start,
            data_start,
            data_end,
            end,
        });
        if chunks.len() > MAX_IMAGE_CHUNKS {
            return Err(PrivacyError::TooLarge);
        }
        index = end;
    }
    Ok(chunks)
}

fn webp_metadata(bytes: &[u8]) -> Result<ImageMetadataBlobs, PrivacyError> {
    let mut xmp = None;
    let mut icc = None;
    for chunk in webp_chunks(bytes)? {
        let data = &bytes[chunk.data_start..chunk.data_end];
        if &chunk.kind == b"XMP " {
            xmp = Some(data.to_vec());
        } else if &chunk.kind == b"ICCP" {
            icc = Some(data.to_vec());
        }
    }
    Ok((xmp, None, icc))
}

pub fn rewrite_webp_metadata(
    bytes: &[u8],
    xmp: Option<&[u8]>,
    remove_icc: bool,
) -> Result<Vec<u8>, PrivacyError> {
    let chunks = webp_chunks(bytes)?;
    let mut body = Vec::new();
    let mut inserted = false;
    for chunk in chunks {
        if &chunk.kind == b"XMP " {
            if let Some(value) = xmp {
                if !inserted {
                    write_webp_chunk(&mut body, b"XMP ", value);
                    inserted = true;
                }
            }
            continue;
        }
        if &chunk.kind == b"ICCP" && remove_icc {
            continue;
        }
        body.extend_from_slice(&bytes[chunk.start..chunk.end]);
    }
    if !inserted {
        if let Some(value) = xmp {
            write_webp_chunk(&mut body, b"XMP ", value);
        }
    }
    let mut output = Vec::with_capacity(body.len() + 12);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(body.len() as u32).to_le_bytes());
    output.extend_from_slice(b"WEBP");
    output.extend_from_slice(&body);
    Ok(output)
}

fn write_webp_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(kind);
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
    if data.len() % 2 == 1 {
        output.push(0);
    }
}

// ---------- TIFF ----------

fn tiff_metadata(bytes: &[u8]) -> Result<ImageMetadataBlobs, PrivacyError> {
    Ok((
        tiff_tag(bytes, 700)?,
        tiff_tag(bytes, 33723)?,
        tiff_tag(bytes, 34675)?,
    ))
}

fn tiff_endian(bytes: &[u8]) -> Result<bool, PrivacyError> {
    if bytes.starts_with(b"II") {
        Ok(true)
    } else if bytes.starts_with(b"MM") {
        Ok(false)
    } else {
        Err(PrivacyError::Unsupported)
    }
}

fn read_u16(bytes: &[u8], offset: usize, little: bool) -> Option<u16> {
    let value = bytes.get(offset..offset + 2)?;
    Some(if little {
        u16::from_le_bytes([value[0], value[1]])
    } else {
        u16::from_be_bytes([value[0], value[1]])
    })
}

fn read_u32(bytes: &[u8], offset: usize, little: bool) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(if little {
        u32::from_le_bytes([value[0], value[1], value[2], value[3]])
    } else {
        u32::from_be_bytes([value[0], value[1], value[2], value[3]])
    })
}

fn tiff_tag(bytes: &[u8], wanted: u16) -> Result<Option<Vec<u8>>, PrivacyError> {
    if bytes.len() < 8 {
        return Err(PrivacyError::Unsupported);
    }
    let little = tiff_endian(bytes)?;
    let offset = read_u32(bytes, 4, little).ok_or(PrivacyError::Unsupported)? as usize;
    let count = read_u16(bytes, offset, little).ok_or(PrivacyError::Unsupported)? as usize;
    for index in 0..count {
        let entry = offset + 2 + index * 12;
        let Some(tag) = read_u16(bytes, entry, little) else {
            break;
        };
        if tag != wanted {
            continue;
        }
        let kind = read_u16(bytes, entry + 2, little).unwrap_or(0);
        let count = read_u32(bytes, entry + 4, little).unwrap_or(0) as usize;
        let unit = match kind {
            1 | 2 | 6 | 7 => 1usize,
            3 | 8 => 2,
            4 | 9 | 11 => 4,
            5 | 10 | 12 => 8,
            _ => return Ok(None),
        };
        let length = count.saturating_mul(unit);
        if length > MAX_XMP_BYTES && wanted != 34675 {
            return Err(PrivacyError::TooLarge);
        }
        if length <= 4 {
            return Ok(Some(
                bytes
                    .get(entry + 8..entry + 8 + length)
                    .unwrap_or(&[])
                    .to_vec(),
            ));
        }
        let start = read_u32(bytes, entry + 8, little).unwrap_or(0) as usize;
        if start + length > bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        return Ok(Some(bytes[start..start + length].to_vec()));
    }
    Ok(None)
}

fn tiff_strip_data(bytes: &[u8]) -> Result<Option<Vec<u8>>, PrivacyError> {
    let Some(offsets) = tiff_tag(bytes, 273)? else {
        return Ok(None);
    };
    let Some(counts) = tiff_tag(bytes, 279)? else {
        return Ok(None);
    };
    let little = tiff_endian(bytes)?;
    let mut output = Vec::new();
    for index in 0..offsets.len() / 4 {
        let offset = read_u32(&offsets, index * 4, little).unwrap_or(0) as usize;
        let length = read_u32(&counts, index * 4, little).unwrap_or(0) as usize;
        if offset + length > bytes.len() {
            break;
        }
        output.extend_from_slice(&bytes[offset..offset + length]);
    }
    Ok(Some(output))
}
