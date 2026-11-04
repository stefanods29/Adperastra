import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneStroke, pickCompositeColor } from "../image-edit/clone";
import { fillMaskFromPixels, fillRegion } from "../image-edit/fill";
import { gradientColorAt, type GradientStop } from "../image-edit/gradient";
import type { FloodPixelSource } from "../image-edit/flood";
import { defaultBrushSettings, type BrushSample } from "../image-edit/brushTypes";
import { getImageTileStore, publishTileAt } from "../image-edit/tiles";
import { createEmptySelection, createFullSelection } from "../image-edit/selectionTypes";
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
  sampleCalls: 0,
  composite: null as { width: number; height: number; rgba: Uint8Array } | null,
  order: [] as string[],
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
    state.model = transform(state.model as ImageModel);
  },
}));

vi.mock("../image-edit/composite", () => ({
  compositePixels: async () => {
    state.order.push("sample");
    state.sampleCalls += 1;
    return state.composite as { width: number; height: number; rgba: Uint8Array };
  },
  layerPixels: async () => {
    state.order.push("sample");
    state.sampleCalls += 1;
    return state.composite as { width: number; height: number; rgba: Uint8Array };
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

async function modelWithTile(
  documentId: string,
  contentId: string,
  layerId: string,
  width: number,
  height: number,
): Promise<ImageModel> {
  const store = getImageTileStore(documentId);
  const tile = await publishTileAt(store, 0, 0, width, height, new Uint8Array(width * height * 4));
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width,
    height,
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
    geometry: createDefaultGeometry(width, height),
    adjustments: createDefaultAdjustments(),
    overlays: [],
    metadata: [],
  };
}

function sample(x: number, y: number, pressure = 1): BrushSample {
  return { x, y, pressure, tilt_x: 0, tilt_y: 0, time_us: 0 };
}

describe("fill, gradient and clone", () => {
  beforeEach(() => {
    state.model = null;
    state.commits = 0;
    state.sampleCalls = 0;
    state.composite = null;
    state.order = [];
  });

  it("fill_no_diagonalconnection", () => {
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const rgba = new Uint8Array([
      ...red, ...blue, ...blue,
      ...blue, ...red, ...blue,
      ...blue, ...blue, ...blue,
    ]);
    const source: FloodPixelSource = { width: 3, height: 3, rgba };
    const mask = fillMaskFromPixels(source, { x: 0, y: 0 }, 0, createFullSelection(3, 3));
    expect(mask[0]).toBe(255);
    // A diagonal-only matching pixel is not reached by a four-connected fill.
    expect(mask[4]).toBe(0);
  });

  it("gradient_endpoints_exact", () => {
    const stops: GradientStop[] = [
      { position: 0, color: [255, 0, 0, 255] },
      { position: 0.5, color: [0, 255, 0, 255] },
      { position: 1, color: [0, 0, 255, 128] },
    ];
    const geometry = { kind: "linear" as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    expect(gradientColorAt(geometry, stops, { x: 0, y: 0 })).toEqual([255, 0, 0, 255]);
    expect(gradientColorAt(geometry, stops, { x: 10, y: 0 })).toEqual([0, 0, 255, 128]);
    expect(gradientColorAt(geometry, stops, { x: 20, y: 0 })).toEqual([0, 0, 255, 128]);
  });

  it("clone_samples_prestroke", async () => {
    const documentId = newUuid();
    const contentId = newUuid();
    const layerId = newUuid();
    state.model = await modelWithTile(documentId, contentId, layerId, 2, 1);
    // Pixel 0 is red and pixel 1 is green in the frozen pre-stroke snapshot.
    state.composite = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) };
    const store = getImageTileStore(documentId);
    const originalPublish = store.publish.bind(store);
    const publish = vi.spyOn(store, "publish").mockImplementation(async (width, height, rgba) => {
      state.order.push("publish");
      return originalPublish(width, height, rgba);
    });
    const settings = {
      ...defaultBrushSettings(),
      mode: "clone" as const,
      sample: "layer" as const,
      width: 2,
      hardness: 1,
      flow: 1,
      opacity: 1,
      spacing: 1,
      pressure_size: false,
    };
    await cloneStroke(
      documentId,
      contentId,
      layerId,
      [sample(0, 0), sample(1, 0)],
      settings,
      createFullSelection(2, 1),
      { x: 0, y: 0 },
    );
    expect(state.sampleCalls).toBe(1);
    expect(state.order[0]).toBe("sample");
    expect(state.commits).toBe(1);
    expect(publish).toHaveBeenCalled();
    const layer = state.model?.layers[0];
    if (layer?.kind !== "raster") throw new Error("raster layer expected");
    const bytes = await store.read(layer.tiles[0].id);
    expect([...bytes.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    publish.mockRestore();
  });

  it("picker_includes_alpha", async () => {
    const model = await modelWithTile(newUuid(), newUuid(), newUuid(), 1, 1);
    state.composite = { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 40]) };
    await expect(pickCompositeColor(model, { x: 0, y: 0 })).resolves.toEqual([10, 20, 30, 40]);
  });

  it("selection0_untouched", async () => {
    const documentId = newUuid();
    const contentId = newUuid();
    const layerId = newUuid();
    state.model = await modelWithTile(documentId, contentId, layerId, 2, 1);
    state.composite = { width: 2, height: 1, rgba: new Uint8Array(8) };
    await fillRegion(
      documentId,
      contentId,
      layerId,
      { x: 0, y: 0 },
      { color: [255, 0, 0, 255], tolerance: 10 },
      createEmptySelection(2, 1),
    );
    expect(state.commits).toBe(0);
    expect(state.sampleCalls).toBe(0);
  });
});
