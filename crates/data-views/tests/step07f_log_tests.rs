use data_views::log::{scan_block, LogLevel, LogScanner};

#[test]
fn split_utf8_e_is_retained_across_chunks() {
    let mut scanner = LogScanner::new(0);
    let bytes = "café\n".as_bytes();
    assert!(scanner.feed(&bytes[..4]).unwrap().is_empty());
    let records = scanner.feed(&bytes[4..]).unwrap();
    assert_eq!(records[0].text, "café");
}

#[test]
fn a_seventy_kib_line_is_explicitly_truncated() {
    let line = "x".repeat(70 * 1024);
    let records = scan_block(format!("{line}\n").as_bytes(), 0).unwrap();
    assert_eq!(records[0].text.chars().count(), 64 * 1024);
    assert!(records[0].truncated);
}

#[test]
fn append_updates_only_the_new_range() {
    let mut scanner = LogScanner::new(0);
    let first = scanner.feed(b"one\ntwo\n").unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(first[1].byte_offset, "4");
    let second = scanner.feed(b"three\n").unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].byte_offset, "8");
    assert_eq!(second[0].text, "three");
}

#[test]
fn warning_maps_to_warn_and_a_timestamp_is_skipped() {
    let records = scan_block(b"2026-11-02T10:00:00Z WARNING slow\n", 0).unwrap();
    assert_eq!(records[0].level, LogLevel::Warn);
}

#[test]
fn ansi_sequences_are_removed() {
    let records = scan_block(b"\x1b[31merror\x1b[0m\n", 0).unwrap();
    assert_eq!(records[0].text, "error");
}
