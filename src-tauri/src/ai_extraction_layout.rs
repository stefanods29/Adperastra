//! Bounded OCR layout heuristics for Step 17d T2 (decision D3).
//!
//! Words arrive from the 07e helper in reading order with pixel boxes. This
//! module groups them into lines, infers paragraph and heading boundaries,
//! and decides whether candidate rows form a table. It never invents text and
//! never fixes an ambiguous grouping silently: callers receive the measured
//! ratio and flag it in the review warnings.
#![allow(dead_code)]


/// A paragraph break when the line gap exceeds this factor of the median line
/// height (D3).
pub const LINE_GAP_FACTOR: f64 = 1.5;
/// A heading when the median word height exceeds this factor of the body
/// median (D3): 14 px over a 10 px body qualifies, 13 px does not.
pub const HEADING_HEIGHT_FACTOR: f64 = 1.35;
/// Longest line that can be a heading (D3).
pub const MAX_HEADING_SCALARS: usize = 120;
/// Table boundaries agree within this fraction of the page width (D3).
pub const TABLE_BOUNDARY_TOLERANCE: f64 = 0.02;
/// Table rows that must agree for a candidate table (D3).
pub const TABLE_ROW_AGREEMENT: f64 = 0.75;
pub const MIN_TABLE_COLUMNS: usize = 2;
pub const MIN_TABLE_ROWS: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutWord {
    /// The OCR word ID (07e `OcrWord.order` + 1 per page).
    pub word_id: u32,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub order: u32,
}

impl LayoutWord {
    pub fn is_valid(&self) -> bool {
        self.word_id >= 1
            && !self.text.is_empty()
            && self.text.chars().count() <= 4096
            && [self.x, self.y, self.width, self.height]
                .iter()
                .all(|value| value.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width > 0.0
            && self.height > 0.0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutLine {
    pub words: Vec<LayoutWord>,
    pub y: f64,
    pub height: f64,
}

impl LayoutLine {
    pub fn text(&self) -> String {
        self.words
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn scalars(&self) -> usize {
        self.text().chars().count()
    }

    pub fn heights(&self) -> Vec<f64> {
        let mut heights: Vec<f64> = self.words.iter().map(|word| word.height).collect();
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        heights
    }

    pub fn median_word_height(&self) -> f64 {
        median(&self.heights())
    }
}

/// Groups words into lines by vertical center, then left-to-right order.
pub fn group_lines(words: &[LayoutWord]) -> Vec<LayoutLine> {
    let mut sorted: Vec<&LayoutWord> = words.iter().filter(|word| word.is_valid()).collect();
    sorted.sort_by(|a, b| {
        let ay = a.y + a.height / 2.0;
        let by = b.y + b.height / 2.0;
        ay.partial_cmp(&by)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.order.cmp(&b.order))
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut lines: Vec<LayoutLine> = Vec::new();
    for word in sorted {
        let center = word.y + word.height / 2.0;
        let joins = lines.last().is_some_and(|line| {
            let line_center = line.y + line.height / 2.0;
            (center - line_center).abs() <= line.height.max(word.height) / 2.0
        });
        if joins {
            let line = lines.last_mut().expect("checked above");
            line.words.push(word.clone());
            line.height = line.height.max(word.height);
            line.y = line.y.min(word.y);
        } else {
            lines.push(LayoutLine {
                words: vec![word.clone()],
                y: word.y,
                height: word.height,
            });
        }
    }
    for line in &mut lines {
        line.words.sort_by(|a, b| {
            a.x.partial_cmp(&b.x)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.order.cmp(&b.order))
        });
    }
    lines
}

pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

/// Median height of the body lines (the majority height, not the mean).
pub fn body_median_height(lines: &[LayoutLine]) -> f64 {
    let mut heights: Vec<f64> = lines
        .iter()
        .filter(|line| !line.words.is_empty())
        .map(LayoutLine::median_word_height)
        .collect();
    if heights.is_empty() {
        return 0.0;
    }
    heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    heights[heights.len() / 2]
}

/// A line gap over 1.5 times the median line height starts a paragraph.
pub fn is_paragraph_break(gap: f64, median_line_height: f64) -> bool {
    median_line_height > 0.0 && gap.is_finite() && gap > LINE_GAP_FACTOR * median_line_height
}

/// A short line whose median word height exceeds 1.35 times the body median.
pub fn qualifies_heading(word_heights: &[f64], body_median: f64, scalars: usize) -> bool {
    if body_median <= 0.0 || word_heights.is_empty() || scalars == 0 || scalars > MAX_HEADING_SCALARS {
        return false;
    }
    let median_height = median(word_heights);
    median_height > HEADING_HEIGHT_FACTOR * body_median
}

/// A visible leading bullet marker; nothing is invented from punctuation.
pub fn bullet_marker(text: &str) -> Option<&'static str> {
    let trimmed = text.trim_start();
    for marker in ["\u{2022}", "\u{2023}", "\u{25E6}", "-", "*"] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            if rest.starts_with(' ') || rest.starts_with('\t') {
                return Some(marker);
            }
        }
    }
    None
}

/// The share of rows whose cell boundaries agree with the first row within
/// 2% of the page width. Rows must have the same column count to agree.
pub fn table_row_agreement(rows: &[Vec<f64>], page_width: f64) -> f64 {
    if rows.len() < MIN_TABLE_ROWS || !page_width.is_finite() || page_width <= 0.0 {
        return 0.0;
    }
    let reference = &rows[0];
    if reference.len() < MIN_TABLE_COLUMNS {
        return 0.0;
    }
    let tolerance = TABLE_BOUNDARY_TOLERANCE * page_width;
    let aligned = rows
        .iter()
        .filter(|row| {
            row.len() == reference.len()
                && row.iter().all(|boundary| {
                    reference
                        .iter()
                        .any(|wanted| (boundary - wanted).abs() <= tolerance)
                })
        })
        .count();
    aligned as f64 / rows.len() as f64
}

/// At least two columns and two rows, with 75% of rows aligned (D3).
pub fn qualifies_table(rows: &[Vec<f64>], page_width: f64) -> bool {
    if rows.len() < MIN_TABLE_ROWS {
        return false;
    }
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    columns >= MIN_TABLE_COLUMNS && table_row_agreement(rows, page_width) >= TABLE_ROW_AGREEMENT
}

/// One page's layout result. `ambiguous` is reported, never silently fixed.
#[derive(Debug, Clone, PartialEq)]
pub struct PageLayout {
    pub lines: Vec<LayoutLine>,
    pub body_median: f64,
    pub paragraph_breaks: Vec<bool>,
    pub headings: Vec<bool>,
    pub bullets: Vec<Option<String>>,
    pub ambiguous: bool,
}

pub fn analyze_page(words: &[LayoutWord], page_width: f64) -> PageLayout {
    let lines = group_lines(words);
    let body_median = body_median_height(&lines);
    let paragraph_breaks = lines
        .windows(2)
        .map(|pair| {
            let previous_bottom = pair[0].y + pair[0].height;
            is_paragraph_break(pair[1].y - previous_bottom, body_median)
        })
        .collect();
    let headings: Vec<bool> = lines
        .iter()
        .map(|line| qualifies_heading(&line.heights(), body_median, line.scalars()))
        .collect();
    let bullets = lines
        .iter()
        .map(|line| bullet_marker(&line.text()).map(str::to_string))
        .collect();
    // A heading that covers most of the page's lines is a bad threshold
    // result; flag it instead of applying it silently.
    let ambiguous = !lines.is_empty()
        && headings.iter().filter(|heading| **heading).count() > 0
        && headings.iter().filter(|heading| **heading).count() * 2 >= lines.len()
        && page_width > 0.0;
    PageLayout {
        lines,
        body_median,
        paragraph_breaks,
        headings,
        bullets,
        ambiguous,
    }
}

#[cfg(test)]
#[path = "ai_extraction_layout_tests.rs"]
mod tests;
