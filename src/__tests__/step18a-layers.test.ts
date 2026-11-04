import { describe, expect, it } from "vitest";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { ImageHistory } from "../image-edit/history";
import { applyLayerOperationToModel } from "../image-edit/layers";
import { newUuid, type ImageLayer, type ImageModel, type RasterLayer, type TileRef } from "../image-edit/types";

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 16,
    storage_policy: "ordinary",
    expires_unix: 9_999_999_999,
  };
}

function tile(): TileRef {
  return { id: newUuid(), tile_x: 0, tile_y: 0, width: 2, height: 2, byte_len: 16, generation: 1 };
}

function raster(id: string, name: string, locked = false): RasterLayer {
  return {
    kind: "raster",
    id,
    name,
    visible: true,
    locked,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    tiles: [tile()],
  };
}

function model(layers: ImageLayer[], masks: ImageModel["masks"] = []): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 2,
    height: 2,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [tile()],
    layers,
    masks,
    geometry: {
      crop: { x: 0, y: 0, width: 2, height: 2 },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: 2, height: 2 },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
}

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

describe("image layer operations", () => {
  it("duplicate_shares_immutable_tiles", async () => {
    const base = raster(newUuid(), "Photo");
    const before = model([base]);
    const result = await applyLayerOperationToModel(before, { kind: "duplicate", id: base.id });
    expect(result.model.layers).toHaveLength(2);
    expect(result.model.layers[1].id).not.toBe(base.id);
    expect((result.model.layers[1] as RasterLayer).tiles[0].id).toBe(base.tiles[0].id);
    expect(result.changedBytes).toBe(0);
  });

  it("reorder_fullpermutation_only", async () => {
    const first = raster(newUuid(), "Bottom");
    const second = raster(newUuid(), "Middle");
    const third = raster(newUuid(), "Top");
    const before = model([first, second, third]);
    await expect(
      applyLayerOperationToModel(before, { kind: "reorder", ids: [third.id, first.id] }),
    ).rejects.toThrow("image_layers.bad_request");
    const result = await applyLayerOperationToModel(before, {
      kind: "reorder",
      ids: [third.id, first.id, second.id],
    });
    expect(result.model.layers.map((layer) => layer.id)).toEqual([third.id, first.id, second.id]);
  });

  it("locked_paint_refused", async () => {
    const locked = raster(newUuid(), "Locked", true);
    const before = model([locked]);
    await expect(
      applyLayerOperationToModel(before, {
        kind: "transform",
        ids: [locked.id],
        matrix: identity,
        linked_mask: false,
      }),
    ).rejects.toThrow("image_layers.locked");
    expect(before.layers[0].locked).toBe(true);
  });

  it("delete_last_refused", async () => {
    const only = raster(newUuid(), "Only");
    const before = model([only]);
    await expect(applyLayerOperationToModel(before, { kind: "remove", ids: [only.id] })).rejects.toThrow(
      "image_layers.last_layer",
    );
    expect(before.layers).toHaveLength(1);
  });

  it("undo_restores_mask", async () => {
    const layer = raster(newUuid(), "Masked");
    const before = model([layer]);
    const mask = { id: newUuid(), width: 2, height: 2, inverted: true, tiles: [] };
    const changed = await applyLayerOperationToModel(before, { kind: "mask", id: layer.id, mask });
    expect(changed.model.layers[0].mask_id).toBe(mask.id);
    expect(changed.model.masks).toHaveLength(1);
    const history = new ImageHistory(before);
    expect(history.push(before, changed.model, changed.changedBytes)).toBe(true);
    const undone = history.undo();
    expect(undone?.layers[0].mask_id).toBeNull();
    expect(undone?.masks).toHaveLength(0);
  });
});
