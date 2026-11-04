import { describe, expect, it } from "vitest";
import { srtTimestamp, timelineSrt, validateTimelineSubtitles } from "../timeline/subtitleTimeline";
import { subtitleFrames } from "../timeline/subtitleFrames";
import { applyTimelineEffect } from "../timeline/effects";
import { registerTimelineTransactionHost } from "../timeline/transactions";
import { clip, uuid, videoProject } from "./timelineFixtures";

describe("19b plain subtitles", () => {
  it("1000001us_start=>00:00:01,000", () => expect(srtTimestamp(1_000_001, "start")).toBe("00:00:01,000"));
  it("1000001us_end=>00:00:01,001", () => expect(srtTimestamp(1_000_001, "end")).toBe("00:00:01,001"));
  it("scripttext_notexecute", () => {
    const text = "<script>throw 1</script>{\\an8}https://example.invalid";
    const cues = [{ id: uuid(50), start_us: 1_000_001, end_us: 2_000_001, text }];
    expect(subtitleFrames(cues, 1_000_001)[0].text).toBe(text);
    expect(subtitleFrames(cues, 2_000_001)).toEqual([]);
    expect(timelineSrt(cues)).toBe(`1\n00:00:01,000 --> 00:00:02,001\n${text}\n\n`);
  });
  it("cueedit_oneUndo", async () => {
    const current = videoProject([clip({ id: 20, start_us: 0, source_out_us: 2_000_000 })]);
    let model = current;
    let commits = 0;
    const release = registerTimelineTransactionHost({
      documentId: "test-subtitles", getProject: () => model, getRevision: () => commits,
      getContentId: () => model.content_id,
      commitProject: async (next) => { commits++; model = next; },
    });
    try {
      await applyTimelineEffect("test-subtitles", current.content_id, {
        kind: "set_subtitles", cues: [{ id: uuid(50), start_us: 1_000_001, end_us: 2_000_001, text: "Año" }],
      });
      expect(commits).toBe(1);
      expect(model.subtitles[0].text).toBe("Año");
    } finally { release(); }
  });
  it("overlaps stay visible and equal starts sort by ID", () => {
    const cues = validateTimelineSubtitles([
      { id: uuid(51), start_us: 1, end_us: 100, text: "B" },
      { id: uuid(50), start_us: 1, end_us: 200, text: "A" },
    ]);
    expect(subtitleFrames(cues, 50).map((c) => c.text)).toEqual(["A", "B"]);
  });
  it("invalid and over-budget cues refuse without truncation", () => {
    expect(() => validateTimelineSubtitles([{ id: uuid(50), start_us: 2, end_us: 2, text: "" }])).toThrow();
    expect(() => validateTimelineSubtitles([{ id: uuid(50), start_us: 1, end_us: 2, text: "x".repeat(8193) }])).toThrow();
  });
});
