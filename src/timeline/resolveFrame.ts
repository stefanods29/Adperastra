import type { TimeUs } from "../services/mediaEngine";
import type { TimelineRenderPlan } from "./types";
import { TimelineError } from "./types";
import type { FrameContribution } from "./effectTypes";
import { clipEndUs, clipSourceTime } from "./timing";

/** Source/geometry resolution. The typed render graph carries title and
 * transition nodes, but FrameContribution is clip-only: it has one source crop,
 * scalar opacity and no dip-color or wipe-mask fact. Refuse those inputs rather
 * than silently drop required content until the preview composition contract is
 * extended.
 */
export function resolveTimelineFrame(plan: Readonly<TimelineRenderPlan>, timeUs: TimeUs): readonly FrameContribution[] {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0) return [];
  if (timeUs >= plan.duration_us) return [];
  if (plan.titles.some((t) => timeUs >= t.start_us && timeUs < t.end_us)) throw new TimelineError("timeline.unsupported");
  // The fixed contribution shape cannot carry wipe masks or dip-color layers.
  if (plan.transitions.some((t) => {
    const right = plan.tracks.flatMap((track) => track.clips).find((clip) => clip.id === t.right_clip_id);
    return right && timeUs >= right.start_us && timeUs < right.start_us + t.duration_us;
  })) throw new TimelineError("timeline.unsupported");
  const result: FrameContribution[] = [];
  for (const track of plan.tracks) {
    if (track.kind !== "video" || !track.visible) continue;
    for (const clip of track.clips) {
      if (timeUs < clip.start_us || timeUs >= clipEndUs(clip)) continue;
      if (clip.effects.some((effect) => effect.tag === "stabilize")) throw new TimelineError("timeline.unsupported");
      const crops = clip.effects.filter((effect) => effect.tag === "crop");
      if (crops.length > 1) throw new TimelineError("timeline.unsupported");
      result.push({
        clip_id: clip.id, source_id: clip.source_id, source_us: clipSourceTime(clip, timeUs), opacity: 1,
        crop: crops[0]?.rect ?? clip.transform.crop, rotation: clip.transform.rotation,
        effects: clip.effects.filter((effect) => effect.tag !== "crop"), z_order: track.index,
      });
    }
  }
  return result.sort((a, b) => a.z_order - b.z_order || a.clip_id.localeCompare(b.clip_id));
}
