import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MediaRecipe } from "../media-edit/types";
import { projectFromMediaRecipe, encodeTimelineFile } from "../timeline/projectCodec";
import { proxyPlan } from "../services/timeline";
import { clipDurationUs } from "../timeline/timing";
import { source, uuid } from "./timelineFixtures";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function recipe(): MediaRecipe {
  return {
    schema_version: 1,
    project_id: uuid(700),
    content_id: uuid(701),
    sources: [source()],
    segments: [
      { id: uuid(1), source_id: uuid(1), start_us: 0, end_us: 2_000_000, speed: 1 },
      { id: uuid(2), source_id: uuid(1), start_us: 2_000_000, end_us: 4_000_000, speed: 2 },
      { id: uuid(3), source_id: uuid(1), start_us: 4_000_000, end_us: 6_000_000, speed: 1 },
    ],
    crop: null,
    rotation: 0,
    volume: 1,
    mute: false,
    keep_pitch: true,
    subtitles: [
      { id: uuid(4), start_us: 0, end_us: 1_000_000, text: "Año" },
    ],
    subtitle_mode: "off",
    metadata_keep: true,
  };
}

function hash(sources: MediaRecipe["sources"]): string {
  const canonical = sources.map((item) => [
    item.id,
    item.path,
    item.stamp.path_key,
    item.stamp.volume_id,
    item.stamp.file_id,
    item.stamp.modified_ticks,
    item.stamp.size_bytes,
    item.duration_us,
    item.video_rate?.num ?? 0,
    item.video_rate?.den ?? 0,
    item.audio_rate ?? 0,
    item.sensitive,
  ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

describe("step 19a recipe import and help", () => {
  it("15recipe_import_preservessegments", () => {
    const mediaRecipe = recipe();
    const imported = projectFromMediaRecipe(mediaRecipe, {
      video_name: "Video 1",
      audio_name: "Audio 1",
      project_id: uuid(710),
      content_id: uuid(711),
    });
    const video = imported.tracks.find((track) => track.kind === "video");
    const audio = imported.tracks.find((track) => track.kind === "audio");
    expect(video?.clips).toHaveLength(3);
    expect(audio?.clips).toHaveLength(3);
    expect(video?.clips.map((clip) => clip.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(video?.clips.map((clip) => clip.start_us)).toEqual([
      0, 2_000_000, 3_000_000,
    ]);
    expect(video?.clips.map((clip) => [clip.source_in_us, clip.source_out_us])).toEqual([
      [0, 2_000_000],
      [2_000_000, 4_000_000],
      [4_000_000, 6_000_000],
    ]);
    // A 2 s segment at 2x keeps its source range but lasts 1 s.
    expect(clipDurationUs(video!.clips[1])).toBe(1_000_000);
    // Linked partners share the exact interval and speed.
    expect(audio?.clips[0].link_id).toBe(video?.clips[0].link_id);
    expect(imported.subtitles).toHaveLength(1);
    expect(imported.sources[0].path).toBe("C:\\media\\clip.mp4");
  });

  it("missingpack_fallback", () => {
    // A missing media pack disables proxies; it never disables the project or
    // pretends a proxy exists.
    expect(proxyPlan(960, true, false)).toBe("original");
    expect(proxyPlan(960, false, true)).toBe("original");
    expect(proxyPlan("source", true, true)).toBe("original");
    expect(proxyPlan(512, true, true)).toBe("proxy");
    const page = readFileSync(join(root, "help", "en", "timeline-proxies.md"), "utf8");
    expect(page).toMatch(/Originals remain unchanged/);
    expect(page).toMatch(/progress and \*\*Cancel\*\*/);
  });

  it("sourcehashes_unchanged", () => {
    const mediaRecipe = recipe();
    const before = hash(mediaRecipe.sources);
    const imported = projectFromMediaRecipe(mediaRecipe, {
      video_name: "Video 1",
      audio_name: "Audio 1",
    });
    const bytes = encodeTimelineFile(imported);
    expect(bytes.length).toBeGreaterThan(0);
    expect(hash(mediaRecipe.sources)).toBe(before);
    expect(hash(imported.sources)).toBe(before);
  });

  it("bilingual help pages agree", () => {
    const english = readdirSync(join(root, "help", "en"));
    const spanish = readdirSync(join(root, "help", "es"));
    expect(spanish).toEqual(english);
    for (const page of ["timeline.md", "timeline-clips.md", "timeline-proxies.md"]) {
      expect(english).toContain(page);
      expect(spanish).toContain(page);
    }
    expect(readFileSync(join(root, "help", "en", "timeline.md"), "utf8")).toMatch(
      /Projects reference source media/,
    );
    expect(readFileSync(join(root, "help", "es", "timeline.md"), "utf8")).toMatch(
      /Los proyectos hacen referencia al contenido de origen/,
    );
    expect(readFileSync(join(root, "help", "en", "timeline-clips.md"), "utf8")).toMatch(
      /ambiguous or locked edits are refused/,
    );
    expect(readFileSync(join(root, "help", "es", "timeline-clips.md"), "utf8")).toMatch(
      /las ediciones ambiguas o bloqueadas se rechazan/,
    );
  });

  it("required locale keys exist in both languages", () => {
    for (const language of ["en", "es"]) {
      const locale = JSON.parse(
        readFileSync(join(root, "src", "i18n", "locales", `${language}.json`), "utf8"),
      ) as Record<string, unknown>;
      const timeline = locale.timeline as Record<string, unknown> | undefined;
      expect(timeline, language).toBeTruthy();
      for (const key of [
        "title", "edit", "new", "addVideo", "addAudio", "trim", "split", "slip",
        "ripple", "snap", "proxy", "relink", "missing", "sourceChanged", "projectNotice",
      ]) {
        expect(timeline?.[key], `${language}.timeline.${key}`).toBeTruthy();
      }
      const errors = locale.errors as Record<string, unknown> | undefined;
      const timelineErrors = errors?.timeline as Record<string, unknown> | undefined;
      expect(timelineErrors?.failed, `${language}.errors.timeline.failed`).toBeTruthy();
    }
  });
});
