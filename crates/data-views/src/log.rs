//! Streamed logs (Step 07f algorithm 5): a range scanner that carries a
//! partial line and a split UTF-8/UTF-16 sequence across chunks. The file is
//! only read by ranges; nothing here loads a whole log or changes it.

use serde::{Deserialize, Serialize};

use crate::ansi::{strip_ansi, truncate_chars};
use crate::decode::decode_text;
use crate::viewer_error::ViewerError;

/// The largest first read of a log session.
pub const MAX_LOG_INITIAL_BYTES: u64 = 1024 * 1024;
/// The most lines one scan block returns.
pub const MAX_LOG_LINES_PER_BLOCK: usize = 1_000;
/// The most characters one line carries before it is explicitly truncated.
pub const MAX_LOG_LINE_CHARS: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogRecord {
    /// Decimal, never a lossy JavaScript number.
    pub line: String,
    /// Decimal byte offset of the line's first byte.
    pub byte_offset: String,
    pub level: LogLevel,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Encoding {
    Unknown,
    Utf8,
    Utf16Le,
    Utf16Be,
}

/// One incremental reader. Feed it consecutive file ranges; it returns only
/// the lines completed by the new bytes.
pub struct LogScanner {
    encoding: Encoding,
    pending: Vec<u8>,
    next_offset: u64,
    line_number: u64,
    line_offset: u64,
    partial: bool,
}

impl LogScanner {
    pub fn new(start_offset: u64) -> Self {
        Self {
            encoding: Encoding::Unknown,
            pending: Vec::new(),
            next_offset: start_offset,
            line_number: 0,
            line_offset: start_offset,
            partial: false,
        }
    }

    /// The absolute offset of the first byte not yet returned.
    pub fn next_offset(&self) -> u64 {
        self.next_offset
    }

    /// True when the last line had no terminator or an escape was cut.
    pub fn partial(&self) -> bool {
        self.partial
    }

    /// Bytes held for the next chunk (an incomplete line or sequence).
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<LogRecord>, ViewerError> {
        if self.encoding == Encoding::Unknown {
            self.detect_encoding(bytes);
        }
        self.pending.extend_from_slice(bytes);
        let mut records = Vec::new();
        while let Some((separator, width)) = self.find_separator() {
            if records.len() >= MAX_LOG_LINES_PER_BLOCK {
                break;
            }
            let raw: Vec<u8> = self.pending.drain(..separator).collect();
            self.pending.drain(..width);
            let offset = self.line_offset;
            self.line_offset = self.line_offset.saturating_add((separator + width) as u64);
            self.next_offset = self.line_offset;
            self.line_number = self.line_number.saturating_add(1);
            records.push(self.record_for(raw, offset));
        }
        Ok(records)
    }

    /// The incomplete last line, if any, for callers that reached EOF. It is
    /// not returned by `feed` because a tail may still append to it.
    pub fn finish(&mut self) -> Option<LogRecord> {
        if self.pending.is_empty() {
            return None;
        }
        let raw: Vec<u8> = std::mem::take(&mut self.pending);
        let offset = self.line_offset;
        self.line_offset = self.line_offset.saturating_add(raw.len() as u64);
        self.next_offset = self.line_offset;
        self.line_number = self.line_number.saturating_add(1);
        Some(self.record_for(raw, offset))
    }

    fn detect_encoding(&mut self, bytes: &[u8]) {
        self.encoding = if bytes.starts_with(&[0xFF, 0xFE]) {
            Encoding::Utf16Le
        } else if bytes.starts_with(&[0xFE, 0xFF]) {
            Encoding::Utf16Be
        } else {
            // UTF-8, with or without a byte-order mark.
            Encoding::Utf8
        };
    }

    /// The index and width of the next line separator, if the buffered bytes
    /// already hold one.
    fn find_separator(&self) -> Option<(usize, usize)> {
        match self.encoding {
            Encoding::Utf16Le => self
                .pending
                .windows(2)
                .position(|window| window == [0x0A, 0x00])
                .map(|index| (index, 2)),
            Encoding::Utf16Be => self
                .pending
                .windows(2)
                .position(|window| window == [0x00, 0x0A])
                .map(|index| (index, 2)),
            Encoding::Unknown | Encoding::Utf8 => self
                .pending
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|index| (index, 1)),
        }
    }

    fn record_for(&self, mut raw: Vec<u8>, offset: u64) -> LogRecord {
        // A CRLF file leaves the carriage return before the line feed.
        match self.encoding {
            Encoding::Utf16Le if raw.ends_with(&[0x0D, 0x00]) => raw.truncate(raw.len() - 2),
            Encoding::Utf16Be if raw.ends_with(&[0x00, 0x0D]) => raw.truncate(raw.len() - 2),
            Encoding::Unknown | Encoding::Utf8 if raw.last() == Some(&b'\r') => {
                raw.pop();
            }
            _ => {}
        }
        let text = match self.encoding {
            Encoding::Utf16Le => {
                if raw.starts_with(&[0xFF, 0xFE]) {
                    raw.drain(..2);
                }
                let mut with_bom = vec![0xFF, 0xFE];
                with_bom.extend_from_slice(&raw);
                decode_text(&with_bom).0
            }
            Encoding::Utf16Be => {
                if raw.starts_with(&[0xFE, 0xFF]) {
                    raw.drain(..2);
                }
                let mut with_bom = vec![0xFE, 0xFF];
                with_bom.extend_from_slice(&raw);
                decode_text(&with_bom).0
            }
            Encoding::Unknown | Encoding::Utf8 => {
                let (text, _encoding) = decode_text(&raw);
                text
            }
        };
        let (text, ansi_cut) = strip_ansi(&text);
        let (text, length_cut) = truncate_chars(&text, MAX_LOG_LINE_CHARS);
        LogRecord {
            line: self.line_number.to_string(),
            byte_offset: offset.to_string(),
            level: detect_level(&text),
            text,
            truncated: ansi_cut || length_cut,
        }
    }
}

// The scanner returns one record at a time; the caller counts them.
impl std::fmt::Debug for LogScanner {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LogScanner")
            .field("next_offset", &self.next_offset)
            .field("pending", &self.pending.len())
            .finish()
    }
}

/// The level is the first standalone token after an optional timestamp.
pub fn detect_level(text: &str) -> LogLevel {
    for token in text.split_whitespace().take(8) {
        if looks_like_timestamp(token) {
            continue;
        }
        let clean = token
            .trim_matches(|character: char| {
                matches!(character, '[' | ']' | '(' | ')' | ':' | '-' | '|' | ',')
            })
            .to_ascii_uppercase();
        let clean = clean.strip_prefix("LEVEL=").unwrap_or(&clean);
        return match clean {
            "TRACE" => LogLevel::Trace,
            "DEBUG" => LogLevel::Debug,
            "INFO" => LogLevel::Info,
            "WARN" | "WARNING" => LogLevel::Warn,
            "ERROR" => LogLevel::Error,
            "FATAL" => LogLevel::Fatal,
            _ => LogLevel::None,
        };
    }
    LogLevel::None
}

fn looks_like_timestamp(token: &str) -> bool {
    let token = token
        .trim_matches(|character: char| matches!(character, '[' | ']' | '(' | ')' | ',' | '|'));
    if token.len() < 5 {
        return false;
    }
    token.contains(':')
        || token.contains('-')
        || token.contains('/')
        || token.bytes().all(|byte| byte.is_ascii_digit())
}

/// One bounded scan of a complete range, used by tests and by the first page.
pub fn scan_block(bytes: &[u8], start_offset: u64) -> Result<Vec<LogRecord>, ViewerError> {
    let mut scanner = LogScanner::new(start_offset);
    let mut records = scanner.feed(bytes)?;
    if let Some(last) = scanner.finish() {
        records.push(last);
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_split_utf8_e_is_retained() {
        let mut scanner = LogScanner::new(0);
        let bytes = "é\n".as_bytes();
        let first = scanner.feed(&bytes[..1]).unwrap();
        assert!(first.is_empty());
        let second = scanner.feed(&bytes[1..]).unwrap();
        assert_eq!(second[0].text, "é");
    }

    #[test]
    fn a_seventy_kib_line_is_explicitly_truncated() {
        let line = "a".repeat(70 * 1024);
        let records = scan_block(format!("{line}\n").as_bytes(), 0).unwrap();
        assert_eq!(records[0].text.chars().count(), MAX_LOG_LINE_CHARS);
        assert!(records[0].truncated);
    }

    #[test]
    fn appending_returns_only_the_new_range() {
        let mut scanner = LogScanner::new(0);
        let first = scanner.feed(b"one\ntwo\n").unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[1].byte_offset, "4");
        let appended = scanner.feed(b"three\n").unwrap();
        assert_eq!(appended.len(), 1);
        assert_eq!(appended[0].text, "three");
        assert_eq!(appended[0].byte_offset, "8");
    }

    #[test]
    fn levels_follow_the_first_token_and_warning_is_warn() {
        assert_eq!(
            detect_level("2026-01-02T03:04:05Z INFO started"),
            LogLevel::Info
        );
        assert_eq!(detect_level("[WARNING] careful"), LogLevel::Warn);
        assert_eq!(detect_level("plain words"), LogLevel::None);
        assert_eq!(detect_level("ERROR boom"), LogLevel::Error);
    }

    #[test]
    fn ansi_sequences_do_not_reach_the_text() {
        let records = scan_block(b"\x1b[31mred\x1b[0m\n", 0).unwrap();
        assert_eq!(records[0].text, "red");
    }

    #[test]
    fn utf16_lines_split_on_two_byte_newlines() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "hi\nbye\n".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let records = scan_block(&bytes, 0).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].text, "hi");
        assert_eq!(records[1].text, "bye");
    }
}
