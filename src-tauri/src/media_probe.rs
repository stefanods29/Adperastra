//! Bounded media probing and sample timing (Step 12b T3, revision
//! `media-probe-2`).
//!
//! `ffprobe` output is untrusted text: it is parsed with hard caps (1 MiB
//! document, 64 streams, 512 tags, 4 KiB tag values) and anything beyond a cap
//! is refused instead of truncated. Times stay integer microseconds; the D5
//! trim contract converts them to sample indices with exact integer arithmetic.
//!
//! The probe runs through `EngineHost` like every other engine action; this
//! module never launches a process itself.
#![allow(dead_code)]


use std::sync::Arc;

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::SourceStamp;
use serde::Deserialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::cache::CacheService;
use crate::engine_process::EngineHost;
use crate::engine_types::{
    DiskConversionInput, EngineAction, EngineError, EngineInput, EngineRequest, EngineSource,
    FrameRate, MediaInfo, MediaStream, MediaStreamKind, MediaTag, MEDIA_MAX_DIMENSION,
    MEDIA_MAX_DURATION_US, MEDIA_MAX_STREAMS, MEDIA_MAX_TAGS, MEDIA_MAX_TAG_VALUE, PROBE_TIMEOUT_MS,
};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::media_arguments;
use crate::{ensure_main, valid_request_id};

/// The largest probe document accepted (D4).
pub const MAX_PROBE_BYTES: usize = 1024 * 1024;

/// Why a probe result was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeError {
    /// The document or one of its counts exceeds the published limits.
    TooLarge,
    /// The text is not the JSON shape an ffprobe run produces.
    BadJson,
    /// The document describes nothing usable (no duration, no format).
    Missing,
}

impl ProbeError {
    /// The native code the UI translates.
    pub fn code(self) -> &'static str {
        match self {
            Self::TooLarge | Self::Missing | Self::BadJson => EngineError::Unsupported.code(),
        }
    }
}

/// What a probe document said, before it is bound to a source identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProbe {
    pub duration_us: u64,
    pub streams: Vec<MediaStream>,
    pub tags: Vec<MediaTag>,
    pub format: String,
}

/// The sample range of a trim, as inclusive sample indices at `sample_rate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SampleRange {
    /// First sample written, inclusive.
    pub first: u64,
    /// One past the last sample written.
    pub end_exclusive: u64,
}

impl SampleRange {
    /// Last sample written, inclusive.
    pub fn last_inclusive(&self) -> Option<u64> {
        self.end_exclusive.checked_sub(1)
    }

    pub fn count(&self) -> u64 {
        self.end_exclusive.saturating_sub(self.first)
    }
}

/// The D5 sample interval: both ends rounded up to a whole sample, so a range
/// that starts inside a sample includes it.
pub fn trim_samples(
    start_us: Option<u64>,
    end_us: Option<u64>,
    sample_rate: u32,
    duration_us: u64,
) -> Result<SampleRange, ProbeError> {
    if sample_rate == 0 {
        return Err(ProbeError::Missing);
    }
    if duration_us > MEDIA_MAX_DURATION_US {
        return Err(ProbeError::TooLarge);
    }
    let rate = u128::from(sample_rate);
    let start = start_us.unwrap_or(0).min(duration_us);
    let end = end_us.unwrap_or(duration_us).min(duration_us);
    if end <= start {
        return Err(ProbeError::Missing);
    }
    let first = (u128::from(start) * rate).div_ceil(1_000_000);
    let end_exclusive = (u128::from(end) * rate).div_ceil(1_000_000);
    let first = u64::try_from(first).map_err(|_| ProbeError::TooLarge)?;
    let end_exclusive = u64::try_from(end_exclusive).map_err(|_| ProbeError::TooLarge)?;
    if end_exclusive <= first {
        return Err(ProbeError::Missing);
    }
    Ok(SampleRange {
        first,
        end_exclusive,
    })
}

#[derive(Debug, Deserialize)]
struct ProbeDocument {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    #[serde(default)]
    index: u32,
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    avg_frame_rate: Option<String>,
    #[serde(default)]
    r_frame_rate: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    tags: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    format_name: Option<String>,
    #[serde(default)]
    tags: Option<serde_json::Map<String, serde_json::Value>>,
}

/// Parse one bounded `ffprobe -print_format json` document.
pub fn parse_probe_json(bytes: &[u8]) -> Result<ParsedProbe, ProbeError> {
    if bytes.is_empty() || bytes.len() > MAX_PROBE_BYTES {
        return Err(ProbeError::TooLarge);
    }
    let document: ProbeDocument =
        serde_json::from_slice(bytes).map_err(|_| ProbeError::BadJson)?;
    if document.streams.len() > MEDIA_MAX_STREAMS {
        return Err(ProbeError::TooLarge);
    }
    let format = document.format.ok_or(ProbeError::Missing)?;
    let duration_us = parse_duration_us(format.duration.as_deref())?;
    let mut streams = Vec::new();
    for stream in &document.streams {
        let Some(kind) = stream
            .codec_type
            .as_deref()
            .and_then(stream_kind)
        else {
            continue;
        };
        let codec = stream.codec_name.clone().unwrap_or_default();
        if codec.len() > 64 {
            return Err(ProbeError::TooLarge);
        }
        let width = stream.width.filter(|width| *width > 0 && *width <= MEDIA_MAX_DIMENSION);
        let height = stream
            .height
            .filter(|height| *height > 0 && *height <= MEDIA_MAX_DIMENSION);
        let frame_rate = stream
            .avg_frame_rate
            .as_deref()
            .and_then(parse_frame_rate)
            .or_else(|| stream.r_frame_rate.as_deref().and_then(parse_frame_rate));
        let sample_rate = stream
            .sample_rate
            .as_deref()
            .and_then(|rate| rate.parse::<u32>().ok())
            .filter(|rate| (8_000..=192_000).contains(rate));
        let channels = stream
            .channels
            .and_then(|channels| u8::try_from(channels).ok())
            .filter(|channels| *channels > 0 && *channels <= 32);
        let language = stream
            .tags
            .as_ref()
            .and_then(|tags| tags.get("language"))
            .and_then(|value| value.as_str())
            .filter(|language| !language.is_empty() && language.len() <= 32)
            .map(|language| language.to_string());
        streams.push(MediaStream {
            index: stream.index,
            kind,
            codec,
            width,
            height,
            frame_rate,
            sample_rate,
            channels,
            language,
        });
    }
    let mut tags: Vec<MediaTag> = Vec::new();
    for (key, value) in format.tags.iter().flatten() {
        push_tag(&mut tags, key, value)?;
    }
    for stream in &document.streams {
        for (key, value) in stream.tags.iter().flatten() {
            if key == "language" {
                continue;
            }
            push_tag(&mut tags, key, value)?;
        }
    }
    if tags.len() > MEDIA_MAX_TAGS {
        return Err(ProbeError::TooLarge);
    }
    let format_name = format.format_name.unwrap_or_default();
    if format_name.is_empty() || format_name.len() > 64 {
        return Err(ProbeError::Missing);
    }
    Ok(ParsedProbe {
        duration_us,
        streams,
        tags,
        format: format_name,
    })
}

/// Bind a parsed probe to the identity of the file it described.
pub fn assemble_input(stamp: SourceStamp, parsed: ParsedProbe) -> Option<MediaInfo> {
    Some(MediaInfo {
        source: stamp,
        duration_us: parsed.duration_us,
        streams: parsed.streams,
        tags: parsed.tags,
        format: parsed.format,
    })
}

/// Probe one of our own private files (a produced output). The identity is
/// captured again from the file itself, so a swapped file is refused; no
/// `SourceStamp` is claimed for a temporary, and the result is used only to
/// compare what the source kept with what the output carries.
pub fn probe_path(
    host: &EngineHost,
    path: &std::path::Path,
    context: &JobContext,
) -> Result<ParsedProbe, String> {
    let identity = SourceIdentity::capture(path).map_err(|_| EngineError::Changed.message())?;
    let pinned =
        PinnedSource::open(path, &identity).map_err(|_| EngineError::Changed.message())?;
    let input = EngineInput {
        input_index: 0,
        original: convert::ConversionInput::File {
            path: path.to_string_lossy().into_owned(),
            expected: None,
        },
        stamp: None,
        source: EngineSource::Disk(pinned),
        sensitive: false,
    };
    run_probe(host, input, context)
}

/// E2: probe one authorized disk input. The caller resolved the stamp through
/// the shared cache service (07a E3) and passes it in; this module never
/// duplicates stamp capture.
pub fn probe_disk_input(
    host: &EngineHost,
    input: DiskConversionInput,
    stamp: SourceStamp,
    context: &JobContext,
) -> Result<MediaInfo, String> {
    let path = std::path::PathBuf::from(&input.path);
    let identity = SourceIdentity::capture(&path).map_err(|_| EngineError::Changed.message())?;
    if let Some(expected) = &input.expected {
        if expected != &stamp {
            return Err(EngineError::Changed.message());
        }
    }
    let pinned = PinnedSource::open(&path, &identity).map_err(|_| EngineError::Changed.message())?;
    let engine_input = EngineInput {
        input_index: 0,
        original: convert::ConversionInput::File {
            path: input.path.clone(),
            expected: Some(stamp.clone()),
        },
        stamp: Some(stamp.clone()),
        source: EngineSource::Disk(pinned),
        sensitive: false,
    };
    let parsed = run_probe(host, engine_input, context)?;
    assemble_input(stamp, parsed).ok_or_else(|| EngineError::Failed.message())
}

/// E2: start one bounded probe job for an authorized disk input. The shared
/// cache resolves the stamp once, so the job result is bound to the exact
/// revision the UI asked about.
#[tauri::command]
pub fn media_probe_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    cache: State<'_, Arc<CacheService>>,
    host: State<'_, Arc<EngineHost>>,
    request_id: String,
    input: DiskConversionInput,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    crate::validate_absolute_path(&input.path).map_err(|_| EngineError::BadRequest.message())?;
    let stamp = cache
        .source_stamp(std::path::Path::new(&input.path))
        .map_err(|_| EngineError::Changed.message())?;
    let token = jobs.begin(&request_id, 1)?;
    let host = Arc::clone(host.inner());
    spawn_job(app, request_id, token, move |context| {
        let info = probe_disk_input(&host, input, stamp, context)?;
        info.validate().map_err(|error| error.message())?;
        serde_json::to_value(info).map_err(|_| EngineError::Failed.message())
    });
    Ok(())
}

fn run_probe(
    host: &EngineHost,
    input: EngineInput,
    context: &JobContext,
) -> Result<ParsedProbe, String> {
    let work_dir = host
        .new_private_root("probe")
        .map_err(|_| EngineError::SandboxFailed.message())?
        .1;
    let request = EngineRequest {
        request_id: uuid::Uuid::new_v4(),
        timeout_ms: PROBE_TIMEOUT_MS,
        work_dir,
        action: EngineAction::ProbeMedia {
            inputs: vec![input],
        },
    };
    let run = host.run_capture(&request, context)?;
    parse_probe_json(&run.stdout).map_err(|error| error.code().to_string())
}

fn stream_kind(name: &str) -> Option<MediaStreamKind> {
    Some(match name {
        "video" => MediaStreamKind::Video,
        "audio" => MediaStreamKind::Audio,
        "subtitle" => MediaStreamKind::Subtitle,
        _ => return None,
    })
}

fn parse_duration_us(text: Option<&str>) -> Result<u64, ProbeError> {
    let Some(text) = text else {
        return Ok(0);
    };
    let seconds: f64 = text.parse().map_err(|_| ProbeError::BadJson)?;
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(ProbeError::BadJson);
    }
    let micros = (seconds * 1_000_000.0).round();
    if micros > MEDIA_MAX_DURATION_US as f64 {
        return Err(ProbeError::TooLarge);
    }
    Ok(micros as u64)
}

fn parse_frame_rate(text: &str) -> Option<FrameRate> {
    let (numerator, denominator) = text.split_once('/')?;
    let num: u32 = numerator.trim().parse().ok()?;
    let den: u32 = denominator.trim().parse().ok()?;
    FrameRate::new(num, den)
}

/// Keep only keys this probe can classify; an unknown key is never assigned a
/// category it might not belong to.
fn push_tag(
    tags: &mut Vec<MediaTag>,
    key: &str,
    value: &serde_json::Value,
) -> Result<(), ProbeError> {
    if tags.len() > MEDIA_MAX_TAGS {
        return Err(ProbeError::TooLarge);
    }
    let Some(category) = category_of(key) else {
        return Ok(());
    };
    let Some(text) = value.as_str() else {
        return Ok(());
    };
    if key.len() > 128 || text.len() > MEDIA_MAX_TAG_VALUE {
        return Err(ProbeError::TooLarge);
    }
    tags.push(MediaTag {
        key: key.to_string(),
        value: text.to_string(),
        category,
    });
    Ok(())
}

/// The metadata category of a known tag key.
fn category_of(key: &str) -> Option<convert::MetadataCategory> {
    use convert::MetadataCategory as Category;
    let lowered = key.to_ascii_lowercase();
    Some(match lowered.as_str() {
        "encoder" | "encoder_settings" | "writing application" | "writing library" => {
            Category::Encoder
        }
        "artist" | "author" | "composer" | "copyright" | "album_artist" => Category::Author,
        "creation_time" | "date" | "year" | "date_released" => Category::Date,
        "comment" | "description" | "title" => Category::Comments,
        "location" | "com.apple.quicktime.location.iso6709" => Category::Gps,
        "make" | "model" | "lens_model" | "handler_name" => Category::Camera,
        _ => return None,
    })
}

/// The argument builder used by the media jobs (kept here so a preview and a
/// probe always agree on the flags).
pub fn probe_arguments(input: &std::path::Path) -> Vec<String> {
    media_arguments::probe_arguments(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_beyond_the_cap_are_refused() {
        let mut streams = String::new();
        for index in 0..65 {
            if index > 0 {
                streams.push(',');
            }
            streams.push_str(&format!(
                "{{\"index\":{index},\"codec_type\":\"video\",\"codec_name\":\"h264\"}}"
            ));
        }
        let document = format!(
            "{{\"streams\":[{streams}],\"format\":{{\"duration\":\"1.0\",\"format_name\":\"mp4\"}}}}"
        );
        assert_eq!(
            parse_probe_json(document.as_bytes()).err(),
            Some(ProbeError::TooLarge)
        );
    }

    #[test]
    fn trim_bounds_round_up_to_whole_samples() {
        let range = trim_samples(Some(1), Some(1_000_001), 48_000, 10_000_000).unwrap();
        assert_eq!(range.first, 1);
        assert_eq!(range.end_exclusive, 48_001);
        assert_eq!(range.last_inclusive(), Some(48_000));
        assert_eq!(range.count(), 48_000);
    }

    #[test]
    fn durations_are_microseconds() {
        let document = br#"{"streams":[{"index":0,"codec_type":"video","codec_name":"vp9",
            "width":640,"height":360,"avg_frame_rate":"30000/1001",
            "tags":{"language":"eng"}}],
            "format":{"duration":"10.000001","format_name":"matroska,webm",
            "tags":{"encoder":"libwebm","creation_time":"2024-01-02T03:04:05Z",
            "artist":"Ada","unknown_key":"x"}}}"#;
        let parsed = parse_probe_json(document).unwrap();
        assert_eq!(parsed.duration_us, 10_000_001);
        assert_eq!(parsed.streams.len(), 1);
        assert_eq!(parsed.streams[0].frame_rate, FrameRate::new(30_000, 1001));
        let categories: Vec<convert::MetadataCategory> =
            parsed.tags.iter().map(|tag| tag.category).collect();
        assert!(categories.contains(&convert::MetadataCategory::Encoder));
        assert!(categories.contains(&convert::MetadataCategory::Date));
        assert!(categories.contains(&convert::MetadataCategory::Author));
        assert_eq!(categories.len(), 3, "an unknown key gets no category");
    }
}
