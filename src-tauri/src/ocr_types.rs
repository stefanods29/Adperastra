#![allow(dead_code)] // Public producer API; consumed from later steps.
//! OCR wire types (Step 07e, interface `ocr-1`).
//!
//! These are the canonical Rust definitions; `src/services/ocr.ts` mirrors
//! them field for field with the same snake_case names. Recognition itself
//! runs in `--ocr-helper` (plan/rules.md R-SEC-9); nothing here opens a file.
//!
//! Coordinate note (step-07e data table vs. export E2): `OcrWord` boxes are
//! in pixels of the recognised raster (`recognized_width`/`height`). Export
//! E2 `ocrBoxToSource` scales them to the oriented original image. The two
//! statements only agree under that reading; the alternative (boxes already
//! in original pixels) would make E2 an identity function.

use serde::{Deserialize, Serialize};

use crate::pdf_types::PdfSourceIdentity;

/// Longest absolute image path, in UTF-16 units (same as the file wire).
pub const MAX_OCR_PATH_UNITS: usize = 32_768;
/// Longest BCP47 language tag accepted from the UI or the settings file.
pub const MAX_OCR_LANGUAGE_TAG: usize = 64;
/// Longest Windows-provided language name.
pub const MAX_OCR_LANGUAGE_NAME: usize = 128;
/// Most installed recogniser languages one answer carries.
pub const MAX_OCR_LANGUAGES: usize = 128;
/// Longest single recognised word, in Unicode scalar values.
pub const MAX_OCR_WORD_CHARS: usize = 4_096;
/// Most recognised words one page may keep.
pub const MAX_OCR_WORDS: usize = 20_000;
/// Most recognised characters one page may keep (including separators).
pub const MAX_OCR_TEXT_CHARS: usize = 500_000;
/// Largest serialized chunk `ocr_page` (or a job result) may return.
pub const MAX_OCR_CHUNK_BYTES: usize = 768 * 1024;
/// Largest ordinary-disk JSON blob the OCR cache accepts.
pub const MAX_OCR_CACHE_BLOB: u64 = 4 * 1024 * 1024;
/// Most consumers the service retains at once.
pub const MAX_OCR_CONSUMERS: usize = 64;
/// Most recognised pages kept in memory at once.
pub const MAX_OCR_RETAINED: usize = 16;
/// A retained page nobody touched for this long is dropped.
pub const OCR_RETAIN_SECONDS: u64 = 30 * 60;
/// Cache provider identity (plan D5).
pub const OCR_PROVIDER_ID: &str = "windows-ocr";
/// Cache provider version (plan D5).
pub const OCR_PROVIDER_VERSION: u32 = 1;
/// Cache option schema baked into every options key (plan D5).
pub const OCR_CACHE_SCHEMA: u32 = 1;
/// Longest edge Windows OCR is asked to process (plan D4).
pub const OCR_MAX_EDGE: u32 = 4_096;
/// Largest prepared pixel product accepted for one OCR page.
pub const MAX_OCR_PIXELS: u64 = 16_777_216;
/// Most pixels Windows OCR is asked to process (plan D4).
pub const OCR_MAX_PIXELS: u64 = 16_777_216;
/// The render bucket the PDF adapter asks for (plan check-by-hand note).
pub const OCR_PDF_RENDER_EDGE: u16 = 2_048;
/// One helper process may use this much memory (plan D1).
pub const OCR_HELPER_MEMORY_LIMIT: usize = 512 * 1024 * 1024;
/// The helper must answer within this wall time (plan D1).
pub const OCR_HELPER_TIMEOUT_SECONDS: u64 = 30;
/// A cancelled helper is killed after this grace period (plan D1).
pub const OCR_CANCEL_GRACE_MS: u64 = 250;

pub const ERR_BAD_REQUEST: &str = "ocr.bad_request";
pub const ERR_LANGUAGE_MISSING: &str = "ocr.language_missing";
pub const ERR_CHANGED: &str = "ocr.changed";
pub const ERR_TOO_LARGE: &str = "ocr.too_large";
pub const ERR_FAILED: &str = "ocr.failed";
pub const ERR_ONLINE_ONLY: &str = "ocr.online_only";
/// Internal only: the UI ignores the rejection after its own cancel. It is
/// never shown; `errorText` would fall back to `errors.ocr.other`.
pub const ERR_CANCELLED: &str = "ocr.cancelled";

/// One recognition language Windows offers (`OcrEngine.AvailableRecognizerLanguages`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcrLanguage {
    /// Validated BCP47 tag, for example `en-US`.
    pub tag: String,
    /// Windows' own display name; data, never a hard-coded list.
    pub name: String,
    pub available: bool,
}

/// What to recognise: one local image, or one page of an open PDF session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OcrInput {
    /// Absolute path of a local image; revalidated in Rust.
    Image { path: String },
    /// The UI can never supply a raster or output path for a PDF.
    Pdf { session_id: String, page: u32 },
}

/// One recognised word, in pixels of the recognised raster (export E2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrWord {
    /// Escaped plain text; never markup, a path or a command (plan D8).
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Reading-order line number, starting at 0.
    pub line: u32,
    /// Global reading order, starting at 0 and unique within the page.
    pub order: u32,
}

/// One bounded page of recognised text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrPage {
    /// Disk stamp for images, the 07d tagged identity for PDF pages.
    pub source: PdfSourceIdentity,
    pub page: u32,
    pub language: String,
    /// Orientation-corrected original dimensions before downscaling.
    pub original_width: u32,
    pub original_height: u32,
    /// Dimensions of the raster Windows actually recognised.
    pub recognized_width: u32,
    pub recognized_height: u32,
    pub words: Vec<OcrWord>,
    /// Reading-order page text; chunks concatenate to exactly this value.
    pub text: String,
    /// True when a limit or a bounded source stopped recognition early.
    pub partial: bool,
    /// `order` of the first word in the next chunk, or null at the end.
    #[serde(default)]
    pub next_word: Option<u32>,
    /// The rotation recorded for this page (0/90/180/270).
    pub rotation: u16,
    #[serde(default)]
    pub text_angle: Option<f64>,
}

/// A recognition request from the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcrRequest {
    pub input: OcrInput,
    /// `auto` or an exact installed tag; resolved before any cache lookup.
    pub language: String,
    /// UUID that names this page in `ocr_page` / `ocr_release`.
    pub consumer_id: String,
    pub rotation: u16,
    pub request_revision: u32,
}

/// Schema 14's OCR section. It lives here and is added to `Settings` by the
/// coordinator (plan D2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcrSettings {
    /// `auto` or an installed BCP47 tag.
    #[serde(default = "default_ocr_language")]
    pub language: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_ocr_language() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for OcrSettings {
    fn default() -> Self {
        Self {
            language: default_ocr_language(),
            enabled: true,
        }
    }
}

impl OcrSettings {
    /// The installed selection is checked when recognition runs, never by a
    /// destructive startup reset (plan D2).
    pub fn validate(&self) -> Result<(), String> {
        validate_language_preference(&self.language)
    }
}

/// A BCP47-shaped tag: 1-8 ASCII letters, then 1-8 alphanumeric subtags,
/// separated by one hyphen, at most 64 characters. `x-` private tags are
/// accepted because Windows may report them; no locale is guessed.
pub fn is_valid_language_tag(tag: &str) -> bool {
    if tag.is_empty() || tag.len() > MAX_OCR_LANGUAGE_TAG || !tag.is_ascii() {
        return false;
    }
    let mut parts = tag.split('-');
    let Some(primary) = parts.next() else {
        return false;
    };
    if primary.is_empty()
        || primary.len() > 8
        || !primary.bytes().all(|byte| byte.is_ascii_alphabetic())
    {
        return false;
    }
    for part in parts {
        if part.is_empty()
            || part.len() > 8
            || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return false;
        }
    }
    true
}

/// `auto` or a validated tag. Anything else is a bad request.
pub fn validate_language_preference(value: &str) -> Result<(), String> {
    if value == "auto" || is_valid_language_tag(value) {
        Ok(())
    } else {
        Err(ERR_BAD_REQUEST.to_string())
    }
}

/// Validate every UI-supplied field before a job starts.
pub fn validate_ocr_request(request: &OcrRequest) -> Result<(), String> {
    validate_language_preference(&request.language)?;
    if uuid::Uuid::try_parse(&request.consumer_id).is_err() {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    if !matches!(request.rotation, 0 | 90 | 180 | 270) {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    match &request.input {
        OcrInput::Image { path } => {
            if path.is_empty() || path.encode_utf16().count() > MAX_OCR_PATH_UNITS {
                return Err(ERR_BAD_REQUEST.to_string());
            }
            crate::validate_absolute_path(path).map_err(|_| ERR_BAD_REQUEST.to_string())?;
        }
        OcrInput::Pdf { session_id, page } => {
            if uuid::Uuid::try_parse(session_id).is_err() || !(1..=10_000).contains(page) {
                return Err(ERR_BAD_REQUEST.to_string());
            }
        }
    }
    Ok(())
}

fn validate_source_identity(source: &PdfSourceIdentity) -> Result<(), String> {
    match source {
        PdfSourceIdentity::Disk { stamp } => {
            stamp.validate().map_err(|_| ERR_BAD_REQUEST.to_string())
        }
        PdfSourceIdentity::Snapshot {
            document_id,
            content_id,
            ..
        } => {
            if document_id.is_empty() || document_id.len() > 128 {
                return Err(ERR_BAD_REQUEST.to_string());
            }
            if content_id.is_nil() {
                return Err(ERR_BAD_REQUEST.to_string());
            }
            Ok(())
        }
    }
}

/// Check a page read from the helper before it reaches the UI or the cache.
pub fn validate_ocr_page(page: &OcrPage) -> Result<(), String> {
    if page.page == 0
        || page.page > 10_000
        || !is_valid_language_tag(&page.language)
        || page.original_width == 0
        || page.original_height == 0
        || page.recognized_width == 0
        || page.recognized_height == 0
        || !matches!(page.rotation, 0 | 90 | 180 | 270)
        || page.words.len() > MAX_OCR_WORDS
        || page.text.chars().count() > MAX_OCR_TEXT_CHARS
    {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    validate_source_identity(&page.source)?;
    for word in &page.words {
        if word.text.chars().count() > MAX_OCR_WORD_CHARS
            || !word.x.is_finite()
            || !word.y.is_finite()
            || !word.width.is_finite()
            || !word.height.is_finite()
            || word.x < 0.0
            || word.y < 0.0
            || word.width < 0.0
            || word.height < 0.0
        {
            return Err(ERR_BAD_REQUEST.to_string());
        }
    }
    if let Some(angle) = page.text_angle {
        if !angle.is_finite() {
            return Err(ERR_BAD_REQUEST.to_string());
        }
    }
    Ok(())
}

/// The reading order used everywhere: line first, then the word order.
pub fn ordered_words(page: &OcrPage) -> Vec<OcrWord> {
    let mut words = page.words.clone();
    words.sort_by_key(|word| (word.line, word.order));
    words
}

/// The exact page text of an ordered word list (lines joined by `\n`,
/// words within a line by one space).
pub fn reading_text(words: &[OcrWord]) -> String {
    let mut text = String::new();
    let mut current_line: Option<u32> = None;
    for word in words {
        if current_line == Some(word.line) {
            text.push(' ');
        } else {
            if current_line.is_some() {
                text.push('\n');
            }
            current_line = Some(word.line);
        }
        text.push_str(&word.text);
    }
    text
}

/// Byte offsets where each ordered word starts in `reading_text`.
fn word_offsets(words: &[OcrWord]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(words.len());
    let mut position = 0usize;
    let mut current_line: Option<u32> = None;
    for word in words {
        if current_line == Some(word.line) {
            position += 1;
        } else {
            if current_line.is_some() {
                position += 1;
            }
            current_line = Some(word.line);
        }
        offsets.push(position);
        position += word.text.len();
    }
    offsets
}

/// The chunk at `after_word`, at most `MAX_OCR_CHUNK_BYTES` serialized.
///
/// The chunk's `text` is the exact substring of the full page text, so a
/// client that concatenates the chunk texts of `next_word` gets the page
/// text back byte for byte (used by "Copy all text").
pub fn page_chunk(page: &OcrPage, after_word: Option<u32>) -> Result<OcrPage, String> {
    let ordered = ordered_words(page);
    let full_text = reading_text(&ordered);
    let offsets = word_offsets(&ordered);
    let start = match after_word {
        None => 0,
        Some(order) => ordered
            .iter()
            .position(|word| word.order >= order)
            .unwrap_or(ordered.len()),
    };
    let empty_chunk = || OcrPage {
        source: page.source.clone(),
        page: page.page,
        language: page.language.clone(),
        original_width: page.original_width,
        original_height: page.original_height,
        recognized_width: page.recognized_width,
        recognized_height: page.recognized_height,
        words: Vec::new(),
        text: String::new(),
        partial: page.partial,
        next_word: None,
        rotation: page.rotation,
        text_angle: page.text_angle,
    };
    if start >= ordered.len() {
        if after_word.is_some() {
            // A cursor past the last word is not a valid continuation.
            return Err(ERR_BAD_REQUEST.to_string());
        }
        return Ok(empty_chunk());
    }

    // Reserve room for the envelope; each word costs its text plus fields.
    let mut take = start;
    let mut estimate = 256usize;
    while take < ordered.len() {
        let word_cost = ordered[take].text.len().saturating_add(96);
        if take > start && estimate + word_cost > MAX_OCR_CHUNK_BYTES - 8_192 {
            break;
        }
        estimate += word_cost;
        take += 1;
    }
    if take == start {
        take += 1;
    }

    let mut chunk = empty_chunk();
    loop {
        chunk.words = ordered[start..take].to_vec();
        let end = if take < ordered.len() {
            offsets[take]
        } else {
            full_text.len()
        };
        chunk.text = full_text[offsets[start]..end].to_string();
        chunk.next_word = if take < ordered.len() {
            Some(ordered[take].order)
        } else {
            None
        };
        let size = serde_json::to_vec(&chunk)
            .map_err(|_| ERR_BAD_REQUEST.to_string())?
            .len();
        if size <= MAX_OCR_CHUNK_BYTES || take - start <= 1 {
            break;
        }
        take -= 1;
    }
    Ok(chunk)
}

#[cfg(test)]
mod tests {
    use super::{is_valid_language_tag, page_chunk, reading_text, OcrWord, MAX_OCR_CHUNK_BYTES};

    fn word(text: &str, line: u32, order: u32) -> OcrWord {
        OcrWord {
            text: text.to_string(),
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            line,
            order,
        }
    }

    #[test]
    fn tags_are_bcp47_shaped() {
        assert!(is_valid_language_tag("en"));
        assert!(is_valid_language_tag("en-US"));
        assert!(is_valid_language_tag("es-419"));
        assert!(is_valid_language_tag("zh-Hant-TW"));
        assert!(!is_valid_language_tag(""));
        assert!(!is_valid_language_tag("en--US"));
        assert!(!is_valid_language_tag("en_US"));
        assert!(!is_valid_language_tag("en-"));
        assert!(!is_valid_language_tag(&"a".repeat(65)));
    }

    #[test]
    fn text_is_lines_and_spaces() {
        let words = [word("Hello", 0, 0), word("123", 0, 1), word("next", 1, 2)];
        assert_eq!(reading_text(&words), "Hello 123\nnext");
    }

    #[test]
    fn chunks_concatenate_to_the_page_text() {
        let words: Vec<OcrWord> = (0..600)
            .map(|index| word(&format!("word{index}"), index / 10, index))
            .collect();
        let page = super::OcrPage {
            source: crate::pdf_types::PdfSourceIdentity::Disk {
                stamp: crate::ocr_step07e_tests::test_stamp(),
            },
            page: 1,
            language: "en-US".to_string(),
            original_width: 1,
            original_height: 1,
            recognized_width: 1,
            recognized_height: 1,
            words: words.clone(),
            text: reading_text(&words),
            partial: false,
            next_word: None,
            rotation: 0,
            text_angle: None,
        };
        let mut collected = String::new();
        let mut cursor = None;
        let mut rounds = 0;
        loop {
            let chunk = page_chunk(&page, cursor).unwrap();
            assert!(serde_json::to_vec(&chunk).unwrap().len() <= MAX_OCR_CHUNK_BYTES);
            collected.push_str(&chunk.text);
            rounds += 1;
            match chunk.next_word {
                Some(next) => cursor = Some(next),
                None => break,
            }
            assert!(rounds < 1_000);
        }
        assert_eq!(collected, page.text);
    }
}
