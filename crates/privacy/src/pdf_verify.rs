//! Independent PDF re-inspection after a fresh save (Step 08c D7/D8).

use std::collections::BTreeMap;

use convert::MetadataCategory;
use lopdf::{Document, Object, ObjectId};

use crate::error::PrivacyError;
use crate::pdf_fields::inspect_pdf;
use crate::pdf_graph::{load_bounded, scan, MAX_STREAM_BYTES, MAX_TOTAL_STREAM_BYTES};
use crate::types::{PrivacyContext, PrivacyField};

/// A hash of every page's decoded content, used as the content invariant.
pub fn page_hashes(doc: &Document) -> Result<BTreeMap<u32, [u8; 32]>, PrivacyError> {
    let mut result = BTreeMap::new();
    let mut total = 0usize;
    for (page, id) in doc.get_pages() {
        let bytes = doc
            .get_page_content_with_limit(id, MAX_STREAM_BYTES)
            .map_err(|_| PrivacyError::TooLarge)?;
        total = total.saturating_add(bytes.len());
        if total > MAX_TOTAL_STREAM_BYTES {
            return Err(PrivacyError::TooLarge);
        }
        result.insert(page, *blake3::hash(&bytes).as_bytes());
    }
    Ok(result)
}

fn retained<'a>(
    fields: &'a [PrivacyField],
    selected: &[MetadataCategory],
) -> Vec<&'a PrivacyField> {
    fields
        .iter()
        .filter(|field| !selected.contains(&field.category))
        .collect()
}

/// Reopen the fresh output in a separate document and prove the selected
/// categories are gone, retained fields are unchanged and page content did
/// not change.
pub fn verify_clean(
    output: &[u8],
    selected: &[MetadataCategory],
    before_fields: &[PrivacyField],
    before_pages: &BTreeMap<u32, [u8; 32]>,
    context: &mut PrivacyContext,
) -> Result<(), PrivacyError> {
    context.check_cancelled()?;
    let mut doc = load_bounded(output)?;
    let graph = scan(&doc)?;
    if graph.ids.len() > crate::pdf_graph::MAX_PDF_OBJECTS {
        return Err(PrivacyError::TooLarge);
    }
    let mut before = retained(before_fields, selected);
    let (mut after_fields, _) = inspect_pdf(output, context)?;
    let mut after = retained(&after_fields, selected);
    before.sort_by(|left, right| left.field_id.cmp(&right.field_id));
    after.sort_by(|left, right| left.field_id.cmp(&right.field_id));
    if before.len() != after.len()
        || before.iter().zip(&after).any(|(left, right)| {
            left.field_id != right.field_id
                || left.preview != right.preview
                || left.count != right.count
                || left.coverage != right.coverage
                || left.content_affecting != right.content_affecting
        })
    {
        return Err(PrivacyError::Unverified);
    }
    if after_fields
        .iter()
        .any(|field| selected.contains(&field.category))
    {
        return Err(PrivacyError::Unverified);
    }
    let after_pages = page_hashes(&doc)?;
    if after_pages != *before_pages {
        return Err(PrivacyError::Unverified);
    }
    // A saved file carries its own cross-reference stream, which no other
    // object references; it is structure, not leaked content. Anything else
    // outside the reachable graph means the cleaner left data behind.
    let reachable = doc.traverse_objects(|_| {});
    let leaked: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(id, _)| !reachable.contains(id))
        .filter(|(_, object)| !is_structural(object))
        .map(|(id, _)| *id)
        .collect();
    if !leaked.is_empty() {
        return Err(PrivacyError::Unverified);
    }
    after_fields.clear();
    Ok(())
}

/// Objects the writer regenerates from the document state (never user data).
fn is_structural(object: &Object) -> bool {
    matches!(object.type_name(), Ok(name) if name == b"XRef" || name == b"ObjStm")
}

/// Ensure no object outside the reachable graph survived the fresh save.
pub fn unreachable_objects(doc: &mut Document) -> Result<Vec<ObjectId>, PrivacyError> {
    Ok(doc.prune_objects())
}
