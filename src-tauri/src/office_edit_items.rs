//! Native mirrors of Office item, formatting, lookup and statistics contracts
//! (Step 20a E6/E7/E12/E13/E14/E17, office-edit-1).
//!
//! These records are presentation data only. They cannot authorize a mutation,
//! expose engine HTML/scripts or replace native session validation.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::office_edit_presentation::DeckTheme;
use crate::office_edit_types::OfficeSessionState;
use crate::office_edit_values::{
    CellAddress, CellBorders, CellFormatPatch, CellHorizontal, CellInput, CellRange, CellVertical,
    OfficeChart, OfficeColor, OfficeFont, OfficeValue, TextFormatPatch, TextPosition, TextSpan,
};

pub const MAX_ITEM_PAGE: usize = 256;
pub const MAX_COMMENT_REPLIES: usize = 1_000;
pub const MAX_AI_DISPLAY_CELLS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeStyle {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub text: TextFormatPatch,
    pub paragraph: crate::office_edit_values::ParagraphFormatPatch,
}

impl OfficeStyle {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && !self.name.is_empty()
            && self.name.chars().count() <= 60
            && self.parent_id.is_none_or(|parent| !parent.is_nil() && parent != self.id)
            && (self.text.is_empty() || self.text.is_valid())
            && (self.paragraph.is_empty() || self.paragraph.is_valid())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeHeadingItem {
    pub id: Uuid,
    pub title: String,
    pub level: u8,
    pub page: u32,
    pub position: TextPosition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeChangeItem {
    pub id: Uuid,
    pub author: String,
    pub kind: OfficeChangeKind,
    pub excerpt: String,
    pub span: TextSpan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeChangeKind {
    Insert,
    Delete,
    Format,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeSheetItem {
    pub id: Uuid,
    pub name: String,
    pub index: u32,
    pub hidden: bool,
    pub color: Option<OfficeColor>,
    pub rows: u32,
    pub columns: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeSlideItem {
    pub id: Uuid,
    pub index: u32,
    pub layout_id: Uuid,
    pub hidden: bool,
    pub title: String,
    pub notes_preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficePivot {
    pub id: Uuid,
    pub source: CellRange,
    pub target: CellAddress,
    pub rows: Vec<u32>,
    pub columns: Vec<u32>,
    pub values: Vec<OfficePivotValue>,
    pub filters: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficePivotValue {
    pub column: u32,
    pub aggregate: OfficePivotAggregate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficePivotAggregate {
    Sum,
    Count,
    Average,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeCommentReply {
    pub id: Uuid,
    pub author: String,
    pub text: String,
    pub created_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeEditComment {
    pub id: Uuid,
    pub author: String,
    pub text: String,
    pub created_unix: u64,
    pub resolved: bool,
    pub anchor: crate::office_edit_values::OfficeSelection,
    pub replies: Vec<OfficeCommentReply>,
}

impl OfficeEditComment {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && self.author.chars().count() <= 128
            && self.text.chars().count() <= 16_384
            && self.created_unix <= crate::office_edit_values::MAX_SAFE_INTEGER
            && self.replies.len() <= MAX_COMMENT_REPLIES
            && self.replies.iter().all(|reply| {
                !reply.id.is_nil()
                    && reply.author.chars().count() <= 128
                    && reply.text.chars().count() <= 16_384
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeItemKind {
    Headings,
    Styles,
    Comments,
    Changes,
    Sheets,
    Slides,
    Masters,
    Charts,
    Pivots,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeItemPage {
    Headings {
        items: Vec<OfficeHeadingItem>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Styles {
        items: Vec<OfficeStyle>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Comments {
        items: Vec<OfficeEditComment>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Changes {
        items: Vec<OfficeChangeItem>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Sheets {
        items: Vec<OfficeSheetItem>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Slides {
        items: Vec<OfficeSlideItem>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Masters {
        items: Vec<DeckTheme>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Charts {
        items: Vec<OfficeChart>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
    Pivots {
        items: Vec<OfficePivot>,
        next_cursor: Option<Uuid>,
        complete: bool,
        revision: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextFormatting {
    pub font: OfficeValue<OfficeFont>,
    pub size_pt: OfficeValue<f64>,
    pub bold: OfficeValue<bool>,
    pub italic: OfficeValue<bool>,
    pub strike: OfficeValue<bool>,
    pub underline: OfficeValue<crate::office_edit_values::TextUnderline>,
    pub script: OfficeValue<crate::office_edit_values::TextScript>,
    pub foreground: OfficeValue<OfficeColor>,
    pub highlight: OfficeValue<Option<OfficeColor>>,
    pub language: OfficeValue<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParagraphFormatting {
    pub align: OfficeValue<crate::office_edit_values::ParagraphAlign>,
    pub direction: OfficeValue<crate::office_edit_values::ParagraphDirection>,
    pub indent_left_pt: OfficeValue<f64>,
    pub indent_right_pt: OfficeValue<f64>,
    pub first_line_pt: OfficeValue<f64>,
    pub line_spacing: OfficeValue<f64>,
    pub before_pt: OfficeValue<f64>,
    pub after_pt: OfficeValue<f64>,
    pub list: OfficeValue<crate::office_edit_values::ParagraphList>,
    pub outline_level: OfficeValue<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellFormatting {
    pub text: OfficeValue<TextFormatPatch>,
    pub horizontal: OfficeValue<CellHorizontal>,
    pub vertical: OfficeValue<CellVertical>,
    pub wrap: OfficeValue<bool>,
    pub rotation: OfficeValue<i16>,
    pub number_format: OfficeValue<String>,
    pub fill: OfficeValue<Option<OfficeColor>>,
    pub borders: OfficeValue<CellBorders>,
    pub locked: OfficeValue<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFormatting {
    pub selection: crate::office_edit_values::OfficeSelection,
    pub text: TextFormatting,
    pub paragraph: ParagraphFormatting,
    pub cell: CellFormatting,
    pub style_ids: Vec<Uuid>,
    pub sheet_ids: Vec<Uuid>,
    pub slide_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFindRequest {
    pub query: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub scope: OfficeFindScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeFindScope {
    Document,
    Selection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFindMatch {
    pub id: Uuid,
    pub selection: crate::office_edit_values::OfficeSelection,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeSpellingIssue {
    pub id: Uuid,
    pub span: TextSpan,
    pub word: String,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentStatistics {
    pub revision: u64,
    pub page: u32,
    pub page_count: u32,
    pub words: u64,
    pub characters: u64,
    pub language: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OfficeFormulaLocale {
    #[serde(rename = "en-US")]
    EnUs,
    #[serde(rename = "es-419")]
    Es419,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParsedOfficeFormula {
    pub canonical: String,
    pub functions: Vec<String>,
    pub valid: bool,
    pub error_offset_utf16: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFunctionArgument {
    pub name_key: String,
    pub kind: OfficeFunctionArgumentKind,
    pub optional: bool,
    pub repeated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeFunctionArgumentKind {
    Number,
    Text,
    Boolean,
    Range,
    AnyScalar,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFunction {
    pub id: String,
    pub display_name: String,
    pub arguments: Vec<OfficeFunctionArgument>,
    pub min_args: u8,
    pub max_args: u8,
    pub description_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeDisplayCell {
    pub address: CellAddress,
    pub display: String,
    pub input: CellInput,
    pub format: CellFormatPatch,
    pub error_code: Option<String>,
    pub merged_range: Option<CellRange>,
    pub editable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeCellWindow {
    pub revision: u64,
    pub range: CellRange,
    pub rows: Vec<Vec<OfficeDisplayCell>>,
    pub next_row: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetPrintRepeatRows {
    pub first: u32,
    pub last: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetPrintSettings {
    pub ranges: Vec<CellRange>,
    pub page_size: OfficePageSize,
    pub landscape: bool,
    pub margins_mm: crate::office_edit_values::PageMargins,
    pub fit_width_pages: Option<u16>,
    pub fit_height_pages: Option<u16>,
    pub repeat_header_rows: Option<SheetPrintRepeatRows>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficePageSize {
    A4,
    Letter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeDiscardSavedResult {
    pub state: OfficeSessionState,
    pub changed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_display_cell_bounds_are_fixed() {
        let cell = OfficeDisplayCell {
            address: CellAddress {
                sheet_id: Uuid::new_v4(),
                row: 1_048_575,
                column: 16_383,
            },
            display: String::new(),
            input: CellInput::Blank {},
            format: CellFormatPatch {
                wrap: Some(true),
                text: None,
                horizontal: None,
                vertical: None,
                rotation: None,
                number_format: None,
                fill: None,
                borders: None,
                locked: None,
            },
            error_code: None,
            merged_range: None,
            editable: true,
        };
        assert!(cell.address.is_valid());
        assert!(cell.format.is_valid());
    }
}
