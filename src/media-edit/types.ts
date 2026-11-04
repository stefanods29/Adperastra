import type { FrameRate, TimeUs } from "../services/mediaEngine";
import type { SourceStamp } from "../services/cache";

/**
 * Shared media-editing contracts (Step 15, `media-edit-1` / `media-time-1`).
 * Native mirror: `src-tauri/src/media_edit_types.rs`. `TimeUs`/`FrameRate`
 * come from 12b (`media-probe-2`) and are never redefined. A recipe holds
 * instructions and source stamps only: no media bytes, grants or passwords.
 */

export type { FrameRate, TimeUs };

export const MEDIA_RECIPE_SCHEMA_VERSION = 1;
export const MEDIA_EDIT_MIME = "application/vnd.adperastra.media-edit+json";
export const MAX_MEDIA_RECIPE_BYTES = 16 * 1024 * 1024;
export const MAX_MEDIA_SOURCES = 100;
export const MAX_MEDIA_SEGMENTS = 10_000;
export const MAX_MEDIA_SUBTITLE_CUES = 100_000;
export const MAX_MEDIA_SUBTITLE_BYTES = 4 * 1024 * 1024;
export const MAX_MEDIA_SUBTITLE_TEXT = 8_192;
export const MAX_MEDIA_PATH_UNITS = 32_768;
/** Same 24-hour ceiling as 12b `MEDIA_MAX_DURATION_US`. */
export const MAX_MEDIA_DURATION_US = 24 * 60 * 60 * 1_000_000;
export const MIN_MEDIA_SPEED = 0.25;
export const MAX_MEDIA_SPEED = 4;
export const MAX_MEDIA_VOLUME = 4;
export const WAVEFORM_BUCKETS_PER_SECOND = 100;
export const WAVEFORM_BUCKETS_PER_PAGE = 512;
export const WAVEFORM_MAX_MINUTES = 100;
export const WAVEFORM_MAX_CHANNELS = 8;
export const MAX_MEDIA_HISTORY = 200;

export type MediaRotation = 0 | 90 | 180 | 270;
export type MediaSubtitleMode = "off" | "select" | "burn";
export type MediaPreviewQuality = "source" | "960" | "512";

export interface MediaSource {
  id: string;
  /** Absolute Windows path, at most 32,768 UTF-16 units. */
  path: string;
  stamp: SourceStamp;
  duration_us: TimeUs;
  video_rate: FrameRate | null;
  audio_rate: number | null;
  /** Always false for these CLI engines (`D7`). */
  sensitive: false;
}

export interface MediaSegment {
  id: string;
  source_id: string;
  start_us: TimeUs;
  end_us: TimeUs;
  speed: number;
}

/** Integer source-pixel rectangle after container orientation (`D3`). */
export interface MediaCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaSubtitleCue {
  id: string;
  start_us: TimeUs;
  end_us: TimeUs;
  text: string;
}

export interface MediaRecipe {
  schema_version: 1;
  project_id: string;
  content_id: string;
  sources: MediaSource[];
  segments: MediaSegment[];
  crop: MediaCrop | null;
  rotation: MediaRotation;
  volume: number;
  mute: boolean;
  keep_pitch: boolean;
  subtitles: MediaSubtitleCue[];
  subtitle_mode: MediaSubtitleMode;
  metadata_keep: boolean;
}

export type MediaEditOperation =
  | { kind: "set_segments"; segments: MediaSegment[] }
  | { kind: "set_crop"; crop: MediaCrop | null }
  | { kind: "set_rotation"; rotation: MediaRotation }
  | { kind: "set_speed"; segment_id: string; speed: number }
  | { kind: "set_gain"; volume: number; mute: boolean }
  | { kind: "set_keep_pitch"; keep_pitch: boolean }
  | { kind: "relink_source"; source_id: string; replacement: MediaSource }
  | { kind: "set_subtitles"; cues: MediaSubtitleCue[]; mode: MediaSubtitleMode };

export interface WavePeak {
  min: number;
  max: number;
}

export interface WavePage {
  source_id: string;
  channel: number;
  first_bucket: number;
  buckets: WavePeak[];
  total_buckets: number;
}

export type MediaEditErrorCode =
  | "media_edit.bad_request"
  | "media_edit.missing_source"
  | "media_edit.changed"
  | "media_edit.unsupported"
  | "media_edit.too_large"
  | "media_edit.read_only"
  | "media_edit.failed";

const MEDIA_EDIT_ERROR_CODES: readonly string[] = [
  "media_edit.bad_request",
  "media_edit.missing_source",
  "media_edit.changed",
  "media_edit.unsupported",
  "media_edit.too_large",
  "media_edit.read_only",
  "media_edit.failed",
];

export function mediaEditFail(code: MediaEditErrorCode = "media_edit.bad_request"): never {
  throw new Error(code);
}

/**
 * The stable code a view may show. A native or browser message never becomes
 * user-visible detail (`plan/conventions.md` error rule): anything unknown is
 * reported as the one translated media-edit failure.
 */
export function mediaErrorCode(error: unknown): MediaEditErrorCode {
  const message = error instanceof Error ? error.message : "";
  return MEDIA_EDIT_ERROR_CODES.includes(message)
    ? (message as MediaEditErrorCode)
    : "media_edit.failed";
}

/** A cancelled job is not an edit failure and gets no error banner. */
export function isMediaCancellation(error: unknown): boolean {
  return error instanceof Error && (error.message === "engines.cancelled" || error.message === "jobs.cancelled");
}

export function isMediaFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isMediaSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isMediaUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

let fallbackId = 0;

export function newMediaId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  fallbackId += 1;
  return `00000000-0000-4000-8000-${String(fallbackId).padStart(12, "0")}`;
}

/** Deterministic UUID-shaped id for imported cues (`E6`). */
export function deterministicMediaId(namespace: string, index: number): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  const text = `${namespace}#${index}`;
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + 0x9e37), 0x85ebca6b) >>> 0;
  }
  const a = first.toString(16).padStart(8, "0");
  const b = second.toString(16).padStart(8, "0");
  const c = ((first ^ 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
  const d = ((second ^ 0x7f4a7c15) >>> 0).toString(16).padStart(8, "0");
  return `${a}-${b.slice(0, 4)}-5${b.slice(5)}-${c.slice(0, 4)}-${d}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isAbsoluteWindowsPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_MEDIA_PATH_UNITS || /[\u0000-\u001f]/.test(value)) return false;
  if (!/^(?:[A-Za-z]:\\|\\\\)/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

export function validateSourceStamp(value: unknown): SourceStamp {
  if (!isRecord(value)) mediaEditFail("media_edit.bad_request");
  const { path_key, volume_id, file_id, modified_ticks, size_bytes } = value;
  if (typeof path_key !== "string" || !isAbsoluteWindowsPath(path_key)) mediaEditFail("media_edit.bad_request");
  if (typeof volume_id !== "string" || !/^[0-9a-f]{8}$/i.test(volume_id)) mediaEditFail("media_edit.bad_request");
  if (typeof file_id !== "string" || !/^[0-9a-f]{16}$/i.test(file_id)) mediaEditFail("media_edit.bad_request");
  if (typeof modified_ticks !== "string" || !/^\d{1,20}$/.test(modified_ticks)) mediaEditFail("media_edit.bad_request");
  if (!isMediaSafeInteger(size_bytes)) mediaEditFail("media_edit.too_large");
  return { path_key, volume_id, file_id, modified_ticks, size_bytes };
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

function validateFrameRate(value: unknown): FrameRate {
  if (!isRecord(value)) mediaEditFail("media_edit.bad_request");
  const { num, den } = value;
  if (
    typeof num !== "number" || typeof den !== "number" || !Number.isInteger(num) || !Number.isInteger(den) ||
    num < 1 || den < 1 || den > 100_000 ||
    greatestCommonDivisor(num, den) !== 1
  ) {
    // The native mirror only accepts the reduced form, so a recipe saved
    // here can always be exported and imported by 19a unchanged.
    mediaEditFail("media_edit.bad_request");
  }
  return { num, den };
}

function validateSource(value: unknown): MediaSource {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "path", "stamp", "duration_us", "video_rate", "audio_rate", "sensitive"])
  ) {
    mediaEditFail("media_edit.bad_request");
  }
  if (!isMediaUuid(value.id) || !isAbsoluteWindowsPath(value.path)) mediaEditFail("media_edit.bad_request");
  const stamp = validateSourceStamp(value.stamp);
  if (!isMediaSafeInteger(value.duration_us) || value.duration_us < 1) mediaEditFail("media_edit.bad_request");
  if (value.duration_us > MAX_MEDIA_DURATION_US) mediaEditFail("media_edit.too_large");
  const video_rate = value.video_rate === null ? null : validateFrameRate(value.video_rate);
  let audio_rate: number | null = null;
  if (value.audio_rate !== null) {
    if (
      typeof value.audio_rate !== "number" || !Number.isInteger(value.audio_rate) ||
      value.audio_rate < 1 || value.audio_rate > 1_000_000
    ) {
      mediaEditFail("media_edit.bad_request");
    }
    audio_rate = value.audio_rate;
  }
  if (value.sensitive !== false) mediaEditFail("media_edit.unsupported");
  return {
    id: value.id,
    path: value.path,
    stamp,
    duration_us: value.duration_us as number,
    video_rate,
    audio_rate,
    sensitive: false,
  };
}

function validateSegment(value: unknown, durations: Map<string, number>): MediaSegment {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "source_id", "start_us", "end_us", "speed"])) {
    mediaEditFail("media_edit.bad_request");
  }
  if (!isMediaUuid(value.id) || !isMediaUuid(value.source_id)) mediaEditFail("media_edit.bad_request");
  if (!durations.has(value.source_id)) mediaEditFail("media_edit.missing_source");
  if (!isMediaSafeInteger(value.start_us) || !isMediaSafeInteger(value.end_us)) mediaEditFail("media_edit.bad_request");
  if (value.end_us <= value.start_us || value.end_us > (durations.get(value.source_id) ?? 0)) {
    mediaEditFail("media_edit.bad_request");
  }
  if (!isMediaFinite(value.speed) || value.speed < MIN_MEDIA_SPEED || value.speed > MAX_MEDIA_SPEED) {
    mediaEditFail("media_edit.bad_request");
  }
  if (Math.round(((value.end_us as number) - (value.start_us as number)) / value.speed) < 1) {
    mediaEditFail("media_edit.bad_request");
  }
  return {
    id: value.id,
    source_id: value.source_id,
    start_us: value.start_us as number,
    end_us: value.end_us as number,
    speed: value.speed as number,
  };
}

function validateSegmentList(value: unknown, durations: Map<string, number>): MediaSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEDIA_SEGMENTS) mediaEditFail("media_edit.bad_request");
  const segments = value.map((segment) => validateSegment(segment, durations));
  const ids = new Set<string>();
  let previousEnd = -1;
  for (const segment of segments) {
    if (ids.has(segment.id)) mediaEditFail("media_edit.bad_request");
    ids.add(segment.id);
    if (segment.start_us < previousEnd) mediaEditFail("media_edit.bad_request");
    previousEnd = segment.end_us;
  }
  return segments;
}

export function validateMediaCrop(crop: MediaCrop): MediaCrop {
  if (!isRecord(crop)) mediaEditFail("media_edit.bad_request");
  for (const field of ["x", "y", "width", "height"] as const) {
    if (!Number.isInteger(crop[field]) || crop[field] < (field === "x" || field === "y" ? 0 : 1)) {
      mediaEditFail("media_edit.bad_request");
    }
  }
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

/** The source size after container orientation is applied (`D3`). */
export function orientedSourceSize(width: number, height: number, rotation: MediaRotation): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    mediaEditFail("media_edit.bad_request");
  }
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

export function assertMediaCropWithin(crop: MediaCrop, sourceWidth: number, sourceHeight: number, rotation: MediaRotation): void {
  const checked = validateMediaCrop(crop);
  const size = orientedSourceSize(sourceWidth, sourceHeight, rotation);
  if (checked.x + checked.width > size.width || checked.y + checked.height > size.height) {
    mediaEditFail("media_edit.bad_request");
  }
}

function validateCues(value: unknown): MediaSubtitleCue[] {
  if (!Array.isArray(value) || value.length > MAX_MEDIA_SUBTITLE_CUES) mediaEditFail("media_edit.too_large");
  const cues: MediaSubtitleCue[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ["id", "start_us", "end_us", "text"])) mediaEditFail("media_edit.bad_request");
    if (!isMediaUuid(item.id) || ids.has(item.id)) mediaEditFail("media_edit.bad_request");
    ids.add(item.id);
    if (!isMediaSafeInteger(item.start_us) || !isMediaSafeInteger(item.end_us) || item.end_us <= item.start_us) {
      mediaEditFail("media_edit.bad_request");
    }
    if (typeof item.text !== "string" || Array.from(item.text).length > MAX_MEDIA_SUBTITLE_TEXT) {
      mediaEditFail("media_edit.bad_request");
    }
    bytes += new TextEncoder().encode(item.text).byteLength;
    if (bytes > MAX_MEDIA_SUBTITLE_BYTES) mediaEditFail("media_edit.too_large");
    cues.push({
      id: item.id,
      start_us: item.start_us as number,
      end_us: item.end_us as number,
      text: item.text as string,
    });
  }
  return cues.sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
}

export function validateMediaRecipe(value: unknown): MediaRecipe {
  if (!isRecord(value)) mediaEditFail("media_edit.bad_request");
  if (
    !hasOnlyKeys(value, [
      "schema_version", "project_id", "content_id", "sources", "segments", "crop", "rotation",
      "volume", "mute", "keep_pitch", "subtitles", "subtitle_mode", "metadata_keep",
    ])
  ) {
    mediaEditFail("media_edit.bad_request");
  }
  if (value.schema_version !== MEDIA_RECIPE_SCHEMA_VERSION) mediaEditFail("media_edit.unsupported");
  if (!isMediaUuid(value.project_id) || !isMediaUuid(value.content_id)) mediaEditFail("media_edit.bad_request");
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > MAX_MEDIA_SOURCES) {
    mediaEditFail("media_edit.bad_request");
  }
  const sources = value.sources.map(validateSource);
  const durations = new Map<string, number>();
  const paths = new Set<string>();
  for (const source of sources) {
    if (durations.has(source.id)) mediaEditFail("media_edit.bad_request");
    durations.set(source.id, source.duration_us);
    const pathKey = source.path.toLowerCase();
    if (paths.has(pathKey)) mediaEditFail("media_edit.bad_request");
    paths.add(pathKey);
  }
  const segments = validateSegmentList(value.segments, durations);
  const crop = value.crop === null ? null : validateMediaCrop(value.crop as MediaCrop);
  if (![0, 90, 180, 270].includes(value.rotation as number)) mediaEditFail("media_edit.bad_request");
  if (!isMediaFinite(value.volume) || value.volume < 0 || value.volume > MAX_MEDIA_VOLUME) mediaEditFail("media_edit.bad_request");
  for (const field of ["mute", "keep_pitch", "metadata_keep"] as const) {
    if (typeof value[field] !== "boolean") mediaEditFail("media_edit.bad_request");
  }
  if (!["off", "select", "burn"].includes(value.subtitle_mode as string)) mediaEditFail("media_edit.bad_request");
  const subtitle_mode = value.subtitle_mode as MediaSubtitleMode;
  const subtitles = validateCues(value.subtitles);
  if (subtitle_mode !== "off" && subtitles.length === 0) mediaEditFail("media_edit.bad_request");
  return {
    schema_version: 1, project_id: value.project_id, content_id: value.content_id, sources, segments, crop,
    rotation: value.rotation as MediaRotation, volume: value.volume as number, mute: value.mute as boolean,
    keep_pitch: value.keep_pitch as boolean, subtitles, subtitle_mode,
    metadata_keep: value.metadata_keep as boolean,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function cloneMediaRecipe(recipe: MediaRecipe): MediaRecipe {
  return structuredClone(recipe);
}

export function freezeMediaRecipe(recipe: MediaRecipe): Readonly<MediaRecipe> {
  return deepFreeze(cloneMediaRecipe(recipe)) as Readonly<MediaRecipe>;
}

export function mediaRecipeJson(recipe: MediaRecipe): string {
  return JSON.stringify(validateMediaRecipe(recipe));
}

export function mediaRecipeBytes(recipe: MediaRecipe): Uint8Array {
  const bytes = new TextEncoder().encode(mediaRecipeJson(recipe));
  if (bytes.byteLength > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
  return bytes;
}

export function decodeMediaRecipe(value: string | Uint8Array): MediaRecipe {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    if (value.byteLength > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      mediaEditFail("media_edit.bad_request");
    }
  }
  if (new TextEncoder().encode(text).byteLength > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    mediaEditFail("media_edit.bad_request");
  }
  return validateMediaRecipe(parsed);
}

export function newMediaRecipe(projectId: string, contentId: string, source: MediaSource): MediaRecipe {
  return validateMediaRecipe({
    schema_version: MEDIA_RECIPE_SCHEMA_VERSION, project_id: projectId, content_id: contentId, sources: [source],
    segments: [{ id: newMediaId(), source_id: source.id, start_us: 0, end_us: source.duration_us, speed: 1 }],
    crop: null, rotation: 0, volume: 1, mute: false, keep_pitch: true, subtitles: [], subtitle_mode: "off",
    metadata_keep: true,
  });
}
