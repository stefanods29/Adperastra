//! SRT and WebVTT subtitles (Step 07f algorithm 4): bounded parsing, exact
//! millisecond times, active markup removed, malformed blocks counted and
//! skipped. Opening a subtitle never plays or changes a video.

use serde::{Deserialize, Serialize};

use crate::decode::decode_text;
use crate::viewer_error::ViewerError;

/// The largest subtitle source accepted.
pub const MAX_SUBTITLE_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
/// The most cues one file may contain.
pub const MAX_SUBTITLE_CUES: usize = 200_000;
/// The most characters one cue carries.
pub const MAX_CUE_CHARS: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleCue {
    /// The cue's original 0-based position, so a highlight stays stable when
    /// the file is filtered or sorted.
    pub index: u32,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct SubtitleDoc {
    pub cues: Vec<SubtitleCue>,
    pub invalid: u32,
    pub partial: bool,
}

impl SubtitleDoc {
    pub fn page(&self, start: usize, max_records: usize) -> SubtitlePage {
        let end = start.saturating_add(max_records).min(self.cues.len());
        let cues = if start < end {
            self.cues[start..end].to_vec()
        } else {
            Vec::new()
        };
        SubtitlePage {
            cues,
            next_index: if end < self.cues.len() {
                Some(end)
            } else {
                None
            },
            partial: self.partial,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SubtitlePage {
    pub cues: Vec<SubtitleCue>,
    pub next_index: Option<usize>,
    pub partial: bool,
}

/// Parse one SRT or WebVTT file. `WEBVTT` selects VTT; otherwise SRT rules
/// apply. A malformed block never stops the rest of the file.
pub fn parse_subtitles(bytes: &[u8]) -> Result<SubtitleDoc, ViewerError> {
    if bytes.len() as u64 > MAX_SUBTITLE_SOURCE_BYTES {
        return Err(ViewerError::TooLarge);
    }
    let (text, _) = decode_text(bytes);
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let is_vtt = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_uppercase()
        .starts_with("WEBVTT");
    let mut cues: Vec<SubtitleCue> = Vec::new();
    let mut invalid = 0u32;
    let mut partial = false;
    let mut block: Vec<&str> = Vec::new();
    let mut original = 0u32;
    for line in text.lines() {
        if line.trim().is_empty() {
            if !block.is_empty() {
                parse_block(
                    &block,
                    original,
                    is_vtt,
                    &mut cues,
                    &mut invalid,
                    &mut partial,
                )?;
                block.clear();
            }
            continue;
        }
        if block.is_empty() && is_vtt && is_vtt_control(line) {
            continue;
        }
        block.push(line);
        if block.len() > 64 {
            // A cue never needs more than 64 lines; the rest is ignored and
            // reported instead of growing without a bound.
            partial = true;
            block.clear();
            original = original.saturating_add(1);
        }
    }
    if !block.is_empty() {
        parse_block(
            &block,
            original,
            is_vtt,
            &mut cues,
            &mut invalid,
            &mut partial,
        )?;
    }
    if cues.len() > MAX_SUBTITLE_CUES {
        return Err(ViewerError::TooLarge);
    }
    cues.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.index.cmp(&right.index))
    });
    Ok(SubtitleDoc {
        cues,
        invalid,
        partial: partial || invalid > 0,
    })
}

fn is_vtt_control(line: &str) -> bool {
    let upper = line.trim_start().to_ascii_uppercase();
    upper.starts_with("WEBVTT")
        || upper.starts_with("NOTE")
        || upper.starts_with("STYLE")
        || upper.starts_with("REGION")
        || upper.starts_with("X-TIMESTAMP-MAP")
}

fn parse_block(
    block: &[&str],
    original: u32,
    is_vtt: bool,
    cues: &mut Vec<SubtitleCue>,
    invalid: &mut u32,
    partial: &mut bool,
) -> Result<u32, ViewerError> {
    if block.is_empty() {
        return Ok(original);
    }
    let mut timing_line = 0usize;
    if !block[0].contains("-->") {
        // SRT numeric identifier or VTT cue identifier.
        timing_line = 1;
    }
    let Some(line) = block.get(timing_line) else {
        *invalid += 1;
        return Ok(original.saturating_add(1));
    };
    let Some((start, end)) = parse_timing_line(line, is_vtt) else {
        *invalid += 1;
        return Ok(original.saturating_add(1));
    };
    if end < start {
        *invalid += 1;
        return Ok(original.saturating_add(1));
    }
    let text = block[timing_line + 1..].join("\n");
    let text = strip_active_markup(&text);
    if text.trim().is_empty() {
        *invalid += 1;
        return Ok(original.saturating_add(1));
    }
    let (text, cut) = crate::ansi::truncate_chars(&text, MAX_CUE_CHARS);
    if cut {
        *partial = true;
    }
    cues.push(SubtitleCue {
        index: original,
        start_ms: start,
        end_ms: end,
        text,
    });
    if cues.len() > MAX_SUBTITLE_CUES {
        return Err(ViewerError::TooLarge);
    }
    Ok(original.saturating_add(1))
}

fn parse_timing_line(line: &str, is_vtt: bool) -> Option<(u64, u64)> {
    let (left, right) = line.split_once("-->")?;
    let left = left.trim();
    let right = right.trim();
    let end_part = right.split_whitespace().next().unwrap_or(right);
    Some((
        parse_timestamp(left, is_vtt)?,
        parse_timestamp(end_part, is_vtt)?,
    ))
}

/// `HH:MM:SS,mmm` for SRT, `HH:MM:SS.mmm` or `MM:SS.mmm` for VTT.
pub fn parse_timestamp(text: &str, is_vtt: bool) -> Option<u64> {
    let (clock, millis) = if is_vtt {
        text.rsplit_once('.')?
    } else {
        text.rsplit_once(',')?
    };
    if millis.len() != 3 || !millis.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let millis: u64 = millis.parse().ok()?;
    if millis > 999 {
        return None;
    }
    let parts: Vec<&str> = clock.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [hours, minutes, seconds] => {
            if hours.len() > 3 {
                return None;
            }
            (hours.parse::<u64>().ok()?, *minutes, *seconds)
        }
        [minutes, seconds] if is_vtt => (0, *minutes, *seconds),
        _ => return None,
    };
    if minutes.len() != 2 || seconds.len() != 2 {
        return None;
    }
    let minutes: u64 = minutes.parse().ok()?;
    let seconds: u64 = seconds.parse().ok()?;
    if minutes > 59 || seconds > 59 {
        return None;
    }
    Some(((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis)
}

/// Remove subtitle markup (`<i>`, `<c.class>`, `<v Name>`, `{\an8}`) and
/// keep the words and line breaks. Timestamps or HTML are never executed.
pub fn strip_active_markup(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '<' {
            let mut consumed = false;
            for value in chars.by_ref() {
                if value == '>' {
                    consumed = true;
                    break;
                }
            }
            if !consumed {
                break;
            }
            continue;
        }
        if character == '{' {
            let mut sequence = String::new();
            let mut closed = false;
            for value in chars.by_ref() {
                if value == '}' {
                    closed = true;
                    break;
                }
                sequence.push(value);
                if sequence.len() > 32 {
                    break;
                }
            }
            if closed && sequence.starts_with('\\') {
                continue;
            }
            output.push('{');
            output.push_str(&sequence);
            if closed {
                output.push('}');
            }
            continue;
        }
        output.push(character);
    }
    output.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_one_and_a_quarter_to_two_and_a_half_seconds() {
        let doc = parse_subtitles(b"1\r\n00:00:01,250 --> 00:00:02,500\r\nHello\r\n\r\n").unwrap();
        assert_eq!(doc.cues.len(), 1);
        assert_eq!(doc.cues[0].start_ms, 1_250);
        assert_eq!(doc.cues[0].end_ms, 2_500);
        assert_eq!(doc.cues[0].text, "Hello");
    }

    #[test]
    fn seconds_59_is_valid_and_60_is_invalid() {
        assert_eq!(parse_timestamp("00:00:59,000", false), Some(59_000));
        assert_eq!(parse_timestamp("00:00:60,000", false), None);
        assert_eq!(parse_timestamp("00:60:00,000", false), None);
    }

    #[test]
    fn vtt_accepts_minutes_only() {
        assert_eq!(parse_timestamp("01:02.500", true), Some(62_500));
        assert_eq!(parse_timestamp("01:02.500", false), None);
    }

    #[test]
    fn malformed_blocks_are_counted_and_skipped() {
        let doc = parse_subtitles(
            b"1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\nnot a time\nBad\n\n3\n00:00:03,000 --> 00:00:04,000\nAlso good\n",
        )
        .unwrap();
        assert_eq!(doc.cues.len(), 2);
        assert_eq!(doc.invalid, 1);
    }

    #[test]
    fn active_markup_is_removed() {
        assert_eq!(
            strip_active_markup("<i>Hi</i> <c.yellow>there</c> {\\an8}"),
            "Hi there"
        );
    }

    #[test]
    fn vtt_header_and_note_are_not_cues() {
        let doc =
            parse_subtitles(b"WEBVTT\n\nNOTE a comment\n\n00:00:01.000 --> 00:00:02.000\nHi\n")
                .unwrap();
        assert_eq!(doc.cues.len(), 1);
    }
}
