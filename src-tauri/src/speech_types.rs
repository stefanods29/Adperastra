//! Canonical speech wire types (Step 17b, revision `speech-1`).
//! TypeScript mirror: `src/services/speechTypes.ts`.
#![allow(dead_code)]


use ai_runtime::AiInputRef;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type TimeUs = u64;

pub const WHISPER_TICK_US: u64 = 10_000;
pub const PAGE_SEGMENTS: usize = 200;
pub const PAGE_BYTES: usize = 128 * 1024;
pub const MAX_SEGMENTS: u32 = 100_000;
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_TRANSCRIPT_SECONDS: u64 = 3_600;
pub const MAX_TRANSCRIPT_US: u64 = MAX_TRANSCRIPT_SECONDS * 1_000_000;
pub const CAPTION_WINDOW_SECONDS: u64 = 30;
pub const CAPTION_OVERLAP_SECONDS: u64 = 1;
pub const MAX_RETAINED_TRANSCRIPTS: usize = 16;
pub const TRANSCRIPT_MEMORY_BUDGET: u64 = 64 * 1024 * 1024;
pub const SENSITIVE_MEMORY_BUDGET: u64 = 4 * 1024 * 1024;
pub const DICTATION_MAX_SECONDS: u16 = 120;
pub const SAMPLE_RATE: u32 = 16_000;
pub const DICTATION_MAX_FLOAT_BYTES: u64 = 120 * 16_000 * 4;

pub const ERR_INVALID: &str = "speech.invalid";
pub const ERR_PACK_MISSING: &str = "speech.pack_missing";
pub const ERR_PERMISSION: &str = "speech.permission_denied";
pub const ERR_DEVICE: &str = "speech.device_unavailable";
pub const ERR_TOO_LONG: &str = "speech.too_long";
pub const ERR_EXPIRED: &str = "speech.expired";
pub const ERR_CHANGED: &str = "speech.changed";
pub const ERR_FAILED: &str = "speech.failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechLanguage {
    Auto,
    En,
    Es,
}

impl SpeechLanguage {
    pub fn tag(self) -> &'static str {
        match self {
            SpeechLanguage::Auto => "auto",
            SpeechLanguage::En => "en",
            SpeechLanguage::Es => "es",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptionRequest {
    pub input: AiInputRef,
    pub language: SpeechLanguage,
    /// Fixed false; a true value is refused, never silently translated.
    pub translate_to_english: bool,
    pub start_us: TimeUs,
    pub end_us: Option<TimeUs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptInfo {
    pub id: Uuid,
    pub source_input_id: Uuid,
    pub source_revision: u64,
    pub language: String,
    pub duration_us: TimeUs,
    pub segment_count: u32,
    pub partial: bool,
    pub model_id: String,
    pub model_revision: String,
    pub expires_unix: u64,
}

/// `speaker_id` is always null: this step never guesses speakers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptSegment {
    pub id: Uuid,
    pub index: u32,
    pub start_us: TimeUs,
    pub end_us: TimeUs,
    pub text: String,
    pub confidence: Option<f64>,
    pub speaker_id: Option<()>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptPage {
    pub transcript_id: Uuid,
    pub segments: Vec<TranscriptSegment>,
    pub next_index: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DictationRequest {
    pub document_id: Uuid,
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub language: String,
    pub max_seconds: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DictationState {
    Recording,
    Processing,
    Stopped,
}

/// No PCM bytes are ever part of a session answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DictationSession {
    pub id: Uuid,
    pub document_id: Uuid,
    pub expected_revision: u64,
    pub expected_content_id: Uuid,
    pub state: DictationState,
    pub started_unix: u64,
}

/// Whisper centisecond ticks -> integer microseconds with checked math.
pub fn whisper_ticks_to_us(ticks: u64) -> Result<TimeUs, String> {
    ticks
        .checked_mul(WHISPER_TICK_US)
        .ok_or_else(|| ERR_INVALID.to_string())
}

/// The end time is exclusive and always after the start.
pub fn segment_is_valid(start_us: TimeUs, end_us: TimeUs) -> bool {
    end_us > start_us
}

pub fn validate_request(request: &TranscriptionRequest) -> Result<(), String> {
    if request.translate_to_english {
        return Err(ERR_INVALID.to_string());
    }
    if request.input.expected_revision < 1 {
        return Err(ERR_INVALID.to_string());
    }
    match request.end_us {
        None => {
            if request.start_us > MAX_TRANSCRIPT_US {
                return Err(ERR_TOO_LONG.to_string());
            }
        }
        Some(end) => {
            if !segment_is_valid(request.start_us, end) {
                return Err(ERR_INVALID.to_string());
            }
            if end - request.start_us > MAX_TRANSCRIPT_US {
                return Err(ERR_TOO_LONG.to_string());
            }
        }
    }
    Ok(())
}

pub fn validate_dictation(request: &DictationRequest) -> Result<(), String> {
    if request.expected_revision < 1 {
        return Err(ERR_INVALID.to_string());
    }
    if request.language != "en" && request.language != "es" {
        return Err(ERR_INVALID.to_string());
    }
    if request.max_seconds < 1 || request.max_seconds > DICTATION_MAX_SECONDS {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

/// NFC over the Latin-1 range these two languages need, without a new
/// dependency; combining marks outside that range stay as supplied.
pub fn normalize_nfc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(current) = characters.next() {
        let Some(next) = characters.peek().copied() else {
            out.push(current);
            break;
        };
        let combined = match (current, next) {
            ('a', '\u{0301}') => Some('á'),
            ('e', '\u{0301}') => Some('é'),
            ('i', '\u{0301}') => Some('í'),
            ('o', '\u{0301}') => Some('ó'),
            ('u', '\u{0301}') => Some('ú'),
            ('n', '\u{0303}') => Some('ñ'),
            ('u', '\u{0308}') => Some('ü'),
            ('A', '\u{0301}') => Some('Á'),
            ('E', '\u{0301}') => Some('É'),
            ('I', '\u{0301}') => Some('Í'),
            ('O', '\u{0301}') => Some('Ó'),
            ('U', '\u{0301}') => Some('Ú'),
            ('N', '\u{0303}') => Some('Ñ'),
            ('U', '\u{0308}') => Some('Ü'),
            _ => None,
        };
        if let Some(combined) = combined {
            out.push(combined);
            characters.next();
        } else {
            out.push(current);
        }
    }
    out
}

/// Escapes the five markup characters; no HTML is ever produced.
pub fn escape_text(text: &str) -> String {
    normalize_nfc(text)
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn text_bytes(segments: &[TranscriptSegment]) -> usize {
    segments.iter().map(|segment| segment.text.len()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_convert_exactly() {
        assert_eq!(whisper_ticks_to_us(123).unwrap(), 1_230_000);
        assert_eq!(whisper_ticks_to_us(0).unwrap(), 0);
    }

    #[test]
    fn nfc_composes_latin1_marks() {
        assert_eq!(normalize_nfc("Presupuesto a\u{0301}cido"), "Presupuesto ácido");
        assert_eq!(normalize_nfc("Adio\u{0301}s"), "Adiós");
    }

    #[test]
    fn escaped_markup_is_literal() {
        assert_eq!(escape_text("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
    }
}
