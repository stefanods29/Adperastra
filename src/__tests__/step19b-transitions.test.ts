import { describe, expect, it } from "vitest";
import { clip, project, track, uuid, videoProject } from "./timelineFixtures";
import { setTimelineTransition, transitionWeights } from "../timeline/transitions";
import { titleAnimation } from "../timeline/titles";
import type { TimelineTitle, TimelineTransition } from "../timeline/types";

function fixture() {
  const left = clip({ id: 20, start_us: 0, source_out_us: 10_000_000 });
  const right = clip({ id: 21, start_us: 10_000_000, source_out_us: 10_000_000 });
  const transition: TimelineTransition = {
    id: uuid(30), track_id: uuid(10), left_clip_id: left.id, right_clip_id: right.id,
    kind: "crossfade", duration_us: 1_000_000, direction: "left", rgba: [0, 0, 0, 255], enabled: true,
  };
  return { model: videoProject([left, right]), left, right, transition };
}

describe("19b transitions and title timing", () => {
  it("crossfade_midpoint_weights0.5/0.5", () => {
    expect(transitionWeights("crossfade", 0.5)).toEqual({ left: 0.5, right: 0.5, color: 0 });
  });
  it("addD1s_shiftsright10sto9s", () => {
    const { model, left, right, transition } = fixture();
    const next = setTimelineTransition(model, left.id, right.id, transition);
    expect(next.tracks[0].clips[1].start_us).toBe(9_000_000);
    expect(model.tracks[0].clips[1].start_us).toBe(10_000_000);
    expect(next.tracks[0].clips[1].source_in_us).toBe(right.source_in_us);
    expect(next.tracks[0].clips[1].source_out_us).toBe(right.source_out_us);
  });
  it("remove_restores10s", () => {
    const { model, left, right, transition } = fixture();
    const added = setTimelineTransition(model, left.id, right.id, transition);
    const removed = setTimelineTransition(added, left.id, right.id, null);
    expect(removed.tracks[0].clips[1].start_us).toBe(10_000_000);
    expect(removed.transitions).toEqual([]);
  });
  it("duration change uses delta and does not move absolute titles or cues", () => {
    const { model, left, right, transition } = fixture();
    const added = setTimelineTransition(model, left.id, right.id, transition);
    const changed = setTimelineTransition(added, left.id, right.id, { ...transition, duration_us: 2_000_000 });
    expect(changed.tracks[0].clips[1].start_us).toBe(8_000_000);
  });
  it("locked linked partner refuses all shifts", () => {
    const { left, right, transition } = fixture();
    right.link_id = uuid(70);
    const audio = { ...right, id: uuid(22) };
    const model = project({ tracks: [track(10, "video", 0, [left, right]), track(11, "audio", 1, [audio], true)] });
    const before = JSON.stringify(model);
    expect(() => setTimelineTransition(model, left.id, right.id, transition)).toThrow("timeline.locked");
    expect(JSON.stringify(model)).toBe(before);
  });
  it("title_text_not_filtercode", () => {
    const title: TimelineTitle = {
      id: uuid(40), track_id: uuid(10), start_us: 0, end_us: 2_000_000,
      text: "<script>throw 1</script>;[in]drawtext=file=secret",
      style: { font_asset_id: "inter-regular", font_size: 24, rgba: [255, 255, 255, 255], align: "left", x: 0.5, y: 0.5 },
      animation: "fade", animation_us: 1_000_000,
    };
    const before = JSON.stringify(title);
    expect(titleAnimation(title, 500_000, 1920, 400)).toEqual({ opacity: 0.5, x: 0.5, y: 0.5 });
    expect(JSON.stringify(title)).toBe(before);
  });
});
