import { compositePixels } from "./composite";
import { colorMatches, floodFillMask, globalColorMask } from "./flood";
import {
  combineSelectionAlpha,
  createSelectionFromAlpha,
  featherSelectionAlpha,
  materializeSelection,
} from "./selectionRaster";
import {
  createEmptySelection,
  validateSelectionMask,
  validateSelectionOperation,
  type SelectionMask,
  type SelectionMode,
  type SelectionOperation,
} from "./selectionTypes";
import { fail, isFiniteNumber, sourceSizeOf, type ImageModel, type Point, type Rect } from "./types";

/** Selection mask operations (E2). The caller passes the immutable model
 * captured by the 09a controller. No current document revision is read here. */

let cancelGeneration = 0;

/** Cancels the in-flight selection computation at its next 4096-pixel check. */
export function cancelSelectionWork(): void {
  cancelGeneration += 1;
}

function checker(generation: number): () => void {
  return () => {
    if (generation !== cancelGeneration) throw new Error("image_layers.failed");
  };
}

function validateCanvasFor(source: Readonly<ImageModel>): { width: number; height: number } {
  const size = sourceSizeOf(source);
  return { width: size.width, height: size.height };
}

function shapeRect(width: number, height: number, rect: Rect, ellipse: boolean, check?: () => void): Uint8Array {
  const alpha = new Uint8Array(width * height);
  let processed = 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  if (ellipse) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) alpha[y * width + x] = 255;
        processed += 1;
        if ((processed & 4095) === 0) check?.();
      }
    }
  } else {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (x + 0.5 >= rect.x && x + 0.5 < rect.x + rect.width && y + 0.5 >= rect.y && y + 0.5 < rect.y + rect.height) {
          alpha[y * width + x] = 255;
        }
        processed += 1;
        if ((processed & 4095) === 0) check?.();
      }
    }
  }
  return alpha;
}

function polygonEdges(points: readonly Point[]): Array<[Point, Point]> {
  const edges: Array<[Point, Point]> = [];
  for (let index = 0; index < points.length; index += 1) {
    edges.push([points[index], points[(index + 1) % points.length]]);
  }
  return edges;
}

/** Even-odd fill at pixel centers, clipped to the canvas. */
export function polygonMask(width: number, height: number, points: readonly Point[], check?: () => void): Uint8Array {
  if (points.length < 3) fail("image_layers.bad_request");
  const edges = polygonEdges(points);
  const alpha = new Uint8Array(width * height);
  let processed = 0;
  for (let y = 0; y < height; y += 1) {
    const scanY = y + 0.5;
    const crossings: number[] = [];
    for (const [a, b] of edges) {
      if ((a.y > scanY) === (b.y > scanY)) continue;
      const t = (scanY - a.y) / (b.y - a.y);
      crossings.push(a.x + t * (b.x - a.x));
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = Math.max(0, Math.ceil(crossings[index] - 0.5));
      const end = Math.min(width - 1, Math.floor(crossings[index + 1] - 0.5));
      for (let x = start; x <= end; x += 1) alpha[y * width + x] = 255;
    }
    processed += width;
    if ((processed & 4095) === 0) check?.();
  }
  return alpha;
}

function combine(base: Uint8Array, next: Uint8Array, mode: SelectionMode, check?: () => void): Uint8Array {
  if (base.byteLength !== next.byteLength) fail("image_layers.bad_request");
  const output = new Uint8Array(base.byteLength);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = combineSelectionAlpha(base[index], next[index], mode);
    if ((index & 4095) === 4095) check?.();
  }
  return output;
}

function validateShape(operation: { rect: Rect; mode: SelectionMode }): void {
  const { rect } = operation;
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every((value) => isFiniteNumber(value)) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    fail("image_layers.bad_request");
  }
}

/** E2. Returns a new immutable selection; `current` and `source` are never
 * mutated. Hidden layers never affect a color/wand sample. */
export async function applySelection(
  current: SelectionMask,
  operation: SelectionOperation,
  source: Readonly<ImageModel>,
): Promise<SelectionMask> {
  const canvas = validateCanvasFor(source);
  validateSelectionMask(current, canvas);
  validateSelectionOperation(operation);
  const generation = current.generation + 1;
  const check = checker(cancelGeneration);
  const base = materializeSelection(current);
  let next: Uint8Array = new Uint8Array(base.byteLength);

  switch (operation.kind) {
    case "rectangle": {
      validateShape(operation);
      next = shapeRect(canvas.width, canvas.height, operation.rect, false, check);
      next = combine(base, next, operation.mode, check);
      break;
    }
    case "ellipse": {
      validateShape(operation);
      next = shapeRect(canvas.width, canvas.height, operation.rect, true, check);
      next = combine(base, next, operation.mode, check);
      break;
    }
    case "polygon": {
      next = polygonMask(canvas.width, canvas.height, operation.points, check);
      next = combine(base, next, operation.mode, check);
      break;
    }
    case "wand": {
      const pixels = await compositePixels(source, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      const seed = { x: Math.floor(operation.seed.x), y: Math.floor(operation.seed.y) };
      next = floodFillMask({ width: canvas.width, height: canvas.height, rgba: pixels.rgba }, seed, operation.tolerance, check);
      next = combine(base, next, operation.mode, check);
      break;
    }
    case "color": {
      const pixels = await compositePixels(source, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      const seed = operation.seed_color_rgba;
      // Sanity-check the same transparent-seed rule before scanning.
      if (seed[3] === 0) {
        const zero: [number, number, number, number] = [0, 0, 0, 0];
        if (!colorMatches(seed, zero, operation.tolerance)) fail("image_layers.bad_request");
      }
      next = globalColorMask({ width: canvas.width, height: canvas.height, rgba: pixels.rgba }, seed, operation.tolerance, check);
      next = combine(base, next, operation.mode, check);
      break;
    }
    case "invert": {
      next = new Uint8Array(base.byteLength);
      for (let index = 0; index < base.length; index += 1) {
        next[index] = 255 - base[index];
        if ((index & 4095) === 4095) check();
      }
      break;
    }
    case "feather": {
      next = featherSelectionAlpha(base, canvas.width, canvas.height, operation.radius, check);
      break;
    }
    case "clear": {
      return createEmptySelection(canvas.width, canvas.height, generation);
    }
    default:
      fail("image_layers.bad_request");
  }
  check();
  return createSelectionFromAlpha(canvas.width, canvas.height, next, generation, undefined, check);
}
