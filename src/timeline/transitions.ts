import type { TimelineProject, TimelineTransition, TransitionKind } from "./types";
import { TimelineError, TIMELINE_MAX_DURATION_US, TIMELINE_MAX_TRANSITION_US } from "./types";
import { clipDurationUs, clipEndUs } from "./timing";
import { cloneProject } from "./projectValidation";

export function transitionWeights(kind: Exclude<TransitionKind, "wipe">, fraction: number) {
  if (!Number.isFinite(fraction)) throw new TimelineError("timeline.bad_request");
  const f = Math.max(0, Math.min(1, fraction));
  if (kind === "crossfade") return { left: 1 - f, right: f, color: 0 };
  if (kind === "dip") return f < 0.5
    ? { left: 1 - 2 * f, right: 0, color: 2 * f }
    : { left: 0, right: 2 * f - 1, color: 2 * (1 - f) };
  throw new TimelineError("timeline.unsupported");
}

/** Pure edit; the caller commits/validates once through 19a E4. */
export function setTimelineTransition(
  current: Readonly<TimelineProject>, leftId: string, rightId: string,
  replacement: TimelineTransition | null,
): TimelineProject {
  const next = cloneProject(current);
  const owner = next.tracks.find((track) => track.clips.some((clip) => clip.id === leftId));
  if (!owner || owner.kind !== "video") throw new TimelineError("timeline.bad_request");
  if (owner.locked) throw new TimelineError("timeline.locked");
  const ordered = [...owner.clips].sort((a, b) => a.start_us - b.start_us || a.id.localeCompare(b.id));
  const index = ordered.findIndex((clip) => clip.id === leftId);
  const left = ordered[index];
  const right = ordered[index + 1];
  if (!right || right.id !== rightId) throw new TimelineError("timeline.overlap");
  const editedLinks = new Set([left.link_id, right.link_id].filter((id): id is string => id !== null));
  if (next.tracks.some((track) => track.locked && track.clips.some((clip) => clip.link_id && editedLinks.has(clip.link_id)))) {
    throw new TimelineError("timeline.locked");
  }
  const old = next.transitions.find((t) => t.left_clip_id === leftId && t.right_clip_id === rightId);
  const oldDuration = old?.duration_us ?? 0;
  if (right.start_us !== clipEndUs(left) - oldDuration) throw new TimelineError("timeline.overlap");
  const duration = replacement?.duration_us ?? 0;
  if (replacement) {
    if (replacement.track_id !== owner.id || replacement.left_clip_id !== leftId ||
        replacement.right_clip_id !== rightId ||
        !Number.isSafeInteger(duration) || duration <= 0 ||
        duration > Math.min(clipDurationUs(left) / 2, clipDurationUs(right) / 2, TIMELINE_MAX_TRANSITION_US) ||
        (old && replacement.id !== old.id) ||
        next.transitions.some((t) => t.id === replacement.id && t !== old)) {
      throw new TimelineError("timeline.bad_request");
    }
  }
  const others = next.transitions.filter((t) => t !== old);
  for (const clip of [left, right]) {
    const total = others.filter((t) => (t.left_clip_id === clip.id || t.right_clip_id === clip.id))
      .reduce((sum, t) => sum + t.duration_us, duration);
    if (total > clipDurationUs(clip)) throw new TimelineError("timeline.overlap");
  }
  const delta = oldDuration - duration;
  const shifted = new Set(ordered.slice(index + 1).map((clip) => clip.id));
  const links = new Set(ordered.slice(index + 1).flatMap((clip) => clip.link_id ? [clip.link_id] : []));
  for (const track of next.tracks) for (const clip of track.clips) {
    if (!shifted.has(clip.id) && !(clip.link_id && links.has(clip.link_id))) continue;
    if (track.locked) throw new TimelineError("timeline.locked");
    const start = clip.start_us + delta;
    if (!Number.isSafeInteger(start) || start < 0 || start + clipDurationUs(clip) > TIMELINE_MAX_DURATION_US) {
      throw new TimelineError("timeline.bad_request");
    }
    clip.start_us = start;
  }
  next.transitions = replacement ? [...others, structuredClone(replacement)] : others;
  return next;
}
