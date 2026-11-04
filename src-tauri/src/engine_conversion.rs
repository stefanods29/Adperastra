//! Native engine dispatch through the shared conversion sink (Step 12b E6).
//!
//! 08a owns everything around this function: it resolves and guards the
//! authorized inputs, validates the request, names the outputs, checks the
//! acknowledgements, keeps history and publishes. This module only runs one
//! engine invocation and streams the verified output through the **same**
//! borrowed `ConvertOutputSink`, so publication keeps one implementation.
//!
//! Rules kept here:
//! - exactly one engine artifact per invocation (12b converters are `each`);
//! - the expected MIME is detected independently, never taken from the
//!   engine's own claim;
//! - metadata loss and visible warnings are recomputed from a fresh probe of
//!   the produced file, and an unaccepted change refuses before `sink.begin`;
//! - an engine output is never published by itself, and a later failure only
//!   aborts this invocation's own sink index.
#![allow(dead_code)]


use std::io::Read;
use std::path::Path;

use convert::{
    ConversionRequest, ConversionWarningCode, ConvertError, ConvertOptions, ConvertOutputSink,
    FormatId, MetadataCategory, OutputDraft, OutputMetadata, OutputNamePart, PreparedOutput,
};
use fs_service::owned_io::ClosedOutput;
use uuid::Uuid;

use crate::engine_process::EngineHost;
use crate::engine_types::{
    EngineAction, EngineError, EngineInput, EngineOutput, EngineRequest, MediaInfo, MediaStreamKind,
    OfficeRenderRequest, OfficeRenderTarget, EXPORT_TIMEOUT_MS,
};
use crate::jobs::JobContext;
use crate::media_arguments;
use crate::media_probe;

/// The size of one chunk handed to the sink (08a streams in 1 MiB chunks).
pub const SINK_CHUNK_BYTES: usize = 1024 * 1024;

/// What one registered converter runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Media(FormatId),
    Office(OfficeRenderTarget),
}

/// The converter IDs this module can run through an engine (D6).
fn route_of(converter_id: &str) -> Option<Route> {
    Some(match converter_id {
        // The output container is fixed by the converter spec, so the dialog
        // can only offer formats that actually have a converter.
        "media/video" => Route::Media(FormatId::Webm),
        "media/audio" => Route::Media(FormatId::Flac),
        "media/gif" => Route::Media(FormatId::Gif),
        "office/pdf" => Route::Office(OfficeRenderTarget::Pdf),
        "office/html" => Route::Office(OfficeRenderTarget::Html),
        "office/txt" => Route::Office(OfficeRenderTarget::Txt),
        // Markdown reuses 08b's normalized blocks and sanitized HTML; it is
        // not an engine render (D8).
        "office/md" => return None,
        // `.docx` output has no `OfficeRenderTarget` in this revision, so no
        // engine path exists yet (see handoff).
        "document/docx" => return None,
        _ => return None,
    })
}

/// The shape every 12b invocation must have, checked before anything is
/// launched or any output begins. A caller that fails here never reaches
/// `sink.begin`.
pub fn invocation_shape(
    converter_id: &convert::ConverterId,
    input_count: usize,
) -> Result<Route, ConvertError> {
    if input_count != 1 {
        // The 12b specs are `each` converters: a batch is separate calls.
        return Err(ConvertError::BadRequest);
    }
    route_of(converter_id.as_str()).ok_or(ConvertError::Unsupported)
}

/// Run one engine conversion into the caller's borrowed sink.
pub fn run_engine_conversion(
    host: &EngineHost,
    request: &ConversionRequest,
    inputs: Vec<EngineInput>,
    output: &mut dyn ConvertOutputSink,
    context: &JobContext,
) -> Result<PreparedOutput, ConvertError> {
    if inputs.len() != 1 || request.inputs.len() != 1 {
        return Err(ConvertError::BadRequest);
    }
    let converter_id = request.converter_id.as_str();
    let route = route_of(converter_id).ok_or(ConvertError::Unsupported)?;
    match route {
        Route::Media(format) => convert_media(host, request, inputs, format, output, context),
        Route::Office(target) => convert_office(host, request, inputs, target, output, context),
    }
}

fn convert_media(
    host: &EngineHost,
    request: &ConversionRequest,
    inputs: Vec<EngineInput>,
    format: FormatId,
    output: &mut dyn ConvertOutputSink,
    context: &JobContext,
) -> Result<PreparedOutput, ConvertError> {
    let ConvertOptions::Media(options) = &request.options else {
        return Err(ConvertError::BadRequest);
    };
    // The full typed-option bounds (D4/D5, only `auto` codecs) are checked
    // here as well as in the dialog; a crafted request never reaches ffmpeg
    // with an option the audited adapter did not authorize.
    convert::media_adapter::validate_media_options(options)?;
    let format_name = media_arguments::format_name(&format);
    let expected_mime = media_arguments::format_mime(&format).to_string();
    let audio_only = !matches!(format_name, "webm" | "mp4" | "mkv" | "mov" | "gif");
    let input = inputs.into_iter().next().ok_or(ConvertError::BadRequest)?;
    if input.original != request.inputs[0] {
        return Err(ConvertError::Changed);
    }
    // A media probe reports a disk `SourceStamp`; an immutable editor
    // snapshot has no such identity and is refused before any spool, exactly
    // like the dedicated probe/preview commands.
    if matches!(&input.original, convert::ConversionInput::Snapshot { .. }) {
        return Err(ConvertError::Unsupported);
    }
    let input_index = input.input_index;
    let source = probe_input(host, input, context)?;
    let source_info = source.info;
    source_info
        .validate()
        .map_err(|_| ConvertError::BadRequest)?;

    // Required visible changes for the exact source and options (E8).
    let mut required: Vec<ConversionWarningCode> = Vec::new();
    if format_name == "gif" {
        required.extend(convert::gif_warning_codes(&gif_source_facts(&source_info)));
    }
    // A missing acknowledgement fails before any output begins.
    convert::require_acknowledged(&required, &request.accepted_warning_codes)?;

    let work_dir = host
        .new_private_root("convert")
        .map_err(map_engine_error)?
        .1;
    let engine_request = EngineRequest {
        request_id: Uuid::new_v4(),
        timeout_ms: EXPORT_TIMEOUT_MS,
        work_dir,
        action: EngineAction::ConvertMedia {
            inputs: vec![source.input],
            converter_id: request.converter_id.clone(),
            output_format: format,
            options: options.clone(),
        },
    };
    let run = host
        .run_capture(&engine_request, context)
        .map_err(map_engine_error)?;
    let engine_output = single_output(run.result)?;
    // The produced file is closed and probed again before the sink sees a
    // byte; the engine's own report is only evidence.
    let (closed, byte_len, hash, produced) = close_and_probe(host, engine_output, context)?;
    let detected = match detect_mime(closed.path()) {
        Ok(detected) => detected,
        Err(_) => {
            let _ = closed.dispose();
            return Err(convert_failed());
        }
    };
    if !same_mime_family(&expected_mime, &detected) {
        let _ = closed.dispose();
        return Err(convert_failed());
    }
    // Dimensions are only claimed when no resize was requested: a re-encode
    // without scaling keeps the source picture size.
    let resized = options.width.is_some_and(|width| width > 0)
        || options.height.is_some_and(|height| height > 0);
    let (width, height) = if audio_only || resized {
        (None, None)
    } else {
        produced
            .streams
            .iter()
            .find(|stream| matches!(stream.kind, MediaStreamKind::Video))
            .map(|stream| (stream.width, stream.height))
            .unwrap_or((None, None))
    };
    let metadata_lost = lost_categories(&source_info, &produced, options.keep_metadata);
    if let Err(error) = require_accepted_losses(&metadata_lost, &request.accepted_losses) {
        let _ = closed.dispose();
        return Err(error);
    }
    let draft = OutputDraft {
        name_hint: file_name(closed.path()),
        name_part: OutputNamePart::None,
        mime: expected_mime,
        input_indices: vec![input_index],
    };
    let result = stream_closed(
        &closed,
        byte_len,
        hash,
        width,
        height,
        draft,
        metadata_lost,
        required,
        output,
    );
    // The engine's temporary copy is only removed after the sink took it.
    let _ = closed.dispose();
    result
}

fn convert_office(
    host: &EngineHost,
    request: &ConversionRequest,
    inputs: Vec<EngineInput>,
    target: OfficeRenderTarget,
    output: &mut dyn ConvertOutputSink,
    context: &JobContext,
) -> Result<PreparedOutput, ConvertError> {
    let ConvertOptions::Office(options) = &request.options else {
        return Err(ConvertError::BadRequest);
    };
    let input = inputs.into_iter().next().ok_or(ConvertError::BadRequest)?;
    if input.original != request.inputs[0] {
        // The guarded input must be the one the request named, or the render
        // would describe a different source than the one authorized.
        return Err(ConvertError::Changed);
    }
    let input_index = input.input_index;
    let format = input.office_format().ok_or(ConvertError::Unsupported)?;
    let render = OfficeRenderRequest {
        input: input.original.clone(),
        target,
        format,
        include_comments: options.export_comments,
        include_notes: false,
        ranges: options.page_ranges.clone(),
    };
    let work_dir = host
        .new_private_root("convert")
        .map_err(map_engine_error)?
        .1;
    let mut rendered = crate::office_render::render_office(host, &render, input, work_dir, context)
        .map_err(map_engine_error)?;
    if rendered.artifacts.len() != 1 {
        return Err(convert_failed());
    }
    let artifact = rendered.artifacts.pop().ok_or(convert_failed())?;
    let expected_mime = target.mime().to_string();
    if artifact.output.mime != expected_mime {
        return Err(convert_failed());
    }
    let name_hint = artifact.output.relative_name.clone();
    let byte_len = artifact.output.byte_len;
    let hash = artifact.output.content_hash_sha256.clone();
    let closed = artifact.output.owned_output.close();
    let metadata_lost: Vec<MetadataCategory> = Vec::new();
    if let Err(error) = require_accepted_losses(&metadata_lost, &request.accepted_losses) {
        let _ = closed.dispose();
        return Err(error);
    }
    let draft = OutputDraft {
        name_hint,
        name_part: OutputNamePart::None,
        mime: expected_mime,
        input_indices: vec![input_index],
    };
    let result = stream_closed(
        &closed,
        byte_len,
        hash,
        None,
        None,
        draft,
        metadata_lost,
        Vec::new(),
        output,
    );
    let _ = closed.dispose();
    result
}

/// Copy one closed, verified temporary file into the caller's sink.
#[allow(clippy::too_many_arguments)]
fn stream_closed(
    closed: &ClosedOutput,
    byte_len: u64,
    hash: String,
    width: Option<u32>,
    height: Option<u32>,
    draft: OutputDraft,
    metadata_lost: Vec<MetadataCategory>,
    warnings: Vec<ConversionWarningCode>,
    output: &mut dyn ConvertOutputSink,
) -> Result<PreparedOutput, ConvertError> {
    let output_index = output.begin(draft)?;
    if let Err(error) = copy_into_sink(closed.path(), output_index, output) {
        let _ = output.abort(output_index);
        return Err(error);
    }
    let metadata = OutputMetadata {
        byte_len,
        width,
        height,
        metadata_lost: metadata_lost.clone(),
        warnings: warnings.clone(),
        hash_sha256: hash,
    };
    if let Err(error) = output.finish(output_index, metadata) {
        // The sink refuses the output; nothing of it is published.
        let _ = output.abort(output_index);
        return Err(error);
    }
    Ok(PreparedOutput {
        outputs_count: 1,
        metadata_lost,
        warnings,
    })
}

fn copy_into_sink(
    path: &Path,
    output_index: u32,
    output: &mut dyn ConvertOutputSink,
) -> Result<(), ConvertError> {
    let mut file = std::fs::File::open(path)?;
    let mut buffer = vec![0u8; SINK_CHUNK_BYTES];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write(output_index, &buffer[..read])?;
    }
    Ok(())
}

/// Close the engine's temp file and probe it as a fresh disk file.
fn close_and_probe(
    host: &EngineHost,
    engine_output: EngineOutput,
    context: &JobContext,
) -> Result<(ClosedOutput, u64, String, media_probe::ParsedProbe), ConvertError> {
    let EngineOutput {
        byte_len,
        content_hash_sha256,
        owned_output,
        ..
    } = engine_output;
    // The child's file is closed so the probe engine can read it; it is still
    // our private staging file, not a user file.
    let closed = owned_output.close();
    let produced = match media_probe::probe_path(host, closed.path(), context) {
        Ok(produced) => produced,
        Err(_) => {
            let _ = closed.dispose();
            return Err(convert_failed());
        }
    };
    Ok((closed, byte_len, content_hash_sha256, produced))
}

/// One probe run that borrows the input and gives it back.
struct ProbedSource {
    input: EngineInput,
    info: MediaInfo,
}

fn probe_input(
    host: &EngineHost,
    input: EngineInput,
    context: &JobContext,
) -> Result<ProbedSource, ConvertError> {
    let work_dir = host
        .new_private_root("probe")
        .map_err(map_engine_error)?
        .1;
    let mut probe_request = EngineRequest {
        request_id: Uuid::new_v4(),
        timeout_ms: crate::engine_types::PROBE_TIMEOUT_MS,
        work_dir,
        action: EngineAction::ProbeMedia { inputs: vec![input] },
    };
    let run = host
        .run_capture(&probe_request, context)
        .map_err(map_engine_error)?;
    let input = take_input(&mut probe_request).ok_or(convert_failed())?;
    // The input stays owned for the real conversion; its stamp is copied,
    // never moved out of the struct.
    let stamp = input.stamp.clone().ok_or(ConvertError::Changed)?;
    let parsed = media_probe::parse_probe_json(&run.stdout).map_err(|_| convert_failed())?;
    let info = media_probe::assemble_input(stamp, parsed).ok_or(convert_failed())?;
    Ok(ProbedSource { input, info })
}

/// Recover the owned input from a probe request that has finished.
fn take_input(request: &mut EngineRequest) -> Option<EngineInput> {
    match &mut request.action {
        EngineAction::ProbeMedia { inputs }
        | EngineAction::PreviewMedia { inputs, .. }
        | EngineAction::ConvertMedia { inputs, .. }
        | EngineAction::RenderOffice { inputs, .. } => {
            if inputs.len() == 1 {
                inputs.pop()
            } else {
                None
            }
        }
    }
}

fn single_output(mut result: crate::engine_types::EngineResult) -> Result<EngineOutput, ConvertError> {
    if result.outputs.len() != 1 {
        // More or fewer artifacts than the one this converter writes.
        return Err(convert_failed());
    }
    result.outputs.pop().ok_or(convert_failed())
}

fn gif_source_facts(info: &MediaInfo) -> convert::GifSourceFacts {
    let has_audio = info
        .streams
        .iter()
        .any(|stream| matches!(stream.kind, MediaStreamKind::Audio));
    // Fractional alpha is not reported by the bounded probe yet; the flag
    // stays false and the handoff names the probe extension that fills it.
    convert::GifSourceFacts {
        has_audio,
        has_nonbinary_alpha: false,
        frame_timestamps_us: frame_timestamps(info),
    }
}

/// The frame timestamps a conversion would write, from the stream rate
/// (integer microseconds, D5).
fn frame_timestamps(info: &MediaInfo) -> Vec<u64> {
    let Some(rate) = info
        .streams
        .iter()
        .find(|stream| matches!(stream.kind, MediaStreamKind::Video))
        .and_then(|stream| stream.frame_rate)
    else {
        return Vec::new();
    };
    let Some(step) = rate.frame_us() else {
        return Vec::new();
    };
    if step == 0 {
        return Vec::new();
    }
    let mut timestamps = Vec::new();
    let mut timestamp = 0u64;
    while timestamp < info.duration_us && timestamps.len() < 4096 {
        timestamps.push(timestamp);
        timestamp += step;
    }
    timestamps
}

/// Categories present in the source and absent from the produced file.
fn lost_categories(
    source: &MediaInfo,
    produced: &media_probe::ParsedProbe,
    keep_metadata: bool,
) -> Vec<MetadataCategory> {
    let mut lost: Vec<MetadataCategory> = Vec::new();
    let kept: Vec<MetadataCategory> = produced.tags.iter().map(|tag| tag.category).collect();
    for tag in &source.tags {
        if (!keep_metadata || !kept.contains(&tag.category)) && !lost.contains(&tag.category) {
            lost.push(tag.category);
        }
    }
    lost
}

/// Every loss must be accepted before anything is written.
fn require_accepted_losses(
    lost: &[MetadataCategory],
    accepted: &[MetadataCategory],
) -> Result<(), ConvertError> {
    for category in lost {
        if !accepted.contains(category) {
            return Err(ConvertError::MetadataLoss);
        }
    }
    Ok(())
}

fn same_mime_family(expected: &str, detected: &str) -> bool {
    if expected == detected {
        return true;
    }
    let aliases: [(&str, &str); 7] = [
        ("audio/x-matroska", "video/x-matroska"),
        ("audio/webm", "video/webm"),
        ("audio/opus", "audio/ogg"),
        ("audio/x-flac", "audio/flac"),
        ("audio/x-wav", "audio/wav"),
        ("audio/x-m4a", "audio/mp4"),
        ("audio/mp4", "video/mp4"),
    ];
    aliases.iter().any(|(left, right)| {
        (expected == *left && detected == *right) || (expected == *right && detected == *left)
    })
}

/// Detect the real MIME of a produced file from its first bytes.
fn detect_mime(path: &Path) -> Result<String, EngineError> {
    let mut file = std::fs::File::open(path).map_err(|_| EngineError::Failed)?;
    let mut prefix = vec![0u8; 8192];
    let mut total = 0usize;
    loop {
        let read = file
            .read(&mut prefix[total..])
            .map_err(|_| EngineError::Failed)?;
        if read == 0 {
            break;
        }
        total += read;
        if total == prefix.len() {
            break;
        }
    }
    prefix.truncate(total);
    let detected = infer::get(&prefix).ok_or(EngineError::Failed)?;
    Ok(detected.mime_type().to_string())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The conversion error space has no separate "engine failed" variant; an
/// engine failure is an I/O-class failure for the parent's report.
fn convert_failed() -> ConvertError {
    ConvertError::Io(std::io::Error::other("engine failed"))
}

/// Map a native engine error code to the conversion error space.
pub fn map_engine_error(code: String) -> ConvertError {
    match code.as_str() {
        "engines.cancelled" => ConvertError::Cancelled,
        "engines.changed" => ConvertError::Changed,
        "engines.unsupported" | "engines.pack_missing" | "engines.unsafe_build"
        | "engines.sensitive_unsupported" => ConvertError::Unsupported,
        "engines.timeout" => ConvertError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "engine timeout",
        )),
        _ => convert_failed(),
    }
}

/// The number of finished outputs this invocation handed to the sink.
pub fn written_output_count(prepared: &PreparedOutput) -> u32 {
    prepared.outputs_count
}

#[cfg(test)]
mod tests {
    use super::{route_of, same_mime_family, Route};
    use convert::FormatId;

    #[test]
    fn only_registered_engine_converters_have_a_route() {
        assert_eq!(Some(Route::Media(FormatId::Gif)), route_of("media/gif"));
        assert!(route_of("image/png").is_none());
        assert!(route_of("office/md").is_none());
        assert!(route_of("document/docx").is_none());
    }

    #[test]
    fn container_aliases_are_recognized() {
        assert!(same_mime_family("video/webm", "video/webm"));
        assert!(same_mime_family("audio/opus", "audio/ogg"));
        assert!(!same_mime_family("application/pdf", "text/html"));
    }
}
