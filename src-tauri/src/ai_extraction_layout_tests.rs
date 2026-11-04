//! Native layout oracles for Step 17d T2 (decision D3).
#![allow(clippy::assertions_on_constants, clippy::bool_assert_comparison)]


use super::{
    bullet_marker, group_lines, is_paragraph_break, qualifies_heading, qualifies_table,
    table_row_agreement, LayoutWord, HEADING_HEIGHT_FACTOR,
};

fn word(id: u32, text: &str, x: f64, y: f64, width: f64, height: f64) -> LayoutWord {
    LayoutWord {
        word_id: id,
        text: text.to_string(),
        x,
        y,
        width,
        height,
        order: id - 1,
    }
}

#[test]
fn layout_heading_threshold() {
    // 14 px over a 10 px body is 1.4x and qualifies; 13 px is 1.3x and not.
    assert!(HEADING_HEIGHT_FACTOR * 10.0 < 14.0);
    assert!(qualifies_heading(&[14.0], 10.0, 20));
    assert_eq!(qualifies_heading(&[13.0], 10.0, 20), false);
    // A long paragraph is never a heading, even with taller words.
    assert_eq!(qualifies_heading(&[14.0], 10.0, 121), false);
}

#[test]
fn layout_table_alignment() {
    let rows = vec![
        vec![10.0, 210.0, 410.0],
        vec![11.0, 209.0, 411.0],
        vec![10.0, 210.0, 410.0],
        vec![10.0, 300.0, 410.0],
    ];
    assert!((table_row_agreement(&rows, 1000.0) - 0.75).abs() < 1e-9);
    assert!(qualifies_table(&rows, 1000.0));
    let majority_bad = vec![
        vec![10.0, 210.0, 410.0],
        vec![11.0, 209.0, 411.0],
        vec![10.0, 300.0, 410.0],
        vec![10.0, 320.0, 410.0],
    ];
    assert!((table_row_agreement(&majority_bad, 1000.0) - 0.5).abs() < 1e-9);
    assert_eq!(qualifies_table(&majority_bad, 1000.0), false);
    // One column or one row is never a candidate table.
    assert_eq!(qualifies_table(&[vec![10.0], vec![10.0]], 1000.0), false);
    assert_eq!(qualifies_table(&[vec![10.0, 20.0]], 1000.0), false);
}

#[test]
fn layout_paragraph_gap_threshold() {
    assert!(is_paragraph_break(16.0, 10.0));
    assert_eq!(is_paragraph_break(15.0, 10.0), false);
    assert_eq!(is_paragraph_break(16.0, 0.0), false);
}

#[test]
fn layout_bullets_need_a_visible_marker() {
    assert_eq!(bullet_marker("\u{2022} item"), Some("\u{2022}"));
    assert_eq!(bullet_marker("- item"), Some("-"));
    assert_eq!(bullet_marker("-item"), None);
    assert_eq!(bullet_marker("item"), None);
}

#[test]
fn layout_groups_lines_in_reading_order() {
    let words = vec![
        word(2, "world", 50.0, 2.0, 40.0, 10.0),
        word(1, "hello", 10.0, 1.0, 35.0, 10.0),
        word(3, "next", 10.0, 40.0, 30.0, 10.0),
    ];
    let lines = group_lines(&words);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].text(), "hello world");
    assert_eq!(lines[1].text(), "next");
}
