//! CSV writing for the XLSX-to-CSV adapter (Step 08b D6).
//!
//! Quoting is exact: a delimiter, a quote or a line break quotes the field;
//! an embedded quote is doubled. The output is UTF-8 without a BOM, with the
//! chosen LF or CRLF. Formula and date policies are explicit, and a text cell
//! that could become active on spreadsheet open is prefixed with an
//! apostrophe and counted for the required `formula_safety_prefix`
//! acknowledgement. Numeric negative cells stay numeric and unprefixed.

use crate::error::ConvertError;
use crate::table_read::{CellValue, SheetData, MAX_CELL_UTF16};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormulaPolicy {
    Text,
    Preserve,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatePolicy {
    Iso,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CsvWriteOptions {
    pub delimiter: u8,
    pub newline: &'static str,
    pub formulas: FormulaPolicy,
    pub dates: DatePolicy,
}

impl Default for CsvWriteOptions {
    fn default() -> Self {
        Self {
            delimiter: b',',
            newline: "\r\n",
            formulas: FormulaPolicy::Text,
            dates: DatePolicy::Iso,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CsvWriteResult {
    pub bytes: Vec<u8>,
    /// Text cells that received the safety apostrophe.
    pub safety_prefix_count: u32,
    /// A formula requested `preserve` but had no cached value.
    pub cached_missing: bool,
}

/// Write one worksheet as CSV.
pub fn write_csv_sheet(
    sheet: &SheetData,
    options: &CsvWriteOptions,
) -> Result<CsvWriteResult, ConvertError> {
    if !matches!(options.delimiter, b',' | b'\t' | b';') {
        return Err(ConvertError::BadRequest);
    }
    if options.newline != "\r\n" && options.newline != "\n" {
        return Err(ConvertError::BadRequest);
    }
    let mut result = CsvWriteResult::default();
    for row in &sheet.rows {
        let mut first = true;
        for cell in row {
            if !first {
                result.bytes.push(options.delimiter);
            }
            first = false;
            let text = cell_text(cell, options, &mut result)?;
            if text.encode_utf16().count() > MAX_CELL_UTF16 {
                return Err(ConvertError::TooLarge);
            }
            push_field(&mut result.bytes, &text, options.delimiter);
        }
        result.bytes.extend_from_slice(options.newline.as_bytes());
    }
    Ok(result)
}

fn cell_text(
    cell: &CellValue,
    options: &CsvWriteOptions,
    result: &mut CsvWriteResult,
) -> Result<String, ConvertError> {
    match cell {
        CellValue::Empty => Ok(String::new()),
        CellValue::Text(text) => Ok(maybe_prefix(text, result)),
        CellValue::Number(number) => Ok(format_number(*number)),
        CellValue::Bool(value) => Ok(if *value { "TRUE" } else { "FALSE" }.to_string()),
        CellValue::DateIso(text) => match options.dates {
            DatePolicy::Iso => Ok(text.clone()),
            DatePolicy::Text => Ok(maybe_prefix(text, result)),
        },
        CellValue::Formula { text, cached } => match options.formulas {
            FormulaPolicy::Text => Ok(text.clone()),
            FormulaPolicy::Preserve => match cached {
                Some(value) => cell_text(value, options, result),
                None => {
                    result.cached_missing = true;
                    Ok(String::new())
                }
            },
        },
    }
}

/// A text cell that starts with `=`, `+`, `-`, `@`, tab or CR could become
/// active when a spreadsheet opens the CSV. Prefix it and count it.
fn maybe_prefix(text: &str, result: &mut CsvWriteResult) -> String {
    if starts_active(text) {
        result.safety_prefix_count = result.safety_prefix_count.saturating_add(1);
        let mut prefixed = String::with_capacity(text.len() + 1);
        prefixed.push('\'');
        prefixed.push_str(text);
        prefixed
    } else {
        text.to_string()
    }
}

pub fn starts_active(text: &str) -> bool {
    matches!(
        text.chars().next(),
        Some('=' | '+' | '-' | '@' | '\t' | '\r')
    )
}

/// Plain, locale-independent number text (D5): no thousands separators.
fn format_number(number: f64) -> String {
    if number.is_finite() && number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_992.0 {
        format!("{number:.0}")
    } else {
        number.to_string()
    }
}

/// Quote one field when it contains the delimiter, a quote or a line break;
/// double every embedded quote.
pub fn push_field(bytes: &mut Vec<u8>, text: &str, delimiter: u8) {
    let needs_quote = text.as_bytes().contains(&delimiter)
        || text.contains('"')
        || text.contains('\n')
        || text.contains('\r');
    if !needs_quote {
        bytes.extend_from_slice(text.as_bytes());
        return;
    }
    bytes.push(b'"');
    for byte in text.as_bytes() {
        if *byte == b'"' {
            bytes.extend_from_slice(b"\"\"");
        } else {
            bytes.push(*byte);
        }
    }
    bytes.push(b'"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> CsvWriteOptions {
        CsvWriteOptions::default()
    }

    #[test]
    fn quotes_delimiters_quotes_and_newlines() {
        let sheet = SheetData {
            name: "S".to_string(),
            rows: vec![vec![
                CellValue::Text("a".to_string()),
                CellValue::Text("b,c".to_string()),
                CellValue::Text("say \"hi\"".to_string()),
                CellValue::Text("line\nbreak".to_string()),
            ]],
        };
        let result = write_csv_sheet(&sheet, &options()).unwrap();
        assert_eq!(
            String::from_utf8(result.bytes).unwrap(),
            "a,\"b,c\",\"say \"\"hi\"\"\",\"line\nbreak\"\r\n"
        );
    }

    #[test]
    fn dangerous_text_is_prefixed_and_counted() {
        let sheet = SheetData {
            name: "S".to_string(),
            rows: vec![vec![
                CellValue::Text("=1+1".to_string()),
                CellValue::Text("-12".to_string()),
                CellValue::Number(-12.0),
            ]],
        };
        let result = write_csv_sheet(&sheet, &options()).unwrap();
        assert_eq!(
            String::from_utf8(result.bytes).unwrap(),
            "'=1+1,'-12,-12\r\n"
        );
        assert_eq!(result.safety_prefix_count, 2);
    }

    #[test]
    fn formula_text_is_explicit_and_preserve_uses_cached_value() {
        let sheet = SheetData {
            name: "S".to_string(),
            rows: vec![vec![CellValue::Formula {
                text: "=1+1".to_string(),
                cached: Some(Box::new(CellValue::Number(2.0))),
            }]],
        };
        let text = write_csv_sheet(&sheet, &options()).unwrap();
        assert_eq!(String::from_utf8(text.bytes).unwrap(), "=1+1\r\n");
        let preserve = CsvWriteOptions {
            formulas: FormulaPolicy::Preserve,
            ..options()
        };
        let cached = write_csv_sheet(&sheet, &preserve).unwrap();
        assert_eq!(String::from_utf8(cached.bytes).unwrap(), "2\r\n");
    }

    #[test]
    fn missing_cached_formula_is_explicit() {
        let sheet = SheetData {
            name: "S".to_string(),
            rows: vec![vec![CellValue::Formula {
                text: "=SUM(A1:A2)".to_string(),
                cached: None,
            }]],
        };
        let preserve = CsvWriteOptions {
            formulas: FormulaPolicy::Preserve,
            ..options()
        };
        let result = write_csv_sheet(&sheet, &preserve).unwrap();
        assert!(result.cached_missing);
        assert_eq!(String::from_utf8(result.bytes).unwrap(), "\r\n");
    }

    #[test]
    fn lf_and_crlf_are_the_only_line_endings() {
        let sheet = SheetData {
            name: "S".to_string(),
            rows: vec![vec![CellValue::Text("a".to_string())]],
        };
        let lf = CsvWriteOptions {
            newline: "\n",
            ..options()
        };
        assert_eq!(write_csv_sheet(&sheet, &lf).unwrap().bytes, b"a\n");
    }
}
