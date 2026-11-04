import type { MediaCrop, MediaSubtitleCue } from "../media-edit/types";
import type { TimeUs, FrameRate } from "../services/mediaEngine";
import type { CacheLease } from "../services/cache";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { ConversionWarningCode, MetadataCategory, MediaConversionOptions } from "../convert/types";
import type { Rgba, TimelineEffect, TimelineTitle, TimelineTransition, Rotation, PlaybackRate } from "./types";

/** The media warnings 19b can raise: every 08a/12b conversion warning plus the
 * clipping warning 19b registers. Keep this list in step with
 * `ConversionWarningCode`; a timeline warning is never accepted under a
 * different name. */
export type TimelineWarningCode = ConversionWarningCode | "audio_clipping";

export const TIMELINE_WARNING_CODES: readonly TimelineWarningCode[] = [
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

/** 19b operations, never a second definition of the 19a project model. */
export type TimelineEffectOperation =
  | { kind: "set_effects"; clip_id: string; effects: TimelineEffect[] }
  | { kind: "set_transition"; transition: TimelineTransition | null; left_id: string; right_id: string }
  | { kind: "set_title"; title: TimelineTitle }
  | { kind: "remove_title"; id: string }
  | { kind: "set_track_audio"; id: string; gain: number; mute: boolean; solo: boolean }
  | { kind: "set_clip_audio"; id: string; gain: number; mute: boolean; solo: boolean; fade_in_us: TimeUs; fade_out_us: TimeUs }
  | { kind: "set_subtitles"; cues: MediaSubtitleCue[] };

export interface FrameContribution {
  clip_id: string;
  source_id: string;
  source_us: TimeUs;
  opacity: number;
  crop: MediaCrop | null;
  rotation: Rotation;
  effects: readonly TimelineEffect[];
  z_order: number;
  title?: TimelineTitle;
}

export interface AudioContribution {
  clip_id: string;
  source_id: string;
  source_sample: number;
  gain: number;
  channels: 1 | 2;
  enabled: boolean;
}

/** How project picture is placed in the output frame (19b D7). */
export type TimelineFitMode = "fit_pad";

/**
 * Placement and compositing facts an export must carry so they are never
 * inferred from a hidden original project (19b M1). The typed render graph
 * mirrors them; native export and its validator remain unavailable.
 */
export interface TimelineComposition {
  /** Clips keep their absolute project start; gaps are blank picture/silence. */
  placement: "absolute_start_us";
  /** Video tracks composite bottom-to-top by `Track.index`. */
  stacking: "track_index";
  /** Scale the project picture to fit the output and pad the remainder. */
  fit: TimelineFitMode;
  /** Padding color, four u8 components. */
  background: Rgba;
}

/** A fresh fit/pad composition with opaque black padding. */
export function defaultTimelineComposition(): TimelineComposition {
  return {
    placement: "absolute_start_us",
    stacking: "track_index",
    fit: "fit_pad",
    background: [0, 0, 0, 255],
  };
}

export interface TimelineExportRequest {
  project_snapshot: ExportSnapshot;
  dest_dir: string;
  file_name: string;
  container: "webm" | "mkv" | "mp4" | "flac" | "wav" | "mp3";
  video_codec: MediaConversionOptions["video_codec"];
  audio_codec: MediaConversionOptions["audio_codec"];
  width: number;
  height: number;
  frame_rate: FrameRate;
  bitrate_kbps?: number;
  metadata_keep: true;
  subtitle_mode: "off" | "burn" | "sidecar";
  accepted_losses: MetadataCategory[];
  accepted_warning_codes: TimelineWarningCode[];
  composition: TimelineComposition;
}

export interface TimelineExportPreview {
  frame: CacheLease;
  sample: CacheLease | null;
  duration_us: TimeUs;
  estimated_bytes: number | null;
  warnings: TimelineWarningCode[];
  captured_revision: number;
  content_id: string;
}

/** One composited picture layer. Layers are ordered bottom-to-top. */
export interface RenderLayer {
  input: string;
  track_index: number;
}

/** Typed 19b wire declaration only. Placement, track composition and fit/pad
 * now have explicit facts, but a probe-bound stream source, capability
 * inventory, native constructor/validator and engine translation remain
 * unavailable; these declarations do not claim a constructible or natively
 * validated graph. UUID/range/reference/kind/port/encoder/1MiB checks belong
 * to constructors.
 */
export type RenderNode =
  | { kind: "source"; id: string; source_id: string; stream_index: number }
  | { kind: "blank"; id: string; width: number; height: number; rgba: Rgba }
  | { kind: "trim"; id: string; input: string; start_us: TimeUs; end_us: TimeUs }
  | { kind: "speed"; id: string; input: string; rate: PlaybackRate }
  | { kind: "geometry"; id: string; input: string; crop: MediaCrop | null; rotation: Rotation; output_width: number; output_height: number }
  | { kind: "color"; id: string; input: string; effects: TimelineEffect[] }
  | { kind: "transition"; id: string; left: string; right: string; transition: TimelineTransition }
  | { kind: "title"; id: string; input: string; title: TimelineTitle }
  | { kind: "place"; id: string; input: string; start_us: TimeUs }
  | { kind: "audio_gain"; id: string; input: string; gain: number; fade_in_us: TimeUs; fade_out_us: TimeUs }
  | { kind: "audio_mix"; id: string; inputs: string[] }
  | { kind: "subtitle"; id: string; input: string; cues: MediaSubtitleCue[] }
  | { kind: "concat"; id: string; inputs: string[] }
  | { kind: "compose"; id: string; layers: RenderLayer[]; width: number; height: number;
      fit: TimelineFitMode; background: Rgba }
  | { kind: "encode"; id: string; video_input: string | null; audio_input: string | null;
      container: TimelineExportRequest["container"]; video_codec: TimelineExportRequest["video_codec"]; audio_codec: TimelineExportRequest["audio_codec"] };
