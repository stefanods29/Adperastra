/**
 * Engine types (Step 12b, revision `engines-2`).
 *
 * Canonical TypeScript mirror of `src-tauri/src/engine_types.rs`. Every field
 * keeps the exact snake_case name Rust serializes. Nothing here holds a
 * program path, an argument string or raw engine JSON: the native side picks
 * the executable and builds the arguments from these typed values only.
 *
 * Import these types; never redeclare them. `TimeUs`/`FrameRate` are also
 * re-exported by `services/mediaEngine.ts` for the media steps (15/19).
 */

import type {
  ConversionInput,
  FormatId,
  MetadataCategory,
  MediaConversionOptions,
  PageRange,
} from "../convert/types";
import type { CacheLease, SourceStamp } from "./cache";

/** Whole microseconds since the start of the media (D5). Never a float. */
export type TimeUs = number;

/** A reduced, positive frame rate; `den` is at most 100000. */
export interface FrameRate {
  num: number;
  den: number;
}

/** The engine a pack provides. Later steps add IDs additively. */
export type EngineId = "media" | "office";

/** Why an engine cannot be used right now (mapped from its capability). */
export type EngineUnavailableReason =
  | "packs_missing"
  | "unsafe_build"
  | "sandbox_failed"
  | "unsupported";

/** One engine capability as the native side audited it. */
export interface EngineCapability {
  /** Capability ID, at most 64 characters (`media.encode`, ...). */
  id: string;
  available: boolean;
  /** Verified engine version, at most 64 characters; empty when absent. */
  version: string;
  reason: EngineUnavailableReason | null;
}

export type MediaStreamKind = "video" | "audio" | "subtitle";

/** One stream of a media file, already bounded by the native probe. */
export interface MediaStream {
  index: number;
  kind: MediaStreamKind;
  codec: string;
  width: number | null;
  height: number | null;
  frame_rate: FrameRate | null;
  sample_rate: number | null;
  channels: number | null;
  /** BCP 47 language tag, at most 32 characters. */
  language: string | null;
}

/** One metadata tag the engine reported for a category. */
export interface MediaTag {
  key: string;
  value: string;
  category: MetadataCategory;
}

/**
 * A disk file the user asked the engine to read. Only 08a's `file` variant:
 * snapshots are refused for probe and preview because their bytes are not a
 * stable disk source with a `SourceStamp`.
 */
export interface DiskConversionInput {
  kind: "file";
  path: string;
  expected: SourceStamp | null;
}

/** Bounded result of probing one media file (D4). */
export interface MediaInfo {
  source: SourceStamp;
  duration_us: TimeUs;
  streams: MediaStream[];
  tags: MediaTag[];
  format: string;
}

/**
 * A leased cache sample of at most three seconds. The lease is the only way
 * the UI reads the bytes (07a E3); no executable URL is handed out.
 */
export interface MediaPreview {
  lease: CacheLease;
  duration_us: TimeUs;
  mime: string;
  /** 1 for these disk-only previews: they never come from a draft snapshot. */
  source_revision: number;
}

/** Formats the one-shot Office renderer accepts (canonical definition). */
export type OfficeFormat =
  | "docx"
  | "xlsx"
  | "pptx"
  | "odt"
  | "ods"
  | "odp"
  | "rtf"
  | "doc"
  | "xls"
  | "ppt"
  | "potx"
  | "otp";

/** What a one-shot Office render produces. */
export type OfficeRenderTarget = "pdf" | "html" | "txt";

/**
 * One-shot Office render request: read-only, no field can enable macros or
 * external links, and no destination path is accepted.
 */
export interface OfficeRenderRequest {
  input: ConversionInput;
  target: OfficeRenderTarget;
  format: OfficeFormat;
  include_comments: boolean;
  include_notes: boolean;
  ranges: PageRange[];
}

/** The Office formats the renderer advertises; templates stay unadvertised. */
export const OFFICE_RENDER_FORMATS: readonly OfficeFormat[] = [
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "doc",
  "xls",
  "ppt",
];

/** Template containers are inspection inputs only (22a/22b), never rendered. */
export const OFFICE_TEMPLATE_FORMATS: readonly OfficeFormat[] = ["potx", "otp"];

/** The extension each Office format carries, without the leading dot. */
export function officeFormatExtension(format: OfficeFormat): string {
  return format;
}

/** True when `value` is a known Office container ID. */
export function isOfficeFormat(value: string): value is OfficeFormat {
  return (
    OFFICE_RENDER_FORMATS.includes(value as OfficeFormat) ||
    OFFICE_TEMPLATE_FORMATS.includes(value as OfficeFormat)
  );
}

/** True when the format may be offered to the read-only renderer. */
export function isRenderableOfficeFormat(format: OfficeFormat): boolean {
  return OFFICE_RENDER_FORMATS.includes(format);
}

/** The converter IDs this step registers (D6). */
export const MEDIA_CONVERTER_IDS = [
  "media/video",
  "media/audio",
  "media/gif",
] as const;

export type MediaConverterId = (typeof MEDIA_CONVERTER_IDS)[number];

/** The Office converter IDs this step registers (D6). */
export const OFFICE_CONVERTER_IDS = [
  "office/pdf",
  "office/html",
  "office/txt",
  "office/md",
  "document/docx",
] as const;

export type OfficeConverterId = (typeof OFFICE_CONVERTER_IDS)[number];

/** Output formats the media engines can produce in this round (D6). */
export const MEDIA_OUTPUT_FORMATS: readonly FormatId[] = [
  "webm",
  "mp4",
  "mkv",
  "mov",
  "gif",
  "mp3",
  "opus",
  "ogg",
  "flac",
  "wav",
  "aac",
];

/** Output formats the Office renderer writes. */
export const OFFICE_OUTPUT_FORMATS: readonly OfficeRenderTarget[] = [
  "pdf",
  "html",
  "txt",
];

/** True when `format` is a media container this step can write. */
export function isMediaOutputFormat(format: FormatId): boolean {
  return MEDIA_OUTPUT_FORMATS.includes(format);
}

/** True when `format` is an Office render target. */
export function isOfficeOutputFormat(format: string): format is OfficeRenderTarget {
  return (OFFICE_OUTPUT_FORMATS as readonly string[]).includes(format);
}

/**
 * The default media options a dialog starts from. Metadata stays by default
 * (D6) and no time range is selected.
 */
export function defaultMediaOptions(): MediaConversionOptions {
  return {
    start_ms: null,
    end_ms: null,
    width: null,
    height: null,
    video_codec: "auto",
    audio_codec: "auto",
    bitrate_kbps: null,
    sample_rate: null,
    keep_metadata: true,
    burn_subtitles: false,
    speed: 1,
    volume: 1,
  };
}

/** True when both ends of an optional microsecond range are consistent. */
export function validTimeRange(start_Us: TimeUs | null, end_Us: TimeUs | null): boolean {
  if (start_Us !== null && (!Number.isSafeInteger(start_Us) || start_Us < 0)) return false;
  if (end_Us !== null && (!Number.isSafeInteger(end_Us) || end_Us < 0)) return false;
  if (start_Us !== null && end_Us !== null && end_Us <= start_Us) return false;
  return true;
}

/** Reduce a numerator/denominator pair the same way the native side does. */
export function reduceFrameRate(num: number, den: number): FrameRate | null {
  if (!Number.isInteger(num) || !Number.isInteger(den)) return null;
  if (num <= 0 || den <= 0 || num > 0xffff_ffff || den > 100_000) return null;
  const divisor = (left: number, right: number): number =>
    right === 0 ? left : divisor(right, left % right);
  const common = divisor(num, den);
  return { num: num / common, den: den / common };
}
