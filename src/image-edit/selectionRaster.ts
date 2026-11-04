import {
  fail,
  newUuid,
  TILE_EDGE,
  type MaskTileRef,
  type Rect,
} from "./types";
import {
  MAX_SELECTION_PIXELS,
  validateMaskTileRef,
  validateSelectionDimensions,
  validateSelectionMask,
  type SelectionMask,
  type SelectionMode,
} from "./selectionTypes";

/** Tiled alpha8 selection storage and raster helpers (Step 18a T3).
 *
 * Selection masks are view/tool state, so their immutable tiles live in a
 * bounded local store rather than in the document's image tile store. Only
 * the worker-side selection module reads the bytes; no path or File object
 * becomes part of a mask. */

export const MAX_SELECTION_TILE_BYTES = 128 * 1024 * 1024;

interface StoredSelectionTile {
  width: number;
  height: number;
  alpha: Uint8Array;
}

const tiles = new Map<string, StoredSelectionTile>();
let storedBytes = 0;
let generationCounter = 0;

export function selectionTileBytes(): number {
  return storedBytes;
}

export function publishSelectionMaskTile(width: number, height: number, alpha: Uint8Array): MaskTileRef {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail("image_layers.bad_request");
  }
  if (width > TILE_EDGE || height > TILE_EDGE) fail("image_layers.bad_request");
  if (!(alpha instanceof Uint8Array) || alpha.byteLength !== width * height) fail("image_layers.bad_request");
  if (storedBytes + alpha.byteLength > MAX_SELECTION_TILE_BYTES) fail("image_layers.too_large");
  generationCounter += 1;
  const id = newUuid();
  const copy = new Uint8Array(alpha);
  tiles.set(id, { width, height, alpha: copy });
  storedBytes += copy.byteLength;
  return {
    id,
    tile_x: 0,
    tile_y: 0,
    width,
    height,
    generation: generationCounter,
  };
}

export async function readSelectionMaskTile(tile: MaskTileRef): Promise<Uint8Array> {
  const stored = tiles.get(tile.id);
  if (!stored || stored.width !== tile.width || stored.height !== tile.height) fail("image_layers.bad_request");
  return new Uint8Array(stored.alpha);
}

function readSelectionMaskTileSync(tile: MaskTileRef): Uint8Array {
  const stored = tiles.get(tile.id);
  if (!stored || stored.width !== tile.width || stored.height !== tile.height) fail("image_layers.bad_request");
  return stored.alpha;
}

/** Drops every tile this selection owns. Callers only do this once a local
 * selection history no longer references the mask. */
export function releaseSelectionMaskTiles(mask: SelectionMask): void {
  for (const tile of mask.tiles) {
    const stored = tiles.get(tile.id);
    if (!stored) continue;
    storedBytes = Math.max(0, storedBytes - stored.alpha.byteLength);
    tiles.delete(tile.id);
  }
}

export function materializeSelection(mask: SelectionMask): Uint8Array {
  validateSelectionMask(mask);
  const alpha = new Uint8Array(mask.width * mask.height);
  if (mask.kind === "empty") return alpha;
  if (mask.kind === "full") {
    alpha.fill(255);
    return alpha;
  }
  for (const tile of mask.tiles) {
    const bytes = readSelectionMaskTileSync(tile);
    for (let row = 0; row < tile.height; row += 1) {
      alpha.set(
        bytes.subarray(row * tile.width, (row + 1) * tile.width),
        (tile.tile_y + row) * mask.width + tile.tile_x,
      );
    }
  }
  return alpha;
}

export function selectionCoverageAt(mask: SelectionMask, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (mask.kind === "empty") return 0;
  if (mask.kind === "full") return 1;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return 0;
  const tile = mask.tiles.find(
    (candidate) =>
      px >= candidate.tile_x &&
      py >= candidate.tile_y &&
      px < candidate.tile_x + candidate.width &&
      py < candidate.tile_y + candidate.height,
  );
  if (!tile) return 0;
  const bytes = readSelectionMaskTileSync(tile);
  return bytes[(py - tile.tile_y) * tile.width + (px - tile.tile_x)] / 255;
}

function boundsOf(alpha: Uint8Array, width: number, height: number, check?: () => void): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[row + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if ((row & 4095) === 0) check?.();
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function everyPixel(alpha: Uint8Array, value: number, check?: () => void): boolean {
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] !== value) return false;
    if ((index & 4095) === 4095) check?.();
  }
  return true;
}

/** Builds an immutable selection from a full-canvas alpha plane. Tiles are
 * published only for non-empty 256x256 cells; `full`/`empty` remain compact
 * special states. */
export function createSelectionFromAlpha(
  width: number,
  height: number,
  alpha: Uint8Array,
  generation: number,
  id = newUuid(),
  check?: () => void,
): SelectionMask {
  validateSelectionDimensions(width, height);
  if (!(alpha instanceof Uint8Array) || alpha.byteLength !== width * height) fail("image_layers.bad_request");
  if (!Number.isInteger(generation) || generation < 1) fail("image_layers.bad_request");
  if (everyPixel(alpha, 0, check)) {
    return { id, width, height, tiles: [], bounds: null, kind: "empty", generation };
  }
  if (everyPixel(alpha, 255, check)) {
    return {
      id,
      width,
      height,
      tiles: [],
      bounds: { x: 0, y: 0, width, height },
      kind: "full",
      generation,
    };
  }
  const published: MaskTileRef[] = [];
  for (let tileY = 0; tileY < height; tileY += TILE_EDGE) {
    const tileHeight = Math.min(TILE_EDGE, height - tileY);
    for (let tileX = 0; tileX < width; tileX += TILE_EDGE) {
      const tileWidth = Math.min(TILE_EDGE, width - tileX);
      const tileAlpha = new Uint8Array(tileWidth * tileHeight);
      let nonEmpty = false;
      for (let row = 0; row < tileHeight; row += 1) {
        const sourceStart = (tileY + row) * width + tileX;
        const line = alpha.subarray(sourceStart, sourceStart + tileWidth);
        tileAlpha.set(line, row * tileWidth);
        if (!nonEmpty) {
          for (const value of line) {
            if (value !== 0) {
              nonEmpty = true;
              break;
            }
          }
        }
      }
      if (!nonEmpty) continue;
      const ref = publishSelectionMaskTile(tileWidth, tileHeight, tileAlpha);
      published.push({ ...ref, tile_x: tileX, tile_y: tileY });
      check?.();
    }
  }
  const bounds = boundsOf(alpha, width, height, check);
  if (!bounds) fail("image_layers.failed");
  return { id, width, height, tiles: published, bounds, kind: "tiles", generation };
}

export function combineSelectionAlpha(a: number, b: number, mode: SelectionMode): number {
  const left = Math.min(255, Math.max(0, Math.round(a)));
  const right = Math.min(255, Math.max(0, Math.round(b)));
  switch (mode) {
    case "replace":
      return right;
    case "add":
      return Math.max(left, right);
    case "subtract":
      return Math.max(left - right, 0);
    case "intersect":
      return Math.min(left, right);
    default:
      fail("image_layers.bad_request");
  }
}

export function invertSelectionAlpha(alpha: number): number {
  return 255 - Math.min(255, Math.max(0, Math.round(alpha)));
}

/** Separable Gaussian feather with sigma=max(radius/3,0.1), zero outside the
 * canvas and nearest-integer alpha. Radius 0 is an exact identity. */
export function featherSelectionAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number,
  check?: () => void,
): Uint8Array {
  if (!(alpha instanceof Uint8Array) || alpha.byteLength !== width * height) fail("image_layers.bad_request");
  if (!Number.isFinite(radius) || radius < 0 || radius > 128) fail("image_layers.bad_request");
  if (radius === 0) return new Uint8Array(alpha);
  const sigma = Math.max(radius / 3, 0.1);
  const support = Math.max(1, Math.ceil(radius));
  const kernel = new Float32Array(support * 2 + 1);
  let sum = 0;
  for (let offset = -support; offset <= support; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + support] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  const horizontal = new Float32Array(alpha.byteLength);
  const vertical = new Uint8Array(alpha.byteLength);
  let processed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -support; offset <= support; offset += 1) {
        const sx = x + offset;
        if (sx < 0 || sx >= width) continue;
        value += alpha[y * width + sx] * kernel[offset + support];
      }
      horizontal[y * width + x] = value;
      processed += 1;
      if ((processed & 4095) === 0) check?.();
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -support; offset <= support; offset += 1) {
        const sy = y + offset;
        if (sy < 0 || sy >= height) continue;
        value += horizontal[sy * width + x] * kernel[offset + support];
      }
      vertical[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
      processed += 1;
      if ((processed & 4095) === 0) check?.();
    }
  }
  return vertical;
}

/** Validates a mask and returns a cloned decision; used by tests and by the
 * 18b brush path before a paint transaction. */
export function selectionPixelCount(mask: SelectionMask): number {
  if (mask.kind === "empty") return 0;
  if (mask.kind === "full") return mask.width * mask.height;
  let count = 0;
  const alpha = materializeSelection(mask);
  for (const value of alpha) if (value !== 0) count += 1;
  return Math.min(MAX_SELECTION_PIXELS, count);
}

export function validateSelectionTile(tile: MaskTileRef, width: number, height: number): void {
  validateMaskTileRef(tile, width, height);
}
