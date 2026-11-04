/**
 * Source relinking (Step 19a T3, decision D5).
 *
 * Relinking replaces one source reference only after an explicit file choice
 * and probe: the replacement must be long enough for every clip and supply the
 * stream kind those clips use. Clip IDs, positions and every edit stay
 * untouched. A short or incompatible replacement refuses the whole edit; the
 * caller keeps the current project. No grant, token or parser object is
 * persisted.
 */

import type { MediaSource } from "../media-edit/types";
import type { TimelineProject } from "./types";
import { TimelineError } from "./types";
import { cloneProject, validateMediaSource, validateTimelineProject } from "./projectValidation";

export type RelinkProblem = "missing_source" | "duration" | "video" | "audio";

export interface RelinkCheck {
  ok: boolean;
  problem: RelinkProblem | null;
}

/** Check a candidate replacement without changing anything. */
export function checkReplacement(
  project: Readonly<TimelineProject>,
  sourceId: string,
  replacement: MediaSource,
): RelinkCheck {
  const source = project.sources.find((item) => item.id === sourceId);
  if (!source || replacement.id !== sourceId) {
    return { ok: false, problem: "missing_source" };
  }
  let maxOut = 0;
  let needsVideo = false;
  let needsAudio = false;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.source_id !== sourceId) continue;
      maxOut = Math.max(maxOut, clip.source_out_us);
      if (track.kind === "video") needsVideo = true;
      if (track.kind === "audio") needsAudio = true;
    }
  }
  if (replacement.duration_us < maxOut) return { ok: false, problem: "duration" };
  if (needsVideo && replacement.video_rate === null) return { ok: false, problem: "video" };
  if (needsAudio && replacement.audio_rate === null) return { ok: false, problem: "audio" };
  return { ok: true, problem: null };
}

/**
 * Replace one source reference. The replacement is validated again here even
 * when the UI already probed it; a failed check leaves the project untouched.
 */
export function relinkTimelineSource(
  project: Readonly<TimelineProject>,
  sourceId: string,
  replacement: MediaSource,
): TimelineProject {
  const validated = validateMediaSource(replacement);
  const check = checkReplacement(project, sourceId, validated);
  if (!check.ok) {
    if (check.problem === "missing_source") throw new TimelineError("timeline.missing_source");
    throw new TimelineError("timeline.bad_request", check.problem ?? "relink");
  }
  const next = cloneProject(project);
  const index = next.sources.findIndex((source) => source.id === sourceId);
  if (index < 0) throw new TimelineError("timeline.missing_source");
  if (JSON.stringify(next.sources[index]) === JSON.stringify(validated)) {
    return project as TimelineProject;
  }
  next.sources[index] = validated;
  return validateTimelineProject(next);
}
