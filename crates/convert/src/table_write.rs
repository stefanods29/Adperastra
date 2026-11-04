//! XLSX writing for the CSV-to-XLSX adapter (Step 08b D5).
//!
//! Every CSV cell becomes a string cell, never a formula: a text value such
//! as `000123` keeps its zeros, and a text value such as `=1+1` is written
//! with `write_string`, so no formula engine executes it. A numeric negative
//! value remains a number. The header option changes styling only.

use rust_xlsxwriter::{Format, Workbook};

use crate::error::ConvertError;
use crate::naming::normalize_sheet_component;
use crate::table_read::{CellValue, SheetData, MAX_CELL_UTF16, MAX_COLUMNS, MAX_ROWS, MAX_SHEETS};

/// Excel's maximum worksheet-name length.
pub const MAX_SHEET_NAME_CHARS: usize = 31;

/// Write one workbook. Sheet names are made unique and valid for Excel.
pub fn write_xlsx(
    sheets: &[SheetData],
    header: bool,
    max_output_bytes: u64,
) -> Result<Vec<u8>, ConvertError> {
    if sheets.is_empty() || sheets.len() > MAX_SHEETS {
        return Err(ConvertError::TooLarge);
    }
    let mut workbook = Workbook::new();
    let header_format = Format::new().set_bold();
    let mut used_names = std::collections::HashSet::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let name = unique_sheet_name(sheet, index, &mut used_names);
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(name.as_str())
            .map_err(|_| ConvertError::BadRequest)?;
        if sheet.rows.len() > MAX_ROWS {
            return Err(ConvertError::TooLarge);
        }
        for (row_index, row) in sheet.rows.iter().enumerate() {
            if row.len() > MAX_COLUMNS {
                return Err(ConvertError::TooLarge);
            }
            for (column_index, cell) in row.iter().enumerate() {
                let row = row_index as u32;
                let column = column_index as u16;
                if header && row_index == 0 {
                    if let Some(text) = cell_text(cell)? {
                        worksheet
                            .write_string_with_format(row, column, text.as_str(), &header_format)
                            .map_err(|_| ConvertError::BadRequest)?;
                        continue;
                    }
                }
                match cell {
                    CellValue::Empty => {}
                    CellValue::Text(text) => {
                        check_text(text)?;
                        worksheet
                            .write_string(row, column, text.as_str())
                            .map_err(|_| ConvertError::BadRequest)?;
                    }
                    CellValue::Number(number) => {
                        if !number.is_finite() {
                            return Err(ConvertError::BadRequest);
                        }
                        worksheet
                            .write_number(row, column, *number)
                            .map_err(|_| ConvertError::BadRequest)?;
                    }
                    CellValue::Bool(value) => {
                        worksheet
                            .write_boolean(row, column, *value)
                            .map_err(|_| ConvertError::BadRequest)?;
                    }
                    CellValue::DateIso(text) => {
                        check_text(text)?;
                        worksheet
                            .write_string(row, column, text.as_str())
                            .map_err(|_| ConvertError::BadRequest)?;
                    }
                    CellValue::Formula { text, .. } => {
                        // A formula cell may only reach this writer from an
                        // explicitly trusted workbook source; CSV input never
                        // creates one. Writing it as text is the safe choice.
                        check_text(text)?;
                        worksheet
                            .write_string(row, column, text.as_str())
                            .map_err(|_| ConvertError::BadRequest)?;
                    }
                }
            }
        }
    }
    let bytes = workbook
        .save_to_buffer()
        .map_err(|error| ConvertError::Io(std::io::Error::other(error)))?;
    if bytes.is_empty() {
        return Err(ConvertError::Io(std::io::Error::other(
            "conversion output failed",
        )));
    }
    if bytes.len() as u64 > max_output_bytes {
        return Err(ConvertError::TooLarge);
    }
    Ok(bytes)
}

fn cell_text(cell: &CellValue) -> Result<Option<String>, ConvertError> {
    match cell {
        CellValue::Text(text) => {
            check_text(text)?;
            Ok(Some(text.clone()))
        }
        CellValue::DateIso(text) => {
            check_text(text)?;
            Ok(Some(text.clone()))
        }
        CellValue::Number(number) => Ok(Some(number.to_string())),
        CellValue::Bool(value) => Ok(Some(if *value { "TRUE" } else { "FALSE" }.to_string())),
        CellValue::Formula { text, .. } => {
            check_text(text)?;
            Ok(Some(text.clone()))
        }
        CellValue::Empty => Ok(None),
    }
}

fn check_text(text: &str) -> Result<(), ConvertError> {
    if text.encode_utf16().count() > MAX_CELL_UTF16 {
        Err(ConvertError::TooLarge)
    } else {
        Ok(())
    }
}

fn unique_sheet_name(
    sheet: &SheetData,
    index: usize,
    used: &mut std::collections::HashSet<String>,
) -> String {
    let source = if sheet.name.is_empty() {
        format!("Sheet{}", index + 1)
    } else {
        sheet.name.clone()
    };
    let mut base = normalize_sheet_component(&source)
        .replace(['[', ']'], "_")
        .trim_matches('\'')
        .to_string();
    if base.is_empty() {
        base = "sheet".to_string();
    }
    base = base.chars().take(MAX_SHEET_NAME_CHARS).collect();
    let mut candidate = base.clone();
    let mut suffix = 2usize;
    while used.contains(&candidate.to_lowercase()) {
        let tail = format!("_{suffix}");
        let keep = MAX_SHEET_NAME_CHARS.saturating_sub(tail.chars().count());
        candidate = format!("{}{tail}", base.chars().take(keep).collect::<String>());
        suffix += 1;
    }
    used.insert(candidate.to_lowercase());
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sheet_names_are_bounded_and_unique() {
        let mut used = std::collections::HashSet::new();
        let first = SheetData {
            name: "Budget2026".to_string(),
            rows: Vec::new(),
        };
        assert_eq!(unique_sheet_name(&first, 0, &mut used), "Budget2026");
        assert_eq!(unique_sheet_name(&first, 1, &mut used), "Budget2026_2");
        let long = SheetData {
            name: "x".repeat(40),
            rows: Vec::new(),
        };
        assert_eq!(
            unique_sheet_name(&long, 2, &mut used).chars().count(),
            MAX_SHEET_NAME_CHARS
        );
    }
}
