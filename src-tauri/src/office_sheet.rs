//! Bounded spreadsheet structural parsing (Step 13 T2).
//!
//! Calamine runs only inside the native `--office-sheet-helper` process. It
//! reads saved cell values and saved formula text; it never evaluates a
//! formula, runs a macro, resolves an external workbook or follows a DDE
//! link. The parent receives at most 500 rows, 200 columns and 768 KiB per
//! answer; a wide sheet asks for the visible column window instead of every
//! column from A to the used end.
//!
//! This module is native because calamine is a Rust parser. The helper's
//! process limits (256 MiB, 5 s) belong to the coordinator's helper wiring.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::helper::{HelperLine, HelperProcess};

use crate::office_view_types::{
    OfficeCell, OfficeCellPage, OfficeCellValueKind, OfficeSection, OfficeSectionKind,
    OFFICE_MAX_CELL_COLUMNS, OFFICE_MAX_CELL_PAGE_CELLS, OFFICE_MAX_CELL_ROWS,
    OFFICE_MAX_CELL_START, OFFICE_MAX_CELL_TEXT, OFFICE_MAX_SHEET_COLUMNS, OFFICE_MAX_SHEET_ROWS,
};

/// This executable's static child flag: one bounded request line on stdin,
/// one bounded answer line on stdout, then exit.
pub const HELPER_FLAG: &str = "--office-sheet-helper";

/// The largest serialized cell answer (768 KiB).
pub const SHEET_MAX_ANSWER_BYTES: usize = 768 * 1024;
/// The hard row cap for one answer.
pub const SHEET_MAX_ROWS: usize = OFFICE_MAX_CELL_ROWS;
/// The hard column-window cap for one answer.
pub const SHEET_MAX_COLUMNS: usize = OFFICE_MAX_CELL_COLUMNS;
/// Legacy spreadsheets deliberately use the no-quick-preview fallback.
pub const LEGACY_SHEET_FORMATS: &[&str] = &["xls"];

/// Read one bounded window of a worksheet. `sheet_index` is zero-based; the
/// helper only calls this with a section index it received from the parent.
/// `column_start`/`column_count` address the visible column window; every
/// returned cell still carries its absolute row and column.
pub fn read_sheet_page(
    path: &Path,
    sheet_index: u32,
    row_start: u32,
    row_count: u32,
    column_start: u32,
    column_count: u32,
) -> Result<OfficeCellPage, String> {
    if !path.is_absolute() {
        return Err("office.bad_request".to_string());
    }
    if row_count == 0 || row_count > SHEET_MAX_ROWS as u32 {
        return Err("office.bad_request".to_string());
    }
    if row_start > OFFICE_MAX_CELL_START {
        return Err("office.bad_request".to_string());
    }
    if column_start > OFFICE_MAX_SHEET_COLUMNS
        || column_count == 0
        || column_count > SHEET_MAX_COLUMNS as u32
    {
        return Err("office.bad_request".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|_| "office.unsupported".to_string())?;
    let names = workbook.sheet_names().to_vec();
    let name = names
        .get(sheet_index as usize)
        .cloned()
        .ok_or_else(|| "office.not_found".to_string())?;
    let range = workbook
        .worksheet_range(&name)
        .map_err(|_| "office.unsupported".to_string())?;
    let (end_row, end_column) = range
        .end()
        .map(|(row, column)| (row + 1, column + 1))
        .unwrap_or((0, 0));
    if end_row > OFFICE_MAX_SHEET_ROWS || end_column > OFFICE_MAX_SHEET_COLUMNS {
        return Err("office.too_large".to_string());
    }
    let total_rows = end_row;
    let columns = end_column;
    // A request past the used range returns an empty, valid window instead of
    // a fake start address; the absolute address always stays stable.
    let window_start = column_start.min(columns);
    let window_end = (window_start + column_count).min(columns);
    let window_columns = window_end - window_start;
    if row_start >= total_rows || window_columns == 0 {
        return Ok(OfficeCellPage {
            section_id: format!("sheet:{sheet_index}"),
            row_start,
            column_start: window_start,
            rows: Vec::new(),
            total_rows,
            columns,
            column_count: window_columns,
            truncated: false,
            next_cursor: None,
        });
    }
    let wanted = row_count.min(total_rows - row_start) as usize;
    let formulas = workbook
        .worksheet_formula(&name)
        .ok()
        .map(|range| formula_map(&range))
        .unwrap_or_default();
    let mut rows = Vec::new();
    let mut bytes = 0usize;
    let mut cells_built = 0usize;
    let mut truncated = false;
    let mut next_cell: Option<(u32, u32)> = None;
    for row in 0..wanted {
        let absolute_row = row_start + row as u32;
        let mut cells = Vec::new();
        for column in window_start..window_end {
            if cells_built >= OFFICE_MAX_CELL_PAGE_CELLS {
                truncated = true;
                next_cell = Some((absolute_row, column));
                break;
            }
            let cell = range.get_value((absolute_row, column));
            let formula = formulas.get(&(absolute_row, column)).map(String::as_str);
            let mut value = cell_from_saved(cell, formula);
            // The grid uses these to key cells and fill ARIA row/column
            // indexes; `cell_from_saved` stays position-free for its unit test.
            value.row = absolute_row;
            value.column = column;
            let formula_bytes = value.formula.as_ref().map_or(0, String::len);
            let next_bytes = bytes.saturating_add(value.text.len() + formula_bytes + 80);
            if next_bytes > SHEET_MAX_ANSWER_BYTES {
                truncated = true;
                next_cell = Some((absolute_row, column));
                break;
            }
            bytes = next_bytes;
            cells_built += 1;
            cells.push(value);
        }
        if cells.is_empty() && truncated {
            break;
        }
        rows.push(cells);
        if truncated {
            break;
        }
    }
    let page = OfficeCellPage {
        section_id: format!("sheet:{sheet_index}"),
        row_start,
        column_start: window_start,
        rows,
        total_rows,
        columns,
        column_count: window_columns,
        truncated,
        next_cursor: next_cell.map(|(row, column)| format!("{row}:{column}")),
    };
    if !page.is_valid() {
        return Err("office.too_large".to_string());
    }
    Ok(page)
}

/// Build one cell from a saved value and saved formula text. There is no
/// evaluator here: `cached` is always true and the formula remains exactly
/// the text the source stored.
pub fn cell_from_saved(value: Option<&Data>, formula: Option<&str>) -> OfficeCell {
    let (text, mut kind) = match value {
        None | Some(Data::Empty) => (String::new(), OfficeCellValueKind::Text),
        Some(Data::String(text)) => (text.clone(), OfficeCellValueKind::Text),
        Some(Data::Float(number)) => (number.to_string(), OfficeCellValueKind::Number),
        Some(Data::Int(number)) => (number.to_string(), OfficeCellValueKind::Number),
        Some(Data::Bool(value)) => (value.to_string(), OfficeCellValueKind::Boolean),
        Some(Data::DateTime(date)) => (date.as_f64().to_string(), OfficeCellValueKind::Date),
        Some(Data::DateTimeIso(text)) => (text.clone(), OfficeCellValueKind::Date),
        Some(Data::DurationIso(text)) => (text.clone(), OfficeCellValueKind::Text),
        Some(Data::Error(error)) => (format!("#ERROR({error:?})"), OfficeCellValueKind::Error),
    };
    if formula.is_some() {
        kind = OfficeCellValueKind::Formula;
    }
    OfficeCell {
        row: 0,
        column: 0,
        text: truncate_utf16(&text, OFFICE_MAX_CELL_TEXT),
        value_kind: kind,
        formula: formula.map(|value| value.chars().take(8_192).collect()),
        cached: true,
    }
}

fn formula_map(range: &calamine::Range<String>) -> HashMap<(u32, u32), String> {
    let mut map = HashMap::new();
    let start = range.start().unwrap_or((0, 0));
    for (row_offset, row) in range.rows().enumerate() {
        for (column_offset, formula) in row.iter().enumerate() {
            let text = formula.trim();
            if text.is_empty() {
                continue;
            }
            let mut value = text.to_string();
            if !value.starts_with('=') {
                value.insert(0, '=');
            }
            map.insert(
                (
                    start.0 + row_offset as u32,
                    start.1 + column_offset as u32,
                ),
                value,
            );
        }
    }
    map
}

/// Section descriptors are source worksheet names, never translated by the
/// backend. Bounds are taken from calamine's range when available.
pub fn sheet_sections(path: &Path) -> Result<Vec<OfficeSection>, String> {
    if !path.is_absolute() {
        return Err("office.bad_request".to_string());
    }
    let mut workbook = open_workbook_auto(path).map_err(|_| "office.unsupported".to_string())?;
    let names = workbook.sheet_names().to_vec();
    if names.is_empty() || names.len() > 1_000 {
        return Err("office.too_large".to_string());
    }
    let mut sections = Vec::with_capacity(names.len());
    for (index, name) in names.iter().enumerate() {
        let range = workbook.worksheet_range(name).ok();
        let (rows, columns) = range
            .as_ref()
            .and_then(|range| range.end().map(|(row, column)| (row + 1, column + 1)))
            .unwrap_or((0, 0));
        sections.push(OfficeSection {
            id: format!("sheet:{index}"),
            name: name.chars().take(255).collect(),
            kind: OfficeSectionKind::Sheet,
            index: index as u32,
            page_count: 1,
            rows: Some(rows),
            columns: Some(columns),
        });
    }
    Ok(sections)
}

/// A worksheet with a very large used range is still paged; the visible grid
/// never lays out all rows at once.
pub fn bounded_row_count(total_rows: u32, requested: u32) -> u32 {
    requested.min(SHEET_MAX_ROWS as u32).min(total_rows)
}

fn truncate_utf16(value: &str, limit: usize) -> String {
    if value.encode_utf16().count() <= limit {
        return value.to_string();
    }
    let mut out = String::new();
    for character in value.chars() {
        if out.encode_utf16().count() + character.len_utf16() > limit {
            break;
        }
        out.push(character);
    }
    out
}

/// One bounded helper answer; the coordinator serializes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetHelperReply {
    pub page: OfficeCellPage,
    pub total_sheets: u32,
    pub legacy_fallback: bool,
}

/// The one request the `--office-sheet-helper` child receives on stdin. The
/// path is a native-authorized private copy; it is not a command-line value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetHelperRequest {
    pub path: String,
    pub sheet_index: u32,
    pub row_start: u32,
    pub row_count: u32,
    pub column_start: u32,
    pub column_count: u32,
}

/// Parent-side call: one bounded helper process per answer. Calamine never
/// runs in the app process for a user document.
pub fn read_sheet_page_via_helper(
    path: &Path,
    sheet_index: u32,
    row_start: u32,
    row_count: u32,
    column_start: u32,
    column_count: u32,
) -> Result<OfficeCellPage, String> {
    let request = SheetHelperRequest {
        path: path
            .to_str()
            .ok_or_else(|| "office.bad_request".to_string())?
            .to_string(),
        sheet_index,
        row_start,
        row_count,
        column_start,
        column_count,
    };
    let text = serde_json::to_string(&request).map_err(|_| "office.bad_request".to_string())?;
    let mut helper = HelperProcess::spawn(HELPER_FLAG, 256 * 1024 * 1024)?;
    helper.send_line(&text)?;
    match helper.recv(Duration::from_secs(5)) {
        Some(HelperLine::Line(line)) => {
            let reply: SheetHelperReply =
                serde_json::from_str(&line).map_err(|_| "office.unsupported".to_string())?;
            Ok(reply.page)
        }
        Some(HelperLine::TooLong) => Err("office.too_large".to_string()),
        Some(HelperLine::Closed) | None => Err("office.engine_failed".to_string()),
    }
}

/// Child entry. It reads exactly one bounded request line and answers once.
pub fn run_sheet_helper() -> Result<(), String> {
    use std::io::{BufRead, Read};
    let mut line = String::new();
    let mut reader = std::io::BufReader::new(std::io::stdin().take(64 * 1024));
    reader
        .read_line(&mut line)
        .map_err(|_| "office.bad_request".to_string())?;
    let request: SheetHelperRequest =
        serde_json::from_str(line.trim()).map_err(|_| "office.bad_request".to_string())?;
    if request.path.encode_utf16().count() > 32_768 {
        return Err("office.bad_request".to_string());
    }
    let path = std::path::Path::new(&request.path);
    if !path.is_absolute() {
        return Err("office.bad_request".to_string());
    }
    let page = read_sheet_page(
        path,
        request.sheet_index,
        request.row_start,
        request.row_count,
        request.column_start,
        request.column_count,
    )?;
    let reply = SheetHelperReply {
        page,
        total_sheets: 0,
        legacy_fallback: legacy_sheet_fallback(
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        ),
    };
    println!(
        "{}",
        serde_json::to_string(&reply).map_err(|_| "office.unsupported".to_string())?
    );
    Ok(())
}

/// Returns true for a legacy binary format that must not use the quick
/// parser in this round.
pub fn legacy_sheet_fallback(extension: &str) -> bool {
    LEGACY_SHEET_FORMATS
        .iter()
        .any(|value| value.eq_ignore_ascii_case(extension))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_not_executed() {
        let cell = cell_from_saved(None, Some("=1+1"));
        assert_eq!(cell.value_kind, OfficeCellValueKind::Formula);
        assert_eq!(cell.formula.as_deref(), Some("=1+1"));
        assert_eq!(cell.text, "");
        assert!(cell.cached);
    }

    #[test]
    fn empty_cell_is_text_and_cached() {
        let cell = cell_from_saved(None, None);
        assert_eq!(cell.value_kind, OfficeCellValueKind::Text);
        assert!(cell.text.is_empty());
        assert!(cell.cached);
    }

    #[test]
    fn long_cell_text_is_truncated_to_utf16_limit() {
        let text = "x".repeat(OFFICE_MAX_CELL_TEXT + 10);
        let cell = cell_from_saved(None, Some("=LEN(A1)"));
        assert_eq!(cell.text.len(), 0);
        let cell = OfficeCell {
            row: 0,
            column: 0,
            text: truncate_utf16(&text, OFFICE_MAX_CELL_TEXT),
            value_kind: OfficeCellValueKind::Text,
            formula: None,
            cached: true,
        };
        assert_eq!(cell.text.encode_utf16().count(), OFFICE_MAX_CELL_TEXT);
    }

    #[test]
    fn requested_rows_never_exceed_page_cap() {
        assert_eq!(bounded_row_count(100_000, 10_000), 500);
        assert_eq!(bounded_row_count(3, 500), 3);
    }

    #[test]
    fn legacy_xls_uses_fallback() {
        assert!(legacy_sheet_fallback("xls"));
        assert!(!legacy_sheet_fallback("xlsx"));
    }
}
