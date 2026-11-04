//! Native timeline export command surface (Step 19b T5/E4).
//!
//! The two commands accept the TypeScript `TimelineExportRequest` and the
//! graph produced by `src/timeline/graph.ts`. Both are revalidated here from
//! their exact wire shape: the request against the published field bounds and
//! the graph through [`ValidatedRenderGraph::new`], the only constructor. The
//! graph's encoder must agree with the request, its compose frame with the
//! requested frame, and a subtitle burn is the only subtitle node allowed.
//!
//! A verified `media.encode` pack is required next. This build has no
//! concrete graph executor: 12b has no `EngineAction::RenderTimeline` branch,
//! no typed filter translation and no independent output publication sink for
//! a rendered artifact. The commands therefore refuse with
//! `timeline_export.unsupported` *before* `Jobs::begin`, before a snapshot or
//! source lease, before staging and before any output exists. The command
//! surface is real and registered so the engine step only has to replace this
//! one final gate with the shared job and the concrete render call.

use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::engine_process::EngineHost;
use crate::engine_types::{valid_relative_basename, EngineCapabilityId, FrameRate};
use crate::export_snapshot_types::{now_unix, ExportSnapshot, StoragePolicy};
use crate::timeline_render_types::{
    RenderAudioCodec, RenderContainer, RenderEdge, RenderNode, RenderVideoCodec,
    TimelineComposition, TimelineRenderError, ValidatedRenderGraph,
    TIMELINE_GRAPH_MAX_DIMENSION, TIMELINE_GRAPH_MAX_PIXELS, TIMELINE_GRAPH_MAX_WIRE_BYTES,
};
use crate::timeline_types::TIMELINE_MAX_PROJECT_BYTES;

/// The only snapshot MIME a timeline export accepts.
pub const TIMELINE_SNAPSHOT_MIME: &str = "application/vnd.adperastra.timeline+json";

/// Every warning code 19b can acknowledge: the 08a/12b codes in their wire
/// spelling plus the 19b `audio_clipping` code. The native command never
/// accepts a code outside this list.
pub const TIMELINE_WARNING_CODES: [&str; 10] = [
    "transparency_loss",
    "animation_first_frame",
    "palette_reduction",
    "layout_loss",
    "formula_cached_value",
    "formula_safety_prefix",
    "sheet_selection",
    "audio_loss",
    "frame_rate_change",
    "audio_clipping",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimelineSubtitleMode {
    Off,
    Burn,
    Sidecar,
}

/// The native mirror of the TypeScript `TimelineExportRequest`. The graph is
/// a separate command argument because `buildRenderGraph` produces it from the
/// plan and this request; it is not a field of the request itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineExportRequest {
    pub project_snapshot: ExportSnapshot,
    pub dest_dir: String,
    pub file_name: String,
    pub container: RenderContainer,
    pub video_codec: RenderVideoCodec,
    pub audio_codec: RenderAudioCodec,
    pub width: u32,
    pub height: u32,
    pub frame_rate: FrameRate,
    pub bitrate_kbps: Option<u32>,
    pub metadata_keep: bool,
    pub subtitle_mode: TimelineSubtitleMode,
    pub accepted_losses: Vec<convert::MetadataCategory>,
    pub accepted_warning_codes: Vec<String>,
    pub composition: TimelineComposition,
}

impl TimelineExportRequest {
    /// Check every field exactly as the TypeScript preflight and graph builder
    /// do. This runs before the capability check and before any side effect.
    pub fn validate(&self) -> Result<(), TimelineRenderError> {
        let snapshot = &self.project_snapshot;
        if snapshot.storage_policy != StoragePolicy::Ordinary {
            return Err(TimelineRenderError::Unsupported);
        }
        if Uuid::parse_str(&snapshot.snapshot_id).is_err()
            || snapshot.document_id.is_empty()
            || snapshot.document_id.encode_utf16().count() > 128
            || snapshot.document_id.contains('\0')
            || snapshot.revision >= (1u64 << 53)
            || snapshot.byte_len == 0
            || snapshot.byte_len > TIMELINE_MAX_PROJECT_BYTES as u64
            || snapshot.expires_unix >= (1u64 << 53)
            || snapshot.mime != TIMELINE_SNAPSHOT_MIME
        {
            return Err(TimelineRenderError::BadRequest);
        }
        // A stale capture is the same "changed" the snapshot store reports.
        if snapshot.expires_unix <= now_unix() {
            return Err(TimelineRenderError::Changed);
        }
        if let Some(stamp) = &snapshot.source {
            stamp
                .validate()
                .map_err(|_| TimelineRenderError::BadRequest)?;
        }
        crate::validate_absolute_path(&self.dest_dir)
            .map_err(|_| TimelineRenderError::BadRequest)?;
        if !valid_relative_basename(&self.file_name)
            || !self
                .file_name
                .to_ascii_lowercase()
                .ends_with(&format!(".{}", self.container.as_str()))
        {
            return Err(TimelineRenderError::BadRequest);
        }
        if self.width == 0
            || self.height == 0
            || self.width > TIMELINE_GRAPH_MAX_DIMENSION
            || self.height > TIMELINE_GRAPH_MAX_DIMENSION
        {
            return Err(TimelineRenderError::BadRequest);
        }
        if u64::from(self.width) * u64::from(self.height) > TIMELINE_GRAPH_MAX_PIXELS {
            return Err(TimelineRenderError::TooLarge);
        }
        if FrameRate::new(self.frame_rate.num, self.frame_rate.den) != Some(self.frame_rate) {
            return Err(TimelineRenderError::BadRequest);
        }
        if !self.metadata_keep {
            return Err(TimelineRenderError::BadRequest);
        }
        if let Some(bitrate_kbps) = self.bitrate_kbps {
            // The frozen encode node has no bitrate field, so an explicit
            // rate cannot be honoured; refusing beats silently encoding at
            // another one.
            return if (8..=1_000_000).contains(&bitrate_kbps) {
                Err(TimelineRenderError::Unsupported)
            } else {
                Err(TimelineRenderError::BadRequest)
            };
        }
        if self.container.is_audio_only() && self.subtitle_mode == TimelineSubtitleMode::Burn {
            return Err(TimelineRenderError::BadRequest);
        }
        if self.accepted_losses.len() > 64 {
            return Err(TimelineRenderError::BadRequest);
        }
        let mut losses = HashSet::new();
        if self
            .accepted_losses
            .iter()
            .any(|item| !losses.insert(*item))
        {
            return Err(TimelineRenderError::BadRequest);
        }
        if self.accepted_warning_codes.len() > 64 {
            return Err(TimelineRenderError::BadRequest);
        }
        let mut warnings = HashSet::new();
        for code in &self.accepted_warning_codes {
            if !TIMELINE_WARNING_CODES.contains(&code.as_str()) {
                return Err(TimelineRenderError::WarningRequired);
            }
            if !warnings.insert(code.as_str()) {
                return Err(TimelineRenderError::BadRequest);
            }
        }
        let wire = serde_json::to_vec(self).map_err(|_| TimelineRenderError::Failed)?;
        if wire.len() > TIMELINE_GRAPH_MAX_WIRE_BYTES {
            return Err(TimelineRenderError::TooLarge);
        }
        Ok(())
    }

    /// Recheck the facts the graph builder derives from this request. A graph
    /// that merely validates structurally but encodes another container,
    /// codec, frame or subtitle mode is refused natively.
    pub fn validate_graph(
        &self,
        graph: &ValidatedRenderGraph,
    ) -> Result<(), TimelineRenderError> {
        let mut encodes = 0usize;
        for node in graph.nodes() {
            match node {
                RenderNode::Encode {
                    container,
                    video_codec,
                    audio_codec,
                    ..
                } => {
                    encodes += 1;
                    if *container != self.container
                        || *video_codec != self.video_codec
                        || *audio_codec != self.audio_codec
                    {
                        return Err(TimelineRenderError::BadRequest);
                    }
                }
                RenderNode::Compose {
                    width,
                    height,
                    fit,
                    background,
                    ..
                } => {
                    if self.container.is_audio_only()
                        || *width != self.width
                        || *height != self.height
                        || *fit != self.composition.fit
                        || *background != self.composition.background
                    {
                        return Err(TimelineRenderError::BadRequest);
                    }
                }
                RenderNode::Subtitle { .. }
                    if self.subtitle_mode != TimelineSubtitleMode::Burn =>
                {
                    return Err(TimelineRenderError::BadRequest);
                }
                _ => {}
            }
        }
        if encodes != 1 {
            return Err(TimelineRenderError::BadRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderGraphWire {
    nodes: Vec<RenderNode>,
    edges: Vec<RenderEdge>,
    duration_us: u64,
}

fn parse_export_request(
    value: serde_json::Value,
) -> Result<TimelineExportRequest, TimelineRenderError> {
    serde_json::from_value(value).map_err(|_| TimelineRenderError::BadRequest)
}

fn parse_render_graph(
    value: serde_json::Value,
) -> Result<ValidatedRenderGraph, TimelineRenderError> {
    let wire: RenderGraphWire =
        serde_json::from_value(value).map_err(|_| TimelineRenderError::BadRequest)?;
    ValidatedRenderGraph::new(wire.nodes, wire.edges, wire.duration_us)
}

/// Shared preflight for both commands. It deliberately ends with
/// `unsupported`: this build has no concrete graph executor or independent
/// publication path, and refusing here keeps a failed export from creating a
/// job, leases, staging folders or output files.
fn preflight(
    host: &EngineHost,
    request: serde_json::Value,
    graph: serde_json::Value,
) -> Result<(), TimelineRenderError> {
    let request = parse_export_request(request)?;
    request.validate()?;
    let graph = parse_render_graph(graph)?;
    request.validate_graph(&graph)?;
    // The same verified-pack gate the media converters use. It proves the
    // audited pack can be acquired now; it does not prove a codec or filter.
    if !host.capability_verified(EngineCapabilityId::MediaEncode) {
        return Err(TimelineRenderError::Unsupported);
    }
    // Remaining engine work, owned by the render integration: translate the
    // validated nodes into the fixed EngineAction::RenderTimeline branch,
    // lease and bind every graph source to its authorized EngineInput, start
    // the shared job, probe duration/frame count and publish one owned
    // artifact through the 08a sink. Until that exists, no job may start.
    Err(TimelineRenderError::Unsupported)
}

/// E4: start one timeline preview. No preview lease, frame or sample exists in
/// this build, so an accepted request still ends as `timeline_export.unsupported`.
#[tauri::command]
pub fn timeline_export_preview_start(
    window: WebviewWindow,
    host: State<'_, Arc<EngineHost>>,
    request_id: String,
    request: serde_json::Value,
    graph: serde_json::Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    preflight(host.inner(), request, graph).map_err(TimelineRenderError::message)
}

/// E4: start one timeline export. The request and graph are validated and the
/// verified `media.encode` pack is required before the unsupported refusal, so
/// a malformed or enormous graph never reaches a staging folder.
#[tauri::command]
pub fn timeline_export_start(
    window: WebviewWindow,
    host: State<'_, Arc<EngineHost>>,
    request_id: String,
    request: serde_json::Value,
    graph: serde_json::Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    preflight(host.inner(), request, graph).map_err(TimelineRenderError::message)
}

#[cfg(test)]
#[path = "timeline_export_step19b_tests.rs"]
mod step19b_tests;
