use data_views::decode::{decode_text, TextEncodingId};

#[test]
fn utf8_with_and_without_mark() {
    let (text, encoding) = decode_text(&[0xEF, 0xBB, 0xBF, 0x61]);
    assert_eq!(text, "a");
    assert_eq!(encoding, TextEncodingId::Utf8);
    let (text, encoding) = decode_text(&[0x61, 0xC3, 0xB1]);
    assert_eq!(text, "añ");
    assert_eq!(encoding, TextEncodingId::Utf8);
}

#[test]
fn utf16_both_orders() {
    let (text, encoding) = decode_text(&[0xFF, 0xFE, 0x61, 0x00]);
    assert_eq!(text, "a");
    assert_eq!(encoding, TextEncodingId::Utf16Le);
    let (text, encoding) = decode_text(&[0xFE, 0xFF, 0x00, 0x61]);
    assert_eq!(text, "a");
    assert_eq!(encoding, TextEncodingId::Utf16Be);
}

#[test]
fn invalid_utf8_falls_back() {
    let (text, encoding) = decode_text(&[0x80, 0xE9]);
    assert_eq!(text, "€é");
    assert_eq!(encoding, TextEncodingId::Windows1252);
}

#[test]
fn odd_utf16_tail_is_replaced() {
    let (text, encoding) = decode_text(&[0xFF, 0xFE, 0x61, 0x00, 0x62]);
    assert_eq!(text, "a\u{FFFD}");
    assert_eq!(encoding, TextEncodingId::Utf16Le);
}
