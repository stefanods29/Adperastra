//! Request and publish DTOs for Step 17d (`ai-extraction-1`).
//!
//! Split from `ai_extraction_types.rs` so both files stay under the
//! 400-line project limit. Validation lives in `ai_extraction_validation.rs`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ai_extraction_types::{ExtractionKind, ExtractionLocale, ExtractionOutputFormat};
use crate::local_ai_types::AiInputRef;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionRequest {
    pub inputs: Vec<AiInputRef>,
    pub kind: ExtractionKind,
    pub locale: ExtractionLocale,
    pub ocr_language: String,
    pub request_revision: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExtractionCorrection {
    Field {
        id: Uuid,
        expected: String,
        value: String,
    },
    TableCell {
        table_id: Uuid,
        row_id: Uuid,
        column_id: Uuid,
        expected: String,
        value: String,
    },
    SplitColumn {
        table_id: Uuid,
        column_id: Uuid,
        separator: String,
    },
    MergeColumns {
        table_id: Uuid,
        column_ids: Vec<Uuid>,
        separator: String,
    },
}

impl ExtractionCorrection {
    pub fn is_valid(&self) -> bool {
        match self {
            ExtractionCorrection::Field { id, expected, value } => {
                !id.is_nil()
                    && expected.chars().count() <= 16_384
                    && value.chars().count() <= 16_384
            }
            ExtractionCorrection::TableCell {
                table_id,
                row_id,
                column_id,
                expected,
                value,
            } => {
                !table_id.is_nil()
                    && !row_id.is_nil()
                    && !column_id.is_nil()
                    && expected.chars().count() <= 16_384
                    && value.chars().count() <= 16_384
            }
            ExtractionCorrection::SplitColumn {
                table_id,
                column_id,
                separator,
            } => {
                !table_id.is_nil()
                    && !column_id.is_nil()
                    && !separator.is_empty()
                    && separator.chars().count() <= 8
            }
            ExtractionCorrection::MergeColumns {
                table_id,
                column_ids,
                separator,
            } => {
                !table_id.is_nil()
                    && (2..=10).contains(&column_ids.len())
                    && column_ids.iter().all(|id| !id.is_nil())
                    && separator.chars().count() <= 8
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionPublish {
    pub review_id: Uuid,
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub format: ExtractionOutputFormat,
    pub table_id: Option<Uuid>,
    pub dest_dir: String,
    pub name: String,
    pub accepted_warning_codes: Vec<String>,
    pub include_source_labels: bool,
}

