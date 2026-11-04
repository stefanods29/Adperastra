/**
 * Runtime timeline view state (Step 19a, separate from the project).
 *
 * Zoom, scroll, playhead and selection are presentation state and are never
 * written into the `.adtimeline` project. The values are bounded before they
 * reach the DOM or a saved tab state.
 */

import type { FrameRate, TimeUs } from "../services/mediaEngine";
import type { TimelineProject } from "./types";
import { TimelineError } from "./types";
import { clipEndUs, frameIndexAt, frameTime, isFrameRate } from "./timing";

export interface TimelineViewState {
  playhead_us: TimeUs;
  scroll_us: TimeUs;
  /** Timeline pixels per second; 1..1000. */
  pixels_per_second: number;
  selected_clip_ids: string[];
  active_track_id: string | null;
  snap_enabled: boolean;
  proxy_preview: boolean;
}

export const MIN_PIXELS_PER_SECOND = 1;
export const MAX_PIXELS_PER_SECOND = 1_000;
export const MAX_SELECTED_CLIPS = 10_000;
/** Time overscan on both sides of the visible window. */
export const TIME_OVERSCAN_US = 2_000_000;
/** Extra track rows above and below the viewport. */
export const TRACK_OVERSCAN = 2;

export function defaultTimelineViewState(): TimelineViewState {
  return {
    playhead_us: 0,
    scroll_us: 0,
    pixels_per_second: 120,
    selected_clip_ids: [],
    active_track_id: null,
    snap_enabled: true,
    proxy_preview: false,
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Clamp a stored or restored state into the published bounds. */
export function clampTimelineViewState(value: unknown): TimelineViewState {
  const state = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const playhead = finite(state.playhead_us, 0);
  const scroll = finite(state.scroll_us, 0);
  const zoom = finite(state.pixels_per_second, 120);
  const ids = Array.isArray(state.selected_clip_ids)
    ? state.selected_clip_ids
        .filter((id): id is string => typeof id === "string")
        .slice(0, MAX_SELECTED_CLIPS)
    : [];
  return {
    playhead_us: Number.isSafeInteger(playhead) && playhead >= 0 ? playhead : 0,
    scroll_us: Number.isSafeInteger(scroll) && scroll >= 0 ? scroll : 0,
    pixels_per_second: Math.min(
      MAX_PIXELS_PER_SECOND,
      Math.max(MIN_PIXELS_PER_SECOND, Math.round(zoom)),
    ),
    selected_clip_ids: Array.from(new Set(ids)),
    active_track_id: typeof state.active_track_id === "string" ? state.active_track_id : null,
    snap_enabled: state.snap_enabled !== false,
    proxy_preview: state.proxy_preview === true,
  };
}

/** Plain JSON for the 09a view-state codec; only bounded fields. */
export function encodeTimelineViewState(state: TimelineViewState): Record<string, unknown> {
  const safe = clampTimelineViewState(state);
  return {
    playhead_us: safe.playhead_us,
    scroll_us: safe.scroll_us,
    pixels_per_second: safe.pixels_per_second,
    selected_clip_ids: safe.selected_clip_ids,
    active_track_id: safe.active_track_id,
    snap_enabled: safe.snap_enabled,
    proxy_preview: safe.proxy_preview,
  };
}

/** Decode a saved tab state; unknown values fall back to the defaults. */
export function decodeTimelineViewState(value: unknown): TimelineViewState {
  if (value === null || value === undefined) return defaultTimelineViewState();
  return clampTimelineViewState(value);
}

/** The visible time window with the 2 s overscan on both sides. */
export function visibleTimeWindow(
  scrollUs: TimeUs,
  pixelsPerSecond: number,
  widthPx: number,
  overscanUs: number = TIME_OVERSCAN_US,
): { start_us: TimeUs; end_us: TimeUs } {
  if (!Number.isSafeInteger(scrollUs) || scrollUs < 0) throw new TimelineError("timeline.bad_request");
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!Number.isFinite(widthPx) || widthPx < 0) throw new TimelineError("timeline.bad_request");
  if (!Number.isSafeInteger(overscanUs) || overscanUs < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const span = Math.round((widthPx * 1_000_000) / pixelsPerSecond);
  const start = Math.max(0, scrollUs - overscanUs);
  return { start_us: start, end_us: scrollUs + span + overscanUs };
}

/** Clips that intersect the visible time window, in track order. */
export function clipsInWindow(
  project: Readonly<TimelineProject>,
  startUs: TimeUs,
  endUs: TimeUs,
): TimelineProject["tracks"][number]["clips"] {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || endUs < startUs) {
    throw new TimelineError("timeline.bad_request");
  }
  const found: TimelineProject["tracks"][number]["clips"] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.start_us < endUs && clipEndUs(clip) > startUs) found.push(clip);
    }
  }
  return found;
}

export interface TrackHeights {
  video: number;
  audio: number;
}

/** The visible track index range with two extra rows above and below. */
export function visibleTrackRange(
  tracks: ReadonlyArray<{ kind: "video" | "audio" }>,
  scrollTop: number,
  viewportHeight: number,
  heights: TrackHeights = { video: 72, audio: 56 },
  overscan: number = TRACK_OVERSCAN,
): { first: number; last: number } {
  if (!Number.isFinite(scrollTop) || scrollTop < 0) throw new TimelineError("timeline.bad_request");
  if (!Number.isFinite(viewportHeight) || viewportHeight < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!Number.isSafeInteger(overscan) || overscan < 0) throw new TimelineError("timeline.bad_request");
  if (tracks.length === 0) return { first: 0, last: -1 };
  const top = scrollTop;
  const bottom = scrollTop + viewportHeight;
  let first = tracks.length - 1;
  let last = 0;
  let offset = 0;
  for (let index = 0; index < tracks.length; index += 1) {
    const height = tracks[index].kind === "video" ? heights.video : heights.audio;
    const start = offset;
    const end = offset + height;
    if (end > top && start < bottom) {
      first = Math.min(first, index);
      last = Math.max(last, index);
    }
    offset = end;
  }
  if (offset <= top) return { first: tracks.length, last: tracks.length - 1 };
  return {
    first: Math.max(0, first - overscan),
    last: Math.min(tracks.length - 1, last + overscan),
  };
}

export type ArrowDirection = "left" | "right";

/**
 * Exact keyboard frame movement: one frame, or ten with Shift. The result is
 * always a frame boundary, never an accumulated float.
 */
export function playheadAfterArrow(
  playheadUs: TimeUs,
  direction: ArrowDirection,
  shift: boolean,
  rate: FrameRate,
): TimeUs {
  if (!Number.isSafeInteger(playheadUs) || playheadUs < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!isFrameRate(rate)) throw new TimelineError("timeline.bad_request");
  const frames = shift ? 10 : 1;
  const index = frameIndexAt(playheadUs, rate);
  const atBoundary = frameTime(index, rate) === playheadUs;
  if (direction === "right") {
    return frameTime(atBoundary ? index + frames : index + frames, rate);
  }
  const target = atBoundary ? index - frames : index - frames + 1;
  return target <= 0 ? 0 : frameTime(target, rate);
}
