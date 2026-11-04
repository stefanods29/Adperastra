import { describe, expect, it } from "vitest";
import type { MediaRecipe, MediaSource } from "../media-edit/types";
import {
  formatTimeUs,
  mediaRecipeDurationUs,
  nudgeTimeUs,
  outputToSource,
  parseTimeUs,
  removeRange,
  segmentOutputDurationUs,
  splitSegments,
  trimSegments,
  withSegments,
} from "../media-edit/timing";
import { applyMediaEditOperation } from "../media-edit/operations";

const STAMP = {
  path_key: "C:\\media\\sample.mp4",
  volume_id: "00000000",
  file_id: "0000000000000001",
  modified_ticks: "100",
  size_bytes: 4096,
};

function source(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    path: "C:\\media\\sample.mp4",
    stamp: STAMP,
    duration_us: 10_000_000,
    video_rate: { num: 30, den: 1 },
    audio_rate: 48_000,
    sensitive: false,
    ...overrides,
  };
}

function recipe(overrides: Partial<MediaRecipe> = {}): MediaRecipe {
  return {
    schema_version: 1,
    project_id: "22222222-2222-4222-8222-222222222222",
    content_id: "33333333-3333-4333-8333-333333333333",
    sources: [source()],
    segments: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        source_id: "11111111-1111-4111-8111-111111111111",
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
    ...overrides,
  };
}

describe("media timing", () => {
  it("cut 2s..4s from 10s gives 8s", () => {
    const cut = withSegments(recipe(), removeRange(recipe(), 2_000_000, 4_000_000));
    expect(mediaRecipeDurationUs(cut)).toBe(8_000_000);
    expect(cut.segments).toHaveLength(2);
    expect(cut.segments[0]).toMatchObject({ start_us: 0, end_us: 2_000_000 });
    expect(cut.segments[1]).toMatchObject({ start_us: 4_000_000, end_us: 10_000_000 });
  });

  it("split at 5s preserves the 10s total and both source spans", () => {
    const split = withSegments(recipe(), splitSegments(recipe(), 5_000_000));
    expect(mediaRecipeDurationUs(split)).toBe(10_000_000);
    expect(split.segments).toHaveLength(2);
    expect(split.segments[0].end_us).toBe(5_000_000);
    expect(split.segments[1].start_us).toBe(5_000_000);
    expect(split.segments[0].end_us - split.segments[0].start_us + (split.segments[1].end_us - split.segments[1].start_us)).toBe(
      10_000_000,
    );
  });

  it("a boundary split is a no-op and changes no id", () => {
    const split = withSegments(recipe(), splitSegments(recipe(), 5_000_000));
    const again = withSegments(split, splitSegments(split, 5_000_000));
    expect(again.segments.map((segment) => segment.id)).toEqual(split.segments.map((segment) => segment.id));
    expect(mediaRecipeDurationUs(again)).toBe(10_000_000);
  });

  it("speed 2 on a 4s range gives 2s", () => {
    const timed = withSegments(recipe(), [
      { ...recipe().segments[0], start_us: 0, end_us: 4_000_000, speed: 2 },
    ]);
    expect(segmentOutputDurationUs(timed.segments[0])).toBe(2_000_000);
    expect(mediaRecipeDurationUs(timed)).toBe(2_000_000);
  });

  it("empty segments are refused", () => {
    expect(() => removeRange(recipe(), 0, 10_000_000)).toThrow("media_edit.bad_request");
    expect(() => applyMediaEditOperation(recipe(), { kind: "set_segments", segments: [] })).toThrow(
      "media_edit.bad_request",
    );
  });

  it("output 6s after a 2s..4s cut maps to source 8s", () => {
    const cut = withSegments(recipe(), removeRange(recipe(), 2_000_000, 4_000_000));
    const mapped = outputToSource(cut, 6_000_000);
    expect(mapped.source_us).toBe(8_000_000);
    expect(mapped.segment_id).toBe(cut.segments[1].id);
  });

  it("the final sample is exclusive and clamped", () => {
    const cut = withSegments(recipe(), removeRange(recipe(), 2_000_000, 4_000_000));
    const mapped = outputToSource(cut, 99_000_000);
    expect(mapped.source_us).toBe(9_999_999);
    expect(outputToSource(cut, 0).source_us).toBe(0);
  });

  it("keeps exact integer microseconds", () => {
    const timed = withSegments(recipe(), [
      { ...recipe().segments[0], start_us: 1_000_001, end_us: 9_999_999, speed: 1 },
    ]);
    expect(mediaRecipeDurationUs(timed)).toBe(8_999_998);
    expect(outputToSource(timed, 1).source_us).toBe(1_000_002);
  });

  it("trims only the overlapping source range", () => {
    const trimmed = withSegments(recipe(), trimSegments(recipe(), 2_000_000, 7_000_000));
    expect(mediaRecipeDurationUs(trimmed)).toBe(5_000_000);
    expect(trimmed.segments[0]).toMatchObject({ start_us: 2_000_000, end_us: 7_000_000 });
  });
});

describe("timecode inputs and keyboard ranges", () => {
  it("parses and formats without floating point", () => {
    expect(parseTimeUs("00:00:02.000")).toBe(2_000_000);
    expect(parseTimeUs("01:02:03.004")).toBe(3_723_004_000);
    expect(parseTimeUs("02:03.5")).toBe(123_500_000);
    expect(formatTimeUs(3_723_004_000)).toBe("01:02:03.004");
  });

  it("nudges start and end inside the duration", () => {
    expect(nudgeTimeUs(2_000_000, -1_000_000, 10_000_000)).toBe(1_000_000);
    expect(nudgeTimeUs(0, -1_000_000, 10_000_000)).toBe(0);
    expect(nudgeTimeUs(10_000_000, 1_000_000, 10_000_000)).toBe(10_000_000);
  });
});
