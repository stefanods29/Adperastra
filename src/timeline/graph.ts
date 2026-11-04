/**
 * Pure 19b timeline render-graph builder (Step 19b E5).
 *
 * The input is the frozen, validated `TimelineRenderPlan` and an already
 * validated export request. The output is a bounded typed graph only; no
 * bytes, paths, filter strings or command lines enter a node. Native export
 * is not part of this build: this module never starts a job, leases a source,
 * writes an output or reports success.
 *
 * Placement and composition are explicit because the 19a plan allows gaps and
 * simultaneous video tracks:
 * - every clip keeps its absolute `start_us` through a `place` node;
 * - a transition is a typed `transition` node over the overlapping interval,
 *   placed at the right clip's start and drawn above that track's clips;
 * - video layers are composed bottom-to-top by `Track.index` into the project
 *   picture and then fit/padded into the requested output frame;
 * - titles and burnt subtitles are typed raster inputs, never filter text.
 *
 * Stream identity limit: 19a `MediaSource` carries no probe stream list. The
 * builder uses the fixed convention picture=0 and audio=1 when a source has
 * both, audio=0 for audio-only sources. Native probe must verify these before
 * launch; the graph never maps a source to a UI path.
 */

import type { MediaCrop, MediaSource } from "../media-edit/types";
import type { EngineCapability } from "../services/engineTypes";
import type { TimeUs } from "../services/mediaEngine";
import type {
  RenderLayer,
  RenderNode,
  TimelineExportRequest,
} from "./effectTypes";
import type {
  PlaybackRate,
  Rgba,
  TimelineClip,
  TimelineEffect,
  TimelineRenderPlan,
  TimelineTitle,
  Track,
} from "./types";
import {
  TIMELINE_MAX_CLIPS,
  TIMELINE_MAX_DURATION_US,
  TIMELINE_MAX_SOURCES,
  TIMELINE_MAX_SUBTITLES,
  TIMELINE_MAX_TITLES,
  TIMELINE_MAX_TRACKS,
  TIMELINE_MAX_TRANSITIONS,
  TimelineError,
} from "./types";
import { clipDurationUs, clipEndUs, isFrameRate, timelineDeltaToSourceUs } from "./timing";
import { freezeProject } from "./projectValidation";

/** Graph bounds (19b D8). */
export const RENDER_GRAPH_MAX_NODES = 100_000;
export const RENDER_GRAPH_MAX_EDGES = 200_000;
export const RENDER_GRAPH_MAX_WIRE_BYTES = 1024 * 1024;
export const RENDER_GRAPH_MAX_AUDIO_MIX_INPUTS = 128;
export const RENDER_GRAPH_MAX_CONCAT_INPUTS = 10_000;
export const RENDER_GRAPH_MAX_COMPOSE_LAYERS = 30_000;
export const RENDER_GRAPH_MAX_STREAM_INDEX = 63;
export const RENDER_GRAPH_MAX_DIMENSION = 8_192;
export const RENDER_GRAPH_MAX_PIXELS = 100_000_000;
export const RENDER_GRAPH_MAX_EFFECTS = 64;
export const RENDER_GRAPH_MAX_TITLE_TEXT = 10_000;
export const RENDER_GRAPH_MAX_CUE_TEXT = 8_192;
export const RENDER_GRAPH_MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
export const RENDER_GRAPH_MAX_TRANSITION_US: TimeUs = 10_000_000;

export type RenderPort = "video" | "audio";
export type TimelineExportGraphErrorCode =
  | "timeline_export.bad_request"
  | "timeline_export.unsupported"
  | "timeline_export.changed"
  | "timeline_export.too_large"
  | "timeline_export.missing_glyph"
  | "timeline_export.failed";

/** One typed dependency between two graph nodes. */
export interface RenderEdge {
  readonly from: string;
  readonly to: string;
  readonly port: RenderPort;
}

/**
 * The only graph shape callers receive. It is produced by `buildRenderGraph`
 * and frozen; there is no exported constructor. Native export must revalidate
 * it independently before any process launch.
 */
export interface ValidatedRenderGraph {
  readonly nodes: readonly RenderNode[];
  readonly edges: readonly RenderEdge[];
  readonly duration_us: TimeUs;
}

/** A stable error; the message is exactly the wire code. */
export class TimelineExportGraphError extends Error {
  readonly code: TimelineExportGraphErrorCode;

  constructor(code: TimelineExportGraphErrorCode) {
    super(code);
    this.name = "TimelineExportGraphError";
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTAINERS = new Set(["webm", "mkv", "mp4", "flac", "wav", "mp3"]);
const VIDEO_CODECS = new Set(["auto", "vp9", "av1", "h264_os", "hevc_os", "copy"]);
const AUDIO_CODECS = new Set(["auto", "opus", "vorbis", "flac", "pcm", "mp3", "aac_os", "copy"]);
const AUDIO_ONLY_CONTAINERS = new Set(["flac", "wav", "mp3"]);

function fail(code: TimelineExportGraphErrorCode): never {
  throw new TimelineExportGraphError(code);
}

function bad(): never {
  fail("timeline_export.bad_request");
}

function unsupported(): never {
  fail("timeline_export.unsupported");
}

function changed(): never {
  fail("timeline_export.changed");
}

function tooLarge(): never {
  fail("timeline_export.too_large");
}

function safe(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function bounded(value: unknown, min: number, max: number): value is number {
  return safe(value) && value >= min && value <= max;
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) bad();
  return value;
}

function rgba(value: unknown): Rgba {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => !bounded(item, 0, 255))) {
    bad();
  }
  return [value[0], value[1], value[2], value[3]] as Rgba;
}

function mediaCrop(value: unknown): MediaCrop {
  if (!value || typeof value !== "object") bad();
  const crop = value as MediaCrop;
  if (!safe(crop.x) || !safe(crop.y) || !safe(crop.width) || !safe(crop.height) ||
      crop.width === 0 || crop.height === 0) bad();
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function effectList(effects: unknown): TimelineEffect[] {
  if (!Array.isArray(effects) || effects.length > RENDER_GRAPH_MAX_EFFECTS) bad();
  for (const effect of effects) {
    if (typeof effect !== "object" || effect === null) bad();
    switch ((effect as TimelineEffect).tag) {
      case "brightness":
      case "contrast":
      case "saturation":
        if (!finite((effect as { value: number }).value, -1, 1)) bad();
        break;
      case "color": {
        const gamma = (effect as { gamma: unknown }).gamma;
        if (!Array.isArray(gamma) || gamma.length !== 3 ||
            gamma.some((item) => !finite(item, 0.1, 10))) bad();
        break;
      }
      case "crop": {
        mediaCrop((effect as { rect: unknown }).rect);
        break;
      }
      case "stabilize":
        // No audited non-AI stabilizer is registered in this build.
        unsupported();
      default:
        unsupported();
    }
  }
  return structuredClone(effects as TimelineEffect[]);
}

function playbackRate(rate: unknown): PlaybackRate {
  if (typeof rate !== "object" || rate === null) bad();
  const value = rate as PlaybackRate;
  if (!bounded(value.num, 1, 0xffff_ffff) || !bounded(value.den, 1, 0xffff_ffff)) bad();
  const gcd = (left: number, right: number): number => {
    let a = left;
    let b = right;
    while (b !== 0) {
      const next = a % b;
      a = b;
      b = next;
    }
    return a;
  };
  if (gcd(value.num, value.den) !== 1) bad();
  if (value.num > 4 * value.den || value.den > 4 * value.num) bad();
  return { num: value.num, den: value.den };
}

function checkTrackOrder(plan: Readonly<TimelineRenderPlan>): Track[] {
  if (!Array.isArray(plan.tracks) || plan.tracks.length > TIMELINE_MAX_TRACKS) tooLarge();
  const ordered = [...plan.tracks].sort((left, right) => left.index - right.index);
  ordered.forEach((track, index) => {
    if (track.index !== index) bad();
    if (track.kind !== "video" && track.kind !== "audio") bad();
    if (typeof track.visible !== "boolean" || typeof track.mute !== "boolean" ||
        typeof track.solo !== "boolean" || !finite(track.gain, 0, 4)) bad();
    if (!Array.isArray(track.clips) || track.clips.length > TIMELINE_MAX_CLIPS) tooLarge();
  });
  return ordered;
}

function checkPlan(plan: Readonly<TimelineRenderPlan>): void {
  if (!plan || typeof plan !== "object") bad();
  if (!isFrameRate(plan.frame_rate)) bad();
  if (!bounded(plan.width, 1, RENDER_GRAPH_MAX_DIMENSION) ||
      !bounded(plan.height, 1, RENDER_GRAPH_MAX_DIMENSION) ||
      plan.width * plan.height > RENDER_GRAPH_MAX_PIXELS) tooLarge();
  if (!safe(plan.duration_us) || plan.duration_us === 0 || plan.duration_us > TIMELINE_MAX_DURATION_US) {
    bad();
  }
  if (plan.audio_rate !== 48_000 || (plan.audio_channels !== 1 && plan.audio_channels !== 2)) bad();
  if (!Array.isArray(plan.sources) || plan.sources.length > TIMELINE_MAX_SOURCES) tooLarge();
  if (!Array.isArray(plan.transitions) || plan.transitions.length > TIMELINE_MAX_TRANSITIONS) tooLarge();
  if (!Array.isArray(plan.titles) || plan.titles.length > TIMELINE_MAX_TITLES) tooLarge();
  if (!Array.isArray(plan.subtitles) || plan.subtitles.length > TIMELINE_MAX_SUBTITLES) tooLarge();

  const sourceIds = new Set<string>();
  const sourceById = new Map<string, MediaSource>();
  for (const source of plan.sources) {
    assertUuid(source.id);
    if (sourceIds.has(source.id)) bad();
    sourceIds.add(source.id);
    sourceById.set(source.id, source);
    if (source.sensitive) unsupported();
    if (!safe(source.duration_us) || source.duration_us > TIMELINE_MAX_DURATION_US) bad();
    if (source.video_rate !== null && !isFrameRate(source.video_rate)) bad();
    if (source.audio_rate !== null && !bounded(source.audio_rate, 1, 192_000)) bad();
  }

  const tracks = checkTrackOrder(plan);
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  let clipCount = 0;
  let contentEnd = 0;
  for (const track of tracks) {
    assertUuid(track.id);
    if (trackIds.has(track.id)) bad();
    trackIds.add(track.id);
    for (const clip of track.clips) {
      clipCount += 1;
      if (clipCount > TIMELINE_MAX_CLIPS) tooLarge();
      assertUuid(clip.id);
      assertUuid(clip.source_id);
      if (clipIds.has(clip.id)) bad();
      clipIds.add(clip.id);
      if (!sourceIds.has(clip.source_id)) changed();
      const source = sourceById.get(clip.source_id);
      if (!source) changed();
      if (!safe(clip.start_us)) bad();
      if (!safe(clip.source_in_us) || !safe(clip.source_out_us) || clip.source_out_us <= clip.source_in_us) bad();
      if (clip.source_out_us > source.duration_us) bad();
      if (!clip.transform || typeof clip.transform !== "object") bad();
      if (clip.transform.crop !== null) mediaCrop(clip.transform.crop);
      if (clip.transform.rotation !== 0 && clip.transform.rotation !== 90 &&
          clip.transform.rotation !== 180 && clip.transform.rotation !== 270) bad();
      playbackRate(clip.speed);
      if (!finite(clip.gain, 0, 4) || typeof clip.mute !== "boolean" || typeof clip.solo !== "boolean") bad();
      if (!safe(clip.fade_in_us) || !safe(clip.fade_out_us)) bad();
      const duration = clipDurationUs(clip);
      if (clip.fade_in_us + clip.fade_out_us > duration) bad();
      const end = clipEndUs(clip);
      if (end > TIMELINE_MAX_DURATION_US) tooLarge();
      contentEnd = Math.max(contentEnd, end);
      effectList(clip.effects);
      if (clip.effects.filter((effect) => effect.tag === "crop").length > 1) bad();
      if (clip.effects.some((effect) => effect.tag === "crop") && clip.transform.crop !== null) bad();
    }
  }
  for (const transition of plan.transitions) {
    assertUuid(transition.id);
    assertUuid(transition.track_id);
    if (!trackIds.has(transition.track_id)) bad();
    if (!safe(transition.duration_us) || transition.duration_us === 0 ||
        transition.duration_us > RENDER_GRAPH_MAX_TRANSITION_US) bad();
    if (transition.enabled !== true) bad();
    rgba(transition.rgba);
    if (transition.left_clip_id === transition.right_clip_id) bad();
    if (!clipIds.has(transition.left_clip_id) || !clipIds.has(transition.right_clip_id)) bad();
    const track = tracks.find((candidate) => candidate.id === transition.track_id);
    if (!track || track.kind !== "video") bad();
    const ordered = [...track.clips].sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
    const index = ordered.findIndex((clip) => clip.id === transition.left_clip_id);
    const left = ordered[index];
    const right = ordered[index + 1];
    if (!left || !right || right.id !== transition.right_clip_id) bad();
    if (right.start_us !== clipEndUs(left) - transition.duration_us) bad();
    if (transition.duration_us > Math.min(clipDurationUs(left) / 2, clipDurationUs(right) / 2)) bad();
  }
  const titleIds = new Set<string>();
  for (const item of plan.titles) {
    assertUuid(item.id);
    assertUuid(item.track_id);
    const track = tracks.find((candidate) => candidate.id === item.track_id);
    if (!track || track.kind !== "video" || track.clips.length !== 0) bad();
    if (titleIds.has(item.id)) bad();
    titleIds.add(item.id);
    checkTitle(item);
    contentEnd = Math.max(contentEnd, item.end_us);
  }
  let cueBytes = 0;
  const cueIds = new Set<string>();
  for (const cue of plan.subtitles) {
    assertUuid(cue.id);
    if (cueIds.has(cue.id)) bad();
    cueIds.add(cue.id);
    if (!safe(cue.start_us) || !safe(cue.end_us) || cue.end_us <= cue.start_us) bad();
    if (cue.end_us > TIMELINE_MAX_DURATION_US) tooLarge();
    if (typeof cue.text !== "string" || Array.from(cue.text).length > RENDER_GRAPH_MAX_CUE_TEXT) bad();
    cueBytes += new TextEncoder().encode(cue.text).byteLength;
    contentEnd = Math.max(contentEnd, cue.end_us);
  }
  if (cueBytes > RENDER_GRAPH_MAX_SUBTITLE_BYTES) tooLarge();
  if (plan.duration_us < contentEnd) bad();
}

function checkTitle(item: TimelineTitle): void {
  if (!safe(item.start_us) || !safe(item.end_us) || item.end_us <= item.start_us ||
      item.end_us > TIMELINE_MAX_DURATION_US) bad();
  if (typeof item.text !== "string" || Array.from(item.text).length > RENDER_GRAPH_MAX_TITLE_TEXT) bad();
  if (!safe(item.animation_us) || item.animation_us > item.end_us - item.start_us) bad();
  if (item.animation !== "none" && item.animation !== "fade" && item.animation !== "slide") unsupported();
  const style = item.style;
  if (!style || typeof style.font_asset_id !== "string" || style.font_asset_id.length === 0 ||
      Array.from(style.font_asset_id).length > 128 ||
      !bounded(style.font_size, 1, 512) || !finite(style.x, 0, 1) || !finite(style.y, 0, 1) ||
      (style.align !== "left" && style.align !== "center" && style.align !== "right")) bad();
  rgba(style.rgba);
}

function checkRequest(plan: Readonly<TimelineRenderPlan>, request: TimelineExportRequest): void {
  if (!request || typeof request !== "object") bad();
  if (!bounded(request.width, 1, RENDER_GRAPH_MAX_DIMENSION) ||
      !bounded(request.height, 1, RENDER_GRAPH_MAX_DIMENSION) ||
      request.width * request.height > RENDER_GRAPH_MAX_PIXELS) tooLarge();
  if (!isFrameRate(request.frame_rate) ||
      request.frame_rate.num !== plan.frame_rate.num || request.frame_rate.den !== plan.frame_rate.den) {
    // The frozen encode node has no frame-rate field, so a changed rate could
    // only be dropped silently.
    unsupported();
  }
  if (request.metadata_keep !== true) bad();
  if (typeof request.container !== "string" || !CONTAINERS.has(request.container) ||
      typeof request.video_codec !== "string" || !VIDEO_CODECS.has(request.video_codec) ||
      typeof request.audio_codec !== "string" || !AUDIO_CODECS.has(request.audio_codec) ||
      (request.subtitle_mode !== "off" && request.subtitle_mode !== "burn" &&
        request.subtitle_mode !== "sidecar")) bad();
  if (request.bitrate_kbps !== undefined) {
    // The frozen encode node carries no bitrate; refusing is better than
    // silently encoding at another rate.
    unsupported();
  }
  const composition = request.composition;
  if (!composition || composition.placement !== "absolute_start_us" ||
      composition.stacking !== "track_index" || composition.fit !== "fit_pad") bad();
  rgba(composition.background);
}

function checkCapabilities(capabilities: readonly EngineCapability[]): void {
  if (!Array.isArray(capabilities)) bad();
  const encoder = capabilities.find((capability) =>
    capability && capability.id === "media.encode" && capability.available === true &&
    typeof capability.version === "string" && capability.version.length > 0 &&
    capability.version.length <= 64);
  if (!encoder) unsupported();
}

interface PendingLayer {
  input: string;
  track_index: number;
  rank: number;
  order: number;
  tie: string;
}

function identityRate(rate: PlaybackRate): boolean {
  return rate.num === 1 && rate.den === 1;
}

class GraphBuilder {
  private readonly nodes: RenderNode[] = [];
  private readonly edges: RenderEdge[] = [];
  private readonly ports = new Map<string, RenderPort>();
  private readonly nodeIds = new Set<string>();
  private readonly sourceNodes = new Map<string, string>();
  private readonly sourceById: Map<string, MediaSource>;
  private readonly tracksById: Map<string, Track>;
  private readonly layers: PendingLayer[] = [];
  private readonly audioLeaves: string[] = [];
  private sequence = 0;
  private blank: string | null = null;

  constructor(
    private readonly plan: Readonly<TimelineRenderPlan>,
    private readonly request: TimelineExportRequest,
  ) {
    this.sourceById = new Map(plan.sources.map((source) => [source.id, source]));
    this.tracksById = new Map(plan.tracks.map((track) => [track.id, track]));
  }

  build(): ValidatedRenderGraph {
    const audioOnly = AUDIO_ONLY_CONTAINERS.has(this.request.container);
    if (audioOnly && this.request.subtitle_mode === "burn") bad();
    if (!audioOnly) this.buildVideo();
    this.buildAudio();
    const videoInput = audioOnly ? null : this.buildVideoOutput();
    const audioInput = this.mixAudio(this.audioLeaves);
    if (videoInput === null && audioInput === null) bad();
    this.addEncode(videoInput, audioInput);
    return this.finish();
  }

  private nextId(): string {
    this.sequence += 1;
    if (this.sequence > RENDER_GRAPH_MAX_NODES) tooLarge();
    return `00000000-0000-8000-8000-${this.sequence.toString(16).padStart(12, "0")}`;
  }

  private add(
    node: RenderNode,
    inputs: ReadonlyArray<{ from: string; port: RenderPort }>,
    output: RenderPort | null,
  ): string {
    if (this.nodes.length >= RENDER_GRAPH_MAX_NODES) tooLarge();
    if (this.nodeIds.has(node.id)) bad();
    const seen = new Set<string>();
    for (const input of inputs) {
      const actual = this.ports.get(input.from);
      if (actual !== input.port) bad();
      const key = `${input.from}:${input.port}`;
      if (seen.has(key)) bad();
      seen.add(key);
    }
    this.nodeIds.add(node.id);
    this.nodes.push(node);
    if (output !== null) this.ports.set(node.id, output);
    for (const input of inputs) {
      if (this.edges.length >= RENDER_GRAPH_MAX_EDGES) tooLarge();
      this.edges.push({ from: input.from, to: node.id, port: input.port });
    }
    return node.id;
  }

  private sourceNode(source: MediaSource, kind: RenderPort): string {
    if (source.sensitive) unsupported();
    if (kind === "video" && source.video_rate === null) changed();
    if (kind === "audio" && source.audio_rate === null) changed();
    // Fixed 19a source-model convention; native probe must verify it.
    const streamIndex = kind === "video" ? 0 : source.video_rate !== null ? 1 : 0;
    if (streamIndex > RENDER_GRAPH_MAX_STREAM_INDEX) unsupported();
    const key = `${source.id}:${streamIndex}`;
    const existing = this.sourceNodes.get(key);
    if (existing) {
      if (this.ports.get(existing) !== kind) bad();
      return existing;
    }
    const id = this.nextId();
    this.add({ kind: "source", id, source_id: source.id, stream_index: streamIndex }, [], kind);
    this.sourceNodes.set(key, id);
    return id;
  }

  private sourceFor(clip: TimelineClip): MediaSource {
    const source = this.sourceById.get(clip.source_id);
    if (!source) changed();
    return source;
  }

  private videoPart(clip: TimelineClip, startSource: number, endSource: number): string {
    const source = this.sourceFor(clip);
    const sourceNode = this.sourceNode(source, "video");
    if (startSource >= endSource || endSource > source.duration_us) bad();
    const trim = this.add(
      { kind: "trim", id: this.nextId(), input: sourceNode, start_us: startSource, end_us: endSource },
      [{ from: sourceNode, port: "video" }],
      "video",
    );
    let current = trim;
    if (!identityRate(clip.speed)) {
      current = this.add(
        { kind: "speed", id: this.nextId(), input: current, rate: { ...clip.speed } },
        [{ from: current, port: "video" }],
        "video",
      );
    }
    const cropEffect = clip.effects.find((effect) => effect.tag === "crop");
    const crop = cropEffect && cropEffect.tag === "crop" ? cropEffect.rect : clip.transform.crop;
    current = this.add(
      {
        kind: "geometry", id: this.nextId(), input: current, crop,
        rotation: clip.transform.rotation, output_width: this.plan.width, output_height: this.plan.height,
      },
      [{ from: current, port: "video" }],
      "video",
    );
    const effects = clip.effects.filter((effect) => effect.tag !== "crop");
    if (effects.length > 0) {
      current = this.add(
        { kind: "color", id: this.nextId(), input: current, effects: structuredClone(effects) },
        [{ from: current, port: "video" }],
        "video",
      );
    }
    return current;
  }

  private place(input: string, startUs: number, port: RenderPort): string {
    return this.add(
      { kind: "place", id: this.nextId(), input, start_us: startUs },
      [{ from: input, port }],
      port,
    );
  }

  private buildVideo(): void {
    for (const track of this.plan.tracks) {
      if (track.kind !== "video" || !track.visible) continue;
      const clips = [...track.clips].sort(
        (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
      );
      const byId = new Map(clips.map((clip) => [clip.id, clip]));
      const byRight = new Map(
        this.plan.transitions
          .filter((transition) => transition.track_id === track.id)
          .map((transition) => [transition.right_clip_id, transition]),
      );
      for (const clip of clips) {
        const part = this.videoPart(clip, clip.source_in_us, clip.source_out_us);
        this.layers.push({
          input: this.place(part, clip.start_us, "video"),
          track_index: track.index,
          rank: 0,
          order: clip.start_us,
          tie: clip.id,
        });
        const transition = byRight.get(clip.id);
        if (!transition) continue;
        const left = byId.get(transition.left_clip_id);
        const right = byId.get(transition.right_clip_id);
        if (!left || !right || right.id !== clip.id) bad();
        if (right.start_us !== clipEndUs(left) - transition.duration_us) bad();
        const span = Math.max(1, timelineDeltaToSourceUs(transition.duration_us, left.speed));
        const leftStart = sourceTimeAt(left, right.start_us);
        const leftEnd = Math.min(left.source_out_us, leftStart + span);
        const rightSpan = Math.max(1, timelineDeltaToSourceUs(transition.duration_us, right.speed));
        const rightEnd = Math.min(right.source_out_us, right.source_in_us + rightSpan);
        if (leftStart >= leftEnd || right.source_in_us >= rightEnd) unsupported();
        const leftPart = this.videoPart(left, leftStart, leftEnd);
        const rightPart = this.videoPart(right, right.source_in_us, rightEnd);
        let current = this.add(
          {
            kind: "transition", id: this.nextId(), left: leftPart, right: rightPart,
            transition: structuredClone(transition),
          },
          [
            { from: leftPart, port: "video" },
            { from: rightPart, port: "video" },
          ],
          "video",
        );
        current = this.place(current, right.start_us, "video");
        this.layers.push({
          input: current,
          track_index: track.index,
          rank: 1,
          order: right.start_us,
          tie: transition.id,
        });
      }
    }
    for (const item of this.plan.titles) {
      const track = this.tracksById.get(item.track_id);
      if (!track) bad();
      if (!track.visible) continue;
      const base = this.transparentBlank();
      const title = this.add(
        { kind: "title", id: this.nextId(), input: base, title: structuredClone(item) },
        [{ from: base, port: "video" }],
        "video",
      );
      this.layers.push({
        input: title,
        track_index: track.index,
        rank: 2,
        order: item.start_us,
        tie: item.id,
      });
    }
  }

  private transparentBlank(): string {
    if (this.blank) return this.blank;
    this.blank = this.nextId();
    this.add(
      {
        kind: "blank", id: this.blank, width: this.plan.width, height: this.plan.height,
        rgba: [0, 0, 0, 0],
      },
      [],
      "video",
    );
    return this.blank;
  }

  private buildVideoOutput(): string {
    if (this.layers.length === 0) {
      this.layers.push({
        input: this.transparentBlank(), track_index: 0, rank: 0, order: 0, tie: "",
      });
    }
    if (this.layers.length > RENDER_GRAPH_MAX_COMPOSE_LAYERS) tooLarge();
    const ordered = [...this.layers].sort((left, right) =>
      left.track_index - right.track_index || left.rank - right.rank ||
      left.order - right.order || left.tie.localeCompare(right.tie));
    const layers: RenderLayer[] = ordered.map((layer) => ({
      input: layer.input, track_index: layer.track_index,
    }));
    let video = this.add(
      {
        kind: "compose", id: this.nextId(), layers,
        width: this.request.width, height: this.request.height,
        fit: this.request.composition.fit,
        background: [...this.request.composition.background] as Rgba,
      },
      layers.map((layer) => ({ from: layer.input, port: "video" as const })),
      "video",
    );
    if (this.request.subtitle_mode === "burn" && this.plan.subtitles.length > 0) {
      video = this.add(
        {
          kind: "subtitle", id: this.nextId(), input: video,
          cues: this.plan.subtitles.map((cue) => structuredClone(cue)),
        },
        [{ from: video, port: "video" }],
        "video",
      );
    }
    return video;
  }

  private buildAudio(): void {
    const audioTracks = this.plan.tracks.filter((track) => track.kind === "audio");
    const soloTrack = audioTracks.some((track) => !track.mute && track.solo);
    const qualifying = audioTracks.filter((track) => !track.mute && (!soloTrack || track.solo));
    const soloClip = qualifying.some((track) =>
      track.clips.some((clip) => !clip.mute && clip.solo));
    for (const track of audioTracks) {
      for (const clip of [...track.clips].sort(
        (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
      )) {
        const eligible = !track.mute && !clip.mute && (!soloTrack || track.solo) &&
          (!soloClip || clip.solo);
        if (!eligible) continue;
        const gain = track.gain * clip.gain;
        if (!finite(gain, 0, 16)) bad();
        if (gain === 0) continue;
        const source = this.sourceFor(clip);
        const sourceNode = this.sourceNode(source, "audio");
        const trim = this.add(
          {
            kind: "trim", id: this.nextId(), input: sourceNode,
            start_us: clip.source_in_us, end_us: clip.source_out_us,
          },
          [{ from: sourceNode, port: "audio" }],
          "audio",
        );
        let current = trim;
        if (!identityRate(clip.speed)) {
          current = this.add(
            { kind: "speed", id: this.nextId(), input: current, rate: { ...clip.speed } },
            [{ from: current, port: "audio" }],
            "audio",
          );
        }
        current = this.add(
          {
            kind: "audio_gain", id: this.nextId(), input: current, gain,
            fade_in_us: clip.fade_in_us, fade_out_us: clip.fade_out_us,
          },
          [{ from: current, port: "audio" }],
          "audio",
        );
        this.audioLeaves.push(this.place(current, clip.start_us, "audio"));
      }
    }
  }

  private mixAudio(leaves: string[]): string | null {
    if (leaves.length === 0) return null;
    let level = leaves;
    while (level.length > 1) {
      const next: string[] = [];
      for (let index = 0; index < level.length; index += RENDER_GRAPH_MAX_AUDIO_MIX_INPUTS) {
        const chunk = level.slice(index, index + RENDER_GRAPH_MAX_AUDIO_MIX_INPUTS);
        if (chunk.length === 1) {
          next.push(chunk[0]);
        } else {
          next.push(this.add(
            { kind: "audio_mix", id: this.nextId(), inputs: [...chunk] },
            chunk.map((input) => ({ from: input, port: "audio" as const })),
            "audio",
          ));
        }
      }
      level = next;
    }
    return level[0];
  }

  private addEncode(videoInput: string | null, audioInput: string | null): void {
    const inputs: Array<{ from: string; port: RenderPort }> = [];
    if (videoInput !== null) inputs.push({ from: videoInput, port: "video" });
    if (audioInput !== null) inputs.push({ from: audioInput, port: "audio" });
    if (inputs.length === 0) bad();
    this.add(
      {
        kind: "encode", id: this.nextId(), video_input: videoInput, audio_input: audioInput,
        container: this.request.container, video_codec: this.request.video_codec,
        audio_codec: this.request.audio_codec,
      },
      inputs,
      null,
    );
  }

  private finish(): ValidatedRenderGraph {
    const graph: ValidatedRenderGraph = {
      nodes: this.nodes,
      edges: this.edges,
      duration_us: this.plan.duration_us,
    };
    if (new TextEncoder().encode(JSON.stringify(graph)).byteLength > RENDER_GRAPH_MAX_WIRE_BYTES) {
      tooLarge();
    }
    return freezeProject(graph);
  }
}

/**
 * Build the typed graph from a validated plan and export request. The function
 * is pure: it never reads a file, starts a job or writes an output. It throws
 * a stable `timeline_export.*` code when the plan, request, capabilities or
 * graph budgets do not fit the frozen contract.
 *
 * `capabilities` must contain an available audited `media.encode` entry. That
 * is necessary, not proof of a codec/filter: native export revalidates the
 * actual pack before launch and remains unavailable in this build.
 */
export function buildRenderGraph(
  plan: Readonly<TimelineRenderPlan>,
  request: TimelineExportRequest,
  capabilities: readonly EngineCapability[],
): ValidatedRenderGraph {
  try {
    checkPlan(plan);
    checkRequest(plan, request);
    checkCapabilities(capabilities);
    return new GraphBuilder(plan, request).build();
  } catch (error) {
    if (error instanceof TimelineExportGraphError) throw error;
    if (error instanceof TimelineError) {
      switch (error.code) {
        case "timeline.unsupported":
          unsupported();
        case "timeline.too_large":
          tooLarge();
        case "timeline.missing_source":
        case "timeline.changed":
          changed();
        default:
          bad();
      }
    }
    fail("timeline_export.failed");
  }
}

/** The source microsecond shown at an absolute project time (D2 mapping). */
function sourceTimeAt(clip: TimelineClip, timelineUs: TimeUs): number {
  if (timelineUs <= clip.start_us) return clip.source_in_us;
  const delta = timelineDeltaToSourceUs(timelineUs - clip.start_us, clip.speed);
  return Math.min(clip.source_out_us, clip.source_in_us + delta);
}
