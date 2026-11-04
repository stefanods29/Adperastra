import { describe, expect, it } from "vitest";

import {
  decodeTimelineFileBytes,
  encodeTimelineFile,
  saveCopyIdentity,
} from "../timeline/projectCodec";
import { encodeTimelineProject, validateTimelineProject } from "../timeline/projectValidation";
import type { TimelineProject } from "../timeline/types";
import { clip, project, source, track, uuid } from "./timelineFixtures";

function sample(): TimelineProject {
  return project({
    frame_rate: { num: 30_000, den: 1_001 },
    tracks: [
      track(10, "video", 0, [
        clip({
          id: 1,
          start_us: 1_234_567,
          source_in_us: 111_111,
          source_out_us: 4_567_891,
          speed: { num: 1, den: 2 },
        }),
      ]),
    ],
  });
}

describe("step 19a project codec", () => {
  it("project_roundtrip_exactIDs_timebase", () => {
    const original = sample();
    const bytes = encodeTimelineFile(original);
    const decoded = decodeTimelineFileBytes(bytes);
    expect(decoded.kind).toBe("project");
    if (decoded.kind !== "project") return;
    expect(decoded.project).toEqual(original);
    expect(decoded.project.project_id).toBe(uuid(100));
    expect(decoded.project.content_id).toBe(uuid(101));
    expect(decoded.project.tracks[0].clips[0].id).toBe(uuid(1));
    expect(decoded.project.tracks[0].clips[0].start_us).toBe(1_234_567);
    expect(decoded.project.tracks[0].clips[0].speed).toEqual({ num: 1, den: 2 });
    expect(decoded.project.frame_rate).toEqual({ num: 30_000, den: 1_001 });
  });

  it("no_grants_serialized", () => {
    const base = sample();
    const withSecrets = {
      ...base,
      token: "SECRET-TOKEN",
      grant: "SECRET-GRANT",
      password: "SECRET-PASSWORD",
      sources: base.sources.map((item) => ({
        ...item,
        token: "SECRET-TOKEN",
        grant: "SECRET-GRANT",
        password: "SECRET-PASSWORD",
      })),
    } as unknown as TimelineProject;
    const text = encodeTimelineProject(withSecrets);
    expect(text).not.toContain("SECRET-TOKEN");
    expect(text).not.toContain("SECRET-GRANT");
    expect(text).not.toContain("SECRET-PASSWORD");
    expect(text).not.toContain('"token"');
    expect(text).not.toContain('"grant"');
  });

  it("SaveCopy_notclean", () => {
    const original = sample();
    const before = JSON.stringify(original);
    const copy = saveCopyIdentity(original);
    expect(copy.content_id).toBe(original.content_id);
    expect(JSON.stringify(original)).toBe(before);
    const decoded = decodeTimelineFileBytes(copy.bytes);
    expect(decoded.kind).toBe("project");
    if (decoded.kind === "project") {
      expect(decoded.project.content_id).toBe(original.content_id);
      expect(decoded.project.tracks[0].clips[0].id).toBe(uuid(1));
    }
    const text = new TextDecoder().decode(copy.bytes);
    expect(text).not.toContain('"saved"');
    expect(text).not.toContain('"saved_revision"');
  });

  it("missing_source_keepsclips", () => {
    const missing = project({
      sources: [source(1, "C:\\media\\moved-away\\gone.mp4")],
      tracks: [
        track(10, "video", 0, [
          clip({ id: 7, start_us: 0, source_in_us: 0, source_out_us: 2_000_000 }),
        ]),
      ],
    });
    const bytes = encodeTimelineFile(missing);
    const decoded = decodeTimelineFileBytes(bytes);
    expect(decoded.kind).toBe("project");
    if (decoded.kind !== "project") return;
    // A missing file is a runtime state, never a reason to drop the edit.
    expect(decoded.project.tracks[0].clips).toHaveLength(1);
    expect(decoded.project.tracks[0].clips[0].id).toBe(uuid(7));
    expect(decoded.project.sources[0].path).toBe("C:\\media\\moved-away\\gone.mp4");
    expect(validateTimelineProject(decoded.project).tracks[0].clips).toHaveLength(1);
  });
});
