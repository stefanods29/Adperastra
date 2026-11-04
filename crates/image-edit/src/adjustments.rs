//! Deterministic adjustment math (D5/D6). Mirrors
//! `src/image-edit/adjustments.ts`; every stage clamps to 0..=1 and alpha is
//! never changed.

use crate::types::{
    AdjustmentPreset, ImageAdjustments, BAD_REQUEST, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS,
};

pub fn clamp01(value: f32) -> f32 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 1.0)
}

pub fn brightness_channel(value: f32, brightness: f32) -> f32 {
    clamp01(value + brightness)
}

pub fn contrast_channel(value: f32, contrast: f32) -> f32 {
    clamp01((value - 0.5) * (1.0 + contrast) + 0.5)
}

pub fn luminance(red: f32, green: f32, blue: f32) -> f32 {
    0.2126 * red + 0.7152 * green + 0.0722 * blue
}

pub fn saturation_channels(red: f32, green: f32, blue: f32, saturation: f32) -> [f32; 3] {
    let y = luminance(red, green, blue);
    [
        clamp01(y + (red - y) * (1.0 + saturation)),
        clamp01(y + (green - y) * (1.0 + saturation)),
        clamp01(y + (blue - y) * (1.0 + saturation)),
    ]
}

pub fn warmth_channels(red: f32, green: f32, blue: f32, warmth: f32) -> [f32; 3] {
    [
        clamp01(red + 0.1 * warmth),
        clamp01(green),
        clamp01(blue - 0.1 * warmth),
    ]
}

pub fn sepia_channels(red: f32, green: f32, blue: f32) -> [f32; 3] {
    [
        clamp01(0.393 * red + 0.769 * green + 0.189 * blue),
        clamp01(0.349 * red + 0.686 * green + 0.168 * blue),
        clamp01(0.272 * red + 0.534 * green + 0.131 * blue),
    ]
}

pub fn apply_preset(preset: AdjustmentPreset) -> ImageAdjustments {
    let mut adjustments = ImageAdjustments {
        preset,
        ..ImageAdjustments::default()
    };
    match preset {
        AdjustmentPreset::Vivid => {
            adjustments.contrast = 0.15;
            adjustments.saturation = 0.2;
        }
        AdjustmentPreset::Warm => adjustments.warmth = 0.3,
        AdjustmentPreset::Cool => adjustments.warmth = -0.3,
        AdjustmentPreset::Bw => adjustments.saturation = -1.0,
        AdjustmentPreset::Sepia | AdjustmentPreset::Original | AdjustmentPreset::Custom => {}
    }
    adjustments
}

fn round_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round().clamp(0.0, 255.0) as u8
}

fn pixel(red: f32, green: f32, blue: f32, adjustments: &ImageAdjustments) -> [f32; 3] {
    let mut channels = [
        brightness_channel(red, adjustments.brightness as f32),
        brightness_channel(green, adjustments.brightness as f32),
        brightness_channel(blue, adjustments.brightness as f32),
    ];
    for channel in &mut channels {
        *channel = contrast_channel(*channel, adjustments.contrast as f32);
    }
    channels = saturation_channels(
        channels[0],
        channels[1],
        channels[2],
        adjustments.saturation as f32,
    );
    channels = warmth_channels(
        channels[0],
        channels[1],
        channels[2],
        adjustments.warmth as f32,
    );
    if adjustments.preset == AdjustmentPreset::Sepia {
        channels = sepia_channels(channels[0], channels[1], channels[2]);
    }
    channels
}

fn at(rgba: &[u8], width: usize, height: usize, x: isize, y: isize, channel: usize) -> f32 {
    let cx = x.clamp(0, width as isize - 1) as usize;
    let cy = y.clamp(0, height as isize - 1) as usize;
    f32::from(rgba[(cy * width + cx) * 4 + channel]) / 255.0
}

fn sharpen(source: &[u8], width: usize, height: usize, amount: f32, target: &mut [u8]) {
    for y in 0..height {
        for x in 0..width {
            for channel in 0..3 {
                let center = at(source, width, height, x as isize, y as isize, channel);
                let kernel = 5.0 * center
                    - at(source, width, height, x as isize - 1, y as isize, channel)
                    - at(source, width, height, x as isize + 1, y as isize, channel)
                    - at(source, width, height, x as isize, y as isize - 1, channel)
                    - at(source, width, height, x as isize, y as isize + 1, channel);
                let value = clamp01(center + amount * (kernel - center));
                target[(y * width + x) * 4 + channel] = round_byte(value);
            }
        }
    }
}

fn blur(source: &[u8], width: usize, height: usize, radius: f32, target: &mut [u8]) {
    if radius <= 0.0 {
        target.copy_from_slice(source);
        return;
    }
    let sigma = (radius / 3.0).max(0.1);
    let support = radius.ceil() as isize;
    let mut kernel = Vec::with_capacity((support * 2 + 1) as usize);
    let mut sum = 0.0f32;
    for offset in -support..=support {
        let weight = (-(offset * offset) as f32 / (2.0 * sigma * sigma)).exp();
        kernel.push(weight);
        sum += weight;
    }
    for weight in &mut kernel {
        *weight /= sum;
    }
    let mut horizontal = vec![0.0f32; width * height * 3];
    for y in 0..height {
        for x in 0..width {
            for channel in 0..3 {
                let mut value = 0.0;
                for offset in -support..=support {
                    let cx = (x as isize + offset).clamp(0, width as isize - 1) as usize;
                    value += f32::from(source[(y * width + cx) * 4 + channel])
                        * kernel[(offset + support) as usize];
                }
                horizontal[(y * width + x) * 3 + channel] = value;
            }
        }
    }
    for y in 0..height {
        for x in 0..width {
            for channel in 0..3 {
                let mut value = 0.0;
                for offset in -support..=support {
                    let cy = (y as isize + offset).clamp(0, height as isize - 1) as usize;
                    value += horizontal[(cy * width + x) * 3 + channel]
                        * kernel[(offset + support) as usize];
                }
                target[(y * width + x) * 4 + channel] = value.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// Applies every stage in place. `rgba` is straight (unpremultiplied) RGBA8.
pub fn apply_adjustments(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    adjustments: &ImageAdjustments,
) -> Result<(), String> {
    adjustments.validate()?;
    if width == 0 || height == 0 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE {
        return Err(BAD_REQUEST.to_string());
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err("image_edit.too_large".to_string());
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(BAD_REQUEST.to_string());
    }
    let alpha: Vec<u8> = rgba.iter().skip(3).step_by(4).copied().collect();
    for index in 0..(width as usize * height as usize) {
        let offset = index * 4;
        let channels = pixel(
            f32::from(rgba[offset]) / 255.0,
            f32::from(rgba[offset + 1]) / 255.0,
            f32::from(rgba[offset + 2]) / 255.0,
            adjustments,
        );
        rgba[offset] = round_byte(channels[0]);
        rgba[offset + 1] = round_byte(channels[1]);
        rgba[offset + 2] = round_byte(channels[2]);
    }
    if adjustments.sharpness > 0.0 {
        let source = rgba.to_vec();
        sharpen(
            &source,
            width as usize,
            height as usize,
            adjustments.sharpness as f32,
            rgba,
        );
    }
    if adjustments.blur > 0.0 {
        let source = rgba.to_vec();
        blur(
            &source,
            width as usize,
            height as usize,
            adjustments.blur as f32,
            rgba,
        );
    }
    for (index, value) in alpha.into_iter().enumerate() {
        rgba[index * 4 + 3] = value;
    }
    Ok(())
}
