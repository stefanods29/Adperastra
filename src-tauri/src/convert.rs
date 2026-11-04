//! Native conversion facade (Step 08a T4). The work lives in
//! `convert_jobs`/`convert_publish`/`convert_helper`; this module names the
//! public surface the coordinator registers.

pub use crate::convert_jobs::{
    convert_preview_start, convert_report_page, convert_start, run_job, run_preview_job,
    ConversionPreview,
};
pub use crate::convert_publish::{PublishSink, PublishedOutput, FREE_SPACE_MARGIN};

use std::path::PathBuf;

use convert::{
    ConversionPreviewData, ConvertContext, ConvertError, ConvertOptions, ConvertOutputSink,
    ConvertSource, Converter, ConverterRegistry, ConverterSpec, PreparedOutput,
};
use tauri::{AppHandle, Manager};

/// The stable area name every error code starts with.
pub const AREA: &str = "convert";

/// Specs whose work runs in the existing native PDF/document helpers
/// (`conversion_pdf.rs`, `conversion_documents.rs`), not in the pure
/// conversion helper child. `images/pdf` combines several guarded images in
/// the trusted PDF-write helper; the rest run one input per invocation.
/// They register through the same Step 08a table so one registry owns every
/// advertised ID.
pub const NATIVE_HELPER_CONVERTER_IDS: [&str; 6] = [
    "images/pdf",
    "pdf/png",
    "pdf/jpeg",
    "markdown/html",
    "markdown/pdf",
    "html/pdf",
];

/// The native-owned root for bounded intermediate conversion files. It is
/// the same app data `convert-input` folder the PDF and document helpers
/// already use, so one location owns all temporary conversion work.
pub fn conversion_work_root(app: &AppHandle) -> PathBuf {
    app.state::<crate::AppState>()
        .data_dir()
        .join("convert-input")
}

/// The registry the parent uses: the pure adapters plus the archive adapters
/// with their native work root, plus the spec entries for the existing
/// native PDF/document helpers. No second registry or queue exists.
pub fn conversion_registry(app: &AppHandle) -> ConverterRegistry {
    let mut registry = ::convert::builtin_registry_with_work_root(conversion_work_root(app));
    for spec in ::convert::adapters::adapter_specs_08b() {
        if NATIVE_HELPER_CONVERTER_IDS.contains(&spec.id.as_str()) {
            let _ = registry.register(Box::new(NativeHelperSpec(spec)));
        }
    }
    register_media_specs(app, &mut registry);
    registry
}

/// Register the three media converters through the same 08a table. The spec
/// is only enabled when the engine host can acquire the verified
/// `media.encode` pack; without it the spec stays advertised as unavailable
/// and every request fails closed with `engines.pack_missing`.
fn register_media_specs(app: &AppHandle, registry: &mut ConverterRegistry) {
    let media_available = app
        .try_state::<std::sync::Arc<crate::engine_process::EngineHost>>()
        .map(|host| {
            host.inner()
                .capability_verified(crate::engine_types::EngineCapabilityId::MediaEncode)
        })
        .unwrap_or(false);
    for id in ::convert::media_adapter::MEDIA_CONVERTER_IDS {
        let Ok(converter_id) = ::convert::ConverterId::parse(id) else {
            continue;
        };
        let Some(output) = ::convert::media_adapter::media_output_format(&converter_id) else {
            continue;
        };
        let preserves = ::convert::media_adapter::preservable_metadata(output);
        let Ok(spec) = ::convert::media_adapter::media_converter_spec(
            converter_id,
            media_available,
            preserves,
        ) else {
            continue;
        };
        let _ = registry.register(Box::new(NativeHelperSpec(spec)));
    }
}

/// The setup error for one registered spec that cannot execute now. An
/// unavailable engine spec is a missing optional pack, not a bad request.
pub fn unavailable_converter_code(spec: &ConverterSpec) -> &'static str {
    if matches!(spec.engine_id.as_str(), "media" | "office") {
        "engines.pack_missing"
    } else {
        "convert.bad_request"
    }
}

/// Where one adapter's work runs. Media runs in the confined engine host and
/// streams through the shared sink; Office stays unwired in this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConvertRoute {
    NativePdf,
    NativeImagesPdf,
    NativeDocument,
    EngineMedia,
    Helper,
}

/// The exact `ConvertOptions` variant each wired adapter accepts. A kind
/// mismatch is refused before any staging, never silently ignored.
pub fn route_for(id: &str, options: &ConvertOptions) -> Option<ConvertRoute> {
    if !::convert::adapters::options_kind_matches(id, options) {
        return None;
    }
    match (id, options) {
        ("pdf/png", ConvertOptions::Pdf(options)) if options.image_format == "png" => {
            Some(ConvertRoute::NativePdf)
        }
        ("pdf/jpeg", ConvertOptions::Pdf(options)) if options.image_format == "jpeg" => {
            Some(ConvertRoute::NativePdf)
        }
        // `images/pdf` is the one combine route: every selected image becomes
        // one page of a single PDF, in selection order.
        ("images/pdf", ConvertOptions::Document(_)) => Some(ConvertRoute::NativeImagesPdf),
        ("markdown/html" | "markdown/pdf" | "html/pdf", ConvertOptions::Document(_)) => {
            Some(ConvertRoute::NativeDocument)
        }
        ("media/video" | "media/audio" | "media/gif", ConvertOptions::Media(_)) => {
            Some(ConvertRoute::EngineMedia)
        }
        (_, ConvertOptions::Image(_) | ConvertOptions::Table(_) | ConvertOptions::Archive(_)) => {
            Some(ConvertRoute::Helper)
        }
        _ => None,
    }
}

/// A spec entry for a conversion the parent performs itself (a native helper
/// or the confined media engine). It is never asked to convert; the job
/// routes these IDs before the conversion child starts, so `convert` fails
/// closed if that ever changes.
struct NativeHelperSpec(ConverterSpec);

impl Converter for NativeHelperSpec {
    fn spec(&self) -> ConverterSpec {
        self.0.clone()
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

/// The pure converters plus the helper routes this build can execute without
/// an app handle. Media specs are registered live by `conversion_registry`,
/// because their availability depends on the verified engine pack.
pub fn available_converter_ids() -> Vec<String> {
    let registry = ::convert::builtin_registry();
    let mut ids: Vec<String> = registry
        .specs()
        .into_iter()
        .filter(|spec| spec.available)
        .map(|spec| spec.id.as_str().to_string())
        .collect();
    ids.extend(
        NATIVE_HELPER_CONVERTER_IDS
            .iter()
            .map(|id| (*id).to_string()),
    );
    // Archive adapters only exist with the parent's work root, which every
    // job and command supplies; the static listing names them for parity.
    ids.extend(
        ::convert::archive_adapter::ARCHIVE_CONVERTER_IDS
            .iter()
            .map(|id| (*id).to_string()),
    );
    ids
}
