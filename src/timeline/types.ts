/**
 * Canonical timeline project types (Step 19a, revision `timeline-project-1`).
 *
 * A timeline project stores edit instructions and references to source media,
 * never media bytes. Every microsecond value is an integer `TimeUs`; a speed
 * is a reduced rational `PlaybackRate`. The media types are the Step 15
 * definitions (`src/media-edit/types.ts`), and `TimeUs`/`FrameRate` are the
 * Step 12b definitions re-exported by `services/mediaEngine.ts`; nothing here
 * copies them.
 *
 * The shapes carry the effects, transitions and titles that Step 19b
 * consumes. A capability the current build cannot render (stabilization) is
 * still validated but never advertised or applied.
 */

import type {
  MediaCrop,
  MediaSource,
  MediaSubtitleCue,
} from "../media-edit/types";
import type { FrameRate, TimeUs } from "../services/mediaEngine";

/** File handler that owns `.adtimeline` documents. */
export const TIMELINE_HANDLER_ID = "timeline-project";
/** Lower-case extension without the dot. */
export const TIMELINE_EXTENSION = "adtimeline";
/** Exact MIME of the project JSON. */
export const TIMELINE_MIME = "application/vnd.adperastra.timeline+json";
/** The only project schema this revision edits. */
export const TIMELINE_SCHEMA_VERSION = 1;

/** A project document is at most 16 MiB (D1). */
export const TIMELINE_MAX_PROJECT_BYTES = 16 * 1024 * 1024;
/** The preserved `extensions` object is at most 1 MiB (D1). */
export const TIMELINE_MAX_EXTENSIONS_BYTES = 1024 * 1024;
/** Bounds from D1. */
export const TIMELINE_MAX_TRACKS = 128;
export const TIMELINE_MAX_CLIPS = 10_000;
export const TIMELINE_MAX_SOURCES = 1_000;
export const TIMELINE_MAX_TRANSITIONS = 10_000;
export const TIMELINE_MAX_TITLES = 1_000;
export const TIMELINE_MAX_SUBTITLES = 100_000;
/** Twenty-four hours, shared with the 12b media limit. */
export const TIMELINE_MAX_DURATION_US: TimeUs = 24 * 60 * 60 * 1_000_000;
/** Project picture bounds (D8): each side and the total pixel count. */
export const TIMELINE_MAX_DIMENSION = 8_192;
export const TIMELINE_MAX_PIXELS = 100_000_000;
/** Defaults when a new project is created (D8). */
export const TIMELINE_DEFAULT_WIDTH = 1_920;
export const TIMELINE_DEFAULT_HEIGHT = 1_080;
export const TIMELINE_AUDIO_RATE = 48_000;
export const TIMELINE_DEFAULT_FRAME_RATE: FrameRate = { num: 30, den: 1 };
/** Bounded gesture history: entries and approximate JSON bytes. */
export const TIMELINE_MAX_HISTORY_ENTRIES = 100;
export const TIMELINE_MAX_HISTORY_BYTES = 64 * 1024 * 1024;
/** Bound on one clip's ordered effect list (19b D3). */
export const TIMELINE_MAX_EFFECTS_PER_CLIP = 64;
/** Shared effect parameter bounds (19a D4, mirrored by validation and pixels). */
export const TIMELINE_EFFECT_VALUE_MIN = -1;
export const TIMELINE_EFFECT_VALUE_MAX = 1;
export const TIMELINE_EFFECT_GAMMA_MIN = 0.1;
export const TIMELINE_EFFECT_GAMMA_MAX = 10;
export const TIMELINE_EFFECT_STABILIZE_MIN = 0;
export const TIMELINE_EFFECT_STABILIZE_MAX = 1;
/** A transition may take at most ten seconds of either adjacent clip (D2). */
export const TIMELINE_MAX_TRANSITION_US: TimeUs = 10_000_000;
/** Longest track name, in Unicode code points. */
export const TIMELINE_MAX_NAME = 128;

export type TrackKind = "video" | "audio";
export type Rotation = 0 | 90 | 180 | 270;
export type TransitionKind = "crossfade" | "dip" | "wipe";
export type TransitionDirection = "left" | "right" | "up" | "down";
export type TitleAlign = "left" | "center" | "right";
export type TitleAnimation = "none" | "fade" | "slide";
export type Rgba = [number, number, number, number];

/** A reduced positive rational inside 0.25..4 (D2). */
export interface PlaybackRate {
  num: number;
  den: number;
}

/** Per-clip picture transform reserved for 19b. */
export interface TimelineTransform {
  crop: MediaCrop | null;
  rotation: Rotation;
}

/**
 * One reserved effect (19b). `stabilize` is only available after the audited
 * non-AI capability is registered by 19b; 19a validates it but never offers it.
 */
export type TimelineEffect =
  | { tag: "brightness"; value: number }
  | { tag: "contrast"; value: number }
  | { tag: "saturation"; value: number }
  | { tag: "color"; gamma: [number, number, number] }
  /** Source-coordinate crop. A clip carries at most one crop fact: either this
   * effect or `TimelineTransform.crop`, never both. */
  | { tag: "crop"; rect: MediaCrop }
  | { tag: "stabilize"; strength: number };

/** One placed clip. Intervals are start-inclusive and end-exclusive (D2). */
export interface TimelineClip {
  id: string;
  source_id: string;
  /** Shared by linked audio/video partners; null when unlinked. */
  link_id: string | null;
  start_us: TimeUs;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
  speed: PlaybackRate;
  gain: number;
  mute: boolean;
  /** Per-clip solo, gated by its own track's mute/solo state (19b E3). */
  solo: boolean;
  fade_in_us: TimeUs;
  fade_out_us: TimeUs;
  transform: TimelineTransform;
  effects: TimelineEffect[];
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  visible: boolean;
  mute: boolean;
  solo: boolean;
  gain: number;
  /** Bottom-to-top video compositing order; contiguous from zero. */
  index: number;
  clips: TimelineClip[];
}

export interface TimelineTransition {
  id: string;
  track_id: string;
  left_clip_id: string;
  right_clip_id: string;
  kind: TransitionKind;
  duration_us: TimeUs;
  direction: TransitionDirection;
  rgba: Rgba;
  /** A transition is always active; the wire keeps the 19a boolean shape. */
  enabled: true;
}

export interface TimelineTitleStyle {
  font_asset_id: string;
  font_size: number;
  rgba: Rgba;
  align: TitleAlign;
  /** Normalized 0..1 anchor; multiply by the output width/height. */
  x: number;
  y: number;
}

export interface TimelineTitle {
  id: string;
  track_id: string;
  start_us: TimeUs;
  end_us: TimeUs;
  text: string;
  style: TimelineTitleStyle;
  animation: TitleAnimation;
  animation_us: TimeUs;
}

/** A preserved, namespaced JSON object; never executed. */
export type TimelineExtensions = Record<string, unknown>;

/** The complete project document (schema 1). */
export interface TimelineProject {
  schema_version: 1;
  project_id: string;
  content_id: string;
  sources: MediaSource[];
  tracks: Track[];
  width: number;
  height: number;
  frame_rate: FrameRate;
  audio_rate: 48_000;
  audio_channels: 1 | 2;
  transitions: TimelineTransition[];
  titles: TimelineTitle[];
  subtitles: MediaSubtitleCue[];
  extensions?: TimelineExtensions;
}

/** One atomic, validated project edit. */
export type TimelineOperation =
  | { kind: "add_track"; track: Track }
  | { kind: "remove_track"; id: string }
  | { kind: "add_clip"; track_id: string; clip: TimelineClip }
  | { kind: "move_clip"; id: string; track_id: string; start_us: TimeUs }
  | { kind: "trim_clip"; id: string; in_us: TimeUs; out_us: TimeUs }
  | { kind: "split_clip"; id: string; time_us: TimeUs }
  | { kind: "slip_clip"; id: string; delta_us: number }
  | { kind: "delete_clips"; ids: string[]; ripple: boolean }
  | { kind: "reorder_tracks"; ids: string[] }
  | { kind: "relink_source"; id: string; replacement: MediaSource };

export type TimelineOperationKind = TimelineOperation["kind"];

/**
 * The exact normalized plan 19b previews and exports. It is a frozen copy:
 * ordered tracks, sources, transitions, titles and subtitles with their source
 * stamps and no arbitrary graph text or extension object.
 */
export interface TimelineRenderPlan {
  project_id: string;
  content_id: string;
  duration_us: TimeUs;
  frame_rate: FrameRate;
  width: number;
  height: number;
  audio_rate: 48_000;
  audio_channels: 1 | 2;
  tracks: Track[];
  sources: MediaSource[];
  transitions: TimelineTransition[];
  titles: TimelineTitle[];
  subtitles: MediaSubtitleCue[];
}

/** Every stable error this area returns; the UI translates `errors.timeline.*`. */
export type TimelineErrorCode =
  | "timeline.bad_request"
  | "timeline.missing_source"
  | "timeline.changed"
  | "timeline.locked"
  | "timeline.overlap"
  | "timeline.too_large"
  | "timeline.history_full"
  | "timeline.unsupported"
  | "timeline.failed";

const TIMELINE_ERROR_CODES: readonly TimelineErrorCode[] = [
  "timeline.bad_request",
  "timeline.missing_source",
  "timeline.changed",
  "timeline.locked",
  "timeline.overlap",
  "timeline.too_large",
  "timeline.history_full",
  "timeline.unsupported",
  "timeline.failed",
];

/** An error carrying one stable code instead of display text. */
export class TimelineError extends Error {
  readonly code: TimelineErrorCode;

  constructor(code: TimelineErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = "TimelineError";
    this.code = code;
  }
}

/** The stable code of any thrown value, or `timeline.failed`. Native job
 * errors and service refusals cross the IPC boundary as their stable code
 * string, so those are recognized without inventing display text. */
export function timelineErrorCode(error: unknown): TimelineErrorCode {
  if (error instanceof TimelineError) return error.code;
  const message = error instanceof Error ? error.message : "";
  return TIMELINE_ERROR_CODES.includes(message as TimelineErrorCode)
    ? (message as TimelineErrorCode)
    : "timeline.failed";
}

/** A fresh default playback rate (1/1). */
export function defaultPlaybackRate(): PlaybackRate {
  return { num: 1, den: 1 };
}

/** A fresh default transform. */
export function defaultTransform(): TimelineTransform {
  return { crop: null, rotation: 0 };
}

/** True when a value is a positive safe integer. */
export function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A fresh UUID for a project, track, clip or model state. Identities are not
 * secrets; the platform generator is used when it exists.
 */
export function newUuid(): string {
  const generator = globalThis.crypto;
  if (generator && typeof generator.randomUUID === "function") {
    return generator.randomUUID();
  }
  // RFC 4122 version 4 shape for environments without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
