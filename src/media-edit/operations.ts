import type {
  MediaCrop,
  MediaEditOperation,
  MediaRecipe,
  MediaRotation,
  MediaSegment,
  MediaSubtitleCue,
  MediaSubtitleMode,
  TimeUs,
} from "./types";
import {
  assertMediaCropWithin,
  cloneMediaRecipe,
  isMediaSafeInteger,
  mediaEditFail,
  validateMediaCrop,
  validateMediaRecipe,
} from "./types";
import {
  removeRange,
  setSegmentSpeed,
  splitSegments,
  trimSegments,
  validateGain,
  withSegments,
} from "./timing";

/**
 * Pure recipe transactions (`D2`).
 *
 * Every operation builds and validates a complete candidate recipe before
 * the caller commits it. A refused operation therefore changes nothing: no
 * segment is half replaced and no subtitle is half imported. The controller
 * assigns the new immutable content id only after this function succeeds.
 */

function checkRotation(rotation: MediaRotation): void {
  if (![0, 90, 180, 270].includes(rotation)) mediaEditFail("media_edit.bad_request");
}

function checkCues(cues: MediaSubtitleCue[], mode: MediaSubtitleMode): MediaSubtitleCue[] {
  if (!["off", "select", "burn"].includes(mode)) mediaEditFail("media_edit.bad_request");
  const sorted = [...cues].sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
  const candidate = validateMediaRecipe({
    ...sampleRecipe(),
    subtitles: sorted,
    subtitle_mode: mode,
  });
  return candidate.subtitles;
}

/** A tiny valid recipe used only to validate subtitle lists. */
function sampleRecipe(): MediaRecipe {
  return {
    schema_version: 1,
    project_id: "00000000-0000-4000-8000-000000000001",
    content_id: "00000000-0000-4000-8000-000000000002",
    sources: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        path: "C:\\media\\sample.mp4",
        stamp: {
          path_key: "C:\\media\\sample.mp4",
          volume_id: "00000000",
          file_id: "0000000000000000",
          modified_ticks: "0",
          size_bytes: 1,
        },
        duration_us: 10_000_000,
        video_rate: { num: 30, den: 1 },
        audio_rate: 48_000,
        sensitive: false,
      },
    ],
    segments: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        source_id: "00000000-0000-4000-8000-000000000003",
        start_us: 0,
        end_us: 10_000_000,
        speed: 1,
      },
    ],
    crop: null,
    rotation: 0,
    volume: 1,
    mute: false,
    keep_pitch: true,
    subtitles: [],
    subtitle_mode: "off",
    metadata_keep: true,
  };
}

/** Apply one operation atomically; `recipe` is never mutated. */
export function applyMediaEditOperation(recipe: MediaRecipe, operation: MediaEditOperation): MediaRecipe {
  if (!operation || typeof operation !== "object") mediaEditFail("media_edit.bad_request");
  const next = cloneMediaRecipe(recipe);
  switch (operation.kind) {
    case "set_segments": {
      if (!Array.isArray(operation.segments) || operation.segments.length === 0) {
        mediaEditFail("media_edit.bad_request");
      }
      const candidate = withSegments(next, operation.segments);
      return candidate;
    }
    case "set_crop": {
      next.crop = operation.crop === null ? null : validateMediaCrop(operation.crop as MediaCrop);
      break;
    }
    case "set_rotation": {
      checkRotation(operation.rotation);
      next.rotation = operation.rotation;
      break;
    }
    case "set_speed": {
      next.segments = setSegmentSpeed(next.segments, operation.segment_id, operation.speed);
      break;
    }
    case "set_gain": {
      validateGain(operation.volume, operation.mute);
      next.volume = operation.volume;
      next.mute = operation.mute;
      break;
    }
    case "set_keep_pitch": {
      if (typeof operation.keep_pitch !== "boolean") mediaEditFail("media_edit.bad_request");
      next.keep_pitch = operation.keep_pitch;
      break;
    }
    case "relink_source": {
      next.sources = next.sources.map((source) =>
        source.id === operation.source_id ? { ...operation.replacement, id: source.id } : source,
      );
      if (!next.sources.some((source) => source.id === operation.source_id)) {
        mediaEditFail("media_edit.missing_source");
      }
      const longest = next.segments
        .filter((segment) => segment.source_id === operation.source_id)
        .reduce((end, segment) => Math.max(end, segment.end_us), 0);
      const replacement = next.sources.find((source) => source.id === operation.source_id);
      if (!replacement || replacement.duration_us < longest) mediaEditFail("media_edit.unsupported");
      break;
    }
    case "set_subtitles": {
      next.subtitles = checkCues(operation.cues, operation.mode);
      next.subtitle_mode = operation.mode;
      break;
    }
    default:
      mediaEditFail("media_edit.bad_request");
  }
  return validateMediaRecipe(next);
}

/** Trim the recipe to a source range (Start/End boxes). */
export function trimToRange(recipe: MediaRecipe, startUs: TimeUs, endUs: TimeUs): MediaRecipe {
  return withSegments(recipe, trimSegments(recipe, startUs, endUs));
}

/** Cut selection: remove a source range and join the rest. */
export function cutRange(recipe: MediaRecipe, startUs: TimeUs, endUs: TimeUs): MediaRecipe {
  return withSegments(recipe, removeRange(recipe, startUs, endUs));
}

/** Insert a segment boundary at the playhead without discarding content. */
export function splitAtPlayhead(recipe: MediaRecipe, atUs: TimeUs): MediaRecipe {
  return withSegments(recipe, splitSegments(recipe, atUs));
}

/** Change the speed of one segment. */
export function changeSegmentSpeed(recipe: MediaRecipe, segmentId: string, speed: number): MediaRecipe {
  return withSegments(recipe, setSegmentSpeed(recipe.segments, segmentId, speed));
}

/** Crop after container orientation; bounds come from the verified probe. */
export function setCropWithin(
  recipe: MediaRecipe,
  crop: MediaCrop | null,
  sourceWidth: number,
  sourceHeight: number,
): MediaRecipe {
  if (crop !== null) assertMediaCropWithin(crop, sourceWidth, sourceHeight, recipe.rotation);
  return applyMediaEditOperation(recipe, { kind: "set_crop", crop });
}

/** Rotate by a right angle; a crop that no longer fits is refused. */
export function rotateWithin(
  recipe: MediaRecipe,
  rotation: MediaRotation,
  sourceWidth: number,
  sourceHeight: number,
): MediaRecipe {
  checkRotation(rotation);
  if (recipe.crop !== null) assertMediaCropWithin(recipe.crop, sourceWidth, sourceHeight, rotation);
  return applyMediaEditOperation(recipe, { kind: "set_rotation", rotation });
}

/** Set volume and mute without touching any source or segment. */
export function setGain(recipe: MediaRecipe, volume: number, mute: boolean): MediaRecipe {
  return applyMediaEditOperation(recipe, { kind: "set_gain", volume, mute });
}

/** Replace the cue list and its mode. */
export function setSubtitles(
  recipe: MediaRecipe,
  cues: MediaSubtitleCue[],
  mode: MediaSubtitleMode,
): MediaRecipe {
  return applyMediaEditOperation(recipe, { kind: "set_subtitles", cues, mode });
}

/** Segments sorted by source start, ready for `set_segments`. */
export function orderedSegments(segments: readonly MediaSegment[]): MediaSegment[] {
  return [...segments]
    .map((segment) => ({ ...segment }))
    .sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
}

/** True when every segment still points at an existing source. */
export function segmentsPointAtSources(recipe: MediaRecipe): boolean {
  const ids = new Set(recipe.sources.map((source) => source.id));
  return recipe.segments.every((segment) => ids.has(segment.source_id));
}

/** True when `value` is a valid, playable source instant in this recipe. */
export function isInsideAnySegment(recipe: MediaRecipe, sourceUs: TimeUs): boolean {
  if (!isMediaSafeInteger(sourceUs)) return false;
  return recipe.segments.some((segment) => sourceUs >= segment.start_us && sourceUs < segment.end_us);
}
