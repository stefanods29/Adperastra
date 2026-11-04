//! PDF page geometry for the 08b adapters (Step 08b D2, D3).
//!
//! No PDF engine lives here. This module is the pure, testable half:
//! page-range normalization, the exact raster math from Step 07d, the image
//! page plan for `images/pdf`, and the page-part naming helper. The actual
//! PDF write/read work happens in the Step 07d trusted helper; snapshot
//! identity and every `CacheLease` stay with that producer.

use crate::error::ConvertError;
use crate::types::PageRange;

/// Largest raster the PDF helper may allocate for one page (07d D5).
pub const PDF_MAX_RENDER_PIXELS: u64 = 4_194_304;
/// Supported DPI range (08b D3).
pub const PDF_MIN_DPI: u16 = 72;
pub const PDF_MAX_DPI: u16 = 600;
pub const PDF_DEFAULT_DPI: u16 = 150;
/// Largest number of pages one PDF conversion may select (08b D3).
pub const MAX_SELECTED_PAGES: u32 = 10_000;
/// Largest number of images one `images/pdf` invocation may combine (D2).
pub const MAX_IMAGES_PER_PDF: usize = 1_000;
/// Largest number of pages one `images/pdf` output may produce (D2).
pub const MAX_PDF_PAGES: u32 = 10_000;
/// Images are treated as 96 DPI when no page size is chosen (D2).
pub const IMAGE_DEFAULT_DPI: f64 = 96.0;
/// A4 and Letter in PDF points (D2, D4).
pub const A4_WIDTH_PT: f64 = 595.28;
pub const A4_HEIGHT_PT: f64 = 841.89;
pub const LETTER_WIDTH_PT: f64 = 612.0;
pub const LETTER_HEIGHT_PT: f64 = 792.0;

/// A raster request, exactly the Step 07d union.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfRasterSpec {
    Bucket { edge: u16 },
    Dpi { value: u16 },
}

/// One raster's pixel size and the scale used.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfRasterSize {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// One image page in an `images/pdf` conversion. Dimensions are already
/// oriented; the 08a image helper applies orientation before this plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImagePageInput {
    pub width_px: u32,
    pub height_px: u32,
}

/// One page of an `images/pdf` output.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImagePagePlan {
    pub width_pt: f64,
    pub height_pt: f64,
}

/// The exact raster math of 07d (shared with PDF render and print).
///
/// Width and height are the rotated page dimensions in points; scale is
/// `value / 72` for DPI or `edge / max(width, height)` for a bucket. A
/// product over 4,194,304 pixels is refused; the DPI is never silently
/// lowered.
pub fn pdf_raster_dimensions(
    width_pt: f64,
    height_pt: f64,
    raster: PdfRasterSpec,
    rotation: u16,
) -> Result<PdfRasterSize, ConvertError> {
    if !width_pt.is_finite()
        || !height_pt.is_finite()
        || width_pt <= 0.0
        || height_pt <= 0.0
        || !matches!(rotation, 0 | 90 | 180 | 270)
    {
        return Err(ConvertError::BadRequest);
    }
    let (width, height) = if rotation == 90 || rotation == 270 {
        (height_pt, width_pt)
    } else {
        (width_pt, height_pt)
    };
    let scale = match raster {
        PdfRasterSpec::Bucket { edge } => {
            if !matches!(edge, 512 | 1024 | 2048) {
                return Err(ConvertError::BadRequest);
            }
            f64::from(edge) / width.max(height)
        }
        PdfRasterSpec::Dpi { value } => {
            if !(PDF_MIN_DPI..=PDF_MAX_DPI).contains(&value) {
                return Err(ConvertError::BadRequest);
            }
            f64::from(value) / 72.0
        }
    };
    let pixels_w = (width * scale).ceil();
    let pixels_h = (height * scale).ceil();
    if !pixels_w.is_finite()
        || !pixels_h.is_finite()
        || pixels_w < 1.0
        || pixels_h < 1.0
        || pixels_w * pixels_h > PDF_MAX_RENDER_PIXELS as f64
    {
        return Err(ConvertError::TooLarge);
    }
    Ok(PdfRasterSize {
        width: pixels_w as u32,
        height: pixels_h as u32,
        scale,
    })
}

/// Normalize selected ranges into the stable ascending page list used for
/// output. Invalid bounds are refused before any output is staged.
///
/// Overlapping and adjacent ranges are merged; the count is capped at
/// `MAX_SELECTED_PAGES`.
pub fn normalize_page_ranges(
    ranges: &[PageRange],
    page_count: u32,
) -> Result<Vec<u32>, ConvertError> {
    if page_count == 0 || page_count > MAX_SELECTED_PAGES {
        return Err(ConvertError::TooLarge);
    }
    let mut intervals: Vec<(u32, u32)> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if range.first == 0 || range.last < range.first || range.last > page_count {
            return Err(ConvertError::InvalidRange);
        }
        intervals.push((range.first, range.last));
    }
    if intervals.is_empty() {
        // Empty means every page, exactly as the 08a options table says.
        intervals.push((1, page_count));
    }
    intervals.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::with_capacity(intervals.len());
    for (first, last) in intervals {
        match merged.last_mut() {
            Some((_, previous_last)) if first <= previous_last.saturating_add(1) => {
                *previous_last = (*previous_last).max(last);
            }
            _ => merged.push((first, last)),
        }
    }
    let total: u64 = merged
        .iter()
        .map(|(first, last)| u64::from(*last) - u64::from(*first) + 1)
        .sum();
    if total > u64::from(MAX_SELECTED_PAGES) {
        return Err(ConvertError::TooLarge);
    }
    let capacity = usize::try_from(total).map_err(|_| ConvertError::TooLarge)?;
    let mut pages = Vec::with_capacity(capacity);
    for (first, last) in merged {
        pages.extend(first..=last);
    }
    Ok(pages)
}

/// Plan the pages of one `images/pdf` output. The input order is kept.
///
/// `page_size` is the wire value `source`, `a4` or `letter` from
/// `DocumentConversionOptions`. `margin_mm` is applied only to a fixed page
/// size; a source-sized page is exactly the image size at 96 DPI.
pub fn image_pdf_plan(
    images: &[ImagePageInput],
    page_size: &str,
    margin_mm: u16,
) -> Result<Vec<ImagePagePlan>, ConvertError> {
    let placements = image_pdf_placements(images, page_size, margin_mm)?;
    Ok(placements
        .into_iter()
        .map(|placement| ImagePagePlan {
            width_pt: placement.page_width_pt,
            height_pt: placement.page_height_pt,
        })
        .collect())
}

/// The exact page and draw sizes for one image.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImagePlacement {
    pub page_width_pt: f64,
    pub page_height_pt: f64,
    pub draw_width_pt: f64,
    pub draw_height_pt: f64,
    pub x_pt: f64,
    pub y_pt: f64,
}

/// Plan page and centered draw rectangles; the helper embeds exactly these.
pub fn image_pdf_placements(
    images: &[ImagePageInput],
    page_size: &str,
    margin_mm: u16,
) -> Result<Vec<ImagePlacement>, ConvertError> {
    if images.is_empty() || images.len() > MAX_IMAGES_PER_PDF {
        return Err(ConvertError::TooLarge);
    }
    if margin_mm > 50 {
        return Err(ConvertError::BadRequest);
    }
    let margin = f64::from(margin_mm) * 72.0 / 25.4;
    let mut placements = Vec::with_capacity(images.len());
    for image in images {
        if image.width_px == 0 || image.height_px == 0 {
            return Err(ConvertError::BadRequest);
        }
        let source_width = f64::from(image.width_px) * 72.0 / IMAGE_DEFAULT_DPI;
        let source_height = f64::from(image.height_px) * 72.0 / IMAGE_DEFAULT_DPI;
        let (page_width, page_height, usable_width, usable_height) = match page_size {
            "source" => (source_width, source_height, source_width, source_height),
            "a4" => (
                A4_WIDTH_PT,
                A4_HEIGHT_PT,
                A4_WIDTH_PT - 2.0 * margin,
                A4_HEIGHT_PT - 2.0 * margin,
            ),
            "letter" => (
                LETTER_WIDTH_PT,
                LETTER_HEIGHT_PT,
                LETTER_WIDTH_PT - 2.0 * margin,
                LETTER_HEIGHT_PT - 2.0 * margin,
            ),
            _ => return Err(ConvertError::BadRequest),
        };
        if usable_width <= 0.0 || usable_height <= 0.0 {
            return Err(ConvertError::BadRequest);
        }
        let scale = (usable_width / source_width)
            .min(usable_height / source_height)
            .min(1.0);
        let draw_width = source_width * scale;
        let draw_height = source_height * scale;
        placements.push(ImagePlacement {
            page_width_pt: page_width,
            page_height_pt: page_height,
            draw_width_pt: draw_width,
            draw_height_pt: draw_height,
            x_pt: (page_width - draw_width) / 2.0,
            y_pt: (page_height - draw_height) / 2.0,
        });
    }
    Ok(placements)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpi_math_matches_the_step07d_oracle() {
        let size = pdf_raster_dimensions(72.0, 72.0, PdfRasterSpec::Dpi { value: 150 }, 0).unwrap();
        assert_eq!((size.width, size.height), (150, 150));
        assert!((size.scale - 150.0 / 72.0).abs() < 1e-12);
    }

    #[test]
    fn pixel_cap_refuses_instead_of_lowering_dpi() {
        assert!(matches!(
            pdf_raster_dimensions(1_000.0, 1_000.0, PdfRasterSpec::Dpi { value: 600 }, 0),
            Err(ConvertError::TooLarge)
        ));
    }

    #[test]
    fn buckets_and_rotation_use_the_rotated_size() {
        let size =
            pdf_raster_dimensions(100.0, 200.0, PdfRasterSpec::Bucket { edge: 1024 }, 90).unwrap();
        assert_eq!((size.width, size.height), (1024, 512));
    }

    #[test]
    fn invalid_ranges_are_refused() {
        assert!(matches!(
            normalize_page_ranges(&[PageRange { first: 0, last: 1 }], 3),
            Err(ConvertError::InvalidRange)
        ));
        assert!(matches!(
            normalize_page_ranges(&[PageRange { first: 2, last: 1 }], 3),
            Err(ConvertError::InvalidRange)
        ));
        assert!(matches!(
            normalize_page_ranges(&[PageRange { first: 1, last: 4 }], 3),
            Err(ConvertError::InvalidRange)
        ));
    }

    #[test]
    fn empty_ranges_mean_all_pages_and_overlaps_merge() {
        assert_eq!(normalize_page_ranges(&[], 3).unwrap(), vec![1, 2, 3]);
        assert_eq!(
            normalize_page_ranges(
                &[
                    PageRange { first: 1, last: 1 },
                    PageRange { first: 1, last: 2 },
                    PageRange { first: 3, last: 3 },
                ],
                3
            )
            .unwrap(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn image_cap_is_one_thousand() {
        let image = ImagePageInput {
            width_px: 1,
            height_px: 1,
        };
        assert!(image_pdf_placements(&vec![image; 1_000], "a4", 20).is_ok());
        assert!(matches!(
            image_pdf_placements(&vec![image; 1_001], "a4", 20),
            Err(ConvertError::TooLarge)
        ));
    }

    #[test]
    fn source_page_is_the_image_size_at_96dpi() {
        let placements = image_pdf_placements(
            &[ImagePageInput {
                width_px: 960,
                height_px: 480,
            }],
            "source",
            20,
        )
        .unwrap();
        assert!((placements[0].page_width_pt - 720.0).abs() < 1e-9);
        assert!((placements[0].page_height_pt - 360.0).abs() < 1e-9);
        assert_eq!(placements[0].x_pt, 0.0);
        assert_eq!(placements[0].y_pt, 0.0);
    }

    #[test]
    fn a4_page_centers_a_small_image_without_enlarging_it() {
        let placements = image_pdf_placements(
            &[ImagePageInput {
                width_px: 96,
                height_px: 96,
            }],
            "a4",
            20,
        )
        .unwrap();
        assert!((placements[0].draw_width_pt - 72.0).abs() < 1e-9);
        assert!((placements[0].x_pt - (A4_WIDTH_PT - 72.0) / 2.0).abs() < 1e-9);
    }
}
