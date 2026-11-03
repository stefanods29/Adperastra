#![allow(dead_code)] // Public producer API; consumed from later steps.
//! Windows.Media.Ocr behind the OCR helper (Step 07e plan D1/D4).
//!
//! Verified against the pinned windows 0.61.3 sources:
//! `OcrEngine.AvailableRecognizerLanguages/TryCreateFromLanguage/
//! TryCreateFromUserProfileLanguages/RecognizeAsync/MaxImageDimension`,
//! `OcrResult.Lines/TextAngle`, `OcrLine.Words`, `OcrWord.BoundingRect/Text`,
//! `Language.CreateLanguage`, `SoftwareBitmap.CreateCopyFromBuffer` and
//! `SoftwareBitmap.ConvertWithAlpha`.
//!
//! Only the `--ocr-helper` process calls into this module. The app process
//! never initialises WinRT OCR (plan E4).

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

use fs_service::CancellationToken;

use crate::ocr_languages::{normalize_languages, OcrLanguagesReply};
use crate::ocr_pixels::PreparedPixels;
use crate::ocr_types::{
    reading_text, OcrLanguage, OcrPage, OcrWord, ERR_CANCELLED, ERR_FAILED, ERR_LANGUAGE_MISSING,
    ERR_TOO_LARGE, MAX_OCR_TEXT_CHARS, MAX_OCR_WORDS, MAX_OCR_WORD_CHARS,
};

/// How often the helper checks a pending `RecognizeAsync`.
const STATUS_POLL: Duration = Duration::from_millis(25);

/// WinRT apartment guard for the helper thread. Balanced on every return.
struct WinRt;

impl WinRt {
    fn enter() -> Result<Self, String> {
        // SAFETY: this is the helper's own thread, it initialises the MTA
        // once, and the guard calls RoUninitialize on the same thread.
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).map_err(|_| ERR_FAILED.to_string())?;
        }
        Ok(Self)
    }
}

impl Drop for WinRt {
    fn drop(&mut self) {
        // SAFETY: pairs with the successful RoInitialize in enter().
        unsafe {
            RoUninitialize();
        }
    }
}

/// One word as Windows reported it, before the reading-order assembly.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWord {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One OCR line as Windows reported it.
#[derive(Debug, Clone, PartialEq)]
pub struct RawLine {
    pub words: Vec<RawWord>,
}

/// The bounded recognition result before the source identity is attached.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrPayload {
    pub language: String,
    /// Orientation-corrected original dimensions, set by the helper.
    #[serde(default)]
    pub original_width: u32,
    #[serde(default)]
    pub original_height: u32,
    pub recognized_width: u32,
    pub recognized_height: u32,
    pub words: Vec<OcrWord>,
    pub text: String,
    pub partial: bool,
    #[serde(default)]
    pub text_angle: Option<f64>,
}

impl OcrPayload {
    /// Attach the identity and the display rotation the caller validated.
    pub fn into_page(
        self,
        source: crate::pdf_types::PdfSourceIdentity,
        page: u32,
        rotation: u16,
    ) -> OcrPage {
        OcrPage {
            source,
            page,
            language: self.language,
            original_width: if self.original_width == 0 {
                self.recognized_width
            } else {
                self.original_width
            },
            original_height: if self.original_height == 0 {
                self.recognized_height
            } else {
                self.original_height
            },
            recognized_width: self.recognized_width,
            recognized_height: self.recognized_height,
            words: self.words,
            text: self.text,
            partial: self.partial,
            next_word: None,
            rotation,
            text_angle: self.text_angle,
        }
    }
}

fn clamp_coordinate(value: f64, limit: u32) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    Some(value.clamp(0.0, f64::from(limit)))
}

/// Build the bounded page payload from Windows' lines.
///
/// Words are kept in reading order. The word cap, the character cap and the
/// per-word cap stop the page early and set `partial`, exactly as plan D5
/// requires; nothing is silently presented as complete.
pub fn assemble_payload(
    lines: &[RawLine],
    language: &str,
    recognized_width: u32,
    recognized_height: u32,
    text_angle: Option<f64>,
) -> OcrPayload {
    let mut words: Vec<OcrWord> = Vec::new();
    let mut chars = 0usize;
    let mut partial = false;
    'lines: for (line_index, line) in lines.iter().enumerate() {
        let line_number = line_index as u32;
        for raw in &line.words {
            if words.len() >= MAX_OCR_WORDS {
                partial = true;
                break 'lines;
            }
            let mut text = raw.text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            if text.chars().count() > MAX_OCR_WORD_CHARS {
                text = text.chars().take(MAX_OCR_WORD_CHARS).collect();
                partial = true;
            }
            // A separator before every word except the first of the page.
            let cost = text.chars().count() + usize::from(chars > 0);
            if chars + cost > MAX_OCR_TEXT_CHARS {
                partial = true;
                break 'lines;
            }
            let Some(x) = clamp_coordinate(raw.x, recognized_width) else {
                continue;
            };
            let Some(y) = clamp_coordinate(raw.y, recognized_height) else {
                continue;
            };
            let remaining_width = (f64::from(recognized_width) - x).max(0.0);
            let remaining_height = (f64::from(recognized_height) - y).max(0.0);
            let width = if raw.width.is_finite() {
                raw.width.clamp(0.0, remaining_width)
            } else {
                continue;
            };
            let height = if raw.height.is_finite() {
                raw.height.clamp(0.0, remaining_height)
            } else {
                continue;
            };
            if width <= 0.0 || height <= 0.0 {
                continue;
            }
            words.push(OcrWord {
                text,
                x,
                y,
                width,
                height,
                line: line_number,
                order: words.len() as u32,
            });
            chars += cost;
        }
    }
    let text = reading_text(&words);
    OcrPayload {
        language: language.to_string(),
        original_width: 0,
        original_height: 0,
        recognized_width,
        recognized_height,
        words,
        text,
        partial,
        text_angle,
    }
}

/// Create the BGRA8 `SoftwareBitmap` Windows OCR accepts.
pub fn to_software_bitmap(bitmap: &PreparedPixels) -> Result<SoftwareBitmap, String> {
    if bitmap.width == 0 || bitmap.height == 0 {
        return Err(ERR_TOO_LARGE.to_string());
    }
    let expected = usize::try_from(u64::from(bitmap.width) * u64::from(bitmap.height) * 4)
        .map_err(|_| ERR_TOO_LARGE.to_string())?;
    if bitmap.bgra.len() != expected {
        return Err(ERR_FAILED.to_string());
    }
    let writer = DataWriter::new().map_err(|_| ERR_FAILED.to_string())?;
    writer
        .WriteBytes(&bitmap.bgra)
        .map_err(|_| ERR_FAILED.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|_| ERR_FAILED.to_string())?;
    let _ = writer.Close();
    let created = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        bitmap.width as i32,
        bitmap.height as i32,
    )
    .map_err(|_| ERR_FAILED.to_string())?;
    SoftwareBitmap::ConvertWithAlpha(&created, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
        .map_err(|_| ERR_FAILED.to_string())
}

fn create_engine(language: &str) -> Result<OcrEngine, String> {
    if language.is_empty() {
        return OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|_| ERR_LANGUAGE_MISSING.to_string());
    }
    let tag = HSTRING::from(language);
    let language = Language::CreateLanguage(&tag).map_err(|_| ERR_LANGUAGE_MISSING.to_string())?;
    OcrEngine::TryCreateFromLanguage(&language).map_err(|_| ERR_LANGUAGE_MISSING.to_string())
}

fn language_tag(engine: &OcrEngine, fallback: &str) -> String {
    engine
        .RecognizerLanguage()
        .ok()
        .and_then(|language| language.LanguageTag().ok())
        .map(|tag| tag.to_string())
        .filter(|tag| !tag.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// Recognise one prepared bitmap. This runs only in the helper process;
/// the parent kills the process on cancellation or after its wall limit.
pub fn recognize(
    bitmap: &PreparedPixels,
    language: &str,
    cancel: &CancellationToken,
) -> Result<OcrPayload, String> {
    let _winrt = WinRt::enter()?;
    let engine = create_engine(language)?;
    let max_edge = OcrEngine::MaxImageDimension().map_err(|_| ERR_FAILED.to_string())?;
    if bitmap.width > max_edge || bitmap.height > max_edge {
        return Err(ERR_TOO_LARGE.to_string());
    }
    let software = to_software_bitmap(bitmap)?;
    if cancel.load(Ordering::Relaxed) {
        let _ = software.Close();
        return Err(ERR_CANCELLED.to_string());
    }
    let software_bitmap = software;
    let operation = engine
        .RecognizeAsync(&software_bitmap)
        .map_err(|_| ERR_FAILED.to_string())?;
    // The parent owns the 30 s wall limit and kills this process 250 ms
    // after cancellation (plan D1); this helper thread may wait here.
    let result = operation.get().map_err(|_| ERR_FAILED.to_string())?;
    let text_angle = result
        .TextAngle()
        .ok()
        .and_then(|reference| reference.Value().ok())
        .filter(|value| value.is_finite());
    let lines = result.Lines().map_err(|_| ERR_FAILED.to_string())?;
    let count = lines.Size().map_err(|_| ERR_FAILED.to_string())?;
    let mut raw_lines = Vec::with_capacity(count.min(MAX_OCR_WORDS as u32) as usize);
    let mut total_words = 0usize;
    for index in 0..count {
        if total_words >= MAX_OCR_WORDS {
            break;
        }
        let line = lines.GetAt(index).map_err(|_| ERR_FAILED.to_string())?;
        let windows_words = line.Words().map_err(|_| ERR_FAILED.to_string())?;
        let word_count = windows_words.Size().map_err(|_| ERR_FAILED.to_string())?;
        let mut words = Vec::with_capacity(word_count.min(MAX_OCR_WORDS as u32) as usize);
        for word_index in 0..word_count {
            if total_words >= MAX_OCR_WORDS {
                break;
            }
            let word = windows_words
                .GetAt(word_index)
                .map_err(|_| ERR_FAILED.to_string())?;
            let text = word.Text().map_err(|_| ERR_FAILED.to_string())?.to_string();
            let rect = word.BoundingRect().map_err(|_| ERR_FAILED.to_string())?;
            words.push(RawWord {
                text,
                x: f64::from(rect.X),
                y: f64::from(rect.Y),
                width: f64::from(rect.Width),
                height: f64::from(rect.Height),
            });
            total_words += 1;
        }
        raw_lines.push(RawLine { words });
    }
    let tag = language_tag(&engine, language);
    let payload = assemble_payload(&raw_lines, &tag, bitmap.width, bitmap.height, text_angle);
    let _ = software_bitmap.Close();
    Ok(payload)
}

/// The installed recogniser languages plus the user-profile hint.
pub fn available_languages() -> Result<OcrLanguagesReply, String> {
    let _winrt = WinRt::enter()?;
    let list = OcrEngine::AvailableRecognizerLanguages().map_err(|_| ERR_FAILED.to_string())?;
    let count = list.Size().map_err(|_| ERR_FAILED.to_string())?;
    let mut languages: Vec<OcrLanguage> = Vec::new();
    for index in 0..count {
        let language = list.GetAt(index).map_err(|_| ERR_FAILED.to_string())?;
        let tag = language
            .LanguageTag()
            .map_err(|_| ERR_FAILED.to_string())?
            .to_string();
        let name = language
            .DisplayName()
            .map(|value| value.to_string())
            .unwrap_or_else(|_| tag.clone());
        languages.push(OcrLanguage {
            tag,
            name,
            available: true,
        });
    }
    let user_profile = OcrEngine::TryCreateFromUserProfileLanguages()
        .ok()
        .and_then(|engine| engine.RecognizerLanguage().ok())
        .and_then(|language| language.LanguageTag().ok())
        .map(|tag| tag.to_string())
        .filter(|tag| !tag.is_empty());
    Ok(OcrLanguagesReply {
        languages: normalize_languages(languages),
        user_profile,
    })
}

#[cfg(test)]
mod tests {
    use super::{assemble_payload, RawLine, RawWord};
    use crate::ocr_types::{MAX_OCR_TEXT_CHARS, MAX_OCR_WORD_CHARS};

    fn raw(text: &str) -> RawWord {
        RawWord {
            text: text.to_string(),
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 5.0,
        }
    }

    #[test]
    fn words_are_in_line_and_reading_order() {
        let lines = [
            RawLine {
                words: vec![raw("Hello"), raw("123")],
            },
            RawLine {
                words: vec![raw("next")],
            },
        ];
        let payload = assemble_payload(&lines, "en-US", 100, 50, None);
        assert_eq!(payload.text, "Hello 123\nnext");
        assert_eq!(payload.words[1].line, 0);
        assert_eq!(payload.words[2].line, 1);
        assert_eq!(payload.words[2].order, 2);
        assert!(!payload.partial);
    }

    #[test]
    fn the_character_cap_is_an_explicit_partial() {
        let mut words = Vec::new();
        for _ in 0..250 {
            words.push(raw(&"x".repeat(2_500)));
        }
        let payload = assemble_payload(&[RawLine { words }], "en-US", 100, 50, None);
        assert!(payload.partial);
        assert!(payload.text.chars().count() <= MAX_OCR_TEXT_CHARS);
        assert!(payload
            .words
            .iter()
            .all(|word| { word.text.chars().count() <= MAX_OCR_WORD_CHARS }));
    }

    #[test]
    fn a_single_huge_word_is_truncated_and_partial() {
        let payload = assemble_payload(
            &[RawLine {
                words: vec![raw(&"y".repeat(MAX_OCR_WORD_CHARS + 10))],
            }],
            "en-US",
            100,
            50,
            None,
        );
        assert!(payload.partial);
        assert_eq!(payload.words[0].text.chars().count(), MAX_OCR_WORD_CHARS);
    }

    #[test]
    fn invalid_boxes_are_skipped_and_clamped() {
        let lines = [RawLine {
            words: vec![
                RawWord {
                    text: "bad".to_string(),
                    x: f64::NAN,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                },
                RawWord {
                    text: "edge".to_string(),
                    x: 95.0,
                    y: 45.0,
                    width: 100.0,
                    height: 100.0,
                },
            ],
        }];
        let payload = assemble_payload(&lines, "en-US", 100, 50, None);
        assert_eq!(payload.words.len(), 1);
        assert_eq!(payload.words[0].text, "edge");
        assert_eq!(payload.words[0].width, 5.0);
        assert_eq!(payload.words[0].height, 5.0);
    }
}
