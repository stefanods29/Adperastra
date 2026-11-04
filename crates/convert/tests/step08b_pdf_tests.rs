//! Step 08b PDF geometry and bounds (D2/D3). Written, not run by the worker.

use convert::pdf::{
    image_pdf_placements, normalize_page_ranges, pdf_raster_dimensions, ImagePageInput,
    PdfRasterSpec, MAX_IMAGES_PER_PDF,
};
use convert::types::PageRange;

fn range(first: u32, last: u32) -> PageRange {
    PageRange { first, last }
}

#[test]
fn seventy_two_points_at_150_dpi_is_150_pixels() {
    let size = pdf_raster_dimensions(72.0, 72.0, PdfRasterSpec::Dpi { value: 150 }, 0).unwrap();
    assert_eq!((size.width, size.height), (150, 150));
}

#[test]
fn requested_dpi_is_refused_above_the_pixel_cap() {
    assert!(pdf_raster_dimensions(1_000.0, 1_000.0, PdfRasterSpec::Dpi { value: 600 }, 0).is_err());
}

#[test]
fn invalid_ranges_fail_before_output() {
    assert!(normalize_page_ranges(&[range(0, 1)], 3).is_err());
    assert!(normalize_page_ranges(&[range(2, 1)], 3).is_err());
    assert!(normalize_page_ranges(&[range(1, 4)], 3).is_err());
}

#[test]
fn page_order_is_ascending_and_stable() {
    assert_eq!(
        normalize_page_ranges(&[range(3, 3), range(1, 2)], 3).unwrap(),
        vec![1, 2, 3]
    );
}

#[test]
fn one_thousand_images_are_accepted_and_1001_are_refused() {
    let image = ImagePageInput {
        width_px: 1,
        height_px: 1,
    };
    assert!(image_pdf_placements(&vec![image; MAX_IMAGES_PER_PDF], "a4", 20).is_ok());
    assert!(image_pdf_placements(&vec![image; MAX_IMAGES_PER_PDF + 1], "a4", 20).is_err());
}

#[test]
fn source_page_is_the_image_size_at_96_dpi() {
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
}
