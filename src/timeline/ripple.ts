/**
 * Ripple delete (Step 19a T3, decision D4).
 *
 * Ripple delete works on one unlocked track. The selected clips must include
 * every clip that intersects their first-start/last-end interval; otherwise
 * the edit is ambiguous and refused. The interval is removed and later clips
 * on the affected tracks move earlier by its exact duration. Compatible
 * linked partners are removed and their tracks shifted by the same duration;
 * a locked partner refuses the whole edit.
 */

import type { TimelineClip, TimelineProject, Track } from "./types";
import { TimelineError } from "./types";
import { clipEndUs } from "./timing";
import { cloneProject, validateTimelineProject } from "./projectValidation";

function findTrack(project: Readonly<TimelineProject>, trackId: string): Track {
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track) throw new TimelineError("timeline.bad_request", "unknown track");
  return track;
}

function covers(start: number, end: number, clip: TimelineClip): boolean {
  return clip.start_us < end && clipEndUs(clip) > start;
}

/** Remove one clip ID from a track, ignoring an absent ID. */
function remove(track: Track, clipId: string): void {
  const index = track.clips.findIndex((clip) => clip.id === clipId);
  if (index >= 0) track.clips.splice(index, 1);
}

/** Remove the interval and close the gap on every affected track. */
export function rippleDelete(
  project: Readonly<TimelineProject>,
  trackId: string,
  selectedIds: readonly string[],
): TimelineProject {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new TimelineError("timeline.bad_request");
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new TimelineError("timeline.bad_request");
  }
  const primary = findTrack(project, trackId);
  if (primary.locked) throw new TimelineError("timeline.locked");
  const selectedSet = new Set(selectedIds);
  const selected: TimelineClip[] = [];
  for (const id of selectedIds) {
    const clip = primary.clips.find((item) => item.id === id);
    if (!clip) throw new TimelineError("timeline.bad_request", "selected clip on another track");
    selected.push(clip);
  }
  const start = Math.min(...selected.map((clip) => clip.start_us));
  const end = Math.max(...selected.map((clip) => clipEndUs(clip)));
  const duration = end - start;
  if (duration <= 0) throw new TimelineError("timeline.bad_request");
  // Ambiguous ripple: every clip inside the chosen interval must be selected.
  for (const clip of primary.clips) {
    if (covers(start, end, clip) && !selectedSet.has(clip.id)) {
      throw new TimelineError("timeline.bad_request", "unselected clip in ripple range");
    }
  }

  const removeByTrack = new Map<string, Set<string>>();
  const affected = new Map<string, Track>();
  affected.set(primary.id, primary);
  removeByTrack.set(primary.id, new Set(selectedIds));
  for (const clip of selected) {
    if (clip.link_id === null) continue;
    for (const track of project.tracks) {
      if (track.id === primary.id) continue;
      for (const partner of track.clips) {
        if (partner.link_id !== clip.link_id) continue;
        if (track.locked) throw new TimelineError("timeline.locked");
        if (partner.source_id !== clip.source_id) {
          throw new TimelineError("timeline.bad_request", "incompatible linked partner");
        }
        affected.set(track.id, track);
        const set = removeByTrack.get(track.id) ?? new Set<string>();
        set.add(partner.id);
        removeByTrack.set(track.id, set);
      }
    }
  }

  const next = cloneProject(project);
  for (const [affectedId, original] of affected) {
    const track = next.tracks.find((item) => item.id === affectedId) as Track;
    const removeIds = removeByTrack.get(affectedId) ?? new Set<string>();
    // Sanity: the partner ranges must match the removed interval; otherwise
    // shifting its track by this duration would desynchronize the pair.
    for (const id of removeIds) {
      const clip = original.clips.find((item) => item.id === id);
      if (!clip) continue;
      if (clip.start_us !== start || clipEndUs(clip) !== end) {
        throw new TimelineError("timeline.bad_request", "linked partner interval");
      }
    }
    for (const id of removeIds) remove(track, id);
    for (const clip of track.clips) {
      if (clip.start_us >= end) clip.start_us -= duration;
    }
    track.clips.sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
  }
  const removed = new Set<string>();
  for (const ids of removeByTrack.values()) for (const id of ids) removed.add(id);
  next.transitions = next.transitions.filter(
    (transition) =>
      !removed.has(transition.left_clip_id) && !removed.has(transition.right_clip_id),
  );
  return validateTimelineProject(next);
}
