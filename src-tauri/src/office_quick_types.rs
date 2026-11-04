//! Bounded structural-preview records and the visible grid window.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

use crate::office_view_types::{OfficeFormat, OfficeSection, OfficeSectionKind, OFFICE_MAX_SECTIONS};

pub const QUICK_MAX_XML_ENTRIES: usize = 256;
pub const QUICK_MAX_XML_TOTAL: u64 = 128 * 1024 * 1024;
pub const QUICK_MAX_XML_BYTES: u64 = 16 * 1024 * 1024;
pub const QUICK_MAX_ZIP_ENTRIES: usize = 100_000;
pub const QUICK_MAX_VISIBLE_CELLS: usize = 200;
pub const QUICK_OVERSCAN: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickPart {
    Document,
    Styles,
    Comments,
    Notes,
    Relationships,
    Slide,
    Sheet,
    SharedStrings,
}

#[derive(Debug, Clone)]
pub struct QuickEntry {
    pub part: QuickPart,
    pub zip_name: String,
    pub mime: String,
    pub section_id: String,
    pub index: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct QuickPackage {
    pub format: OfficeFormat,
    pub sections: Vec<OfficeSection>,
    pub entries: Vec<QuickEntry>,
    pub total_xml_bytes: u64,
    pub fallback: bool,
    pub warnings: Vec<String>,
}

impl QuickPackage {
    pub fn is_valid(&self) -> bool {
        !self.sections.is_empty()
            && self.sections.len() <= OFFICE_MAX_SECTIONS
            && self.entries.len() <= QUICK_MAX_XML_ENTRIES
            && self.total_xml_bytes <= QUICK_MAX_XML_TOTAL
            && self.sections.iter().all(OfficeSection::is_valid)
    }

    pub fn legacy(format: OfficeFormat) -> Self {
        Self {
            format,
            sections: vec![OfficeSection {
                id: "document".to_string(),
                name: String::new(),
                kind: OfficeSectionKind::Document,
                index: 0,
                page_count: 1,
                rows: None,
                columns: None,
            }],
            entries: Vec::new(),
            total_xml_bytes: 0,
            fallback: true,
            warnings: vec!["office.no_preview".to_string()],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellWindow {
    pub row_start: u32,
    pub row_end: u32,
    pub column_start: u32,
    pub column_end: u32,
    pub overscan_rows: u32,
    pub overscan_columns: u32,
}

impl CellWindow {
    pub fn visible_cells(&self) -> usize {
        self.row_end
            .saturating_sub(self.row_start)
            .saturating_mul(self.column_end.saturating_sub(self.column_start)) as usize
    }
}

pub fn visible_cell_window(
    total_rows: u32,
    total_columns: u32,
    scroll_row: u32,
    visible_rows: u32,
    scroll_column: u32,
    visible_columns: u32,
    overscan: u32,
) -> CellWindow {
    let overscan = overscan.min(QUICK_OVERSCAN);
    let row_start = scroll_row.min(total_rows);
    let column_start = scroll_column.min(total_columns);
    let mut rows = visible_rows.min(total_rows.saturating_sub(row_start));
    let mut columns = visible_columns.min(total_columns.saturating_sub(column_start));
    if rows == 0 || columns == 0 {
        return CellWindow {
            row_start,
            row_end: row_start,
            column_start,
            column_end: column_start,
            overscan_rows: overscan,
            overscan_columns: overscan,
        };
    }
    if rows.saturating_mul(columns) as usize > QUICK_MAX_VISIBLE_CELLS {
        columns = (QUICK_MAX_VISIBLE_CELLS as u32 / rows).max(1);
        if rows.saturating_mul(columns) as usize > QUICK_MAX_VISIBLE_CELLS {
            rows = (QUICK_MAX_VISIBLE_CELLS as u32 / columns).max(1);
        }
    }
    CellWindow {
        row_start,
        row_end: (row_start + rows).min(total_rows),
        column_start,
        column_end: (column_start + columns).min(total_columns),
        overscan_rows: overscan,
        overscan_columns: overscan,
    }
}

pub fn format_name(format: OfficeFormat) -> String {
    serde_json::to_value(format)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub fn quick_fallback(format: OfficeFormat) -> bool {
    matches!(format_name(format).as_str(), "doc" | "xls" | "ppt" | "rtf")
}

pub fn quick_supported(format: OfficeFormat) -> bool {
    matches!(
        format_name(format).as_str(),
        "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp"
    )
}
