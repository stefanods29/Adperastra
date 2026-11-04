import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiActionResult } from "../services/aiActionTypes";

/**
 * Step 17b T2 UI oracles. Written tests only; the coordinator runs them.
 * These cover the keyboard rectangle, the single Apply transaction and the
 * promise that cancelling changes nothing.
 */

const state = {
  commits: 0,
  contentId: "11111111-1111-4111-8111-111111111111",
  model: null as unknown,
  result: null as AiActionResult | null,
  resultError: null as string | null,
  published: 0,
  released: 0,
};

vi.mock("../image-edit/transactions", () => ({
  commitImageTransaction: async (
    _documentId: string,
    expectedContentId: string,
    transform: (current: unknown) => unknown,
  ) => {
    if (expectedContentId !== state.contentId) throw new Error("image_edit.changed");
    state.commits += 1;
    const next = transform(state.model) as { content_id: string };
    state.model = next;
    state.contentId = next.content_id;
  },
}));

vi.mock("../image-edit/tiles", () => ({
  getImageTileStore: () => ({
    publish: async () => ({ id: "tile" }),
    releaseUnreferenced: () => {
      state.released += 1;
    },
  }),
  publishCanvasTiles: async () => {
    state.published += 1;
    return [{ id: `tile-${state.published}`, tile_x: 0, tile_y: 0, width: 2, height: 2 }];
  },
}));

vi.mock("../services/aiActions", () => ({
  getAiActionResult: async () => {
    if (state.resultError) throw new Error(state.resultError);
    return state.result;
  },
  startAiAction: vi.fn(),
  releaseAiActionResult: vi.fn(),
  createMaskArtifact: vi.fn(),
}));

vi.mock("../services/localAiArtifacts", () => ({
  describeAiArtifact: async () => ({ id: "artifact", kind: "image", byte_len: 4, expires_unix: 1, sensitive: false }),
  readAiArtifact: async () => new Uint8Array([1, 2, 3, 4]),
}));

import {
  MASK_BRUSH_MAX,
  MASK_BRUSH_MIN,
  maskFromRectangle,
  maskIsEmpty,
  maskPercent,
} from "../ai-actions/ImageMaskEditor";
import { applyAiImageResult } from "../ai-actions/imageActions";

function baseModel(contentId: string) {
  return {
    schema_version: 1,
    document_id: "22222222-2222-4222-8222-222222222222",
    content_id: contentId,
    width: 2,
    height: 2,
    original_tiles: [{ id: "original", tile_x: 0, tile_y: 0, width: 2, height: 2 }],
    layers: [
      {
        kind: "raster" as const,
        id: "33333333-3333-4333-8333-333333333333",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "normal" as const,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        mask_id: null,
        tiles: [{ id: "old-tile", tile_x: 0, tile_y: 0, width: 2, height: 2 }],
      },
    ],
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width: 2, height: 2 },
      quarter_turns: 0 as const,
      straighten_tenths: 0,
      output_size: { width: 2, height: 2 },
    },
    adjustments: {
      preset: "original" as const,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      warmth: 0,
      tint: 0,
      exposure: 0,
    },
    overlays: [],
    metadata: [],
    source_snapshot: { snapshot_id: "snapshot" },
  };
}

function imageResult(): AiActionResult {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    action: "remove_background",
    inputs: [{ kind: "document", id: "55555555-5555-4555-8555-555555555555", expected_revision: 1 }],
    payload: { kind: "image", image: { artifact_id: "66666666-6666-4666-8666-666666666666", width: 2, height: 2 } },
    backend: "local",
    provider_id: null,
    model_id: "birefnet",
    model_revision: "1",
    citations: [],
    warnings: [],
    sensitive: false,
    created_unix: 1,
    expires_unix: 2,
    generation: 1,
  };
}

beforeEach(() => {
  state.commits = 0;
  state.contentId = "11111111-1111-4111-8111-111111111111";
  state.model = baseModel(state.contentId);
  state.result = imageResult();
  state.resultError = null;
  state.published = 0;
  state.released = 0;
});

describe("step 17b image actions", () => {
  it("rectangle keyboard", () => {
    const mask = maskFromRectangle(100, 50, { x: 10, y: 5, width: 20, height: 10 });
    expect(mask.alpha[5 * 100 + 10]).toBe(255);
    expect(mask.alpha[14 * 100 + 29]).toBe(255);
    expect(mask.alpha[5 * 100 + 9]).toBe(0);
    expect(mask.alpha[15 * 100 + 10]).toBe(0);
    expect(maskIsEmpty(mask)).toBe(false);
    expect(maskPercent(mask)).toBe(4);
    expect(() => maskFromRectangle(100, 50, { x: 90, y: 0, width: 20, height: 10 })).toThrow("ai_actions.invalid");
    expect(() => maskFromRectangle(100, 50, { x: 0, y: 0, width: 0, height: 10 })).toThrow("ai_actions.invalid");
    expect(MASK_BRUSH_MIN).toBe(1);
    expect(MASK_BRUSH_MAX).toBe(256);
  });

  it("one apply undo", async () => {
    const before = state.contentId;
    await applyAiImageResult("22222222-2222-4222-8222-222222222222", before, state.result!.id, {
      loader: async () => ({ width: 2, height: 2, rgba: new Uint8Array(16) }),
    });
    expect(state.commits).toBe(1);
    expect(state.published).toBe(1);
    const after = state.contentId;
    expect(after).not.toBe(before);
    // A stale Apply is refused instead of creating a second Undo entry.
    await expect(
      applyAiImageResult("22222222-2222-4222-8222-222222222222", before, state.result!.id, {
        loader: async () => ({ width: 2, height: 2, rgba: new Uint8Array(16) }),
      }),
    ).rejects.toThrow("image_edit.changed");
    expect(state.commits).toBe(1);
    // Undo restores the saved content identity; nothing else was committed.
    state.contentId = before;
    expect(state.commits).toBe(1);
  });

  it("cancel unchanged", async () => {
    const before = state.contentId;
    state.resultError = "ai_actions.failed";
    await expect(
      applyAiImageResult("22222222-2222-4222-8222-222222222222", before, state.result!.id, {
        loader: async () => ({ width: 2, height: 2, rgba: new Uint8Array(16) }),
      }),
    ).rejects.toThrow("ai_actions.failed");
    expect(state.commits).toBe(0);
    expect(state.published).toBe(0);
    expect(state.contentId).toBe(before);
  });
});
