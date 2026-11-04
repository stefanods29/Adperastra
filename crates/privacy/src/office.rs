//! Privacy adapter for Office containers (Step 12b T6, D9).
//!
//! The adapter inspects and removes the Office-specific categories this step
//! adds: the last user who saved the file, the company name, tracked changes,
//! hidden text, speaker notes and comments. Removing comments, tracked
//! changes, hidden text or notes changes the document content and is reported
//! as such (`content_affecting`), so it needs its own acknowledgement.
//!
//! Policy for tracked changes is "accept the currently visible content":
//! deletions are removed, insertions are kept, and then the change markup is
//! gone. An unknown change or content structure fails verification instead of
//! producing a half-cleaned file.

use std::io::Write;

use convert::{MetadataCategory, ReadSeek};

use crate::error::PrivacyError;
use crate::office_rewrite::{
    count_elements, element_text, refuses_active_content, remove_elements, rewrite,
    unwrap_elements, Part,
};
use crate::registry::PrivacyAdapter;
use crate::types::{MetadataContainer, PrivacyCleanSummary, PrivacyContext, PrivacyField};

/// The stable ID of this adapter.
pub const ADAPTER_ID: &str = "office";

/// The categories this adapter truthfully handles.
pub const CATEGORIES: [MetadataCategory; 8] = [
    MetadataCategory::Author,
    MetadataCategory::LastModifiedBy,
    MetadataCategory::Company,
    MetadataCategory::Comments,
    MetadataCategory::TrackedChanges,
    MetadataCategory::HiddenText,
    MetadataCategory::SpeakerNotes,
    MetadataCategory::Timestamps,
];

/// The bounded preview length of one inspector row.
pub const MAX_PREVIEW: usize = 512;

/// The Office privacy adapter.
#[derive(Debug, Default, Clone, Copy)]
pub struct OfficePrivacyAdapter;

impl OfficePrivacyAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl PrivacyAdapter for OfficePrivacyAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn categories(&self) -> &'static [MetadataCategory] {
        &CATEGORIES
    }

    fn inspect(
        &self,
        input: &mut dyn ReadSeek,
        _context: &mut PrivacyContext,
    ) -> Result<Vec<PrivacyField>, PrivacyError> {
        let parts = crate::office_rewrite::read_parts(input)?;
        let mut fields: Vec<PrivacyField> = Vec::new();
        for part in &parts {
            let lowered = part.name.to_ascii_lowercase();
            let xml = String::from_utf8_lossy(&part.bytes).into_owned();
            if refuses_active_content(&xml) {
                return Err(PrivacyError::Unverified);
            }
            if lowered.ends_with("docprops/core.xml") {
                push_text_field(
                    &mut fields,
                    "office.core.creator",
                    "dc:creator",
                    &xml,
                    MetadataCategory::Author,
                    MetadataContainer::PdfInfo,
                    false,
                );
                push_text_field(
                    &mut fields,
                    "office.core.last_modified_by",
                    "cp:lastModifiedBy",
                    &xml,
                    MetadataCategory::LastModifiedBy,
                    MetadataContainer::PdfInfo,
                    false,
                );
                push_text_field(
                    &mut fields,
                    "office.core.created",
                    "dcterms:created",
                    &xml,
                    MetadataCategory::Timestamps,
                    MetadataContainer::PdfInfo,
                    false,
                );
                push_text_field(
                    &mut fields,
                    "office.core.modified",
                    "dcterms:modified",
                    &xml,
                    MetadataCategory::Timestamps,
                    MetadataContainer::PdfInfo,
                    false,
                );
            }
            if lowered.ends_with("docprops/app.xml") {
                push_text_field(
                    &mut fields,
                    "office.app.company",
                    "Company",
                    &xml,
                    MetadataCategory::Company,
                    MetadataContainer::PdfInfo,
                    false,
                );
            }
            if lowered.contains("comments") && lowered.ends_with(".xml") {
                let count = count_elements(&xml, "w:comment")? as u32;
                if count > 0 {
                    fields.push(field(
                        MetadataCategory::Comments,
                        "office.comments",
                        MetadataContainer::PdfStructure,
                        count,
                        true,
                        "comments",
                    ));
                }
            }
            if lowered.ends_with("word/document.xml") {
                let deletions = count_elements(&xml, "w:del")? as u32;
                let insertions = count_elements(&xml, "w:ins")? as u32;
                if deletions + insertions > 0 {
                    fields.push(field(
                        MetadataCategory::TrackedChanges,
                        "office.tracked_changes",
                        MetadataContainer::PdfStructure,
                        deletions + insertions,
                        true,
                        "tracked changes",
                    ));
                }
                let hidden = count_elements(&xml, "w:vanish")? as u32;
                if hidden > 0 {
                    fields.push(field(
                        MetadataCategory::HiddenText,
                        "office.hidden_text",
                        MetadataContainer::PdfStructure,
                        hidden,
                        true,
                        "hidden text",
                    ));
                }
            }
            if lowered.starts_with("ppt/notesslides/") {
                let count = fields
                    .iter()
                    .find(|existing| existing.category == MetadataCategory::SpeakerNotes)
                    .map(|existing| existing.count)
                    .unwrap_or(0);
                fields.retain(|existing| existing.category != MetadataCategory::SpeakerNotes);
                fields.push(field(
                    MetadataCategory::SpeakerNotes,
                    "office.speaker_notes",
                    MetadataContainer::PdfStructure,
                    count.saturating_add(1),
                    true,
                    "speaker notes",
                ));
            }
        }
        Ok(fields)
    }

    fn clean(
        &self,
        input: &mut dyn ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError> {
        if categories.is_empty() {
            return Err(PrivacyError::BadRequest);
        }
        // Hidden text cannot be removed without deleting the runs that carry
        // it; this adapter refuses instead of pretending.
        if categories.contains(&MetadataCategory::HiddenText) {
            return Err(PrivacyError::Unverified);
        }
        let parts = crate::office_rewrite::read_parts(input)?;
        let mut changes: Vec<(String, Vec<u8>)> = Vec::new();
        let mut dropped: Vec<String> = Vec::new();
        let mut removed = MetadataCounts::default();
        for part in &parts {
            let lowered = part.name.to_ascii_lowercase();
            let mut xml = String::from_utf8_lossy(&part.bytes).into_owned();
            if refuses_active_content(&xml) {
                return Err(PrivacyError::Unverified);
            }
            let mut edited = false;
            if lowered.ends_with("docprops/core.xml") {
                if let Some(count) = remove_if_selected(
                    &mut xml,
                    "dc:creator",
                    categories.contains(&MetadataCategory::Author),
                )? {
                    removed.add(MetadataCategory::Author, count);
                    edited = true;
                }
                if let Some(count) = remove_if_selected(
                    &mut xml,
                    "cp:lastModifiedBy",
                    categories.contains(&MetadataCategory::LastModifiedBy),
                )? {
                    removed.add(MetadataCategory::LastModifiedBy, count);
                    edited = true;
                }
                for element in ["dcterms:created", "dcterms:modified"] {
                    if let Some(count) = remove_if_selected(
                        &mut xml,
                        element,
                        categories.contains(&MetadataCategory::Timestamps),
                    )? {
                        removed.add(MetadataCategory::Timestamps, count);
                        edited = true;
                    }
                }
            }
            if lowered.ends_with("docprops/app.xml") {
                if let Some(count) = remove_if_selected(
                    &mut xml,
                    "Company",
                    categories.contains(&MetadataCategory::Company),
                )? {
                    removed.add(MetadataCategory::Company, count);
                    edited = true;
                }
            }
            if lowered.contains("comments")
                && lowered.ends_with(".xml")
                && categories.contains(&MetadataCategory::Comments)
            {
                dropped.push(part.name.clone());
                removed.add(MetadataCategory::Comments, 1);
                continue;
            }
            if lowered.starts_with("ppt/notesslides/")
                && categories.contains(&MetadataCategory::SpeakerNotes)
            {
                dropped.push(part.name.clone());
                removed.add(MetadataCategory::SpeakerNotes, 1);
                continue;
            }
            if lowered.ends_with("word/document.xml")
                && categories.contains(&MetadataCategory::TrackedChanges)
            {
                let deletions = count_elements(&xml, "w:del")? as u32;
                let insertions = count_elements(&xml, "w:ins")? as u32;
                if deletions + insertions > 0 {
                    // Accept the visible content: drop deletions, keep the
                    // text of insertions, then remove the change markup.
                    xml = remove_elements(&xml, "w:del")?;
                    xml = unwrap_elements(&xml, "w:ins")?;
                    if xml.contains("<w:ins") || xml.contains("<w:del") {
                        return Err(PrivacyError::Unverified);
                    }
                    removed.add(MetadataCategory::TrackedChanges, deletions + insertions);
                    edited = true;
                }
            }
            if edited {
                changes.push((part.name.clone(), xml.into_bytes()));
            }
        }
        check_cancelled(context)?;
        let bytes = rewrite(input, &changes, &dropped)?;
        // Verify the result before a single byte reaches the caller.
        let after = verify_clean(&bytes, categories)?;
        if !after.is_empty() {
            return Err(PrivacyError::Unverified);
        }
        if bytes.len() as u64 > context.max_output_bytes {
            return Err(PrivacyError::TooLarge);
        }
        output.write_all(&bytes).map_err(|_| PrivacyError::Failed)?;
        Ok(PrivacyCleanSummary {
            removed_category_counts: removed.into_counts(),
            retained_category_counts: Vec::new(),
            coverage: crate::types::Coverage::Complete,
            output_bytes: bytes.len() as u64,
        })
    }
}

/// Remove one element when its category was selected; report how many.
fn remove_if_selected(
    xml: &mut String,
    element: &str,
    selected: bool,
) -> Result<Option<u32>, PrivacyError> {
    if !selected {
        return Ok(None);
    }
    let count = count_elements(xml, element)? as u32;
    if count == 0 {
        return Ok(None);
    }
    *xml = remove_elements(xml, element)?;
    Ok(Some(count))
}

fn push_text_field(
    fields: &mut Vec<PrivacyField>,
    field_id: &str,
    element: &str,
    xml: &str,
    category: MetadataCategory,
    container: MetadataContainer,
    content_affecting: bool,
) {
    let Some(text) = element_text(xml, element) else {
        return;
    };
    let preview: String = text.chars().take(MAX_PREVIEW).collect();
    fields.push(PrivacyField {
        category,
        containers: vec![container],
        related_categories: Vec::new(),
        field_id: field_id.to_string(),
        label_key: label_key(category).to_string(),
        preview,
        count: 1,
        content_affecting,
        coverage: crate::types::Coverage::Complete,
    });
}

fn field(
    category: MetadataCategory,
    field_id: &str,
    container: MetadataContainer,
    count: u32,
    content_affecting: bool,
    preview: &str,
) -> PrivacyField {
    PrivacyField {
        category,
        containers: vec![container],
        related_categories: Vec::new(),
        field_id: field_id.to_string(),
        label_key: label_key(category).to_string(),
        preview: preview.to_string(),
        count,
        content_affecting,
        coverage: crate::types::Coverage::Complete,
    }
}

/// The translated label key of one category (08c's fixed table).
fn label_key(category: MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Author => "privacy.author",
        MetadataCategory::LastModifiedBy => "privacy.lastModifiedBy",
        MetadataCategory::Company => "privacy.company",
        MetadataCategory::Comments => "privacy.comments",
        MetadataCategory::TrackedChanges => "privacy.trackedChanges",
        MetadataCategory::HiddenText => "privacy.hiddenText",
        MetadataCategory::SpeakerNotes => "privacy.speakerNotes",
        MetadataCategory::Timestamps => "privacy.timestamps",
        _ => "privacy.scope",
    }
}

/// Re-inspect the produced bytes: no selected category may remain.
fn verify_clean(
    bytes: &[u8],
    categories: &[MetadataCategory],
) -> Result<Vec<MetadataCategory>, PrivacyError> {
    let mut cursor = std::io::Cursor::new(bytes);
    let parts: Vec<Part> = crate::office_rewrite::read_parts(&mut cursor)?;
    let mut remaining: Vec<MetadataCategory> = Vec::new();
    for part in &parts {
        let lowered = part.name.to_ascii_lowercase();
        let xml = String::from_utf8_lossy(&part.bytes).into_owned();
        if categories.contains(&MetadataCategory::Comments)
            && lowered.contains("comments")
            && lowered.ends_with(".xml")
        {
            remaining.push(MetadataCategory::Comments);
        }
        if categories.contains(&MetadataCategory::SpeakerNotes)
            && lowered.starts_with("ppt/notesslides/")
        {
            remaining.push(MetadataCategory::SpeakerNotes);
        }
        if categories.contains(&MetadataCategory::TrackedChanges)
            && lowered.ends_with("word/document.xml")
            && (xml.contains("<w:ins") || xml.contains("<w:del"))
        {
            remaining.push(MetadataCategory::TrackedChanges);
        }
        if categories.contains(&MetadataCategory::Author)
            && element_text(&xml, "dc:creator").is_some()
        {
            remaining.push(MetadataCategory::Author);
        }
        if categories.contains(&MetadataCategory::LastModifiedBy)
            && element_text(&xml, "cp:lastModifiedBy").is_some()
        {
            remaining.push(MetadataCategory::LastModifiedBy);
        }
        if categories.contains(&MetadataCategory::Company)
            && element_text(&xml, "Company").is_some()
        {
            remaining.push(MetadataCategory::Company);
        }
        if categories.contains(&MetadataCategory::Timestamps)
            && (element_text(&xml, "dcterms:created").is_some()
                || element_text(&xml, "dcterms:modified").is_some())
        {
            remaining.push(MetadataCategory::Timestamps);
        }
    }
    remaining.sort_by_key(|category| *category as u8);
    remaining.dedup();
    Ok(remaining)
}

fn check_cancelled(context: &PrivacyContext) -> Result<(), PrivacyError> {
    if context.cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(PrivacyError::Cancelled);
    }
    Ok(())
}

/// Removed counts per category, in a stable order.
#[derive(Default)]
struct MetadataCounts(Vec<(MetadataCategory, u32)>);

impl MetadataCounts {
    fn add(&mut self, category: MetadataCategory, count: u32) {
        if count == 0 {
            return;
        }
        match self
            .0
            .iter_mut()
            .find(|(existing, _)| *existing == category)
        {
            Some((_, total)) => *total = total.saturating_add(count),
            None => self.0.push((category, count)),
        }
    }

    fn into_counts(self) -> Vec<crate::types::MetadataCount> {
        self.0
            .into_iter()
            .map(|(category, count)| crate::types::MetadataCount {
                category,
                count,
                coverage: crate::types::Coverage::Complete,
            })
            .collect()
    }
}
