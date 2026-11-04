//! Reading CSV and XLSX for conversion (Step 08b D5, D6).
//!
//! CSV uses the canonical Step 06f `decode_text`/`parse_table`; no second
//! decoder or delimiter guesser exists here. XLSX uses calamine 0.37's
//! reader API on bounded in-memory bytes, never a user path and never a
//! macro/external-link execution path.
//!
//! Every cell keeps its identity: account numbers such as `000123` stay
//! text, and a formula cell stays distinguishable from a text cell that
//! merely starts with `=`.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::Ordering;

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use data_views::decode_text;
use fs_service::CancellationToken;

use crate::error::ConvertError;

/// The workbook limits from D5.
pub const MAX_SHEETS: usize = 100;
pub const MAX_ROWS: usize = 1_048_576;
pub const MAX_COLUMNS: usize = 16_384;
pub const MAX_CELLS: usize = 5_000_000;
pub const MAX_CELL_UTF16: usize = 32_767;

/// One cell after reading.
#[derive(Debug, Clone, PartialEq)]
pub enum CellValue {
    Text(String),
    Number(f64),
    Bool(bool),
    /// A date/time already formatted as ISO text by the reader.
    DateIso(String),
    /// The formula's text plus the cached value when the file has one.
    Formula {
        text: String,
        cached: Option<Box<CellValue>>,
    },
    Empty,
}

/// One worksheet.
#[derive(Debug, Clone, PartialEq)]
pub struct SheetData {
    pub name: String,
    pub rows: Vec<Vec<CellValue>>,
}

/// One workbook after reading.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookData {
    pub sheets: Vec<SheetData>,
    /// How many worksheets the workbook has, before any selection.
    pub total_sheets: usize,
    /// Cells read across every selected worksheet (D5 cap is 5,000,000).
    pub total_cells: usize,
    /// At least one formula had no cached value; `formula_cached_value` must
    /// be acknowledged before writing a CSV.
    pub cached_missing: bool,
    pub formula_cells: usize,
}

impl WorkbookData {
    pub fn sheet_names(&self) -> Vec<&str> {
        self.sheets
            .iter()
            .map(|sheet| sheet.name.as_str())
            .collect()
    }
}

/// Read a CSV/TSV buffer. `delimiter` is one byte (`b','`, `b'\t'`, `b';'`).
pub fn read_csv(
    bytes: &[u8],
    delimiter: u8,
    token: &CancellationToken,
) -> Result<SheetData, ConvertError> {
    if bytes.is_empty() {
        return Err(ConvertError::BadRequest);
    }
    let (text, _encoding) = decode_text(bytes);
    let table =
        data_views::table::parse_table(&text, delimiter, token).map_err(|error| match error {
            data_views::DataError::Cancelled => ConvertError::Cancelled,
            data_views::DataError::TooLarge => ConvertError::TooLarge,
            _ => ConvertError::BadRequest,
        })?;
    if table.truncated() {
        return Err(ConvertError::TooLarge);
    }
    if table.rows() > MAX_ROWS || table.columns() > MAX_COLUMNS {
        return Err(ConvertError::TooLarge);
    }
    let mut rows = Vec::with_capacity(table.rows());
    let mut cells = 0usize;
    for row in 0..table.rows() {
        if row % 4_096 == 0 && token.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        let mut values = Vec::with_capacity(table.row_len(row));
        for column in 0..table.row_len(row) {
            let text = table.cell(row, column).to_string();
            check_cell_text(&text)?;
            values.push(CellValue::Text(text));
            cells += 1;
            if cells > MAX_CELLS {
                return Err(ConvertError::TooLarge);
            }
        }
        rows.push(values);
    }
    Ok(SheetData {
        name: String::new(),
        rows,
    })
}

/// Read an XLSX workbook from bounded bytes. When `sheet` is `Some`, only
/// that worksheet is returned; the caller must then acknowledge
/// `sheet_selection` if the workbook has more than one sheet.
pub fn read_xlsx(
    bytes: &[u8],
    sheet: Option<&str>,
    token: &CancellationToken,
) -> Result<WorkbookData, ConvertError> {
    if bytes.is_empty() {
        return Err(ConvertError::BadRequest);
    }
    let cursor = Cursor::new(bytes.to_vec());
    let mut workbook = open_workbook_auto_from_rs(cursor).map_err(|_| ConvertError::Unsupported)?;
    let names = workbook.sheet_names().to_vec();
    let total_sheets = names.len();
    if total_sheets > MAX_SHEETS {
        return Err(ConvertError::TooLarge);
    }
    let selected: Vec<String> = match sheet {
        Some(name) => {
            if !names.iter().any(|candidate| candidate == name) {
                return Err(ConvertError::BadRequest);
            }
            vec![name.to_string()]
        }
        None => names,
    };
    let mut sheets = Vec::with_capacity(selected.len());
    let mut cached_missing = false;
    let mut formula_cells = 0usize;
    let mut total_cells = 0usize;
    for name in selected {
        if token.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        let range = workbook
            .worksheet_range(&name)
            .map_err(|_| ConvertError::Unsupported)?;
        let formulas = workbook
            .worksheet_formula(&name)
            .map(|range| formula_map(&range))
            .unwrap_or_default();
        let start = range.start().unwrap_or((0, 0));
        if range.rows().count() > MAX_ROWS || range.width() > MAX_COLUMNS {
            return Err(ConvertError::TooLarge);
        }
        let mut rows = Vec::with_capacity(range.rows().count());
        let mut cells = 0usize;
        for (row_offset, row) in range.rows().enumerate() {
            if row_offset % 4_096 == 0 && token.load(Ordering::Relaxed) {
                return Err(ConvertError::Cancelled);
            }
            let mut values = Vec::with_capacity(row.len());
            for (column_offset, value) in row.iter().enumerate() {
                let abs = (start.0 + row_offset as u32, start.1 + column_offset as u32);
                if let Some(formula) = formulas.get(&abs) {
                    formula_cells += 1;
                    let cached = if matches!(value, Data::Empty) {
                        cached_missing = true;
                        None
                    } else {
                        Some(Box::new(cell_value(value)?))
                    };
                    values.push(CellValue::Formula {
                        text: formula.clone(),
                        cached,
                    });
                } else {
                    values.push(cell_value(value)?);
                }
                cells += 1;
                total_cells += 1;
                if cells > MAX_CELLS || total_cells > MAX_CELLS {
                    return Err(ConvertError::TooLarge);
                }
            }
            rows.push(values);
        }
        sheets.push(SheetData { name, rows });
    }
    Ok(WorkbookData {
        sheets,
        total_sheets,
        total_cells,
        cached_missing,
        formula_cells,
    })
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
                (start.0 + row_offset as u32, start.1 + column_offset as u32),
                value,
            );
        }
    }
    map
}

fn cell_value(value: &Data) -> Result<CellValue, ConvertError> {
    match value {
        Data::Empty => Ok(CellValue::Empty),
        Data::String(text) => {
            check_cell_text(text)?;
            Ok(CellValue::Text(text.clone()))
        }
        Data::Float(number) => Ok(CellValue::Number(*number)),
        Data::Int(number) => Ok(CellValue::Number(*number as f64)),
        Data::Bool(value) => Ok(CellValue::Bool(*value)),
        Data::DateTime(date) => Ok(CellValue::DateIso(excel_serial_to_iso(date.as_f64()))),
        Data::DateTimeIso(text) => {
            check_cell_text(text)?;
            Ok(CellValue::DateIso(text.clone()))
        }
        Data::DurationIso(text) => {
            check_cell_text(text)?;
            Ok(CellValue::Text(text.clone()))
        }
        Data::Error(error) => Ok(CellValue::Text(format!("#ERROR({error:?})"))),
    }
}

/// Excel's 1900 date system, including its leap-year bug. No time zone is
/// applied: the workbook's serial is a local wall-clock value.
fn excel_serial_to_iso(serial: f64) -> String {
    let days = serial.floor() as i64;
    let fraction = serial - serial.floor();
    let (year, month, day) = civil_from_days(days - 25_569);
    let total_seconds = (fraction * 86_400.0).round() as u32;
    let hour = total_seconds / 3_600;
    let minute = (total_seconds % 3_600) / 60;
    let second = total_seconds % 60;
    if total_seconds == 0 {
        format!("{year:04}-{month:02}-{day:02}")
    } else {
        format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
    }
}

/// Howard Hinnant's civil-from-days algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

fn check_cell_text(text: &str) -> Result<(), ConvertError> {
    if text.encode_utf16().count() > MAX_CELL_UTF16 {
        Err(ConvertError::TooLarge)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_text_000123_stays_text() {
        let token = fs_service::new_cancellation_token();
        let sheet = read_csv(b"id\n000123\n", b',', &token).unwrap();
        assert_eq!(sheet.rows[1][0], CellValue::Text("000123".to_string()));
    }

    #[test]
    fn csv_quoted_comma_and_newline_roundtrip() {
        let token = fs_service::new_cancellation_token();
        let sheet = read_csv(b"a,\"b,c\"\n\"line\nbreak\",d\n", b',', &token).unwrap();
        assert_eq!(sheet.rows[0][1], CellValue::Text("b,c".to_string()));
        assert_eq!(sheet.rows[1][0], CellValue::Text("line\nbreak".to_string()));
    }

    #[test]
    fn excel_serial_zero_and_known_date() {
        assert_eq!(excel_serial_to_iso(0.0), "1899-12-30");
        assert_eq!(excel_serial_to_iso(45_000.0), "2023-03-15");
    }
}
