//! Canonical engine-neutral Office values (Step 20a E1, office-edit-1).
//!
//! The TypeScript mirror is `src/office/officeValues.ts`. These are plain
//! data records: no engine command, process handle, file path or executable
//! payload is represented. Native validation remains authoritative, and a
//! value is never silently coerced from mixed or unavailable state.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// JavaScript's maximum safe integer. Every bound u64 is checked against it.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeValue<T> {
    Value { value: T },
    Mixed {},
    Unavailable { reason_key: String },
}

/// Four separate u8 channels. Document colors never reuse application tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeFontSource {
    Bundled,
    Installed,
    Document,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFont {
    pub family: String,
    pub source: OfficeFontSource,
    pub embeddable: bool,
}

impl OfficeFont {
    pub fn is_valid(&self) -> bool {
        !self.family.is_empty()
            && self.family.chars().count() <= 128
            && !self.family.chars().any(char::is_control)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextPosition {
    pub block_id: Uuid,
    pub offset_utf16: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextSpan {
    pub anchor: TextPosition,
    pub focus: TextPosition,
    /// Frozen wire field: the live source revision this span belongs to.
    pub revision: u64,
}

impl TextPosition {
    pub fn is_valid(&self) -> bool {
        !self.block_id.is_nil()
    }
}

impl TextSpan {
    pub fn is_valid(&self) -> bool {
        self.anchor.is_valid()
            && self.focus.is_valid()
            && self.revision >= 1
            && self.revision <= MAX_SAFE_INTEGER
    }

    /// A stale span is refused before a mutation is built.
    pub fn is_current(&self, revision: u64) -> bool {
        self.is_valid() && self.revision == revision
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextUnderline {
    None,
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextScript {
    Normal,
    Subscript,
    Superscript,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextFormat {
    pub font: OfficeFont,
    pub size_pt: f64,
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
    pub underline: TextUnderline,
    pub script: TextScript,
    pub foreground: OfficeColor,
    pub highlight: Option<OfficeColor>,
    pub language: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextFormatPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<OfficeFont>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<TextUnderline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<TextScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foreground: Option<OfficeColor>,
    /// Missing leaves unchanged; explicit null clears the highlight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Option<OfficeColor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

impl TextFormat {
    pub fn is_valid(&self) -> bool {
        self.font.is_valid()
            && self.size_pt.is_finite()
            && (1.0..=400.0).contains(&self.size_pt)
            && !self.language.is_empty()
            && self.language.chars().count() <= 64
    }
}

impl TextFormatPatch {
    pub fn is_empty(&self) -> bool {
        self.font.is_none()
            && self.size_pt.is_none()
            && self.bold.is_none()
            && self.italic.is_none()
            && self.strike.is_none()
            && self.underline.is_none()
            && self.script.is_none()
            && self.foreground.is_none()
            && self.highlight.is_none()
            && self.language.is_none()
    }

    pub fn is_valid(&self) -> bool {
        !self.is_empty()
            && self.font.as_ref().is_none_or(OfficeFont::is_valid)
            && self.size_pt.is_none_or(|size| size.is_finite() && (1.0..=400.0).contains(&size))
            && self
                .language
                .as_ref()
                .is_none_or(|language| !language.is_empty() && language.chars().count() <= 64)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParagraphAlign {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParagraphDirection {
    Ltr,
    Rtl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParagraphList {
    None,
    Disc,
    Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParagraphFormat {
    pub align: ParagraphAlign,
    pub direction: ParagraphDirection,
    pub indent_left_pt: f64,
    pub indent_right_pt: f64,
    pub first_line_pt: f64,
    pub line_spacing: f64,
    pub before_pt: f64,
    pub after_pt: f64,
    pub list: ParagraphList,
    pub outline_level: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParagraphFormatPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<ParagraphAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<ParagraphDirection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_left_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_right_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_line_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<ParagraphList>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level: Option<u8>,
}

impl ParagraphFormat {
    pub fn is_valid(&self) -> bool {
        self.indent_left_pt.is_finite()
            && (0.0..=720.0).contains(&self.indent_left_pt)
            && self.indent_right_pt.is_finite()
            && (0.0..=720.0).contains(&self.indent_right_pt)
            && self.first_line_pt.is_finite()
            && (-720.0..=720.0).contains(&self.first_line_pt)
            && self.line_spacing.is_finite()
            && (0.5..=5.0).contains(&self.line_spacing)
            && self.before_pt.is_finite()
            && (0.0..=200.0).contains(&self.before_pt)
            && self.after_pt.is_finite()
            && (0.0..=200.0).contains(&self.after_pt)
            && self.outline_level <= 6
    }
}

impl ParagraphFormatPatch {
    pub fn is_empty(&self) -> bool {
        self.align.is_none()
            && self.direction.is_none()
            && self.indent_left_pt.is_none()
            && self.indent_right_pt.is_none()
            && self.first_line_pt.is_none()
            && self.line_spacing.is_none()
            && self.before_pt.is_none()
            && self.after_pt.is_none()
            && self.list.is_none()
            && self.outline_level.is_none()
    }

    pub fn is_valid(&self) -> bool {
        !self.is_empty()
            && self.indent_left_pt.is_none_or(|v| v.is_finite() && (0.0..=720.0).contains(&v))
            && self.indent_right_pt.is_none_or(|v| v.is_finite() && (0.0..=720.0).contains(&v))
            && self.first_line_pt.is_none_or(|v| v.is_finite() && (-720.0..=720.0).contains(&v))
            && self.line_spacing.is_none_or(|v| v.is_finite() && (0.5..=5.0).contains(&v))
            && self.before_pt.is_none_or(|v| v.is_finite() && (0.0..=200.0).contains(&v))
            && self.after_pt.is_none_or(|v| v.is_finite() && (0.0..=200.0).contains(&v))
            && self.outline_level.is_none_or(|v| v <= 6)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageMargins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageLayout {
    pub width_pt: f64,
    pub height_pt: f64,
    pub margins: PageMargins,
    pub columns: u8,
    pub column_gap_pt: f64,
}

impl PageLayout {
    pub fn is_valid(&self) -> bool {
        if !self.width_pt.is_finite()
            || !self.height_pt.is_finite()
            || !(72.0..=14_400.0).contains(&self.width_pt)
            || !(72.0..=14_400.0).contains(&self.height_pt)
            || !(1..=6).contains(&self.columns)
            || !self.column_gap_pt.is_finite()
            || !(0.0..=144.0).contains(&self.column_gap_pt)
        {
            return false;
        }
        let m = self.margins;
        let finite = [m.top, m.right, m.bottom, m.left];
        finite.iter().all(|value| value.is_finite() && *value >= 0.0)
            && m.left + m.right < self.width_pt
            && m.top + m.bottom < self.height_pt
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellAddress {
    pub sheet_id: Uuid,
    pub row: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellRange {
    pub sheet_id: Uuid,
    pub first_row: u32,
    pub last_row: u32,
    pub first_column: u32,
    pub last_column: u32,
}

impl CellAddress {
    pub fn is_valid(&self) -> bool {
        !self.sheet_id.is_nil() && self.row <= 1_048_575 && self.column <= 16_383
    }
}

impl CellRange {
    pub fn is_valid(&self) -> bool {
        !self.sheet_id.is_nil()
            && self.first_row <= self.last_row
            && self.last_row <= 1_048_575
            && self.first_column <= self.last_column
            && self.last_column <= 16_383
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CellInput {
    Blank {},
    Text { text: String },
    Number { value: f64 },
    Boolean { value: bool },
    Formula { canonical: String },
    Date { iso_date: String },
}

impl CellInput {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Blank {} => true,
            Self::Text { text } => text.encode_utf16().count() <= 32_767,
            Self::Number { value } => value.is_finite(),
            Self::Boolean { .. } => true,
            Self::Formula { canonical } => {
                canonical.starts_with('=')
                    && canonical.chars().count() <= 8_192
                    && !canonical.chars().any(char::is_control)
            }
            Self::Date { iso_date } => {
                iso_date.len() == 10
                    && iso_date.as_bytes().get(4) == Some(&b'-')
                    && iso_date.as_bytes().get(7) == Some(&b'-')
                    && iso_date
                        .chars()
                        .enumerate()
                        .all(|(index, ch)| index == 4 || index == 7 || ch.is_ascii_digit())
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BorderStyle {
    None,
    Thin,
    Medium,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellBorder {
    pub style: BorderStyle,
    pub color: OfficeColor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellBorders {
    pub top: CellBorder,
    pub right: CellBorder,
    pub bottom: CellBorder,
    pub left: CellBorder,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellFormatPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextFormatPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<CellHorizontal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical: Option<CellVertical>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Missing leaves unchanged; explicit null clears the fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Option<OfficeColor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub borders: Option<CellBorders>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellHorizontal {
    Left,
    Center,
    Right,
    General,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellVertical {
    Top,
    Middle,
    Bottom,
}

impl CellFormatPatch {
    pub fn is_empty(&self) -> bool {
        self.text.is_none()
            && self.horizontal.is_none()
            && self.vertical.is_none()
            && self.wrap.is_none()
            && self.rotation.is_none()
            && self.number_format.is_none()
            && self.fill.is_none()
            && self.borders.is_none()
            && self.locked.is_none()
    }

    pub fn is_valid(&self) -> bool {
        !self.is_empty()
            && self.text.as_ref().is_none_or(TextFormatPatch::is_valid)
            && self.rotation.is_none_or(|rotation| (-90..=90).contains(&rotation))
            && self
                .number_format
                .as_ref()
                .is_none_or(|format| format.chars().count() <= 256)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeRect {
    pub x_pt: f64,
    pub y_pt: f64,
    pub width_pt: f64,
    pub height_pt: f64,
    pub rotation_deg: f64,
}

impl OfficeRect {
    pub fn is_valid(&self) -> bool {
        [self.x_pt, self.y_pt, self.width_pt, self.height_pt, self.rotation_deg]
            .iter()
            .all(|value| value.is_finite())
            && (-14_400.0..=14_400.0).contains(&self.x_pt)
            && (-14_400.0..=14_400.0).contains(&self.y_pt)
            && self.width_pt > 0.0
            && self.width_pt <= 28_800.0
            && self.height_pt > 0.0
            && self.height_pt <= 28_800.0
            && (-360.0..=360.0).contains(&self.rotation_deg)
    }

    /// Rotation is stored normalized to 0..359.999 degrees.
    pub fn normalized_rotation(&self) -> f64 {
        let mut rotation = self.rotation_deg % 360.0;
        if rotation < 0.0 {
            rotation += 360.0;
        }
        rotation
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeSelection {
    Document { span: TextSpan, page: u32 },
    Sheet { ranges: Vec<CellRange>, active: CellAddress },
    Deck {
        slide_ids: Vec<Uuid>,
        shape_ids: Vec<Uuid>,
        text_span: Option<TextSpan>,
    },
}

impl OfficeSelection {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Document { span, page } => span.is_valid() && *page >= 1,
            Self::Sheet { ranges, active } => {
                !ranges.is_empty()
                    && ranges.len() <= 32
                    && ranges.iter().all(CellRange::is_valid)
                    && active.is_valid()
                    && ranges.iter().all(|range| range.sheet_id == active.sheet_id)
            }
            Self::Deck {
                slide_ids,
                shape_ids,
                text_span,
            } => {
                !slide_ids.is_empty()
                    && slide_ids.len() <= 1_000
                    && slide_ids.iter().all(|id| !id.is_nil())
                    && shape_ids.len() <= 1_000
                    && shape_ids.iter().all(|id| !id.is_nil())
                    && text_span.as_ref().is_none_or(TextSpan::is_valid)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeViewport {
    pub x_px: f64,
    pub y_px: f64,
    pub width_px: u32,
    pub height_px: u32,
    pub zoom_percent: f64,
    pub device_scale: f64,
    pub view_revision: u32,
}

impl OfficeViewport {
    pub fn is_valid(&self) -> bool {
        self.x_px.is_finite()
            && self.x_px >= 0.0
            && self.y_px.is_finite()
            && self.y_px >= 0.0
            && (1..=16_384).contains(&self.width_px)
            && (1..=16_384).contains(&self.height_px)
            && self.zoom_percent.is_finite()
            && (10.0..=400.0).contains(&self.zoom_percent)
            && self.device_scale.is_finite()
            && (0.5..=4.0).contains(&self.device_scale)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeStoragePolicy {
    Ordinary,
    Sensitive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeBinaryLease {
    pub lease_id: Uuid,
    pub token: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub storage_policy: OfficeStoragePolicy,
}

impl OfficeBinaryLease {
    pub fn is_valid(&self) -> bool {
        !self.lease_id.is_nil()
            && !self.token.is_empty()
            && self.token.len() <= 128
            && !self.name.is_empty()
            && self.name.chars().count() <= 255
            && !self.mime.is_empty()
            && self.mime.len() <= 128
            && self.byte_len <= MAX_SAFE_INTEGER
            && self.width.is_none_or(|width| width <= 16_384)
            && self.height.is_none_or(|height| height <= 16_384)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeChartKind {
    Column,
    Bar,
    Line,
    Area,
    Pie,
    Scatter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeChartSeries {
    pub name: String,
    pub values: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeChartSource {
    Range { range: CellRange, headers: bool },
    Inline {
        categories: Vec<String>,
        series: Vec<OfficeChartSeries>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeChart {
    pub id: Uuid,
    pub kind: OfficeChartKind,
    pub source: OfficeChartSource,
    pub title: String,
    pub legend: bool,
    pub rect: OfficeRect,
}

impl OfficeChart {
    pub fn is_valid(&self) -> bool {
        if self.id.is_nil() || self.title.chars().count() > 512 || !self.rect.is_valid() {
            return false;
        }
        match &self.source {
            OfficeChartSource::Range { range, .. } => range.is_valid(),
            OfficeChartSource::Inline { categories, series } => {
                !series.is_empty()
                    && series.len() <= 32
                    && categories.len() <= 10_000
                    && series.iter().all(|entry| {
                        entry.name.chars().count() <= 128
                            && entry.values.len() == categories.len()
                            && entry.values.iter().all(|value| value.is_none_or(f64::is_finite))
                    })
            }
        }
    }
}

// Existing deck-style consumers import these from the canonical values module.
// The definitions live beside the other slide values in
// `office_edit_presentation.rs`; this re-export keeps one canonical path.
pub use crate::office_edit_presentation::DeckTheme;

#[cfg(test)]
mod tests {
    use super::*;

    fn color() -> OfficeColor {
        OfficeColor { r: 0, g: 0, b: 0, a: 255 }
    }

    #[test]
    fn nan_size_rejected() {
        let patch = TextFormatPatch {
            size_pt: Some(f64::NAN),
            ..default_text_patch()
        };
        assert!(!patch.is_valid());
    }

    #[test]
    fn stale_span_rejected() {
        let block = Uuid::new_v4();
        let span = TextSpan {
            anchor: TextPosition { block_id: block, offset_utf16: 0 },
            focus: TextPosition { block_id: block, offset_utf16: 1 },
            revision: 1,
        };
        assert!(span.is_current(1));
        assert!(!span.is_current(2));
    }

    #[test]
    fn color_wire_uses_four_named_channels() {
        let json = serde_json::to_value(color()).unwrap();
        assert_eq!(json, serde_json::json!({ "r": 0, "g": 0, "b": 0, "a": 255 }));
    }

    fn default_text_patch() -> TextFormatPatch {
        TextFormatPatch {
            font: None,
            size_pt: None,
            bold: None,
            italic: None,
            strike: None,
            underline: None,
            script: None,
            foreground: None,
            highlight: None,
            language: None,
        }
    }
}
