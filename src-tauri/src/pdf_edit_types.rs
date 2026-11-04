//! Wire and inspection types of the native PDF edit host (Step 14a).
//!
//! The helper (`src/pdf-write-helper/editTypes.ts`) returns the source
//! inspection as bounded JSON. This module maps that answer to the exact
//! `PdfEditInspection` shape `src/pdf-edit/types.ts` validates. Annotation
//! UUIDs are the existing `/NM` values: they are never replaced, so a
//! re-saved annotation keeps the identity the file already had. Only pages
//! receive fresh ids, because a PDF page has no stable UUID of its own.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::export_snapshot_types::{ExportSnapshot, StoragePolicy};

pub const PDF_EDIT_MAX_PAGES: usize = 10_000;
pub const PDF_EDIT_MAX_ANNOTATIONS: usize = 100_000;
pub const PDF_EDIT_MAX_FORMS: usize = 10_000;
pub const PDF_EDIT_MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const PDF_EDIT_MAX_WIRE_BYTES: usize = 64 * 1024 * 1024;
pub const PDF_EDIT_MAX_SIGNATURE_BYTES: u64 = 8 * 1024 * 1024;
pub const PDF_EDIT_MAX_AUTHOR_CHARS: usize = 128;
pub const PDF_EDIT_MAX_TEXT_CHARS: usize = 8_192;
pub const PDF_EDIT_MAX_FIELD_ID_CHARS: usize = 512;
pub const PDF_EDIT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// One `pdf.edit.inspect` request. The snapshot is an authorized 08a
/// identity, never a path or caller-chosen bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PdfEditInspectRequest {
    pub document_id: String,
    pub snapshot_id: String,
    pub revision: u64,
    pub content_id: String,
}

/// One `pdf.edit.serialize` request. `model` is the bounded wire model
/// (`history` excluded); every referenced source is resolved natively.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PdfEditSerializeRequest {
    pub document_id: String,
    pub snapshot_id: String,
    pub revision: u64,
    pub content_id: String,
    pub model: serde_json::Value,
    #[serde(default)]
    pub owned_annotation_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfEditPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfEditRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperLoadedPage {
    pub origin_page: u32,
    pub rotation: u16,
    pub crop: PdfEditRect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperLoadedAnnotation {
    pub origin_page: u32,
    pub nm: Option<String>,
    pub kind: String,
    pub rect: PdfEditRect,
    pub color: [f64; 4],
    pub opacity: f64,
    pub author: String,
    pub created_unix: u64,
    pub text: String,
    #[serde(default)]
    pub quads: Option<Vec<Vec<PdfEditPoint>>>,
    #[serde(default)]
    pub strokes: Option<Vec<Vec<PdfEditPoint>>>,
    #[serde(default)]
    pub parent_nm: Option<String>,
    #[serde(default)]
    pub font_size: Option<f64>,
}

/// The `PdfEditInspectReply` uploaded by the helper as one JSON output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperInspectReply {
    pub pages: Vec<HelperLoadedPage>,
    pub annotations: Vec<HelperLoadedAnnotation>,
    #[serde(default)]
    pub forms: Vec<serde_json::Value>,
    #[serde(default)]
    pub form_options: Vec<serde_json::Value>,
    pub signature_present: bool,
    pub xfa_present: bool,
    #[serde(default)]
    pub rich_text_fields: Vec<String>,
    #[serde(default)]
    pub unsupported_structures: Vec<String>,
    #[serde(default)]
    pub owned_annotation_ids: Vec<String>,
    #[serde(default)]
    pub unknown_annotations: u64,
    #[serde(default)]
    pub byte_len: u64,
}

/// The `PdfEditSerializeReply` returned by `pdf.edit.serialize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperSerializeReply {
    pub page_count: u32,
    pub annotation_count: u32,
    #[serde(default)]
    pub forms: Vec<serde_json::Value>,
    pub unknown_annotations_preserved: bool,
    #[serde(default)]
    pub dropped_structures: Vec<String>,
    #[serde(default)]
    pub byte_len: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditPageState {
    pub id: String,
    pub origin_source: ExportSnapshot,
    pub origin_page: u32,
    pub rotation: u16,
    pub crop: PdfEditRect,
    pub annotation_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditAnnotation {
    pub id: String,
    pub page_id: String,
    pub kind: String,
    pub rect: PdfEditRect,
    pub color: [f64; 4],
    pub opacity: f64,
    pub author: String,
    pub created_unix: u64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quads: Option<Vec<Vec<PdfEditPoint>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strokes: Option<Vec<Vec<PdfEditPoint>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditCapabilities {
    pub signature_present: bool,
    pub xfa_present: bool,
    pub rich_text_fields: Vec<String>,
    pub unsupported_structures: Vec<String>,
    pub sensitive_memory_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditInspection {
    pub pages: Vec<PdfEditPageState>,
    pub annotations: Vec<PdfEditAnnotation>,
    pub forms: Vec<serde_json::Value>,
    pub form_options: Vec<serde_json::Value>,
    pub owned_annotation_ids: Vec<String>,
    pub unknown_annotations: u64,
    pub capabilities: PdfEditCapabilities,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditSerializeInspection {
    pub page_count: u32,
    pub annotation_count: u32,
    pub forms: Vec<serde_json::Value>,
    pub unknown_annotations_preserved: bool,
    pub dropped_structures: Vec<String>,
    pub byte_len: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfEditSerializeOutcome {
    pub snapshot: ExportSnapshot,
    pub inspection: PdfEditSerializeInspection,
}

fn canonical_uuid(value: &str) -> Result<String, String> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| "pdf_edit.bad_request".to_string())
}

fn valid_rect(rect: &PdfEditRect) -> bool {
    [rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|value| value.is_finite())
        && rect.width >= 0.0
        && rect.height >= 0.0
}

fn valid_rotation(rotation: u16) -> bool {
    matches!(rotation, 0 | 90 | 180 | 270)
}

fn valid_kind(kind: &str) -> bool {
    matches!(kind, "highlight" | "ink" | "text" | "comment" | "signature")
}

fn valid_points(groups: &Option<Vec<Vec<PdfEditPoint>>>) -> bool {
    let Some(groups) = groups else { return true };
    groups.iter().all(|group| {
        !group.is_empty()
            && group
                .iter()
                .all(|point| point.x.is_finite() && point.y.is_finite())
    })
}

fn valid_form_values(values: &[serde_json::Value]) -> bool {
    values.iter().all(|value| {
        let Some(field) = value.as_object() else {
            return false;
        };
        let Some(field_id) = field.get("field_id").and_then(serde_json::Value::as_str) else {
            return false;
        };
        !field_id.is_empty()
            && field_id.chars().count() <= PDF_EDIT_MAX_FIELD_ID_CHARS
            && field
                .get("kind")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|kind| matches!(kind, "text" | "check" | "radio" | "choice"))
            && field
                .get("readonly")
                .is_some_and(serde_json::Value::is_boolean)
    })
}

fn valid_form_options(values: &[serde_json::Value]) -> bool {
    values.iter().all(|value| {
        let Some(option) = value.as_object() else {
            return false;
        };
        option
            .get("field_id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| id.chars().count() <= PDF_EDIT_MAX_FIELD_ID_CHARS)
            && option
                .get("options")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|options| {
                    options.len() <= 1_000
                        && options.iter().all(|entry| {
                            entry
                                .as_str()
                                .is_some_and(|text| text.chars().count() <= 32_767)
                        })
                })
    })
}

/// Map one helper inspection to the canonical TS inspection. Existing
/// annotation `/NM` UUIDs stay the annotation ids; page ids are fresh.
pub fn map_inspection(
    reply: HelperInspectReply,
    origin: &ExportSnapshot,
) -> Result<PdfEditInspection, String> {
    if reply.pages.is_empty() || reply.pages.len() > PDF_EDIT_MAX_PAGES {
        return Err("pdf_edit.too_large".to_string());
    }
    if reply.annotations.len() > PDF_EDIT_MAX_ANNOTATIONS
        || reply.forms.len() > PDF_EDIT_MAX_FORMS
        || reply.form_options.len() > PDF_EDIT_MAX_FORMS
    {
        return Err("pdf_edit.too_large".to_string());
    }
    if !valid_form_values(&reply.forms) || !valid_form_options(&reply.form_options) {
        return Err("pdf_edit.bad_request".to_string());
    }

    let mut pages: Vec<PdfEditPageState> = Vec::with_capacity(reply.pages.len());
    let mut page_by_origin: HashMap<u32, usize> = HashMap::new();
    for page in &reply.pages {
        if page.origin_page < 1
            || page.origin_page as usize > PDF_EDIT_MAX_PAGES
            || page_by_origin.contains_key(&page.origin_page)
            || !valid_rotation(page.rotation)
            || !valid_rect(&page.crop)
        {
            return Err("pdf_edit.bad_request".to_string());
        }
        page_by_origin.insert(page.origin_page, pages.len());
        pages.push(PdfEditPageState {
            id: Uuid::new_v4().to_string(),
            origin_source: origin.clone(),
            origin_page: page.origin_page,
            rotation: page.rotation,
            crop: page.crop,
            annotation_ids: Vec::new(),
        });
    }

    let mut annotations: Vec<PdfEditAnnotation> = Vec::with_capacity(reply.annotations.len());
    let mut annotation_ids: HashSet<String> = HashSet::new();
    for raw in &reply.annotations {
        let nm = raw
            .nm
            .as_deref()
            .ok_or_else(|| "pdf_edit.bad_request".to_string())?;
        let id = canonical_uuid(nm)?;
        if !annotation_ids.insert(id.clone()) {
            return Err("pdf_edit.changed".to_string());
        }
        let page_index = *page_by_origin
            .get(&raw.origin_page)
            .ok_or_else(|| "pdf_edit.changed".to_string())?;
        if !valid_kind(&raw.kind)
            || !valid_rect(&raw.rect)
            || raw
                .color
                .iter()
                .any(|channel| !channel.is_finite() || !(0.0..=1.0).contains(channel))
            || !raw.opacity.is_finite()
            || !(0.0..=1.0).contains(&raw.opacity)
            || raw.author.chars().count() > PDF_EDIT_MAX_AUTHOR_CHARS
            || raw.text.chars().count() > PDF_EDIT_MAX_TEXT_CHARS
            || raw.created_unix > PDF_EDIT_MAX_SAFE_INTEGER
            || !valid_points(&raw.quads)
            || !valid_points(&raw.strokes)
            || raw
                .font_size
                .is_some_and(|size| !size.is_finite() || !(6.0..=144.0).contains(&size))
        {
            return Err("pdf_edit.bad_request".to_string());
        }
        let parent_id = raw.parent_nm.as_deref().map(canonical_uuid).transpose()?;
        annotations.push(PdfEditAnnotation {
            id: id.clone(),
            page_id: pages[page_index].id.clone(),
            kind: raw.kind.clone(),
            rect: raw.rect,
            color: raw.color,
            opacity: raw.opacity,
            author: raw.author.clone(),
            created_unix: raw.created_unix,
            text: raw.text.clone(),
            quads: raw.quads.clone(),
            strokes: raw.strokes.clone(),
            parent_id,
            font_size: raw.font_size,
        });
        pages[page_index].annotation_ids.push(id);
    }

    // A reply parent must be one of the inspected comments; anything else is
    // a stale identity and is refused rather than written as a broken /IRT.
    for annotation in &annotations {
        if let Some(parent_id) = annotation.parent_id.as_deref() {
            if parent_id == annotation.id
                || !annotation_ids.contains(parent_id)
                || !annotations
                    .iter()
                    .any(|entry| entry.id == parent_id && entry.kind == "comment")
            {
                return Err("pdf_edit.changed".to_string());
            }
        }
    }

    let mut owned = Vec::new();
    let mut owned_set: HashSet<String> = HashSet::new();
    for value in &reply.owned_annotation_ids {
        let id = canonical_uuid(value)?;
        if !annotation_ids.contains(&id) {
            return Err("pdf_edit.changed".to_string());
        }
        if owned_set.insert(id.clone()) {
            owned.push(id);
        }
    }

    if reply.unknown_annotations > PDF_EDIT_MAX_ANNOTATIONS as u64 {
        return Err("pdf_edit.too_large".to_string());
    }

    Ok(PdfEditInspection {
        pages,
        annotations,
        forms: reply.forms,
        form_options: reply.form_options,
        owned_annotation_ids: owned,
        unknown_annotations: reply.unknown_annotations,
        capabilities: PdfEditCapabilities {
            signature_present: reply.signature_present,
            xfa_present: reply.xfa_present,
            rich_text_fields: reply.rich_text_fields,
            unsupported_structures: reply.unsupported_structures,
            sensitive_memory_only: origin.storage_policy == StoragePolicy::Sensitive,
        },
    })
}

/// Map the helper's serializer answer and require the exact edited counts.
pub fn map_serialize_inspection(
    reply: HelperSerializeReply,
    page_count: usize,
    annotation_count: usize,
) -> Result<PdfEditSerializeInspection, String> {
    if reply.page_count as usize != page_count
        || reply.annotation_count as usize != annotation_count
    {
        return Err("pdf_edit.unsupported".to_string());
    }
    if reply.forms.len() > PDF_EDIT_MAX_FORMS || !valid_form_values(&reply.forms) {
        return Err("pdf_edit.bad_request".to_string());
    }
    if !reply.unknown_annotations_preserved || !reply.dropped_structures.is_empty() {
        return Err("pdf_edit.unsupported".to_string());
    }
    Ok(PdfEditSerializeInspection {
        page_count: reply.page_count,
        annotation_count: reply.annotation_count,
        forms: reply.forms,
        unknown_annotations_preserved: true,
        dropped_structures: Vec::new(),
        byte_len: reply.byte_len,
    })
}
