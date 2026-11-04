//! Step 08b CSV/XLSX conversion oracles (D5/D6). Written, not run by the worker.

use convert::csv_output::{write_csv_sheet, CsvWriteOptions, FormulaPolicy};
use convert::table_read::{read_csv, read_xlsx, CellValue};
use convert::table_write::write_xlsx;
use fs_service::new_cancellation_token;
use rust_xlsxwriter::Workbook;

fn fixture_xlsx() -> Vec<u8> {
    let mut workbook = Workbook::new();
    let budget = workbook.add_worksheet();
    budget.set_name("Budget2026").unwrap();
    budget.write_string(0, 0, "Item").unwrap();
    budget.write_string(0, 1, "Amount").unwrap();
    budget.write_string(1, 0, "000123").unwrap();
    budget.write_number(1, 1, -12.0).unwrap();
    let other = workbook.add_worksheet();
    other.set_name("Notes").unwrap();
    other.write_string(0, 0, "hello").unwrap();
    workbook.save_to_buffer().unwrap()
}

#[test]
fn csv_text_000123_stays_text_in_xlsx() {
    let token = new_cancellation_token();
    let sheet = read_csv(b"id\n000123\n", b',', &token).unwrap();
    let bytes = write_xlsx(&[sheet], true, 64 * 1024 * 1024).unwrap();
    let workbook = read_xlsx(&bytes, None, &token).unwrap();
    assert_eq!(
        workbook.sheets[0].rows[1][0],
        CellValue::Text("000123".to_string())
    );
}

#[test]
fn text_that_looks_like_a_formula_is_written_as_string() {
    let token = new_cancellation_token();
    let sheet = read_csv(b"v\n=1+1\n", b',', &token).unwrap();
    let bytes = write_xlsx(&[sheet], true, 64 * 1024 * 1024).unwrap();
    let workbook = read_xlsx(&bytes, None, &token).unwrap();
    assert_eq!(
        workbook.sheets[0].rows[1][0],
        CellValue::Text("=1+1".to_string())
    );
    assert_eq!(workbook.formula_cells, 0);
}

#[test]
fn selecting_one_sheet_reports_the_other_is_not_converted() {
    let token = new_cancellation_token();
    let bytes = fixture_xlsx();
    let selected = read_xlsx(&bytes, Some("Budget2026"), &token).unwrap();
    assert_eq!(selected.total_sheets, 2);
    assert_eq!(selected.sheets.len(), 1);
    assert_eq!(selected.sheets[0].name, "Budget2026");
}

#[test]
fn sheet_name_feeds_the_default_name_pattern() {
    let token = new_cancellation_token();
    let bytes = fixture_xlsx();
    let workbook = read_xlsx(&bytes, Some("Budget2026"), &token).unwrap();
    let part: convert::types::OutputNamePart =
        serde_json::from_value(serde_json::json!({"kind":"sheet","sheet":workbook.sheets[0].name}))
            .unwrap();
    let stem = convert::naming::effective_stem("book", &part);
    assert_eq!(
        convert::naming::render_conversion_name(
            "{stem}-{index}.{ext}",
            &stem,
            "csv",
            1,
            "2026-11-01"
        )
        .unwrap(),
        "book-Budget2026-001.csv"
    );
}

#[test]
fn formula_safety_prefix_counts_text_but_not_numbers() {
    let sheet = convert::table_read::SheetData {
        name: "S".to_string(),
        rows: vec![vec![
            CellValue::Text("=1+1".to_string()),
            CellValue::Text("-12".to_string()),
            CellValue::Number(-12.0),
        ]],
    };
    let result = write_csv_sheet(&sheet, &CsvWriteOptions::default()).unwrap();
    assert_eq!(result.safety_prefix_count, 2);
    assert_eq!(
        String::from_utf8(result.bytes).unwrap(),
        "'=1+1,'-12,-12\r\n"
    );
}

#[test]
fn missing_formula_cache_is_explicit() {
    let sheet = convert::table_read::SheetData {
        name: "S".to_string(),
        rows: vec![vec![CellValue::Formula {
            text: "=SUM(A1:A2)".to_string(),
            cached: None,
        }]],
    };
    let options = CsvWriteOptions {
        formulas: FormulaPolicy::Preserve,
        ..CsvWriteOptions::default()
    };
    let result = write_csv_sheet(&sheet, &options).unwrap();
    assert!(result.cached_missing);
}
