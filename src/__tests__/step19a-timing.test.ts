import { describe, expect, it } from "vitest";

import {
  clipDurationUs,
  clipSourceTime,
  frameTime,
  playbackRateFromNumber,
} from "../timeline/timing";
import {
  decodeTimelineFile,
  validateTimelineProject,
} from "../timeline/projectValidation";
import { TimelineError } from "../timeline/types";
import { clip, source, track, uuid } from "./timelineFixtures";

function codeOf(action: () => unknown): string {
  try {
    action();
    return "";
  } catch (error) {
    return error instanceof TimelineError ? error.code : "not-a-timeline-error";
  }
}

describe("step 19a exact timing", () => {
  it("frame30at30000/1001=>1001000us", () => {
    const rate = { num: 30_000, den: 1_001 };
    expect(frameTime(0, rate)).toBe(0);
    expect(frameTime(1, rate)).toBe(33_366);
    expect(frameTime(30, rate)).toBe(1_001_000);
    expect(frameTime(30_000, rate)).toBe(1_001_000_000);
    // The rational is reduced exactly; no floating FPS is accumulated.
    expect(playbackRateFromNumber(2)).toEqual({ num: 2, den: 1 });
    expect(playbackRateFromNumber(0.5)).toEqual({ num: 1, den: 2 });
  });

  it("clip4sat2x=>2s", () => {
    const value = clip({
      id: 1,
      start_us: 0,
      source_in_us: 1_000_000,
      source_out_us: 5_000_000,
      speed: { num: 2, den: 1 },
    });
    expect(clipDurationUs(value)).toBe(2_000_000);
    expect(clipSourceTime(value, 0)).toBe(1_000_000);
    expect(clipSourceTime(value, 1_000_000)).toBe(3_000_000);
    // The last microsecond is clamped below source_out.
    expect(clipSourceTime(value, 2_000_000)).toBe(4_999_999);
    expect(clipSourceTime(value, 99_000_000)).toBe(4_999_999);
  });

  it("unsafeinteger_refused", () => {
    expect(codeOf(() => frameTime(Number.MAX_SAFE_INTEGER, { num: 1, den: 1 }))).toBe(
      "timeline.bad_request",
    );
    const unsafe = {
      schema_version: 1,
      project_id: uuid(100),
      content_id: uuid(101),
      sources: [source()],
      tracks: [
        track(10, "video", 0, [
          {
            ...clip({ id: 1, start_us: Number.MAX_SAFE_INTEGER + 1, source_out_us: 1_000_000 }),
          },
        ]),
      ],
      width: 1920,
      height: 1080,
      frame_rate: { num: 30, den: 1 },
      audio_rate: 48_000,
      audio_channels: 2,
      transitions: [],
      titles: [],
      subtitles: [],
    };
    expect(codeOf(() => validateTimelineProject(unsafe))).toBe("timeline.bad_request");
  });

  it("project_schema_newer_preserved", () => {
    const raw = JSON.stringify({ schema_version: 2, future: { nested: true } });
    const parsed = decodeTimelineFile(raw);
    expect(parsed.kind).toBe("newer");
    if (parsed.kind === "newer") {
      expect(parsed.schema_version).toBe(2);
      expect(parsed.raw).toBe(raw);
    }
    const current = decodeTimelineFile(
      JSON.stringify({
        schema_version: 1,
        project_id: uuid(100),
        content_id: uuid(101),
        sources: [source()],
        tracks: [track(10, "video", 0, [])],
        width: 1920,
        height: 1080,
        frame_rate: { num: 30, den: 1 },
        audio_rate: 48_000,
        audio_channels: 2,
        transitions: [],
        titles: [],
        subtitles: [],
      }),
    );
    expect(current.kind).toBe("project");
  });
});
