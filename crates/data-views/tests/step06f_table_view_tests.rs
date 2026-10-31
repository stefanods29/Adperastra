use data_views::error::DataError;
use data_views::table::{parse_table, Table};
use data_views::table_view::{build_order, page_rows, SortDirection, TableViewRequest};
use fs_service::new_cancellation_token;
use std::sync::atomic::Ordering;

fn table(text: &str) -> Table {
    parse_table(text, b',', &new_cancellation_token()).unwrap()
}

fn request(
    sort_column: Option<u32>,
    direction: SortDirection,
    has_header: bool,
    filter: &str,
) -> TableViewRequest {
    TableViewRequest {
        sort_column,
        direction,
        has_header,
        filter: filter.to_string(),
    }
}

fn values(table: &Table, order: &[u32], column: usize) -> Vec<String> {
    order
        .iter()
        .map(|row| table.cell(*row as usize, column).to_string())
        .collect()
}

#[test]
fn numbers_sort_as_numbers() {
    let table = table("10\n9\n100\n");
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(Some(0), SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    assert_eq!(values(&table, &order, 0), ["9", "10", "100"]);
}

#[test]
fn empty_is_last_both_ways() {
    let table = table("b,x\n,y\na,z\n2,w\n");
    let token = new_cancellation_token();
    let ascending = build_order(
        &table,
        &request(Some(0), SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    assert_eq!(values(&table, &ascending, 0), ["2", "a", "b", ""]);
    let descending = build_order(
        &table,
        &request(Some(0), SortDirection::Descending, false, ""),
        &token,
    )
    .unwrap();
    assert_eq!(values(&table, &descending, 0), ["b", "a", "2", ""]);
}

#[test]
fn text_ignores_case_and_ties_keep_file_order() {
    let table = table("b,1\nA,2\na,3\n");
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(Some(0), SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    assert_eq!(order, [1, 2, 0]);
}

#[test]
fn header_stays_out() {
    let table = table("h\n2\n1\n");
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(Some(0), SortDirection::Ascending, true, ""),
        &token,
    )
    .unwrap();
    assert_eq!(order, [2, 1]);
}

#[test]
fn filter_matches_any_cell_without_case() {
    let table = table("Ana,x\nLuis,ANA\nEva,y\n");
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(None, SortDirection::Ascending, false, "ana"),
        &token,
    )
    .unwrap();
    assert_eq!(order, [0, 1]);
}

#[test]
fn no_header_keeps_row_zero() {
    let table = table("2\n1\n");
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(Some(0), SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    assert_eq!(order, [1, 0]);
}

#[test]
fn cells_are_cut() {
    let text = format!("{}\n", "x".repeat(2001));
    let table = table(&text);
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(None, SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    let page = page_rows(&table, &order, 0, 10);
    let cell = &page[0][0];
    assert_eq!(cell.chars().count(), 2001);
    assert_eq!(*cell, format!("{}…", "x".repeat(2000)));
}

#[test]
fn page_is_capped() {
    let text: String = (0..600).map(|index| format!("{index}\n")).collect();
    let table = table(&text);
    let token = new_cancellation_token();
    let order = build_order(
        &table,
        &request(None, SortDirection::Ascending, false, ""),
        &token,
    )
    .unwrap();
    let page = page_rows(&table, &order, 0, 600);
    assert_eq!(page.len(), 500);
}

#[test]
fn cancel_stops_the_view() {
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    let table = table("a\n");
    assert_eq!(
        build_order(
            &table,
            &request(None, SortDirection::Ascending, false, ""),
            &token
        )
        .unwrap_err(),
        DataError::Cancelled
    );
}
