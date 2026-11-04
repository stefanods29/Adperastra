use data_views::error::DataError;
use data_views::table::{
    detect_delimiter, first_row_is_header, parse_table, parse_table_with_limits, TableLimits,
};
use fs_service::new_cancellation_token;
use std::sync::atomic::Ordering;

#[test]
fn delimiters_are_detected() {
    assert_eq!(detect_delimiter("a,b\n1,2\n", "csv"), b',');
    assert_eq!(detect_delimiter("a;b\n1;2\n", "csv"), b';');
    assert_eq!(detect_delimiter("a\tb\n1\t2\n", "csv"), b'\t');
    assert_eq!(detect_delimiter("a|b\n1|2\n", "csv"), b'|');
    assert_eq!(detect_delimiter("solo\n", "csv"), b',');
}

#[test]
fn quoted_delimiters_do_not_count() {
    assert_eq!(detect_delimiter("\"a;b\",c\n\"d;e\",f\n", "csv"), b',');
}

#[test]
fn tsv_extension_wins() {
    assert_eq!(detect_delimiter("a,b\n", "TSV"), b'\t');
}

#[test]
fn quotes_and_line_breaks_stay_in_a_cell() {
    let token = new_cancellation_token();
    let table = parse_table("\"a,b\",\"c\nd\"\n1,2\n", b',', &token).unwrap();
    assert_eq!(table.rows(), 2);
    assert_eq!(table.columns(), 2);
    assert_eq!(table.cell(0, 0), "a,b");
    assert_eq!(table.cell(0, 1), "c\nd");
}

#[test]
fn short_rows_read_empty() {
    let token = new_cancellation_token();
    let table = parse_table("a,b,c\n1\n", b',', &token).unwrap();
    assert_eq!(table.columns(), 3);
    assert_eq!(table.cell(1, 2), "");
}

#[test]
fn row_limit_truncates() {
    let token = new_cancellation_token();
    let limits = TableLimits {
        rows: 2,
        columns: 100,
        cells: 1_000,
    };
    let table = parse_table_with_limits("a\nb\nc\n", b',', &token, limits).unwrap();
    assert_eq!(table.rows(), 2);
    assert!(table.truncated());
}

#[test]
fn cancel_stops_the_parse() {
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    assert_eq!(
        parse_table("a,b\n1,2\n", b',', &token).unwrap_err(),
        DataError::Cancelled
    );
}

#[test]
fn header_detection() {
    let token = new_cancellation_token();
    let table = parse_table("name,age\n", b',', &token).unwrap();
    assert!(first_row_is_header(&table));
    let table = parse_table("1,2\n3,4\n", b',', &token).unwrap();
    assert!(!first_row_is_header(&table));
    let table = parse_table(",\n1,2\n", b',', &token).unwrap();
    assert!(first_row_is_header(&table));
    let table = parse_table("", b',', &token).unwrap();
    assert!(!first_row_is_header(&table));
}
