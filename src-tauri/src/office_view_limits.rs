//! Bounds shared by the Office view DTOs, service and tests.
#![allow(dead_code)]


use uuid::Uuid;

pub const OFFICE_MAX_SESSIONS: usize = 8;
pub const OFFICE_IDLE_SECONDS: u64 = 10 * 60;
pub const OFFICE_MAX_SECTIONS: usize = 1_000;
pub const OFFICE_MAX_SECTION_PAGE: usize = 200;
pub const OFFICE_MAX_PAGES: u32 = 10_000;
pub const OFFICE_MAX_SIDE_PT: f64 = 14_400.0;
pub const OFFICE_MIN_SCALE: f64 = 0.25;
pub const OFFICE_MAX_SCALE: f64 = 4.0;
pub const OFFICE_MIN_ZOOM: f64 = 25.0;
pub const OFFICE_MAX_ZOOM: f64 = 400.0;
pub const OFFICE_MAX_SCROLL: f64 = 1_000_000_000.0;
pub const OFFICE_MAX_COMMENTS: usize = 10_000;
pub const OFFICE_MAX_COMMENT_PAGE: usize = 200;
pub const OFFICE_MAX_COMMENT_AUTHOR: usize = 255;
pub const OFFICE_MAX_COMMENT_TEXT: usize = 8_192;
pub const OFFICE_MAX_OUTLINE_NODES: usize = 10_000;
pub const OFFICE_MAX_OUTLINE_DEPTH: u8 = 32;
pub const OFFICE_MAX_OUTLINE_TITLE: usize = 512;
pub const OFFICE_MAX_CELL_ROWS: usize = 500;
/// One answer carries at most this many columns. A wide sheet asks for the
/// visible window instead of every column from A to the end.
pub const OFFICE_MAX_CELL_COLUMNS: usize = 200;
/// Hard bound on constructed cells in one answer (the byte cap can stop it
/// earlier). Keeps a 500 x 200 request from building 100k structs.
pub const OFFICE_MAX_CELL_PAGE_CELLS: usize = 25_000;
pub const OFFICE_MAX_CELL_TEXT: usize = 32_767;
pub const OFFICE_MAX_ANSWER_BYTES: usize = 768 * 1024;
/// Spreadsheet dimensions accepted by the sheet helper.
pub const OFFICE_MAX_SHEET_ROWS: u32 = 1_000_000;
pub const OFFICE_MAX_SHEET_COLUMNS: u32 = 16_384;
/// Absolute start bound for a cell request; larger values are refused before
/// any workbook is opened.
pub const OFFICE_MAX_CELL_START: u32 = 100_000_000;

pub fn validate_page_request(page: u32, scale: f64) -> Result<(), String> {
    if page == 0 || page > OFFICE_MAX_PAGES {
        return Err("office.bad_request".to_string());
    }
    if !scale.is_finite() || !(OFFICE_MIN_SCALE..=OFFICE_MAX_SCALE).contains(&scale) {
        return Err("office.bad_request".to_string());
    }
    Ok(())
}

/// `column_count` is the visible window width, never the whole used range.
pub fn validate_cell_request(
    row_start: u32,
    row_count: u32,
    column_start: u32,
    column_count: u32,
) -> Result<(), String> {
    if row_start > OFFICE_MAX_CELL_START {
        return Err("office.bad_request".to_string());
    }
    if row_count == 0 || row_count > OFFICE_MAX_CELL_ROWS as u32 {
        return Err("office.bad_request".to_string());
    }
    if column_start > OFFICE_MAX_SHEET_COLUMNS {
        return Err("office.bad_request".to_string());
    }
    if column_count == 0 || column_count > OFFICE_MAX_CELL_COLUMNS as u32 {
        return Err("office.bad_request".to_string());
    }
    Ok(())
}

pub fn parse_cursor(cursor: Option<&str>) -> Result<Option<Uuid>, String> {
    match cursor {
        None => Ok(None),
        Some(value) if value.is_empty() || value.len() > 36 => Err("office.bad_request".to_string()),
        Some(value) => Uuid::parse_str(value)
            .map(Some)
            .map_err(|_| "office.bad_request".to_string()),
    }
}

pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn safe_count(value: u64) -> Result<u64, String> {
    if value < (1u64 << 53) {
        Ok(value)
    } else {
        Err("office.too_large".to_string())
    }
}
