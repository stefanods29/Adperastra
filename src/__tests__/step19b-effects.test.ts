import { describe, expect, it } from "vitest";
import { applyColorEffects } from "../timeline/colorEffects";
import { wipeRevealsPixel, compositeTransitionPixel } from "../timeline/previewComposite";
import { clip, videoProject } from "./timelineFixtures";
import { normalizeTimeline } from "../timeline/renderPlan";
import { clipSourceTime } from "../timeline/timing";
import { resolveTimelineFrame } from "../timeline/resolveFrame";

describe("19b shared frame math", () => {
  it("preview_export_same_source_time", () => {
    const item = clip({ id: 20, start_us: 0, source_in_us: 1_000_000, source_out_us: 5_000_000, speed: { num: 2, den: 1 } });
    const plan = normalizeTimeline(videoProject([item]));
    const preview = resolveTimelineFrame(plan, 500_000);
    const exported = resolveTimelineFrame(plan, 500_000);
    expect(preview).toEqual(exported);
    expect(preview[0].source_us).toBe(clipSourceTime(item, 500_000));
    expect(preview[0].source_us).toBe(2_000_000);
    expect(resolveTimelineFrame(plan, plan.duration_us)).toEqual([]);
  });
  it("unsupported_stabilize_refused", () => {
    expect(() => applyColorEffects([0.5, 0.3, 0.1, 1], [{ tag: "stabilize", strength: 0.5 }])).toThrow("timeline.unsupported");
  });
  it("gamma1_identity", () => {
    expect(applyColorEffects([0.2, 0.4, 0.8, 0.25], [{ tag: "color", gamma: [1, 1, 1] }])).toEqual([0.2, 0.4, 0.8, 0.25]);
  });
  it("wipe_half_reveals_halfwidth", () => {
    for (const direction of ["left", "right"] as const) {
      expect(Array.from({ length: 8 }, (_, x) => wipeRevealsPixel(direction, 0.5, x, 0, 8, 2)).filter(Boolean)).toHaveLength(4);
    }
    expect(wipeRevealsPixel("left", 0, 0, 0, 8, 2)).toBe(false);
    expect(wipeRevealsPixel("left", 1, 7, 0, 8, 2)).toBe(true);
  });
  it("premultiplied linear crossfade keeps transparent colors out", () => {
    expect(compositeTransitionPixel([1, 0, 0, 0], [0, 0, 1, 1], "crossfade", 0.5, [0, 0, 0, 1]))
      .toEqual([0, 0, 0.5, 0.5]);
  });
});
