import { describe, expect, it } from "vitest";

import { applyTimelineOperation } from "../timeline/operations";
import { rippleDelete } from "../timeline/ripple";
import { snapTimelineTime } from "../timeline/snap";
import { relinkTimelineSource } from "../timeline/relink";
import type { MediaSource } from "../media-edit/types";
import { TimelineError } from "../timeline/types";
import { clip, project, source, track, uuid } from "./timelineFixtures";

function codeOf(action: () => unknown): string {
  try {
    action();
    return "";
  } catch (error) {
    return error instanceof TimelineError ? error.code : "not-a-timeline-error";
  }
}

describe("step 19a ripple, snap and relink", () => {
  it("ripple2..4_shiftslater6to4", () => {
    const initial = project({
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 0, source_in_us: 0, source_out_us: 1_000_000 }),
          clip({ id: 2, start_us: 2_000_000, source_in_us: 2_000_000, source_out_us: 4_000_000 }),
          clip({ id: 3, start_us: 6_000_000, source_in_us: 6_000_000, source_out_us: 7_000_000 }),
        ]),
      ],
    });
    const next = rippleDelete(initial, uuid(10), [uuid(2)]);
    expect(next.tracks[0].clips.map((item) => item.id)).toEqual([uuid(1), uuid(3)]);
    expect(next.tracks[0].clips[0].start_us).toBe(0);
    expect(next.tracks[0].clips[1].start_us).toBe(4_000_000);
    // Ordinary delete leaves the gap.
    const ordinary = applyTimelineOperation(initial, {
      kind: "delete_clips",
      ids: [uuid(2)],
      ripple: false,
    });
    expect(ordinary.tracks[0].clips[1].start_us).toBe(6_000_000);
  });

  it("unselectedclip_in_ripple_range_refused", () => {
    const initial = project({
      tracks: [
        track(11, "audio", 0, [
          clip({ id: 1, start_us: 0, source_in_us: 0, source_out_us: 1_000_000 }),
          clip({ id: 2, start_us: 2_000_000, source_in_us: 2_000_000, source_out_us: 4_000_000 }),
          clip({ id: 3, start_us: 3_000_000, source_in_us: 3_000_000, source_out_us: 4_000_000 }),
        ]),
      ],
    });
    expect(codeOf(() => rippleDelete(initial, uuid(11), [uuid(2)]))).toBe(
      "timeline.bad_request",
    );
  });

  it("snap_tie_earliertime", () => {
    const initial = project({
      frame_rate: { num: 1, den: 1_000 },
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 4_000_000, source_in_us: 4_000_000, source_out_us: 5_000_000 }),
        ]),
      ],
    });
    const result = snapTimelineTime(initial, 3_000_000, {
      pixels_per_second: 1,
      playhead_us: 2_000_000,
      frame_rate: initial.frame_rate,
    });
    // Playhead 2 s and clip start 4 s are both 1 s away; earlier time wins.
    expect(result.time_us).toBe(2_000_000);
    expect(result.target).toBe("playhead");
  });

  it("relink_shortsource_nochange", () => {
    const initial = project({
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 0, source_in_us: 0, source_out_us: 5_000_000 }),
        ]),
      ],
    });
    const replacement: MediaSource = {
      ...source(1, "C:\\media\\moved.mp4"),
      duration_us: 4_000_000,
    };
    const snapshot = JSON.stringify(initial);
    expect(codeOf(() => relinkTimelineSource(initial, uuid(1), replacement))).toBe(
      "timeline.bad_request",
    );
    expect(JSON.stringify(initial)).toBe(snapshot);
    // A long enough replacement preserves the clip and every edit.
    const good = relinkTimelineSource(initial, uuid(1), {
      ...source(1, "C:\\media\\moved.mp4"),
      duration_us: 20_000_000,
    });
    expect(good.tracks[0].clips[0].id).toBe(uuid(1));
    expect(good.tracks[0].clips[0].source_in_us).toBe(0);
    expect(good.tracks[0].clips[0].source_out_us).toBe(5_000_000);
    expect(good.sources[0].path).toBe("C:\\media\\moved.mp4");
  });
});
