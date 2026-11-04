//! Pure conversion for Step 08a (`conversion-2`).
//!
//! The crate uses only helper-owned readers and a caller-owned output sink.
//! It has no Tauri, no filesystem publication and no user path: the native
//! parent guards sources, owns staging files and publishes without replace.

pub mod adapters;
pub mod archive_adapter;
pub mod csv_output;
pub mod document;
pub mod error;
pub mod image_adapter;
pub mod image_decode;
pub mod image_encode;
pub mod media_adapter;
pub mod metadata;
pub mod naming;
pub mod options;
pub mod pdf;
pub mod registry;
pub mod svg;
pub mod svg_adapter;
pub mod table;
pub mod table_read;
pub mod table_write;
pub mod types;

pub use error::ConvertError;
pub use media_adapter::{
    gif_warning_codes, media_converter_spec, require_acknowledged, validate_media_options,
    GifSourceFacts, GIF_TIMESTAMP_US,
};
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
///
/// Archive adapters need a native-owned work root for their bounded
/// intermediate files, so they are registered only by
/// [`builtin_registry_with_work_root`]; without a root they stay absent and
/// every archive request fails closed.
pub fn builtin_registry() -> ConverterRegistry {
    register_builtins(None)
}

/// The same table plus the Step 08b archive adapters, which own their
/// intermediate folders under `work_root`. The root belongs to the native
/// parent (app data `convert-input`); the helper never creates a second one.
pub fn builtin_registry_with_work_root(work_root: std::path::PathBuf) -> ConverterRegistry {
    register_builtins(Some(work_root))
}

fn register_builtins(work_root: Option<std::path::PathBuf>) -> ConverterRegistry {
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
    // The Step 08b table adapters read typed cells and prepare bounded
    // output bytes; the common queue, preview, publication and report stay
    // in the parent.
    for id in table::TABLE_CONVERTER_IDS {
        if let Ok(converter) = table::TableConverter::new(id) {
            let _ = registry.register(Box::new(converter));
        }
    }
    if let Some(work_root) = work_root {
        for id in archive_adapter::ARCHIVE_CONVERTER_IDS {
            if let Ok(converter) = archive_adapter::ArchiveConverter::new(id, work_root.clone()) {
                let _ = registry.register(Box::new(converter));
            }
        }
    }
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
    let mut required = options::preflight(&spec, sources, options)?;
    // Adapters that must read the source to know their warnings report them
    // here; a missing acknowledgement still blocks before `sink.begin`.
    let adapter_warnings = converter.required_warnings(sources, options)?;
    if !adapter_warnings.is_empty() {
        required.warnings.extend(adapter_warnings);
        let mut seen = std::collections::BTreeSet::new();
        required.warnings.retain(|warning| {
            serde_json::to_string(warning)
                .map(|key| seen.insert(key))
                .unwrap_or(false)
        });
    }
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
