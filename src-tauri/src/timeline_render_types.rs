//! Native 19b timeline render-graph contract and validator.
//!
//! This is the Rust mirror of the frozen `RenderNode` union in
//! `src/timeline/effectTypes.ts`. It carries picture placement, track
//! composition, fit/pad, transitions, titles, audio gain/mix, subtitles and
//! the final encoder as typed nodes only. There is no string that becomes a
//! filter expression, shell command or process path.
//!
//! No engine execution, command registration or output publication lives
//! here. `ValidatedRenderGraph::new` is the only construction path: fields are
//! private and deserialization goes through the same constructor, so a struct
//! that merely happens to be named `ValidatedRenderGraph` is not accepted as
//! proof of validation. `TimelineEngineRenderRequest` is native-only because
//! every source is an already authorized `EngineInput`, never a UI path.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::engine_types::{EngineCapability, EngineInput, MEDIA_MAX_DURATION_US, MEDIA_MAX_STREAMS};
use crate::media_edit_types::{MediaCrop, MediaSubtitleCue};
use crate::timeline_types::{PlaybackRate, TimelineEffect, TimelineTitle, TimelineTransition};

/// Graph bounds from 19b D8.
pub const TIMELINE_GRAPH_MAX_NODES: usize = 100_000;
pub const TIMELINE_GRAPH_MAX_EDGES: usize = 200_000;
pub const TIMELINE_GRAPH_MAX_WIRE_BYTES: usize = 1024 * 1024;
pub const TIMELINE_GRAPH_MAX_AUDIO_MIX_INPUTS: usize = 128;
pub const TIMELINE_GRAPH_MAX_CONCAT_INPUTS: usize = 10_000;
pub const TIMELINE_GRAPH_MAX_COMPOSE_LAYERS: usize = 30_000;
pub const TIMELINE_GRAPH_MAX_STREAM_INDEX: u32 = 63;
pub const TIMELINE_GRAPH_MAX_DIMENSION: u32 = 8_192;
pub const TIMELINE_GRAPH_MAX_PIXELS: u64 = 100_000_000;
pub const TIMELINE_GRAPH_MAX_EFFECTS: usize = 64;
pub const TIMELINE_GRAPH_MAX_TITLE_TEXT: usize = 10_000;
pub const TIMELINE_GRAPH_MAX_CUE_TEXT: usize = 8_192;
pub const TIMELINE_GRAPH_MAX_SUBTITLE_BYTES: usize = 4 * 1024 * 1024;
pub const TIMELINE_GRAPH_MAX_TRANSITION_US: u64 = 10_000_000;
pub const TIMELINE_ENGINE_MAX_SOURCES: usize = 10_000;
pub const TIMELINE_ENGINE_MAX_INPUT_BYTES: u128 = 32 * 1024 * 1024 * 1024;
pub const TIMELINE_GRAPH_MAX_TRACK_INDEX: u16 = 127;

/// Stable `timeline_export.*` failures. The UI translates
/// `errors.timeline_export.*`; an unacknowledged graph warning keeps the
/// shared 08a `convert.warning_required` code so it blocks before any output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelineRenderError {
    BadRequest,
    Unsupported,
    Changed,
    TooLarge,
    MissingGlyph,
    Failed,
    WarningRequired,
}

impl TimelineRenderError {
    pub fn code(self) -> &'static str {
        match self {
            Self::BadRequest => "timeline_export.bad_request",
            Self::Unsupported => "timeline_export.unsupported",
            Self::Changed => "timeline_export.changed",
            Self::TooLarge => "timeline_export.too_large",
            Self::MissingGlyph => "timeline_export.missing_glyph",
            Self::Failed => "timeline_export.failed",
            Self::WarningRequired => "convert.warning_required",
        }
    }

    pub fn message(self) -> String {
        self.code().to_string()
    }
}

impl std::fmt::Display for TimelineRenderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for TimelineRenderError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineFitMode {
    FitPad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelinePlacement {
    AbsoluteStartUs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineStacking {
    TrackIndex,
}

/// Explicit composition facts; they are never inferred from a hidden project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineComposition {
    pub placement: TimelinePlacement,
    pub stacking: TimelineStacking,
    pub fit: TimelineFitMode,
    pub background: [u8; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderContainer {
    Webm,
    Mkv,
    Mp4,
    Flac,
    Wav,
    Mp3,
}

impl RenderContainer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Webm => "webm",
            Self::Mkv => "mkv",
            Self::Mp4 => "mp4",
            Self::Flac => "flac",
            Self::Wav => "wav",
            Self::Mp3 => "mp3",
        }
    }

    pub fn is_audio_only(self) -> bool {
        matches!(self, Self::Flac | Self::Wav | Self::Mp3)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderVideoCodec {
    Auto,
    #[serde(rename = "vp9")]
    Vp9,
    Av1,
    #[serde(rename = "h264_os")]
    H264Os,
    #[serde(rename = "hevc_os")]
    HevcOs,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderAudioCodec {
    Auto,
    Opus,
    Vorbis,
    Flac,
    Pcm,
    Mp3,
    #[serde(rename = "aac_os")]
    AacOs,
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderLayer {
    pub input: Uuid,
    pub track_index: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderPort {
    Video,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderEdge {
    pub from: Uuid,
    pub to: Uuid,
    pub port: RenderPort,
}

/// The frozen typed node union. Every field is data; none is a filter string.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RenderNode {
    Source {
        id: Uuid,
        source_id: Uuid,
        /// Native probe stream index. 19a sources carry no stream list; the
        /// TypeScript builder uses 0=picture and 1=audio when both exist, 0 for
        /// an audio-only source. The engine must verify this against the probe.
        stream_index: u32,
    },
    Blank {
        id: Uuid,
        width: u32,
        height: u32,
        rgba: [u8; 4],
    },
    Trim {
        id: Uuid,
        input: Uuid,
        start_us: u64,
        end_us: u64,
    },
    Speed {
        id: Uuid,
        input: Uuid,
        rate: PlaybackRate,
    },
    Geometry {
        id: Uuid,
        input: Uuid,
        crop: Option<MediaCrop>,
        rotation: u16,
        output_width: u32,
        output_height: u32,
    },
    Color {
        id: Uuid,
        input: Uuid,
        effects: Vec<TimelineEffect>,
    },
    Transition {
        id: Uuid,
        left: Uuid,
        right: Uuid,
        transition: TimelineTransition,
    },
    Title {
        id: Uuid,
        input: Uuid,
        title: TimelineTitle,
    },
    Place {
        id: Uuid,
        input: Uuid,
        start_us: u64,
    },
    AudioGain {
        id: Uuid,
        input: Uuid,
        gain: f64,
        fade_in_us: u64,
        fade_out_us: u64,
    },
    AudioMix {
        id: Uuid,
        inputs: Vec<Uuid>,
    },
    Subtitle {
        id: Uuid,
        input: Uuid,
        cues: Vec<MediaSubtitleCue>,
    },
    Concat {
        id: Uuid,
        inputs: Vec<Uuid>,
    },
    Compose {
        id: Uuid,
        layers: Vec<RenderLayer>,
        width: u32,
        height: u32,
        fit: TimelineFitMode,
        background: [u8; 4],
    },
    Encode {
        id: Uuid,
        video_input: Option<Uuid>,
        audio_input: Option<Uuid>,
        container: RenderContainer,
        video_codec: RenderVideoCodec,
        audio_codec: RenderAudioCodec,
    },
}

// The frozen encode node deliberately carries no output frame rate or bitrate.
// The request must keep the project frame rate and omit an explicit bitrate;
// the TypeScript builder refuses either loss instead of dropping it.

impl RenderNode {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Source { id, .. }
            | Self::Blank { id, .. }
            | Self::Trim { id, .. }
            | Self::Speed { id, .. }
            | Self::Geometry { id, .. }
            | Self::Color { id, .. }
            | Self::Transition { id, .. }
            | Self::Title { id, .. }
            | Self::Place { id, .. }
            | Self::AudioGain { id, .. }
            | Self::AudioMix { id, .. }
            | Self::Subtitle { id, .. }
            | Self::Concat { id, .. }
            | Self::Compose { id, .. }
            | Self::Encode { id, .. } => *id,
        }
    }
}

/// A structurally validated graph. Fields are private; `new` is the only
/// constructor, including through the validating `Deserialize` path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "ValidatedRenderGraphWire")]
pub struct ValidatedRenderGraph {
    nodes: Vec<RenderNode>,
    edges: Vec<RenderEdge>,
    duration_us: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidatedRenderGraphWire {
    nodes: Vec<RenderNode>,
    edges: Vec<RenderEdge>,
    duration_us: u64,
}

#[derive(Serialize)]
struct WireGraph<'a> {
    nodes: &'a [RenderNode],
    edges: &'a [RenderEdge],
    duration_us: u64,
}

impl TryFrom<ValidatedRenderGraphWire> for ValidatedRenderGraph {
    type Error = TimelineRenderError;

    fn try_from(value: ValidatedRenderGraphWire) -> Result<Self, Self::Error> {
        Self::new(value.nodes, value.edges, value.duration_us)
    }
}

impl ValidatedRenderGraph {
    /// Validate and build a graph. The 1 MiB wire check runs on the exact
    /// serialized node/edge shape; no arbitrary JSON option map is accepted.
    pub fn new(
        nodes: Vec<RenderNode>,
        edges: Vec<RenderEdge>,
        duration_us: u64,
    ) -> Result<Self, TimelineRenderError> {
        if duration_us == 0 || duration_us > MEDIA_MAX_DURATION_US {
            return Err(TimelineRenderError::BadRequest);
        }
        if nodes.is_empty() || nodes.len() > TIMELINE_GRAPH_MAX_NODES {
            return Err(if nodes.is_empty() {
                TimelineRenderError::BadRequest
            } else {
                TimelineRenderError::TooLarge
            });
        }
        if edges.len() > TIMELINE_GRAPH_MAX_EDGES {
            return Err(TimelineRenderError::TooLarge);
        }
        let graph = Self {
            nodes,
            edges,
            duration_us,
        };
        graph.validate_structure()?;
        let wire = WireGraph {
            nodes: &graph.nodes,
            edges: &graph.edges,
            duration_us: graph.duration_us,
        };
        let bytes = serde_json::to_vec(&wire).map_err(|_| TimelineRenderError::Failed)?;
        if bytes.len() > TIMELINE_GRAPH_MAX_WIRE_BYTES {
            return Err(TimelineRenderError::TooLarge);
        }
        Ok(graph)
    }

    pub fn nodes(&self) -> &[RenderNode] {
        &self.nodes
    }

    pub fn edges(&self) -> &[RenderEdge] {
        &self.edges
    }

    pub fn duration_us(&self) -> u64 {
        self.duration_us
    }

    /// Native encoder capability is rechecked before launch. The graph builder
    /// also requires `media.encode`, but neither check proves a codec/filter.
    pub fn validate_encoder(
        &self,
        capabilities: &[EngineCapability],
    ) -> Result<(), TimelineRenderError> {
        let available = capabilities.iter().any(|capability| {
            capability.id == "media.encode"
                && capability.available
                && !capability.version.is_empty()
                && capability.version.len() <= 64
        });
        if available {
            Ok(())
        } else {
            Err(TimelineRenderError::Unsupported)
        }
    }

    /// Resolve every graph source to exactly one authorized input. Stream-kind
    /// identity is checked against the native probe by the engine, not by a
    /// path or a UI value here.
    pub fn validate_with_sources(
        &self,
        sources: &[TimelineEngineSource],
    ) -> Result<(), TimelineRenderError> {
        if sources.is_empty() || sources.len() > TIMELINE_ENGINE_MAX_SOURCES {
            return Err(TimelineRenderError::BadRequest);
        }
        let mut source_ids = HashSet::new();
        let mut input_indices = HashSet::new();
        let mut total: u128 = 0;
        for source in sources {
            if !source_ids.insert(source.source_id) || !input_indices.insert(source.input.input_index)
            {
                return Err(TimelineRenderError::BadRequest);
            }
            if source.input.sensitive {
                return Err(TimelineRenderError::Unsupported);
            }
            let stamp = source
                .input
                .stamp
                .as_ref()
                .ok_or(TimelineRenderError::BadRequest)?;
            stamp
                .validate()
                .map_err(|_| TimelineRenderError::BadRequest)?;
            total = total.saturating_add(u128::from(stamp.size_bytes));
        }
        if total > TIMELINE_ENGINE_MAX_INPUT_BYTES {
            return Err(TimelineRenderError::TooLarge);
        }

        let mut graph_sources = HashSet::new();
        let mut pairs = HashSet::new();
        for node in &self.nodes {
            if let RenderNode::Source {
                source_id,
                stream_index,
                ..
            } = node
            {
                if !pairs.insert((*source_id, *stream_index)) {
                    return Err(TimelineRenderError::BadRequest);
                }
                if !source_ids.contains(source_id) {
                    return Err(TimelineRenderError::Changed);
                }
                graph_sources.insert(*source_id);
            }
        }
        if graph_sources.len() != source_ids.len() {
            return Err(TimelineRenderError::BadRequest);
        }
        Ok(())
    }

    fn validate_structure(&self) -> Result<(), TimelineRenderError> {
        let mut index_of = HashMap::new();
        for (index, node) in self.nodes.iter().enumerate() {
            if index_of.insert(node.id(), index).is_some() {
                return Err(TimelineRenderError::BadRequest);
            }
        }

        let mut outgoing: HashMap<Uuid, HashSet<RenderPort>> = HashMap::new();
        let mut edge_set = HashSet::new();
        for edge in &self.edges {
            let from = *index_of
                .get(&edge.from)
                .ok_or(TimelineRenderError::BadRequest)?;
            let to = *index_of
                .get(&edge.to)
                .ok_or(TimelineRenderError::BadRequest)?;
            if from >= to {
                return Err(TimelineRenderError::BadRequest);
            }
            if !edge_set.insert((edge.from, edge.to, edge.port)) {
                return Err(TimelineRenderError::BadRequest);
            }
            outgoing.entry(edge.from).or_default().insert(edge.port);
        }

        let mut output_ports: HashMap<Uuid, RenderPort> = HashMap::new();
        let mut source_pairs = HashSet::new();
        for node in &self.nodes {
            if let RenderNode::Source {
                id,
                source_id,
                stream_index,
                ..
            } = node
            {
                if !source_pairs.insert((*source_id, *stream_index)) {
                    return Err(TimelineRenderError::BadRequest);
                }
                let ports = outgoing
                    .get(id)
                    .ok_or(TimelineRenderError::BadRequest)?;
                if ports.len() != 1 {
                    return Err(TimelineRenderError::BadRequest);
                }
                output_ports.insert(
                    *id,
                    *ports.iter().next().ok_or(TimelineRenderError::BadRequest)?,
                );
            }
        }

        let mut expected = HashSet::new();
        let mut encode_count = 0usize;
        for (index, node) in self.nodes.iter().enumerate() {
            validate_node_fields(node)?;
            let mut inputs: Vec<(Uuid, RenderPort)> = Vec::new();
            let output = match node {
                RenderNode::Source { id, .. } => {
                    Some(*output_ports.get(id).ok_or(TimelineRenderError::BadRequest)?)
                }
                RenderNode::Blank { .. } => Some(RenderPort::Video),
                RenderNode::Trim { input, .. }
                | RenderNode::Speed { input, .. }
                | RenderNode::Place { input, .. } => {
                    let port = *output_ports
                        .get(input)
                        .ok_or(TimelineRenderError::BadRequest)?;
                    inputs.push((*input, port));
                    Some(port)
                }
                RenderNode::Geometry { input, .. }
                | RenderNode::Color { input, .. }
                | RenderNode::Title { input, .. }
                | RenderNode::Subtitle { input, .. } => {
                    inputs.push((*input, RenderPort::Video));
                    Some(RenderPort::Video)
                }
                RenderNode::Transition { left, right, .. } => {
                    inputs.push((*left, RenderPort::Video));
                    inputs.push((*right, RenderPort::Video));
                    Some(RenderPort::Video)
                }
                RenderNode::AudioGain { input, .. } => {
                    inputs.push((*input, RenderPort::Audio));
                    Some(RenderPort::Audio)
                }
                RenderNode::AudioMix { inputs: values, .. } => {
                    for input in values {
                        inputs.push((*input, RenderPort::Audio));
                    }
                    Some(RenderPort::Audio)
                }
                RenderNode::Concat { inputs: values, .. } => {
                    let first = *values
                        .first()
                        .ok_or(TimelineRenderError::BadRequest)?;
                    let port = *output_ports
                        .get(&first)
                        .ok_or(TimelineRenderError::BadRequest)?;
                    for input in values {
                        inputs.push((*input, port));
                    }
                    Some(port)
                }
                RenderNode::Compose { layers, .. } => {
                    for layer in layers {
                        inputs.push((layer.input, RenderPort::Video));
                    }
                    Some(RenderPort::Video)
                }
                RenderNode::Encode {
                    video_input,
                    audio_input,
                    ..
                } => {
                    if let Some(input) = video_input {
                        inputs.push((*input, RenderPort::Video));
                    }
                    if let Some(input) = audio_input {
                        inputs.push((*input, RenderPort::Audio));
                    }
                    if inputs.is_empty() {
                        return Err(TimelineRenderError::BadRequest);
                    }
                    encode_count += 1;
                    if encode_count > 1 || index + 1 != self.nodes.len() {
                        return Err(TimelineRenderError::BadRequest);
                    }
                    None
                }
            };

            let mut unique_inputs = HashSet::new();
            for (from, port) in &inputs {
                let from_index = *index_of
                    .get(from)
                    .ok_or(TimelineRenderError::BadRequest)?;
                if from_index >= index {
                    return Err(TimelineRenderError::BadRequest);
                }
                if output_ports.get(from).copied() != Some(*port) {
                    return Err(TimelineRenderError::BadRequest);
                }
                if !unique_inputs.insert((*from, *port)) {
                    return Err(TimelineRenderError::BadRequest);
                }
                if !expected.insert((*from, node.id(), *port)) {
                    return Err(TimelineRenderError::BadRequest);
                }
            }
            if let Some(port) = output {
                output_ports.insert(node.id(), port);
            }
        }
        if encode_count != 1 || expected != edge_set {
            return Err(TimelineRenderError::BadRequest);
        }
        Ok(())
    }
}

fn valid_frame_size(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= TIMELINE_GRAPH_MAX_DIMENSION
        && height <= TIMELINE_GRAPH_MAX_DIMENSION
        && u64::from(width) * u64::from(height) <= TIMELINE_GRAPH_MAX_PIXELS
}

fn valid_playback_rate(rate: &PlaybackRate) -> bool {
    let (mut left, mut right) = (rate.num, rate.den);
    if left == 0 || right == 0 {
        return false;
    }
    while right != 0 {
        let next = left % right;
        left = right;
        right = next;
    }
    if left != 1 {
        return false;
    }
    u64::from(rate.num) <= 4 * u64::from(rate.den)
        && u64::from(rate.den) <= 4 * u64::from(rate.num)
}

fn valid_crop(crop: &MediaCrop) -> bool {
    crop.width > 0 && crop.height > 0
}

fn valid_effect(effect: &TimelineEffect) -> Result<(), TimelineRenderError> {
    match effect {
        TimelineEffect::Brightness { value }
        | TimelineEffect::Contrast { value }
        | TimelineEffect::Saturation { value } => {
            if !value.is_finite() || !(-1.0..=1.0).contains(value) {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        TimelineEffect::Color { gamma } => {
            if gamma
                .iter()
                .any(|channel| !channel.is_finite() || !(0.1..=10.0).contains(channel))
            {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        TimelineEffect::Crop { rect } => {
            if !valid_crop(rect) {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        // No audited deterministic non-AI stabilizer is registered.
        TimelineEffect::Stabilize { .. } => return Err(TimelineRenderError::Unsupported),
    }
    Ok(())
}

fn valid_title(title: &TimelineTitle) -> Result<(), TimelineRenderError> {
    if title.start_us >= title.end_us || title.end_us > MEDIA_MAX_DURATION_US {
        return Err(TimelineRenderError::BadRequest);
    }
    if title.text.chars().count() > TIMELINE_GRAPH_MAX_TITLE_TEXT {
        return Err(TimelineRenderError::BadRequest);
    }
    if title.animation_us > title.end_us - title.start_us {
        return Err(TimelineRenderError::BadRequest);
    }
    let style = &title.style;
    if style.font_asset_id.is_empty()
        || style.font_asset_id.chars().count() > 128
        || !(1..=512).contains(&style.font_size)
        || !style.x.is_finite()
        || !style.y.is_finite()
        || !(0.0..=1.0).contains(&style.x)
        || !(0.0..=1.0).contains(&style.y)
    {
        return Err(TimelineRenderError::BadRequest);
    }
    Ok(())
}

fn valid_transition(transition: &TimelineTransition) -> Result<(), TimelineRenderError> {
    if !transition.enabled
        || transition.duration_us == 0
        || transition.duration_us > TIMELINE_GRAPH_MAX_TRANSITION_US
        || transition.left_clip_id == transition.right_clip_id
    {
        return Err(TimelineRenderError::BadRequest);
    }
    Ok(())
}

fn valid_cues(cues: &[MediaSubtitleCue]) -> Result<(), TimelineRenderError> {
    if cues.len() > 100_000 {
        return Err(TimelineRenderError::TooLarge);
    }
    let mut ids = HashSet::new();
    let mut bytes = 0usize;
    for cue in cues {
        if !ids.insert(cue.id)
            || cue.start_us >= cue.end_us
            || cue.end_us > MEDIA_MAX_DURATION_US
            || cue.text.chars().count() > TIMELINE_GRAPH_MAX_CUE_TEXT
        {
            return Err(TimelineRenderError::BadRequest);
        }
        bytes = bytes.saturating_add(cue.text.len());
        if bytes > TIMELINE_GRAPH_MAX_SUBTITLE_BYTES {
            return Err(TimelineRenderError::TooLarge);
        }
    }
    Ok(())
}

fn validate_node_fields(node: &RenderNode) -> Result<(), TimelineRenderError> {
    match node {
        RenderNode::Source { stream_index, .. } => {
            if *stream_index as usize >= MEDIA_MAX_STREAMS
                || *stream_index > TIMELINE_GRAPH_MAX_STREAM_INDEX
            {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Blank {
            width, height, ..
        } => {
            if !valid_frame_size(*width, *height) {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Trim {
            start_us, end_us, ..
        } => {
            if start_us >= end_us || *end_us > MEDIA_MAX_DURATION_US {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Speed { rate, .. } => {
            if !valid_playback_rate(rate) {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Geometry {
            crop,
            rotation,
            output_width,
            output_height,
            ..
        } => {
            if !matches!(*rotation, 0 | 90 | 180 | 270)
                || !valid_frame_size(*output_width, *output_height)
                || crop.as_ref().is_some_and(|crop| !valid_crop(crop))
            {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Color { effects, .. } => {
            if effects.len() > TIMELINE_GRAPH_MAX_EFFECTS {
                return Err(TimelineRenderError::TooLarge);
            }
            for effect in effects {
                valid_effect(effect)?;
            }
        }
        RenderNode::Transition {
            left,
            right,
            transition,
            ..
        } => {
            if left == right {
                return Err(TimelineRenderError::BadRequest);
            }
            valid_transition(transition)?;
        }
        RenderNode::Title { title, .. } => valid_title(title)?,
        RenderNode::Place { start_us, .. } => {
            if *start_us > MEDIA_MAX_DURATION_US {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::AudioGain {
            gain,
            fade_in_us,
            fade_out_us,
            ..
        } => {
            if !gain.is_finite()
                || !(0.0..=16.0).contains(gain)
                || *fade_in_us > MEDIA_MAX_DURATION_US
                || *fade_out_us > MEDIA_MAX_DURATION_US
            {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::AudioMix { inputs, .. } => {
            if inputs.is_empty() || inputs.len() > TIMELINE_GRAPH_MAX_AUDIO_MIX_INPUTS {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Subtitle { cues, .. } => valid_cues(cues)?,
        RenderNode::Concat { inputs, .. } => {
            if inputs.is_empty() || inputs.len() > TIMELINE_GRAPH_MAX_CONCAT_INPUTS {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        RenderNode::Compose {
            layers,
            width,
            height,
            background,
            ..
        } => {
            if layers.is_empty() || layers.len() > TIMELINE_GRAPH_MAX_COMPOSE_LAYERS {
                return Err(TimelineRenderError::BadRequest);
            }
            if !valid_frame_size(*width, *height) {
                return Err(TimelineRenderError::BadRequest);
            }
            let mut previous = 0u16;
            let mut inputs = HashSet::new();
            for layer in layers {
                if layer.track_index > TIMELINE_GRAPH_MAX_TRACK_INDEX
                    || layer.track_index < previous
                    || !inputs.insert(layer.input)
                {
                    return Err(TimelineRenderError::BadRequest);
                }
                previous = layer.track_index;
            }
            let _ = background;
        }
        RenderNode::Encode {
            video_input,
            audio_input,
            container,
            ..
        } => {
            if video_input.is_none() && audio_input.is_none() {
                return Err(TimelineRenderError::BadRequest);
            }
            if (*container).is_audio_only() {
                if video_input.is_some() || audio_input.is_none() {
                    return Err(TimelineRenderError::BadRequest);
                }
            } else if video_input.is_none() {
                return Err(TimelineRenderError::BadRequest);
            }
        }
    }
    Ok(())
}

/// One native-only source binding. `source_id` is the 19a project identity;
/// `input` is the already authorized pinned disk input, never a UI path.
pub struct TimelineEngineSource {
    pub source_id: Uuid,
    pub input: EngineInput,
}

/// Native-only engine request. It carries no destination, snapshot lease or
/// command line; 19b `timeline_export.rs` owns publication.
pub struct TimelineEngineRenderRequest {
    pub sources: Vec<TimelineEngineSource>,
    pub graph: ValidatedRenderGraph,
}

impl TimelineEngineRenderRequest {
    pub fn validate(&self) -> Result<(), TimelineRenderError> {
        self.graph.validate_with_sources(&self.sources)
    }
}
