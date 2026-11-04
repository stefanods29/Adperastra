//! Step 17b T2 oracles: mask composition rules and inpaint invariants.
//!
//! The deterministic math lives in `src-tauri/src/ai_mask.rs` and
//! `src-tauri/src/ai_inpaint.rs` (guide T2). Both files are `std`-only and
//! are included here by path so the oracles run without the Tauri crate.
//! Written tests only; the coordinator executes them.

#[path = "../../../src-tauri/src/ai_inpaint.rs"]
mod ai_inpaint;
#[path = "../../../src-tauri/src/ai_mask.rs"]
mod ai_mask;

use ai_inpaint::{erase_object, mask_from_ui_alpha, validate_inpaint_size, InpaintModel};
use ai_mask::{
    apply_alpha_mask, binary_hole, composite_inpaint, require_same_revision, resize_plane_bilinear,
    SoftMask, ERR_EMPTY_MASK, ERR_MASK_TOO_LARGE, ERR_SOURCE_CHANGED, ERR_TOO_LARGE,
};

fn uniform_rgba(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
    pixel
        .iter()
        .copied()
        .cycle()
        .take(width as usize * height as usize * 4)
        .collect()
}

fn uniform_mask(width: u32, height: u32, value: u8) -> SoftMask {
    SoftMask::new(width, height, vec![value; width as usize * height as usize]).unwrap()
}

#[test]
fn alpha255_mask128_to_alpha128() {
    let source = uniform_rgba(2, 1, [10, 20, 30, 255]);
    let mask = uniform_mask(2, 1, 128);
    let out = apply_alpha_mask(&source, &mask).unwrap();
    assert_eq!(out[3], 128);
    assert_eq!(out[7], 128);
    assert_eq!(&out[0..3], &[10, 20, 30], "RGB is untouched");
}

#[test]
fn alpha128_mask128_to_alpha64() {
    let source = uniform_rgba(2, 1, [10, 20, 30, 128]);
    let mask = uniform_mask(2, 1, 128);
    let out = apply_alpha_mask(&source, &mask).unwrap();
    assert_eq!(out[3], 64);
}

#[test]
fn mask0_keeps_source_outside_hole() {
    let width = 4u32;
    let height = 1u32;
    let source = uniform_rgba(width, height, [1, 2, 3, 255]);
    let mut alpha = vec![0u8; 4];
    alpha[1] = 255;
    let mask = SoftMask::new(width, height, alpha).unwrap();
    let generated = uniform_rgba(width, height, [200, 100, 50, 255]);
    let out = composite_inpaint(&source, &generated, &mask).unwrap();
    assert_eq!(&out[0..4], &[1, 2, 3, 255]);
    assert_eq!(&out[4..8], &[200, 100, 50, 255]);
    assert_eq!(&out[8..12], &[1, 2, 3, 255]);
}

#[test]
fn empty_mask_refused() {
    let mask = uniform_mask(2, 2, 0);
    assert!(mask_from_ui_alpha(2, 2, &[0, 0, 0, 0]).unwrap().is_empty());
    assert_eq!(binary_hole(&mask).unwrap_err(), ERR_EMPTY_MASK);
}

#[test]
fn mask_51_percent_refused() {
    // 100 pixels, 51 marked: above the 50 % erase budget.
    let mut alpha = vec![0u8; 100];
    for value in alpha.iter_mut().take(51) {
        *value = 255;
    }
    let mask = SoftMask::new(10, 10, alpha).unwrap();
    assert_eq!(binary_hole(&mask).unwrap_err(), ERR_MASK_TOO_LARGE);
    assert_eq!(mask.erased_percent(), 51);
}

#[test]
#[allow(non_snake_case)]
fn inpaint_16MP_plus_refused() {
    assert!(validate_inpaint_size(4_000, 4_000).is_ok());
    assert_eq!(
        validate_inpaint_size(4_097, 1_000).unwrap_err(),
        ERR_TOO_LARGE
    );
    assert_eq!(
        validate_inpaint_size(4_096, 4_000).unwrap_err(),
        ERR_TOO_LARGE
    );
}

#[test]
fn mask_source_revision_changed_refused() {
    assert!(require_same_revision(3, 3).is_ok());
    assert_eq!(require_same_revision(2, 3).unwrap_err(), ERR_SOURCE_CHANGED);
    assert_eq!(require_same_revision(0, 0).unwrap_err(), ERR_SOURCE_CHANGED);
}

struct IdentityModel;

impl InpaintModel for IdentityModel {
    fn generate(&self, rgb: &[u8], _mask: &SoftMask) -> Result<Vec<u8>, String> {
        Ok(rgb.iter().map(|value| value.wrapping_add(7)).collect())
    }
}

#[test]
fn outside_hole_exact_bytes() {
    let width = 8u32;
    let height = 8u32;
    let source: Vec<u8> = (0..width as usize * height as usize)
        .flat_map(|index| {
            let byte = index as u8;
            [byte, byte.wrapping_mul(3), byte.wrapping_mul(7), 200]
        })
        .collect();
    let mut alpha = vec![0u8; width as usize * height as usize];
    alpha[9] = 255;
    alpha[10] = 255;
    let mask = SoftMask::new(width, height, alpha).unwrap();
    let out = erase_object(&source, width, height, &mask, &IdentityModel).unwrap();
    for index in 0..width as usize * height as usize {
        if index == 9 || index == 10 {
            assert_eq!(out[index * 4], source[index * 4].wrapping_add(7));
            assert_eq!(
                out[index * 4 + 3],
                source[index * 4 + 3],
                "alpha is the original"
            );
        } else {
            assert_eq!(
                &out[index * 4..index * 4 + 4],
                &source[index * 4..index * 4 + 4]
            );
        }
    }
}

/// The composite must not depend on which device produced the same pixels.
#[test]
fn cpu_gpu_model_parity_fixtures() {
    let width = 16u32;
    let height = 16u32;
    let source = uniform_rgba(width, height, [40, 60, 80, 255]);
    let mut alpha = vec![0u8; width as usize * height as usize];
    for y in 4..8 {
        for x in 4..8 {
            alpha[y * width as usize + x] = 255;
        }
    }
    let mask = SoftMask::new(width, height, alpha).unwrap();
    let cpu = uniform_rgba(width, height, [90, 110, 130, 255]);
    let gpu = uniform_rgba(width, height, [90, 110, 130, 255]);
    let cpu_out = composite_inpaint(&source, &cpu, &mask).unwrap();
    let gpu_out = composite_inpaint(&source, &gpu, &mask).unwrap();
    assert_eq!(cpu_out, gpu_out);
    // Bilinear resampling of a flat plane stays flat on every device.
    let plane = vec![0.25f32; 1_024 * 1_024];
    let resized = resize_plane_bilinear(&plane, 1_024, 1_024, 333, 111);
    assert!(resized.iter().all(|value| (*value - 0.25).abs() < 1e-6));
}
