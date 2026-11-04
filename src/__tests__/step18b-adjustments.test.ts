import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAdjustmentToRgba } from "../image-edit/adjustmentWorker";
import { addAdjustmentLayer } from "../image-edit/adjustmentLayers";
import "../i18n";
import {
  createDefaultAdjustments,
  createDefaultGeometry,
  newUuid,
  type ImageModel,
} from "../image-edit/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

const state = vi.hoisted(() => ({
  model: null as ImageModel | null,
  commits: 0,
  result: null as ImageModel | null,
}));

vi.mock("../image-edit/ImageDocument", () => ({
  getImageEditorModel: () => state.model,
}));

vi.mock("../image-edit/transactions", () => ({
  commitImageTransaction: async (
    _documentId: string,
    _expectedContentId: string,
    transform: (current: Readonly<ImageModel>) => ImageModel,
  ) => {
    state.commits += 1;
    state.result = transform(state.model as ImageModel);
  },
}));

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 1,
    storage_policy: "ordinary",
    expires_unix: 0,
  };
}

function modelWithLayer(): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  const layerId = newUuid();
  const tile = {
    id: newUuid(),
    tile_x: 0,
    tile_y: 0,
    width: 2,
    height: 1,
    byte_len: 8,
    generation: 1,
  };
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 2,
    height: 1,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [tile],
    layers: [
      {
        kind: "raster",
        id: layerId,
        name: "Base",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "normal",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        mask_id: null,
        tiles: [tile],
      },
    ],
    masks: [],
    geometry: createDefaultGeometry(2, 1),
    adjustments: createDefaultAdjustments(),
    overlays: [],
    metadata: [],
  };
}

describe("adjustment layers", () => {
  beforeEach(() => {
    state.model = null;
    state.commits = 0;
    state.result = null;
  });

  it("levels_black0white1gamma1_identity", () => {
    const input = new Uint8Array([0, 10, 20, 255, 200, 220, 240, 128]);
    const output = applyAdjustmentToRgba(input, 2, 1, { kind: "levels", black: 0, white: 1, gamma: 1 });
    expect([...output]).toEqual([...input]);
  });

  it("curves_identity_points", () => {
    const input = new Uint8Array([0, 10, 20, 255, 200, 220, 240, 128]);
    const output = applyAdjustmentToRgba(input, 2, 1, {
      kind: "curves",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    expect([...output]).toEqual([...input]);
  });

  it("median_noise_deterministic", () => {
    const input = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const adjustment = { kind: "noise_reduce" as const, radius: 1, strength: 1 };
    const first = applyAdjustmentToRgba(input, 3, 1, adjustment);
    const second = applyAdjustmentToRgba(input, 3, 1, adjustment);
    expect([...first]).toEqual([...second]);
    // The isolated bright pixel becomes the local median.
    expect(first[4]).toBe(0);
    expect(first[7]).toBe(255);
  });

  it("original_tiles_unchanged", async () => {
    const model = modelWithLayer();
    state.model = model;
    await addAdjustmentLayer(
      model.document_id,
      model.content_id,
      { kind: "levels", black: 0.1, white: 0.9, gamma: 1 },
      1,
    );
    expect(state.commits).toBe(1);
    expect(state.result).not.toBeNull();
    const result = state.result as ImageModel;
    expect(result.layers).toHaveLength(2);
    expect(result.layers[1].kind).toBe("adjustment");
    // The original tile array and the raster layer are not copied or changed.
    expect(result.original_tiles).toBe(model.original_tiles);
    expect(result.layers[0]).toBe(model.layers[0]);
    if (result.layers[0].kind === "raster") {
      expect(result.layers[0].tiles).toBe((model.layers[0] as { tiles: unknown }).tiles);
    }
  });
});
