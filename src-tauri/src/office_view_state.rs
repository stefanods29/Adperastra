//! Saved Office tab state and bounded spreadsheet cells.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

use crate::office_view_limits::{
    utf16_len, OFFICE_MAX_CELL_COLUMNS, OFFICE_MAX_CELL_PAGE_CELLS, OFFICE_MAX_CELL_ROWS,
    OFFICE_MAX_CELL_START, OFFICE_MAX_CELL_TEXT, OFFICE_MAX_PAGES, OFFICE_MAX_SCROLL,
    OFFICE_MAX_SHEET_COLUMNS, OFFICE_MAX_ZOOM, OFFICE_MIN_ZOOM,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeViewState {
    pub section_id: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub scroll_top: f64,
    #[serde(default = "default_mode")]
    pub mode: OfficeViewMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeViewMode {
    Quick,
    Pages,
}

impl Default for OfficeViewState {
    fn default() -> Self {
        Self {
            section_id: String::new(),
            page: 1,
            zoom: 100.0,
            scroll_top: 0.0,
            mode: OfficeViewMode::Pages,
        }
    }
}

fn default_page() -> u32 {
    1
}

fn default_zoom() -> f64 {
    100.0
}

fn default_mode() -> OfficeViewMode {
    OfficeViewMode::Pages
}

impl OfficeViewState {
    pub fn normalized(mut self, section_id: &str, _section_count: u32) -> Self {
        if section_id.is_empty() || section_id.len() > 64 {
            self.section_id = "document".to_string();
        }
        if self.page == 0 {
            self.page = 1;
        }
        if !self.zoom.is_finite() {
            self.zoom = 100.0;
        }
        self.zoom = self.zoom.clamp(OFFICE_MIN_ZOOM, OFFICE_MAX_ZOOM);
        if !self.scroll_top.is_finite() {
            self.scroll_top = 0.0;
        }
        self.scroll_top = self.scroll_top.clamp(0.0, OFFICE_MAX_SCROLL);
        self
    }

    pub fn is_safe(&self) -> bool {
        !self.section_id.is_empty()
            && self.section_id.len() <= 64
            && self.page >= 1
            && self.page <= OFFICE_MAX_PAGES
            && self.zoom.is_finite()
            && (OFFICE_MIN_ZOOM..=OFFICE_MAX_ZOOM).contains(&self.zoom)
            && self.scroll_top.is_finite()
            && (0.0..=OFFICE_MAX_SCROLL).contains(&self.scroll_top)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeCellValueKind {
    Text,
    Number,
    Date,
    Boolean,
    Error,
    Formula,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeCell {
    pub row: u32,
    pub column: u32,
    pub text: String,
    pub value_kind: OfficeCellValueKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    pub cached: bool,
}

impl OfficeCell {
    pub fn is_valid(&self) -> bool {
        utf16_len(&self.text) <= OFFICE_MAX_CELL_TEXT
            && self.formula.as_ref().is_none_or(|formula| formula.len() <= 8_192)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeCellPage {
    pub section_id: String,
    /// Absolute zero-based row of the first returned row.
    pub row_start: u32,
    /// Absolute zero-based column of the first cell in every returned row.
    /// Cells keep their absolute `row`/`column`, so a client never has to
    /// translate addresses when only a window of columns is mounted.
    #[serde(default)]
    pub column_start: u32,
    pub rows: Vec<Vec<OfficeCell>>,
    pub total_rows: u32,
    /// Total used columns in the worksheet (the scrollable extent). The
    /// returned window is `column_start` + `column_count`, not this value.
    pub columns: u32,
    /// Width of the returned column window (0 only when `column_start` is at
    /// or past the used range).
    #[serde(default)]
    pub column_count: u32,
    pub truncated: bool,
    /// Continuation address `"<row>:<column>"` of the first cell the byte or
    /// cell cap withheld. It is session- and section-bound and is null when
    /// `truncated` is false; a complete window pages by explicit
    /// `row_start`/`column_start` instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

impl OfficeCellPage {
    pub fn is_valid(&self) -> bool {
        // A full 500-row answer is valid on its own: the grid pages by
        // explicit `row_start`, so a short page is not evidence of the end.
        // `truncated` only means the byte/cell cap stopped the answer early.
        let window_end = self.column_start as u64 + self.column_count as u64;
        let cells = self.rows.iter().map(|row| row.len()).sum::<usize>();
        !self.section_id.is_empty()
            && self.section_id.len() <= 64
            && self.row_start <= OFFICE_MAX_CELL_START
            && self.rows.len() <= OFFICE_MAX_CELL_ROWS
            && cells <= OFFICE_MAX_CELL_PAGE_CELLS
            && self.columns <= OFFICE_MAX_SHEET_COLUMNS
            && self.column_count as usize <= OFFICE_MAX_CELL_COLUMNS
            && self.column_start <= self.columns
            && window_end <= self.columns as u64
            && self.rows.iter().enumerate().all(|(row_index, row)| {
                row.len() <= self.column_count as usize
                    && row.iter().enumerate().all(|(column_index, cell)| {
                        cell.is_valid()
                            && cell.row == self.row_start.saturating_add(row_index as u32)
                            && cell.column == self.column_start.saturating_add(column_index as u32)
                    })
            })
            && match (&self.next_cursor, self.truncated) {
                (None, false) => true,
                (Some(cursor), true) => valid_cell_cursor(cursor),
                _ => false,
            }
    }
}

/// The opaque continuation address is only digits and a single colon; it is
/// never a path or a user string.
fn valid_cell_cursor(value: &str) -> bool {
    if value.is_empty() || value.len() > 32 {
        return false;
    }
    let Some((row, column)) = value.split_once(':') else {
        return false;
    };
    !row.is_empty()
        && !column.is_empty()
        && row.bytes().all(|byte| byte.is_ascii_digit())
        && column.bytes().all(|byte| byte.is_ascii_digit())
        && row.parse::<u32>().is_ok_and(|row| row <= OFFICE_MAX_CELL_START)
        && column
            .parse::<u32>()
            .is_ok_and(|column| column <= OFFICE_MAX_SHEET_COLUMNS)
}
