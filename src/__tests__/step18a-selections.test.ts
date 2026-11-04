import { describe, expect, it } from "vitest";
import { floodFillMask } from "../image-edit/flood";
import {
  combineSelectionAlpha,
  createSelectionFromAlpha,
  invertSelectionAlpha,
  materializeSelection,
} from "../image-edit/selectionRaster";
import { applySelection } from "../image-edit/selections";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { newUuid, type ImageModel } from "../image-edit/types";

function sourceModel(width: number, height: number): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  const snapshot: ExportSnapshot = {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 4,
    storage_policy: "ordinary",
    expires_unix: 9_999_999_999,
  };
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width,
    height,
    source_snapshot: snapshot,
    original_tiles: [
      {
        id: newUuid(),
        tile_x: 0,
        tile_y: 0,
        width,
        height,
        byte_len: width * height * 4,
        generation: 1,
      },
    ],
    layers: [],
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width, height },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width, height },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
}

describe("selection set operations", () => {
  it("union64_128=>128", () => {
    expect(combineSelectionAlpha(64, 128, "add")).toBe(128);
  });

  it("subtract200_80=>120", () => {
    expect(combineSelectionAlpha(200, 80, "subtract")).toBe(120);
  });

  it("intersect200_80=>80", () => {
    expect(combineSelectionAlpha(200, 80, "intersect")).toBe(80);
  });

  it("invert64=>191", async () => {
    expect(invertSelectionAlpha(64)).toBe(191);
    const source = sourceModel(1, 1);
    const current = createSelectionFromAlpha(1, 1, new Uint8Array([64]), 1);
    const inverted = await applySelection(current, { kind: "invert" }, source);
    expect(materializeSelection(inverted)[0]).toBe(191);
  });

  it("wand_no_diagonal_connection", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    // Seed (0,0) red; (1,1) is the same red on a diagonal. The rest is blue.
    for (let index = 0; index < 16; index += 1) {
      rgba[index * 4] = 0;
      rgba[index * 4 + 1] = 0;
      rgba[index * 4 + 2] = 255;
      rgba[index * 4 + 3] = 255;
    }
    rgba[0] = 255;
    rgba[1] = 0;
    rgba[2] = 0;
    const diagonal = (1 * 4 + 1) * 4;
    rgba[diagonal] = 255;
    rgba[diagonal + 1] = 0;
    rgba[diagonal + 2] = 0;
    const mask = floodFillMask({ width: 4, height: 4, rgba }, { x: 0, y: 0 }, 0);
    expect(mask[0]).toBe(255);
    expect(mask[diagonal / 4]).toBe(0);
    expect([...mask].filter((value) => value !== 0)).toHaveLength(1);
  });
});
