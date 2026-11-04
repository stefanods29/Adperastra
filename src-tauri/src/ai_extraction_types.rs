//! Canonical extraction and inline DTOs (Step 17d T1, `ai-extraction-1`).
//!
//! The TypeScript mirror is `src/services/aiExtractionTypes.ts`. Imported
//! types are never redefined: `AiInputRef` comes from 14c and
//! `PdfSourceIdentity` from 07d. Every struct refuses unknown fields so a
//! model-supplied or script-supplied key can never pass validation.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::local_ai_types::AiInputRef;
use crate::pdf_types::PdfSourceIdentity;

pub const EXTRACTION_SNAPSHOT_MIME: &str = "application/vnd.adperastra.extraction+json";
pub const EXTRACTION_SNAPSHOT_SCHEMA: u32 = 1;
pub const MAX_EXTRACTION_INPUTS: usize = 100;
pub const MAX_EXTRACTION_PAGES: u32 = 200;
pub const MAX_EXTRACTION_INPUT_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_EXTRACTION_BATCH_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_OCR_WORDS_PER_PAGE: usize = 20_000;
pub const MAX_TABLE_CELLS: usize = 100_000;
pub const MAX_EXTRACTION_SCALARS: usize = 10_000_000;
pub const MAX_REVIEW_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_REVIEW_PAGE_BYTES: usize = 768 * 1024;
pub const MAX_MODEL_PAYLOAD_BYTES: usize = 256 * 1024;
pub const PREPARED_TTL_SECONDS: u64 = 300;
pub const REVIEW_TTL_SECONDS: u64 = 1800;
pub const UNCERTAIN_BELOW: f64 = 0.85;
pub const OCR_UNKNOWN_CERTAINTY: f64 = 0.5;
pub const MAX_FIELD_ANCHORS: usize = 8;
pub const MAX_ANCHOR_WORDS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionKind {
    Document,
    Tables,
    Receipts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtractionLocale {
    En,
    Es,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtractionOutputFormat {
    Docx,
    Md,
    Txt,
    Xlsx,
    Csv,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ExtractionRect {
    /// Finite normalized 0..1 with a positive area (D2).
    pub fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width > 0.0
            && self.height > 0.0
            && self.x + self.width <= 1.0
            && self.y + self.height <= 1.0
    }
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionSource {
    pub id: Uuid,
    pub input: AiInputRef,
    pub identity: PdfSourceIdentity,
    pub display_name: String,
    pub page_count: u32,
    pub sensitive: bool,
}

impl ExtractionSource {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && !self.display_name.is_empty()
            && self.display_name.chars().count() <= 255
            && (1..=MAX_EXTRACTION_PAGES).contains(&self.page_count)
    }
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionAnchor {
    pub source_id: Uuid,
    pub page: u32,
    pub word_ids: Vec<u32>,
    pub rect: ExtractionRect,
    pub quote: String,
}

impl ExtractionAnchor {
    pub fn is_valid(&self) -> bool {
        !self.source_id.is_nil()
            && (1..=MAX_EXTRACTION_PAGES).contains(&self.page)
            && !self.word_ids.is_empty()
            && self.word_ids.len() <= MAX_ANCHOR_WORDS
            && self.rect.is_valid()
            && self.quote.chars().count() <= 512
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionValueStatus {
    Certain,
    Uncertain,
    Missing,
    Inconsistent,
    Corrected,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionValue {
    /// Stable identity a typed field correction names (D4).
    pub id: Uuid,
    pub original: String,
    pub value: String,
    pub confidence: f64,
    pub status: ExtractionValueStatus,
    pub anchors: Vec<ExtractionAnchor>,
    pub correction_revision: u64,
}

impl ExtractionValue {
    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && self.original.chars().count() <= 16_384
            && self.value.chars().count() <= 16_384
            && self.confidence.is_finite()
            && (0.0..=1.0).contains(&self.confidence)
            && self.anchors.len() <= MAX_FIELD_ANCHORS
            && self.anchors.iter().all(ExtractionAnchor::is_valid)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionBlockKind {
    Heading,
    Paragraph,
    List,
    Table,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionBlock {
    pub id: Uuid,
    pub kind: ExtractionBlockKind,
    pub order: u32,
    pub heading_level: Option<u8>,
    pub text: Option<ExtractionValue>,
    pub list_items: Vec<ExtractionValue>,
    pub table_id: Option<Uuid>,
}

impl ExtractionBlock {
    /// Exactly the matching variant fields are present (D3).
    pub fn is_valid(&self) -> bool {
        if self.id.is_nil() {
            return false;
        }
        match self.kind {
            ExtractionBlockKind::Heading => {
                self.heading_level.is_some_and(|level| (1..=6).contains(&level))
                    && self.text.as_ref().is_some_and(ExtractionValue::is_valid)
                    && self.list_items.is_empty()
                    && self.table_id.is_none()
            }
            ExtractionBlockKind::Paragraph => {
                self.heading_level.is_none()
                    && self.text.as_ref().is_some_and(ExtractionValue::is_valid)
                    && self.list_items.is_empty()
                    && self.table_id.is_none()
            }
            ExtractionBlockKind::List => {
                self.heading_level.is_none()
                    && self.text.is_none()
                    && !self.list_items.is_empty()
                    && self.list_items.len() <= 1000
                    && self.list_items.iter().all(ExtractionValue::is_valid)
                    && self.table_id.is_none()
            }
            ExtractionBlockKind::Table => {
                self.heading_level.is_none()
                    && self.text.is_none()
                    && self.list_items.is_empty()
                    && self.table_id.is_some_and(|id| !id.is_nil())
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtractionColumnType {
    Text,
    Number,
    Date,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionColumn {
    pub id: Uuid,
    pub name: ExtractionValue,
    #[serde(rename = "type")]
    pub column_type: ExtractionColumnType,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionRow {
    pub id: Uuid,
    pub cells: Vec<ExtractionValue>,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionTable {
    pub id: Uuid,
    pub source_ids: Vec<Uuid>,
    pub columns: Vec<ExtractionColumn>,
    pub rows: Vec<ExtractionRow>,
    pub header: bool,
}

impl ExtractionTable {
    /// Rectangular rows, bounded counts (D1).
    pub fn cell_count(&self) -> usize {
        self.rows.iter().map(|row| row.cells.len()).sum()
    }

    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && !self.source_ids.is_empty()
            && self.source_ids.len() <= 100
            && (1..=100).contains(&self.columns.len())
            && self.rows.len() <= 10_000
            && self.cell_count() <= MAX_TABLE_CELLS
            && self
                .rows
                .iter()
                .all(|row| !row.id.is_nil() && row.cells.len() == self.columns.len())
            && self.columns.iter().all(|column| {
                !column.id.is_nil() && column.name.is_valid()
            })
            && self.rows.iter().flat_map(|row| &row.cells).all(ExtractionValue::is_valid)
    }
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptRecord {
    pub id: Uuid,
    pub source_id: Uuid,
    pub vendor: ExtractionValue,
    pub tax_id: ExtractionValue,
    pub date: ExtractionValue,
    pub currency: ExtractionValue,
    pub subtotal: ExtractionValue,
    pub tax: ExtractionValue,
    pub total: ExtractionValue,
    pub line_items: ExtractionTable,
    pub date_iso: Option<String>,
    pub currency_code: Option<String>,
    pub subtotal_minor: Option<i64>,
    pub tax_minor: Option<i64>,
    pub total_minor: Option<i64>,
    pub arithmetic_ok: Option<bool>,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractionReview {
    pub id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub sources: Vec<ExtractionSource>,
    pub blocks: Vec<ExtractionBlock>,
    pub tables: Vec<ExtractionTable>,
    pub receipts: Vec<ReceiptRecord>,
    pub complete: bool,
    pub warnings: Vec<String>,
    pub next_cursor: Option<Uuid>,
    pub expires_unix: u64,
    pub sensitive: bool,
}

impl ExtractionReview {
    pub fn total_cells(&self) -> usize {
        self.tables.iter().map(ExtractionTable::cell_count).sum()
    }

    pub fn is_valid(&self) -> bool {
        !self.id.is_nil()
            && self.revision >= 1
            && !self.content_id.is_nil()
            && !self.sources.is_empty()
            && self.sources.len() <= 100
            && self.blocks.len() <= 10_000
            && self.tables.len() <= 100
            && self.receipts.len() <= 100
            && self.warnings.len() <= 32
            && self.total_cells() <= MAX_TABLE_CELLS
            && self.sources.iter().all(ExtractionSource::is_valid)
            && self.blocks.iter().all(ExtractionBlock::is_valid)
            && self.tables.iter().all(ExtractionTable::is_valid)
            && self.receipts.iter().all(|receipt| {
                !receipt.id.is_nil()
                    && !receipt.source_id.is_nil()
                    && receipt.line_items.is_valid()
            })
    }
}



