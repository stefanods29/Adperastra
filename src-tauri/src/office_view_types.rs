//! Read-only Office view contracts (Step 13, `office-view-1`).
//!
//! These are the exact shapes of `src/services/officeViewTypes.ts`. The
//! canonical `OfficeFormat` lives in 12b's `engine_types.rs`; this module
//! re-exports it and never defines another copy. The viewer never exposes a
//! mutation method.
#![allow(dead_code)]

use cache_store::CacheLease;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::engine_types::OfficeFormat;
pub use crate::office_view_limits::*;
pub use crate::office_view_state::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeQuality {
    Quick,
    Accurate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeSectionKind {
    Document,
    Sheet,
    Slide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct OfficeCapabilities {
    pub comments: bool,
    pub presentation: bool,
    pub exact_render: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeSession {
    pub session_id: Uuid,
    pub format: OfficeFormat,
    pub source_revision: u64,
    pub engine_version: String,
    pub quality: OfficeQuality,
    pub section_count: u32,
    pub read_only: bool,
    pub capabilities: OfficeCapabilities,
}

impl OfficeSession {
    pub fn is_valid(&self) -> bool {
        !self.session_id.is_nil()
            && self.source_revision >= 1
            && self.source_revision < (1u64 << 53)
            && !self.engine_version.is_empty()
            && self.engine_version.len() <= 64
            && self.section_count >= 1
            && self.section_count as usize <= OFFICE_MAX_SECTIONS
            && self.read_only
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeSection {
    pub id: String,
    pub name: String,
    pub kind: OfficeSectionKind,
    pub index: u32,
    pub page_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u32>,
}

impl OfficeSection {
    pub fn is_valid(&self) -> bool {
        valid_section_id(&self.id, self.kind, self.index)
            && self.name.len() <= 255
            && self.page_count >= 1
            && self.page_count <= OFFICE_MAX_PAGES
            && (self.kind == OfficeSectionKind::Sheet
                || (self.rows.is_none() && self.columns.is_none()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeSectionPage {
    pub items: Vec<OfficeSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
}

impl OfficeSectionPage {
    pub fn is_valid(&self) -> bool {
        self.items.len() <= OFFICE_MAX_SECTION_PAGE
            && self.items.iter().all(OfficeSection::is_valid)
            && (self.complete || self.next_cursor.is_some())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficePage {
    pub section_id: String,
    pub page: u32,
    pub image: CacheLease,
    pub width_pt: f64,
    pub height_pt: f64,
    pub quality: OfficeQuality,
    pub source_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeLayoutText {
    pub runs: Vec<crate::pdf_types::PdfTextRun>,
    pub complete: bool,
}

impl OfficePage {
    pub fn is_valid(&self) -> bool {
        !self.section_id.is_empty()
            && self.section_id.len() <= 64
            && self.page >= 1
            && self.page <= OFFICE_MAX_PAGES
            && self.width_pt.is_finite()
            && self.height_pt.is_finite()
            && self.width_pt > 0.0
            && self.height_pt > 0.0
            && self.width_pt <= OFFICE_MAX_SIDE_PT
            && self.height_pt <= OFFICE_MAX_SIDE_PT
            && self.source_revision >= 1
            && self.source_revision < (1u64 << 53)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeCommentAnchor {
    pub kind: OfficeAnchorKind,
    pub index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeAnchorKind {
    Paragraph,
    Cell,
    Slide,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeComment {
    pub id: String,
    pub section_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    pub author: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub source_anchor: OfficeCommentAnchor,
}

impl OfficeComment {
    pub fn is_valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 128
            && !self.section_id.is_empty()
            && self.section_id.len() <= 64
            && self
                .page
                .is_none_or(|page| (1..=OFFICE_MAX_PAGES).contains(&page))
            && self.author.len() <= OFFICE_MAX_COMMENT_AUTHOR
            && self.text.len() <= OFFICE_MAX_COMMENT_TEXT
            && self
                .parent_id
                .as_ref()
                .is_none_or(|parent| !parent.is_empty() && parent.len() <= 128)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeCommentPage {
    pub items: Vec<OfficeComment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
}

impl OfficeCommentPage {
    pub fn is_valid(&self) -> bool {
        self.items.len() <= OFFICE_MAX_COMMENT_PAGE
            && self.items.iter().all(OfficeComment::is_valid)
            && (self.complete || self.next_cursor.is_some())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficeOutlineNode {
    pub id: String,
    pub title: String,
    pub section_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    pub depth: u8,
}

impl OfficeOutlineNode {
    pub fn is_valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 128
            && self.title.len() <= OFFICE_MAX_OUTLINE_TITLE
            && !self.section_id.is_empty()
            && self.section_id.len() <= 64
            && self
                .page
                .is_none_or(|page| (1..=OFFICE_MAX_PAGES).contains(&page))
            && self.depth <= OFFICE_MAX_OUTLINE_DEPTH
    }
}

/// Section IDs are ASCII and derived from a zero-based index, never from a
/// localized label.
pub fn valid_section_id(id: &str, kind: OfficeSectionKind, index: u32) -> bool {
    // 12b's canonical Writer section ID is the bare `document`; sheets and
    // slides carry their zero-based index.
    let expected = match kind {
        OfficeSectionKind::Document => "document".to_string(),
        OfficeSectionKind::Sheet => format!("sheet:{index}"),
        OfficeSectionKind::Slide => format!("slide:{index}"),
    };
    // Accept the pre-producer `document:0` spelling for saved tabs, while the
    // canonical 12b writer ID remains the bare `document`.
    let matches =
        id == expected || (kind == OfficeSectionKind::Document && index == 0 && id == "document:0");
    matches
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'\\')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_section_id_and_wrong_index() {
        let section = |id: &str, kind: OfficeSectionKind, index: u32| OfficeSection {
            id: id.to_string(),
            name: "Section".to_string(),
            kind,
            index,
            page_count: 1,
            rows: None,
            columns: None,
        };
        assert!(section("sheet:2", OfficeSectionKind::Sheet, 2).is_valid());
        assert!(!section("Hoja 3", OfficeSectionKind::Sheet, 2).is_valid());
        assert!(!section("sheet:3", OfficeSectionKind::Sheet, 2).is_valid());
    }

    #[test]
    fn page_request_refuses_zero_and_bad_scale() {
        assert_eq!(
            validate_page_request(0, 1.0),
            Err("office.bad_request".to_string())
        );
        assert_eq!(
            validate_page_request(1, 0.24),
            Err("office.bad_request".to_string())
        );
        assert_eq!(
            validate_page_request(1, 4.01),
            Err("office.bad_request".to_string())
        );
        assert!(validate_page_request(1, 1.0).is_ok());
    }
}
