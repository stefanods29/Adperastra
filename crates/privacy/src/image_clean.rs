//! Selective, verified image cleaning (Step 08c T3/D4/D5).

use std::io::Write;

use convert::MetadataCategory;
use little_exif::exif_tag::ExifTag;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;

use crate::error::PrivacyError;
use crate::image_fields::{
    extract_image, image_payload_hash, inspect_image, png_exif_buffer, rewrite_jpeg_metadata,
    rewrite_png_metadata, rewrite_webp_metadata, ImageFormat,
};
use crate::inspect::{counts_for, effective_categories};
use crate::iptc;
use crate::registry::{PrivacyAdapter, IMAGE_CATEGORIES};
use crate::types::{Coverage, PrivacyCleanSummary, PrivacyContext, PrivacyField};
use crate::xmp_rules;

pub struct ImagePrivacyAdapter;

impl PrivacyAdapter for ImagePrivacyAdapter {
    fn id(&self) -> &'static str {
        "image"
    }

    fn categories(&self) -> &'static [MetadataCategory] {
        IMAGE_CATEGORIES
    }

    fn inspect(
        &self,
        input: &mut dyn convert::ReadSeek,
        context: &mut PrivacyContext,
    ) -> Result<Vec<PrivacyField>, PrivacyError> {
        let bytes = crate::bounded_input::read(input, context)?;
        inspect_image(&bytes, context)
    }

    fn clean(
        &self,
        input: &mut dyn convert::ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError> {
        let bytes = crate::bounded_input::read(input, context)?;
        let (cleaned, summary) = clean_image(&bytes, categories, context)?;
        output.write_all(&cleaned)?;
        Ok(summary)
    }
}

fn unknown_but_broadly_removed(field: &PrivacyField, selected: &[MetadataCategory]) -> bool {
    match &field.category {
        MetadataCategory::Exif => selected.contains(&MetadataCategory::Exif),
        MetadataCategory::Xmp => selected.contains(&MetadataCategory::Xmp),
        MetadataCategory::Iptc => selected.contains(&MetadataCategory::Iptc),
        _ => false,
    }
}

fn tag_selected(group: ExifTagGroup, tag: &ExifTag, selected: &[MetadataCategory]) -> bool {
    let (category, related) = crate::image_fields::classify_exif_tag(group, tag);
    selected.contains(&category) || related.iter().any(|related| selected.contains(related))
}

fn remove_exif_tags(metadata: &mut Metadata, selected: &[MetadataCategory]) {
    let ifds: Vec<(ExifTagGroup, u32, Vec<ExifTag>)> = metadata
        .get_ifds()
        .iter()
        .map(|ifd| {
            (
                ifd.get_ifd_type(),
                ifd.get_generic_ifd_nr(),
                ifd.get_tags().to_vec(),
            )
        })
        .collect();
    for (group, number, tags) in ifds {
        for tag in tags {
            if tag_selected(group, &tag, selected) {
                metadata.get_ifd_mut(group, number).remove_tag(tag.as_u16());
            }
        }
    }
}

fn has_maker_note(metadata: &Metadata) -> bool {
    metadata
        .get_ifds()
        .iter()
        .flat_map(|ifd| ifd.get_tags())
        .any(|tag| matches!(tag, ExifTag::MakerNote(_)))
}

fn update_xmp(
    image: &crate::image_fields::ExtractedImage,
    selected: &[MetadataCategory],
) -> Result<Option<Vec<u8>>, PrivacyError> {
    let Some(xmp) = &image.xmp else {
        return Ok(None);
    };
    if selected.contains(&MetadataCategory::Xmp) {
        return Ok(None);
    }
    if !selected.iter().any(|category| {
        matches!(
            category,
            MetadataCategory::Gps
                | MetadataCategory::Camera
                | MetadataCategory::Date
                | MetadataCategory::Author
                | MetadataCategory::Comments
                | MetadataCategory::Iptc
                | MetadataCategory::Exif
        )
    }) {
        return Ok(Some(xmp.clone()));
    }
    match xmp_rules::remove_categories(xmp, selected)? {
        Some(value) => Ok(Some(value)),
        None => Ok(None),
    }
}

fn update_iptc(
    image: &crate::image_fields::ExtractedImage,
    selected: &[MetadataCategory],
) -> Result<Option<Vec<u8>>, PrivacyError> {
    let Some(iptc_value) = &image.iptc else {
        return Ok(None);
    };
    if selected.contains(&MetadataCategory::Iptc) {
        return Ok(None);
    }
    if !selected.iter().any(|category| {
        matches!(
            category,
            MetadataCategory::Gps
                | MetadataCategory::Author
                | MetadataCategory::Date
                | MetadataCategory::Comments
        )
    }) {
        return Ok(Some(iptc_value.clone()));
    }
    iptc::remove_categories(iptc_value, selected)
}

fn clean_image(
    bytes: &[u8],
    categories: &[MetadataCategory],
    context: &mut PrivacyContext,
) -> Result<(Vec<u8>, PrivacyCleanSummary), PrivacyError> {
    context.check_cancelled()?;
    if categories.is_empty() {
        return Err(PrivacyError::BadRequest);
    }
    for category in categories {
        if !IMAGE_CATEGORIES.contains(category) {
            return Err(PrivacyError::BadRequest);
        }
    }
    let image = extract_image(bytes)?;
    let before = inspect_image(bytes, context)?;
    let selected = effective_categories(&before, categories)?;
    for field in &before {
        if field.coverage == Coverage::Unknown && !unknown_but_broadly_removed(field, &selected) {
            return Err(PrivacyError::Unverified);
        }
    }
    if has_maker_note(&image.exif) && !selected.contains(&MetadataCategory::Exif) {
        return Err(PrivacyError::Unverified);
    }
    if image.format == ImageFormat::Tiff
        && ((selected.contains(&MetadataCategory::Xmp) && image.xmp.is_some())
            || (selected.contains(&MetadataCategory::Iptc) && image.iptc.is_some())
            || (selected.contains(&MetadataCategory::Icc) && image.icc.is_some()))
    {
        return Err(PrivacyError::Unsupported);
    }
    if image.format != ImageFormat::Jpeg
        && image.format != ImageFormat::Png
        && image.format != ImageFormat::Webp
        && (selected.contains(&MetadataCategory::Icc) && image.icc.is_some()
            || selected.contains(&MetadataCategory::Iptc) && image.iptc.is_some())
    {
        return Err(PrivacyError::Unsupported);
    }

    let mut metadata = image.exif.clone();
    if selected.contains(&MetadataCategory::Exif) {
        metadata.reduce_to_a_minimum();
    } else {
        remove_exif_tags(&mut metadata, &selected);
    }
    // little_exif 0.6.0 accepts only the classic PNG chunks; strip the
    // separately retained XMP/ICC chunks for the EXIF rewrite and reattach
    // them below.
    let mut working = if image.format == ImageFormat::Png {
        png_exif_buffer(bytes)?
    } else {
        bytes.to_vec()
    };
    metadata
        .write_to_vec(&mut working, image.format.extension())
        .map_err(|_| PrivacyError::Unverified)?;
    context.check_cancelled()?;

    let xmp = update_xmp(&image, &selected)?;
    let iptc_value = update_iptc(&image, &selected)?;
    let remove_icc = selected.contains(&MetadataCategory::Icc) && image.icc.is_some();
    let cleaned = match image.format {
        ImageFormat::Jpeg => {
            rewrite_jpeg_metadata(&working, xmp.as_deref(), iptc_value.as_deref(), remove_icc)?
        }
        ImageFormat::Png => {
            rewrite_png_metadata(&working, xmp.as_deref(), image.icc.as_deref(), remove_icc)?
        }
        ImageFormat::Webp => rewrite_webp_metadata(&working, xmp.as_deref(), remove_icc)?,
        ImageFormat::Tiff => working,
    };
    let after = inspect_image(&cleaned, context)?;
    for category in &selected {
        if after.iter().any(|field| {
            field.category == *category
                && !(field.category == MetadataCategory::Exif
                    && field.field_id.starts_with("exif.unk"))
        }) {
            return Err(PrivacyError::Unverified);
        }
    }
    let mut retained_before: Vec<PrivacyField> = before
        .iter()
        .filter(|field| !selected.contains(&field.category))
        .cloned()
        .collect();
    let mut retained_after: Vec<PrivacyField> = after
        .iter()
        .filter(|field| !selected.contains(&field.category))
        .cloned()
        .collect();
    retained_before.sort_by(|left, right| left.field_id.cmp(&right.field_id));
    retained_after.sort_by(|left, right| left.field_id.cmp(&right.field_id));
    if retained_before.len() != retained_after.len()
        || retained_before
            .iter()
            .zip(&retained_after)
            .any(|(left, right)| {
                left.field_id != right.field_id
                    || left.preview != right.preview
                    || left.count != right.count
                    || left.coverage != right.coverage
                    || left.content_affecting != right.content_affecting
            })
    {
        return Err(PrivacyError::Unverified);
    }
    if image_payload_hash(image.format, bytes)? != image_payload_hash(image.format, &cleaned)? {
        return Err(PrivacyError::Unverified);
    }

    let removed = counts_for(&before, &selected);
    let retained = counts_for(&retained_after, &all_other_categories(&selected));
    Ok((
        cleaned.clone(),
        PrivacyCleanSummary {
            removed_category_counts: removed,
            retained_category_counts: retained,
            coverage: Coverage::Complete,
            output_bytes: cleaned.len() as u64,
        },
    ))
}

fn all_other_categories(selected: &[MetadataCategory]) -> Vec<MetadataCategory> {
    let mut categories = Vec::new();
    for category in IMAGE_CATEGORIES {
        if !selected.contains(category) {
            categories.push(*category);
        }
    }
    categories
}
