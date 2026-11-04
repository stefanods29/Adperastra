/**
 * Timeline snapping (Step 19a T3, decision D4).
 *
 * Targets are the playhead, clip edges and the source frame grid. The search
 * radius is 8 CSS pixels converted to timeline microseconds. The nearest
 * target wins; ties choose the earlier time, then the stable target ID. Alt
 * disables snapping by passing `enabled: false`.
 */

import type { FrameRate, TimeUs } from "../services/mediaEngine";
import type { TimelineProject } from "./types";
import { TimelineError } from "./types";
import { clipEndUs, frameIndexAt, frameTime, isFrameRate } from "./timing";

export type SnapTargetKind = "playhead" | "clip-start" | "clip-end" | "frame";

export interface SnapOptions {
  /** False while Alt is held. */
  enabled?: boolean;
  /** Visible timeline scale: timeline pixels per second. */
  pixels_per_second: number;
  playhead_us: TimeUs;
  frame_rate: FrameRate;
  /** The clip being dragged: its own edges are not snap targets. */
  exclude_clip_ids?: readonly string[];
  /** Design value: 8 CSS pixels. */
  threshold_px?: number;
}

export interface SnapResult {
  time_us: TimeUs;
  target: SnapTargetKind | null;
  target_id: string | null;
  /** The unsnapped candidate remains available for Escape handling. */
  snapped: boolean;
}

interface Candidate {
  time: TimeUs;
  kind: SnapTargetKind;
  id: string;
}

function safeTime(value: number): TimeUs {
  if (!Number.isSafeInteger(value) || value < 0) throw new TimelineError("timeline.bad_request");
  return value;
}

function consider(
  best: Candidate | null,
  candidate: Candidate,
  candidateUs: TimeUs,
  limit: number,
): Candidate | null {
  const distance = Math.abs(candidate.time - candidateUs);
  if (distance > limit) return best;
  if (best === null) return candidate;
  const bestDistance = Math.abs(best.time - candidateUs);
  if (distance < bestDistance) return candidate;
  if (distance > bestDistance) return best;
  if (candidate.time < best.time) return candidate;
  if (candidate.time > best.time) return best;
  return candidate.id.localeCompare(best.id) < 0 ? candidate : best;
}

/** Snap a candidate timeline position; always returns a safe integer time. */
export function snapTimelineTime(
  project: Readonly<TimelineProject>,
  candidateUs: TimeUs,
  options: SnapOptions,
): SnapResult {
  safeTime(candidateUs);
  if (!Number.isSafeInteger(options.playhead_us) || options.playhead_us < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!Number.isFinite(options.pixels_per_second) || options.pixels_per_second <= 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (!isFrameRate(options.frame_rate)) throw new TimelineError("timeline.bad_request");
  if (options.enabled === false) {
    return { time_us: candidateUs, target: null, target_id: null, snapped: false };
  }
  const thresholdPx = options.threshold_px ?? 8;
  if (!Number.isFinite(thresholdPx) || thresholdPx <= 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const limit = Math.round((thresholdPx * 1_000_000) / options.pixels_per_second);
  if (limit < 1) {
    return { time_us: candidateUs, target: null, target_id: null, snapped: false };
  }
  const excluded = new Set(options.exclude_clip_ids ?? []);
  let best = consider(
    null,
    { time: options.playhead_us, kind: "playhead", id: "playhead" },
    candidateUs,
    limit,
  );
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      best = consider(
        best,
        { time: clip.start_us, kind: "clip-start", id: `clip:${clip.id}:start` },
        candidateUs,
        limit,
      );
      best = consider(
        best,
        { time: clipEndUs(clip), kind: "clip-end", id: `clip:${clip.id}:end` },
        candidateUs,
        limit,
      );
    }
  }
  // The nearest frame boundary: the containing frame and the next frame are
  // the only two candidates.
  const frame = frameIndexAt(candidateUs, options.frame_rate);
  for (const index of [frame, frame + 1]) {
    best = consider(
      best,
      { time: frameTime(index, options.frame_rate), kind: "frame", id: `frame:${index}` },
      candidateUs,
      limit,
    );
  }
  if (best === null) {
    return { time_us: candidateUs, target: null, target_id: null, snapped: false };
  }
  return { time_us: safeTime(best.time), target: best.kind, target_id: best.id, snapped: true };
}
