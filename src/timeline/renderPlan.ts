/**
 * The exact normalized render plan (Step 19a E3, revision
 * `timeline-render-1`).
 *
 * 19b preview and export consume this same plan: ordered immutable copies of
 * tracks, sources, transitions, titles and subtitles with their source stamps,
 * one duration and one frame rate. It never contains an extension object,
 * filter text, command line or arbitrary render graph.
 */

import type { TimelineProject, TimelineRenderPlan } from "./types";
import { TimelineError } from "./types";
import { computeProjectDurationUs, freezeProject, validateTimelineProject } from "./projectValidation";

function orderedCopy(project: Readonly<TimelineProject>): TimelineProject {
  const copy = JSON.parse(JSON.stringify(project)) as TimelineProject;
  copy.tracks.sort((left, right) => left.index - right.index);
  for (const track of copy.tracks) {
    track.clips.sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
  }
  return copy;
}

/**
 * Validate and normalize a project into the one plan both preview and export
 * use. A newer schema, an unsupported effect or an invalid overlap is refused
 * rather than rendered partially.
 */
export function normalizeTimeline(project: Readonly<TimelineProject>): TimelineRenderPlan {
  if (typeof project !== "object" || project === null) {
    throw new TimelineError("timeline.bad_request");
  }
  const validated = validateTimelineProject(project);
  // 19a has no audited stabilization capability; 19b registers it explicitly.
  for (const track of validated.tracks) {
    for (const clip of track.clips) {
      if (clip.effects.some((effect) => effect.tag === "stabilize")) {
        throw new TimelineError("timeline.unsupported", "stabilize");
      }
    }
  }
  const copy = orderedCopy(validated);
  const duration = computeProjectDurationUs(copy);
  const plan: TimelineRenderPlan = {
    project_id: copy.project_id,
    content_id: copy.content_id,
    duration_us: duration,
    frame_rate: { ...copy.frame_rate },
    width: copy.width,
    height: copy.height,
    audio_rate: copy.audio_rate,
    audio_channels: copy.audio_channels,
    tracks: copy.tracks,
    sources: copy.sources.map((source) => ({
      ...source,
      stamp: { ...source.stamp },
    })),
    transitions: copy.transitions,
    titles: copy.titles,
    subtitles: copy.subtitles,
  };
  return freezeProject(plan);
}

/** True when two plans describe the same immutable render input. */
export function sameRenderPlan(
  left: Readonly<TimelineRenderPlan>,
  right: Readonly<TimelineRenderPlan>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
