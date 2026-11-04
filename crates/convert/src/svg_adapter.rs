//! The SVG to PNG adapter (Step 08a D1). One vector input becomes one PNG.

use sha2::{Digest, Sha256};

use crate::error::ConvertError;
use crate::image_decode::preview_png;
use crate::image_encode::encode_image;
use crate::options::{output_stem, preflight, source_format};
use crate::registry::{ConvertContext, ConvertOutputSink, ConvertSource, Converter};
use crate::svg::render_svg;
use crate::types::{
    ConversionPreviewData, ConvertOptions, ConverterId, ConverterSpec, FormatId, ImageOptions,
    OptionSpec, OutputDraft, OutputMetadata, OutputNamePart, PreparedOutput, MAX_IMAGE_INPUT_BYTES,
    MAX_IMAGE_OUTPUT_BYTES, PREVIEW_EDGE,
};

pub struct SvgConverter;

impl SvgConverter {
    fn image_options(options: &ConvertOptions) -> Result<&ImageOptions, ConvertError> {
        match options {
            ConvertOptions::Image(image) => Ok(image),
            _ => Err(ConvertError::BadRequest),
        }
    }
}

impl Converter for SvgConverter {
    fn spec(&self) -> ConverterSpec {
        ConverterSpec {
            id: ConverterId::parse("svg/png").expect("static converter id"),
            inputs: vec![FormatId::Svg],
            output: FormatId::Png,
            options: vec![
                OptionSpec::integer("width", "convert.width", 0, 0, 65_536),
                OptionSpec::integer("height", "convert.height", 0, 0, 65_536),
                OptionSpec::boolean("keep_aspect", "convert.keepAspect", true),
            ],
            input_mode: "each".to_string(),
            max_input_bytes: MAX_IMAGE_INPUT_BYTES,
            max_output_bytes: MAX_IMAGE_OUTPUT_BYTES,
            lossy: false,
            preserves: Vec::new(),
            engine_id: "resvg-0.49.0".to_string(),
            available: true,
            help_slug: "converting-files".to_string(),
        }
    }

    fn preview(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError> {
        let image_options = Self::image_options(options)?;
        if inputs.len() != 1 {
            return Err(ConvertError::BadRequest);
        }
        context.check_output_budget(crate::types::MAX_PREVIEW_BYTES as u64)?;
        let spec = self.spec();
        let required = preflight(&spec, inputs, options)?;
        let source = &mut inputs[0];
        if source_format(source)? != FormatId::Svg {
            return Err(ConvertError::Unsupported);
        }
        let bytes = source.read_bounded(spec.max_input_bytes)?;
        // Same option box as the real output, then the preview's own cap.
        let image = render_svg(&bytes, image_options, None)?;
        let (png, width, height) = preview_png(&image, PREVIEW_EDGE)?;
        Ok(ConversionPreviewData {
            png,
            width,
            height,
            estimated_bytes: Some(image.width() as u64 * image.height() as u64 * 4),
            estimated_ms: Some(120),
            warnings: required.warnings,
            metadata_lost: required.metadata_lost,
        })
    }

    fn convert(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        let image_options = Self::image_options(options)?;
        if inputs.len() != 1 {
            return Err(ConvertError::BadRequest);
        }
        let spec = self.spec();
        preflight(&spec, inputs, options)?;
        let source = &mut inputs[0];
        if source_format(source)? != FormatId::Svg {
            return Err(ConvertError::Unsupported);
        }
        let bytes = source.read_bounded(spec.max_input_bytes)?;
        if context.is_cancelled() {
            return Err(ConvertError::Cancelled);
        }
        let image = render_svg(&bytes, image_options, None)?;
        let encoded = encode_image(&image, FormatId::Png, image_options)?;
        context.check_output_budget(encoded.len() as u64)?;
        let stem = output_stem(&source.name);
        let index = output.begin(OutputDraft {
            name_hint: format!("{stem}.png"),
            name_part: OutputNamePart::None,
            mime: FormatId::Png.mime().to_string(),
            input_indices: vec![source.input_index],
        })?;
        if index != 0 {
            let _ = output.abort(index);
            return Err(ConvertError::BadRequest);
        }
        let mut hash = Sha256::new();
        let mut written = 0u64;
        let total_chunks = encoded.len().div_ceil(1024 * 1024);
        for (step, chunk) in encoded.chunks(1024 * 1024).enumerate() {
            if context.is_cancelled() {
                let _ = output.abort(index);
                return Err(ConvertError::Cancelled);
            }
            if let Err(error) = output.write(index, chunk) {
                let _ = output.abort(index);
                return Err(error);
            }
            hash.update(chunk);
            written += chunk.len() as u64;
            if let Err(error) = context.report(fs_service::OpProgress {
                items_done: step,
                items_total: total_chunks,
                bytes_done: written,
                bytes_total: encoded.len() as u64,
                current: source.name.clone(),
            }) {
                let _ = output.abort(index);
                return Err(error);
            }
        }
        let digest = hash.finalize();
        let metadata = OutputMetadata {
            byte_len: written,
            width: Some(image.width()),
            height: Some(image.height()),
            metadata_lost: Vec::new(),
            warnings: Vec::new(),
            hash_sha256: hex(&digest),
        };
        if let Err(error) = output.finish(index, metadata) {
            let _ = output.abort(index);
            return Err(error);
        }
        Ok(PreparedOutput {
            outputs_count: 1,
            metadata_lost: Vec::new(),
            warnings: Vec::new(),
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}
