//! Step 14c T4 enlargement tests (not executed by the coding worker).

use ai_runtime::image_alpha::resize_alpha_lanczos3;
use ai_runtime::types::{UpscaleModel, UpscaleScale};
use ai_runtime::upscale::{check_upscale_limits, validate_png, ModelParityRegistry};
use ai_runtime::upscale_tiles::{
    copy_core_output, extract_model_input, plan_tiles, seam_metrics, RgbaImage, SourceRect,
    UpscaleTile, CONTEXT_EDGE,
};

fn solid(width: u32, height: u32, rgba: [u8; 4]) -> RgbaImage {
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
    for _ in 0..width as usize * height as usize {
        pixels.extend_from_slice(&rgba);
    }
    RgbaImage::new(width, height, pixels).expect("image")
}

#[test]
fn dimensions_1000x500_4x_are_4000x2000() {
    let output = check_upscale_limits(1_000, 500, UpscaleScale::Four).expect("allowed");
    assert_eq!((output.width, output.height), (4_000, 2_000));
}

#[test]
fn dimensions_2501x2500_4x_are_too_large_at_100040000_pixels() {
    let error = check_upscale_limits(2_501, 2_500, UpscaleScale::Four).expect_err("too large");
    assert_eq!(error.output.width, 10_004);
    assert_eq!(error.output.height, 10_000);
    assert_eq!(error.output_pixels, 100_040_000);
}

#[test]
fn dimensions_5000x5000_2x_are_100000000_accepted() {
    let output = check_upscale_limits(5_000, 5_000, UpscaleScale::Two).expect("allowed");
    assert_eq!((output.width, output.height), (10_000, 10_000));
    assert_eq!(output.pixels(), 100_000_000);
}

#[test]
fn transparent_alpha_zero_stays_zero() {
    let source = vec![0u8; 4 * 4];
    let resized = resize_alpha_lanczos3(&source, 4, 4, 8, 8).expect("resize");
    assert_eq!(resized.len(), 64);
    assert!(resized.iter().all(|alpha| *alpha == 0));
}

#[test]
fn solid_rgb_tile_partition_equals_untiled() {
    let image = solid(300, 300, [10, 20, 30, 255]);
    let plan = plan_tiles(300, 300, UpscaleScale::Four).expect("plan");
    let mut tiled = vec![0u8; plan.output.width as usize * plan.output.height as usize * 4];
    for tile in &plan.tiles {
        let output = solid_model_output(&image, tile);
        copy_core_output(&mut tiled, plan.output.width, tile, &output).expect("copy");
    }
    let reference = solid(plan.output.width, plan.output.height, [10, 20, 30, 255]);
    let tiled_image =
        RgbaImage::new(plan.output.width, plan.output.height, tiled).expect("assembled");
    assert_eq!(tiled_image.pixels, reference.pixels);
}

#[allow(clippy::needless_range_loop)]
fn solid_model_output(image: &RgbaImage, tile: &UpscaleTile) -> Vec<u8> {
    let count = tile.input.width as usize * 4 * tile.input.height as usize * 4;
    let mut output = Vec::with_capacity(count * 4);
    // One average over a 5x5 source window: enough neighbor dependence to
    // expose a missing 64px context while staying deterministic.
    let input = extract_model_input(image, tile.input);
    let plane = tile.input.width as usize;
    for y in 0..tile.input.height as usize * 4 {
        for x in 0..tile.input.width as usize * 4 {
            let sx = (x / 4).min(plane - 1);
            let sy = (y / 4).min(tile.input.height as usize - 1);
            let mut rgb = [0.0f64; 3];
            let mut used = 0.0f64;
            for dy in -2i64..=2 {
                let ny = (sy as i64 + dy).clamp(0, tile.input.height as i64 - 1) as usize;
                for dx in -2i64..=2 {
                    let nx = (sx as i64 + dx).clamp(0, plane as i64 - 1) as usize;
                    let index = ny * plane + nx;
                    rgb[0] += f64::from(input[index]);
                    rgb[1] += f64::from(input[plane * tile.input.height as usize + index]);
                    rgb[2] += f64::from(input[plane * tile.input.height as usize * 2 + index]);
                    used += 1.0;
                }
            }
            output.push((rgb[0] / used * 255.0).round() as u8);
            output.push((rgb[1] / used * 255.0).round() as u8);
            output.push((rgb[2] / used * 255.0).round() as u8);
            output.push(255);
        }
    }
    output
}

#[allow(clippy::needless_range_loop)]
fn reference_4x(image: &RgbaImage) -> RgbaImage {
    let padded = SourceRect {
        x: -(CONTEXT_EDGE as i64),
        y: -(CONTEXT_EDGE as i64),
        width: image.width + CONTEXT_EDGE * 2,
        height: image.height + CONTEXT_EDGE * 2,
    };
    let full = solid_model_output(
        image,
        &UpscaleTile {
            core: ai_runtime::types::ImageRect {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
            },
            input: padded,
        },
    );
    let stride = padded.width as usize * 4 * 4;
    let start_x = CONTEXT_EDGE as usize * 4;
    let start_y = CONTEXT_EDGE as usize * 4;
    let mut cropped = vec![0u8; image.width as usize * 4 * image.height as usize * 4 * 4];
    let target_stride = image.width as usize * 4 * 4;
    for row in 0..image.height as usize * 4 {
        let source = (start_y + row) * stride + start_x * 4;
        let target = row * target_stride;
        cropped[target..target + target_stride]
            .copy_from_slice(&full[source..source + target_stride]);
    }
    RgbaImage::new(image.width * 4, image.height * 4, cropped).expect("reference")
}

#[test]
fn reference_tiled_seams_stay_within_two_over_255() {
    let mut pixels = Vec::new();
    for y in 0..300u32 {
        for x in 0..300u32 {
            pixels.extend_from_slice(&[
                ((x * 7 + y * 3) % 256) as u8,
                ((x * 5 + y * 11) % 256) as u8,
                ((x * 13 + y * 2) % 256) as u8,
                255,
            ]);
        }
    }
    let image = RgbaImage::new(300, 300, pixels).expect("image");
    let plan = plan_tiles(300, 300, UpscaleScale::Four).expect("plan");
    let mut tiled = vec![0u8; plan.output.width as usize * plan.output.height as usize * 4];
    for tile in &plan.tiles {
        let output = solid_model_output(&image, tile);
        copy_core_output(&mut tiled, plan.output.width, tile, &output).expect("copy");
    }
    let tiled_image =
        RgbaImage::new(plan.output.width, plan.output.height, tiled).expect("assembled");
    let reference = reference_4x(&image);
    let (max, mean) = seam_metrics(&reference, &tiled_image).expect("metrics");
    assert!(max <= 2, "max channel error {max} > 2");
    assert!(mean <= 0.5, "mean channel error {mean} > 0.5");
}

#[test]
fn failed_parity_disables_model() {
    let registry = ModelParityRegistry::new();
    let model = UpscaleModel::General.model_id();
    registry.record(model, false).expect("record");
    assert!(!registry.is_enabled(model));
    registry.record(model, true).expect("record");
    assert!(registry.is_enabled(model));
}

#[test]
fn png_header_validation_rejects_wrong_dimensions() {
    let mut png = vec![0u8; 33];
    png[..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    png[8..12].copy_from_slice(&13u32.to_be_bytes());
    png[12..16].copy_from_slice(b"IHDR");
    png[16..20].copy_from_slice(&10u32.to_be_bytes());
    png[20..24].copy_from_slice(&20u32.to_be_bytes());
    png[24] = 8;
    png[25] = 6;
    let info = validate_png(&png).expect("png");
    assert_eq!((info.width, info.height, info.has_alpha), (10, 20, true));
    png[25] = 1;
    assert!(validate_png(&png).is_err());
}
