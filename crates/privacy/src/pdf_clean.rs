//! Fresh, verified PDF cleaning (Step 08c T4/D6/D7).

use std::io::Write;

use convert::MetadataCategory;
use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::error::PrivacyError;
use crate::inspect::{counts_for, effective_categories};
use crate::pdf_fields::{form_action_field_ids, has_javascript, inspect_pdf};
use crate::pdf_graph::{decompressed_stream, load_bounded, scan, PdfGraph};
use crate::pdf_verify::{page_hashes, verify_clean};
use crate::registry::{PrivacyAdapter, PDF_CATEGORIES};
use crate::types::{Coverage, PrivacyCleanSummary, PrivacyContext, PrivacyField};
use crate::xmp_rules;

pub struct PdfPrivacyAdapter;

impl PrivacyAdapter for PdfPrivacyAdapter {
    fn id(&self) -> &'static str {
        "pdf"
    }

    fn categories(&self) -> &'static [MetadataCategory] {
        PDF_CATEGORIES
    }

    fn inspect(
        &self,
        input: &mut dyn convert::ReadSeek,
        context: &mut PrivacyContext,
    ) -> Result<Vec<PrivacyField>, PrivacyError> {
        let bytes = crate::bounded_input::read(input, context)?;
        inspect_pdf(&bytes, context).map(|(fields, _)| fields)
    }

    fn clean(
        &self,
        input: &mut dyn convert::ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError> {
        let bytes = crate::bounded_input::read(input, context)?;
        let (cleaned, summary) = clean_pdf(&bytes, categories, context)?;
        output.write_all(&cleaned)?;
        Ok(summary)
    }
}

fn remove_info(doc: &mut Document, selected: &[MetadataCategory]) {
    let info = doc.trailer.get(b"Info").ok().cloned();
    let mut remove_keys: Vec<&[u8]> = Vec::new();
    if selected.contains(&MetadataCategory::Author) {
        remove_keys.extend_from_slice(&[
            b"Author".as_slice(),
            b"Creator".as_slice(),
            b"Producer".as_slice(),
        ]);
    }
    if selected.contains(&MetadataCategory::Timestamps) {
        remove_keys.extend_from_slice(&[b"CreationDate".as_slice(), b"ModDate".as_slice()]);
    }
    if selected.contains(&MetadataCategory::Comments) {
        remove_keys.extend_from_slice(&[b"Subject".as_slice(), b"Keywords".as_slice()]);
    }
    if remove_keys.is_empty() {
        return;
    }
    match info {
        Some(Object::Reference(id)) => {
            if let Ok(dict) = doc.get_dictionary_mut(id) {
                for key in remove_keys {
                    dict.remove(key);
                }
            }
        }
        Some(Object::Dictionary(mut dict)) => {
            for key in remove_keys {
                dict.remove(key);
            }
            if dict.is_empty() {
                doc.trailer.remove(b"Info");
            } else {
                doc.trailer.set("Info", Object::Dictionary(dict));
            }
        }
        _ => {}
    }
}

fn remove_names_entries(doc: &mut Document, selected: &[MetadataCategory]) {
    let names = doc
        .catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"Names").ok())
        .cloned();
    match names {
        Some(Object::Dictionary(mut dict)) => {
            if selected.contains(&MetadataCategory::Scripts) {
                dict.remove(b"JavaScript");
            }
            if selected.contains(&MetadataCategory::Attachments) {
                dict.remove(b"EmbeddedFiles");
            }
            if let Ok(catalog) = doc.catalog_mut() {
                if dict.is_empty() {
                    catalog.remove(b"Names");
                } else {
                    catalog.set("Names", Object::Dictionary(dict));
                }
            }
        }
        Some(Object::Reference(id)) => {
            if let Ok(dict) = doc.get_dictionary_mut(id) {
                if selected.contains(&MetadataCategory::Scripts) {
                    dict.remove(b"JavaScript");
                }
                if selected.contains(&MetadataCategory::Attachments) {
                    dict.remove(b"EmbeddedFiles");
                }
            }
        }
        _ => {}
    }
}

fn rewrite_metadata_streams(
    doc: &mut Document,
    graph: &PdfGraph,
    selected: &[MetadataCategory],
    context: &mut PrivacyContext,
) -> Result<(), PrivacyError> {
    if graph.metadata_streams.is_empty() {
        return Ok(());
    }
    if selected.contains(&MetadataCategory::Xmp) {
        for id in &graph.metadata_streams {
            doc.delete_object(*id);
        }
        if let Ok(catalog) = doc.catalog_mut() {
            catalog.remove(b"Metadata");
        }
        return Ok(());
    }
    let changes_xmp = selected.iter().any(|category| {
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
    });
    if !changes_xmp {
        return Ok(());
    }
    let mut total = 0usize;
    for id in &graph.metadata_streams {
        context.check_cancelled()?;
        let bytes = decompressed_stream(doc, *id, &mut total)?;
        match xmp_rules::remove_categories(&bytes, selected)? {
            None => {
                doc.delete_object(*id);
                if let Ok(catalog) = doc.catalog_mut() {
                    if catalog
                        .get(b"Metadata")
                        .ok()
                        .and_then(|value| value.as_reference().ok())
                        == Some(*id)
                    {
                        catalog.remove(b"Metadata");
                    }
                }
            }
            Some(value) => {
                if let Ok(Object::Stream(stream)) = doc.get_object_mut(*id) {
                    stream.set_plain_content(value);
                }
            }
        }
    }
    Ok(())
}

fn annotation_kind(doc: &Document, value: &Object) -> MetadataCategory {
    let Some(dict) = (match value {
        Object::Reference(id) => doc.objects.get(id).and_then(|item| item.as_dict().ok()),
        Object::Dictionary(dict) => Some(dict),
        _ => None,
    }) else {
        return MetadataCategory::Annotations;
    };
    let subtype = dict
        .get(b"Subtype")
        .ok()
        .and_then(|value| value.as_name().ok())
        .unwrap_or(b"");
    if subtype == b"Widget" {
        MetadataCategory::Forms
    } else if subtype == b"FileAttachment" {
        MetadataCategory::Attachments
    } else {
        MetadataCategory::Annotations
    }
}

fn remove_action_keys(dict: &mut Dictionary) {
    dict.remove(b"A");
    dict.remove(b"AA");
}

fn clean_pages(
    doc: &mut Document,
    selected: &[MetadataCategory],
) -> Result<Vec<ObjectId>, PrivacyError> {
    let mut deleted = Vec::new();
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    for (_, page_id) in pages {
        let Some(page) = doc
            .get_object(page_id)
            .and_then(Object::as_dict)
            .ok()
            .cloned()
        else {
            continue;
        };
        let mut keep_annotations: Option<Vec<Object>> = None;
        if let Ok(annots) = page.get(b"Annots") {
            let values: Vec<Object> = match annots {
                Object::Array(values) => values.clone(),
                Object::Reference(id) => doc
                    .objects
                    .get(id)
                    .and_then(|item| item.as_array().ok())
                    .cloned()
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let mut keep = Vec::new();
            for value in values {
                let kind = annotation_kind(doc, &value);
                if selected.contains(&kind) {
                    if let Object::Reference(id) = value {
                        deleted.push(id);
                    }
                    continue;
                }
                if selected.contains(&MetadataCategory::Scripts) && has_javascript(doc, &value) {
                    match value {
                        Object::Reference(id) => {
                            if let Ok(dict) = doc.get_dictionary_mut(id) {
                                remove_action_keys(dict);
                            }
                            keep.push(Object::Reference(id));
                        }
                        Object::Dictionary(mut dict) => {
                            remove_action_keys(&mut dict);
                            keep.push(Object::Dictionary(dict));
                        }
                        other => keep.push(other),
                    }
                } else {
                    keep.push(value);
                }
            }
            keep_annotations = Some(keep);
        }
        if let Ok(page_mut) = doc.get_dictionary_mut(page_id) {
            if selected.contains(&MetadataCategory::Scripts) {
                page_mut.remove(b"AA");
            }
            if selected.contains(&MetadataCategory::Attachments) {
                page_mut.remove(b"AF");
            }
            if let Some(keep) = keep_annotations {
                if keep.is_empty() {
                    page_mut.remove(b"Annots");
                } else {
                    page_mut.set("Annots", Object::Array(keep));
                }
            }
        }
    }
    if let Ok(catalog) = doc.catalog_mut() {
        if selected.contains(&MetadataCategory::Scripts) {
            catalog.remove(b"OpenAction");
            catalog.remove(b"AA");
        }
        if selected.contains(&MetadataCategory::Attachments) {
            catalog.remove(b"AF");
        }
        if selected.contains(&MetadataCategory::Forms) {
            catalog.remove(b"AcroForm");
        }
    }
    for id in &deleted {
        doc.delete_object(*id);
    }
    Ok(deleted)
}

fn all_other_categories(selected: &[MetadataCategory]) -> Vec<MetadataCategory> {
    PDF_CATEGORIES
        .iter()
        .filter(|category| !selected.contains(*category))
        .cloned()
        .collect()
}

/// Clean one PDF from bounded source bytes. The caller owns publication.
pub fn clean_pdf(
    bytes: &[u8],
    categories: &[MetadataCategory],
    context: &mut PrivacyContext,
) -> Result<(Vec<u8>, PrivacyCleanSummary), PrivacyError> {
    context.check_cancelled()?;
    if categories.is_empty() {
        return Err(PrivacyError::BadRequest);
    }
    for category in categories {
        if !PDF_CATEGORIES.contains(category) {
            return Err(PrivacyError::BadRequest);
        }
    }
    let mut doc = load_bounded(bytes)?;
    let graph = scan(&doc)?;
    let (before_fields, _) = inspect_pdf(bytes, context)?;
    let selected = effective_categories(&before_fields, categories)?;
    for field in &before_fields {
        if field.coverage == Coverage::Unknown
            && selected.contains(&field.category)
            && !(field.category == MetadataCategory::Xmp
                && selected.contains(&MetadataCategory::Xmp))
        {
            return Err(PrivacyError::Unverified);
        }
    }
    let before_pages = page_hashes(&doc)?;
    remove_info(&mut doc, &selected);
    rewrite_metadata_streams(&mut doc, &graph, &selected, context)?;
    remove_names_entries(&mut doc, &selected);
    let deleted = clean_pages(&mut doc, &selected)?;
    if selected.contains(&MetadataCategory::Attachments) {
        for id in &graph.embedded_files {
            doc.delete_object(*id);
        }
    }
    if selected.contains(&MetadataCategory::Scripts) {
        for id in form_action_field_ids(&doc)? {
            if let Ok(dict) = doc.get_dictionary_mut(id) {
                remove_action_keys(dict);
            }
        }
        for id in &graph.javascript_objects {
            doc.delete_object(*id);
        }
    }
    for id in deleted {
        doc.delete_object(id);
    }
    doc.prune_objects();
    doc.renumber_objects();
    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| PrivacyError::Unverified)?;
    if output.len() as u64 > context.max_output_bytes() {
        return Err(PrivacyError::TooLarge);
    }
    verify_clean(&output, &selected, &before_fields, &before_pages, context)?;
    let (after_fields, _) = inspect_pdf(&output, context)?;
    let removed = counts_for(&before_fields, &selected);
    let retained = counts_for(&after_fields, &all_other_categories(&selected));
    let output_bytes = output.len() as u64;
    Ok((
        output,
        PrivacyCleanSummary {
            removed_category_counts: removed,
            retained_category_counts: retained,
            coverage: Coverage::Complete,
            output_bytes,
        },
    ))
}
