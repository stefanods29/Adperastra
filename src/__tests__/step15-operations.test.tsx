import { afterEach, describe, expect, it } from "vitest";
import type { DocumentHandle } from "../documents/types";
import type { MediaRecipe } from "../media-edit/types";
import { mediaRecipeBytes } from "../media-edit/types";
import {
  acquireMediaEditor,
  createMediaEditorController,
} from "../media-edit/MediaDocument";
import {
  applyMediaEditOperation,
  rotateWithin,
  setCropWithin,
} from "../media-edit/operations";
import { assertMediaCropWithin, orientedSourceSize } from "../media-edit/types";

const contentId = "33333333-3333-4333-8333-333333333333";

function recipe(): MediaRecipe {
  return {
    schema_version: 1,
    project_id: "22222222-2222-4222-8222-222222222222",
    content_id: contentId,
    sources: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        path: "C:\\media\\sample.mp4",
        stamp: {
          path_key: "C:\\media\\sample.mp4",
          volume_id: "00000000",
          file_id: "0000000000000001",
          modified_ticks: "100",
          size_bytes: 4096,
        },
        duration_us: 10_000_000,
        video_rate: { num: 30, den: 1 },
        audio_rate: 48_000,
        sensitive: false,
      },
    ],
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
  };
}

function documentWith(bytes: Uint8Array): DocumentHandle {
  const value = recipe();
  return {
    id: "55555555-5555-4555-8555-555555555555",
    source: { kind: "disk", path: value.sources[0].path },
    info: {
      document_id: value.project_id,
      name: "sample - Edited.admedia",
      ext: "admedia",
      mime: "application/vnd.adperastra.media-edit+json",
      size: bytes.byteLength,
      modified_unix: 1,
      read_only: false,
      from_internet: false,
      sensitive: false,
      disk_path: value.sources[0].path,
      source: { kind: "disk", path: value.sources[0].path },
    },
    getState: () => ({
      revision: 1,
      saved_revision: 1,
      content_id: contentId,
      saved_content_id: contentId,
      dirty: false,
      ready: true,
      editing_enabled: true,
      can_save_existing: true,
      can_save_copy: true,
      status_code: null,
      read_only_reason: null,
    }),
    subscribe: () => () => undefined,
    readRange: async (offset: number, length: number) => bytes.slice(offset, offset + length),
    captureSnapshot: async () => {
      throw new Error("not used");
    },
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  } as unknown as DocumentHandle;
}

const acquired: Array<{ release: () => void }> = [];

afterEach(() => {
  while (acquired.length > 0) acquired.pop()?.release();
});

describe("media recipe operations", () => {
  it("refuses a crop outside the oriented source", () => {
    expect(() => assertMediaCropWithin({ x: 100, y: 0, width: 50, height: 40 }, 120, 68, 0)).toThrow(
      "media_edit.bad_request",
    );
    expect(() => setCropWithin(recipe(), { x: 90, y: 0, width: 40, height: 40 }, 120, 68)).toThrow(
      "media_edit.bad_request",
    );
    expect(orientedSourceSize(120, 68, 90)).toEqual({ width: 68, height: 120 });
    expect(() => assertMediaCropWithin({ x: 0, y: 0, width: 68, height: 120 }, 120, 68, 90)).not.toThrow();
  });

  it("mute changes no source and keeps every segment", () => {
    const before = recipe();
    const next = applyMediaEditOperation(before, { kind: "set_gain", volume: 0.5, mute: true });
    expect(next.sources).toEqual(before.sources);
    expect(next.segments).toEqual(before.segments);
    expect(next.volume).toBe(0.5);
    expect(next.mute).toBe(true);
  });

  it("a refused operation leaves the recipe and content id untouched", async () => {
    const controller = createMediaEditorController(recipe());
    acquired.push(controller);
    const before = controller.getRecipe();
    await expect(
      controller.apply({ kind: "set_speed", segment_id: before.segments[0].id, speed: 9 }),
    ).rejects.toThrow("media_edit.bad_request");
    expect(controller.getRecipe()).toEqual(before);
    expect(controller.getRecipe().content_id).toBe(contentId);
  });

  it("two views of one document share the same recipe", async () => {
    const bytes = mediaRecipeBytes(recipe());
    const document = documentWith(bytes);
    const first = await acquireMediaEditor(document);
    const second = await acquireMediaEditor(document);
    acquired.push(first, second);
    expect(second).toBe(first);
    await first.apply({
      kind: "set_segments",
      segments: [{ ...recipe().segments[0], end_us: 5_000_000 }],
    });
    expect(second.getRecipe().segments[0].end_us).toBe(5_000_000);
  });

  it("undo restores the previous segment ids", async () => {
    const controller = createMediaEditorController(recipe());
    acquired.push(controller);
    const original = controller.getRecipe().segments[0].id;
    await controller.apply({
      kind: "set_segments",
      segments: [{ ...recipe().segments[0], id: "66666666-6666-4666-8666-666666666666", end_us: 4_000_000 }],
    });
    expect(controller.getRecipe().segments[0].id).toBe("66666666-6666-4666-8666-666666666666");
    await controller.undo();
    expect(controller.getRecipe().segments[0].id).toBe(original);
    expect(controller.canRedo()).toBe(true);
  });

  it("rotation keeps a crop only when it still fits", () => {
    const cropped = setCropWithin(recipe(), { x: 0, y: 0, width: 120, height: 68 }, 120, 68);
    expect(() => rotateWithin(cropped, 90, 120, 68)).toThrow("media_edit.bad_request");
    const small = setCropWithin(recipe(), { x: 0, y: 0, width: 60, height: 34 }, 120, 68);
    const rotated = rotateWithin(small, 90, 120, 68);
    expect(rotated.rotation).toBe(90);
    expect(rotated.crop).toEqual({ x: 0, y: 0, width: 60, height: 34 });
  });

  it("keep pitch is a validated transaction", () => {
    const next = applyMediaEditOperation(recipe(), { kind: "set_keep_pitch", keep_pitch: false });
    expect(next.keep_pitch).toBe(false);
    expect(next.sources).toEqual(recipe().sources);
  });
});
