//! The raster image adapter (Step 08a T3). One input becomes one output.

use sha2::{Digest, Sha256};

use crate::error::ConvertError;
use crate::image_decode::{decode_gif_frames, decode_image, preview_png};
use crate::image_encode::{encode_gif_frames, encode_image, estimated_bytes};
use crate::metadata::attach_metadata;
use crate::options::{output_stem, preflight, source_format};
use crate::registry::{ConvertContext, ConvertOutputSink, ConvertSource, Converter};
use crate::types::{
    ConversionPreviewData, ConvertOptions, ConverterId, ConverterSpec, FormatId, MetadataCategory,
    OptionSpec, OutputDraft, OutputMetadata, OutputNamePart, PreparedOutput, MAX_IMAGE_INPUT_BYTES,
    MAX_IMAGE_OUTPUT_BYTES, PREVIEW_EDGE,
};

const RASTER_INPUTS: [FormatId; 7] = [
    FormatId::Png,
    FormatId::Jpeg,
    FormatId::Webp,
    FormatId::Bmp,
    FormatId::Gif,
    FormatId::Tiff,
    FormatId::Ico,
];

/// One output format of the image engine.
pub struct ImageConverter {
    target: FormatId,
}

impl ImageConverter {
    pub fn new(target: FormatId) -> Self {
        Self { target }
    }

    fn id(&self) -> ConverterId {
        let segment = if self.target == FormatId::Jpeg {
            "jpeg".to_string()
        } else {
            self.target.extension().to_string()
        };
        ConverterId::parse(&format!("image/{segment}")).expect("static converter id")
    }

    fn options(&self) -> Vec<OptionSpec> {
        // 0 means "keep the source size"; the dialog maps it to no value.
        let mut options = vec![
            OptionSpec::integer("width", "convert.width", 0, 0, 65_536),
            OptionSpec::integer("height", "convert.height", 0, 0, 65_536),
            OptionSpec::boolean("keep_aspect", "convert.keepAspect", true),
            OptionSpec::boolean("allow_upscale", "convert.allowUpscale", false),
        ];
        if self.target == FormatId::Jpeg {
            options.insert(
                0,
                OptionSpec::integer("quality", "convert.quality", 90, 1, 100),
            );
        }
        options
    }

    fn preserves(&self) -> Vec<MetadataCategory> {
        if self.target == FormatId::Jpeg {
            // EXIF-family categories only. ICC/XMP/IPTC are copied opaquely
            // for a JPEG source but are not promised for every input.
            vec![
                MetadataCategory::Exif,
                MetadataCategory::Gps,
                MetadataCategory::Camera,
                MetadataCategory::Date,
                MetadataCategory::Author,
                MetadataCategory::Comments,
            ]
        } else if matches!(self.target, FormatId::Png | FormatId::Tiff | FormatId::Webp) {
            vec![
                MetadataCategory::Exif,
                MetadataCategory::Gps,
                MetadataCategory::Camera,
                MetadataCategory::Date,
                MetadataCategory::Author,
                MetadataCategory::Comments,
            ]
        } else {
            Vec::new()
        }
    }
}

impl Converter for ImageConverter {
    fn spec(&self) -> ConverterSpec {
        ConverterSpec {
            id: self.id(),
            inputs: RASTER_INPUTS.to_vec(),
            output: self.target,
            options: self.options(),
            input_mode: "each".to_string(),
            max_input_bytes: MAX_IMAGE_INPUT_BYTES,
            max_output_bytes: MAX_IMAGE_OUTPUT_BYTES,
            lossy: matches!(self.target, FormatId::Jpeg | FormatId::Gif),
            preserves: self.preserves(),
            engine_id: "image-0.25.10".to_string(),
            available: self.target.is_writable_image(),
            help_slug: "converting-files".to_string(),
        }
    }

    fn preview(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError> {
        let ConvertOptions::Image(image_options) = options else {
            return Err(ConvertError::BadRequest);
        };
        if inputs.len() != 1 {
            return Err(ConvertError::BadRequest);
        }
        context.check_output_budget(crate::types::MAX_PREVIEW_BYTES as u64)?;
        let spec = self.spec();
        let required = preflight(&spec, inputs, options)?;
        let source = &mut inputs[0];
        let format = source_format(source)?;
        let bytes = source.read_bounded(spec.max_input_bytes)?;
        let facts = crate::options::inspect_image(&bytes, format)?;
        let decoded = decode_image(&bytes, format, image_options)?;
        let (png, width, height) = preview_png(&decoded.image, PREVIEW_EDGE)?;
        let source_pixels = u64::from(facts.width) * u64::from(facts.height);
        let output_pixels = u64::from(width) * u64::from(height);
        let estimated = estimated_bytes(
            source.byte_len,
            source_pixels.max(1),
            output_pixels,
            self.target,
        );
        let estimated_ms = (source_pixels / 2_000_000).max(1) * 120;
        Ok(ConversionPreviewData {
            png,
            width,
            height,
            estimated_bytes: Some(estimated),
            estimated_ms: Some(estimated_ms),
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
        let ConvertOptions::Image(image_options) = options else {
            return Err(ConvertError::BadRequest);
        };
        if inputs.len() != 1 {
            return Err(ConvertError::BadRequest);
        }
        let spec = self.spec();
        let required = preflight(&spec, inputs, options)?;
        let source = &mut inputs[0];
        let format = source_format(source)?;
        let bytes = source.read_bounded(spec.max_input_bytes)?;
        let facts = crate::options::inspect_image(&bytes, format)?;
        if context.is_cancelled() {
            return Err(ConvertError::Cancelled);
        }
        let keep_animation = self.target == FormatId::Gif
            && format == FormatId::Gif
            && facts.animated
            && !image_options.first_frame;
        let (mut encoded, output_width, output_height) = if keep_animation {
            let frames = decode_gif_frames(&bytes, image_options)?;
            let (width, height) = frames
                .first()
                .map(|frame| (frame.buffer().width(), frame.buffer().height()))
                .unwrap_or((facts.width, facts.height));
            (encode_gif_frames(frames, image_options)?, width, height)
        } else {
            let decoded = decode_image(&bytes, format, image_options)?;
            let (width, height) = (decoded.image.width(), decoded.image.height());
            (
                encode_image(&decoded.image, self.target, image_options)?,
                width,
                height,
            )
        };
        context.check_output_budget(encoded.len() as u64)?;
        let lost = attach_metadata(
            &mut encoded,
            self.target,
            &bytes,
            format,
            image_options.metadata_keep,
        )?;
        // A loss the preflight predicted is already accepted; one it did
        // not predict aborts before the first byte is published.
        if lost
            .iter()
            .any(|category| !required.metadata_lost.contains(category))
        {
            return Err(ConvertError::MetadataLoss);
        }
        if context.is_cancelled() {
            return Err(ConvertError::Cancelled);
        }
        let stem = output_stem(&source.name);
        let index = output.begin(OutputDraft {
            name_hint: format!("{stem}.{}", self.target.extension()),
            name_part: OutputNamePart::None,
            mime: self.target.mime().to_string(),
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
            width: Some(output_width),
            height: Some(output_height),
            metadata_lost: lost,
            warnings: required.warnings.clone(),
            hash_sha256: hex(&digest),
        };
        if let Err(error) = output.finish(index, metadata) {
            let _ = output.abort(index);
            return Err(error);
        }
        Ok(PreparedOutput {
            outputs_count: 1,
            metadata_lost: required.metadata_lost,
            warnings: required.warnings,
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
