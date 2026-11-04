//! Native mirror of office-ai-proposal-1 (Step 20a T6/T7). No model call,
//! clone, render or apply is implemented here; an approved binding resolves
//! these typed records. Chart diffs use `kind: "chart"` plus `chart_kind`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::export_snapshot_types::ExportSnapshot;
use crate::local_ai_types::AiInputRef;
use crate::office_edit_items::OfficeDisplayCell;
use crate::office_edit_types::{OfficeEditError, OfficeOperation, OfficeRenderPage};
use crate::office_edit_values::{
    CellAddress, CellInput, CellRange, OfficeChartKind, OfficeSelection, ParagraphFormat,
    TextFormat, TextSpan, MAX_SAFE_INTEGER,
};

pub const MAX_AI_TEXT_RUNS: usize = 256;
pub const MAX_AI_DISPLAY_CELLS: usize = 2_000;
pub const MAX_AI_SLIDES: usize = 30;
pub const MAX_AI_IMAGES: usize = 8;
pub const MAX_AI_CONTEXT_SCALARS: u32 = 24_000;
pub const MAX_AI_PROPOSAL_DIFFS: usize = 256;
pub const MAX_AI_PROPOSAL_CALCULATIONS: usize = 256;
pub const MAX_AI_PROPOSAL_RENDERS: usize = 4;
pub const MAX_AI_PROPOSAL_WARNINGS: usize = 32;
pub const MAX_AI_SOURCE_REFS: usize = 32;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiContextRequest {
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub selection: OfficeSelection,
    pub max_scalars: u32,
    pub include_images: bool,
    pub cursor: Option<Uuid>,
}

impl OfficeAiContextRequest {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        if self.expected_revision < 1
            || self.expected_revision > MAX_SAFE_INTEGER
            || self.expected_content_id.is_nil()
            || !self.selection.is_valid()
        {
            return Err(OfficeEditError::Invalid);
        }
        if !(1..=MAX_AI_CONTEXT_SCALARS).contains(&self.max_scalars) {
            return Err(OfficeEditError::ContextLimit);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiTextRun {
    pub id: Uuid,
    pub span: TextSpan,
    pub text: String,
    pub format: TextFormat,
    pub paragraph: ParagraphFormat,
    pub style_id: Option<Uuid>,
    pub semantic_role: OfficeAiSemanticRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeAiSemanticRole {
    Body,
    Heading,
    List,
    Caption,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiImage {
    pub id: Uuid,
    pub selection: OfficeSelection,
    pub snapshot: ExportSnapshot,
    pub alt: String,
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiSlideSummary {
    pub slide_id: Uuid,
    pub layout_id: Uuid,
    pub title: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeAiContext {
    pub context_id: Uuid,
    pub session_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub selection: OfficeSelection,
    pub family: crate::office_edit_types::OfficeFamily,
    pub text_runs: Vec<OfficeAiTextRun>,
    pub cells: Vec<OfficeDisplayCell>,
    pub slides: Vec<OfficeAiSlideSummary>,
    pub images: Vec<OfficeAiImage>,
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub truncated: bool,
    pub expires_unix: u64,
}

impl OfficeAiContext {
    pub fn is_valid(&self) -> bool {
        !self.context_id.is_nil()
            && !self.session_id.is_nil()
            && self.revision >= 1
            && self.revision <= MAX_SAFE_INTEGER
            && !self.content_id.is_nil()
            && self.selection.is_valid()
            && self.text_runs.len() <= MAX_AI_TEXT_RUNS
            && self.cells.len() <= MAX_AI_DISPLAY_CELLS
            && self.slides.len() <= MAX_AI_SLIDES
            && self.images.len() <= MAX_AI_IMAGES
            && self.images.iter().all(|image| {
                !image.id.is_nil()
                    && image.selection.is_valid()
                    && image.width_pt.is_finite()
                    && image.width_pt > 0.0
                    && image.height_pt.is_finite()
                    && image.height_pt > 0.0
            })
            && self.expires_unix > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeProposalIntent {
    DocumentRewrite,
    DocumentInsert,
    ImageAlt,
    SheetFormula,
    SheetClean,
    SheetChart,
    DeckCreate,
    DeckAdd,
    DeckShorten,
    DeckNotes,
    DeckLayout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeProposalRequest {
    pub context_id: Uuid,
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub intent: OfficeProposalIntent,
    pub operations: Vec<OfficeOperation>,
    pub label_key: String,
}

impl OfficeProposalRequest {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        if self.context_id.is_nil()
            || self.expected_revision < 1
            || self.expected_revision > MAX_SAFE_INTEGER
            || self.expected_content_id.is_nil()
            || self.operations.is_empty()
            || self.operations.len() > 1_000
            || self.label_key.is_empty()
            || self.label_key.len() > 128
        {
            return Err(OfficeEditError::Invalid);
        }
        let encoded = serde_json::to_vec(self).map_err(|_| OfficeEditError::Invalid)?;
        if encoded.len() > 768 * 1024 {
            return Err(OfficeEditError::TooLarge);
        }
        for operation in &self.operations {
            operation.validate(self.expected_revision)?;
        }
        Ok(())
    }
}

/// Resolved discriminant rule: the diff tag is always `kind`. A chart diff is
/// `kind: "chart"` plus the separate `chart_kind` field; no nested `kind` or
/// `chart` object is permitted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeProposalDiff {
    Text {
        span: TextSpan,
        before: String,
        after: String,
        format_preserved: bool,
        tracked: bool,
    },
    ImageAlt {
        image_id: Uuid,
        before: String,
        after: String,
    },
    Cell {
        address: CellAddress,
        before: CellInput,
        after: CellInput,
        before_display: String,
        after_display: String,
    },
    Slide {
        slide_id: Uuid,
        change: OfficeProposalSlideChange,
        before_summary: String,
        after_summary: String,
    },
    Chart {
        chart_id: Uuid,
        source: CellRange,
        /// Frozen separate field: column/bar/line/area/pie/scatter.
        chart_kind: OfficeChartKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeProposalSlideChange {
    Added,
    Text,
    Notes,
    Layout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeProposalCalculation {
    pub address: CellAddress,
    pub canonical: String,
    pub localized: String,
    pub result: CellInput,
    pub display: String,
    pub error_code: Option<OfficeProposalErrorCode>,
    pub deterministic: bool,
}

impl OfficeProposalCalculation {
    pub fn is_valid(&self) -> bool {
        !matches!(self.result, CellInput::Formula { .. })
            && self.address.is_valid()
            && !self.canonical.is_empty()
            && self.canonical.chars().count() <= 8_192
            && self.localized.chars().count() <= 8_192
            && self.display.encode_utf16().count() <= 32_767
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeProposalErrorCode {
    FormulaError,
    FunctionUnsupported,
    ExternalReference,
    VolatileFunction,
    CircularReference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeProposalWarning {
    Overflow {
        id: Uuid,
        message_key: String,
        object_id: Uuid,
    },
    FormattingLoss {
        id: Uuid,
        message_key: String,
        object_id: Uuid,
    },
    Unsupported {
        id: Uuid,
        message_key: String,
        feature_id: String,
    },
    TruncatedContext {
        id: Uuid,
        message_key: String,
    },
    FormulaError {
        id: Uuid,
        message_key: String,
        address: CellAddress,
        error_code: OfficeProposalErrorCode,
    },
    Stale {
        id: Uuid,
        message_key: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeProposalPreview {
    pub preview_id: Uuid,
    pub context_id: Uuid,
    pub session_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub intent: OfficeProposalIntent,
    pub diffs: Vec<OfficeProposalDiff>,
    pub calculations: Vec<OfficeProposalCalculation>,
    pub renders: Vec<OfficeRenderPage>,
    pub warnings: Vec<OfficeProposalWarning>,
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub can_apply: bool,
    pub expires_unix: u64,
}

impl OfficeProposalPreview {
    pub fn is_valid(&self) -> bool {
        !self.preview_id.is_nil()
            && !self.context_id.is_nil()
            && !self.session_id.is_nil()
            && self.revision >= 1
            && self.revision <= MAX_SAFE_INTEGER
            && !self.content_id.is_nil()
            && self.diffs.len() <= MAX_AI_PROPOSAL_DIFFS
            && self.calculations.len() <= MAX_AI_PROPOSAL_CALCULATIONS
            && self.renders.len() <= MAX_AI_PROPOSAL_RENDERS
            && self.warnings.len() <= MAX_AI_PROPOSAL_WARNINGS
            && self.calculations.iter().all(OfficeProposalCalculation::is_valid)
            && self.expires_unix > 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficeProposalApplyRequest {
    pub preview_id: Uuid,
    pub transaction_id: Uuid,
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub acknowledged_warning_ids: Vec<Uuid>,
    pub human_confirmation_id: Uuid,
}

impl OfficeProposalApplyRequest {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        if self.preview_id.is_nil()
            || self.transaction_id.is_nil()
            || self.expected_revision < 1
            || self.expected_revision > MAX_SAFE_INTEGER
            || self.expected_content_id.is_nil()
            || self.human_confirmation_id.is_nil()
            || self.acknowledged_warning_ids.len() > MAX_AI_PROPOSAL_WARNINGS
            || self
                .acknowledged_warning_ids
                .iter()
                .any(Uuid::is_nil)
        {
            return Err(OfficeEditError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfficeDraftSourceRef {
    OfficeContext { context_id: Uuid },
    AiInput { input: AiInputRef },
}

impl OfficeDraftSourceRef {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::OfficeContext { context_id } => !context_id.is_nil(),
            Self::AiInput { input } => !input.id.is_nil() && input.expected_revision >= 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chart_diff_tag_and_chart_kind_are_distinct() {
        let diff = OfficeProposalDiff::Chart {
            chart_id: Uuid::new_v4(),
            source: CellRange {
                sheet_id: Uuid::new_v4(),
                first_row: 0,
                last_row: 1,
                first_column: 0,
                last_column: 1,
            },
            chart_kind: OfficeChartKind::Column,
        };
        let json = serde_json::to_value(diff).unwrap();
        assert_eq!(json["kind"], "chart");
        assert_eq!(json["chart_kind"], "column");
        assert!(json.get("chart").is_none());
    }
}
