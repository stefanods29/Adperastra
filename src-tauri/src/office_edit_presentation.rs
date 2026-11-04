//! Native mirror of the presentation and template values (Step 20a E1/E15/E16).
//!
//! The TypeScript source of truth is `src/office/presentationTypes.ts`. All
//! geometry is in points and all display IDs are opaque native strings; no
//! window handle, engine command, HTML or external media reference appears.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::export_snapshot_types::ExportSnapshot;
use crate::office_edit_values::{
    OfficeChart, OfficeColor, OfficeFont, OfficeRect, ParagraphFormat, TextFormat,
};

pub const MAX_DECK_TEXT_SCALARS: usize = 1_048_576;
pub const MAX_DECK_SHAPES_PER_SLIDE: usize = 1_000;
pub const MAX_DECK_SLIDES: usize = 10_000;
pub const MAX_DECK_LAYOUTS: usize = 32;
pub const MAX_DECK_PLACEHOLDERS: usize = 16;
pub const MAX_DECK_TEXT_PARAGRAPHS: usize = 1_000;
pub const MAX_DECK_TABLE_CELLS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckTextRun {
    pub text: String,
    pub format: TextFormat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckTextParagraph {
    pub id: Uuid,
    pub runs: Vec<DeckTextRun>,
    pub paragraph: ParagraphFormat,
}

impl DeckTextParagraph {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && !self.runs.is_empty()
            && self.runs.len() <= MAX_DECK_TEXT_PARAGRAPHS
            && self.paragraph.is_valid()
            && self
                .runs
                .iter()
                .all(|run| run.format.is_valid() && run.text.encode_utf16().count() <= 16_384)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckShapeStroke {
    pub color: OfficeColor,
    pub width_pt: f64,
}

impl DeckShapeStroke {
    pub fn is_valid(&self) -> bool {
        self.width_pt.is_finite() && (0.0..=100.0).contains(&self.width_pt)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckGeometryKind {
    Rectangle,
    Ellipse,
    Line,
    Arrow,
    Triangle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeckShape {
    Text {
        id: Uuid,
        rect: OfficeRect,
        z: u32,
        alt: String,
        fill: Option<OfficeColor>,
        stroke: DeckShapeStroke,
        paragraphs: Vec<DeckTextParagraph>,
    },
    Image {
        id: Uuid,
        rect: OfficeRect,
        z: u32,
        alt: String,
        fill: Option<OfficeColor>,
        stroke: DeckShapeStroke,
        image: ExportSnapshot,
    },
    Geometry {
        id: Uuid,
        rect: OfficeRect,
        z: u32,
        alt: String,
        fill: Option<OfficeColor>,
        stroke: DeckShapeStroke,
        geometry: DeckGeometryKind,
    },
    Table {
        id: Uuid,
        rect: OfficeRect,
        z: u32,
        alt: String,
        fill: Option<OfficeColor>,
        stroke: DeckShapeStroke,
        cells: Vec<Vec<String>>,
    },
    Chart {
        id: Uuid,
        rect: OfficeRect,
        z: u32,
        alt: String,
        fill: Option<OfficeColor>,
        stroke: DeckShapeStroke,
        chart: OfficeChart,
    },
}

impl DeckShape {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Text { id, .. }
            | Self::Image { id, .. }
            | Self::Geometry { id, .. }
            | Self::Table { id, .. }
            | Self::Chart { id, .. } => *id,
        }
    }

    pub fn is_valid(&self) -> bool {
        let (id, rect, alt, stroke) = match self {
            Self::Text { id, rect, alt, stroke, .. }
            | Self::Image { id, rect, alt, stroke, .. }
            | Self::Geometry { id, rect, alt, stroke, .. }
            | Self::Table { id, rect, alt, stroke, .. }
            | Self::Chart { id, rect, alt, stroke, .. } => (id, rect, alt, stroke),
        };
        if id.is_nil() || !rect.is_valid() || alt.chars().count() > 4_096 || !stroke.is_valid() {
            return false;
        }
        match self {
            Self::Text { paragraphs, .. } => {
                !paragraphs.is_empty()
                    && paragraphs.len() <= MAX_DECK_TEXT_PARAGRAPHS
                    && paragraphs.iter().all(DeckTextParagraph::is_valid)
            }
            Self::Image { image, .. } => {
                !image.snapshot_id.is_empty() && image.byte_len <= 512 * 1024 * 1024
            }
            Self::Geometry { .. } => true,
            Self::Table { cells, .. } => {
                !cells.is_empty()
                    && cells.len() <= 100
                    && cells.iter().all(|row| row.len() <= 100)
                    && cells.iter().map(Vec::len).sum::<usize>() <= MAX_DECK_TABLE_CELLS
            }
            Self::Chart { chart, .. } => {
                matches!(&chart.source, crate::office_edit_values::OfficeChartSource::Inline { .. })
                    && chart.is_valid()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckShapePatch {
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rect: Option<OfficeRect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// Missing leaves unchanged; explicit null clears the fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Option<OfficeColor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<DeckShapeStroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragraphs: Option<Vec<DeckTextParagraph>>,
}

impl DeckShapePatch {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && self.rect.is_none_or(|rect| rect.is_valid())
            && self.alt.as_ref().is_none_or(|alt| alt.chars().count() <= 4_096)
            && self.stroke.as_ref().is_none_or(DeckShapeStroke::is_valid)
            && self
                .paragraphs
                .as_ref()
                .is_none_or(|paragraphs| paragraphs.iter().all(DeckTextParagraph::is_valid))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckPlaceholderRole {
    Title,
    Subtitle,
    Body,
    BodyLeft,
    BodyRight,
    Image,
    Caption,
    Chart,
    Quote,
    Footer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckPlaceholder {
    pub id: Uuid,
    pub role: DeckPlaceholderRole,
    pub rect: OfficeRect,
    pub text: TextFormat,
    pub paragraph: ParagraphFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckLayoutKind {
    Title,
    TitleBody,
    TwoColumn,
    Section,
    ImageCaption,
    Chart,
    Quote,
    Blank,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckLayout {
    pub id: Uuid,
    pub name: String,
    pub kind: DeckLayoutKind,
    pub placeholders: Vec<DeckPlaceholder>,
}

impl DeckLayout {
    pub fn is_valid(&self) -> bool {
        if self.id.is_nil()
            || self.name.chars().count() > 60
            || self.placeholders.len() > MAX_DECK_PLACEHOLDERS
        {
            return false;
        }
        if self.kind == DeckLayoutKind::Blank && !self.placeholders.is_empty() {
            return false;
        }
        self.placeholders.iter().all(|placeholder| {
            !placeholder.id.is_nil()
                && placeholder.rect.is_valid()
                && placeholder.text.is_valid()
                && placeholder.paragraph.is_valid()
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckThemeColors {
    pub background: OfficeColor,
    pub text: OfficeColor,
    pub muted: OfficeColor,
    pub accent: OfficeColor,
    pub accent2: OfficeColor,
    pub surface: OfficeColor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckDensity {
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckTheme {
    pub id: Uuid,
    pub name: String,
    pub slide_width_pt: f64,
    pub slide_height_pt: f64,
    pub colors: DeckThemeColors,
    pub heading_font: OfficeFont,
    pub body_font: OfficeFont,
    pub layouts: Vec<DeckLayout>,
    pub default_layout_id: Uuid,
    pub density: DeckDensity,
    pub version: u32,
}

impl DeckTheme {
    pub fn is_valid(&self) -> bool {
        self.version == 1
            && !self.id.is_nil()
            && self.name.chars().count() <= 60
            && self.slide_width_pt.is_finite()
            && self.slide_width_pt > 0.0
            && self.slide_width_pt <= 14_400.0
            && self.slide_height_pt.is_finite()
            && self.slide_height_pt > 0.0
            && self.slide_height_pt <= 14_400.0
            && self.heading_font.is_valid()
            && self.body_font.is_valid()
            && !self.layouts.is_empty()
            && self.layouts.len() <= MAX_DECK_LAYOUTS
            && self.layouts.iter().all(DeckLayout::is_valid)
            && self
                .layouts
                .iter()
                .filter(|layout| layout.id == self.default_layout_id)
                .count()
                == 1
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckTransitionKind {
    None,
    Fade,
    Push,
    Wipe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckTransition {
    pub kind: DeckTransitionKind,
    pub duration_ms: u32,
    pub advance_on_click: bool,
    pub advance_after_ms: Option<u32>,
}

impl DeckTransition {
    pub fn is_valid(&self) -> bool {
        self.duration_ms <= 10_000
            && self.advance_after_ms.is_none_or(|after| after <= 86_400_000)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckAnimationKind {
    Appear,
    Fade,
    Fly,
    Spin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckAnimationStart {
    OnClick,
    WithPrevious,
    AfterPrevious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeckAnimationDirection {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckAnimation {
    pub kind: DeckAnimationKind,
    pub start: DeckAnimationStart,
    pub duration_ms: u32,
    pub delay_ms: u32,
    pub direction: DeckAnimationDirection,
}

impl DeckAnimation {
    pub fn is_valid(&self) -> bool {
        (1..=10_000).contains(&self.duration_ms) && self.delay_ms <= 86_400_000
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationDisplayRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationDisplay {
    pub id: String,
    pub name: String,
    pub rect: PresentationDisplayRect,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationRequest {
    pub slide_id: Uuid,
    pub start_from: PresentationStart,
    pub output_display_id: String,
    pub presenter_display_id: Option<String>,
    pub show_presenter: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationStart {
    First,
    Current,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationState {
    pub presentation_id: Uuid,
    pub session_id: Uuid,
    pub slide_id: Uuid,
    pub slide_index: u32,
    pub slide_count: u32,
    pub step_index: u32,
    pub elapsed_ms: u64,
    pub paused: bool,
    pub black: bool,
    pub ended: bool,
    pub output_display_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PresentationIntent {
    Next {},
    Previous {},
    First {},
    Last {},
    End {},
    ToggleBlack {},
    TogglePause {},
    ResetTimer {},
    GoTo { slide_id: Uuid },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeFontMapping {
    pub from_family: String,
    pub to_font: OfficeFont,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckTemplateInspection {
    pub inspection_id: Uuid,
    pub themes: Vec<DeckTheme>,
    pub warnings: Vec<String>,
    pub source_revision: u64,
    pub expires_unix: u64,
}

impl DeckTemplateInspection {
    pub fn is_valid(&self) -> bool {
        !self.inspection_id.is_nil()
            && !self.themes.is_empty()
            && self.themes.len() <= MAX_DECK_LAYOUTS
            && self.warnings.len() <= 32
            && self.source_revision >= 1
            && self.expires_unix > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_is_not_replaced_with_none_on_read() {
        let transition = DeckTransition {
            kind: DeckTransitionKind::None,
            duration_ms: 0,
            advance_on_click: true,
            advance_after_ms: None,
        };
        assert!(transition.is_valid());
        let json = serde_json::to_value(transition).unwrap();
        assert_eq!(json["kind"], "none");
        assert_eq!(json["advance_on_click"], true);
    }
}
