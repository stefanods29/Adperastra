import type { ExtraViewPage, SubtitleCue } from "../services/extraViews";
import { subtitleCues } from "../services/extraViews";
import type { MediaSubtitleCue } from "./types";
import {
  MAX_MEDIA_SUBTITLE_BYTES,
  MAX_MEDIA_SUBTITLE_CUES,
  MAX_MEDIA_SUBTITLE_TEXT,
  deterministicMediaId,
  mediaEditFail,
} from "./types";
import { formatTimeUs } from "./timing";

/**
 * Imports cues from the 07f subtitle session (`E6`, `D4`).
 *
 * 07f reports integer milliseconds; this module multiplies each value into
 * checked microseconds exactly once. Zero-length cues are reported in
 * `invalid_indices` instead of being burned as invisible zero-duration text.
 * Only an already authorized 07f session is read; no path is ever supplied
 * here.
 */

export interface ImportedMediaSubtitles {
  cues: MediaSubtitleCue[];
  next_cursor: string | null;
  invalid_indices: number[];
}

/** One cue whose time cannot fit the recipe; the reason stays internal. */
class CueTooLarge extends Error {}

function millisecondsToMicroseconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    mediaEditFail("media_edit.bad_request");
  }
  const micros = BigInt(value) * 1000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CueTooLarge("media_edit.too_large");
  }
  return Number(micros);
}

function castCues(page: ExtraViewPage): SubtitleCue[] {
  const payload = page.payload as unknown as { kind?: string; cues?: SubtitleCue[] };
  if (
    page.kind !== "subtitle" ||
    !payload ||
    (payload.kind !== undefined && payload.kind !== "subtitle") ||
    !Array.isArray(payload.cues)
  ) {
    mediaEditFail("media_edit.bad_request");
  }
  return payload.cues;
}

/** Imports one page of cues; the caller follows `next_cursor` for more. */
export async function importMediaSubtitles(
  sessionId: string,
  cursor?: string,
): Promise<ImportedMediaSubtitles> {
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 128) {
    mediaEditFail("media_edit.bad_request");
  }
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 128)) {
    mediaEditFail("media_edit.bad_request");
  }
  const page = await subtitleCues(sessionId, cursor);
  const sourceCues = castCues(page);
  const cues: MediaSubtitleCue[] = [];
  const invalid: number[] = [];
  let bytes = 0;
  for (const cue of sourceCues) {
    if (!cue || typeof cue !== "object") mediaEditFail("media_edit.bad_request");
    if (!Number.isSafeInteger(cue.index) || cue.index < 0) mediaEditFail("media_edit.bad_request");
    let start: number;
    let end: number;
    try {
      start = millisecondsToMicroseconds(cue.start_ms);
      end = millisecondsToMicroseconds(cue.end_ms);
    } catch (error) {
      if (error instanceof CueTooLarge) {
        invalid.push(cue.index);
        continue;
      }
      throw error;
    }
    if (end <= start) {
      invalid.push(cue.index);
      continue;
    }
    if (typeof cue.text !== "string" || Array.from(cue.text).length > MAX_MEDIA_SUBTITLE_TEXT) {
      invalid.push(cue.index);
      continue;
    }
    bytes += new TextEncoder().encode(cue.text).byteLength;
    if (bytes > MAX_MEDIA_SUBTITLE_BYTES) mediaEditFail("media_edit.too_large");
    cues.push({
      id: deterministicMediaId(sessionId, cue.index),
      start_us: start,
      end_us: end,
      text: cue.text,
    });
    if (cues.length > MAX_MEDIA_SUBTITLE_CUES) mediaEditFail("media_edit.too_large");
  }
  cues.sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
  return {
    cues,
    next_cursor: page.next_cursor ?? null,
    invalid_indices: invalid.sort((left, right) => left - right),
  };
}

/**
 * Imports every page of a subtitle session. The aggregate limits are the
 * same as a saved recipe, so a session cannot grow past what a recipe holds.
 */
export async function importAllMediaSubtitles(sessionId: string): Promise<ImportedMediaSubtitles> {
  const cues: MediaSubtitleCue[] = [];
  const invalid: number[] = [];
  let bytes = 0;
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = await importMediaSubtitles(sessionId, cursor);
    for (const cue of page.cues) {
      bytes += new TextEncoder().encode(cue.text).byteLength;
      if (bytes > MAX_MEDIA_SUBTITLE_BYTES || cues.length >= MAX_MEDIA_SUBTITLE_CUES) {
        mediaEditFail("media_edit.too_large");
      }
      cues.push(cue);
    }
    invalid.push(...page.invalid_indices);
    if (page.next_cursor === null) {
      cues.sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
      return { cues, next_cursor: null, invalid_indices: invalid.sort((left, right) => left - right) };
    }
    cursor = page.next_cursor;
  }
  mediaEditFail("media_edit.too_large");
}

/**
 * A WebVTT preview of the recipe's cues (`D4`). This is display only:
 * export/burn still uses the typed recipe times and text. Cue text never
 * becomes a filter string or executable markup.
 */
export function cuesToVtt(cues: readonly MediaSubtitleCue[]): string {
  const lines = ["WEBVTT", ""];
  for (const cue of cues) {
    const text = cue.text.replace(/-->/g, "->");
    lines.push(`${formatTimeUs(cue.start_us)} --> ${formatTimeUs(cue.end_us)}`, text, "");
  }
  return lines.join("\n");
}

/** The exact cue times a burned subtitle frame uses; never milliseconds. */
export function cueRangeUs(cue: MediaSubtitleCue): { start_us: number; end_us: number } {
  if (!Number.isSafeInteger(cue.start_us) || !Number.isSafeInteger(cue.end_us) || cue.end_us <= cue.start_us) {
    mediaEditFail("media_edit.bad_request");
  }
  return { start_us: cue.start_us, end_us: cue.end_us };
}
