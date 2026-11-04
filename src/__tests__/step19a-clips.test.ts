import { describe, expect, it } from "vitest";

import { applyTimelineOperation } from "../timeline/operations";
import { TimelineError, type TimelineProject } from "../timeline/types";
import { clipDurationUs, clipEndUs } from "../timeline/timing";
import { clip, project, track, uuid } from "./timelineFixtures";

function codeOf(action: () => unknown): string {
  try {
    action();
    return "";
  } catch (error) {
    return error instanceof TimelineError ? error.code : "not-a-timeline-error";
  }
}

function linkedProject(): TimelineProject {
  const link = uuid(500);
  return project({
    tracks: [
      track(10, "video", 0, [
        clip({ id: 1, start_us: 0, source_in_us: 0, source_out_us: 4_000_000, link_id: link }),
      ]),
      track(
        11,
        "audio",
        1,
        [clip({ id: 2, start_us: 0, source_in_us: 0, source_out_us: 4_000_000, link_id: link })],
        true,
      ),
    ],
  });
}

describe("step 19a clip transactions", () => {
  it("split_preserves_sourceinterval", () => {
    const initial = project({
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 0, source_in_us: 1_000_000, source_out_us: 5_000_000 }),
        ]),
      ],
    });
    const next = applyTimelineOperation(initial, {
      kind: "split_clip",
      id: uuid(1),
      time_us: 2_000_000,
    });
    const clips = next.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].source_in_us).toBe(1_000_000);
    expect(clips[0].source_out_us).toBe(3_000_000);
    expect(clips[1].source_in_us).toBe(3_000_000);
    expect(clips[1].source_out_us).toBe(5_000_000);
    expect(clips[1].start_us).toBe(2_000_000);
    // The source interval is contiguous and the timeline is unchanged in span.
    expect(clips[0].source_out_us).toBe(clips[1].source_in_us);
    expect(clipEndUs(clips[1])).toBe(4_000_000);
    // A boundary split is a no-op and records no history entry.
    expect(
      applyTimelineOperation(initial, {
        kind: "split_clip",
        id: uuid(1),
        time_us: 0,
      }),
    ).toBe(initial);
  });

  it("slip_keepsduration", () => {
    const initial = project({
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 1_000_000, source_in_us: 1_000_000, source_out_us: 3_000_000 }),
        ]),
      ],
    });
    const before = initial.tracks[0].clips[0];
    const next = applyTimelineOperation(initial, {
      kind: "slip_clip",
      id: uuid(1),
      delta_us: 1_000_000,
    });
    const after = next.tracks[0].clips[0];
    expect(after.start_us).toBe(before.start_us);
    expect(clipDurationUs(after)).toBe(clipDurationUs(before));
    expect(after.source_in_us).toBe(2_000_000);
    expect(after.source_out_us).toBe(4_000_000);
    // Slipping past the source end is refused, not clamped.
    expect(
      codeOf(() =>
        applyTimelineOperation(next, {
          kind: "slip_clip",
          id: uuid(1),
          delta_us: 19_000_000,
        }),
      ),
    ).toBe("timeline.bad_request");
  });

  it("lockedlinkedpartner_refusesall", () => {
    const initial = linkedProject();
    const snapshot = JSON.stringify(initial);
    for (const operation of [
      { kind: "trim_clip" as const, id: uuid(1), in_us: 1_000_000, out_us: 4_000_000 },
      { kind: "move_clip" as const, id: uuid(1), track_id: uuid(10), start_us: 2_000_000 },
      { kind: "split_clip" as const, id: uuid(1), time_us: 2_000_000 },
    ]) {
      expect(codeOf(() => applyTimelineOperation(initial, operation))).toBe("timeline.locked");
      expect(JSON.stringify(initial)).toBe(snapshot);
    }
  });

  it("move_same_track_overlaprefused", () => {
    const initial = project({
      tracks: [
        track(10, "video", 0, [
          clip({ id: 1, start_us: 0, source_in_us: 0, source_out_us: 2_000_000 }),
          clip({ id: 2, start_us: 3_000_000, source_in_us: 3_000_000, source_out_us: 5_000_000 }),
        ]),
      ],
    });
    expect(
      codeOf(() =>
        applyTimelineOperation(initial, {
          kind: "move_clip",
          id: uuid(2),
          track_id: uuid(10),
          start_us: 1_000_000,
        }),
      ),
    ).toBe("timeline.overlap");
  });
});
