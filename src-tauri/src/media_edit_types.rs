//! Canonical native media-edit types (Step 15, `media-edit-1`/`media-time-1`).
//!
//! The TypeScript mirror is `src/media-edit/types.ts`. `TimeUs` is the
//! integer-microsecond unit and `FrameRate` is the rational type imported
//! from Step 12b; neither is redefined here. A recipe contains instructions
//! and source stamps only: no media bytes, grants, passwords or CLI text.
#![allow(dead_code)]


use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::engine_types::{FrameRate, MEDIA_MAX_DURATION_US};

pub const MEDIA_EDIT_MIME: &str = "application/vnd.adperastra.media-edit+json";
pub const MAX_MEDIA_RECIPE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MEDIA_SOURCES: usize = 100;
pub const MAX_MEDIA_SEGMENTS: usize = 10_000;
pub const MAX_MEDIA_SUBTITLE_CUES: usize = 100_000;
pub const MAX_MEDIA_SUBTITLE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_MEDIA_SUBTITLE_TEXT: usize = 8_192;
pub const MAX_MEDIA_PATH_UNITS: usize = 32_768;
pub const MIN_MEDIA_SPEED: f64 = 0.25;
pub const MAX_MEDIA_SPEED: f64 = 4.0;
pub const MAX_MEDIA_VOLUME: f64 = 4.0;
pub const WAVEFORM_BUCKETS_PER_SECOND: u64 = 100;
pub const WAVEFORM_BUCKETS_PER_PAGE: usize = 512;
pub const WAVEFORM_MAX_MINUTES: u64 = 100;
pub const WAVEFORM_MAX_CHANNELS: u8 = 8;
pub const MAX_MEDIA_HISTORY: usize = 200;

/// Whole microseconds, imported in meaning from 12b (`media-time-1`).
pub type TimeUs = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaEditError {
    BadRequest,
    MissingSource,
    Changed,
    Unsupported,
    TooLarge,
    ReadOnly,
    Failed,
}

impl MediaEditError {
    pub fn code(self) -> &'static str {
        match self {
            Self::BadRequest => "media_edit.bad_request",
            Self::MissingSource => "media_edit.missing_source",
            Self::Changed => "media_edit.changed",
            Self::Unsupported => "media_edit.unsupported",
            Self::TooLarge => "media_edit.too_large",
            Self::ReadOnly => "media_edit.read_only",
            Self::Failed => "media_edit.failed",
        }
    }

    pub fn message(self) -> String {
        self.code().to_string()
    }
}

impl From<MediaEditError> for String {
    fn from(error: MediaEditError) -> Self {
        error.message()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaSubtitleMode {
    Off,
    Select,
    Burn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaSource {
    pub id: Uuid,
    pub path: String,
    pub stamp: fs_service::SourceStamp,
    pub duration_us: u64,
    pub video_rate: Option<FrameRate>,
    pub audio_rate: Option<u32>,
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaSegment {
    pub id: Uuid,
    pub source_id: Uuid,
    pub start_us: u64,
    pub end_us: u64,
    pub speed: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaCrop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaSubtitleCue {
    pub id: Uuid,
    pub start_us: u64,
    pub end_us: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaRecipe {
    pub schema_version: u32,
    pub project_id: Uuid,
    pub content_id: Uuid,
    pub sources: Vec<MediaSource>,
    pub segments: Vec<MediaSegment>,
    pub crop: Option<MediaCrop>,
    pub rotation: u16,
    pub volume: f64,
    pub mute: bool,
    pub keep_pitch: bool,
    pub subtitles: Vec<MediaSubtitleCue>,
    pub subtitle_mode: MediaSubtitleMode,
    pub metadata_keep: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MediaEditOperation {
    SetSegments { segments: Vec<MediaSegment> },
    SetCrop { crop: Option<MediaCrop> },
    SetRotation { rotation: u16 },
    SetSpeed { segment_id: Uuid, speed: f64 },
    SetGain { volume: f64, mute: bool },
    SetKeepPitch { keep_pitch: bool },
    RelinkSource { source_id: Uuid, replacement: MediaSource },
    SetSubtitles { cues: Vec<MediaSubtitleCue>, mode: MediaSubtitleMode },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WavePeak {
    pub min: f32,
    pub max: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WavePage {
    pub source_id: Uuid,
    pub channel: u8,
    pub first_bucket: u32,
    pub buckets: Vec<WavePeak>,
    pub total_buckets: u32,
}

fn is_absolute_windows_path(path: &str) -> bool {
    if path.is_empty() || path.encode_utf16().count() > MAX_MEDIA_PATH_UNITS {
        return false;
    }
    if path.chars().any(|character| character.is_control()) {
        return false;
    }
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return false;
    }
    !path.split(['\\', '/']).any(|part| part == "..")
}

fn valid_stamp(stamp: &fs_service::SourceStamp) -> bool {
    let valid_hex = |text: &str, length: usize| {
        text.len() == length && text.bytes().all(|byte| byte.is_ascii_hexdigit())
    };
    is_absolute_windows_path(&stamp.path_key)
        && valid_hex(&stamp.volume_id, 8)
        && valid_hex(&stamp.file_id, 16)
        && !stamp.modified_ticks.is_empty()
        && stamp
            .modified_ticks
            .bytes()
            .all(|byte| byte.is_ascii_digit())
        && stamp.size_bytes < (1u64 << 53)
}

fn speed_millionths(speed: f64) -> Result<u64, MediaEditError> {
    if !speed.is_finite() || !(MIN_MEDIA_SPEED..=MAX_MEDIA_SPEED).contains(&speed) {
        return Err(MediaEditError::BadRequest);
    }
    let scaled = (speed * 1_000_000.0).round();
    if (scaled - speed * 1_000_000.0).abs() > 1e-6 {
        return Err(MediaEditError::BadRequest);
    }
    if scaled < 1.0 {
        return Err(MediaEditError::BadRequest);
    }
    Ok(scaled as u64)
}

/** round((end - start) / speed) with checked integer arithmetic. */
pub fn segment_duration_us(span_us: u64, speed: f64) -> Result<u64, MediaEditError> {
    let micros = u128::from(speed_millionths(speed)?);
    let span = u128::from(span_us) * 1_000_000u128;
    let rounded = (span + micros / 2) / micros;
    u64::try_from(rounded).map_err(|_| MediaEditError::TooLarge)
}

impl MediaRecipe {
    /** Validate and normalize segment/cue order without changing edits. */
    pub fn normalize(mut self) -> Result<Self, MediaEditError> {
        self.segments
            .sort_by_key(|segment| (segment.start_us, segment.end_us));
        self.subtitles
            .sort_by_key(|cue| (cue.start_us, cue.end_us));
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), MediaEditError> {
        if self.schema_version != 1 {
            return Err(MediaEditError::Unsupported);
        }
        if self.sources.is_empty() || self.sources.len() > MAX_MEDIA_SOURCES {
            return Err(MediaEditError::BadRequest);
        }
        let mut source_ids = std::collections::HashSet::new();
        let mut paths = std::collections::HashSet::new();
        let mut durations = std::collections::HashMap::new();
        for source in &self.sources {
            if !source_ids.insert(source.id) || !paths.insert(source.path.to_lowercase()) {
                return Err(MediaEditError::BadRequest);
            }
            durations.insert(source.id, source.duration_us);
            if !is_absolute_windows_path(&source.path) || !valid_stamp(&source.stamp) {
                return Err(MediaEditError::BadRequest);
            }
            if source.sensitive {
                return Err(MediaEditError::Unsupported);
            }
            if source.duration_us > MEDIA_MAX_DURATION_US {
                return Err(MediaEditError::TooLarge);
            }
            if let Some(rate) = source.video_rate {
                if FrameRate::new(rate.num, rate.den) != Some(rate) {
                    return Err(MediaEditError::BadRequest);
                }
            }
            if let Some(rate) = source.audio_rate {
                if rate == 0 || rate > 1_000_000 {
                    return Err(MediaEditError::BadRequest);
                }
            }
        }
        if self.segments.is_empty() || self.segments.len() > MAX_MEDIA_SEGMENTS {
            return Err(MediaEditError::BadRequest);
        }
        let mut segment_ids = std::collections::HashSet::new();
        let mut previous_end = 0u64;
        for segment in &self.segments {
            if !segment_ids.insert(segment.id) || !source_ids.contains(&segment.source_id) {
                return Err(if source_ids.contains(&segment.source_id) {
                    MediaEditError::BadRequest
                } else {
                    MediaEditError::MissingSource
                });
            }
            if segment.end_us <= segment.start_us || segment.start_us < previous_end {
                return Err(MediaEditError::BadRequest);
            }
            if segment.end_us > durations.get(&segment.source_id).copied().unwrap_or(0) {
                return Err(MediaEditError::BadRequest);
            }
            speed_millionths(segment.speed)?;
            if segment_duration_us(segment.end_us - segment.start_us, segment.speed)? == 0 {
                return Err(MediaEditError::BadRequest);
            }
            previous_end = segment.end_us;
        }
        if let Some(crop) = self.crop {
            if crop.width == 0 || crop.height == 0 {
                return Err(MediaEditError::BadRequest);
            }
        }
        if ![0, 90, 180, 270].contains(&self.rotation) {
            return Err(MediaEditError::BadRequest);
        }
        if !self.volume.is_finite() || !(0.0..=MAX_MEDIA_VOLUME).contains(&self.volume) {
            return Err(MediaEditError::BadRequest);
        }
        if self.subtitles.len() > MAX_MEDIA_SUBTITLE_CUES {
            return Err(MediaEditError::TooLarge);
        }
        let mut cue_ids = std::collections::HashSet::new();
        let mut text_bytes = 0usize;
        for cue in &self.subtitles {
            if !cue_ids.insert(cue.id) || cue.end_us <= cue.start_us {
                return Err(MediaEditError::BadRequest);
            }
            if cue.text.chars().count() > MAX_MEDIA_SUBTITLE_TEXT {
                return Err(MediaEditError::BadRequest);
            }
            text_bytes = text_bytes.saturating_add(cue.text.len());
            if text_bytes > MAX_MEDIA_SUBTITLE_BYTES {
                return Err(MediaEditError::TooLarge);
            }
        }
        if self.subtitle_mode != MediaSubtitleMode::Off && self.subtitles.is_empty() {
            return Err(MediaEditError::BadRequest);
        }
        Ok(())
    }

    pub fn duration_us(&self) -> Result<u64, MediaEditError> {
        let mut total = 0u64;
        for segment in &self.segments {
            total = total
                .checked_add(segment_duration_us(
                    segment.end_us - segment.start_us,
                    segment.speed,
                )?)
                .ok_or(MediaEditError::TooLarge)?;
        }
        Ok(total)
    }
}

impl WavePeak {
    pub fn validate(&self) -> Result<(), MediaEditError> {
        if !self.min.is_finite() || !self.max.is_finite() || self.min < -1.0 || self.max > 1.0 || self.min > self.max
        {
            return Err(MediaEditError::Failed);
        }
        Ok(())
    }
}

impl WavePage {
    pub fn validate(&self) -> Result<(), MediaEditError> {
        if self.buckets.len() > WAVEFORM_BUCKETS_PER_PAGE {
            return Err(MediaEditError::TooLarge);
        }
        let maximum = WAVEFORM_MAX_MINUTES * 60 * WAVEFORM_BUCKETS_PER_SECOND;
        if u64::from(self.total_buckets) > maximum || self.channel >= WAVEFORM_MAX_CHANNELS {
            return Err(MediaEditError::TooLarge);
        }
        for peak in &self.buckets {
            peak.validate()?;
        }
        Ok(())
    }
}

/// Reads a canonical recipe from JSON bytes; unknown fields are refused.
pub fn decode_recipe(bytes: &[u8]) -> Result<MediaRecipe, MediaEditError> {
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_RECIPE_BYTES {
        return Err(MediaEditError::TooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| MediaEditError::BadRequest)?;
    let recipe: MediaRecipe =
        serde_json::from_str(text).map_err(|_| MediaEditError::BadRequest)?;
    recipe.normalize()
}

/** Apply one operation to a complete validated recipe (`D2`). */
pub fn apply_operation(
    recipe: &MediaRecipe,
    operation: &MediaEditOperation,
) -> Result<MediaRecipe, MediaEditError> {
    let mut next = recipe.clone();
    match operation {
        MediaEditOperation::SetSegments { segments } => next.segments = segments.clone(),
        MediaEditOperation::SetCrop { crop } => next.crop = *crop,
        MediaEditOperation::SetRotation { rotation } => next.rotation = *rotation,
        MediaEditOperation::SetSpeed { segment_id, speed } => {
            let segment = next
                .segments
                .iter_mut()
                .find(|segment| segment.id == *segment_id)
                .ok_or(MediaEditError::BadRequest)?;
            segment.speed = *speed;
        }
        MediaEditOperation::SetGain { volume, mute } => {
            next.volume = *volume;
            next.mute = *mute;
        }
        MediaEditOperation::SetKeepPitch { keep_pitch } => next.keep_pitch = *keep_pitch,
        MediaEditOperation::RelinkSource {
            source_id,
            replacement,
        } => {
            let index = next
                .sources
                .iter()
                .position(|source| source.id == *source_id)
                .ok_or(MediaEditError::MissingSource)?;
            let longest = next
                .segments
                .iter()
                .filter(|segment| segment.source_id == *source_id)
                .map(|segment| segment.end_us)
                .max()
                .unwrap_or(0);
            if replacement.duration_us < longest {
                return Err(MediaEditError::Unsupported);
            }
            let mut replacement = replacement.clone();
            replacement.id = *source_id;
            next.sources[index] = replacement;
        }
        MediaEditOperation::SetSubtitles { cues, mode } => {
            next.subtitles = cues.clone();
            next.subtitle_mode = *mode;
        }
    }
    next.normalize()
}


