/**
 * Exact timeline timing (Step 19a E6, decisions D2).
 *
 * Frame k occurs at `floor(k * 1_000_000 * rate.den / rate.num)` microseconds.
 * A clip's timeline duration is
 * `ceil((source_out - source_in) * speed.den / speed.num)`.
 * All arithmetic runs in checked `BigInt` intermediates and returns to a safe
 * JavaScript integer or refuses; a floating frame rate is never accumulated.
 */

import type { FrameRate, TimeUs } from "../services/mediaEngine";
import type { PlaybackRate, TimelineClip } from "./types";
import { TimelineError, defaultPlaybackRate } from "./types";

const MICROS = 1_000_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function checked(value: bigint): number {
  if (value < 0n || value > MAX_SAFE) {
    throw new TimelineError("timeline.bad_request", "unsafe integer");
  }
  return Number(value);
}

function toBig(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new TimelineError("timeline.bad_request", "unsafe integer");
  }
  return BigInt(value);
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0 ? 1 : a;
}

/** Validate a non-negative `TimeUs` value. */
export function assertTimeUs(value: number, code: "timeline.bad_request" = "timeline.bad_request"): TimeUs {
  if (!Number.isSafeInteger(value) || value < 0) throw new TimelineError(code);
  return value;
}

/** Validate and reduce a playback rate inside 0.25..4 (D2). */
export function reducePlaybackRate(num: number, den: number): PlaybackRate {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
    throw new TimelineError("timeline.bad_request", "playback rate");
  }
  const divisor = gcd(num, den);
  const reduced = { num: num / divisor, den: den / divisor };
  if (reduced.num > 4 * reduced.den || reduced.den > 4 * reduced.num) {
    throw new TimelineError("timeline.bad_request", "playback rate range");
  }
  if (reduced.num > 0xffff_ffff || reduced.den > 0xffff_ffff) {
    throw new TimelineError("timeline.bad_request", "playback rate width");
  }
  return reduced;
}

/** True when `rate` is already reduced, positive and inside 0.25..4. */
export function isPlaybackRate(rate: unknown): rate is PlaybackRate {
  if (typeof rate !== "object" || rate === null) return false;
  const candidate = rate as PlaybackRate;
  if (!Number.isSafeInteger(candidate.num) || !Number.isSafeInteger(candidate.den)) return false;
  if (candidate.num <= 0 || candidate.den <= 0) return false;
  if (candidate.num > 0xffff_ffff || candidate.den > 0xffff_ffff) return false;
  if (gcd(candidate.num, candidate.den) !== 1) return false;
  return candidate.num <= 4 * candidate.den && candidate.den <= 4 * candidate.num;
}

/** True when a frame rate is the reduced positive 12b shape. */
export function isFrameRate(rate: unknown): rate is FrameRate {
  if (typeof rate !== "object" || rate === null) return false;
  const candidate = rate as FrameRate;
  if (!Number.isSafeInteger(candidate.num) || !Number.isSafeInteger(candidate.den)) return false;
  if (candidate.num <= 0 || candidate.den <= 0 || candidate.num > 0xffff_ffff) return false;
  if (candidate.den > 100_000) return false;
  return gcd(candidate.num, candidate.den) === 1;
}

/** Exact time of frame `frame`, in microseconds (D2). */
export function frameTime(frame: number, rate: FrameRate): TimeUs {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new TimelineError("timeline.bad_request");
  if (!isFrameRate(rate)) throw new TimelineError("timeline.bad_request");
  return checked((toBig(frame) * MICROS * toBig(rate.den)) / toBig(rate.num));
}

/** The frame index containing `timelineUs`, rounded down. */
export function frameIndexAt(timelineUs: TimeUs, rate: FrameRate): number {
  assertTimeUs(timelineUs);
  if (!isFrameRate(rate)) throw new TimelineError("timeline.bad_request");
  return checked((toBig(timelineUs) * toBig(rate.num)) / (MICROS * toBig(rate.den)));
}

/** The start of the frame containing `timelineUs`. */
export function frameStartAt(timelineUs: TimeUs, rate: FrameRate): TimeUs {
  return frameTime(frameIndexAt(timelineUs, rate), rate);
}

/** The start of the next frame after `timelineUs` (exact, not accumulated). */
export function nextFrameStart(timelineUs: TimeUs, rate: FrameRate): TimeUs {
  return frameTime(frameIndexAt(timelineUs, rate) + 1, rate);
}

/** The last frame start strictly before `timelineUs`, or 0. */
export function previousFrameStart(timelineUs: TimeUs, rate: FrameRate): TimeUs {
  const index = frameIndexAt(timelineUs, rate);
  if (index === 0) return 0;
  return frameTime(index - 1, rate);
}

/** Source microseconds covered by one clip's source interval. */
export function clipSourceLengthUs(clip: TimelineClip): TimeUs {
  assertTimeUs(clip.source_in_us);
  assertTimeUs(clip.source_out_us);
  if (clip.source_out_us <= clip.source_in_us) throw new TimelineError("timeline.bad_request");
  return clip.source_out_us - clip.source_in_us;
}

/** A clip's timeline duration in microseconds (D2). */
export function clipDurationUs(clip: TimelineClip): TimeUs {
  if (!isPlaybackRate(clip.speed)) throw new TimelineError("timeline.bad_request");
  const length = toBig(clipSourceLengthUs(clip));
  const num = toBig(clip.speed.num);
  const den = toBig(clip.speed.den);
  return checked((length * den + num - 1n) / num);
}

/** One past the clip's last timeline microsecond. */
export function clipEndUs(clip: TimelineClip): TimeUs {
  assertTimeUs(clip.start_us);
  return checked(toBig(clip.start_us) + toBig(clipDurationUs(clip)));
}

/**
 * Source time shown at `timelineUs` for this clip (D2), clamped below
 * `source_out_us`. Before the clip starts the first source microsecond is used.
 */
export function clipSourceTime(clip: TimelineClip, timelineUs: TimeUs): TimeUs {
  assertTimeUs(timelineUs);
  assertTimeUs(clip.start_us);
  if (!isPlaybackRate(clip.speed)) throw new TimelineError("timeline.bad_request");
  const length = clipSourceLengthUs(clip);
  if (timelineUs <= clip.start_us) return clip.source_in_us;
  const offset = toBig(timelineUs - clip.start_us);
  const sourceOffset = (offset * toBig(clip.speed.num)) / toBig(clip.speed.den);
  const absolute = toBig(clip.source_in_us) + sourceOffset;
  const limit = toBig(clip.source_out_us);
  const clamped = absolute >= limit ? limit - 1n : absolute;
  if (clamped < toBig(clip.source_in_us)) return clip.source_in_us;
  if (clamped < 0n) return 0;
  const result = checked(clamped);
  // The clamp keeps the result inside the interval even for a one-microsecond
  // source range.
  if (result < clip.source_in_us) return clip.source_in_us;
  if (result >= clip.source_out_us) return clip.source_out_us - 1;
  return result;
}

/** Timeline microseconds produced by moving `sourceDelta` source microseconds. */
export function sourceDeltaToTimelineUs(sourceDelta: number, speed: PlaybackRate): TimeUs {
  if (!Number.isSafeInteger(sourceDelta) || sourceDelta < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!isPlaybackRate(speed)) throw new TimelineError("timeline.bad_request");
  return checked(
    (toBig(sourceDelta) * toBig(speed.den) + toBig(speed.num) - 1n) / toBig(speed.num),
  );
}

/** Source microseconds covered by a timeline delta (rounded down). */
export function timelineDeltaToSourceUs(timelineDelta: number, speed: PlaybackRate): TimeUs {
  if (!Number.isSafeInteger(timelineDelta) || timelineDelta < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!isPlaybackRate(speed)) throw new TimelineError("timeline.bad_request");
  return checked((toBig(timelineDelta) * toBig(speed.num)) / toBig(speed.den));
}

/** The 12b audio sample interval start: `ceil(us * rate / 1e6)`. */
export function sampleIndexForUs(timelineUs: TimeUs, sampleRate: number): number {
  assertTimeUs(timelineUs);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const top = toBig(timelineUs) * toBig(sampleRate);
  const bottom = MICROS;
  return checked((top + bottom - 1n) / bottom);
}

/** The ratio as a display number; never used for project arithmetic. */
export function playbackRatio(rate: PlaybackRate): number {
  if (!isPlaybackRate(rate)) throw new TimelineError("timeline.bad_request");
  return rate.num / rate.den;
}

/**
 * Convert a Step 15 segment's finite speed into the exact reduced rational.
 * The allowed 0.25..4 range is checked here so an imported recipe cannot
 * smuggle an out-of-range speed into the project.
 */
export function playbackRateFromNumber(speed: number): PlaybackRate {
  if (typeof speed !== "number" || !Number.isFinite(speed)) {
    throw new TimelineError("timeline.bad_request", "speed");
  }
  if (speed < 0.25 - 1e-12 || speed > 4 + 1e-12) {
    throw new TimelineError("timeline.bad_request", "speed range");
  }
  const numerators = [1, 2, 3, 4, 5, 8, 10, 16, 25, 50, 100, 1000, 10_000, 1_000_000];
  for (const den of numerators) {
    const num = Math.round(speed * den);
    if (num > 0 && Math.abs(speed - num / den) <= 1e-12) {
      return reducePlaybackRate(num, den);
    }
  }
  // A finite decimal within the range always has an exact representation at
  // 1e6; reject rather than silently rounding an unsupported value.
  throw new TimelineError("timeline.bad_request", "speed fraction");
}

/** A fresh 1/1 rate for new clips. */
export function onePlaybackRate(): PlaybackRate {
  return defaultPlaybackRate();
}
