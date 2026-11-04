//! Canonical timeline project types (Step 19a, revision `timeline-project-1`).
//!
//! The native mirror of `src/timeline/types.ts`. A project stores edit
//! instructions and source references only; the media source type is the
//! Step 15 definition and `FrameRate` is the Step 12b one. Every interval is
//! start-inclusive/end-exclusive and every time is integer microseconds.
//! Validation enforces the published bounds before a project reaches a job or
//! a render plan.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};

use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::engine_types::{FrameRate, MEDIA_MAX_DURATION_US};
use crate::jobs::{spawn_job, Jobs};
use crate::media_edit_types::{MediaCrop, MediaSource, MediaSubtitleCue};

pub const TIMELINE_SCHEMA_VERSION: u32 = 1;
pub const TIMELINE_MAX_PROJECT_BYTES: usize = 16 * 1024 * 1024;
pub const TIMELINE_MAX_EXTENSIONS_BYTES: usize = 1024 * 1024;
pub const TIMELINE_MAX_TRACKS: usize = 128;
pub const TIMELINE_MAX_CLIPS: usize = 10_000;
pub const TIMELINE_MAX_SOURCES: usize = 1_000;
pub const TIMELINE_MAX_TRANSITIONS: usize = 10_000;
pub const TIMELINE_MAX_TITLES: usize = 1_000;
pub const TIMELINE_MAX_SUBTITLES: usize = 100_000;
pub const TIMELINE_MAX_DIMENSION: u32 = 8_192;
pub const TIMELINE_MAX_PIXELS: u64 = 100_000_000;
pub const TIMELINE_AUDIO_RATE: u32 = 48_000;
pub const TIMELINE_MAX_EFFECTS_PER_CLIP: usize = 64;
pub const TIMELINE_MAX_NAME: usize = 128;

/// Stable area errors; the UI translates `errors.timeline.*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelineError {
    BadRequest,
    MissingSource,
    Changed,
    Locked,
    Overlap,
    TooLarge,
    HistoryFull,
    Unsupported,
    Failed,
}

impl TimelineError {
    pub fn code(self) -> &'static str {
        match self {
            Self::BadRequest => "timeline.bad_request",
            Self::MissingSource => "timeline.missing_source",
            Self::Changed => "timeline.changed",
            Self::Locked => "timeline.locked",
            Self::Overlap => "timeline.overlap",
            Self::TooLarge => "timeline.too_large",
            Self::HistoryFull => "timeline.history_full",
            Self::Unsupported => "timeline.unsupported",
            Self::Failed => "timeline.failed",
        }
    }

    pub fn message(self) -> String {
        self.code().to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaybackRate {
    pub num: u32,
    pub den: u32,
}

impl PlaybackRate {
    fn valid(self) -> bool {
        if self.num == 0 || self.den == 0 {
            return false;
        }
        let divisor = |mut left: u32, mut right: u32| {
            while right != 0 {
                let next = left % right;
                left = right;
                right = next;
            }
            left
        };
        if divisor(self.num, self.den) != 1 {
            return false;
        }
        u64::from(self.num) <= 4 * u64::from(self.den)
            && u64::from(self.den) <= 4 * u64::from(self.num)
    }
}

fn default_rate() -> PlaybackRate {
    PlaybackRate { num: 1, den: 1 }
}

fn one() -> f64 {
    1.0
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTransform {
    pub crop: Option<MediaCrop>,
    #[serde(default)]
    pub rotation: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tag", rename_all = "snake_case")]
pub enum TimelineEffect {
    Brightness { value: f64 },
    Contrast { value: f64 },
    Saturation { value: f64 },
    Color { gamma: [f64; 3] },
    Crop { rect: MediaCrop },
    Stabilize { strength: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineClip {
    pub id: Uuid,
    pub source_id: Uuid,
    #[serde(default)]
    pub link_id: Option<Uuid>,
    pub start_us: u64,
    pub source_in_us: u64,
    pub source_out_us: u64,
    #[serde(default = "default_rate")]
    pub speed: PlaybackRate,
    #[serde(default = "one")]
    pub gain: f64,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub fade_in_us: u64,
    #[serde(default)]
    pub fade_out_us: u64,
    pub transform: TimelineTransform,
    #[serde(default)]
    pub effects: Vec<TimelineEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: Uuid,
    pub kind: TrackKind,
    pub name: String,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default = "one")]
    pub gain: f64,
    pub index: u16,
    #[serde(default)]
    pub clips: Vec<TimelineClip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    Crossfade,
    Dip,
    Wipe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransitionDirection {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTransition {
    pub id: Uuid,
    pub track_id: Uuid,
    pub left_clip_id: Uuid,
    pub right_clip_id: Uuid,
    pub kind: TransitionKind,
    pub duration_us: u64,
    pub direction: TransitionDirection,
    pub rgba: [u8; 4],
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TitleAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TitleAnimation {
    None,
    Fade,
    Slide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTitleStyle {
    pub font_asset_id: String,
    pub font_size: u32,
    pub rgba: [u8; 4],
    pub align: TitleAlign,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTitle {
    pub id: Uuid,
    pub track_id: Uuid,
    pub start_us: u64,
    pub end_us: u64,
    pub text: String,
    pub style: TimelineTitleStyle,
    pub animation: TitleAnimation,
    pub animation_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineProject {
    pub schema_version: u32,
    pub project_id: Uuid,
    pub content_id: Uuid,
    pub sources: Vec<MediaSource>,
    pub tracks: Vec<Track>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: FrameRate,
    pub audio_rate: u32,
    pub audio_channels: u8,
    #[serde(default)]
    pub transitions: Vec<TimelineTransition>,
    #[serde(default)]
    pub titles: Vec<TimelineTitle>,
    #[serde(default)]
    pub subtitles: Vec<MediaSubtitleCue>,
    #[serde(default)]
    pub extensions: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineOperation {
    AddTrack { track: Track },
    RemoveTrack { id: Uuid },
    AddClip { track_id: Uuid, clip: TimelineClip },
    MoveClip {
        id: Uuid,
        track_id: Uuid,
        start_us: u64,
    },
    TrimClip {
        id: Uuid,
        in_us: u64,
        out_us: u64,
    },
    SplitClip {
        id: Uuid,
        time_us: u64,
    },
    SlipClip {
        id: Uuid,
        delta_us: i64,
    },
    DeleteClips {
        ids: Vec<Uuid>,
        ripple: bool,
    },
    ReorderTracks {
        ids: Vec<Uuid>,
    },
    RelinkSource {
        id: Uuid,
        replacement: MediaSource,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineRenderPlan {
    pub project_id: Uuid,
    pub content_id: Uuid,
    pub duration_us: u64,
    pub frame_rate: FrameRate,
    pub width: u32,
    pub height: u32,
    pub audio_rate: u32,
    pub audio_channels: u8,
    pub tracks: Vec<Track>,
    pub sources: Vec<MediaSource>,
    pub transitions: Vec<TimelineTransition>,
    pub titles: Vec<TimelineTitle>,
    pub subtitles: Vec<MediaSubtitleCue>,
}

fn valid_stamp(stamp: &SourceStamp) -> bool {
    // The Step 12b stamp validator already checks the normalized path key,
    // lower-case volume/file ids, tick count and wire size.
    stamp.validate().is_ok()
}

pub fn validate_source(source: &MediaSource) -> Result<(), TimelineError> {
    if source.sensitive {
        return Err(TimelineError::Unsupported);
    }
    if source.path.contains("://") || source.path.chars().count() > 32_768 {
        return Err(TimelineError::BadRequest);
    }
    crate::validate_absolute_path(&source.path).map_err(|_| TimelineError::BadRequest)?;
    let path_key = fs_service::source_stamp::path_key_of(std::path::Path::new(&source.path))
        .map_err(|_| TimelineError::BadRequest)?;
    if path_key != source.stamp.path_key {
        return Err(TimelineError::BadRequest);
    }
    if source.duration_us > MEDIA_MAX_DURATION_US {
        return Err(TimelineError::TooLarge);
    }
    if !valid_stamp(&source.stamp) {
        return Err(TimelineError::BadRequest);
    }
    if let Some(rate) = source.video_rate {
        if FrameRate::new(rate.num, rate.den) != Some(rate) {
            return Err(TimelineError::BadRequest);
        }
    }
    if let Some(rate) = source.audio_rate {
        if rate == 0 || rate > 192_000 {
            return Err(TimelineError::BadRequest);
        }
    }
    Ok(())
}

fn duration_of(clip: &TimelineClip) -> Result<u64, TimelineError> {
    if clip.source_out_us <= clip.source_in_us || !clip.speed.valid() {
        return Err(TimelineError::BadRequest);
    }
    let length = u128::from(clip.source_out_us - clip.source_in_us);
    let top = length
        .checked_mul(u128::from(clip.speed.den))
        .ok_or(TimelineError::TooLarge)?;
    let duration = top.div_ceil(u128::from(clip.speed.num));
    u64::try_from(duration).map_err(|_| TimelineError::TooLarge)
}

fn valid_crop(crop: &MediaCrop) -> bool {
    crop.width > 0 && crop.height > 0
}

fn validate_clip(clip: &TimelineClip, sources: &HashMap<Uuid, u64>) -> Result<(), TimelineError> {
    let source_duration = *sources.get(&clip.source_id).ok_or(TimelineError::MissingSource)?;
    if clip.source_out_us <= clip.source_in_us || clip.source_out_us > source_duration {
        return Err(TimelineError::BadRequest);
    }
    if !clip.speed.valid() {
        return Err(TimelineError::BadRequest);
    }
    if !(0.0..=4.0).contains(&clip.gain) || !clip.gain.is_finite() {
        return Err(TimelineError::BadRequest);
    }
    if !matches!(clip.transform.rotation, 0 | 90 | 180 | 270) {
        return Err(TimelineError::BadRequest);
    }
    if let Some(crop) = &clip.transform.crop {
        if !valid_crop(crop) {
            return Err(TimelineError::BadRequest);
        }
    }
    if clip.effects.len() > TIMELINE_MAX_EFFECTS_PER_CLIP {
        return Err(TimelineError::TooLarge);
    }
    for effect in &clip.effects {
        match effect {
            TimelineEffect::Brightness { value }
            | TimelineEffect::Contrast { value }
            | TimelineEffect::Saturation { value } => {
                if !value.is_finite() || !(-1.0..=1.0).contains(value) {
                    return Err(TimelineError::BadRequest);
                }
            }
            TimelineEffect::Color { gamma } => {
                if gamma.iter().any(|value| !value.is_finite() || !(0.1..=10.0).contains(value)) {
                    return Err(TimelineError::BadRequest);
                }
            }
            TimelineEffect::Crop { rect } => {
                if !valid_crop(rect) {
                    return Err(TimelineError::BadRequest);
                }
            }
            TimelineEffect::Stabilize { strength } => {
                if !strength.is_finite() || !(0.0..=1.0).contains(strength) {
                    return Err(TimelineError::BadRequest);
                }
            }
        }
    }
    let duration = duration_of(clip)?;
    if clip
        .start_us
        .checked_add(duration)
        .is_none_or(|end| end > MEDIA_MAX_DURATION_US)
    {
        return Err(TimelineError::TooLarge);
    }
    let fades = clip
        .fade_in_us
        .checked_add(clip.fade_out_us)
        .ok_or(TimelineError::TooLarge)?;
    if fades > duration {
        return Err(TimelineError::BadRequest);
    }
    Ok(())
}

fn validate_track(track: &Track, position: usize, sources: &HashMap<Uuid, u64>) -> Result<(), TimelineError> {
    let name_len = track.name.chars().count();
    if name_len == 0 || name_len > TIMELINE_MAX_NAME || track.name.contains('\u{0000}') {
        return Err(TimelineError::BadRequest);
    }
    if !(0.0..=4.0).contains(&track.gain) || !track.gain.is_finite() {
        return Err(TimelineError::BadRequest);
    }
    if usize::from(track.index) != position {
        return Err(TimelineError::BadRequest);
    }
    for clip in &track.clips {
        validate_clip(clip, sources)?;
    }
    Ok(())
}

impl TimelineProject {
    /// The last used microsecond: clips, titles and subtitles.
    pub fn duration_us(&self) -> Result<u64, TimelineError> {
        let mut end = 0u64;
        for track in &self.tracks {
            for clip in &track.clips {
                let clip_end = clip
                    .start_us
                    .checked_add(duration_of(clip)?)
                    .ok_or(TimelineError::TooLarge)?;
                end = end.max(clip_end);
            }
        }
        for title in &self.titles {
            end = end.max(title.end_us);
        }
        for cue in &self.subtitles {
            end = end.max(cue.end_us);
        }
        if end > MEDIA_MAX_DURATION_US {
            return Err(TimelineError::TooLarge);
        }
        Ok(end)
    }

    /// Enforce every published count, identity, time and reference bound.
    pub fn validate(&self) -> Result<(), TimelineError> {
        if self.schema_version != TIMELINE_SCHEMA_VERSION {
            return Err(TimelineError::BadRequest);
        }
        if self.sources.len() > TIMELINE_MAX_SOURCES
            || self.tracks.len() > TIMELINE_MAX_TRACKS
            || self.transitions.len() > TIMELINE_MAX_TRANSITIONS
            || self.titles.len() > TIMELINE_MAX_TITLES
            || self.subtitles.len() > TIMELINE_MAX_SUBTITLES
        {
            return Err(TimelineError::TooLarge);
        }
        if self.width == 0
            || self.height == 0
            || self.width > TIMELINE_MAX_DIMENSION
            || self.height > TIMELINE_MAX_DIMENSION
        {
            return Err(TimelineError::BadRequest);
        }
        if u64::from(self.width) * u64::from(self.height) > TIMELINE_MAX_PIXELS {
            return Err(TimelineError::TooLarge);
        }
        if FrameRate::new(self.frame_rate.num, self.frame_rate.den) != Some(self.frame_rate) {
            return Err(TimelineError::BadRequest);
        }
        if self.audio_rate != TIMELINE_AUDIO_RATE || !matches!(self.audio_channels, 1 | 2) {
            return Err(TimelineError::BadRequest);
        }
        let mut source_ids = HashSet::new();
        let mut source_durations = HashMap::new();
        for source in &self.sources {
            validate_source(source)?;
            if !source_ids.insert(source.id) {
                return Err(TimelineError::BadRequest);
            }
            source_durations.insert(source.id, source.duration_us);
        }
        let mut track_ids = HashSet::new();
        let mut clip_ids = HashSet::new();
        let mut clip_count = 0usize;
        for (position, track) in self.tracks.iter().enumerate() {
            validate_track(track, position, &source_durations)?;
            if !track_ids.insert(track.id) {
                return Err(TimelineError::BadRequest);
            }
            for clip in &track.clips {
                clip_count += 1;
                if !clip_ids.insert(clip.id) {
                    return Err(TimelineError::BadRequest);
                }
            }
        }
        if clip_count > TIMELINE_MAX_CLIPS {
            return Err(TimelineError::TooLarge);
        }
        // Linked audio/video partners share the exact interval and speed.
        let mut links: HashMap<Uuid, Vec<(&Track, &TimelineClip)>> = HashMap::new();
        for track in &self.tracks {
            for clip in &track.clips {
                if let Some(link) = clip.link_id {
                    links.entry(link).or_default().push((track, clip));
                }
            }
        }
        for group in links.values() {
            if group.len() < 2 {
                return Err(TimelineError::BadRequest);
            }
            let first = group[0].1;
            let mut kinds = HashSet::new();
            for (track, clip) in group {
                if !kinds.insert(matches!(track.kind, TrackKind::Video)) {
                    return Err(TimelineError::BadRequest);
                }
                if clip.source_id != first.source_id
                    || clip.start_us != first.start_us
                    || clip.source_in_us != first.source_in_us
                    || clip.source_out_us != first.source_out_us
                    || clip.speed != first.speed
                {
                    return Err(TimelineError::BadRequest);
                }
            }
        }
        let mut transition_ids = HashSet::new();
        let mut transition_pairs = HashSet::new();
        let mut enabled_pairs = HashSet::new();
        let mut transition_totals: HashMap<Uuid, u64> = HashMap::new();
        for transition in &self.transitions {
            let track = self
                .tracks
                .iter()
                .find(|item| item.id == transition.track_id)
                .ok_or(TimelineError::BadRequest)?;
            if !matches!(track.kind, TrackKind::Video)
                || transition.duration_us == 0
                || !transition_ids.insert(transition.id)
                || !clip_ids.contains(&transition.left_clip_id)
                || !clip_ids.contains(&transition.right_clip_id)
                || transition.left_clip_id == transition.right_clip_id
            {
                return Err(TimelineError::BadRequest);
            }
            // A transition may pair only two adjacent clips on its own track.
            let mut ordered: Vec<&TimelineClip> = track.clips.iter().collect();
            ordered.sort_by_key(|clip| clip.start_us);
            let index = ordered
                .iter()
                .position(|clip| clip.id == transition.left_clip_id)
                .ok_or(TimelineError::Overlap)?;
            let left = *ordered.get(index).ok_or(TimelineError::Overlap)?;
            let right = *ordered.get(index + 1).ok_or(TimelineError::Overlap)?;
            if right.id != transition.right_clip_id {
                return Err(TimelineError::Overlap);
            }
            let pair = (left.id, right.id);
            if !transition_pairs.insert(pair) {
                return Err(TimelineError::Overlap);
            }
            let left_duration = duration_of(left)?;
            let right_duration = duration_of(right)?;
            if transition.duration_us > left_duration / 2
                || transition.duration_us > right_duration / 2
                || transition.duration_us > 10_000_000
            {
                return Err(TimelineError::BadRequest);
            }
            if !transition.enabled {
                continue;
            }
            let expected = left
                .start_us
                .checked_add(left_duration)
                .and_then(|end| end.checked_sub(transition.duration_us))
                .ok_or(TimelineError::TooLarge)?;
            if right.start_us != expected {
                return Err(TimelineError::Overlap);
            }
            enabled_pairs.insert(pair);
            for clip in [left, right] {
                let total = transition_totals
                    .get(&clip.id)
                    .copied()
                    .unwrap_or(0)
                    .checked_add(transition.duration_us)
                    .ok_or(TimelineError::TooLarge)?;
                if total > duration_of(clip)? {
                    return Err(TimelineError::Overlap);
                }
                transition_totals.insert(clip.id, total);
            }
        }
        for track in &self.tracks {
            if !matches!(track.kind, TrackKind::Video) {
                continue;
            }
            let mut ordered: Vec<&TimelineClip> = track.clips.iter().collect();
            ordered.sort_by_key(|clip| clip.start_us);
            for index in 1..ordered.len() {
                let left = ordered[index - 1];
                let right = ordered[index];
                let left_end = left
                    .start_us
                    .checked_add(duration_of(left)?)
                    .ok_or(TimelineError::TooLarge)?;
                if right.start_us < left_end && !enabled_pairs.contains(&(left.id, right.id)) {
                    return Err(TimelineError::Overlap);
                }
            }
        }
        let mut title_ids = HashSet::new();
        for title in &self.titles {
            if !title_ids.insert(title.id) {
                return Err(TimelineError::BadRequest);
            }
            let track = self
                .tracks
                .iter()
                .find(|item| item.id == title.track_id)
                .ok_or(TimelineError::BadRequest)?;
            // A title track is a video track that carries no picture clips.
            if !matches!(track.kind, TrackKind::Video)
                || !track.clips.is_empty()
                || title.end_us <= title.start_us
                || title.end_us > MEDIA_MAX_DURATION_US
                || title.text.chars().count() > 10_000
                || title.text.contains('\u{0000}')
                || title.style.font_asset_id.is_empty()
                || title.style.font_asset_id.chars().count() > 128
                || title.style.font_asset_id.contains('\u{0000}')
                || !(1..=512).contains(&title.style.font_size)
                || !title.style.x.is_finite()
                || !title.style.y.is_finite()
                || !(0.0..=1.0).contains(&title.style.x)
                || !(0.0..=1.0).contains(&title.style.y)
                || title.animation_us > title.end_us - title.start_us
            {
                return Err(TimelineError::BadRequest);
            }
        }
        let mut subtitle_ids = HashSet::new();
        let mut subtitle_bytes = 0usize;
        for cue in &self.subtitles {
            if !subtitle_ids.insert(cue.id)
                || cue.end_us <= cue.start_us
                || cue.end_us > MEDIA_MAX_DURATION_US
                || cue.text.chars().count() > 8_192
                || cue.text.contains('\u{0000}')
            {
                return Err(TimelineError::BadRequest);
            }
            subtitle_bytes = subtitle_bytes.saturating_add(cue.text.len());
            if subtitle_bytes > 4 * 1024 * 1024 {
                return Err(TimelineError::TooLarge);
            }
        }
        if let Some(extensions) = &self.extensions {
            validate_extensions(extensions)?;
        }
        self.duration_us()?;
        Ok(())
    }
}

fn validate_extensions(value: &serde_json::Value) -> Result<(), TimelineError> {
    let object = value.as_object().ok_or(TimelineError::BadRequest)?;
    for (key, child) in object {
        let parts: Vec<&str> = key.split('.').collect();
        if parts.len() < 2
            || !key.as_bytes().first().is_some_and(|byte| byte.is_ascii_alphabetic())
            || parts.iter().any(|part| {
                part.is_empty()
                    || !part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            })
        {
            return Err(TimelineError::BadRequest);
        }
        if matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
            return Err(TimelineError::BadRequest);
        }
        validate_json(child, 0)?;
    }
    let encoded = serde_json::to_vec(value).map_err(|_| TimelineError::BadRequest)?;
    if encoded.len() > TIMELINE_MAX_EXTENSIONS_BYTES {
        return Err(TimelineError::TooLarge);
    }
    Ok(())
}

fn validate_json(value: &serde_json::Value, depth: usize) -> Result<(), TimelineError> {
    if depth > 8 {
        return Err(TimelineError::BadRequest);
    }
    match value {
        serde_json::Value::String(text) => {
            if text.chars().count() > 8_192 {
                return Err(TimelineError::TooLarge);
            }
        }
        serde_json::Value::Array(items) => {
            if items.len() > 10_000 {
                return Err(TimelineError::TooLarge);
            }
            for item in items {
                validate_json(item, depth + 1)?;
            }
        }
        serde_json::Value::Object(items) => {
            if items.len() > 64 {
                return Err(TimelineError::TooLarge);
            }
            for (key, child) in items {
                if matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                    return Err(TimelineError::BadRequest);
                }
                validate_json(child, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Read one bounded `.adtimeline` project. The source file is never written.
fn read_project_file(path: &str, expected: Option<&SourceStamp>) -> Result<TimelineProject, String> {
    use std::io::Read;

    let path_value = std::path::Path::new(path);
    if !path_value
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("adtimeline"))
    {
        return Err(TimelineError::Unsupported.message());
    }
    let stamp = fs_service::capture_source_stamp(path_value)
        .map_err(|_| TimelineError::Changed.message())?;
    if let Some(expected) = expected {
        if expected != &stamp {
            return Err(TimelineError::Changed.message());
        }
    }
    let identity = fs_service::owned_io::SourceIdentity::capture(path_value)
        .map_err(|_| TimelineError::Changed.message())?;
    let mut pinned = fs_service::owned_io::PinnedSource::open(path_value, &identity)
        .map_err(|_| TimelineError::Changed.message())?;
    let mut bytes = Vec::new();
    pinned
        .file_mut()
        .take((TIMELINE_MAX_PROJECT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| TimelineError::Failed.message())?;
    if bytes.len() > TIMELINE_MAX_PROJECT_BYTES {
        return Err(TimelineError::TooLarge.message());
    }
    let text = String::from_utf8(bytes).map_err(|_| TimelineError::BadRequest.message())?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| TimelineError::BadRequest.message())?;
    let version = value
        .get("schema_version")
        .and_then(|item| item.as_u64())
        .ok_or_else(|| TimelineError::BadRequest.message())?;
    if version > u64::from(TIMELINE_SCHEMA_VERSION) {
        // A newer project is preserved untouched; it is never downgraded.
        return Err(TimelineError::Unsupported.message());
    }
    let project: TimelineProject =
        serde_json::from_value(value).map_err(|_| TimelineError::BadRequest.message())?;
    project.validate().map_err(TimelineError::message)?;
    Ok(project)
}

/// E5: open one `.adtimeline` project as a bounded job.
#[tauri::command]
pub async fn timeline_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: convert::ConversionInput,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let (path, expected) = match input {
        convert::ConversionInput::File { path, expected } => (path, expected),
        _ => return Err(TimelineError::Unsupported.message()),
    };
    crate::validate_absolute_path(&path).map_err(|_| TimelineError::BadRequest.message())?;
    if !path.to_ascii_lowercase().ends_with(".adtimeline") {
        return Err(TimelineError::Unsupported.message());
    }
    let token = jobs.begin(&request_id, 1)?;
    let app = window.app_handle().clone();
    let job_id = request_id.clone();
    spawn_job(app, job_id, token, move |_context| {
        let project = read_project_file(&path, expected.as_ref())?;
        serde_json::to_value(project).map_err(|_| TimelineError::Failed.message())
    });
    Ok(())
}
