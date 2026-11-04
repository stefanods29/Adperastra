import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultBrushSettings,
  effectiveDiameter,
  effectiveOpacity,
  validateBrushPresetCatalog,
  type BrushSample,
} from "../image-edit/brushTypes";
import { resampleStroke } from "../image-edit/strokeResampler";
import { paintStroke } from "../image-edit/brush";
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

async function modelWithTile(documentId: string, contentId: string, layerId: string): Promise<ImageModel> {
  const store = getImageTileStore(documentId);
  const tile = await publishTileAt(store, 0, 0, 4, 4, new Uint8Array(4 * 4 * 4));
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 4,
    height: 4,
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
    geometry: createDefaultGeometry(4, 4),
    adjustments: createDefaultAdjustments(),
    overlays: [],
    metadata: [],
  };
}

function sample(x: number, y: number, pressure = 1): BrushSample {
  return { x, y, pressure, tilt_x: 0, tilt_y: 0, time_us: 0 };
}

describe("pressure brush", () => {
  beforeEach(() => {
    state.model = null;
    state.commits = 0;
  });

  it("samepath_2vs200events_same_stamps", () => {
    const settings = { ...defaultBrushSettings(), width: 10, spacing: 0.5, pressure_size: true };
    const two = [sample(0, 0, 0.2), sample(100, 50, 1)];
    const many: BrushSample[] = [];
    for (let index = 0; index < 200; index += 1) {
      const ratio = index / 199;
      many.push(sample(100 * ratio, 50 * ratio, 0.2 + 0.8 * ratio));
    }
    const left = resampleStroke(two, settings);
    const right = resampleStroke(many, settings);
    expect(right).toHaveLength(left.length);
    for (let index = 0; index < left.length; index += 1) {
      expect(right[index].x).toBeCloseTo(left[index].x, 9);
      expect(right[index].y).toBeCloseTo(left[index].y, 9);
      expect(right[index].pressure).toBeCloseTo(left[index].pressure, 9);
      expect(right[index].diameter).toBeCloseTo(left[index].diameter, 9);
    }
  });

  it("mousepressure1", () => {
    const settings = { ...defaultBrushSettings(), width: 20, opacity: 0.6, pressure_size: true, pressure_opacity: true };
    const mouse = sample(10, 10, 1);
    expect(effectiveDiameter(settings, mouse.pressure)).toBe(20);
    expect(effectiveOpacity(settings, mouse.pressure)).toBeCloseTo(0.6);
  });

  it("penpressure0_minwidth1", () => {
    const settings = { ...defaultBrushSettings(), width: 40, pressure_size: true };
    expect(effectiveDiameter(settings, 0)).toBe(1);
    const fixed = { ...settings, pressure_size: false };
    expect(effectiveDiameter(fixed, 0)).toBe(40);
  });

  it("flow0_nochange", async () => {
    const documentId = newUuid();
    const contentId = newUuid();
    const layerId = newUuid();
    state.model = await modelWithTile(documentId, contentId, layerId);
    const settings = { ...defaultBrushSettings(), width: 2, hardness: 1, flow: 0, color: [255, 0, 0, 255] as [number, number, number, number] };
    await paintStroke(documentId, contentId, layerId, [sample(2, 2)], settings, createFullSelection(4, 4));
    expect(state.commits).toBe(0);
  });

  it("stroke_oneUndo", async () => {
    const documentId = newUuid();
    const contentId = newUuid();
    const layerId = newUuid();
    state.model = await modelWithTile(documentId, contentId, layerId);
    const settings = {
      ...defaultBrushSettings(),
      width: 2,
      hardness: 1,
      flow: 1,
      opacity: 1,
      spacing: 0.5,
      color: [255, 0, 0, 255] as [number, number, number, number],
    };
    await paintStroke(
      documentId,
      contentId,
      layerId,
      [sample(2, 2), sample(2, 2), sample(2, 2)],
      settings,
      createFullSelection(4, 4),
    );
    expect(state.commits).toBe(1);
    const layer = state.model?.layers[0];
    expect(layer?.kind).toBe("raster");
    if (layer?.kind !== "raster") throw new Error("raster layer expected");
    expect(layer.tiles[0].id).not.toBe(state.model?.original_tiles[0].id);
    const bytes = await getImageTileStore(documentId).read(layer.tiles[0].id);
    const center = (2 * 4 + 2) * 4;
    expect([bytes[center], bytes[center + 1], bytes[center + 2], bytes[center + 3]]).toEqual([255, 0, 0, 255]);
  });

  it("selection0_untouched", async () => {
    const documentId = newUuid();
    const contentId = newUuid();
    const layerId = newUuid();
    state.model = await modelWithTile(documentId, contentId, layerId);
    const settings = { ...defaultBrushSettings(), width: 2, hardness: 1, color: [255, 0, 0, 255] as [number, number, number, number] };
    await paintStroke(documentId, contentId, layerId, [sample(2, 2)], settings, createEmptySelection(4, 4));
    expect(state.commits).toBe(0);
  });

  it("preset_catalog_bounded", () => {
    const catalog = {
      schema_version: 1 as const,
      presets: [
        { id: newUuid(), name: "Soft", settings: defaultBrushSettings() },
      ],
    };
    expect(() => validateBrushPresetCatalog(catalog)).not.toThrow();
    expect(() =>
      validateBrushPresetCatalog({
        schema_version: 1,
        presets: Array.from({ length: 101 }, () => ({ id: newUuid(), name: "X", settings: defaultBrushSettings() })),
      }),
    ).toThrow("image_edit.too_large");
  });
});
