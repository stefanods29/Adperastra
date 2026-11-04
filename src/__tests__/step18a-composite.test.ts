import { describe, expect, it } from "vitest";
import { blendChannels, compositePixel, gpuBlendReference } from "../image-edit/blend";
import { compositePixels } from "../image-edit/composite";
import { getImageTileStore } from "../image-edit/tiles";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { newUuid, type ImageModel, type RasterLayer, type TileRef } from "../image-edit/types";

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

async function makeModel(
  specs: Array<{ rgba: number[]; visible?: boolean; name?: string }>,
): Promise<ImageModel> {
  const documentId = newUuid();
  const contentId = newUuid();
  const store = getImageTileStore(documentId);
  const layers: RasterLayer[] = [];
  if (specs.length === 0) throw new Error("test fixture needs a layer");
  for (const [index, spec] of specs.entries()) {
    const ref: TileRef = await store.publish(2, 2, new Uint8Array(spec.rgba));
    layers.push({
      kind: "raster",
      id: newUuid(),
      name: spec.name ?? `Layer ${index + 1}`,
      visible: spec.visible !== false,
      locked: false,
      opacity: 1,
      blend: "normal",
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      mask_id: null,
      tiles: [ref],
    });
  }
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 2,
    height: 2,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [layers[0].tiles[0]],
    layers,
    masks: [],
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

const blue = [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255];
const red = [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255];
const transparentRed = [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0];

describe("alpha-correct layer compositing", () => {
  it("normal_opaque_red_over_blue=>red", async () => {
    const image = await makeModel([
      { rgba: blue, name: "Blue" },
      { rgba: red, name: "Red" },
    ]);
    const result = await compositePixels(image, { x: 0, y: 0, width: 2, height: 2 });
    expect([...result.rgba]).toEqual(red);
  });

  it("multiply_white_identity", () => {
    expect(blendChannels("multiply", [1, 1, 1], [0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
  });

  it("zero_alpha_rgb_zero", () => {
    expect(compositePixel([0, 0, 0, 0], [255, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(compositePixel([0, 0, 0, 0], [255, 0, 0, 128])[3]).toBeGreaterThan(0);
  });

  it("CPU_GPU_within1u8", () => {
    const cases: Array<[number[], number[], "normal" | "multiply" | "screen" | "overlay" | "difference" | "add"]> = [
      [[32, 64, 128, 255], [255, 64, 0, 200], "normal"],
      [[32, 64, 128, 255], [255, 255, 255, 255], "multiply"],
      [[32, 64, 128, 128], [10, 240, 30, 255], "screen"],
      [[20, 200, 100, 255], [200, 100, 20, 128], "overlay"],
      [[0, 0, 0, 255], [255, 255, 255, 255], "difference"],
      [[200, 100, 20, 255], [100, 200, 220, 120], "add"],
    ];
    for (const [backdrop, source, mode] of cases) {
      const cpu = compositePixel(
        [backdrop[0], backdrop[1], backdrop[2], backdrop[3]],
        [source[0], source[1], source[2], source[3]],
        mode,
      );
      const gpu = gpuBlendReference(
        [backdrop[0], backdrop[1], backdrop[2], backdrop[3]],
        [source[0], source[1], source[2], source[3]],
        mode,
      );
      for (let channel = 0; channel < 4; channel += 1) {
        expect(Math.abs(cpu[channel] - gpu[channel]), `${mode}/${channel}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("hidden_layer_noeffect", async () => {
    const withHidden = await compositePixels(
      await makeModel([
        { rgba: blue, name: "Blue" },
        { rgba: transparentRed, visible: false, name: "Hidden" },
      ]),
      { x: 0, y: 0, width: 2, height: 2 },
    );
    const withoutHidden = await compositePixels(
      await makeModel([{ rgba: blue, name: "Blue" }]),
      { x: 0, y: 0, width: 2, height: 2 },
    );
    expect([...withHidden.rgba]).toEqual([...withoutHidden.rgba]);
  });
});
