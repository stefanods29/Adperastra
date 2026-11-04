/**
 * Pure timeline operations (Step 19a T2, decisions D3/D4).
 *
 * Every operation validates the whole result before it is returned, so a
 * failed edit never leaves a half-changed project. Linked audio/video partners
 * are edited together; a locked partner refuses the entire edit. The returned
 * project keeps `project_id` and `content_id`; the transaction layer assigns
 * the new immutable content identity after one successful commit.
 */

import type { MediaSource } from "../media-edit/types";
import type {
  PlaybackRate,
  TimelineClip,
  TimelineOperation,
  TimelineProject,
  TimelineTransition,
  Track,
} from "./types";
import { TimelineError, newUuid } from "./types";
import {
  clipDurationUs,
  clipEndUs,
  clipSourceTime,
  sourceDeltaToTimelineUs,
} from "./timing";
import {
  cloneProject,
  computeProjectDurationUs,
  validateTimelineProject,
} from "./projectValidation";
import { rippleDelete } from "./ripple";
import { relinkTimelineSource } from "./relink";

export interface ClipLocation {
  track: Track;
  clip: TimelineClip;
  trackIndex: number;
  clipIndex: number;
}

/** The track with this ID, or null. */
export function findTrack(project: Readonly<TimelineProject>, trackId: string): Track | null {
  return project.tracks.find((track) => track.id === trackId) ?? null;
}

/** The clip with this ID and where it lives, or null. */
export function findClip(
  project: Readonly<TimelineProject>,
  clipId: string,
): ClipLocation | null {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex >= 0) {
      return { track, clip: track.clips[clipIndex], trackIndex, clipIndex };
    }
  }
  return null;
}

/** Every clip sharing the same non-null link ID, including the one given. */
export function linkedPartners(
  project: Readonly<TimelineProject>,
  clip: TimelineClip,
): ClipLocation[] {
  if (clip.link_id === null) {
    const location = findClip(project, clip.id);
    return location ? [location] : [];
  }
  const found: ClipLocation[] = [];
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    track.clips.forEach((item, clipIndex) => {
      if (item.link_id === clip.link_id) found.push({ track, clip: item, trackIndex, clipIndex });
    });
  }
  return found;
}

function requireClip(project: TimelineProject, clipId: string): ClipLocation {
  const location = findClip(project, clipId);
  if (!location) throw new TimelineError("timeline.bad_request", "unknown clip");
  return location;
}

function requireTrack(project: TimelineProject, trackId: string): Track {
  const track = findTrack(project, trackId);
  if (!track) throw new TimelineError("timeline.bad_request", "unknown track");
  return track;
}

function requireUnlocked(locations: readonly ClipLocation[]): void {
  if (locations.some((location) => location.track.locked)) {
    throw new TimelineError("timeline.locked");
  }
}

function sortClips(track: Track): void {
  track.clips.sort((left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id));
}

function reindexTracks(project: TimelineProject): void {
  project.tracks.forEach((track, index) => {
    track.index = index;
  });
}

function removeClip(track: Track, clipId: string): void {
  const index = track.clips.findIndex((clip) => clip.id === clipId);
  if (index >= 0) track.clips.splice(index, 1);
}

function dropReferences(project: TimelineProject, clipIds: ReadonlySet<string>): void {
  project.transitions = project.transitions.filter(
    (transition: TimelineTransition) =>
      !clipIds.has(transition.left_clip_id) && !clipIds.has(transition.right_clip_id),
  );
}

function clampFades(clip: TimelineClip): void {
  const duration = clipDurationUs(clip);
  clip.fade_in_us = Math.min(clip.fade_in_us, duration);
  clip.fade_out_us = Math.min(clip.fade_out_us, duration);
}

function sourceFor(project: TimelineProject, sourceId: string): MediaSource {
  const source = project.sources.find((item) => item.id === sourceId);
  if (!source) throw new TimelineError("timeline.missing_source");
  return source;
}

function checkCombinedDuration(project: TimelineProject): void {
  if (computeProjectDurationUs(project) > 24 * 60 * 60 * 1_000_000) {
    throw new TimelineError("timeline.too_large");
  }
}

/**
 * Apply one operation to an immutable copy. A boundary split, a zero move or
 * an empty delete returns the same project reference and therefore records no
 * history entry.
 */
export function applyTimelineOperation(
  project: Readonly<TimelineProject>,
  operation: TimelineOperation,
): TimelineProject {
  if (typeof operation !== "object" || operation === null) {
    throw new TimelineError("timeline.bad_request");
  }
  switch (operation.kind) {
    case "add_track":
      return addTrack(project, operation.track);
    case "remove_track":
      return removeTrack(project, operation.id);
    case "add_clip":
      return addClip(project, operation.track_id, operation.clip);
    case "move_clip":
      return moveClip(project, operation.id, operation.track_id, operation.start_us);
    case "trim_clip":
      return trimClip(project, operation.id, operation.in_us, operation.out_us);
    case "split_clip":
      return splitClip(project, operation.id, operation.time_us);
    case "slip_clip":
      return slipClip(project, operation.id, operation.delta_us);
    case "delete_clips":
      return deleteClips(project, operation.ids, operation.ripple);
    case "reorder_tracks":
      return reorderTracks(project, operation.ids);
    case "relink_source":
      return relinkTimelineSource(project, operation.id, operation.replacement);
    default:
      throw new TimelineError("timeline.bad_request", "unknown operation");
  }
}

function addTrack(project: Readonly<TimelineProject>, incoming: Track): TimelineProject {
  if (project.tracks.length >= 128) throw new TimelineError("timeline.too_large");
  if (project.tracks.some((track) => track.id === incoming.id)) {
    throw new TimelineError("timeline.bad_request", "duplicate track");
  }
  const next = cloneProject(project);
  const track = structuredClone(incoming);
  track.index = next.tracks.length;
  next.tracks.push(track);
  return validateTimelineProject(next);
}

function removeTrack(project: Readonly<TimelineProject>, trackId: string): TimelineProject {
  const target = requireTrack(cloneProject(project), trackId);
  if (target.locked) throw new TimelineError("timeline.locked");
  const next = cloneProject(project);
  const track = requireTrack(next, trackId);
  const linkIds = new Set(track.clips.map((clip) => clip.link_id).filter((id) => id !== null));
  const removed = new Set(track.clips.map((clip) => clip.id));
  if (linkIds.size > 0) {
    for (const other of next.tracks) {
      if (other.id === trackId) continue;
      const partners = other.clips.filter(
        (clip) => clip.link_id !== null && linkIds.has(clip.link_id),
      );
      if (partners.length === 0) continue;
      if (other.locked) throw new TimelineError("timeline.locked");
      for (const partner of partners) removed.add(partner.id);
    }
  }
  next.tracks = next.tracks.filter((item) => item.id !== trackId);
  for (const other of next.tracks) {
    other.clips = other.clips.filter((clip) => !removed.has(clip.id));
  }
  next.titles = next.titles.filter((title) => title.track_id !== trackId);
  dropReferences(next, removed);
  reindexTracks(next);
  return validateTimelineProject(next);
}

function addClip(
  project: Readonly<TimelineProject>,
  trackId: string,
  incoming: TimelineClip,
): TimelineProject {
  const next = cloneProject(project);
  const track = requireTrack(next, trackId);
  if (track.locked) throw new TimelineError("timeline.locked");
  sourceFor(next, incoming.source_id);
  if (findClip(next, incoming.id)) throw new TimelineError("timeline.bad_request", "duplicate clip");
  track.clips.push(structuredClone(incoming));
  sortClips(track);
  checkCombinedDuration(next);
  return validateTimelineProject(next);
}

function moveClip(
  project: Readonly<TimelineProject>,
  clipId: string,
  trackId: string,
  startUs: number,
): TimelineProject {
  if (!Number.isSafeInteger(startUs) || startUs < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const source = requireClip(cloneProject(project), clipId);
  if (source.track.locked) throw new TimelineError("timeline.locked");
  const partners = linkedPartners(project, source.clip);
  requireUnlocked(partners);
  const target = requireTrack(cloneProject(project), trackId);
  if (target.locked) throw new TimelineError("timeline.locked");
  if (target.kind !== source.track.kind) throw new TimelineError("timeline.bad_request");
  const delta = startUs - source.clip.start_us;
  if (delta === 0 && target.id === source.track.id) return project as TimelineProject;
  for (const partner of partners) {
    if (partner.clip.start_us + delta < 0) throw new TimelineError("timeline.bad_request");
  }
  const next = cloneProject(project);
  const location = requireClip(next, clipId);
  const moved = structuredClone(location.clip);
  moved.start_us = startUs;
  removeClip(location.track, clipId);
  const nextTarget = requireTrack(next, trackId);
  nextTarget.clips.push(moved);
  sortClips(nextTarget);
  for (const partner of partners) {
    if (partner.clip.id === clipId) continue;
    const partnerLocation = requireClip(next, partner.clip.id);
    partnerLocation.clip.start_us += delta;
    sortClips(partnerLocation.track);
  }
  for (const item of next.tracks) sortClips(item);
  checkCombinedDuration(next);
  return validateTimelineProject(next);
}

function trimClip(
  project: Readonly<TimelineProject>,
  clipId: string,
  inUs: number,
  outUs: number,
): TimelineProject {
  if (!Number.isSafeInteger(inUs) || !Number.isSafeInteger(outUs) || outUs <= inUs || inUs < 0) {
    throw new TimelineError("timeline.bad_request");
  }
  const location = requireClip(cloneProject(project), clipId);
  if (location.track.locked) throw new TimelineError("timeline.locked");
  const partners = linkedPartners(project, location.clip);
  requireUnlocked(partners);
  const media = sourceFor(cloneProject(project), location.clip.source_id);
  if (outUs > media.duration_us) throw new TimelineError("timeline.bad_request");
  if (inUs === location.clip.source_in_us && outUs === location.clip.source_out_us) {
    return project as TimelineProject;
  }
  const leftDelta = inUs - location.clip.source_in_us;
  const shift =
    leftDelta >= 0
      ? sourceDeltaToTimelineUs(leftDelta, location.clip.speed)
      : -sourceDeltaToTimelineUs(-leftDelta, location.clip.speed);
  const newStart = location.clip.start_us + shift;
  if (newStart < 0) throw new TimelineError("timeline.bad_request");
  const next = cloneProject(project);
  for (const partner of partners) {
    const current = requireClip(next, partner.clip.id);
    current.clip.source_in_us = inUs;
    current.clip.source_out_us = outUs;
    current.clip.start_us = newStart;
    clampFades(current.clip);
    sortClips(current.track);
  }
  checkCombinedDuration(next);
  return validateTimelineProject(next);
}

function splitClip(
  project: Readonly<TimelineProject>,
  clipId: string,
  timeUs: number,
): TimelineProject {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0) throw new TimelineError("timeline.bad_request");
  const location = requireClip(cloneProject(project), clipId);
  if (location.track.locked) throw new TimelineError("timeline.locked");
  const partners = linkedPartners(project, location.clip);
  requireUnlocked(partners);
  const clip = location.clip;
  const end = clipEndUs(clip);
  // A boundary split changes nothing and records no history entry.
  if (timeUs <= clip.start_us || timeUs >= end) return project as TimelineProject;
  const point = clipSourceTime(clip, timeUs);
  if (point <= clip.source_in_us || point >= clip.source_out_us) {
    throw new TimelineError("timeline.bad_request", "split too near the boundary");
  }
  if (project.tracks.reduce((total, track) => total + track.clips.length, 0) + partners.length > 10_000) {
    throw new TimelineError("timeline.too_large");
  }
  const next = cloneProject(project);
  const rightLink = clip.link_id === null ? null : newUuid();
  for (const partner of partners) {
    const current = requireClip(next, partner.clip.id);
    const original = structuredClone(current.clip);
    const right: TimelineClip = {
      ...structuredClone(original),
      id: newUuid(),
      link_id: rightLink,
      start_us: timeUs,
      source_in_us: point,
      fade_in_us: 0,
    };
    current.clip.source_out_us = point;
    current.clip.fade_out_us = 0;
    clampFades(current.clip);
    clampFades(right);
    current.track.clips.push(right);
    sortClips(current.track);
  }
  return validateTimelineProject(next);
}

function slipClip(
  project: Readonly<TimelineProject>,
  clipId: string,
  deltaUs: number,
): TimelineProject {
  if (!Number.isSafeInteger(deltaUs)) throw new TimelineError("timeline.bad_request");
  if (deltaUs === 0) return project as TimelineProject;
  const location = requireClip(cloneProject(project), clipId);
  if (location.track.locked) throw new TimelineError("timeline.locked");
  const partners = linkedPartners(project, location.clip);
  requireUnlocked(partners);
  const media = sourceFor(cloneProject(project), location.clip.source_id);
  for (const partner of partners) {
    const newIn = partner.clip.source_in_us + deltaUs;
    const newOut = partner.clip.source_out_us + deltaUs;
    if (newIn < 0 || newOut > media.duration_us || newOut <= newIn) {
      throw new TimelineError("timeline.bad_request");
    }
  }
  const next = cloneProject(project);
  for (const partner of partners) {
    const current = requireClip(next, partner.clip.id);
    current.clip.source_in_us += deltaUs;
    current.clip.source_out_us += deltaUs;
    clampFades(current.clip);
  }
  return validateTimelineProject(next);
}

function deleteClips(
  project: Readonly<TimelineProject>,
  ids: readonly string[],
  ripple: boolean,
): TimelineProject {
  if (!Array.isArray(ids) || ids.length === 0) return project as TimelineProject;
  if (new Set(ids).size !== ids.length) throw new TimelineError("timeline.bad_request");
  if (ids.length > 10_000) throw new TimelineError("timeline.too_large");
  const locations = ids.map((id) => requireClip(cloneProject(project), id));
  if (ripple) {
    const trackId = locations[0].track.id;
    if (locations.some((location) => location.track.id !== trackId)) {
      throw new TimelineError("timeline.bad_request", "ripple across tracks");
    }
    return rippleDelete(project, trackId, ids);
  }
  const removed = new Set<string>(ids);
  for (const location of locations) {
    for (const partner of linkedPartners(project, location.clip)) removed.add(partner.clip.id);
  }
  const next = cloneProject(project);
  for (const track of next.tracks) {
    const keep = track.clips.filter((clip) => !removed.has(clip.id));
    if (keep.length !== track.clips.length) {
      if (track.locked) throw new TimelineError("timeline.locked");
      track.clips = keep;
    }
  }
  dropReferences(next, removed);
  return validateTimelineProject(next);
}

function reorderTracks(project: Readonly<TimelineProject>, ids: readonly string[]): TimelineProject {
  if (!Array.isArray(ids) || ids.length !== project.tracks.length) {
    throw new TimelineError("timeline.bad_request");
  }
  if (new Set(ids).size !== ids.length) throw new TimelineError("timeline.bad_request");
  const byId = new Map(project.tracks.map((track) => [track.id, track]));
  if (ids.some((id) => !byId.has(id))) throw new TimelineError("timeline.bad_request");
  if (project.tracks.some((track) => track.locked)) throw new TimelineError("timeline.locked");
  const next = cloneProject(project);
  next.tracks = ids.map((id) => {
    const track = byId.get(id) as Track;
    return structuredClone(track);
  });
  reindexTracks(next);
  return validateTimelineProject(next);
}

/** True when two operations would produce the same project data. */
export function sameProject(
  left: Readonly<TimelineProject>,
  right: Readonly<TimelineProject>,
): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** The current playback rate of a clip, typed for callers. */
export function clipRate(clip: TimelineClip): PlaybackRate {
  return clip.speed;
}
