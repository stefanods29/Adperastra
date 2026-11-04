use image_edit::adjustments::{
    apply_adjustments, brightness_channel, contrast_channel, saturation_channels,
};
use image_edit::{AdjustmentPreset, ImageAdjustments};

fn adjustments() -> ImageAdjustments {
    ImageAdjustments::default()
}

#[test]
fn brightness0_1_on0_5_is0_6() {
    let value = brightness_channel(0.5, 0.1);
    assert!((value - 0.6).abs() < 1e-6, "value was {value}");
}

#[test]
fn contrast0_on0_3_is0_3() {
    let value = contrast_channel(0.3, 0.0);
    assert!((value - 0.3).abs() < 1e-6, "value was {value}");
}

#[test]
fn saturationminus1_gives_y_all_channels() {
    let [r, g, b] = saturation_channels(0.8, 0.3, 0.1, -1.0);
    let y = 0.2126 * 0.8 + 0.7152 * 0.3 + 0.0722 * 0.1;
    assert!((r - y).abs() < 1e-6);
    assert!((g - y).abs() < 1e-6);
    assert!((b - y).abs() < 1e-6);
    assert!((r - g).abs() < 1e-6 && (g - b).abs() < 1e-6);
}

#[test]
fn alpha_unchanged() {
    let mut rgba = vec![10, 20, 30, 77];
    let mut settings = adjustments();
    settings.brightness = 0.2;
    settings.contrast = -0.1;
    apply_adjustments(&mut rgba, 1, 1, &settings).unwrap();
    assert_eq!(rgba[3], 77);
    assert_ne!(rgba[0], 10);
}

#[test]
fn blur0_identity() {
    let mut rgba = vec![
        1, 2, 3, 255, 40, 50, 60, 200, 70, 80, 90, 128, 100, 110, 120, 0,
    ];
    let original = rgba.clone();
    let settings = adjustments();
    assert_eq!(settings.preset, AdjustmentPreset::Original);
    assert_eq!(settings.blur, 0.0);
    apply_adjustments(&mut rgba, 2, 2, &settings).unwrap();
    assert_eq!(rgba, original);
}
