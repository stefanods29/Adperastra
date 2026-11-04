import { composeAffine, invertAffine, mapRect, rotateAffine, scaleAffine, translateAffine } from "./coordinates";
import { createSelectionFromAlpha, materializeSelection } from "./selectionRaster";
import type { SelectionMask } from "./selectionTypes";
import { getImageTileStore } from "./tiles";
import {
  fail,
  isFiniteNumber,
  newUuid,
  sourceSizeOf,
  TILE_EDGE,
  type Affine2D,
  type ImageLayer,
  type ImageMask,
  type ImageModel,
  type ImageSize,
  type MaskTileRef,
  type Point,
  type Rect,
} from "./types";
import {
  MAX_LAYER_SCALE,
  MIN_LAYER_SCALE,
  validateTransformMatrix,
  type LayerOperation,
} from "./layerTypes";

/** Layer transforms and linked masks (Step 18a T4).
 *
 * Matrices are deltas in canonical canvas pixels (positive rotation is
 * clockwise in screen coordinates). Applying a transform composes it with
 * the layer's existing matrix; a linked mask is resampled into a new
 * immutable mask in the same step. */

export interface TransformDialogValues {
  translate_x: number;
  translate_y: number;
  /** 1 means 100%. */
  scale: number;
  /** Positive clockwise, degrees. */
  rotation_degrees: number;
  pivot: Point;
}

export function layerBounds(layer: ImageLayer): Rect {
  switch (layer.kind) {
    case "raster": {
      let width = 0;
      let height = 0;
      for (const tile of layer.tiles) {
        width = Math.max(width, tile.tile_x + tile.width);
        height = Math.max(height, tile.tile_y + tile.height);
      }
      return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : { x: 0, y: 0, width: 0, height: 0 };
    }
    case "text":
      return { ...layer.bounds };
    case "shape":
      return { ...layer.overlay.bounds };
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function defaultPivot(model: Readonly<ImageModel>, ids: readonly string[]): Point {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const layer = model.layers.find((candidate) => candidate.id === id);
    if (!layer) fail("image_layers.bad_request");
    const local = layerBounds(layer);
    if (local.width === 0 || local.height === 0) continue;
    const bounds = mapRect(local, layer.transform);
    if (bounds.width === 0 || bounds.height === 0) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (!Number.isFinite(minX)) return { x: model.width / 2, y: model.height / 2 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function finite(value: number): number {
  if (!isFiniteNumber(value)) fail("image_layers.bad_request");
  return value;
}

export function makeTransformMatrix(values: TransformDialogValues): Affine2D {
  const scale = finite(values.scale);
  if (scale < MIN_LAYER_SCALE || scale > MAX_LAYER_SCALE) fail("image_layers.bad_request");
  const rotation = finite(values.rotation_degrees);
  const pivot = values.pivot;
  if (!pivot || !isFiniteNumber(pivot.x) || !isFiniteNumber(pivot.y)) fail("image_layers.bad_request");
  const aroundPivot = composeAffine(
    translateAffine(pivot.x, pivot.y),
    composeAffine(rotateAffine(rotation), composeAffine(scaleAffine(scale, scale), translateAffine(-pivot.x, -pivot.y))),
  );
  const matrix = composeAffine(translateAffine(finite(values.translate_x), finite(values.translate_y)), aroundPivot);
  validateTransformMatrix(matrix);
  return matrix;
}

export function composeLayerTransform(current: Affine2D, delta: Affine2D): Affine2D {
  validateTransformMatrix(delta);
  const composed = composeAffine(delta, current);
  validateTransformMatrix(composed);
  return composed;
}

async function materializeMask(documentId: string, mask: ImageMask): Promise<Uint8Array> {
  const store = getImageTileStore(documentId);
  const alpha = new Uint8Array(mask.width * mask.height);
  for (const tile of mask.tiles) {
    const bytes = await store.read(tile.id);
    if (bytes.byteLength !== tile.width * tile.height) fail("image_layers.bad_request");
    for (let row = 0; row < tile.height; row += 1) {
      alpha.set(
        bytes.subarray(row * tile.width, (row + 1) * tile.width),
        (tile.tile_y + row) * mask.width + tile.tile_x,
      );
    }
  }
  if (mask.inverted) {
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = 255 - alpha[index];
  }
  return alpha;
}

function sampleMaskBilinear(source: Uint8Array, width: number, height: number, x: number, y: number): number {
  if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number): number => {
    if (px < 0 || py < 0 || px >= width || py >= height) return 0;
    return source[py * width + px];
  };
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  );
}

/** Async mask publication with known canvas positions. */
async function publishMaskAlpha(
  documentId: string,
  width: number,
  height: number,
  alpha: Uint8Array,
): Promise<{ mask: ImageMask; changedBytes: number }> {
  const store = getImageTileStore(documentId);
  let nonZero = false;
  let nonFull = false;
  for (const value of alpha) {
    if (value !== 0) nonZero = true;
    if (value !== 255) nonFull = true;
  }
  if (!nonZero) return { mask: { id: newUuid(), width, height, inverted: false, tiles: [] }, changedBytes: 0 };
  if (!nonFull) return { mask: { id: newUuid(), width, height, inverted: true, tiles: [] }, changedBytes: 0 };
  const published: MaskTileRef[] = [];
  let changedBytes = 0;
  for (let tileY = 0; tileY < height; tileY += TILE_EDGE) {
    const tileHeight = Math.min(TILE_EDGE, height - tileY);
    for (let tileX = 0; tileX < width; tileX += TILE_EDGE) {
      const tileWidth = Math.min(TILE_EDGE, width - tileX);
      const bytes = new Uint8Array(tileWidth * tileHeight);
      let any = false;
      for (let row = 0; row < tileHeight; row += 1) {
        for (let column = 0; column < tileWidth; column += 1) {
          const value = alpha[(tileY + row) * width + tileX + column];
          bytes[row * tileWidth + column] = value;
          if (value !== 0) any = true;
        }
      }
      if (!any) continue;
      const ref = await store.publishMask(tileWidth, tileHeight, bytes);
      published.push({ ...ref, tile_x: tileX, tile_y: tileY });
      changedBytes += bytes.byteLength;
    }
  }
  return { mask: { id: newUuid(), width, height, inverted: false, tiles: published }, changedBytes };
}

/** Resamples a mask through the same matrix. Outside the source is
 * transparent; alpha is nearest-integer. */
export async function transformMask(
  documentId: string,
  mask: ImageMask,
  matrix: Affine2D,
  target: ImageSize,
): Promise<{ mask: ImageMask; changedBytes: number }> {
  validateTransformMatrix(matrix);
  const source = await materializeMask(documentId, mask);
  const inverse = invertAffine(matrix);
  const alpha = new Uint8Array(target.width * target.height);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const canvasX = x + 0.5;
      const canvasY = y + 0.5;
      const sourceX = inverse.a * canvasX + inverse.c * canvasY + inverse.e;
      const sourceY = inverse.b * canvasX + inverse.d * canvasY + inverse.f;
      alpha[y * target.width + x] = Math.max(
        0,
        Math.min(255, Math.round(sampleMaskBilinear(source, mask.width, mask.height, sourceX - 0.5, sourceY - 0.5))),
      );
    }
  }
  return await publishMaskAlpha(documentId, target.width, target.height, alpha);
}

/** Applies a delta matrix to the selected layers and, when linked, to every
 * mask exactly once (shared masks stay shared). */
export async function applyTransformToLayers(
  model: Readonly<ImageModel>,
  ids: readonly string[],
  matrix: Affine2D,
  linkedMask: boolean,
  documentId: string,
): Promise<{ model: ImageModel; changedBytes: number }> {
  validateTransformMatrix(matrix);
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > model.layers.length) fail("image_layers.bad_request");
  const selected = new Set(ids);
  for (const id of ids) {
    const layer = model.layers.find((candidate) => candidate.id === id);
    if (!layer) fail("image_layers.bad_request");
    if (layer.locked) fail("image_layers.locked");
  }
  const maskResults = new Map<string, ImageMask>();
  const source = sourceSizeOf(model);
  let changedBytes = 0;
  if (linkedMask) {
    for (const layer of model.layers) {
      if (!selected.has(layer.id) || !layer.mask_id || maskResults.has(layer.mask_id)) continue;
      const mask = model.masks.find((candidate) => candidate.id === layer.mask_id);
      if (!mask) fail("image_layers.bad_request");
      const result = await transformMask(documentId, mask, matrix, source);
      maskResults.set(mask.id, result.mask);
      changedBytes += result.changedBytes;
    }
  }
  const layers = model.layers.map((layer) => {
    if (!selected.has(layer.id)) return layer;
    const transform = composeLayerTransform(layer.transform, matrix);
    const maskId = linkedMask && layer.mask_id ? (maskResults.get(layer.mask_id)?.id ?? layer.mask_id) : layer.mask_id;
    return { ...layer, transform, mask_id: maskId } as ImageLayer;
  });
  const usedMasks = new Set(layers.flatMap((layer) => (layer.mask_id ? [layer.mask_id] : [])));
  const masks = model.masks
    .map((mask) => maskResults.get(mask.id) ?? mask)
    .filter((mask) => usedMasks.has(mask.id));
  for (const transformed of maskResults.values()) {
    if (usedMasks.has(transformed.id) && !masks.some((mask) => mask.id === transformed.id)) masks.push(transformed);
  }
  return {
    model: { ...model, layers, masks },
    changedBytes,
  };
}

/** Transforms a view selection mask in canvas coordinates. The local
 * selection tile store is used; no document tile or file path is involved. */
export function transformSelectionMask(
  mask: SelectionMask,
  matrix: Affine2D,
  target: ImageSize,
): SelectionMask {
  validateTransformMatrix(matrix);
  const source = materializeSelection(mask);
  const inverse = invertAffine(matrix);
  const alpha = new Uint8Array(target.width * target.height);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const canvasX = x + 0.5;
      const canvasY = y + 0.5;
      const sourceX = inverse.a * canvasX + inverse.c * canvasY + inverse.e;
      const sourceY = inverse.b * canvasX + inverse.d * canvasY + inverse.f;
      alpha[y * target.width + x] = Math.max(
        0,
        Math.min(255, Math.round(sampleMaskBilinear(source, mask.width, mask.height, sourceX - 0.5, sourceY - 0.5))),
      );
    }
  }
  return createSelectionFromAlpha(target.width, target.height, alpha, mask.generation + 1);
}

export function transformOperation(ids: readonly string[], matrix: Affine2D, linkedMask: boolean): LayerOperation {
  return { kind: "transform", ids: [...ids], matrix, linked_mask: linkedMask };
}
