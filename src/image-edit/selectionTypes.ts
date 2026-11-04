import {
  fail,
  isFiniteNumber,
  isPositiveInteger,
  isUuid,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  newUuid,
  TILE_EDGE,
  type ImageSize,
  type MaskTileRef,
  type Point,
  type Rect,
} from "./types";

/** Selection masks and operations (Step 18a, interface revision
 * `selection-mask-1`). A selection is view/tool state, never document
 * content; only applying it to paint, cut or a mask becomes a transaction. */

export const MAX_POLYGON_POINTS = 100_000;
export const MAX_FEATHER_RADIUS = 128;
export const MAX_SELECTION_TILES = Math.ceil(MAX_IMAGE_EDGE / TILE_EDGE) ** 2;
export const MAX_SELECTION_PIXELS = MAX_IMAGE_PIXELS;

export type SelectionTool =
  | "rectangle"
  | "ellipse"
  | "lasso"
  | "polygon"
  | "wand"
  | "color"
  | "move"
  | "transform";

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

export type SelectionMaskKind = "empty" | "full" | "tiles";

export interface SelectionMask {
  id: string;
  width: number;
  height: number;
  tiles: MaskTileRef[];
  bounds: Rect | null;
  kind: SelectionMaskKind;
  generation: number;
}

export type SelectionOperation =
  | { kind: "rectangle"; rect: Rect; mode: SelectionMode }
  | { kind: "ellipse"; rect: Rect; mode: SelectionMode }
  | { kind: "polygon"; points: Point[]; mode: SelectionMode }
  | { kind: "wand"; seed: Point; tolerance: number; mode: SelectionMode }
  | { kind: "color"; seed_color_rgba: [number, number, number, number]; tolerance: number; mode: SelectionMode }
  | { kind: "invert" }
  | { kind: "feather"; radius: number }
  | { kind: "clear" };

export const SELECTION_TOOLS: readonly SelectionTool[] = [
  "rectangle",
  "ellipse",
  "lasso",
  "polygon",
  "wand",
  "color",
  "move",
  "transform",
];

export const SELECTION_MODES: readonly SelectionMode[] = ["replace", "add", "subtract", "intersect"];

export function isSelectionTool(value: unknown): value is SelectionTool {
  return typeof value === "string" && (SELECTION_TOOLS as readonly string[]).includes(value);
}

export function isSelectionMode(value: unknown): value is SelectionMode {
  return typeof value === "string" && (SELECTION_MODES as readonly string[]).includes(value);
}

export function validateSelectionDimensions(width: number, height: number): void {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) fail("image_layers.bad_request");
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) fail("image_layers.too_large");
  if (width * height > MAX_SELECTION_PIXELS) fail("image_layers.too_large");
}

export function validateMaskTileRef(tile: MaskTileRef, width: number, height: number): void {
  if (!tile || !isUuid(tile.id)) fail("image_layers.bad_request");
  if (!Number.isInteger(tile.tile_x) || !Number.isInteger(tile.tile_y) || tile.tile_x < 0 || tile.tile_y < 0) {
    fail("image_layers.bad_request");
  }
  if (!isPositiveInteger(tile.width) || !isPositiveInteger(tile.height)) fail("image_layers.bad_request");
  if (tile.width > TILE_EDGE || tile.height > TILE_EDGE) fail("image_layers.bad_request");
  if (tile.tile_x + tile.width > width || tile.tile_y + tile.height > height) fail("image_layers.bad_request");
  if (!isPositiveInteger(tile.generation)) fail("image_layers.bad_request");
}

export function createEmptySelection(width: number, height: number, generation = 1): SelectionMask {
  validateSelectionDimensions(width, height);
  if (!isPositiveInteger(generation)) fail("image_layers.bad_request");
  return {
    id: newUuid(),
    width,
    height,
    tiles: [],
    bounds: null,
    kind: "empty",
    generation,
  };
}

export function createFullSelection(width: number, height: number, generation = 1): SelectionMask {
  validateSelectionDimensions(width, height);
  if (!isPositiveInteger(generation)) fail("image_layers.bad_request");
  return {
    id: newUuid(),
    width,
    height,
    tiles: [],
    bounds: { x: 0, y: 0, width, height },
    kind: "full",
    generation,
  };
}

export function validateSelectionMask(mask: SelectionMask, canvas?: ImageSize): void {
  if (!mask || typeof mask !== "object") fail("image_layers.bad_request");
  if (!isUuid(mask.id)) fail("image_layers.bad_request");
  validateSelectionDimensions(mask.width, mask.height);
  if (canvas && (canvas.width !== mask.width || canvas.height !== mask.height)) fail("image_layers.bad_request");
  if (!isPositiveInteger(mask.generation)) fail("image_layers.bad_request");
  if (mask.kind !== "empty" && mask.kind !== "full" && mask.kind !== "tiles") fail("image_layers.bad_request");
  if (!Array.isArray(mask.tiles) || mask.tiles.length > MAX_SELECTION_TILES) fail("image_layers.bad_request");
  for (const tile of mask.tiles) validateMaskTileRef(tile, mask.width, mask.height);
  if (mask.kind !== "tiles" && mask.tiles.length !== 0) fail("image_layers.bad_request");
  if (mask.kind === "empty" && mask.bounds !== null) fail("image_layers.bad_request");
  if (mask.kind === "full") {
    if (
      !mask.bounds ||
      mask.bounds.x !== 0 ||
      mask.bounds.y !== 0 ||
      mask.bounds.width !== mask.width ||
      mask.bounds.height !== mask.height
    ) {
      fail("image_layers.bad_request");
    }
  }
  if (mask.kind === "tiles") {
    if (!mask.bounds) fail("image_layers.bad_request");
    const bounds = mask.bounds;
    if (
      !isFiniteNumber(bounds.x) ||
      !isFiniteNumber(bounds.y) ||
      !isFiniteNumber(bounds.width) ||
      !isFiniteNumber(bounds.height) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width < 1 ||
      bounds.height < 1 ||
      bounds.x + bounds.width > mask.width ||
      bounds.y + bounds.height > mask.height
    ) {
      fail("image_layers.bad_request");
    }
  }
}

export function validateSelectionOperation(operation: SelectionOperation): void {
  if (!operation || typeof operation !== "object") fail("image_layers.bad_request");
  switch (operation.kind) {
    case "rectangle":
    case "ellipse": {
      if (!isSelectionMode(operation.mode)) fail("image_layers.bad_request");
      const rect = operation.rect;
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every((value) => isFiniteNumber(value)) ||
        rect.width < 1 ||
        rect.height < 1
      ) {
        fail("image_layers.bad_request");
      }
      return;
    }
    case "polygon": {
      if (!isSelectionMode(operation.mode)) fail("image_layers.bad_request");
      if (!Array.isArray(operation.points) || operation.points.length < 3 || operation.points.length > MAX_POLYGON_POINTS) {
        fail("image_layers.bad_request");
      }
      const distinct = new Set<string>();
      for (const point of operation.points) {
        if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) fail("image_layers.bad_request");
        distinct.add(`${point.x},${point.y}`);
      }
      if (distinct.size < 3) fail("image_layers.bad_request");
      return;
    }
    case "wand": {
      if (!isSelectionMode(operation.mode)) fail("image_layers.bad_request");
      if (!operation.seed || !isFiniteNumber(operation.seed.x) || !isFiniteNumber(operation.seed.y)) {
        fail("image_layers.bad_request");
      }
      if (!isFiniteNumber(operation.tolerance) || operation.tolerance < 0 || operation.tolerance > 100) {
        fail("image_layers.bad_request");
      }
      return;
    }
    case "color": {
      if (!isSelectionMode(operation.mode)) fail("image_layers.bad_request");
      const color = operation.seed_color_rgba;
      if (!Array.isArray(color) || color.length !== 4 || !color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        fail("image_layers.bad_request");
      }
      if (!isFiniteNumber(operation.tolerance) || operation.tolerance < 0 || operation.tolerance > 100) {
        fail("image_layers.bad_request");
      }
      return;
    }
    case "invert":
    case "clear":
      return;
    case "feather":
      if (!isFiniteNumber(operation.radius) || operation.radius < 0 || operation.radius > MAX_FEATHER_RADIUS) {
        fail("image_layers.bad_request");
      }
      return;
    default:
      fail("image_layers.bad_request");
  }
}
