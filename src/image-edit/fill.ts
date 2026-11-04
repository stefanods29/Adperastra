import { compositePixels } from "./composite";
import { floodFillMask, type FloodPixelSource } from "./flood";
import { applyPixelField, cancelFieldWork, commitBrushResult, fieldChecker } from "./brush";
import { selectionCoverageAt } from "./selectionRaster";
import type { SelectionMask } from "./selectionTypes";
import { getImageEditorModel } from "./ImageDocument";
import { fail, sourceSizeOf, type Point, type Rect } from "./types";

/** Flood fill (Step 18b D3).
 *
 * The wand kernel is 18a's four-connected flood fill; the fill writes only
 * the selected raster layer's changed tiles. Selection coverage multiplies
 * the written alpha, so a feathered selection produces a feathered fill. */

export interface FillOptions {
  color: [number, number, number, number];
  /** 0..100, the same criterion as the magic wand. */
  tolerance: number;
  /** 0..1, default 1. */
  opacity?: number;
}

export function validateFillOptions(options: FillOptions): void {
  if (!options || typeof options !== "object") fail("image_edit.bad_request");
  if (!Array.isArray(options.color) || options.color.length !== 4) fail("image_edit.bad_request");
  for (const channel of options.color) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
  }
  if (typeof options.tolerance !== "number" || !Number.isFinite(options.tolerance)) fail("image_edit.bad_request");
  if (options.tolerance < 0 || options.tolerance > 100) fail("image_edit.bad_request");
  const opacity = options.opacity ?? 1;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    fail("image_edit.bad_request");
  }
}

/** Pure coverage plane for one bucket click. Four-connected only: a diagonal
 * pixel with the same color is not reached. */
export function fillMaskFromPixels(
  source: FloodPixelSource,
  seed: Point,
  tolerance: number,
  selection: SelectionMask,
): Uint8Array {
  if (!selection) fail("image_edit.bad_request");
  if (selection.width !== source.width || selection.height !== source.height) fail("image_edit.bad_request");
  if (selection.kind === "empty") return new Uint8Array(source.width * source.height);
  const check = fieldChecker();
  const filled = floodFillMask(source, seed, tolerance, check);
  if (selection.kind === "full") return filled;
  const output = new Uint8Array(filled.byteLength);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = y * source.width + x;
      if (filled[index] === 0) continue;
      output[index] = Math.round(selectionCoverageAt(selection, x, y) * 255);
    }
  }
  return output;
}

/** E1 companion: fills one region of one raster layer in one transaction. */
export async function fillRegion(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  seed: Point,
  options: FillOptions,
  selection: SelectionMask,
): Promise<void> {
  validateFillOptions(options);
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  const sourceSize = sourceSizeOf(model);
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_edit.bad_request");
  if (layer.locked) fail("image_edit.read_only");
  if (selection.width !== sourceSize.width || selection.height !== sourceSize.height) fail("image_edit.bad_request");
  if (selection.kind === "empty") return;
  const region: Rect = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
  const pixels = await compositePixels(model, region);
  const mask = fillMaskFromPixels(pixels, seed, options.tolerance, selection);
  let any = false;
  for (const alpha of mask) {
    if (alpha !== 0) {
      any = true;
      break;
    }
  }
  if (!any) return;
  const result = await applyPixelField(
    documentId,
    layer.tiles,
    sourceSize,
    mask,
    () => options.color,
    options.opacity ?? 1,
    fieldChecker(),
  );
  if (!result) return;
  await commitBrushResult(documentId, expectedContentId, layerId, result.tiles, result.changed_bytes);
}

export { cancelFieldWork as cancelFillWork };
