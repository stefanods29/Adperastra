//! Sorting and filtering (Step 06f D7): one job builds the row order from the
//! column, direction, header choice and filter; pages of cells follow it.

use std::cmp::Ordering;
use std::sync::atomic::Ordering as AtomicOrdering;

use fs_service::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::error::DataError;
use crate::limits::{MAX_CELL_CHARS, MAX_PAGE_ROWS};
use crate::table::{parse_number, Table};

/// The token is checked this often while the order is built.
const CANCEL_CHECK_ROWS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// What the UI asks a table to show.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableViewRequest {
    pub sort_column: Option<u32>,
    pub direction: SortDirection,
    pub has_header: bool,
    pub filter: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CellClass {
    Number,
    Text,
    Empty,
}

fn classify(text: &str) -> CellClass {
    if text.is_empty() {
        CellClass::Empty
    } else if parse_number(text).is_some() {
        CellClass::Number
    } else {
        CellClass::Text
    }
}

/// Numbers first, then text, then empty cells; descending swaps the first
/// two and their order and keeps empty last.
pub fn compare_cells(a: &str, b: &str, direction: SortDirection) -> Ordering {
    let class_a = classify(a);
    let class_b = classify(b);
    if class_a == CellClass::Empty || class_b == CellClass::Empty {
        return match (class_a, class_b) {
            (CellClass::Empty, CellClass::Empty) => Ordering::Equal,
            (CellClass::Empty, _) => Ordering::Greater,
            _ => Ordering::Less,
        };
    }
    let base = match (class_a, class_b) {
        (CellClass::Number, CellClass::Number) => parse_number(a)
            .unwrap_or_default()
            .total_cmp(&parse_number(b).unwrap_or_default()),
        (CellClass::Number, CellClass::Text) => Ordering::Less,
        (CellClass::Text, CellClass::Number) => Ordering::Greater,
        _ => a
            .to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b)),
    };
    match direction {
        SortDirection::Ascending => base,
        SortDirection::Descending => base.reverse(),
    }
}

/// The row indexes in display order, without the header row. Filters by any
/// cell and sorts stably, so equal cells keep the file's order.
pub fn build_order(
    table: &Table,
    request: &TableViewRequest,
    token: &CancellationToken,
) -> Result<Vec<u32>, DataError> {
    let needle = request.filter.to_lowercase();
    let start = usize::from(request.has_header);
    let mut rows: Vec<u32> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for row in start..table.rows() {
        if (row - start).is_multiple_of(CANCEL_CHECK_ROWS) && token.load(AtomicOrdering::Relaxed) {
            return Err(DataError::Cancelled);
        }
        if !needle.is_empty() {
            let mut found = false;
            for column in 0..table.row_len(row) {
                if table.cell(row, column).to_lowercase().contains(&needle) {
                    found = true;
                    break;
                }
            }
            if !found {
                continue;
            }
        }
        rows.push(u32::try_from(row).unwrap_or(u32::MAX));
        if let Some(column) = request.sort_column {
            keys.push(table.cell(row, column as usize).to_string());
        }
    }
    if request.sort_column.is_some() {
        let mut pairs: Vec<(u32, String)> = rows.into_iter().zip(keys).collect();
        pairs.sort_by(|left, right| compare_cells(&left.1, &right.1, request.direction));
        rows = pairs.into_iter().map(|(row, _)| row).collect();
    }
    Ok(rows)
}

/// Up to one page of rows, each with one string per column.
pub fn page_rows(table: &Table, order: &[u32], start: usize, count: usize) -> Vec<Vec<String>> {
    if start >= order.len() {
        return Vec::new();
    }
    let end = start
        .saturating_add(count.min(MAX_PAGE_ROWS))
        .min(order.len());
    let mut page = Vec::with_capacity(end - start);
    for entry in order.iter().take(end).skip(start) {
        let row = *entry as usize;
        let mut cells = Vec::with_capacity(table.columns());
        for column in 0..table.columns() {
            cells.push(cut_cell(table.cell(row, column)));
        }
        page.push(cells);
    }
    page
}

/// At most `MAX_CELL_CHARS` characters, with `…` when text was left out.
pub fn cut_cell(text: &str) -> String {
    if text.chars().count() <= MAX_CELL_CHARS {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(MAX_CELL_CHARS).collect();
    cut.push('…');
    cut
}
