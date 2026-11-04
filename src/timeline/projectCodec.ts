/**
 * Project file codec and Step 15 recipe import (Step 19a T6, decision D1).
 *
 * The `.adtimeline` file is UTF-8 JSON schema 1, at most 16 MiB. It stores
 * instructions and source references only: no media bytes, grants, tokens,
 * passwords or parser objects. A Step 15 `.admedia` recipe is imported as one
 * clip per segment, in order, without flattening; every source range and
 * segment identity is preserved.
 */

import type {
  MediaRecipe,
  MediaSegment,
  MediaSource,
} from "../media-edit/types";
import { validateMediaRecipe } from "../media-edit/types";
import type { FrameRate } from "../services/mediaEngine";
import type { TimelineClip, TimelineProject } from "./types";
import type { TimelineFile } from "./projectValidation";
import {
  TIMELINE_AUDIO_RATE,
  TIMELINE_DEFAULT_FRAME_RATE,
  TIMELINE_DEFAULT_HEIGHT,
  TIMELINE_DEFAULT_WIDTH,
  TIMELINE_MAX_PROJECT_BYTES,
  TIMELINE_SCHEMA_VERSION,
  TimelineError,
  newUuid,
} from "./types";
import {
  clipDurationUs,
  playbackRateFromNumber,
} from "./timing";
import {
  decodeTimelineFile,
  emptyTimelineProject,
  encodeTimelineProject,
  validateMediaSource,
  validateMediaSubtitleCue,
  validateTimelineProject,
} from "./projectValidation";

/** UTF-8 bytes of a validated project; `copy` never changes its identity. */
export function encodeTimelineFile(
  project: Readonly<TimelineProject>,
  mode: "save" | "copy" = "save",
): Uint8Array {
  if (mode !== "save" && mode !== "copy") throw new TimelineError("timeline.bad_request");
  const bytes = new TextEncoder().encode(encodeTimelineProject(project));
  if (bytes.length > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
  return bytes;
}

/** Decode project bytes, preserving a newer schema as raw text. */
export function decodeTimelineFileBytes(bytes: Uint8Array): TimelineFile {
  if (!(bytes instanceof Uint8Array)) throw new TimelineError("timeline.bad_request");
  if (bytes.length > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TimelineError("timeline.bad_request", "project encoding");
  }
  return decodeTimelineFile(value);
}

/** A stable save-copy view: identical bytes and identical content identity. */
export function saveCopyIdentity(project: Readonly<TimelineProject>): {
  content_id: string;
  bytes: Uint8Array;
} {
  const before = project.content_id;
  const bytes = encodeTimelineFile(project, "copy");
  if (project.content_id !== before) {
    throw new TimelineError("timeline.failed", "copy mutated identity");
  }
  return { content_id: before, bytes };
}

export interface TimelineNames {
  /** Translated track names supplied by the UI. */
  video_name: string;
  audio_name?: string;
  project_id?: string;
  content_id?: string;
  width?: number;
  height?: number;
}

function firstFrameRate(sources: readonly MediaSource[]): FrameRate {
  const rate = sources.find((source) => source.video_rate !== null)?.video_rate;
  return rate ? { ...rate } : { ...TIMELINE_DEFAULT_FRAME_RATE };
}

function sourceHasAudio(sources: readonly MediaSource[], sourceId: string): boolean {
  return sources.some((source) => source.id === sourceId && source.audio_rate !== null);
}

function sourceHasVideo(sources: readonly MediaSource[], sourceId: string): boolean {
  return sources.some((source) => source.id === sourceId && source.video_rate !== null);
}

/**
 * A recipe entering the timeline is checked by the Step 15 validator, the
 * same one the media editor uses: segment order and identity, source bounds,
 * crop, rotation, speed, volume and subtitle limits. Its errors are mapped to
 * the timeline area so an import never surfaces an unrelated media code.
 */
function validatedRecipe(value: MediaRecipe): MediaRecipe {
  try {
    return validateMediaRecipe(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "media_edit.too_large") throw new TimelineError("timeline.too_large");
    if (code === "media_edit.missing_source") throw new TimelineError("timeline.missing_source");
    if (code === "media_edit.unsupported") throw new TimelineError("timeline.unsupported");
    throw new TimelineError("timeline.bad_request", "recipe");
  }
}

function clipFromSegment(
  segment: MediaSegment,
  recipe: MediaRecipe,
  startUs: number,
  linkId: string | null,
): TimelineClip {
  const speed = playbackRateFromNumber(segment.speed);
  return {
    id: segment.id,
    source_id: segment.source_id,
    link_id: linkId,
    start_us: startUs,
    source_in_us: segment.start_us,
    source_out_us: segment.end_us,
    speed,
    gain: recipe.volume,
    mute: recipe.mute,
    solo: false,
    fade_in_us: 0,
    fade_out_us: 0,
    transform: {
      crop: recipe.crop,
      rotation: recipe.rotation,
    },
    effects: [],
  };
}

/**
 * Import a Step 15 recipe: one video clip per segment in order, plus a linked
 * audio clip on its own track when the source has audio. No segment is merged
 * or dropped.
 */
export function projectFromMediaRecipe(
  recipe: MediaRecipe,
  names: TimelineNames,
): TimelineProject {
  const checked = validatedRecipe(recipe);
  const sources = checked.sources;
  const segments = checked.segments;
  const withVideo = sources.some((source) => source.video_rate !== null);
  const withAudio = sources.some((source) => source.audio_rate !== null);
  if (withAudio && !names.audio_name) throw new TimelineError("timeline.bad_request");
  const project = emptyTimelineProject({
    project_id: names.project_id ?? newUuid(),
    content_id: names.content_id ?? newUuid(),
    video_name: names.video_name,
    audio_name: names.audio_name,
    with_video_track: withVideo,
    with_audio_track: withAudio,
    width: names.width,
    height: names.height,
    frame_rate: firstFrameRate(sources),
  });
  project.sources = sources;
  const video = project.tracks.find((track) => track.kind === "video");
  const audio = project.tracks.find((track) => track.kind === "audio");
  let start = 0;
  for (const segment of segments) {
    const hasVideo = sourceHasVideo(sources, segment.source_id);
    const hasAudio = sourceHasAudio(sources, segment.source_id);
    const linked = Boolean(video && audio && hasVideo && hasAudio);
    const linkId = linked ? newUuid() : null;
    const videoClip = video && hasVideo ? clipFromSegment(segment, checked, start, linkId) : null;
    if (video && videoClip) video.clips.push(videoClip);
    const audioClip = audio && hasAudio
      ? { ...clipFromSegment(segment, checked, start, linkId), id: newUuid() }
      : null;
    if (audio && audioClip) audio.clips.push(audioClip);
    const durationSource = videoClip ?? audioClip;
    if (!durationSource) throw new TimelineError("timeline.unsupported", "recipe kind");
    start += clipDurationUs(durationSource);
  }
  project.subtitles = checked.subtitles.map(validateMediaSubtitleCue);
  project.audio_rate = TIMELINE_AUDIO_RATE;
  return validateTimelineProject(project);
}

/** "Edit in timeline": one source, a full video clip and linked audio. */
export function projectFromMediaSource(
  sourceValue: MediaSource,
  names: TimelineNames,
): TimelineProject {
  const source = validateMediaSource(sourceValue);
  if (source.video_rate === null) {
    // "Edit in timeline" starts from a video; audio-only sources use the
    // recipe import or a new project with an audio track.
    throw new TimelineError("timeline.unsupported", "audio-only source");
  }
  const withAudio = source.audio_rate !== null;
  if (withAudio && !names.audio_name) throw new TimelineError("timeline.bad_request");
  const project = emptyTimelineProject({
    project_id: names.project_id ?? newUuid(),
    content_id: names.content_id ?? newUuid(),
    video_name: names.video_name,
    audio_name: names.audio_name,
    with_audio_track: withAudio,
    width: names.width,
    height: names.height,
    frame_rate: source.video_rate ?? { ...TIMELINE_DEFAULT_FRAME_RATE },
  });
  project.sources = [source];
  const linkId = withAudio ? newUuid() : null;
  const base = {
    source_id: source.id,
    link_id: linkId,
    start_us: 0,
    source_in_us: 0,
    source_out_us: source.duration_us,
    speed: { num: 1, den: 1 },
    gain: 1,
    mute: false,
    solo: false,
    fade_in_us: 0,
    fade_out_us: 0,
    transform: { crop: null, rotation: 0 as const },
    effects: [],
  };
  project.tracks[0].clips.push({ ...base, id: newUuid() });
  if (withAudio) project.tracks[1].clips.push({ ...base, id: newUuid() });
  return validateTimelineProject(project);
}

/** The project's file name: the source stem plus `.adtimeline`. */
export function timelineFileName(stem: string): string {
  const base = stem.trim() === "" ? "Timeline" : stem.trim();
  return `${base}.adtimeline`;
}

/** True when the schema this build writes is the one 19b expects. */
export function isCurrentTimelineSchema(project: Readonly<TimelineProject>): boolean {
  return project.schema_version === TIMELINE_SCHEMA_VERSION;
}
