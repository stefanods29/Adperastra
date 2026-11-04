//! Media converter specs and typed option checks (Step 12b T4).
//!
//! This file is inside the pure `convert` crate on purpose: it names the
//! media converters native may register, validates the typed
//! `MediaConversionOptions`, and computes the visible losses a GIF output
//! requires. It must never start a process.
//!
//! Execution is native. There is no `Converter` implementation here and no
//! engine handle: the native engine host, input probing and process control stay in
//! `src-tauri`. Native passes `available: false` when its audited backend is
//! absent; the resulting spec is inert and `run_conversion` refuses with
//! `ConvertError::Unsupported` before `sink.begin`, so no output can begin
//! without the engine. [`require_media_backend`] is the same gate for the
//! native engine-dispatch path.
//!
//! The option specs use 0 for "not set" because `OptionSpec` integers cannot
//! be null (the image adapter uses the same convention for width/height).
//! [`normalize_media_options`] is the single place that turns those sentinels
//! into `None` before native builds engine arguments.
//!
//! The warning analysis below is pure as well, so the required acknowledgements
//! can be computed and tested without a pack: a GIF that loses audio, colors,
//! transparency or exact frame timing must say so before any output begins.
//!
//! Shared additions this file names and the coordinator owns: the additive
//! `FormatId` media/document variants, `ConversionWarningCode::{AudioLoss,
//! FrameRateChange}` and the module/re-export line in `crates/convert/src/lib.rs`.
//! Until those exist the file is correct against the intended API but the
//! crate does not expose it; no placeholder format or codec is invented here.

use std::collections::BTreeSet;

use crate::error::ConvertError;
use crate::types::{
    ConversionWarningCode, ConvertOptions, ConverterId, ConverterSpec, FormatId,
    MediaConversionOptions, MetadataCategory, OptionSpec, MAX_ACCEPTED,
};

/// The GIF frame timestamp unit: hundredths of a second (D6, E8).
pub const GIF_TIMESTAMP_US: u64 = 10_000;

/// The largest timestamp a media probe may report (D5: integer microseconds
/// no larger than `Number.MAX_SAFE_INTEGER`).
pub const MAX_MEDIA_TIME_US: u64 = 9_007_199_254_740_991;

/// The most frame timestamps a GIF preflight scans. A longer list is refused
/// and conservatively requires the frame-rate warning.
pub const MAX_GIF_TIMESTAMPS: usize = 100_000;

/// The source cap (D4): one media file is at most 32 GiB.
pub const MEDIA_MAX_INPUT_BYTES: u64 = 32 * 1024 * 1024 * 1024;
/// All outputs of one invocation are at most 32 GiB.
pub const MEDIA_MAX_OUTPUT_BYTES: u64 = 32 * 1024 * 1024 * 1024;

/// The longest accepted clip range (D4): 24 hours, end exclusive.
pub const MAX_MEDIA_DURATION_MS: u64 = 24 * 60 * 60 * 1000;
/// Largest width or height the media engines accept (D4).
pub const MAX_MEDIA_DIMENSION: u32 = 16_384;
/// Smallest and largest accepted encoded bitrate.
pub const MIN_MEDIA_BITRATE_KBPS: u32 = 8;
pub const MAX_MEDIA_BITRATE_KBPS: u32 = 1_000_000;
/// Smallest and largest accepted audio sample rate.
pub const MIN_MEDIA_SAMPLE_RATE: u32 = 8_000;
pub const MAX_MEDIA_SAMPLE_RATE: u32 = 192_000;

/// The only codec value accepted until a native capability probe enumerates
/// the encoders of the audited build. A caller-selected codec name is not
/// evidence that the build contains it.
pub const MEDIA_CODEC_AUTO: &str = "auto";

/// The exact converter IDs of this step (D6).
pub const MEDIA_CONVERTER_IDS: [&str; 3] = ["media/video", "media/audio", "media/gif"];

/// Every media format this adapter may name. Keeping the set explicit keeps
/// the spec table bounded; later steps append variants additively.
const MEDIA_FORMATS: &[FormatId] = &[
    FormatId::Mp4,
    FormatId::Mkv,
    FormatId::Mov,
    FormatId::Webm,
    FormatId::Gif,
    FormatId::Mp3,
    FormatId::Wav,
    FormatId::Flac,
    FormatId::Ogg,
    FormatId::Opus,
    FormatId::Aac,
];

const VIDEO_INPUTS: &[FormatId] = &[
    FormatId::Mp4,
    FormatId::Mkv,
    FormatId::Mov,
    FormatId::Webm,
    FormatId::Gif,
];
const AUDIO_INPUTS: &[FormatId] = &[
    FormatId::Mp3,
    FormatId::Wav,
    FormatId::Flac,
    FormatId::Ogg,
    FormatId::Opus,
    FormatId::Aac,
    FormatId::Mp4,
];
const GIF_INPUTS: &[FormatId] = &[
    FormatId::Mp4,
    FormatId::Mkv,
    FormatId::Mov,
    FormatId::Webm,
    FormatId::Gif,
];
const MEDIA_OUTPUTS: &[FormatId] = &[FormatId::Webm, FormatId::Flac, FormatId::Gif];

/// Metadata categories the containers written here can carry. EXIF, GPS,
/// camera, ICC, XMP, IPTC and the document-only categories are never claimed:
/// the native probe reports them lost instead. GIF keeps none of them.
const MEDIA_PRESERVABLE: &[MetadataCategory] = &[
    MetadataCategory::Date,
    MetadataCategory::Author,
    MetadataCategory::Comments,
];

/// What one source file means for the GIF warnings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GifSourceFacts {
    /// The source has at least one audio stream that a GIF cannot carry.
    pub has_audio: bool,
    /// The source has alpha values that are not fully opaque or fully clear.
    pub has_nonbinary_alpha: bool,
    /// Presentation timestamps of the frames that would be written, in
    /// integer microseconds (D5).
    pub frame_timestamps_us: Vec<u64>,
}

impl GifSourceFacts {
    /// Refuse facts a bounded probe must never produce. Native calls this
    /// after probing and before it computes warnings.
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.frame_timestamps_us.len() > MAX_GIF_TIMESTAMPS {
            return Err(ConvertError::TooLarge);
        }
        let mut previous = None;
        for &timestamp in &self.frame_timestamps_us {
            if timestamp > MAX_MEDIA_TIME_US {
                return Err(ConvertError::BadRequest);
            }
            if previous.is_some_and(|value| timestamp <= value) {
                return Err(ConvertError::BadRequest);
            }
            previous = Some(timestamp);
        }
        Ok(())
    }
}

/// True for exactly the three media converter IDs.
pub fn is_media_converter(id: &ConverterId) -> bool {
    MEDIA_CONVERTER_IDS.contains(&id.as_str())
}

/// True for a format the media adapter may name.
pub fn is_media_format(format: FormatId) -> bool {
    MEDIA_FORMATS.contains(&format)
}

/// The bounded input set of one media converter.
pub fn media_input_formats(id: &ConverterId) -> Option<&'static [FormatId]> {
    Some(match id.as_str() {
        "media/video" => VIDEO_INPUTS,
        "media/audio" => AUDIO_INPUTS,
        "media/gif" => GIF_INPUTS,
        _ => return None,
    })
}

/// The fixed output format of one media converter.
pub fn media_output_format(id: &ConverterId) -> Option<FormatId> {
    Some(match id.as_str() {
        "media/video" => FormatId::Webm,
        "media/audio" => FormatId::Flac,
        "media/gif" => FormatId::Gif,
        _ => return None,
    })
}

/// The metadata categories this output container may preserve. Anything else
/// is a loss the native probe must report before the request is accepted.
pub fn preservable_metadata(output: FormatId) -> &'static [MetadataCategory] {
    if output == FormatId::Gif || !MEDIA_OUTPUTS.contains(&output) {
        &[]
    } else {
        MEDIA_PRESERVABLE
    }
}

/// Build the spec of one media converter. Native supplies the audited
/// availability and the preservation list; nothing here can claim a codec.
///
/// `available` must be the result of the native capability probe. With no
/// engine backend native passes `false`, the spec is inert and the shared
/// `run_conversion` refuses before the sink is touched.
pub fn media_converter_spec(
    id: ConverterId,
    available: bool,
    preserves: &[MetadataCategory],
) -> Result<ConverterSpec, ConvertError> {
    let inputs = media_input_formats(&id).ok_or(ConvertError::Unsupported)?;
    let output = media_output_format(&id).ok_or(ConvertError::Unsupported)?;
    if !is_media_converter(&id)
        || inputs.is_empty()
        || inputs.len() > 64
        || inputs.iter().any(|format| !is_media_format(*format))
        || !MEDIA_OUTPUTS.contains(&output)
    {
        return Err(ConvertError::Unsupported);
    }
    let spec = ConverterSpec {
        id,
        inputs: inputs.to_vec(),
        output,
        options: media_option_specs(),
        // 12b media converters are `each`: one input, one output per call.
        input_mode: "each".to_string(),
        max_input_bytes: MEDIA_MAX_INPUT_BYTES,
        max_output_bytes: MEDIA_MAX_OUTPUT_BYTES,
        lossy: true,
        preserves: bounded_preserves(output, preserves)?,
        engine_id: "media".to_string(),
        available,
        help_slug: "converting-media".to_string(),
    };
    spec.validate()?;
    Ok(spec)
}

/// The same execution gate the shared preflight uses, exposed for the native
/// engine-dispatch path. It never starts anything: without an audited backend
/// the call refuses before a source is read or an output begins.
pub fn require_media_backend(available: bool) -> Result<(), ConvertError> {
    if available {
        Ok(())
    } else {
        Err(ConvertError::Unsupported)
    }
}

/// The typed options offered to the dialog. There is deliberately no free
/// text: no filter, codec name or command-line fragment can be typed in.
/// `burn_subtitles` is not advertised: this revision has no authorized
/// subtitle source, and [`validate_media_options`] refuses it.
pub fn media_option_specs() -> Vec<OptionSpec> {
    // 0 means "not set"; see [`normalize_media_options`]. The default is 0 so
    // an untouched dialog never forces a trim, resize, bitrate or rate.
    vec![
        OptionSpec::integer(
            "start_ms",
            "convert.startMs",
            0,
            0,
            MAX_MEDIA_DURATION_MS.saturating_sub(1) as i64,
        ),
        OptionSpec::integer(
            "end_ms",
            "convert.endMs",
            0,
            0,
            MAX_MEDIA_DURATION_MS.saturating_sub(1) as i64,
        ),
        OptionSpec::integer("width", "convert.width", 0, 0, MAX_MEDIA_DIMENSION as i64),
        OptionSpec::integer("height", "convert.height", 0, 0, MAX_MEDIA_DIMENSION as i64),
        OptionSpec::integer(
            "bitrate_kbps",
            "convert.bitrate",
            0,
            0,
            MAX_MEDIA_BITRATE_KBPS as i64,
        ),
        OptionSpec::integer(
            "sample_rate",
            "convert.sampleRate",
            0,
            0,
            MAX_MEDIA_SAMPLE_RATE as i64,
        ),
        OptionSpec::boolean("keep_metadata", "convert.keepMetadata", true),
    ]
}

/// Turn the 0 sentinels of the option specs into `None`. Native must call
/// this before it builds engine arguments; validation uses the same view.
pub fn normalize_media_options(options: &MediaConversionOptions) -> MediaConversionOptions {
    let mut normalized = options.clone();
    normalized.start_ms = normalized.start_ms.filter(|&value| value != 0);
    normalized.end_ms = normalized.end_ms.filter(|&value| value != 0);
    normalized.width = normalized.width.filter(|&value| value != 0);
    normalized.height = normalized.height.filter(|&value| value != 0);
    normalized.bitrate_kbps = normalized.bitrate_kbps.filter(|&value| value != 0);
    normalized.sample_rate = normalized.sample_rate.filter(|&value| value != 0);
    normalized
}

/// The only codec values this build accepts. A native capability probe may
/// widen this list additively; it is never built from caller text.
pub fn media_codec_is_supported(codec: &str) -> bool {
    codec == MEDIA_CODEC_AUTO
}

/// Validate the typed options before a job starts. Every value is bounded by
/// D4/D5; anything else is `convert.bad_request` or `convert.unsupported`.
pub fn validate_media_options(options: &MediaConversionOptions) -> Result<(), ConvertError> {
    let options = normalize_media_options(options);
    if let Some(start_ms) = options.start_ms {
        if start_ms >= MAX_MEDIA_DURATION_MS {
            return Err(ConvertError::BadRequest);
        }
    }
    if let Some(end_ms) = options.end_ms {
        let start_ms = options.start_ms.unwrap_or(0);
        if end_ms >= MAX_MEDIA_DURATION_MS || end_ms <= start_ms {
            return Err(ConvertError::BadRequest);
        }
    }
    for dimension in [options.width, options.height].into_iter().flatten() {
        if dimension > MAX_MEDIA_DIMENSION {
            return Err(ConvertError::BadRequest);
        }
    }
    if let Some(bitrate) = options.bitrate_kbps {
        if !(MIN_MEDIA_BITRATE_KBPS..=MAX_MEDIA_BITRATE_KBPS).contains(&bitrate) {
            return Err(ConvertError::BadRequest);
        }
    }
    if let Some(rate) = options.sample_rate {
        if !(MIN_MEDIA_SAMPLE_RATE..=MAX_MEDIA_SAMPLE_RATE).contains(&rate) {
            return Err(ConvertError::BadRequest);
        }
    }
    if !options.speed.is_finite() || !(0.25..=4.0).contains(&options.speed) {
        return Err(ConvertError::BadRequest);
    }
    if !options.volume.is_finite() || !(0.0..=4.0).contains(&options.volume) {
        return Err(ConvertError::BadRequest);
    }
    // The audited build's encoder table is fixed, so a caller-selected codec
    // name must not be translated into a claim about a build that was never
    // probed. Only the shared `auto` value is accepted until a capability
    // probe enumerates real encoders.
    if !media_codec_is_supported(&options.video_codec)
        || !media_codec_is_supported(&options.audio_codec)
    {
        return Err(ConvertError::Unsupported);
    }
    // This revision accepts exactly one authorized input and has no separate
    // subtitle source field, so burning subtitles cannot be requested without
    // guessing a side-car path. Refuse instead of silently ignoring it.
    if options.burn_subtitles {
        return Err(ConvertError::Unsupported);
    }
    Ok(())
}

/// Validate an options value that must belong to the media family. This stops
/// a media converter from running with image, PDF or Office options by
/// mistake.
pub fn validate_media_request(
    options: &ConvertOptions,
) -> Result<&MediaConversionOptions, ConvertError> {
    let ConvertOptions::Media(media) = options else {
        return Err(ConvertError::BadRequest);
    };
    validate_media_options(media)?;
    Ok(media)
}

/// The exact warnings a GIF output requires (E8). Colors are always
/// quantized, so `palette_reduction` is always present; the other three
/// depend on the source.
pub fn gif_warning_codes(facts: &GifSourceFacts) -> Vec<ConversionWarningCode> {
    let mut codes = vec![ConversionWarningCode::PaletteReduction];
    if facts.has_audio {
        codes.push(ConversionWarningCode::AudioLoss);
    }
    if facts.has_nonbinary_alpha {
        codes.push(ConversionWarningCode::TransparencyLoss);
    }
    if gif_timing_is_inexact(facts) {
        codes.push(ConversionWarningCode::FrameRateChange);
    }
    codes
}

/// GIF stores each delay in hundredths of a second. A constant presentation
/// offset is rebased to zero and does not change timing, so only the deltas
/// between consecutive timestamps matter.
fn gif_timing_is_inexact(facts: &GifSourceFacts) -> bool {
    if facts.frame_timestamps_us.len() > MAX_GIF_TIMESTAMPS {
        // Do not scan an unbounded probe result; the safe answer is that the
        // exact timing cannot be promised.
        return true;
    }
    facts
        .frame_timestamps_us
        .windows(2)
        .any(|pair| match pair[1].checked_sub(pair[0]) {
            Some(delta) if delta > 0 => delta % GIF_TIMESTAMP_US != 0,
            // A duplicate or backwards timestamp cannot be represented.
            Some(_) | None => true,
        })
}

/// Filter the native preservation claim down to what the output container
/// can really carry. Duplicates are removed; an oversized claim is refused.
fn bounded_preserves(
    output: FormatId,
    preserves: &[MetadataCategory],
) -> Result<Vec<MetadataCategory>, ConvertError> {
    if preserves.len() > MAX_ACCEPTED {
        return Err(ConvertError::BadRequest);
    }
    let possible = preservable_metadata(output);
    let mut seen = BTreeSet::new();
    Ok(preserves
        .iter()
        .copied()
        .filter(|category| possible.contains(category))
        .filter(|category| seen.insert(*category))
        .collect())
}

/// Every required code must be acknowledged, and no unknown code may appear.
/// A missing acknowledgement fails before any output begins.
pub fn require_acknowledged(
    required: &[ConversionWarningCode],
    accepted: &[ConversionWarningCode],
) -> Result<(), ConvertError> {
    if required.len() > MAX_ACCEPTED || accepted.len() > MAX_ACCEPTED {
        return Err(ConvertError::BadRequest);
    }
    let mut seen = BTreeSet::new();
    for code in accepted {
        if !seen.insert(*code) {
            // Duplicates are refused by the request contract.
            return Err(ConvertError::BadRequest);
        }
        // Acknowledgement is consent for this exact source/options pair, not
        // a blanket list: a code the preview did not require is unknown here.
        if !required.contains(code) {
            return Err(ConvertError::BadRequest);
        }
    }
    for code in required {
        if !seen.contains(code) {
            return Err(ConvertError::WarningRequired);
        }
    }
    Ok(())
}
