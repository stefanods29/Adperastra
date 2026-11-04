//! Typed document operations (Step 20a E1, office-edit-1).
//!
//! The TypeScript mirror is `src/office/documentOperations.ts`. Every variant
//! is one atomic intent; no arbitrary engine command, path or byte buffer is
//! accepted. Text is UTF-16 bounded and positions belong to one live revision.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::export_snapshot_types::ExportSnapshot;
use crate::office_edit_items::OfficeStyle;
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::{
    PageLayout, ParagraphFormatPatch, TextFormatPatch, TextPosition, TextSpan,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DocumentOperation {
    InsertText {
        position: TextPosition,
        text: String,
    },
    DeleteText {
        span: TextSpan,
    },
    FormatText {
        span: TextSpan,
        patch: TextFormatPatch,
    },
    FormatParagraph {
        block_ids: Vec<Uuid>,
        patch: ParagraphFormatPatch,
    },
    ApplyStyle {
        block_ids: Vec<Uuid>,
        style_id: Uuid,
    },
    UpsertStyle {
        style: OfficeStyle,
    },
    InsertBreak {
        position: TextPosition,
        break_kind: DocumentBreakKind,
    },
    SetPageLayout {
        section_id: Uuid,
        layout: PageLayout,
    },
    InsertTable {
        position: TextPosition,
        rows: u16,
        columns: u16,
    },
    SetTableCells {
        table_id: Uuid,
        first_row: u16,
        first_column: u16,
        values: Vec<Vec<String>>,
    },
    InsertImage {
        position: TextPosition,
        snapshot: ExportSnapshot,
        width_pt: f64,
        height_pt: f64,
        alt: String,
    },
    InsertLink {
        span: TextSpan,
        target: DocumentLinkTarget,
    },
    InsertField {
        position: TextPosition,
        field_kind: DocumentFieldKind,
    },
    RefreshField {
        field_id: Uuid,
    },
    AddFootnote {
        position: TextPosition,
        text: String,
    },
    AddCitation {
        position: TextPosition,
        citation: OfficeCitation,
    },
    SetBibliography {
        position: TextPosition,
        citation_ids: Vec<Uuid>,
    },
    CommentAdd {
        span: TextSpan,
        text: String,
        author: String,
    },
    CommentReply {
        comment_id: Uuid,
        text: String,
        author: String,
    },
    CommentResolve {
        comment_id: Uuid,
        resolved: bool,
    },
    CommentDelete {
        comment_id: Uuid,
    },
    SetTrackChanges {
        enabled: bool,
    },
    ReviewChange {
        change_id: Uuid,
        decision: OfficeReviewDecision,
    },
    ReplaceMatch {
        span: TextSpan,
        expected_text: String,
        replacement: String,
    },
    /// Additive office-ai-proposal-1 operation: metadata only.
    SetImageAlt {
        image_id: Uuid,
        expected_alt: String,
        alt: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentBreakKind {
    Page,
    Column,
    Line,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentFieldKind {
    PageNumber,
    PageCount,
    Date,
    TableOfContents,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeReviewDecision {
    Accept,
    Reject,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DocumentLinkTarget {
    Internal { bookmark_id: Uuid },
    Url { url: String, scheme: DocumentLinkScheme },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentLinkScheme {
    Https,
    Http,
    Mailto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeCitation {
    pub id: Uuid,
    pub author: String,
    pub title: String,
    pub year: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl DocumentOperation {
    pub fn validate(&self, current_revision: u64) -> Result<(), OfficeEditError> {
        match self {
            Self::InsertText { position, text } => {
                require_position(position)?;
                require_text(text, 1_048_576)?;
            }
            Self::DeleteText { span } => require_span(span, current_revision)?,
            Self::FormatText { span, patch } => {
                require_span(span, current_revision)?;
                if !patch.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::FormatParagraph { block_ids, patch } => {
                require_blocks(block_ids)?;
                if !patch.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::ApplyStyle { block_ids, style_id } => {
                require_blocks(block_ids)?;
                if style_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::UpsertStyle { style } => {
                if !style.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::InsertBreak { position, .. } => require_position(position)?,
            Self::SetPageLayout { section_id, layout } => {
                if section_id.is_nil() || !layout.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::InsertTable {
                position,
                rows,
                columns,
            } => {
                require_position(position)?;
                if !(1..=100).contains(rows) || !(1..=100).contains(columns) {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetTableCells {
                table_id,
                values,
                ..
            } => {
                if table_id.is_nil() || !rectangular(values, 100, 100) {
                    return Err(OfficeEditError::Invalid);
                }
                let scalars = values.iter().flatten().map(|text| text.chars().count()).sum::<usize>();
                if scalars > 1_048_576 {
                    return Err(OfficeEditError::TooLarge);
                }
            }
            Self::InsertImage {
                position,
                snapshot,
                width_pt,
                height_pt,
                alt,
            } => {
                require_position(position)?;
                if snapshot.snapshot_id.is_empty()
                    || snapshot.byte_len > 512 * 1024 * 1024
                    || !width_pt.is_finite()
                    || !height_pt.is_finite()
                    || *width_pt <= 0.0
                    || *width_pt > 14_400.0
                    || *height_pt <= 0.0
                    || *height_pt > 14_400.0
                    || alt.encode_utf16().count() > 4_096
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::InsertLink { span, target } => {
                require_span(span, current_revision)?;
                match target {
                    DocumentLinkTarget::Internal { bookmark_id } if bookmark_id.is_nil() => {
                        return Err(OfficeEditError::Invalid);
                    }
                    DocumentLinkTarget::Url { url, scheme } => {
                        if url.is_empty()
                            || url.chars().count() > 2_048
                            || url.chars().any(char::is_control)
                        {
                            return Err(OfficeEditError::Invalid);
                        }
                        let prefix = match scheme {
                            DocumentLinkScheme::Https => "https://",
                            DocumentLinkScheme::Http => "http://",
                            DocumentLinkScheme::Mailto => "mailto:",
                        };
                        if !url.starts_with(prefix) {
                            return Err(OfficeEditError::Invalid);
                        }
                    }
                    _ => {}
                }
            }
            Self::InsertField { position, .. } => require_position(position)?,
            Self::RefreshField { field_id } => {
                if field_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::AddFootnote { position, text } => {
                require_position(position)?;
                require_text(text, 16_384)?;
            }
            Self::AddCitation { position, citation } => {
                require_position(position)?;
                if citation.id.is_nil()
                    || citation.author.chars().count() > 512
                    || citation.title.chars().count() > 512
                    || citation.year.chars().count() > 512
                    || citation.url.as_ref().is_some_and(|url| {
                        url.chars().count() > 2_048 || url.chars().any(char::is_control)
                    })
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetBibliography {
                position,
                citation_ids,
            } => {
                require_position(position)?;
                if citation_ids.is_empty()
                    || citation_ids.len() > 1_000
                    || citation_ids.iter().any(Uuid::is_nil)
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::CommentAdd { span, text, author } => {
                require_span(span, current_revision)?;
                require_text(text, 16_384)?;
                require_author(author)?;
            }
            Self::CommentReply {
                comment_id,
                text,
                author,
            } => {
                if comment_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
                require_text(text, 16_384)?;
                require_author(author)?;
            }
            Self::CommentResolve { comment_id, .. } | Self::CommentDelete { comment_id } => {
                if comment_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetTrackChanges { .. } => {}
            Self::ReviewChange { change_id, .. } => {
                if change_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::ReplaceMatch {
                span,
                expected_text,
                replacement,
            } => {
                require_span(span, current_revision)?;
                require_text(expected_text, 16_384)?;
                require_text(replacement, 16_384)?;
            }
            Self::SetImageAlt {
                image_id,
                expected_alt,
                alt,
            } => {
                if image_id.is_nil()
                    || expected_alt.encode_utf16().count() > 4_096
                    || alt.encode_utf16().count() > 4_096
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
        }
        Ok(())
    }
}

fn require_position(position: &TextPosition) -> Result<(), OfficeEditError> {
    if position.is_valid() {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

fn require_span(span: &TextSpan, revision: u64) -> Result<(), OfficeEditError> {
    if span.is_current(revision) {
        Ok(())
    } else {
        Err(OfficeEditError::Changed)
    }
}

fn require_blocks(blocks: &[Uuid]) -> Result<(), OfficeEditError> {
    if !blocks.is_empty() && blocks.len() <= 1_000 && blocks.iter().all(|id| !id.is_nil()) {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

fn require_text(text: &str, max_utf16: usize) -> Result<(), OfficeEditError> {
    if !text.is_empty() && text.encode_utf16().count() <= max_utf16 {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

fn require_author(author: &str) -> Result<(), OfficeEditError> {
    if !author.is_empty() && author.chars().count() <= 128 && !author.chars().any(char::is_control)
    {
        Ok(())
    } else {
        Err(OfficeEditError::Invalid)
    }
}

fn rectangular(values: &[Vec<String>], max_rows: usize, max_columns: usize) -> bool {
    !values.is_empty()
        && values.len() <= max_rows
        && values[0].len() <= max_columns
        && values.iter().all(|row| row.len() == values[0].len())
        && values.iter().flatten().all(|cell| cell.chars().count() <= 32_767)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_span_rejected() {
        let block = Uuid::new_v4();
        let operation = DocumentOperation::DeleteText {
            span: TextSpan {
                anchor: TextPosition {
                    block_id: block,
                    offset_utf16: 0,
                },
                focus: TextPosition {
                    block_id: block,
                    offset_utf16: 1,
                },
                revision: 1,
            },
        };
        assert_eq!(
            operation.validate(2).unwrap_err(),
            OfficeEditError::Changed
        );
    }
}
