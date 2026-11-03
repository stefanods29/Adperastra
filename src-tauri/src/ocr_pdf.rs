#![allow(dead_code)] // Public producer API; consumed from later steps.
//! The PDF side of OCR (Step 07e plan D3/D4).
//!
//! No PDF is parsed here. The producer is 07d: this module defines a narrow
//! native adapter boundary (`OcrPdfPageSource`) that the PDF module
//! implements once and registers at startup. The adapter returns the live
//! immutable identity, the page's native text (if any) and a rendered page
//! `PdfPageImage` with its 07a lease. OCR never opens a PDF path itself and
//! never fabricates a source stamp for an immutable snapshot.
//!
//! Native text runs are mapped from PDF points to the rendered raster with
//! the same flipped viewport transform 07d uses (`pdfViewportMatrix` in
//! `src/handlers/pdf/pdfCoordinates.ts`): rotation 90/270 swaps the axes,
//! 180 mirrors both, and the bucket scale is `resolved_scale`.

use std::sync::{Arc, Mutex};

use fs_service::CancellationToken;

use crate::ocr_types::{
    reading_text, OcrPage, OcrWord, ERR_BAD_REQUEST, ERR_CHANGED, ERR_FAILED, MAX_OCR_TEXT_CHARS,
    MAX_OCR_WORDS, MAX_OCR_WORD_CHARS,
};
use crate::pdf_types::{
    PdfPageImage, PdfPageInfo, PdfRenderRequest, PdfRotation, PdfSourceIdentity, PdfTextPage,
    PdfTextRun,
};

/// Native text plus everything needed to map it to the rendered page.
#[derive(Debug, Clone)]
pub struct PdfNativeText {
    pub identity: PdfSourceIdentity,
    pub page: u32,
    pub info: PdfPageInfo,
    pub render_width: u32,
    pub render_height: u32,
    pub resolved_scale: f64,
    pub rendered_rotation: PdfRotation,
    pub text: PdfTextPage,
}

/// What the PDF module implements once (07d owns the real renderer and
/// session map). Every method revalidates the live session in 07d.
pub trait OcrPdfPageSource: Send + Sync + 'static {
    /// The immutable identity of the live session.
    fn identity(&self, session_id: &str) -> Result<PdfSourceIdentity, String>;
    /// The page's native text, if it has any. No render is requested for a
    /// page that already has selectable text.
    fn native_text(&self, session_id: &str, page: u32) -> Result<Option<PdfNativeText>, String>;
    /// Render the page through 07d's own renderer (bucket edge 2048).
    fn render(
        &self,
        request: &PdfRenderRequest,
        cancel: &CancellationToken,
    ) -> Result<PdfPageImage, String>;
}

/// One registration slot; a second adapter is a wiring bug.
#[derive(Default)]
pub struct OcrPdfAdapters {
    source: Mutex<Option<Arc<dyn OcrPdfPageSource>>>,
}

impl OcrPdfAdapters {
    pub fn register(&self, source: Arc<dyn OcrPdfPageSource>) -> Result<(), String> {
        let mut slot = self.source.lock().map_err(|_| ERR_FAILED.to_string())?;
        if slot.is_some() {
            return Err(ERR_FAILED.to_string());
        }
        *slot = Some(source);
        Ok(())
    }

    pub fn source(&self) -> Option<Arc<dyn OcrPdfPageSource>> {
        self.source.lock().ok().and_then(|slot| slot.clone())
    }
}

/// True when the page already has selectable text; then Copy uses it and no
/// recognition is requested (plan D3).
pub fn should_use_native_text(text: Option<&str>) -> bool {
    text.is_some_and(|value| !value.trim().is_empty())
}

/// The flipped PDF viewport box of one run, in rendered raster pixels.
pub fn pdf_run_box_to_raster(
    run: &PdfTextRun,
    info: &PdfPageInfo,
    resolved_scale: f64,
    rendered_rotation: PdfRotation,
) -> Option<(f64, f64, f64, f64)> {
    if !resolved_scale.is_finite()
        || resolved_scale <= 0.0
        || !info.width_pt.is_finite()
        || !info.height_pt.is_finite()
        || info.width_pt <= 0.0
        || info.height_pt <= 0.0
        || !run.x.is_finite()
        || !run.y.is_finite()
        || !run.width.is_finite()
        || !run.height.is_finite()
    {
        return None;
    }
    let scale = resolved_scale;
    let width = run.width.max(0.0);
    let height = run.height.max(0.0);
    let (left, top, box_width, box_height) = match rendered_rotation {
        PdfRotation::Deg90 => (run.y * scale, run.x * scale, height * scale, width * scale),
        PdfRotation::Deg180 => (
            (info.width_pt - run.x - width) * scale,
            (info.height_pt - run.y - height) * scale,
            width * scale,
            height * scale,
        ),
        PdfRotation::Deg270 => (
            (info.height_pt - run.y - height) * scale,
            (info.width_pt - run.x - width) * scale,
            height * scale,
            width * scale,
        ),
        PdfRotation::Deg0 => (run.x * scale, run.y * scale, width * scale, height * scale),
    };
    if !left.is_finite()
        || !top.is_finite()
        || !box_width.is_finite()
        || !box_height.is_finite()
        || box_width < 0.0
        || box_height < 0.0
    {
        return None;
    }
    Some((left, top, box_width, box_height))
}

fn same_line(run: &PdfTextRun, line_y: f64, line_size: f64) -> bool {
    let tolerance = (line_size * 0.6).max(2.0);
    (run.y - line_y).abs() <= tolerance
}

/// Convert one bounded native text page into the OCR wire shape.
///
/// Runs are grouped into lines by baseline proximity while their `order`
/// keeps the producer's reading order. A run that cannot be mapped is
/// skipped; a bounded page (`next_run`/`complete`) or a limit makes the
/// result explicitly partial.
pub fn native_text_page(native: &PdfNativeText, language: &str) -> Result<OcrPage, String> {
    if native.render_width == 0
        || native.render_height == 0
        || !native.resolved_scale.is_finite()
        || native.resolved_scale <= 0.0
    {
        return Err(ERR_BAD_REQUEST.to_string());
    }
    if native.info.page != native.page
        || native.text.page != native.page
        || native.text.source != native.identity
    {
        return Err(ERR_CHANGED.to_string());
    }
    let mut runs = native.text.runs.clone();
    runs.sort_by_key(|run| run.order);

    let mut words: Vec<OcrWord> = Vec::new();
    let mut chars = 0usize;
    let mut partial = !native.text.complete || native.text.next_run.is_some();
    let mut line_index: u32 = 0;
    let mut line_y = f64::NAN;
    let mut line_size = 0.0f64;
    'runs: for run in &runs {
        if words.len() >= MAX_OCR_WORDS {
            partial = true;
            break;
        }
        let mut text = run.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        if text.chars().count() > MAX_OCR_WORD_CHARS {
            text = text.chars().take(MAX_OCR_WORD_CHARS).collect();
            partial = true;
        }
        let cost = text.chars().count() + usize::from(chars > 0);
        if chars + cost > MAX_OCR_TEXT_CHARS {
            partial = true;
            break 'runs;
        }
        let Some((x, y, width, height)) = pdf_run_box_to_raster(
            run,
            &native.info,
            native.resolved_scale,
            native.rendered_rotation,
        ) else {
            continue;
        };
        // A run outside the page cannot be displayed; leave it out rather
        // than fail the whole page at validation.
        if x < 0.0 || y < 0.0 || width < 0.0 || height < 0.0 {
            continue;
        }
        if !same_line(run, line_y, line_size) {
            if !line_y.is_nan() {
                line_index += 1;
            }
            line_y = run.y;
            line_size = run.font_size;
        }
        words.push(OcrWord {
            text,
            x,
            y,
            width,
            height,
            line: line_index,
            order: run.order,
        });
        chars += cost;
    }
    let text = reading_text(&words);
    Ok(OcrPage {
        source: native.identity.clone(),
        page: native.page,
        language: language.to_string(),
        original_width: native.render_width,
        original_height: native.render_height,
        recognized_width: native.render_width,
        recognized_height: native.render_height,
        words,
        text,
        partial,
        next_word: None,
        rotation: native.rendered_rotation.value(),
        text_angle: None,
    })
}

/// Only an ordinary disk identity may enter the disk cache (plan D5).
pub fn may_cache(identity: &PdfSourceIdentity) -> bool {
    matches!(identity, PdfSourceIdentity::Disk { .. })
}

/// A sensitive snapshot never exposes clipboard/print actions.
pub fn is_sensitive(identity: &PdfSourceIdentity) -> bool {
    matches!(
        identity,
        PdfSourceIdentity::Snapshot {
            sensitive: true,
            ..
        }
    )
}

/// The disk stamp of a cacheable identity, if any.
pub fn stamp_of(identity: &PdfSourceIdentity) -> Option<&fs_service::SourceStamp> {
    match identity {
        PdfSourceIdentity::Disk { stamp } => Some(stamp),
        PdfSourceIdentity::Snapshot { .. } => None,
    }
}

/// Reject a result if the live session identity moved on.
pub fn ensure_identity_unchanged(
    expected: &PdfSourceIdentity,
    current: &PdfSourceIdentity,
) -> Result<(), String> {
    if expected == current {
        Ok(())
    } else {
        Err(ERR_CHANGED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_identity_unchanged, native_text_page, pdf_run_box_to_raster, should_use_native_text,
        PdfNativeText,
    };
    use crate::pdf_types::{
        PdfPageInfo, PdfRotation, PdfSourceIdentity, PdfTextDirection, PdfTextPage, PdfTextRun,
    };

    fn info() -> PdfPageInfo {
        PdfPageInfo {
            page: 1,
            width_pt: 100.0,
            height_pt: 200.0,
            rotation: PdfRotation::Deg0,
        }
    }

    fn run() -> PdfTextRun {
        PdfTextRun {
            text: "Hello".to_string(),
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
            direction: PdfTextDirection::Ltr,
            font_size: 10.0,
            order: 0,
        }
    }

    fn identity() -> PdfSourceIdentity {
        PdfSourceIdentity::Disk {
            stamp: crate::ocr_step07e_tests::test_stamp(),
        }
    }

    #[test]
    fn ninety_degrees_uses_the_pdf_viewport_flip() {
        // 07d `pdfRunBox` for the same box gives left 20, top 10, 40 x 30.
        let box_value = pdf_run_box_to_raster(&run(), &info(), 1.0, PdfRotation::Deg90).unwrap();
        assert_eq!(box_value, (20.0, 10.0, 40.0, 30.0));
    }

    #[test]
    fn two_hundred_seventy_degrees_mirrors_the_other_axis() {
        let box_value = pdf_run_box_to_raster(&run(), &info(), 1.0, PdfRotation::Deg270).unwrap();
        assert_eq!(box_value, (140.0, 60.0, 40.0, 30.0));
    }

    #[test]
    fn native_text_is_preferred_when_it_exists() {
        assert!(should_use_native_text(Some("Hello")));
        assert!(!should_use_native_text(Some("   ")));
        assert!(!should_use_native_text(None));
    }

    #[test]
    fn native_text_becomes_a_bounded_ocr_page() {
        let native = PdfNativeText {
            identity: identity(),
            page: 1,
            info: info(),
            render_width: 100,
            render_height: 200,
            resolved_scale: 1.0,
            rendered_rotation: PdfRotation::Deg0,
            text: PdfTextPage {
                page: 1,
                runs: vec![run()],
                next_run: None,
                complete: true,
                source: identity(),
            },
        };
        let page = native_text_page(&native, "en-US").unwrap();
        assert_eq!(page.text, "Hello");
        assert_eq!(page.language, "en-US");
        assert!(!page.partial);
        assert_eq!(page.words[0].x, 10.0);
    }

    #[test]
    fn an_identity_change_is_rejected() {
        let expected = identity();
        let mut stamp = crate::ocr_step07e_tests::test_stamp();
        stamp.size_bytes += 1;
        let other = PdfSourceIdentity::Disk { stamp };
        assert!(ensure_identity_unchanged(&expected, &expected).is_ok());
        assert!(ensure_identity_unchanged(&expected, &other).is_err());
    }
}
