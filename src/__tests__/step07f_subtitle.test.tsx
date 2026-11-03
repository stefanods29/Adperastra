import { describe, expect, it } from "vitest";
import { findCues, formatCueTime } from "../handlers/subtitle/SubtitleView";
import { subtitleMarkup } from "./step07fFixtures";

describe("subtitle display", () => {
  it("formats 1250 ms as 00:00:01.250", () => {
    expect(formatCueTime(1_250)).toBe("00:00:01.250");
    expect(formatCueTime(2_500)).toBe("00:00:02.500");
  });

  it("finds literal cue text without executing markup", () => {
    const cues = [
      { index: 0, start_ms: 1_000, end_ms: 2_000, text: subtitleMarkup },
      { index: 1, start_ms: 2_000, end_ms: 3_000, text: "Other" },
    ];
    expect(findCues(cues, "hello")).toEqual([0]);
    expect(findCues(cues, "<script>")).toEqual([]);
  });
});
