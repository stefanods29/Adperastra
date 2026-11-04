//! Inspection orchestration and effective-category closure (Step 08c D3).

use std::io::{Cursor, Write};

use convert::MetadataCategory;

use crate::error::PrivacyError;
use crate::registry::PrivacyAdapter;
use crate::types::{
    validate_requested_categories, Coverage, MetadataContainer, MetadataCount, PrivacyClosure,
    PrivacyContext, PrivacyField,
};
use crate::{same_categories, sorted_categories};

/// The most rows one UI page may carry.
pub const MAX_PAGE_FIELDS: usize = 256;
/// The largest serialized page the UI accepts.
pub const MAX_PAGE_BYTES: usize = 768 * 1024;
/// The most fields one inspection retains before refusing the file.
pub const MAX_INSPECTION_FIELDS: usize = 10_000;

/// Inspect one bounded byte source through an adapter.
pub fn inspect_bytes(
    adapter: &dyn PrivacyAdapter,
    bytes: &[u8],
    context: &mut PrivacyContext,
) -> Result<Vec<PrivacyField>, PrivacyError> {
    context.check_cancelled()?;
    let mut cursor = Cursor::new(bytes);
    let fields = adapter.inspect(&mut cursor, context)?;
    if fields.len() > MAX_INSPECTION_FIELDS {
        return Err(PrivacyError::TooLarge);
    }
    for field in &fields {
        field.validate()?;
    }
    Ok(fields)
}

/// Clean one bounded byte source into an owned writer.
pub fn clean_bytes(
    adapter: &dyn PrivacyAdapter,
    bytes: &[u8],
    categories: &[MetadataCategory],
    output: &mut dyn Write,
    context: &mut PrivacyContext,
) -> Result<crate::types::PrivacyCleanSummary, PrivacyError> {
    context.check_cancelled()?;
    validate_requested_categories(categories)?;
    for category in categories {
        if !adapter.categories().contains(category) {
            return Err(PrivacyError::BadRequest);
        }
    }
    let mut cursor = Cursor::new(bytes);
    let summary = adapter.clean(&mut cursor, categories, output, context)?;
    if summary.coverage == Coverage::Unknown {
        return Err(PrivacyError::Unverified);
    }
    if summary.output_bytes > context.max_output_bytes() {
        return Err(PrivacyError::TooLarge);
    }
    Ok(summary)
}

/// The exact removal closure for the selected categories and retained
/// inspection provenance. Categories are not assumed disjoint.
pub fn effective_categories(
    fields: &[PrivacyField],
    requested: &[MetadataCategory],
) -> Result<Vec<MetadataCategory>, PrivacyError> {
    validate_requested_categories(requested)?;
    let mut selected = sorted_categories(requested);
    loop {
        let mut changed = false;
        for field in fields {
            // ICC has no container of its own in the wire enum. It is stored
            // in a JPEG APP2/PNG iCCP/WebP ICCP chunk, not inside the EXIF
            // IFD, so broad EXIF removal must not expand to ICC (D4 preserves
            // the colour profile unless ICC itself was selected).
            let container_selected = field.category != MetadataCategory::Icc
                && field.containers.iter().any(|container| {
                    selected.iter().any(|category| {
                        (category == &MetadataCategory::Exif
                            && *container == MetadataContainer::Exif)
                            || (category == &MetadataCategory::Xmp
                                && *container == MetadataContainer::Xmp)
                            || (category == &MetadataCategory::Iptc
                                && *container == MetadataContainer::Iptc)
                    })
                });
            let field_selected = selected.contains(&field.category)
                || field
                    .related_categories
                    .iter()
                    .any(|related| selected.contains(related));
            if container_selected || field_selected {
                if !selected.contains(&field.category) {
                    selected.push(field.category);
                    changed = true;
                }
                for related in &field.related_categories {
                    if !selected.contains(related) {
                        selected.push(*related);
                        changed = true;
                    }
                }
            }
        }
        selected = sorted_categories(&selected);
        if !changed || selected.len() > 16 {
            break;
        }
    }
    if selected.len() > 16 {
        return Err(PrivacyError::Unverified);
    }
    Ok(selected)
}

/// Build the complete closure shown before cleaning.
pub fn closure_for(
    fields: &[PrivacyField],
    signatures_present: bool,
    requested: &[MetadataCategory],
) -> Result<PrivacyClosure, PrivacyError> {
    let effective = effective_categories(fields, requested)?;
    let content_affecting = fields
        .iter()
        .any(|field| field.content_affecting && effective.contains(&field.category));
    Ok(PrivacyClosure {
        requested_categories: sorted_categories(requested),
        effective_categories: effective.clone(),
        content_affecting,
        appearance_affecting: effective.contains(&MetadataCategory::Icc),
        signatures_present,
    })
}

/// Refuse a request whose accepted closure is not exactly the disclosed one.
pub fn validate_accepted_closure(
    accepted: &[MetadataCategory],
    current: &[MetadataCategory],
) -> Result<(), PrivacyError> {
    validate_requested_categories(accepted)?;
    if !same_categories(accepted, current) {
        return Err(PrivacyError::BadRequest);
    }
    for category in accepted {
        if !current.contains(category) {
            return Err(PrivacyError::BadRequest);
        }
    }
    Ok(())
}

/// One page of fields, with the next index. The cursor is native-owned.
pub fn page_fields(
    fields: &[PrivacyField],
    start: usize,
) -> Result<(Vec<PrivacyField>, Option<usize>), PrivacyError> {
    if start > fields.len() {
        return Err(PrivacyError::BadRequest);
    }
    let mut page = Vec::new();
    let mut used = 2;
    let mut index = start;
    while index < fields.len() && page.len() < MAX_PAGE_FIELDS {
        let field = &fields[index];
        let size = serde_json::to_vec(field)
            .map_err(|_| PrivacyError::Failed)?
            .len()
            + 1;
        if !page.is_empty() && used + size > MAX_PAGE_BYTES {
            break;
        }
        if size > MAX_PAGE_BYTES {
            return Err(PrivacyError::TooLarge);
        }
        used += size;
        page.push(field.clone());
        index += 1;
    }
    let next = if index < fields.len() {
        Some(index)
    } else {
        None
    };
    Ok((page, next))
}

/// Counts for the selected categories only, bounded per category.
pub fn counts_for(fields: &[PrivacyField], categories: &[MetadataCategory]) -> Vec<MetadataCount> {
    let mut result = Vec::new();
    for category in sorted_categories(categories) {
        let matching: Vec<&PrivacyField> = fields
            .iter()
            .filter(|field| field.category == category)
            .collect();
        if matching.is_empty() {
            continue;
        }
        let count = matching
            .iter()
            .fold(0u32, |total, field| total.saturating_add(field.count));
        let coverage = matching.iter().fold(Coverage::Complete, |coverage, field| {
            coverage.weaker(field.coverage)
        });
        result.push(MetadataCount {
            category,
            count,
            coverage,
        });
    }
    result
}
