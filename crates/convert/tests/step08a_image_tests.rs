//! Bounded image/SVG adapter checks for Step 08a (T3).

use std::io::Cursor;

use convert::{
    builtin_registry, ConversionPreviewData, ConvertContext, ConvertError, ConvertOptions,
    ConvertOutputSink, ConvertSource, ImageOptions, OutputDraft, OutputMetadata, PreparedOutput,
};
use image::AnimationDecoder;
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;

fn png(width: u32, height: u32, alpha_pixel: bool) -> Vec<u8> {
    let mut data = vec![255u8; (width * height * 4) as usize];
    if alpha_pixel {
        data[3] = 0;
    }
    let image = image::RgbaImage::from_raw(width, height, data).unwrap();
    encode_png(image)
}

fn png_halves(width: u32, height: u32) -> Vec<u8> {
    let mut data = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let index = ((y * width + x) * 4) as usize;
            let red = x < width / 2;
            data[index] = if red { 255 } else { 0 };
            data[index + 1] = if red { 0 } else { 255 };
            data[index + 2] = 0;
            data[index + 3] = 255;
        }
    }
    encode_png(image::RgbaImage::from_raw(width, height, data).unwrap())
}

fn encode_png(image: image::RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

fn jpeg_with_orientation(width: u32, height: u32, orientation: u16) -> Vec<u8> {
    let source = png_halves(width, height);
    let image = image::load_from_memory(&source).unwrap();
    let mut out = Vec::new();
    let rgb = image.to_rgb8();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    let mut metadata = Metadata::new();
    metadata.set_tag(ExifTag::Orientation(vec![orientation]));
    metadata
        .write_to_vec(&mut out, FileExtension::JPEG)
        .unwrap();
    out
}

fn gif_frames(width: u32, height: u32, frames: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = image::codecs::gif::GifEncoder::new(&mut out);
    for index in 0..frames {
        let mut data = vec![0u8; (width * height * 4) as usize];
        for pixel in data.as_chunks_mut::<4>().0 {
            pixel[0] = 40 * index;
            pixel[1] = 180;
            pixel[2] = 200;
            pixel[3] = 255;
        }
        let buffer = image::RgbaImage::from_raw(width, height, data).unwrap();
        encoder
            .encode_frame(image::Frame::from_parts(
                buffer,
                0,
                0,
                image::Delay::from_numer_denom_ms(100, 1),
            ))
            .unwrap();
    }
    drop(encoder);
    out
}

#[derive(Default)]
struct RecordingSink {
    begins: usize,
    frame: Vec<u8>,
    next: u32,
    open: Option<u32>,
}

impl ConvertOutputSink for RecordingSink {
    fn begin(&mut self, _draft: OutputDraft) -> Result<u32, ConvertError> {
        if self.open.is_some() {
            return Err(ConvertError::BadRequest);
        }
        let index = self.next;
        self.next += 1;
        self.begins += 1;
        self.open = Some(index);
        Ok(index)
    }

    fn write(&mut self, output_index: u32, bytes: &[u8]) -> Result<(), ConvertError> {
        if self.open != Some(output_index) {
            return Err(ConvertError::BadRequest);
        }
        self.frame.extend_from_slice(bytes);
        Ok(())
    }

    fn finish(&mut self, output_index: u32, metadata: OutputMetadata) -> Result<(), ConvertError> {
        if self.open != Some(output_index) || metadata.byte_len != self.frame.len() as u64 {
            return Err(ConvertError::BadRequest);
        }
        self.open = None;
        Ok(())
    }

    fn abort(&mut self, _output_index: u32) -> Result<(), ConvertError> {
        self.frame.clear();
        self.open = None;
        Ok(())
    }
}

fn options(width: Option<u32>, height: Option<u32>) -> ConvertOptions {
    ConvertOptions::Image(ImageOptions {
        width,
        height,
        ..ImageOptions::default()
    })
}

fn run(
    converter_id: &str,
    name: &str,
    mime: &str,
    bytes: Vec<u8>,
    options: ConvertOptions,
    losses: &[convert::MetadataCategory],
    warnings: &[convert::ConversionWarningCode],
) -> (Result<PreparedOutput, ConvertError>, RecordingSink) {
    let registry = builtin_registry();
    let converter = registry.get(converter_id).expect("built-in converter");
    let mut sources = vec![ConvertSource::from_bytes(0, name, mime, bytes, None)];
    let mut context = ConvertContext::new_for_test(1024 * 1024 * 1024);
    let mut sink = RecordingSink::default();
    let result = convert::run_conversion(
        converter,
        &mut sources,
        &options,
        losses,
        warnings,
        &mut sink,
        &mut context,
    );
    (result, sink)
}

fn preview(
    converter_id: &str,
    name: &str,
    mime: &str,
    bytes: Vec<u8>,
    options: ConvertOptions,
) -> ConversionPreviewData {
    let registry = builtin_registry();
    let converter = registry.get(converter_id).expect("built-in converter");
    let mut sources = vec![ConvertSource::from_bytes(0, name, mime, bytes, None)];
    let mut context = ConvertContext::new_for_test(1024 * 1024 * 1024);
    convert::run_preview(converter, &mut sources, &options, &mut context).unwrap()
}

#[test]
fn resize_width_100_of_400x200_is_100x50() {
    let (result, sink) = run(
        "image/png",
        "landscape.png",
        "image/png",
        png(400, 200, false),
        options(Some(100), None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (100, 50));
}

#[test]
fn twenty_by_ten_is_not_enlarged_to_100() {
    let (result, sink) = run(
        "image/png",
        "tiny.png",
        "image/png",
        png(20, 10, false),
        options(Some(100), None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (20, 10));
}

#[test]
fn transparent_jpeg_requires_transparency_loss_before_begin() {
    let bytes = png(40, 20, true);
    let (result, sink) = run(
        "image/jpeg",
        "alpha.png",
        "image/png",
        bytes.clone(),
        options(None, None),
        &[],
        &[],
    );
    assert!(matches!(result, Err(ConvertError::WarningRequired)));
    assert_eq!(sink.begins, 0);
    let (result, sink) = run(
        "image/jpeg",
        "alpha.png",
        "image/png",
        bytes,
        options(None, None),
        &[],
        &[convert::ConversionWarningCode::TransparencyLoss],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (40, 20));
}

#[test]
fn animated_gif_first_frame_requires_animation_first_frame() {
    let bytes = gif_frames(8, 8, 2);
    let (result, sink) = run(
        "image/png",
        "motion.gif",
        "image/gif",
        bytes.clone(),
        options(None, None),
        &[],
        &[],
    );
    assert!(matches!(result, Err(ConvertError::WarningRequired)));
    assert_eq!(sink.begins, 0);
    let (result, sink) = run(
        "image/png",
        "motion.gif",
        "image/gif",
        bytes,
        options(None, None),
        &[],
        &[convert::ConversionWarningCode::AnimationFirstFrame],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (8, 8));
}

#[test]
fn gif_quantization_requires_palette_reduction_and_keeps_animation() {
    let bytes = gif_frames(8, 8, 2);
    let (result, sink) = run(
        "image/gif",
        "motion.gif",
        "image/gif",
        bytes.clone(),
        options(None, None),
        &[],
        &[],
    );
    assert!(matches!(result, Err(ConvertError::WarningRequired)));
    assert_eq!(sink.begins, 0);
    let (result, sink) = run(
        "image/gif",
        "motion.gif",
        "image/gif",
        bytes,
        options(None, None),
        &[],
        &[convert::ConversionWarningCode::PaletteReduction],
    );
    assert!(result.is_ok());
    let decoder = image::codecs::gif::GifDecoder::new(Cursor::new(&sink.frame)).unwrap();
    assert_eq!(decoder.into_frames().count(), 2);
}

#[test]
fn webp_hides_quality_and_keeps_alpha() {
    let registry = builtin_registry();
    let spec = registry.get("image/webp").unwrap().spec();
    assert!(spec.options.iter().all(|option| option.id != "quality"));
    assert!(!spec.lossy);
    let (result, sink) = run(
        "image/webp",
        "alpha.png",
        "image/png",
        png(16, 16, true),
        options(None, None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert!(output.color().has_alpha());
    let rgba = output.to_rgba8();
    assert!(rgba.pixels().any(|pixel| pixel.0[3] < 255));
}

#[test]
fn exif_orientation_6_is_baked_and_the_output_is_orientation_1() {
    let bytes = jpeg_with_orientation(400, 200, 6);
    let (result, sink) = run(
        "image/png",
        "portrait.jpg",
        "image/jpeg",
        bytes,
        options(None, None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (200, 400));
    let rgba = output.to_rgba8();
    let top_left = rgba.get_pixel(2, 2);
    let bottom_left = rgba.get_pixel(2, 397);
    assert!(top_left.0[0] > 180 && top_left.0[1] < 80);
    assert!(bottom_left.0[1] > 180 && bottom_left.0[0] < 80);
    let metadata = Metadata::new_from_vec(
        &sink.frame,
        FileExtension::PNG {
            as_zTXt_chunk: false,
        },
    )
    .unwrap();
    let orientation = metadata
        .get_tag_by_hex(0x0112, None)
        .next()
        .expect("orientation tag");
    assert_eq!(orientation, &ExifTag::Orientation(vec![1]));
}

#[test]
fn svg_https_resources_are_never_resolved() {
    let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">
        <rect width="64" height="32" fill="#ff0000"/>
        <image href="https://example.com/remote.png" width="64" height="32"/>
    </svg>"##;
    let (result, sink) = run(
        "svg/png",
        "picture.svg",
        "image/svg+xml",
        svg.to_vec(),
        options(None, None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (64, 32));
    let pixel = output.to_rgba8().get_pixel(10, 10).0;
    assert!(pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60);
}

#[test]
fn svg_document_type_declarations_are_refused() {
    let svg = br#"<!DOCTYPE svg SYSTEM "https://example.com/a.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>"#;
    let (result, sink) = run(
        "svg/png",
        "hostile.svg",
        "image/svg+xml",
        svg.to_vec(),
        options(None, None),
        &[],
        &[],
    );
    assert!(matches!(result, Err(ConvertError::Unsupported)));
    assert_eq!(sink.begins, 0);
}

#[test]
fn preview_and_actual_use_the_same_option_box() {
    let bytes = png(400, 200, false);
    let preview = preview(
        "image/png",
        "landscape.png",
        "image/png",
        bytes.clone(),
        options(Some(100), None),
    );
    assert_eq!((preview.width, preview.height), (100, 50));
    assert!(preview.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    let (result, sink) = run(
        "image/png",
        "landscape.png",
        "image/png",
        bytes,
        options(Some(100), None),
        &[],
        &[],
    );
    assert!(result.is_ok());
    let output = image::load_from_memory(&sink.frame).unwrap();
    assert_eq!((output.width(), output.height()), (100, 50));
}

#[test]
fn oversized_dimensions_are_refused_before_pixels() {
    let (result, sink) = run(
        "image/png",
        "landscape.png",
        "image/png",
        png(400, 200, false),
        options(Some(70_000), None),
        &[],
        &[],
    );
    assert!(matches!(result, Err(ConvertError::BadRequest)));
    assert_eq!(sink.begins, 0);
}
