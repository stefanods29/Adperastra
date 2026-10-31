//! CSV and TSV parsing (Step 06f D3, D5): one text buffer, one end offset per
//! cell and one start index per row, so a million rows stay small, and pages
//! of cells travel to the UI instead of the whole file (P-10).

use std::sync::atomic::Ordering;

use fs_service::CancellationToken;

use crate::error::DataError;
use crate::limits;

/// How much of the file the delimiter detection reads.
const DETECT_WINDOW: usize = 64 * 1024;
/// The token is checked this often while reading rows.
const CANCEL_CHECK_ROWS: usize = 4_096;
/// Candidates are tried in this order, so a tie goes to the earlier one.
const DELIMITERS: [u8; 4] = *b",;\t|";

/// The stops a table keeps; tests use small ones.
#[derive(Debug, Clone, Copy)]
pub struct TableLimits {
    pub rows: usize,
    pub columns: usize,
    pub cells: usize,
}

impl Default for TableLimits {
    fn default() -> Self {
        Self {
            rows: limits::MAX_TABLE_ROWS,
            columns: limits::MAX_TABLE_COLUMNS,
            cells: limits::MAX_TABLE_CELLS,
        }
    }
}

/// A parsed table: every kept cell's text in one buffer.
#[derive(Debug)]
pub struct Table {
    text: String,
    /// End offset of each cell's text in `text` (its start is the previous
    /// end, or 0).
    cell_ends: Vec<u64>,
    /// The first cell index of each row.
    row_starts: Vec<u32>,
    columns: usize,
    truncated: bool,
}

impl Table {
    pub fn rows(&self) -> usize {
        self.row_starts.len()
    }

    /// The longest row after the cut.
    pub fn columns(&self) -> usize {
        self.columns
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    fn row_start(&self, row: usize) -> usize {
        self.row_starts[row] as usize
    }

    /// How many cells this row has; short rows simply have fewer.
    pub fn row_len(&self, row: usize) -> usize {
        if row + 1 < self.row_starts.len() {
            self.row_start(row + 1) - self.row_start(row)
        } else {
            self.cell_ends.len().saturating_sub(self.row_start(row))
        }
    }

    /// A cell's text; a cell past the row's end is empty.
    pub fn cell(&self, row: usize, column: usize) -> &str {
        if row >= self.rows() || column >= self.row_len(row) {
            return "";
        }
        let index = self.row_start(row) + column;
        let start = if index == 0 {
            0
        } else {
            self.cell_ends[index - 1] as usize
        };
        let end = self.cell_ends[index] as usize;
        self.text.get(start..end).unwrap_or("")
    }
}

/// The separator of a table: `.tsv` is always a tab, otherwise the clearest
/// of comma, semicolon, tab and pipe on the first 64 KiB.
pub fn detect_delimiter(text: &str, extension: &str) -> u8 {
    if extension.eq_ignore_ascii_case("tsv") {
        return b'\t';
    }
    let window = detect_window(text);
    let mut best: Option<(u8, usize)> = None;
    for candidate in DELIMITERS {
        let counts = line_counts(window, candidate as char);
        if !qualifies(&counts) {
            continue;
        }
        let count = counts[0];
        if best.is_none_or(|(_, best_count)| count > best_count) {
            best = Some((candidate, count));
        }
    }
    best.map(|(candidate, _)| candidate).unwrap_or(b',')
}

/// The first 64 KiB, cut at a line end.
fn detect_window(text: &str) -> &str {
    if text.len() <= DETECT_WINDOW {
        return text;
    }
    let mut end = DETECT_WINDOW;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind('\n') {
        Some(index) => &text[..=index],
        None => &text[..end],
    }
}

/// The separator count of every non-empty line; text inside double quotes
/// never counts.
fn line_counts(window: &str, delimiter: char) -> Vec<usize> {
    let mut counts = Vec::new();
    let mut quoted = false;
    for line in window.lines() {
        if line.is_empty() {
            continue;
        }
        let mut count = 0;
        for character in line.chars() {
            if character == '"' {
                quoted = !quoted;
            } else if !quoted && character == delimiter {
                count += 1;
            }
        }
        counts.push(count);
    }
    counts
}

/// At least two lines with the same count of at least one, or a single line
/// with one.
fn qualifies(counts: &[usize]) -> bool {
    match counts {
        [] => false,
        [only] => *only >= 1,
        _ => counts[0] >= 1 && counts.iter().all(|count| *count == counts[0]),
    }
}

/// Parse with the app's limits.
pub fn parse_table(
    text: &str,
    delimiter: u8,
    token: &CancellationToken,
) -> Result<Table, DataError> {
    parse_table_with_limits(text, delimiter, token, TableLimits::default())
}

/// Parse a table, stopping at the given limits and saying so (`truncated`).
pub fn parse_table_with_limits(
    text: &str,
    delimiter: u8,
    token: &CancellationToken,
    limits: TableLimits,
) -> Result<Table, DataError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut record = csv::ByteRecord::new();
    let mut table = Table {
        text: String::new(),
        cell_ends: Vec::new(),
        row_starts: Vec::new(),
        columns: 0,
        truncated: false,
    };
    loop {
        if table.rows().is_multiple_of(CANCEL_CHECK_ROWS) && token.load(Ordering::Relaxed) {
            return Err(DataError::Cancelled);
        }
        let read = match reader.read_byte_record(&mut record) {
            Ok(read) => read,
            // A broken record stops the reading; the rows before it stay.
            Err(_) => {
                table.truncated = true;
                break;
            }
        };
        if !read {
            break;
        }
        if table.rows() >= limits.rows {
            table.truncated = true;
            break;
        }
        let mut width = record.len();
        if width > limits.columns {
            width = limits.columns;
            table.truncated = true;
        }
        if table.cell_ends.len() + width > limits.cells {
            table.truncated = true;
            break;
        }
        if width > table.columns {
            table.columns = width;
        }
        table
            .row_starts
            .push(u32::try_from(table.cell_ends.len()).unwrap_or(u32::MAX));
        for index in 0..width {
            let cell = record.get(index).unwrap_or_default();
            table.text.push_str(&String::from_utf8_lossy(cell));
            table.cell_ends.push(table.text.len() as u64);
        }
    }
    Ok(table)
}

/// Whether the first row names the columns (Step 06f D6): the first rule
/// that applies wins.
pub fn first_row_is_header(table: &Table) -> bool {
    if table.rows() == 0 {
        return false;
    }
    let width = table.row_len(0);
    let mut any_text = false;
    let mut all_numbers = true;
    for column in 0..width {
        let cell = table.cell(0, column);
        if cell.is_empty() {
            continue;
        }
        any_text = true;
        if parse_number(cell).is_none() {
            all_numbers = false;
        }
    }
    if !any_text {
        return true;
    }
    !all_numbers
}

/// A cell that is a plain finite number, trimmed.
pub fn parse_number(text: &str) -> Option<f64> {
    let value = text.trim().parse::<f64>().ok()?;
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}
