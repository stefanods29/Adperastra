import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clip, uuid, videoProject } from "./timelineFixtures";
import { encodeTimelineProject, decodeTimelineFile } from "../timeline/projectValidation";
import { setTimelineTransition } from "../timeline/transitions";

describe("19b help and persisted project", () => {
  it("project_roundtrip_effects_titles_cues", () => {
    const first = clip({ id: 20, start_us: 0, source_out_us: 10_000_000 });
    const second = clip({ id: 21, start_us: 10_000_000, source_out_us: 10_000_000 });
    first.effects = [{ tag: "color", gamma: [1, 2, 0.5] }];
    const model = setTimelineTransition(videoProject([first, second]), first.id, second.id, {
      id: uuid(30), track_id: uuid(10), left_clip_id: first.id, right_clip_id: second.id,
      kind: "crossfade", duration_us: 1_000_000, direction: "left", rgba: [0, 0, 0, 255], enabled: true,
    });
    model.tracks.push({ id: uuid(11), index: 1, kind: "video", name: "Titles", locked: false, visible: true, gain: 1, mute: false, solo: false, clips: [] });
    model.titles = [{ id: uuid(40), track_id: uuid(11), start_us: 0, end_us: 1_000_000, text: "Año",
      animation: "fade", animation_us: 500_000,
      style: { font_asset_id: "inter-regular", font_size: 24, rgba: [255, 255, 255, 255], align: "left", x: 0.5, y: 0.5 } }];
    model.subtitles = [{ id: uuid(50), start_us: 1_000_001, end_us: 2_000_001, text: "<script>plain</script>" }];
    // `setTimelineTransition` clones with structuredClone; under Vitest's
    // vmThreads pool that yields objects from the worker realm, which the
    // strict project validator refuses. Round-trip to this realm's plain
    // objects before serializing; the persisted content is unchanged.
    const plain = JSON.parse(JSON.stringify(model)) as typeof model;
    const decoded = decodeTimelineFile(encodeTimelineProject(plain));
    expect(decoded.kind).toBe("project");
    if (decoded.kind !== "project") throw new Error("expected project");
    expect(decoded.project.transitions).toEqual(model.transitions);
    expect(decoded.project.titles).toEqual(model.titles);
    expect(decoded.project.subtitles).toEqual(model.subtitles);
    expect(decoded.project.tracks[0].clips[0].effects).toEqual(first.effects);
  });
  it("four help slugs exist in English and Spanish", () => {
    for (const slug of ["timeline-transitions", "timeline-effects", "timeline-audio", "timeline-export"]) {
      for (const locale of ["en", "es"]) {
        const page = readFileSync(resolve("help", locale, `${slug}.md`), "utf8");
        expect(page).toMatch(/^# .+/);
        expect(page).toContain(locale === "en" ? "See also:" : "Consulta también:");
        expect(page).not.toContain("<script");
      }
    }
  });
});
