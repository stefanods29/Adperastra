/**
 * Bounded project parsing and validation (Step 19a D1/D2/D5).
 *
 * The parser is the one place raw project JSON becomes a `TimelineProject`.
 * It enforces every published count, length, time and identity bound, drops
 * unknown top-level fields, preserves a validated `extensions` object, and
 * never executes anything from the file. A newer schema is returned as raw
 * preserved text instead of being downgraded or rewritten.
 */

import type { FrameRate, TimeUs } from "../services/mediaEngine";
import type {
  MediaCrop,
  MediaSource,
  MediaSubtitleCue,
} from "../media-edit/types";
import type {
  PlaybackRate,
  Rgba,
  TimelineClip,
  TimelineEffect,
  TimelineExtensions,
  TimelineProject,
  TimelineTitle,
  TimelineTitleStyle,
  TimelineTransition,
  Track,
} from "./types";
import {
  TIMELINE_AUDIO_RATE,
  TIMELINE_DEFAULT_FRAME_RATE,
  TIMELINE_DEFAULT_HEIGHT,
  TIMELINE_DEFAULT_WIDTH,
  TIMELINE_EFFECT_GAMMA_MAX,
  TIMELINE_EFFECT_GAMMA_MIN,
  TIMELINE_EFFECT_STABILIZE_MAX,
  TIMELINE_EFFECT_STABILIZE_MIN,
  TIMELINE_EFFECT_VALUE_MAX,
  TIMELINE_EFFECT_VALUE_MIN,
  TIMELINE_MAX_CLIPS,
  TIMELINE_MAX_DIMENSION,
  TIMELINE_MAX_DURATION_US,
  TIMELINE_MAX_EFFECTS_PER_CLIP,
  TIMELINE_MAX_EXTENSIONS_BYTES,
  TIMELINE_MAX_NAME,
  TIMELINE_MAX_PIXELS,
  TIMELINE_MAX_PROJECT_BYTES,
  TIMELINE_MAX_SOURCES,
  TIMELINE_MAX_SUBTITLES,
  TIMELINE_MAX_TITLES,
  TIMELINE_MAX_TRACKS,
  TIMELINE_MAX_TRANSITION_US,
  TIMELINE_MAX_TRANSITIONS,
  TIMELINE_SCHEMA_VERSION,
  TimelineError,
  defaultPlaybackRate,
  defaultTransform,
  isSafeCount,
  newUuid,
} from "./types";
import { clipDurationUs, clipEndUs, frameTime, isFrameRate, isPlaybackRate } from "./timing";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOLUME_ID = /^[0-9a-f]{8}$/;
const FILE_ID = /^[0-9a-f]{16}$/;
const NAMESPACE_KEY = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

/** Parsed file: an editable project or a newer schema kept byte-for-byte. */
export type TimelineFile =
  | { kind: "project"; project: TimelineProject }
  | { kind: "newer"; schema_version: number; raw: string };

function bad(detail?: string): never {
  throw new TimelineError("timeline.bad_request", detail);
}

function record(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad(detail);
  const prototype = Object.getPrototypeOf(value) as unknown;
  // `structuredClone` produces a plain object from another realm whose
  // prototype is that realm's Object.prototype; a class instance keeps a
  // prototype with its own non-null prototype.
  const plain =
    prototype === null ||
    prototype === Object.prototype ||
    (typeof prototype === "object" &&
      prototype !== null &&
      Object.getPrototypeOf(prototype) === null &&
      Object.prototype.hasOwnProperty.call(prototype, "constructor") &&
      typeof (prototype as { constructor?: unknown }).constructor === "function");
  if (!plain) bad(detail);
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, detail: string, allowEmpty = false): string {
  if (typeof value !== "string") bad(detail);
  const length = Array.from(value).length;
  if ((!allowEmpty && length === 0) || length > max) bad(detail);
  if (value.includes("\u0000")) bad(detail);
  return value;
}

function uuid(value: unknown, detail: string): string {
  if (typeof value !== "string" || !UUID.test(value)) bad(detail);
  return value.toLowerCase();
}

function safe(value: unknown, detail: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) bad(detail);
  return value;
}

function numberIn(value: unknown, min: number, max: number, detail: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    bad(detail);
  }
  return value;
}

function bool(value: unknown, detail: string): boolean {
  if (typeof value !== "boolean") bad(detail);
  return value;
}

function list(value: unknown, max: number, detail: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) bad(detail);
  return value;
}

function rgba(value: unknown, detail: string): Rgba {
  const items = list(value, 4, detail);
  if (items.length !== 4) bad(detail);
  return [0, 1, 2, 3].map((index) => numberIn(items[index], 0, 255, detail)) as Rgba;
}

function rate(value: unknown, detail: string): PlaybackRate {
  const item = record(value, detail);
  const reduced = { num: safe(item.num, detail), den: safe(item.den, detail) };
  if (!isPlaybackRate(reduced)) bad(detail);
  return reduced;
}

function frameRate(value: unknown, detail: string): FrameRate {
  const item = record(value, detail);
  const rateValue = { num: safe(item.num, detail), den: safe(item.den, detail) };
  if (!isFrameRate(rateValue)) bad(detail);
  return rateValue;
}

/** True when a path is an absolute Windows disk or UNC path, not a URL. */
export function isAbsoluteWindowsPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 32_768) return false;
  if (path.includes("\u0000") || path.includes("://")) return false;
  const disk = /^[A-Za-z]:[\\/]/.test(path);
  const unc = /^\\\\[^\\/]+[\\/][^\\/]+/.test(path);
  if (!disk && !unc) return false;
  return !path.split(/[\\/]+/).some((part) => part === "..");
}

function sourceStamp(value: unknown): MediaSource["stamp"] {
  const stamp = record(value, "source stamp");
  const pathKey = text(stamp.path_key, 32_768, "stamp path");
  if (!isAbsoluteWindowsPath(pathKey)) bad("stamp path");
  if (typeof stamp.volume_id !== "string" || !VOLUME_ID.test(stamp.volume_id)) bad("volume id");
  if (typeof stamp.file_id !== "string" || !FILE_ID.test(stamp.file_id)) bad("file id");
  if (typeof stamp.modified_ticks !== "string" || !/^\d{1,20}$/.test(stamp.modified_ticks)) {
    bad("modified ticks");
  }
  const size = safe(stamp.size_bytes, "stamp size");
  if (size > Number.MAX_SAFE_INTEGER) bad("stamp size");
  return {
    path_key: pathKey,
    volume_id: stamp.volume_id,
    file_id: stamp.file_id,
    modified_ticks: stamp.modified_ticks,
    size_bytes: size,
  };
}

/** Validate one Step 15 media source reference. */
export function validateMediaSource(value: unknown): MediaSource {
  const source = record(value, "source");
  const duration = safe(source.duration_us, "source duration");
  if (duration > TIMELINE_MAX_DURATION_US) throw new TimelineError("timeline.too_large");
  const videoRate = source.video_rate === null ? null : frameRate(source.video_rate, "source rate");
  const audioRate = source.audio_rate === null ? null : safe(source.audio_rate, "source audio");
  if (audioRate !== null && (audioRate < 1 || audioRate > 192_000)) bad("source audio rate");
  if (bool(source.sensitive, "source sensitive")) {
    throw new TimelineError("timeline.unsupported", "sensitive source");
  }
  const path = text(source.path, 32_768, "source path");
  if (!isAbsoluteWindowsPath(path)) bad("source path");
  return {
    id: uuid(source.id, "source id"),
    path,
    stamp: sourceStamp(source.stamp),
    duration_us: duration,
    video_rate: videoRate,
    audio_rate: audioRate,
    sensitive: false,
  };
}

/** Validate one integer source-pixel crop rectangle. */
export function validateMediaCrop(value: unknown): MediaCrop {
  const crop = record(value, "crop");
  const rect = {
    x: safe(crop.x, "crop x"),
    y: safe(crop.y, "crop y"),
    width: safe(crop.width, "crop width"),
    height: safe(crop.height, "crop height"),
  };
  if (rect.width === 0 || rect.height === 0) bad("crop size");
  return rect;
}

/** Validate one Step 15 subtitle cue (bounded text, positive interval). */
export function validateMediaSubtitleCue(value: unknown): MediaSubtitleCue {
  const cue = record(value, "subtitle");
  const start = safe(cue.start_us, "subtitle start");
  const end = safe(cue.end_us, "subtitle end");
  if (end <= start) bad("subtitle interval");
  return {
    id: uuid(cue.id, "subtitle id"),
    start_us: start,
    end_us: end,
    text: text(cue.text, 8_192, "subtitle text", true),
  };
}

function effect(value: unknown): TimelineEffect {
  const data = record(value, "effect");
  const tag = data.tag;
  if (tag === "brightness") {
    return { tag: "brightness", value: numberIn(data.value, TIMELINE_EFFECT_VALUE_MIN, TIMELINE_EFFECT_VALUE_MAX, "effect value") };
  }
  if (tag === "contrast") {
    return { tag: "contrast", value: numberIn(data.value, TIMELINE_EFFECT_VALUE_MIN, TIMELINE_EFFECT_VALUE_MAX, "effect value") };
  }
  if (tag === "saturation") {
    return { tag: "saturation", value: numberIn(data.value, TIMELINE_EFFECT_VALUE_MIN, TIMELINE_EFFECT_VALUE_MAX, "effect value") };
  }
  if (tag === "color") {
    const gamma = list(data.gamma, 3, "effect gamma");
    if (gamma.length !== 3) bad("effect gamma");
    return {
      tag: "color",
      gamma: gamma.map((item) => numberIn(item, TIMELINE_EFFECT_GAMMA_MIN, TIMELINE_EFFECT_GAMMA_MAX, "gamma")) as [number, number, number],
    };
  }
  if (tag === "crop") return { tag: "crop", rect: validateMediaCrop(data.rect) };
  if (tag === "stabilize") {
    // Reserved for the audited 19b capability; validation keeps the shape but
    // 19a never advertises or applies it.
    return { tag: "stabilize", strength: numberIn(data.strength, TIMELINE_EFFECT_STABILIZE_MIN, TIMELINE_EFFECT_STABILIZE_MAX, "stabilize") };
  }
  throw new TimelineError("timeline.unsupported", "effect");
}

function clip(value: unknown, sourceDurations: ReadonlyMap<string, number>): TimelineClip {
  const data = record(value, "clip");
  const sourceId = uuid(data.source_id, "clip source");
  const sourceDuration = sourceDurations.get(sourceId);
  if (sourceDuration === undefined) throw new TimelineError("timeline.missing_source");
  const sourceIn = safe(data.source_in_us, "clip in");
  const sourceOut = safe(data.source_out_us, "clip out");
  if (sourceOut <= sourceIn) bad("clip source interval");
  if (sourceOut > sourceDuration) bad("clip source bounds");
  const speed = rate(data.speed, "clip speed");
  const transform = record(data.transform, "clip transform");
  const rotation = safe(transform.rotation, "clip rotation");
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) bad("rotation");
  const transformCrop = transform.crop === null ? null : validateMediaCrop(transform.crop);
  const effects = list(data.effects, TIMELINE_MAX_EFFECTS_PER_CLIP, "clip effects").map(effect);
  // FrameContribution carries exactly one source crop. Two crop facts would
  // make one of them silently disappear from preview and export.
  const effectCrops = effects.filter((item) => item.tag === "crop").length;
  if (effectCrops > 1 || (effectCrops === 1 && transformCrop !== null)) bad("clip crop");
  const start = safe(data.start_us, "clip start");
  const duration = clipDurationUs({
    source_in_us: sourceIn,
    source_out_us: sourceOut,
    speed,
  } as TimelineClip);
  if (start + duration > TIMELINE_MAX_DURATION_US) throw new TimelineError("timeline.too_large");
  const fadeIn = safe(data.fade_in_us, "fade in");
  const fadeOut = safe(data.fade_out_us, "fade out");
  if (fadeIn + fadeOut > duration) bad("fade interval");
  return {
    id: uuid(data.id, "clip id"),
    source_id: sourceId,
    link_id: data.link_id === null ? null : uuid(data.link_id, "link id"),
    start_us: start,
    source_in_us: sourceIn,
    source_out_us: sourceOut,
    speed,
    gain: numberIn(data.gain, 0, 4, "clip gain"),
    mute: bool(data.mute, "clip mute"),
    solo: data.solo === undefined ? false : bool(data.solo, "clip solo"),
    fade_in_us: fadeIn,
    fade_out_us: fadeOut,
    transform: {
      crop: transformCrop,
      rotation: rotation as 0 | 90 | 180 | 270,
    },
    effects,
  };
}

function track(value: unknown, sourceDurations: ReadonlyMap<string, number>): Track {
  const data = record(value, "track");
  const kind = data.kind;
  if (kind !== "video" && kind !== "audio") bad("track kind");
  const clips = list(data.clips, TIMELINE_MAX_CLIPS, "track clips").map((item) =>
    clip(item, sourceDurations),
  );
  return {
    id: uuid(data.id, "track id"),
    kind,
    name: text(data.name, TIMELINE_MAX_NAME, "track name"),
    locked: bool(data.locked, "track locked"),
    visible: bool(data.visible, "track visible"),
    mute: bool(data.mute, "track mute"),
    solo: bool(data.solo, "track solo"),
    gain: numberIn(data.gain, 0, 4, "track gain"),
    index: safe(data.index, "track index"),
    clips,
  };
}

function transition(value: unknown, tracks: Map<string, Track>, clipIds: Set<string>): TimelineTransition {
  const data = record(value, "transition");
  const kind = data.kind;
  if (kind !== "crossfade" && kind !== "dip" && kind !== "wipe") bad("transition kind");
  const direction = data.direction;
  if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
    bad("transition direction");
  }
  const trackId = uuid(data.track_id, "transition track");
  const trackValue = tracks.get(trackId);
  if (!trackValue || trackValue.kind !== "video") bad("transition track");
  const left = uuid(data.left_clip_id, "transition left");
  const right = uuid(data.right_clip_id, "transition right");
  if (!clipIds.has(left) || !clipIds.has(right) || left === right) bad("transition clip");
  const duration = safe(data.duration_us, "transition duration");
  if (duration === 0) bad("transition duration");
  if (data.enabled !== true) bad("transition enabled");
  return {
    id: uuid(data.id, "transition id"),
    track_id: trackId,
    left_clip_id: left,
    right_clip_id: right,
    kind,
    duration_us: duration,
    direction,
    rgba: rgba(data.rgba, "transition color"),
    enabled: true,
  };
}

function titleStyle(value: unknown): TimelineTitleStyle {
  const style = record(value, "title style");
  const align = style.align;
  if (align !== "left" && align !== "center" && align !== "right") bad("title align");
  const fontAsset = text(style.font_asset_id, 128, "font asset");
  return {
    font_asset_id: fontAsset,
    font_size: numberIn(style.font_size, 1, 512, "font size"),
    rgba: rgba(style.rgba, "title color"),
    align,
    x: numberIn(style.x, 0, 1, "title x"),
    y: numberIn(style.y, 0, 1, "title y"),
  };
}

function title(value: unknown, tracks: Map<string, Track>): TimelineTitle {
  const data = record(value, "title");
  const trackId = uuid(data.track_id, "title track");
  const track = tracks.get(trackId);
  // A title track is a video track that carries no picture clips; title text
  // stays data and is never interpreted as filter or markup syntax.
  if (!track || track.kind !== "video" || track.clips.length !== 0) bad("title track");
  const start = safe(data.start_us, "title start");
  const end = safe(data.end_us, "title end");
  if (end <= start || end > TIMELINE_MAX_DURATION_US) bad("title interval");
  const animation = data.animation;
  if (animation !== "none" && animation !== "fade" && animation !== "slide") bad("title animation");
  const animationUs = safe(data.animation_us, "title animation");
  if (animationUs > end - start) bad("title animation interval");
  return {
    id: uuid(data.id, "title id"),
    track_id: trackId,
    start_us: start,
    end_us: end,
    text: text(data.text, 10_000, "title text", true),
    style: titleStyle(data.style),
    animation,
    animation_us: animationUs,
  };
}

function sanitizeJson(value: unknown, depth: number): unknown {
  if (depth > 8) bad("extension depth");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, 8_192, "extension string", true);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) bad("extension number");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) bad("extension array");
    return value.map((item) => sanitizeJson(item, depth + 1));
  }
  const source = record(value, "extension object");
  const keys = Object.keys(source);
  if (keys.length > 64) bad("extension keys");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") bad("extension key");
    result[key] = sanitizeJson(source[key], depth + 1);
  }
  return result;
}

function extensions(value: unknown): TimelineExtensions {
  const source = record(value, "extensions");
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!NAMESPACE_KEY.test(key)) bad("extension namespace");
    if (key === "__proto__" || key === "constructor" || key === "prototype") bad("extension key");
    result[key] = sanitizeJson(source[key], 0);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > TIMELINE_MAX_EXTENSIONS_BYTES) {
    throw new TimelineError("timeline.too_large", "extensions");
  }
  return result;
}

function checkLinks(tracks: Track[]): void {
  const groups = new Map<string, Array<{ track: Track; clip: TimelineClip }>>();
  for (const track of tracks) {
    for (const item of track.clips) {
      if (item.link_id === null) continue;
      const group = groups.get(item.link_id) ?? [];
      group.push({ track, clip: item });
      groups.set(item.link_id, group);
    }
  }
  for (const group of groups.values()) {
    if (group.length < 2) bad("orphan link");
    const first = group[0].clip;
    const kinds = new Set(group.map((entry) => entry.track.kind));
    if (kinds.size !== group.length) bad("linked track kind");
    for (const entry of group) {
      const other = entry.clip;
      if (
        other.source_id !== first.source_id ||
        other.start_us !== first.start_us ||
        other.source_in_us !== first.source_in_us ||
        other.source_out_us !== first.source_out_us ||
        other.speed.num !== first.speed.num ||
        other.speed.den !== first.speed.den
      ) {
        bad("linked clip mismatch");
      }
    }
  }
}

/** Same-track video overlap is admitted only where one transition accounts for
 * it exactly. A transition may pair only two adjacent clips and may never take
 * more than half of either clip. */
function checkOverlaps(tracks: Track[], transitions: TimelineTransition[]): void {
  const transitionIds = new Set<string>();
  const pairs = new Set<string>();
  const totals = new Map<string, number>();
  const transitionPairs = new Map<string, TimelineTransition>();
  for (const transition of transitions) {
    const track = tracks.find((item) => item.id === transition.track_id);
    if (!track || track.kind !== "video" || transitionIds.has(transition.id)) {
      throw new TimelineError("timeline.bad_request");
    }
    transitionIds.add(transition.id);
    const ordered = [...track.clips].sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
    const index = ordered.findIndex((item) => item.id === transition.left_clip_id);
    const left = ordered[index];
    const right = ordered[index + 1];
    if (!left || !right || right.id !== transition.right_clip_id) {
      throw new TimelineError("timeline.overlap");
    }
    const pair = `${left.id}:${right.id}`;
    if (pairs.has(pair)) throw new TimelineError("timeline.overlap");
    pairs.add(pair);
    if (
      transition.duration_us >
      Math.min(clipDurationUs(left) / 2, clipDurationUs(right) / 2, TIMELINE_MAX_TRANSITION_US)
    ) {
      throw new TimelineError("timeline.bad_request");
    }
    if (right.start_us !== clipEndUs(left) - transition.duration_us) {
      throw new TimelineError("timeline.overlap");
    }
    transitionPairs.set(pair, transition);
    for (const item of [left, right]) {
      const total = (totals.get(item.id) ?? 0) + transition.duration_us;
      if (total > clipDurationUs(item)) throw new TimelineError("timeline.overlap");
      totals.set(item.id, total);
    }
  }
  for (const track of tracks) {
    if (track.kind !== "video") continue;
    const ordered = [...track.clips].sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1];
      const right = ordered[index];
      if (
        right.start_us < clipEndUs(left) &&
        !transitionPairs.has(`${left.id}:${right.id}`)
      ) {
        throw new TimelineError("timeline.overlap");
      }
    }
  }
}

function subtitleList(value: unknown): MediaSubtitleCue[] {
  const items = list(value, TIMELINE_MAX_SUBTITLES, "subtitles");
  const ids = new Set<string>();
  const cues: MediaSubtitleCue[] = [];
  let bytes = 0;
  for (const item of items) {
    const cue = validateMediaSubtitleCue(item);
    if (ids.has(cue.id)) bad("duplicate subtitle");
    if (cue.end_us > TIMELINE_MAX_DURATION_US) throw new TimelineError("timeline.too_large");
    ids.add(cue.id);
    bytes += new TextEncoder().encode(cue.text).byteLength;
    if (bytes > 4 * 1024 * 1024) throw new TimelineError("timeline.too_large");
    cues.push(cue);
  }
  return cues.sort((left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id));
}

/** The project's last used microsecond: clips, titles and subtitles, rounded
 * up to the first whole frame of its rational frame rate. */
export function computeProjectDurationUs(project: Readonly<TimelineProject>): TimeUs {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start_us + clipDurationUs(clip));
  }
  for (const item of project.titles) end = Math.max(end, item.end_us);
  for (const item of project.subtitles) end = Math.max(end, item.end_us);
  if (end === 0) return 0;
  const numerator = BigInt(end) * BigInt(project.frame_rate.num);
  const denominator = 1_000_000n * BigInt(project.frame_rate.den);
  const frame = (numerator + denominator - 1n) / denominator;
  if (frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new TimelineError("timeline.too_large");
  return frameTime(Number(frame), project.frame_rate);
}

/** Validate and normalize one complete project (D1/D2/D3/D8). */
export function validateTimelineProject(value: unknown): TimelineProject {
  const data = record(value, "project");
  if (safe(data.schema_version, "schema") !== TIMELINE_SCHEMA_VERSION) bad("schema");
  const sources = list(data.sources, TIMELINE_MAX_SOURCES, "sources").map(validateMediaSource);
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) bad("duplicate source");
  const sourceDurations = new Map(sources.map((source) => [source.id, source.duration_us] as const));
  const tracks = list(data.tracks, TIMELINE_MAX_TRACKS, "tracks").map((item) =>
    track(item, sourceDurations),
  );
  const trackIds = new Set(tracks.map((item) => item.id));
  if (trackIds.size !== tracks.length) bad("duplicate track");
  tracks.forEach((item, index) => {
    if (item.index !== index) bad("track index");
  });
  const clipIds = new Set<string>();
  let clipCount = 0;
  for (const trackValue of tracks) {
    for (const item of trackValue.clips) {
      clipCount += 1;
      if (clipIds.has(item.id)) bad("duplicate clip");
      clipIds.add(item.id);
    }
  }
  if (clipCount > TIMELINE_MAX_CLIPS) throw new TimelineError("timeline.too_large");
  checkLinks(tracks);
  const trackMap = new Map(tracks.map((item) => [item.id, item]));
  const transitions = list(data.transitions, TIMELINE_MAX_TRANSITIONS, "transitions").map((item) =>
    transition(item, trackMap, clipIds),
  );
  checkOverlaps(tracks, transitions);
  const titles = list(data.titles, TIMELINE_MAX_TITLES, "titles").map((item) =>
    title(item, trackMap),
  );
  const titleIds = new Set<string>();
  for (const item of titles) {
    if (titleIds.has(item.id)) bad("duplicate title");
    titleIds.add(item.id);
  }
  const subtitles = subtitleList(data.subtitles);
  const width = safe(data.width, "width");
  const height = safe(data.height, "height");
  if (width < 1 || height < 1 || width > TIMELINE_MAX_DIMENSION || height > TIMELINE_MAX_DIMENSION) {
    bad("project size");
  }
  if (width * height > TIMELINE_MAX_PIXELS) throw new TimelineError("timeline.too_large");
  if (safe(data.audio_rate, "audio rate") !== TIMELINE_AUDIO_RATE) bad("audio rate");
  const channels = safe(data.audio_channels, "audio channels");
  if (channels !== 1 && channels !== 2) bad("audio channels");
  const audioChannels = channels === 1 ? 1 : 2;
  const project: TimelineProject = {
    schema_version: TIMELINE_SCHEMA_VERSION,
    project_id: uuid(data.project_id, "project id"),
    content_id: uuid(data.content_id, "content id"),
    sources,
    tracks,
    width,
    height,
    frame_rate: frameRate(data.frame_rate, "frame rate"),
    audio_rate: TIMELINE_AUDIO_RATE,
    audio_channels: audioChannels,
    transitions,
    titles,
    subtitles,
  };
  if (data.extensions !== undefined && data.extensions !== null) {
    project.extensions = extensions(data.extensions);
  }
  if (computeProjectDurationUs(project) > TIMELINE_MAX_DURATION_US) {
    throw new TimelineError("timeline.too_large");
  }
  return project;
}

/** Parse project text; a newer schema is preserved instead of downgraded. */
export function decodeTimelineFile(textValue: string): TimelineFile {
  if (typeof textValue !== "string") bad("project text");
  if (new TextEncoder().encode(textValue).length > TIMELINE_MAX_PROJECT_BYTES) {
    throw new TimelineError("timeline.too_large");
  }
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(textValue) as unknown;
  } catch {
    bad("json");
  }
  if (parsed === undefined) bad("json");
  const data = record(parsed, "project");
  const version = safe(data.schema_version, "schema");
  if (version > TIMELINE_SCHEMA_VERSION) {
    return { kind: "newer", schema_version: version, raw: textValue };
  }
  if (version !== TIMELINE_SCHEMA_VERSION) bad("schema");
  return { kind: "project", project: validateTimelineProject(data) };
}

/** Serialize a validated project; the byte cap is checked before returning. */
export function encodeTimelineProject(project: Readonly<TimelineProject>): string {
  const validated = validateTimelineProject(project);
  const textValue = JSON.stringify(validated);
  if (new TextEncoder().encode(textValue).length > TIMELINE_MAX_PROJECT_BYTES) {
    throw new TimelineError("timeline.too_large");
  }
  return textValue;
}

/** Deep clone through JSON, which is exactly the project's data domain. */
export function cloneProject(project: Readonly<TimelineProject>): TimelineProject {
  return JSON.parse(JSON.stringify(project)) as TimelineProject;
}

/** Recursively freeze a project (and its nested source stamps). */
export function freezeProject<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeProject(child);
  }
  return value;
}

export interface NewTimelineOptions {
  project_id: string;
  content_id: string;
  /** Translated track names, supplied by the UI. */
  video_name: string;
  audio_name?: string;
  /** Default true; an audio-only recipe creates no video track. */
  with_video_track?: boolean;
  with_audio_track?: boolean;
  width?: number;
  height?: number;
  frame_rate?: FrameRate;
}

/** A new empty project with one video track (and optional audio track). */
export function emptyTimelineProject(options: NewTimelineOptions): TimelineProject {
  if (!UUID.test(options.project_id) || !UUID.test(options.content_id)) bad("new project id");
  const tracks: Track[] = [];
  if (options.with_video_track !== false) {
    tracks.push({
      id: newUuid(),
      kind: "video",
      name: text(options.video_name, TIMELINE_MAX_NAME, "video track name"),
      locked: false,
      visible: true,
      mute: false,
      solo: false,
      gain: 1,
      index: tracks.length,
      clips: [],
    });
  }
  if (options.with_audio_track) {
    if (!options.audio_name) bad("audio track name");
    tracks.push({
      id: newUuid(),
      kind: "audio",
      name: text(options.audio_name, TIMELINE_MAX_NAME, "audio track name"),
      locked: false,
      visible: true,
      mute: false,
      solo: false,
      gain: 1,
      index: tracks.length,
      clips: [],
    });
  }
  const project: TimelineProject = {
    schema_version: TIMELINE_SCHEMA_VERSION,
    project_id: options.project_id,
    content_id: options.content_id,
    sources: [],
    tracks,
    width: options.width ?? TIMELINE_DEFAULT_WIDTH,
    height: options.height ?? TIMELINE_DEFAULT_HEIGHT,
    frame_rate: options.frame_rate ?? { ...TIMELINE_DEFAULT_FRAME_RATE },
    audio_rate: TIMELINE_AUDIO_RATE,
    audio_channels: 2,
    transitions: [],
    titles: [],
    subtitles: [],
  };
  return validateTimelineProject(project);
}

/** A new empty clip with the required defaults. */
export function emptyTimelineClip(input: {
  id: string;
  source_id: string;
  start_us: TimeUs;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
  link_id?: string | null;
}): TimelineClip {
  return {
    id: input.id,
    source_id: input.source_id,
    link_id: input.link_id ?? null,
    start_us: input.start_us,
    source_in_us: input.source_in_us,
    source_out_us: input.source_out_us,
    speed: defaultPlaybackRate(),
    gain: 1,
    mute: false,
    solo: false,
    fade_in_us: 0,
    fade_out_us: 0,
    transform: defaultTransform(),
    effects: [],
  };
}

/** True when a value looks like a validated non-negative count. */
export function isCount(value: unknown): value is number {
  return isSafeCount(value);
}
