//! Pure conversion for Step 08a (`conversion-2`).
//!
//! The crate uses only helper-owned readers and a caller-owned output sink.
//! It has no Tauri, no filesystem publication and no user path: the native
//! parent guards sources, owns staging files and publishes without replace.

pub mod error;
pub mod image_adapter;
pub mod image_decode;
pub mod image_encode;
pub mod metadata;
pub mod options;
pub mod registry;
pub mod svg;
pub mod svg_adapter;
pub mod types;

pub use error::ConvertError;
pub use registry::{
    ConvertContext, ConvertOutputSink, ConvertSource, Converter, ConverterRegistry, ReadSeek,
};
pub use types::{
    ArchiveConversionOptions, ConversionInput, ConversionNaming, ConversionOutput,
    ConversionPreviewData, ConversionPreviewRequest, ConversionReport, ConversionRequest,
    ConversionWarningCode, ConvertOptions, ConverterId, ConverterSpec, DocumentConversionOptions,
    FormatId, ImageOptions, MediaConversionOptions, MetadataCategory, OfficeConversionOptions,
    OptionSpec, OutputDraft, OutputMetadata, OutputNamePart, PageRange, PdfConversionOptions,
    PreparedOutput, TableConversionOptions, WorkItemResult, WorkItemStatus,
};

/// The adapters this build really ships. AVIF output, media and Office are
/// not registered: an unavailable converter is never advertised as working.
pub fn builtin_registry() -> ConverterRegistry {
    let mut registry = ConverterRegistry::new();
    for target in [
        FormatId::Png,
        FormatId::Jpeg,
        FormatId::Webp,
        FormatId::Bmp,
        FormatId::Gif,
        FormatId::Tiff,
    ] {
        let _ = registry.register(Box::new(image_adapter::ImageConverter::new(target)));
    }
    let _ = registry.register(Box::new(svg_adapter::SvgConverter));
    registry
}

/// Preflight then convert. Both the native parent and the helper call this
/// so no adapter can begin an output before every required change is
/// accepted.
pub fn run_conversion(
    converter: &dyn Converter,
    sources: &mut [ConvertSource],
    options: &ConvertOptions,
    accepted_losses: &[MetadataCategory],
    accepted_warnings: &[ConversionWarningCode],
    sink: &mut dyn ConvertOutputSink,
    context: &mut ConvertContext,
) -> Result<PreparedOutput, ConvertError> {
    let spec = converter.spec();
    spec.validate()?;
    if !spec.available {
        return Err(ConvertError::Unsupported);
    }
    options.validate()?;
    let required = options::preflight(&spec, sources, options)?;
    options::verify_accepted(&required, accepted_losses, accepted_warnings)?;
    converter.convert(sources, options, sink, context)
}

/// One bounded preview with the same options as the real conversion.
pub fn run_preview(
    converter: &dyn Converter,
    sources: &mut [ConvertSource],
    options: &ConvertOptions,
    context: &mut ConvertContext,
) -> Result<ConversionPreviewData, ConvertError> {
    let spec = converter.spec();
    spec.validate()?;
    if !spec.available {
        return Err(ConvertError::Unsupported);
    }
    options.validate()?;
    let preview = converter.preview(sources, options, context)?;
    preview.validate()?;
    Ok(preview)
}
