//! Native PDF export preserves the original immutable input identity.
use std::io::{Read, Seek};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use convert::{
    ConversionInput, ConversionWarningCode, ConvertOptions, ConvertOutputSink, FormatId,
    ImageOptions, OutputDraft, OutputMetadata, OutputNamePart, PreparedOutput,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use crate::{
    cache::CacheService,
    export_snapshots::{ExportSnapshots, SnapshotLease},
    files::FileGrants,
    jobs::JobContext,
    pdf_sessions::PdfSessions,
};
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use crate::pdf_types::{PdfInput, PdfRenderRequest, PdfRotation, PdfRasterSpec, PdfSnapshotRef};
use crate::webview_helper_types::*;

struct SessionGuard { app: AppHandle, id: Uuid }
impl Drop for SessionGuard { fn drop(&mut self) { let _ = self.app.state::<PdfSessions>().close(self.id); } }
struct LeaseGuard { cache: Arc<CacheService>, id: String }
impl Drop for LeaseGuard { fn drop(&mut self) { let _ = self.cache.release(&self.id); } }

pub fn convert_pdf_pages(input: &ConversionInput, options: &ConvertOptions, sink: &mut dyn ConvertOutputSink,
    context: &JobContext, max_output_bytes: u64) -> Result<PreparedOutput, String> {
    let ConvertOptions::Pdf(options) = options else { return Err("convert.bad_request".into()); };
    if options.dpi < 72 || options.dpi > 600 || !(1..=100).contains(&options.quality)
        || !matches!(options.image_format.as_str(), "png" | "jpeg") { return Err("convert.bad_request".into()); }
    let app = context.app();
    let mut retained = None;
    let pdf_input = match input {
        ConversionInput::File { path, expected } => PdfInput::File { path: path.clone(), expected: expected.clone() },
        ConversionInput::Snapshot { snapshot_id, document_id, revision } => {
            let snapshots = app.state::<Arc<ExportSnapshots>>();
            let lease = snapshots.resolve(snapshot_id, document_id, *revision)?;
            if lease.snapshot.mime != "application/pdf" { return Err("convert.unsupported".into()); }
            let reference = PdfSnapshotRef { snapshot_id: Uuid::parse_str(snapshot_id).map_err(|_| "convert.changed")?,
                document_id: document_id.clone(), revision: *revision, content_id: lease.snapshot.content_id };
            retained = Some(lease);
            PdfInput::Snapshot { reference }
        }
    };
    let session = crate::pdf_jobs::open_input(app, context.token(), &pdf_input, None)?;
    let guard = SessionGuard { app: app.clone(), id: session.session_id };
    if session.password_required || !session.permissions.can_copy { return Err("convert.unsupported".into()); }
    let pages = convert::pdf::normalize_page_ranges(&options.ranges, session.page_count).map_err(|_| "convert.invalid_range")?;
    let mut total = 0u64;
    for (revision, page) in pages.iter().enumerate() {
        if context.token().load(Ordering::Relaxed) { return Err("convert.cancelled".into()); }
        let image = crate::pdf_jobs::render_page(app, context.token(), &PdfRenderRequest { session_id: session.session_id, page: *page,
            raster: PdfRasterSpec::Dpi { value: options.dpi }, rotation: PdfRotation::Deg0, request_revision: revision as u32 + 1 })?;
        let lease = LeaseGuard { cache: Arc::clone(app.state::<Arc<CacheService>>().inner()), id: image.image.lease_id.clone() };
        if (image.resolved_scale - f64::from(options.dpi) / 72.0).abs() > 1e-8 { return Err("convert.too_large".into()); }
        let backing = app.state::<Arc<FileGrants>>().resolve_backing(&image.image.token).ok_or("convert.changed")?;
        if backing.length() > 16 * 1024 * 1024 { return Err("convert.too_large".into()); }
        let mut bytes = Vec::with_capacity(backing.length() as usize);
        while bytes.len() < backing.length() as usize {
            let chunk = backing.read_range(bytes.len() as u64, (backing.length() as usize - bytes.len()).min(1024 * 1024))?;
            if chunk.is_empty() { return Err("convert.changed".into()); }
            bytes.extend(chunk);
        }
        if options.image_format == "jpeg" { bytes = transcode_png(bytes, options.quality)?; }
        total = total.checked_add(bytes.len() as u64).ok_or("convert.too_large")?;
        if total > max_output_bytes { return Err("convert.too_large".into()); }
        let draft: OutputDraft = serde_json::from_value(json!({"name_hint":"page", "name_part":{"kind":"page","page":page},
            "mime": if options.image_format == "png" { "image/png" } else { "image/jpeg" }, "input_indices":[0]})).map_err(|_| "convert.bad_request")?;
        let index = sink.begin(draft).map_err(|e| e.to_string())?;
        let result = (|| {
            for chunk in bytes.chunks(1024 * 1024) {
                if context.token().load(Ordering::Relaxed) { return Err("convert.cancelled".to_string()); }
                sink.write(index, chunk).map_err(|e| e.to_string())?;
            }
            sink.finish(index, OutputMetadata { byte_len: bytes.len() as u64, width: Some(image.render_width), height: Some(image.render_height),
                metadata_lost: Vec::new(), warnings: Vec::new(), hash_sha256: format!("{:x}", Sha256::digest(&bytes)) }).map_err(|e| e.to_string())
        })();
        if result.is_err() { let _ = sink.abort(index); }
        result?;
        drop(lease);
    }
    drop(guard); drop(retained);
    Ok(PreparedOutput { outputs_count: pages.len() as u32, metadata_lost: Vec::new(), warnings: Vec::new() })
}

fn transcode_png(bytes: Vec<u8>, quality: u8) -> Result<Vec<u8>, String> {
    // Re-encode inside the native parent: the rendered page is already a
    // bounded, verified PNG lease, so no second helper window or extra
    // untrusted surface is needed for the JPEG choice.
    let decode_options = ImageOptions::default();
    let encode_options = ImageOptions {
        quality,
        ..ImageOptions::default()
    };
    let decoded = convert::image_decode::decode_image(&bytes, FormatId::Png, &decode_options)
        .map_err(|error| error.code().to_string())?;
    let encoded = convert::image_encode::encode_image(&decoded.image, FormatId::Jpeg, &encode_options)
        .map_err(|error| error.code().to_string())?;
    if encoded.is_empty() || encoded.len() > 16 * 1024 * 1024 {
        return Err("convert.too_large".into());
    }
    Ok(encoded)
}

const MAX_IMAGE_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_IMAGE_PDF_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MEMORY_GRANT_BYTES: u64 = 256 * 1024 * 1024;
/// The trusted PDF-write helper holds at most `MAX_INPUTS` grants, so one
/// real combine call cannot exceed that even though the adapter spec allows
/// 1000 images. Refusing here is cleaner than a failed helper start.
pub const MAX_COMBINE_IMAGES: usize = crate::webview_helper_types::MAX_INPUTS;

struct PreparedImage {
    grant: HelperInputGrant,
    width: u32,
    height: u32,
    name: String,
    _lease: Option<SnapshotLease>,
}

fn read_exact_bounded(reader: &mut dyn Read, expected: u64) -> Result<Vec<u8>, String> {
    if expected == 0 || expected > MAX_IMAGE_SOURCE_BYTES {
        return Err("convert.too_large".into());
    }
    let mut bytes = Vec::with_capacity(usize::try_from(expected).unwrap_or(0));
    reader
        .take(MAX_IMAGE_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "convert.io")?;
    if bytes.len() as u64 != expected {
        return Err("convert.changed".into());
    }
    Ok(bytes)
}

fn prepare_image(
    app: &AppHandle,
    input: &ConversionInput,
    input_index: usize,
) -> Result<(PreparedImage, Vec<ConversionWarningCode>), String> {
    let (bytes, name, format, sensitive, lease) = match input {
        ConversionInput::File { path, expected } => {
            crate::validate_absolute_path(path)?;
            let pathbuf = std::path::PathBuf::from(path);
            let before = fs_service::capture_source_stamp(&pathbuf).map_err(|_| "convert.changed")?;
            if expected.as_ref().is_some_and(|stamp| stamp != &before) {
                return Err("convert.changed".into());
            }
            if before.size_bytes > MAX_IMAGE_SOURCE_BYTES {
                return Err("convert.too_large".into());
            }
            let name = pathbuf
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or("convert.bad_request")?
                .to_string();
            let format = pathbuf
                .extension()
                .and_then(|value| value.to_str())
                .and_then(FormatId::from_extension)
                .ok_or("convert.unsupported")?;
            let identity = SourceIdentity::capture(&pathbuf).map_err(|_| "convert.changed")?;
            let mut pinned = PinnedSource::open(&pathbuf, &identity).map_err(|_| "convert.changed")?;
            let bytes = read_exact_bounded(pinned.file_mut(), before.size_bytes)?;
            pinned.verify_after_read().map_err(|_| "convert.changed")?;
            (bytes, name, format, false, None)
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let lease = app
                .state::<Arc<ExportSnapshots>>()
                .resolve(snapshot_id, document_id, *revision)?;
            if lease.snapshot.byte_len != lease.backing.length() {
                return Err("convert.changed".into());
            }
            let bytes = read_exact_bounded(&mut lease.backing.reader(), lease.snapshot.byte_len)?;
            let document_uuid = Uuid::parse_str(document_id).map_err(|_| "convert.bad_request")?;
            let name = app
                .state::<Arc<ExportSnapshots>>()
                .authorities()
                .get(document_uuid)
                .map_err(|_| "convert.changed")?
                .authority
                .name;
            let format = FormatId::from_mime(&lease.snapshot.mime).ok_or("convert.unsupported")?;
            let sensitive = lease.backing.is_sensitive();
            (bytes, name, format, sensitive, Some(lease))
        }
    };
    if !matches!(
        format,
        FormatId::Png | FormatId::Jpeg | FormatId::Gif | FormatId::Webp | FormatId::Bmp | FormatId::Tiff
    ) {
        return Err("convert.unsupported".into());
    }
    let image_options = ImageOptions::default();
    let decoded = convert::image_decode::decode_image(&bytes, format, &image_options)
        .map_err(|error| error.code().to_string())?;
    let mut warnings = Vec::new();
    if format == FormatId::Gif
        && convert::image_decode::decode_gif_frames(&bytes, &image_options)
            .map_err(|error| error.code().to_string())?
            .len()
            > 1
    {
        warnings.push(ConversionWarningCode::AnimationFirstFrame);
    }
    let width = decoded.image.width();
    let height = decoded.image.height();
    // The PDF writer accepts PNG and JPEG. An upright PNG/JPEG in a color
    // type pdf-lib embeds directly is passed through unchanged (bounded and
    // decoded above); anything else is re-encoded to PNG so the orientation
    // is baked into the pixels.
    let passthrough = decoded.orientation == image::metadata::Orientation::NoTransforms
        && match format {
            FormatId::Png => matches!(
                decoded.image.color(),
                image::ColorType::L8
                    | image::ColorType::La8
                    | image::ColorType::Rgb8
                    | image::ColorType::Rgba8
            ),
            FormatId::Jpeg => matches!(
                decoded.image.color(),
                image::ColorType::L8 | image::ColorType::Rgb8
            ),
            _ => false,
        };
    let (bytes, mime) = if passthrough {
        let mime = if format == FormatId::Jpeg {
            "image/jpeg"
        } else {
            "image/png"
        };
        (bytes, mime)
    } else {
        let normalized = convert::image_encode::encode_image(&decoded.image, FormatId::Png, &image_options)
            .map_err(|error| error.code().to_string())?;
        (normalized, "image/png")
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_MEMORY_GRANT_BYTES {
        return Err("convert.too_large".into());
    }
    let extension = if mime == "image/jpeg" { "jpg" } else { "png" };
    let grant = HelperInputGrant {
        grant_id: Uuid::new_v4(),
        name: format!("image-{input_index}.{extension}"),
        mime: mime.to_string(),
        source: HelperInputSource::Memory {
            data: Arc::new(zeroize::Zeroizing::new(bytes)),
            document_id: "images-pdf".to_string(),
            revision: input_index as u64,
            content_id: Uuid::new_v4(),
            sensitive,
        },
    };
    Ok((
        PreparedImage {
            grant,
            width,
            height,
            name,
            _lease: lease,
        },
        warnings,
    ))
}

/// Combine images into one PDF in selection order. Every source is decoded
/// through the bounded 08a raster pipeline so orientation, dimensions and
/// format are verified; upright PNG/JPEG bytes are passed to the trusted PDF
/// writer unchanged, everything else is normalized to PNG first. The whole
/// set is validated before the first output can begin.
pub fn convert_images_to_pdf(
    inputs: &[ConversionInput],
    options: &ConvertOptions,
    accepted_warnings: &[ConversionWarningCode],
    sink: &mut dyn ConvertOutputSink,
    context: &JobContext,
    max_output_bytes: u64,
) -> Result<PreparedOutput, String> {
    let ConvertOptions::Document(options) = options else {
        return Err("convert.bad_request".into());
    };
    ConvertOptions::Document(options.clone())
        .validate()
        .map_err(|error| error.code().to_string())?;
    if inputs.is_empty() || inputs.len() > MAX_COMBINE_IMAGES || max_output_bytes == 0 {
        return Err("convert.bad_request".into());
    }
    let app = context.app();
    let mut prepared = Vec::with_capacity(inputs.len());
    let mut warnings = Vec::new();
    let mut aggregate = 0u64;
    for (index, input) in inputs.iter().enumerate() {
        if context.token().load(Ordering::Relaxed) {
            return Err("convert.cancelled".into());
        }
        let (image, required) = prepare_image(app, input, index)?;
        aggregate = aggregate
            .checked_add(image.grant.source.memory_bytes())
            .ok_or("convert.too_large")?;
        if aggregate > MAX_IMAGE_PDF_OUTPUT_BYTES {
            return Err("convert.too_large".into());
        }
        for warning in required {
            if !warnings.contains(&warning) {
                warnings.push(warning);
            }
        }
        prepared.push(image);
    }
    // Every required warning (an animated GIF keeps only its first frame)
    // must be accepted before the helper may produce the PDF.
    convert::adapters::ensure_warnings_accepted(&warnings, accepted_warnings)
        .map_err(|error| error.code().to_string())?;
    let images = prepared
        .iter()
        .map(|image| {
            json!({
                "grant_id": image.grant.grant_id,
                "width_px": image.width,
                "height_px": image.height,
                "mime": image.grant.mime.as_str(),
            })
        })
        .collect::<Vec<_>>();
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PdfWriteImages,
        payload: json!({
            "images": images,
            "page_size": options.page_size,
            "margin_mm": options.margin_mm,
        }),
        output_specs: vec![HelperOutputSpec {
            mime: "application/pdf".to_string(),
            max_bytes: max_output_bytes.min(MAX_IMAGE_PDF_OUTPUT_BYTES),
        }],
    };
    let grants = prepared.iter().map(|image| image.grant.clone()).collect();
    let config = WebviewHelperConfig {
        kind: WebviewHelperKind::PdfWrite,
        entry: "pdf-write-helper.html",
        max_body_bytes: 1024 * 1024,
        max_output_bytes: MAX_IMAGE_PDF_OUTPUT_BYTES,
        data_dir: app
            .state::<crate::AppState>()
            .data_dir()
            .join("convert-input")
            .join(Uuid::new_v4().to_string()),
        placement: HelperWindowPlacement::Hidden,
    };
    let result = crate::webview_helper::run_webview_helper(
        config,
        grants,
        request,
        context.token().clone(),
    )?;
    if result.outputs.len() != 1 {
        return Err("convert.changed".into());
    }
    let output = result.outputs.into_iter().next().ok_or("convert.changed")?;
    let name_hint = prepared
        .first()
        .map(|image| image.name.clone())
        .ok_or("convert.bad_request")?;
    publish_helper_output(
        output,
        OutputDraft {
            name_hint,
            name_part: OutputNamePart::None,
            mime: "application/pdf".to_string(),
            input_indices: (0..inputs.len() as u32).collect(),
        },
        warnings,
        sink,
        context,
        max_output_bytes.min(MAX_IMAGE_PDF_OUTPUT_BYTES),
    )
}

fn stream_output(
    reader: &mut dyn Read,
    output_index: u32,
    sink: &mut dyn ConvertOutputSink,
    context: &JobContext,
    max_output_bytes: u64,
) -> Result<(u64, String), String> {
    let mut hasher = Sha256::new();
    let mut written = 0u64;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if context.token().load(Ordering::Relaxed) {
            return Err("convert.cancelled".into());
        }
        let read = reader.read(&mut buffer).map_err(|_| "convert.io")?;
        if read == 0 {
            break;
        }
        written = written.checked_add(read as u64).ok_or("convert.too_large")?;
        if written > max_output_bytes {
            return Err("convert.too_large".into());
        }
        hasher.update(&buffer[..read]);
        sink.write(output_index, &buffer[..read]).map_err(|error| error.to_string())?;
    }
    Ok((written, format!("{:x}", hasher.finalize())))
}

/// Stream one verified helper result through the shared 08a sink. Both memory
/// and owned-file results are supported; a short/read failure aborts only this
/// output and never publishes a partial artifact.
pub(crate) fn publish_helper_output(
    mut output: HelperOutput,
    draft: OutputDraft,
    warnings: Vec<ConversionWarningCode>,
    sink: &mut dyn ConvertOutputSink,
    context: &JobContext,
    max_output_bytes: u64,
) -> Result<PreparedOutput, String> {
    if output.mime != draft.mime
        || output.byte_len == 0
        || output.byte_len > max_output_bytes
        || max_output_bytes == 0
    {
        return Err("convert.too_large".into());
    }
    match &mut output.storage {
        HelperOutputStorage::Memory(bytes) => {
            if bytes.len() as u64 != output.byte_len {
                return Err("convert.changed".into());
            }
        }
        HelperOutputStorage::OwnedFile(file) => {
            if file.file_mut().metadata().map_err(|_| "convert.io")?.len() != output.byte_len {
                return Err("convert.changed".into());
            }
        }
    }
    let output_index = sink.begin(draft).map_err(|error| error.to_string())?;
    let result = (|| {
        let (written, hash) = match &mut output.storage {
            HelperOutputStorage::Memory(bytes) => {
                let mut cursor = std::io::Cursor::new(bytes.as_slice());
                stream_output(&mut cursor, output_index, sink, context, max_output_bytes)?
            }
            HelperOutputStorage::OwnedFile(file) => {
                file.file_mut().seek(std::io::SeekFrom::Start(0)).map_err(|_| "convert.io")?;
                stream_output(file.file_mut(), output_index, sink, context, max_output_bytes)?
            }
        };
        if written != output.byte_len {
            return Err("convert.changed".into());
        }
        sink.finish(
            output_index,
            OutputMetadata {
                byte_len: written,
                width: None,
                height: None,
                metadata_lost: Vec::new(),
                warnings: warnings.clone(),
                hash_sha256: hash,
            },
        )
        .map_err(|error| error.to_string())?;
        Ok(PreparedOutput {
            outputs_count: 1,
            metadata_lost: Vec::new(),
            warnings,
        })
    })();
    if result.is_err() {
        let _ = sink.abort(output_index);
    }
    result
}
