use data_views::subtitle::{parse_subtitles, parse_timestamp, strip_active_markup};

#[test]
fn srt_1250_to_2500_gives_exact_milliseconds() {
    let doc = parse_subtitles(b"1\r\n00:00:01,250 --> 00:00:02,500\r\nHello\r\n\r\n").unwrap();
    assert_eq!(doc.cues.len(), 1);
    assert_eq!(doc.cues[0].start_ms, 1_250);
    assert_eq!(doc.cues[0].end_ms, 2_500);
}

#[test]
fn seconds_59_valid_60_invalid() {
    assert_eq!(parse_timestamp("00:00:59,999", false), Some(59_999));
    assert_eq!(parse_timestamp("00:00:60,000", false), None);
    assert_eq!(parse_timestamp("00:60:00,000", false), None);
    assert_eq!(parse_timestamp("00:00:01.250", true), Some(1_250));
}

#[test]
fn malformed_blocks_are_flagged_and_the_good_ones_remain() {
    let doc = parse_subtitles(
        b"1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\nnot a time\nBad\n\n3\n00:00:03,000 --> 00:00:04,000\nAlso good\n",
    )
    .unwrap();
    assert_eq!(doc.cues.len(), 2);
    assert_eq!(doc.invalid, 1);
    assert!(doc.partial);
}

#[test]
fn active_markup_is_plain_text_again() {
    assert_eq!(
        strip_active_markup("<i>Hola</i> <c.yellow>mundo</c> {\\an8}"),
        "Hola mundo"
    );
}
