import type { MediaRecipe, MediaSegment, MediaSource, TimeUs } from "./types";
import {
  MAX_MEDIA_SPEED,
  MAX_MEDIA_VOLUME,
  MIN_MEDIA_SPEED,
  isMediaFinite,
  isMediaSafeInteger,
  mediaEditFail,
  newMediaId,
  validateMediaRecipe,
} from "./types";

/**
 * Exact media timing (`media-time-1`).
 *
 * Every value is an integer microsecond. A segment's output length is
 * round((end - start) / speed), computed with integer arithmetic so a range
 * never passes through a rounded floating millisecond. Intervals are
 * start-inclusive and end-exclusive (`D2`).
 */

const MICROS = 1_000_000n;

function speedMicros(speed: number): number {
  if (!isMediaFinite(speed) || speed < MIN_MEDIA_SPEED || speed > MAX_MEDIA_SPEED) {
    mediaEditFail("media_edit.bad_request");
  }
  const micros = Math.round(speed * 1_000_000);
  if (micros < 1 || Math.abs(micros - speed * 1_000_000) > 1e-6) {
    // More than six decimal places cannot be represented exactly; the UI
    // only offers 0.25 steps, so this is a malformed request.
    mediaEditFail("media_edit.bad_request");
  }
  return micros;
}

function toSafeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) mediaEditFail("media_edit.too_large");
  return Number(value);
}

/** round((end - start) / speed) in output microseconds. */
export function segmentOutputDurationUs(segment: Pick<MediaSegment, "start_us" | "end_us" | "speed">): TimeUs {
  if (!isMediaSafeInteger(segment.start_us) || !isMediaSafeInteger(segment.end_us)) {
    mediaEditFail("media_edit.bad_request");
  }
  if (segment.end_us <= segment.start_us) mediaEditFail("media_edit.bad_request");
  const micros = BigInt(speedMicros(segment.speed));
  const span = BigInt(segment.end_us - segment.start_us) * MICROS;
  // Round half up, exactly as the native checked 128-bit arithmetic does.
  return toSafeNumber((span + micros / 2n) / micros);
}

/** Total playable duration of a recipe. */
export function mediaRecipeDurationUs(recipe: Pick<MediaRecipe, "segments">): TimeUs {
  let total = 0;
  for (const segment of recipe.segments) {
    total += segmentOutputDurationUs(segment);
    if (!Number.isSafeInteger(total)) mediaEditFail("media_edit.too_large");
  }
  return total;
}

/** Output start of each segment, in recipe order. */
export function segmentOutputStarts(recipe: Pick<MediaRecipe, "segments">): TimeUs[] {
  const starts: TimeUs[] = [];
  let total = 0;
  for (const segment of recipe.segments) {
    starts.push(total);
    total += segmentOutputDurationUs(segment);
    if (!Number.isSafeInteger(total)) mediaEditFail("media_edit.too_large");
  }
  return starts;
}

function sourceOf(recipe: MediaRecipe, segment: MediaSegment): MediaSource {
  const source = recipe.sources.find((candidate) => candidate.id === segment.source_id);
  if (!source) mediaEditFail("media_edit.missing_source");
  return source;
}

/**
 * Maps an output playhead to its source position (`E5`).
 *
 * The search is a binary search over cumulative output intervals. The final
 * instant is clamped to the last playable sample; time after the recipe ends
 * is clamped to the end so a player cannot read outside the source.
 */
export function outputToSource(
  recipe: MediaRecipe,
  outputUs: TimeUs,
): { segment_id: string; source_us: TimeUs } {
  if (!isMediaSafeInteger(outputUs)) mediaEditFail("media_edit.bad_request");
  if (!Array.isArray(recipe.segments) || recipe.segments.length === 0) {
    mediaEditFail("media_edit.bad_request");
  }
  const starts = segmentOutputStarts(recipe);
  const total = mediaRecipeDurationUs(recipe);
  const clamped = Math.min(outputUs, total);
  if (total === 0) mediaEditFail("media_edit.bad_request");

  let low = 0;
  let high = recipe.segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= clamped) low = middle;
    else high = middle - 1;
  }
  const segment = recipe.segments[low];
  const duration = segmentOutputDurationUs(segment);
  const offset = Math.min(Math.max(0, clamped - starts[low]), duration);
  const micros = BigInt(speedMicros(segment.speed));
  const sourceOffset = (BigInt(offset) * micros + MICROS / 2n) / MICROS;
  let sourceUs = segment.start_us + toSafeNumber(sourceOffset);
  // The source end is exclusive: the last playable sample is end - 1.
  const lastSample = Math.max(segment.start_us, segment.end_us - 1);
  sourceUs = Math.min(sourceUs, lastSample);
  return { segment_id: segment.id, source_us: sourceUs };
}

/** Output position of a source instant inside one segment. */
export function sourceToOutput(recipe: MediaRecipe, segmentId: string, sourceUs: TimeUs): TimeUs {
  if (!isMediaSafeInteger(sourceUs)) mediaEditFail("media_edit.bad_request");
  const starts = segmentOutputStarts(recipe);
  const index = recipe.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) mediaEditFail("media_edit.bad_request");
  const segment = recipe.segments[index];
  if (sourceUs < segment.start_us || sourceUs >= segment.end_us) {
    mediaEditFail("media_edit.bad_request");
  }
  const micros = BigInt(speedMicros(segment.speed));
  const span = BigInt(sourceUs - segment.start_us) * MICROS;
  return starts[index] + toSafeNumber((span + micros / 2n) / micros);
}

/** The next segment boundary at or after a source instant, for gap jumps. */
export function nextSegmentStartAfter(
  recipe: MediaRecipe,
  sourceUs: TimeUs,
): { segment_id: string; source_us: TimeUs; output_us: TimeUs } | null {
  const starts = segmentOutputStarts(recipe);
  for (let index = 0; index < recipe.segments.length; index += 1) {
    const segment = recipe.segments[index];
    if (sourceUs < segment.start_us) {
      return { segment_id: segment.id, source_us: segment.start_us, output_us: starts[index] };
    }
    if (sourceUs < segment.end_us) {
      return { segment_id: segment.id, source_us: sourceUs, output_us: sourceToOutput(recipe, segment.id, sourceUs) };
    }
  }
  return null;
}

function sortSegments(segments: MediaSegment[]): MediaSegment[] {
  return [...segments].sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
}

/** Trim to an output-independent source range; keeps overlapping spans. */
export function trimSegments(
  recipe: Pick<MediaRecipe, "segments">,
  startUs: TimeUs,
  endUs: TimeUs,
): MediaSegment[] {
  if (!isMediaSafeInteger(startUs) || !isMediaSafeInteger(endUs) || endUs <= startUs) {
    mediaEditFail("media_edit.bad_request");
  }
  const result: MediaSegment[] = [];
  for (const segment of recipe.segments) {
    const from = Math.max(segment.start_us, startUs);
    const to = Math.min(segment.end_us, endUs);
    if (to <= from) continue;
    result.push({
      ...segment,
      start_us: from,
      end_us: to,
      id: from === segment.start_us ? segment.id : newMediaId(),
    });
  }
  if (result.length === 0) mediaEditFail("media_edit.bad_request");
  return sortSegments(result);
}

/**
 * Cut selection (`D2`): remove the range and join the remaining parts.
 * A segment split in two keeps its left id and receives a new right id.
 */
export function removeRange(
  recipe: Pick<MediaRecipe, "segments">,
  startUs: TimeUs,
  endUs: TimeUs,
): MediaSegment[] {
  if (!isMediaSafeInteger(startUs) || !isMediaSafeInteger(endUs) || endUs <= startUs) {
    mediaEditFail("media_edit.bad_request");
  }
  const result: MediaSegment[] = [];
  for (const segment of recipe.segments) {
    if (segment.end_us <= startUs || segment.start_us >= endUs) {
      result.push({ ...segment });
      continue;
    }
    if (segment.start_us < startUs) {
      result.push({ ...segment, end_us: startUs });
    }
    if (segment.end_us > endUs) {
      result.push({
        ...segment,
        id: segment.start_us < startUs ? newMediaId() : segment.id,
        start_us: endUs,
      });
    }
  }
  if (result.length === 0) mediaEditFail("media_edit.bad_request");
  return sortSegments(result);
}

/** Split at playhead; a boundary or outside position is a no-op (`D2`). */
export function splitSegments(
  recipe: Pick<MediaRecipe, "segments">,
  atUs: TimeUs,
): MediaSegment[] {
  if (!isMediaSafeInteger(atUs)) mediaEditFail("media_edit.bad_request");
  const result: MediaSegment[] = [];
  for (const segment of recipe.segments) {
    if (atUs > segment.start_us && atUs < segment.end_us) {
      result.push({ ...segment, end_us: atUs });
      result.push({ ...segment, id: newMediaId(), start_us: atUs });
    } else {
      result.push({ ...segment });
    }
  }
  return sortSegments(result);
}

/** Change one segment's speed, validating the exact bound. */
export function setSegmentSpeed(
  segments: readonly MediaSegment[],
  segmentId: string,
  speed: number,
): MediaSegment[] {
  speedMicros(speed);
  if (!segments.some((segment) => segment.id === segmentId)) mediaEditFail("media_edit.bad_request");
  return segments.map((segment) => (segment.id === segmentId ? { ...segment, speed } : { ...segment }));
}

/** Clamp a source instant to a recipe's playable source spans. */
export function clampSourceTime(recipe: MediaRecipe, sourceUs: TimeUs): TimeUs {
  if (!isMediaSafeInteger(sourceUs)) mediaEditFail("media_edit.bad_request");
  const next = nextSegmentStartAfter(recipe, sourceUs);
  return next ? next.source_us : sourceUs;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `HH:MM:SS.mmm` from integer microseconds. */
export function formatTimeUs(value: TimeUs): string {
  if (!isMediaSafeInteger(value)) mediaEditFail("media_edit.bad_request");
  const total = Math.floor(value / 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/**
 * Parse `HH:MM:SS.mmm`, `MM:SS.mmm` or `SS.mmm` into exact microseconds.
 * Fractional seconds accept one to six digits; no floating point is used.
 */
export function parseTimeUs(text: string): TimeUs {
  const trimmed = text.trim();
  const parts = trimmed.split(":");
  if (parts.length < 1 || parts.length > 3) mediaEditFail("media_edit.bad_request");
  const secondsMatch = /^(\d{1,2})(?:\.(\d{1,6}))?$/.exec(parts[parts.length - 1] ?? "");
  if (!secondsMatch) mediaEditFail("media_edit.bad_request");
  const seconds = Number(secondsMatch[1]);
  if (seconds > 59) mediaEditFail("media_edit.bad_request");
  let hours = 0;
  let minutes = 0;
  if (parts.length === 3) {
    if (!/^\d{1,4}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) mediaEditFail("media_edit.bad_request");
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
  } else if (parts.length === 2) {
    if (!/^\d{1,4}$/.test(parts[0])) mediaEditFail("media_edit.bad_request");
    minutes = Number(parts[0]);
  }
  if (minutes > 59) mediaEditFail("media_edit.bad_request");
  const fractionText = (secondsMatch[2] ?? "").padEnd(6, "0");
  const micros = Number(fractionText) || 0;
  const total =
    BigInt(hours) * 3_600_000_000n +
    BigInt(minutes) * 60_000_000n +
    BigInt(seconds) * 1_000_000n +
    BigInt(micros);
  return toSafeNumber(total);
}

/** Move a time by `deltaUs`, clamped to 0..duration (keyboard ranges). */
export function nudgeTimeUs(value: TimeUs, deltaUs: number, durationUs: TimeUs): TimeUs {
  if (!isMediaSafeInteger(value) || !Number.isInteger(deltaUs) || !isMediaSafeInteger(durationUs)) {
    mediaEditFail("media_edit.bad_request");
  }
  return Math.min(durationUs, Math.max(0, value + deltaUs));
}

/** Validate the gain fields shared by preview and export. */
export function validateGain(volume: number, mute: boolean): void {
  if (!isMediaFinite(volume) || volume < 0 || volume > MAX_MEDIA_VOLUME || typeof mute !== "boolean") {
    mediaEditFail("media_edit.bad_request");
  }
}

/** The recipe with a segment list, preserving every other decision. */
export function withSegments(recipe: MediaRecipe, segments: MediaSegment[]): MediaRecipe {
  return validateMediaRecipe({ ...recipe, segments, content_id: recipe.content_id });
}

/** The recipe with one source replaced, preserving all edit ranges. */
export function withRelinkedSource(
  recipe: MediaRecipe,
  sourceId: string,
  replacement: MediaSource,
): MediaRecipe {
  if (!recipe.sources.some((source) => source.id === sourceId)) mediaEditFail("media_edit.missing_source");
  const next = {
    ...recipe,
    sources: recipe.sources.map((source) => (source.id === sourceId ? { ...replacement, id: sourceId } : source)),
  };
  return validateMediaRecipe(next);
}

/** The source a segment points at; throws `media_edit.missing_source`. */
export function segmentSource(recipe: MediaRecipe, segment: MediaSegment): MediaSource {
  return sourceOf(recipe, segment);
}
