import type { TimelineEffectOperation } from "./effectTypes";
import type { TimelineProject, TimelineClip, Track } from "./types";
import { TIMELINE_MAX_EFFECTS_PER_CLIP, TimelineError } from "./types";
import { cloneProject } from "./projectValidation";
import { commitTimelineTransaction } from "./transactions";
import { clipDurationUs } from "./timing";
import { setTimelineTransition } from "./transitions";
import { validateTimelineSubtitles } from "./subtitleTimeline";

function audioValues(gain: number, mute: boolean, solo: boolean) {
  if (!Number.isFinite(gain) || gain < 0 || gain > 4 || typeof mute !== "boolean" || typeof solo !== "boolean") {
    throw new TimelineError("timeline.bad_request");
  }
}

function editableClip(project: TimelineProject, id: string): TimelineClip {
  const entries = project.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })));
  const entry = entries.find((item) => item.clip.id === id);
  if (!entry) throw new TimelineError("timeline.bad_request");
  if (entry.track.locked || (entry.clip.link_id && entries.some((item) => item.clip.link_id === entry.clip.link_id && item.track.locked))) {
    throw new TimelineError("timeline.locked");
  }
  return entry.clip;
}

function editableTrack(project: TimelineProject, id: string): Track {
  const track = project.tracks.find((item) => item.id === id);
  if (!track) throw new TimelineError("timeline.bad_request");
  if (track.locked) throw new TimelineError("timeline.locked");
  return track;
}

/** E1: one content-identity check, complete validation and one history entry.
 * Requires 19a validator proposals before this module is registered in the UI.
 */
export async function applyTimelineEffect(
  documentId: string, expectedContentId: string, operation: TimelineEffectOperation,
): Promise<void> {
  // Freeze caller-owned operation before a future asynchronous controller yields.
  const op = structuredClone(operation);
  await commitTimelineTransaction(documentId, expectedContentId, (current) => {
    if (op.kind === "set_transition") return setTimelineTransition(current, op.left_id, op.right_id, op.transition);
    const next = cloneProject(current);
    switch (op.kind) {
      case "set_effects": {
        if (!Array.isArray(op.effects) || op.effects.length > TIMELINE_MAX_EFFECTS_PER_CLIP) throw new TimelineError("timeline.too_large");
        if (op.effects.some((effect) => effect.tag === "stabilize")) throw new TimelineError("timeline.unsupported");
        editableClip(next, op.clip_id).effects = op.effects;
        break;
      }
      case "set_track_audio": {
        audioValues(op.gain, op.mute, op.solo);
        Object.assign(editableTrack(next, op.id), { gain: op.gain, mute: op.mute, solo: op.solo });
        break;
      }
      case "set_clip_audio": {
        audioValues(op.gain, op.mute, op.solo);
        const clip = editableClip(next, op.id);
        if (![op.fade_in_us, op.fade_out_us].every((v) => Number.isSafeInteger(v) && v >= 0) ||
            op.fade_in_us + op.fade_out_us > clipDurationUs(clip)) throw new TimelineError("timeline.bad_request");
        Object.assign(clip, { gain: op.gain, mute: op.mute, solo: op.solo, fade_in_us: op.fade_in_us, fade_out_us: op.fade_out_us });
        break;
      }
      case "set_subtitles": next.subtitles = validateTimelineSubtitles(op.cues); break;
      case "set_title": {
        const target = editableTrack(next, op.title.track_id);
        const old = next.titles.find((title) => title.id === op.title.id);
        if (old) editableTrack(next, old.track_id);
        if (target.kind !== "video" || target.clips.length !== 0) throw new TimelineError("timeline.bad_request");
        // IDs are the fixed 08b/API-EVIDENCE asset inventory. Actual font bytes,
        // version and glyph availability must be checked by the render producer.
        if (!["inter-regular", "inter-bold", "inter-italic", "inter-bold-italic"].includes(op.title.style.font_asset_id)) {
          throw new TimelineError("timeline.unsupported");
        }
        next.titles = [...next.titles.filter((title) => title.id !== op.title.id), op.title];
        break;
      }
      case "remove_title": {
        const old = next.titles.find((title) => title.id === op.id);
        if (!old) throw new TimelineError("timeline.bad_request");
        editableTrack(next, old.track_id);
        next.titles = next.titles.filter((title) => title.id !== op.id);
        break;
      }
      default: throw new TimelineError("timeline.bad_request");
    }
    return next;
  });
}
