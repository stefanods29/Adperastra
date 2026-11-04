//! Registry and contract checks for Step 08a (T1).

use convert::{
    builtin_registry, options, ConversionPreviewData, ConvertContext, ConvertError, ConvertOptions,
    ConvertOutputSink, ConvertSource, Converter, ConverterId, ConverterRegistry, ConverterSpec,
    FormatId, ImageOptions, OutputDraft, OutputMetadata, PdfConversionOptions, PreparedOutput,
};

struct FakeConverter {
    id: &'static str,
}

impl Converter for FakeConverter {
    fn spec(&self) -> ConverterSpec {
        ConverterSpec {
            id: ConverterId::parse(self.id).unwrap(),
            inputs: vec![FormatId::Png],
            output: FormatId::Jpeg,
            options: vec![],
            input_mode: "each".to_string(),
            max_input_bytes: 1024,
            max_output_bytes: 1024,
            lossy: true,
            preserves: vec![],
            engine_id: "fake-1".to_string(),
            available: true,
            help_slug: "converting-files".to_string(),
        }
    }

    fn preview(
        &self,
        _inputs: &mut [ConvertSource],
        _options: &ConvertOptions,
        _context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError> {
        Err(ConvertError::Unsupported)
    }

    fn convert(
        &self,
        _inputs: &mut [ConvertSource],
        _options: &ConvertOptions,
        _output: &mut dyn ConvertOutputSink,
        _context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        Err(ConvertError::Unsupported)
    }
}

#[test]
fn duplicate_converter_id_is_refused() {
    let mut registry = ConverterRegistry::new();
    registry
        .register(Box::new(FakeConverter { id: "image/png" }))
        .unwrap();
    assert!(matches!(
        registry.register(Box::new(FakeConverter { id: "image/png" })),
        Err(ConvertError::BadRequest)
    ));
}

#[test]
fn mismatched_typed_options_are_refused_before_any_output() {
    let registry = builtin_registry();
    let converter = registry.get("image/png").unwrap();
    let mut sources = vec![ConvertSource::from_bytes(
        0,
        "photo.png",
        "image/png",
        crate::fixtures::png(4, 4, true),
        None,
    )];
    let options = ConvertOptions::Pdf(PdfConversionOptions::default());
    let mut context = ConvertContext::new_for_test(1024 * 1024);
    let mut sink = crate::fixtures::RecordingSink::default();
    let result = convert::run_conversion(
        converter,
        &mut sources,
        &options,
        &[],
        &[],
        &mut sink,
        &mut context,
    );
    assert!(matches!(result, Err(ConvertError::BadRequest)));
    assert_eq!(sink.begins, 0);
}

#[test]
fn unsupported_avif_output_is_not_advertised() {
    let registry = builtin_registry();
    let specs = registry.specs();
    let images: Vec<_> = specs
        .iter()
        .filter(|spec| spec.output.mime().starts_with("image/"))
        .collect();
    assert!(!images.is_empty());
    for spec in images {
        assert_ne!(spec.id.as_str(), "image/avif");
        assert!(spec.available);
        assert!(spec.output.is_writable_image());
    }
    assert!(registry.get("image/avif").is_none());
}

#[test]
fn defaults_keep_quality_90_and_metadata() {
    let image = ImageOptions::default();
    assert_eq!(image.quality, 90);
    assert!(image.keep_aspect);
    assert!(!image.allow_upscale);
    assert!(image.metadata_keep);
    assert!(!image.first_frame);
    let registry = builtin_registry();
    let jpeg = registry.get("image/jpeg").unwrap().spec();
    let quality = jpeg
        .options
        .iter()
        .find(|option| option.id == "quality")
        .unwrap();
    assert_eq!(quality.default.as_i64(), Some(90));
    let webp = registry.get("image/webp").unwrap().spec();
    assert!(webp.options.iter().all(|option| option.id != "quality"));
    assert!(!webp.lossy);
}

#[test]
fn naming_defaults_and_output_names() {
    let naming = convert::ConversionNaming::default();
    assert!(naming.validate().is_ok());
    assert_eq!(naming.pattern, "{stem}.{ext}");
    assert_eq!(options::output_stem("report.final.pdf"), "report.final");
    assert_eq!(options::output_name("photo", FormatId::Jpeg), "photo.jpg");
    assert_eq!(options::output_name("seven", FormatId::SevenZ), "seven.7z");
    assert_eq!(options::collision_name("photo.jpg", 0), "photo.jpg");
    assert_eq!(options::collision_name("photo.jpg", 2), "photo (2).jpg");
    let mut bad = naming.clone();
    bad.pattern = "{stem}.{ext}.{ext}".to_string();
    assert!(bad.validate().is_err());
    assert!(convert::types::is_utc_date("2026-11-02"));
    assert!(!convert::types::is_utc_date("2026-02-30"));
}

#[test]
fn only_the_default_pattern_is_accepted_this_round() {
    let request = convert::ConversionRequest {
        inputs: vec![convert::ConversionInput::file(r"C:\pictures\photo.png")],
        converter_id: ConverterId::parse("image/png").unwrap(),
        options: ConvertOptions::Image(ImageOptions::default()),
        dest_dir: r"C:\out".to_string(),
        keep_original: true,
        accepted_losses: Vec::new(),
        accepted_warning_codes: Vec::new(),
        request_revision: 1,
        naming: convert::ConversionNaming {
            pattern: "{stem}-{index}.{ext}".to_string(),
            date_utc: "2026-11-02".to_string(),
            start_index: 1,
        },
    };
    assert!(matches!(request.validate(), Err(ConvertError::BadRequest)));
    let mut keep_original_off = request.clone();
    keep_original_off.keep_original = false;
    keep_original_off.naming = convert::ConversionNaming::default();
    assert!(matches!(
        keep_original_off.validate(),
        Err(ConvertError::BadRequest)
    ));
}

#[test]
fn an_output_draft_carries_no_path() {
    // The adapter names a hint only; the parent derives the real path.
    let draft = OutputDraft {
        name_hint: "photo.png".to_string(),
        name_part: convert::OutputNamePart::None,
        mime: "image/png".to_string(),
        input_indices: vec![0],
    };
    let json = serde_json::to_string(&draft).unwrap();
    assert!(!json.contains("dest"));
    assert!(!json.contains("path"));
}

mod fixtures {
    use super::*;

    pub fn png(width: u32, height: u32, alpha: bool) -> Vec<u8> {
        let mut data = vec![255u8; (width * height * 4) as usize];
        if alpha {
            // One fully transparent pixel proves the alpha channel.
            data[3] = 0;
        }
        let image = image::RgbaImage::from_raw(width, height, data).unwrap();
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[derive(Default)]
    pub struct RecordingSink {
        pub begins: usize,
        pub frames: Vec<Vec<u8>>,
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
            self.frames.push(Vec::new());
            self.open = Some(index);
            Ok(index)
        }

        fn write(&mut self, output_index: u32, bytes: &[u8]) -> Result<(), ConvertError> {
            if self.open != Some(output_index) {
                return Err(ConvertError::BadRequest);
            }
            self.frames[output_index as usize].extend_from_slice(bytes);
            Ok(())
        }

        fn finish(
            &mut self,
            output_index: u32,
            metadata: OutputMetadata,
        ) -> Result<(), ConvertError> {
            if self.open != Some(output_index) {
                return Err(ConvertError::BadRequest);
            }
            if metadata.byte_len != self.frames[output_index as usize].len() as u64 {
                return Err(ConvertError::BadRequest);
            }
            self.open = None;
            Ok(())
        }

        fn abort(&mut self, output_index: u32) -> Result<(), ConvertError> {
            if let Some(frame) = self.frames.get_mut(output_index as usize) {
                frame.clear();
            }
            self.open = None;
            Ok(())
        }
    }
}
