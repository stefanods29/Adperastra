//! One text decoder for every data viewer (Step 06f D4): a byte-order mark
//! first, then valid UTF-8, otherwise Windows-1252.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextEncodingId {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

/// Decode file bytes to text; the second value says which encoding was used.
pub fn decode_text(bytes: &[u8]) -> (String, TextEncodingId) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(rest).into_owned(),
            TextEncodingId::Utf8,
        );
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return (decode_utf16(rest, true), TextEncodingId::Utf16Le);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return (decode_utf16(rest, false), TextEncodingId::Utf16Be);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), TextEncodingId::Utf8),
        Err(_) => (decode_windows1252(bytes), TextEncodingId::Windows1252),
    }
}

/// UTF-16 without its byte-order mark. A broken pair or a missing second
/// byte of the last unit becomes the replacement character.
fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let mut units = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index + 1 < bytes.len() {
        let pair = [bytes[index], bytes[index + 1]];
        units.push(if little_endian {
            u16::from_le_bytes(pair)
        } else {
            u16::from_be_bytes(pair)
        });
        index += 2;
    }
    let mut text = String::from_utf16_lossy(&units);
    if index < bytes.len() {
        text.push('\u{FFFD}');
    }
    text
}

fn decode_windows1252(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len());
    for byte in bytes {
        text.push(windows1252_char(*byte));
    }
    text
}

/// Bytes 0x80 to 0x9F are the only ones Windows-1252 moves. Its five
/// undefined bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their own code.
fn windows1252_char(byte: u8) -> char {
    let code = match byte {
        0x80 => 0x20AC,
        0x82 => 0x201A,
        0x83 => 0x0192,
        0x84 => 0x201E,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x02C6,
        0x89 => 0x2030,
        0x8A => 0x0160,
        0x8B => 0x2039,
        0x8C => 0x0152,
        0x8E => 0x017D,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201C,
        0x94 => 0x201D,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x02DC,
        0x99 => 0x2122,
        0x9A => 0x0161,
        0x9B => 0x203A,
        0x9C => 0x0153,
        0x9E => 0x017E,
        0x9F => 0x0178,
        other => u32::from(other),
    };
    char::from_u32(code).unwrap_or('\u{FFFD}')
}
