import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { applyAffine, invertAffine } from "../image-edit/coordinates";
import { samplePremultipliedBilinear } from "../image-edit/compositeWorker";
import { makeTransformMatrix, transformMask } from "../image-edit/layerTransform";
import { getImageTileStore } from "../image-edit/tiles";
import TransformDialog from "../image-edit/TransformDialog";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { newUuid, type ImageMask, type ImageModel, type RasterLayer } from "../image-edit/types";

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 12,
    storage_policy: "ordinary",
    expires_unix: 9_999_999_999,
  };
}

async function modelWithMask(): Promise<{ model: ImageModel; layer: RasterLayer; mask: ImageMask }> {
  const documentId = newUuid();
  const contentId = newUuid();
  const store = getImageTileStore(documentId);
  const layerTile = await store.publish(3, 3, new Uint8Array(3 * 3 * 4));
  const maskTile = await store.publishMask(3, 3, new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0, 0]));
  const mask: ImageMask = {
    id: newUuid(),
    width: 3,
    height: 3,
    inverted: false,
    tiles: [{ ...maskTile, tile_x: 0, tile_y: 0 }],
  };
  const layer: RasterLayer = {
    kind: "raster",
    id: newUuid(),
    name: "Photo",
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: mask.id,
    tiles: [{ ...layerTile, tile_x: 0, tile_y: 0 }],
  };
  const model: ImageModel = {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 3,
    height: 3,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [layer.tiles[0]],
    layers: [layer],
    masks: [mask],
    geometry: {
      crop: { x: 0, y: 0, width: 3, height: 3 },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: 3, height: 3 },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
  return { model, layer, mask };
}

describe("layer and mask transforms", () => {
  it("matrix_inverse_roundtrip", () => {
    const matrix = makeTransformMatrix({
      translate_x: 7.5,
      translate_y: -3.25,
      scale: 1.75,
      rotation_degrees: 23.5,
      pivot: { x: 10, y: 20 },
    });
    const inverse = invertAffine(matrix);
    const point = { x: 11.25, y: 4.75 };
    const roundtrip = applyAffine(applyAffine(point, matrix), inverse);
    expect(Math.abs(roundtrip.x - point.x)).toBeLessThan(1e-6);
    expect(Math.abs(roundtrip.y - point.y)).toBeLessThan(1e-6);
  });

  it("linked_mask_moves_together", async () => {
    const { model, mask } = await modelWithMask();
    const result = await transformMask(
      model.document_id,
      mask,
      { a: 1, b: 0, c: 0, d: 1, e: 1, f: 1 },
      { width: 3, height: 3 },
    );
    expect(result.mask.id).not.toBe(mask.id);
    expect(result.mask.inverted).toBe(false);
    const tile = result.mask.tiles[0];
    expect(tile).toBeDefined();
    const bytes = await getImageTileStore(model.document_id).read(tile.id);
    expect(bytes[1 * 3 + 1]).toBe(255);
    expect(bytes[0]).toBe(0);
  });

  it("bilinear_transparent_edge_nohalo", () => {
    const bytes = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]);
    const edge = samplePremultipliedBilinear(bytes, 2, 1, 0.5, 0);
    expect(edge[3]).toBeCloseTo(0.5, 5);
    expect(edge[0]).toBeGreaterThan(0.9);
    expect(edge[1]).toBeLessThan(0.01);
    expect(samplePremultipliedBilinear(bytes, 2, 1, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it("cancel_preview_norevision", async () => {
    const { model, layer } = await modelWithMask();
    const before = model.content_id;
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(TransformDialog, {
          model,
          layerIds: [layer.id],
          onApply,
          onCancel,
        }),
      );
    });
    const buttons = container.querySelectorAll(".adp-transform-actions button");
    expect(buttons.length).toBeGreaterThan(0);
    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(model.content_id).toBe(before);
    await act(async () => root?.unmount());
    container.remove();
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});
