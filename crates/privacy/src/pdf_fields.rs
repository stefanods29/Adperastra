//! Bounded PDF metadata inspection (Step 08c D2/D6).

use convert::MetadataCategory;
use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::error::PrivacyError;
use crate::pdf_graph::{decompressed_stream, load_bounded, scan, PdfGraph};
use crate::types::{Coverage, MetadataContainer, PrivacyContext, PrivacyField};
use crate::xmp_rules;

/// The most AcroForm field references one inspection or clean walks.
pub const MAX_FORM_FIELDS: usize = 100_000;
const MAX_FORM_DEPTH: usize = 64;

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

fn pdf_text(object: &Object) -> Option<String> {
    match object {
        Object::String(bytes, _) => {
            let text = if bytes.starts_with(&[0xfe, 0xff]) {
                let units: Vec<u16> = bytes[2..]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                    .collect();
                String::from_utf16_lossy(&units)
            } else {
                String::from_utf8_lossy(bytes).to_string()
            };
            Some(text)
        }
        Object::Name(name) => Some(String::from_utf8_lossy(name).to_string()),
        _ => None,
    }
}

fn resolve<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object {
        Object::Reference(id) => doc.objects.get(id),
        _ => Some(object),
    }
}

fn as_dict<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Dictionary> {
    resolve(doc, object)?.as_dict().ok()
}

fn as_array<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Vec<Object>> {
    resolve(doc, object)?.as_array().ok()
}

fn name_of(dict: &Dictionary, key: &[u8]) -> Option<String> {
    dict.get(key)
        .ok()
        .and_then(|value| value.as_name().ok())
        .map(|value| String::from_utf8_lossy(value).to_string())
}

fn info_dict(doc: &Document) -> Option<&Dictionary> {
    let info = doc.trailer.get(b"Info").ok()?;
    as_dict(doc, info)
}

fn catalog(doc: &Document) -> Option<&Dictionary> {
    doc.catalog().ok()
}

fn push_info_fields(doc: &Document, fields: &mut Vec<PrivacyField>) {
    let Some(info) = info_dict(doc) else {
        return;
    };
    for (key, category, label, related) in [
        (
            b"Author".as_slice(),
            MetadataCategory::Author,
            "privacy.author",
            Vec::new(),
        ),
        (
            b"Creator".as_slice(),
            MetadataCategory::Author,
            "privacy.author",
            Vec::new(),
        ),
        (
            b"Producer".as_slice(),
            MetadataCategory::Author,
            "privacy.author",
            Vec::new(),
        ),
        (
            b"CreationDate".as_slice(),
            MetadataCategory::Timestamps,
            "privacy.timestamps",
            Vec::new(),
        ),
        (
            b"ModDate".as_slice(),
            MetadataCategory::Timestamps,
            "privacy.timestamps",
            Vec::new(),
        ),
        (
            b"Subject".as_slice(),
            MetadataCategory::Comments,
            "privacy.comments",
            Vec::new(),
        ),
        (
            b"Keywords".as_slice(),
            MetadataCategory::Comments,
            "privacy.comments",
            Vec::new(),
        ),
    ] {
        let Ok(value) = info.get(key) else {
            continue;
        };
        let preview = pdf_text(value)
            .map(|text| sanitize(&text))
            .unwrap_or_default();
        fields.push(PrivacyField {
            category,
            containers: vec![MetadataContainer::PdfInfo],
            related_categories: related,
            field_id: format!("pdf.info.{}", String::from_utf8_lossy(key)),
            label_key: label.to_string(),
            preview,
            count: 1,
            content_affecting: false,
            coverage: Coverage::Complete,
        });
    }
}

fn push_xmp_fields(
    doc: &Document,
    graph: &PdfGraph,
    context: &mut PrivacyContext,
    fields: &mut Vec<PrivacyField>,
) -> Result<(), PrivacyError> {
    let mut total = 0usize;
    for (index, id) in graph.metadata_streams.iter().enumerate() {
        context.check_cancelled()?;
        let bytes = match decompressed_stream(doc, *id, &mut total) {
            Ok(bytes) => bytes,
            Err(PrivacyError::TooLarge) => return Err(PrivacyError::TooLarge),
            Err(_) => {
                fields.push(PrivacyField {
                    category: MetadataCategory::Xmp,
                    containers: vec![MetadataContainer::PdfStructure, MetadataContainer::Xmp],
                    related_categories: Vec::new(),
                    // Object IDs are renumbered by a fresh save; the stream
                    // order is the stable retained-form identity.
                    field_id: format!("pdf.xmp.unreadable.{index}"),
                    label_key: "privacy.xmp".to_string(),
                    preview: String::new(),
                    count: 1,
                    content_affecting: false,
                    coverage: Coverage::Unknown,
                });
                continue;
            }
        };
        match xmp_rules::inspect_fields(&bytes) {
            Ok(mut xmp_fields) => {
                for field in &mut xmp_fields {
                    field.containers =
                        vec![MetadataContainer::PdfStructure, MetadataContainer::Xmp];
                }
                fields.append(&mut xmp_fields);
            }
            Err(_) => fields.push(PrivacyField {
                category: MetadataCategory::Xmp,
                containers: vec![MetadataContainer::PdfStructure, MetadataContainer::Xmp],
                related_categories: Vec::new(),
                field_id: format!("pdf.xmp.unreadable.{index}"),
                label_key: "privacy.xmp".to_string(),
                preview: String::new(),
                count: 1,
                content_affecting: false,
                coverage: Coverage::Unknown,
            }),
        }
    }
    Ok(())
}

fn push_annotations(doc: &Document, fields: &mut Vec<PrivacyField>, signatures_present: &mut bool) {
    let mut subtype_counts: std::collections::BTreeMap<(u32, String), u32> =
        std::collections::BTreeMap::new();
    for (page_number, page_id) in doc.get_pages() {
        let Ok(page) = doc.get_object(page_id).and_then(Object::as_dict) else {
            continue;
        };
        let Ok(annots) = page.get(b"Annots") else {
            continue;
        };
        let Some(values) = as_array(doc, annots) else {
            continue;
        };
        for value in values {
            let Some(dict) = as_dict(doc, value) else {
                continue;
            };
            let subtype = name_of(dict, b"Subtype").unwrap_or_else(|| "Unknown".to_string());
            let mut category = MetadataCategory::Annotations;
            let mut related = Vec::new();
            let mut label = "privacy.annotations";
            if subtype == "Widget" {
                category = MetadataCategory::Forms;
                label = "privacy.forms";
            } else if subtype == "FileAttachment" {
                category = MetadataCategory::Attachments;
                label = "privacy.attachments";
            }
            if has_javascript(doc, value) {
                related.push(MetadataCategory::Scripts);
            }
            if name_of(dict, b"FT").as_deref() == Some("Sig") {
                *signatures_present = true;
            }
            let index = subtype_counts
                .entry((page_number, subtype.clone()))
                .or_insert(0);
            let subtype_id: String = subtype
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() {
                        character
                    } else {
                        '_'
                    }
                })
                .take(48)
                .collect();
            let field_id = format!("pdf.annot.{}.{}.{}", page_number, subtype_id, *index);
            *index = (*index).saturating_add(1);
            fields.push(PrivacyField {
                category,
                containers: vec![MetadataContainer::PdfStructure],
                related_categories: related,
                field_id,
                label_key: label.to_string(),
                preview: String::new(),
                count: 1,
                content_affecting: true,
                coverage: Coverage::Complete,
            });
        }
    }
}

pub(crate) fn has_javascript(doc: &Document, object: &Object) -> bool {
    fn walk(doc: &Document, object: &Object, depth: usize) -> bool {
        if depth > 8 {
            return false;
        }
        if let Some(dict) = as_dict(doc, object) {
            if name_of(dict, b"S").as_deref() == Some("JavaScript") || dict.has(b"JS") {
                return true;
            }
            if let Ok(action) = dict.get(b"A") {
                if walk(doc, action, depth + 1) {
                    return true;
                }
            }
            if let Ok(aa) = dict.get(b"AA") {
                if let Some(actions) = as_dict(doc, aa) {
                    if actions.iter().any(|(_, value)| walk(doc, value, depth + 1)) {
                        return true;
                    }
                }
            }
        }
        if let Some(array) = as_array(doc, object) {
            return array.iter().any(|value| walk(doc, value, depth + 1));
        }
        false
    }
    walk(doc, object, 0)
}

fn push_scripts(doc: &Document, fields: &mut Vec<PrivacyField>) -> Result<(), PrivacyError> {
    let Some(catalog) = catalog(doc) else {
        return Ok(());
    };
    let mut sources = Vec::new();
    if catalog.has(b"OpenAction") {
        sources.push("openAction");
    }
    if catalog.has(b"AA") {
        sources.push("catalogAA");
    }
    if let Ok(names) = catalog.get(b"Names") {
        if let Some(names) = as_dict(doc, names) {
            if names.has(b"JavaScript") {
                sources.push("javaScriptNames");
            }
        }
    }
    for (_, page_id) in doc.get_pages() {
        if let Ok(page) = doc.get_object(page_id).and_then(Object::as_dict) {
            if page.has(b"AA") {
                sources.push("pageAA");
            }
            if let Ok(annots) = page.get(b"Annots") {
                if let Some(values) = as_array(doc, annots) {
                    if values.iter().any(|value| has_javascript(doc, value)) {
                        sources.push("annotationAction");
                    }
                }
            }
        }
    }
    if !form_action_field_ids(doc)?.is_empty() {
        sources.push("formAction");
    }
    sources.sort_unstable();
    sources.dedup();
    for source in sources {
        fields.push(PrivacyField {
            category: MetadataCategory::Scripts,
            containers: vec![MetadataContainer::PdfStructure],
            related_categories: Vec::new(),
            field_id: format!("pdf.script.{source}"),
            label_key: "privacy.scripts".to_string(),
            preview: String::new(),
            count: 1,
            content_affecting: true,
            coverage: Coverage::Complete,
        });
    }
    Ok(())
}

fn collect_form_action_ids(
    doc: &Document,
    object: &Object,
    depth: usize,
    seen: &mut std::collections::BTreeSet<ObjectId>,
    out: &mut Vec<ObjectId>,
) -> Result<(), PrivacyError> {
    if depth > MAX_FORM_DEPTH || out.len() >= MAX_FORM_FIELDS {
        return Err(PrivacyError::TooLarge);
    }
    match object {
        Object::Reference(id) => {
            if !seen.insert(*id) {
                return Ok(());
            }
            let Some(target) = doc.objects.get(id) else {
                return Ok(());
            };
            if let Ok(dict) = target.as_dict() {
                if (dict.has(b"A") || dict.has(b"AA"))
                    && has_javascript(doc, &Object::Reference(*id))
                {
                    out.push(*id);
                }
                if let Ok(kids) = dict.get(b"Kids") {
                    collect_form_action_ids(doc, kids, depth + 1, seen, out)?;
                }
            }
        }
        Object::Array(values) => {
            for value in values {
                collect_form_action_ids(doc, value, depth + 1, seen, out)?;
            }
        }
        Object::Dictionary(dict) => {
            if let Ok(kids) = dict.get(b"Kids") {
                collect_form_action_ids(doc, kids, depth + 1, seen, out)?;
            }
            if let Ok(fields) = dict.get(b"Fields") {
                collect_form_action_ids(doc, fields, depth + 1, seen, out)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Every referenced AcroForm field that carries a JavaScript action, bounded
/// by depth and count. Cleaning uses it to strip `/A` and `/AA` when scripts
/// are selected; inspection uses it to advertise form JavaScript.
pub(crate) fn form_action_field_ids(doc: &Document) -> Result<Vec<ObjectId>, PrivacyError> {
    let Some(catalog) = catalog(doc) else {
        return Ok(Vec::new());
    };
    let Ok(acroform) = catalog.get(b"AcroForm") else {
        return Ok(Vec::new());
    };
    let Some(form) = as_dict(doc, acroform) else {
        return Ok(Vec::new());
    };
    let Ok(field_list) = form.get(b"Fields") else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    collect_form_action_ids(doc, field_list, 0, &mut seen, &mut out)?;
    Ok(out)
}

fn push_attachments(doc: &Document, graph: &PdfGraph, fields: &mut Vec<PrivacyField>) {
    let mut count = 0u32;
    if let Some(catalog) = catalog(doc) {
        if let Ok(names) = catalog.get(b"Names") {
            if let Some(names) = as_dict(doc, names) {
                if names.has(b"EmbeddedFiles") {
                    count = count.saturating_add(1);
                }
            }
        }
        if catalog.has(b"AF") {
            count = count.saturating_add(1);
        }
    }
    count = count.saturating_add(graph.embedded_files.len() as u32);
    for (_, page_id) in doc.get_pages() {
        if let Ok(page) = doc.get_object(page_id).and_then(Object::as_dict) {
            if page.has(b"AF") {
                count = count.saturating_add(1);
            }
        }
    }
    if count > 0 {
        fields.push(PrivacyField {
            category: MetadataCategory::Attachments,
            containers: vec![MetadataContainer::PdfStructure],
            related_categories: Vec::new(),
            field_id: "pdf.attachments".to_string(),
            label_key: "privacy.attachments".to_string(),
            preview: String::new(),
            count,
            content_affecting: true,
            coverage: Coverage::Complete,
        });
    }
}

fn fields_contain_signature(doc: &Document, object: &Object, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    if let Some(dict) = as_dict(doc, object) {
        if name_of(dict, b"FT").as_deref() == Some("Sig") || dict.has(b"ByteRange") {
            return true;
        }
        if let Ok(kids) = dict.get(b"Kids") {
            if let Some(values) = as_array(doc, kids) {
                return values
                    .iter()
                    .any(|value| fields_contain_signature(doc, value, depth + 1));
            }
        }
    }
    if let Some(values) = as_array(doc, object) {
        return values
            .iter()
            .any(|value| fields_contain_signature(doc, value, depth + 1));
    }
    false
}

fn push_forms(doc: &Document, fields: &mut Vec<PrivacyField>, signatures_present: &mut bool) {
    let Some(catalog) = catalog(doc) else {
        return;
    };
    let Ok(acroform) = catalog.get(b"AcroForm") else {
        return;
    };
    let Some(form) = as_dict(doc, acroform) else {
        return;
    };
    if let Ok(field_list) = form.get(b"Fields") {
        *signatures_present |= fields_contain_signature(doc, field_list, 0);
    }
    let mut related = Vec::new();
    if form.has(b"XFA") {
        related.push(MetadataCategory::Scripts);
    }
    fields.push(PrivacyField {
        category: MetadataCategory::Forms,
        containers: vec![MetadataContainer::PdfStructure],
        related_categories: related,
        field_id: "pdf.forms".to_string(),
        label_key: "privacy.forms".to_string(),
        preview: String::new(),
        count: 1,
        content_affecting: true,
        coverage: Coverage::Complete,
    });
}

/// Inspect one PDF without modifying it.
pub fn inspect_pdf(
    bytes: &[u8],
    context: &mut PrivacyContext,
) -> Result<(Vec<PrivacyField>, bool), PrivacyError> {
    context.check_cancelled()?;
    let doc = load_bounded(bytes)?;
    let graph = scan(&doc)?;
    let mut fields = Vec::new();
    push_info_fields(&doc, &mut fields);
    push_xmp_fields(&doc, &graph, context, &mut fields)?;
    let mut signatures_present = !graph.signature_fields.is_empty();
    push_annotations(&doc, &mut fields, &mut signatures_present);
    push_scripts(&doc, &mut fields)?;
    push_attachments(&doc, &graph, &mut fields);
    push_forms(&doc, &mut fields, &mut signatures_present);
    if fields.len() > crate::inspect::MAX_INSPECTION_FIELDS {
        return Err(PrivacyError::TooLarge);
    }
    Ok((fields, signatures_present))
}
