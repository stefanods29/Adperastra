import {
  assertPixels,
  fail,
  isFiniteNumber,
  isPositiveInteger,
  isUuid,
  MAX_METADATA_ENTRIES,
  MAX_OVERLAYS,
  MAX_TEXT_SCALARS,
  sourceSizeOf,
  validateAdjustments,
  validateAffine,
  validateGeometry,
  validateOverlay,
  validateRect,
  validateTileRef,
  type Affine2D,
  type BlendMode,
  type ImageLayer,
  type ImageMask,
  type ImageModel,
  type RasterLayer,
  type Rect,
  type TextLayer,
  type ShapeLayer,
  type AdjustmentLayer,
} from "./types";
import { validateImageAdjustment } from "./adjustmentWorker";
import {
  createEmptySelection,
  isSelectionTool,
  validateSelectionMask,
  type SelectionMask,
  type SelectionTool,
} from "./selectionTypes";

/** Layer and selection types for Step 18a (`image-layers-1`). The 14b
 * `ImageModel`, `ImageLayer`, `ImageMask` and `Affine2D` remain canonical;
 * this file adds operations and per-view selection state only. */

export const MAX_LAYERS = 256;
export const MAX_SELECTED_LAYERS = 256;
export const MAX_LAYER_NAME = 128;
export const MIN_LAYER_SCALE = 0.001;
export const MAX_LAYER_SCALE = 1000;

export const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "add",
];

export type LayerOperation =
  | { kind: "add"; layer: RasterLayer; index: number }
  | { kind: "duplicate"; id: string }
  | { kind: "remove"; ids: string[] }
  | { kind: "reorder"; ids: string[] }
  | { kind: "rename"; id: string; name: string }
  | { kind: "visibility"; id: string; visible: boolean }
  | { kind: "lock"; id: string; locked: boolean }
  | { kind: "opacity"; id: string; opacity: number }
  | { kind: "blend"; id: string; blend: BlendMode }
  | { kind: "transform"; ids: string[]; matrix: Affine2D; linked_mask: boolean }
  | { kind: "mask"; id: string; mask: ImageMask | null }
  | { kind: "merge_down"; id: string }
  | { kind: "flatten" };

export interface LayerSelectionState {
  active_layer_id: string;
  selected_layer_ids: string[];
  selection: SelectionMask;
  tool: SelectionTool;
  viewonly: boolean;
}

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && (BLEND_MODES as readonly string[]).includes(value);
}

export function validateLayerName(name: unknown): string {
  if (typeof name !== "string") fail("image_layers.bad_request");
  const length = Array.from(name).length;
  if (length < 1 || length > MAX_LAYER_NAME) fail("image_layers.bad_request");
  return name;
}

export function matrixScale(matrix: Affine2D): number {
  return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
}

export function validateTransformMatrix(matrix: Affine2D): void {
  validateAffine(matrix, true);
  const scale = matrixScale(matrix);
  if (!isFiniteNumber(scale) || scale < MIN_LAYER_SCALE || scale > MAX_LAYER_SCALE) {
    fail("image_layers.bad_request");
  }
}

export function validateMask(mask: ImageMask, canvas: { width: number; height: number }): void {
  if (!mask || !isUuid(mask.id)) fail("image_layers.bad_request");
  if (!isPositiveInteger(mask.width) || !isPositiveInteger(mask.height)) fail("image_layers.bad_request");
  if (mask.width !== canvas.width || mask.height !== canvas.height) fail("image_layers.bad_request");
  if (typeof mask.inverted !== "boolean") fail("image_layers.bad_request");
  if (!Array.isArray(mask.tiles)) fail("image_layers.bad_request");
  for (const tile of mask.tiles) {
    if (!tile || !isUuid(tile.id)) fail("image_layers.bad_request");
    if (!Number.isInteger(tile.tile_x) || !Number.isInteger(tile.tile_y) || tile.tile_x < 0 || tile.tile_y < 0) {
      fail("image_layers.bad_request");
    }
    if (!isPositiveInteger(tile.width) || !isPositiveInteger(tile.height)) fail("image_layers.bad_request");
    if (tile.width > 256 || tile.height > 256) fail("image_layers.bad_request");
    if (tile.tile_x + tile.width > mask.width || tile.tile_y + tile.height > mask.height) {
      fail("image_layers.bad_request");
    }
    if (!isPositiveInteger(tile.generation)) fail("image_layers.bad_request");
  }
}

function validateLayerBase(layer: ImageLayer): void {
  if (!layer || !isUuid(layer.id)) fail("image_layers.bad_request");
  validateLayerName(layer.name);
  if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") fail("image_layers.bad_request");
  if (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) fail("image_layers.bad_request");
  if (!isBlendMode(layer.blend)) fail("image_layers.bad_request");
  validateTransformMatrix(layer.transform);
  if (layer.mask_id !== null && !isUuid(layer.mask_id)) fail("image_layers.bad_request");
}

function validateRasterLayer(layer: RasterLayer): void {
  validateLayerBase(layer);
  if (!Array.isArray(layer.tiles)) fail("image_layers.bad_request");
  layer.tiles.forEach(validateTileRef);
}

function validateTextLayer(layer: TextLayer): void {
  validateLayerBase(layer);
  if (typeof layer.text !== "string" || Array.from(layer.text).length > MAX_TEXT_SCALARS) {
    fail("image_layers.bad_request");
  }
  if (typeof layer.font_asset_id !== "string" || layer.font_asset_id.length > 128) fail("image_layers.bad_request");
  if (!isFiniteNumber(layer.font_size) || layer.font_size < 1 || layer.font_size > 512) fail("image_layers.bad_request");
  if (!Array.isArray(layer.color) || layer.color.length !== 4 || !layer.color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    fail("image_layers.bad_request");
  }
  validateRect(layer.bounds);
  if (layer.align !== "left" && layer.align !== "center" && layer.align !== "right") fail("image_layers.bad_request");
}

function validateShapeLayer(layer: ShapeLayer, canvas: { width: number; height: number }): void {
  validateLayerBase(layer);
  validateOverlay(layer.overlay, canvas);
}

function validateAdjustmentLayer(layer: AdjustmentLayer): void {
  validateLayerBase(layer);
  try {
    validateImageAdjustment(layer.adjustment);
  } catch {
    // Keep the 18a error vocabulary for a malformed non-destructive layer.
    fail("image_layers.bad_request");
  }
}

/** Extended model validation for 1..256 layers and masks. The 14b
 * `validateModel` remains the producer for one-layer models; integration
 * points this function at the same immutable model after Step 18a. */
export function validateLayerModel(model: Readonly<ImageModel>): void {
  if (!model || model.schema_version !== 1) fail("image_layers.bad_request");
  if (!isUuid(model.document_id) || !isUuid(model.content_id)) fail("image_layers.bad_request");
  assertPixels(model.width, model.height);
  if (!Array.isArray(model.original_tiles) || model.original_tiles.length === 0) fail("image_layers.bad_request");
  model.original_tiles.forEach(validateTileRef);
  const source = sourceSizeOf(model);
  validateGeometry(model.geometry, source);
  validateAdjustments(model.adjustments);
  if (!Array.isArray(model.layers) || model.layers.length < 1 || model.layers.length > MAX_LAYERS) {
    fail("image_layers.bad_request");
  }
  const layerIds = new Set<string>();
  for (const layer of model.layers) {
    if (layerIds.has(layer.id)) fail("image_layers.bad_request");
    layerIds.add(layer.id);
    switch (layer.kind) {
      case "raster":
        validateRasterLayer(layer);
        break;
      case "text":
        validateTextLayer(layer);
        break;
      case "shape":
        validateShapeLayer(layer, model.geometry.output_size);
        break;
      case "adjustment":
        validateAdjustmentLayer(layer);
        break;
      default:
        fail("image_layers.bad_request");
    }
  }
  if (!Array.isArray(model.masks) || model.masks.length > MAX_LAYERS) fail("image_layers.bad_request");
  const maskIds = new Set<string>();
  for (const mask of model.masks) {
    if (maskIds.has(mask.id)) fail("image_layers.bad_request");
    maskIds.add(mask.id);
    validateMask(mask, source);
  }
  for (const layer of model.layers) {
    if (layer.mask_id !== null && !maskIds.has(layer.mask_id)) fail("image_layers.bad_request");
  }
  if (!Array.isArray(model.overlays) || model.overlays.length > MAX_OVERLAYS) fail("image_layers.bad_request");
  model.overlays.forEach((overlay) => validateOverlay(overlay, model.geometry.output_size));
  if (!Array.isArray(model.metadata) || model.metadata.length > MAX_METADATA_ENTRIES) {
    fail("image_layers.bad_request");
  }
  if (!model.source_snapshot || typeof model.source_snapshot.snapshot_id !== "string") fail("image_layers.bad_request");
}

function requireLayer(model: Readonly<ImageModel>, id: string): ImageLayer {
  const layer = model.layers.find((candidate) => candidate.id === id);
  if (!layer) fail("image_layers.bad_request");
  return layer;
}

function requireUnlocked(layer: ImageLayer): void {
  if (layer.locked) fail("image_layers.locked");
}

function requireIds(ids: unknown, model: Readonly<ImageModel>, allowAll = true): string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_LAYERS) fail("image_layers.bad_request");
  if (ids.length > MAX_SELECTED_LAYERS) fail("image_layers.too_large");
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !isUuid(id) || unique.has(id)) fail("image_layers.bad_request");
    unique.add(id);
    requireLayer(model, id);
  }
  if (!allowAll && ids.length >= model.layers.length) fail("image_layers.last_layer");
  return [...ids];
}

export function validateLayerOperation(model: Readonly<ImageModel>, operation: LayerOperation): void {
  if (!operation || typeof operation !== "object") fail("image_layers.bad_request");
  const source = sourceSizeOf(model);
  switch (operation.kind) {
    case "add": {
      if (!operation.layer || operation.layer.kind !== "raster") fail("image_layers.bad_request");
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > model.layers.length) {
        fail("image_layers.bad_request");
      }
      if (model.layers.length >= MAX_LAYERS) fail("image_layers.too_large");
      if (model.layers.some((layer) => layer.id === operation.layer.id)) fail("image_layers.bad_request");
      validateRasterLayer(operation.layer);
      if (operation.layer.mask_id !== null && !model.masks.some((mask) => mask.id === operation.layer.mask_id)) {
        fail("image_layers.bad_request");
      }
      void source;
      return;
    }
    case "duplicate": {
      requireLayer(model, operation.id);
      if (model.layers.length >= MAX_LAYERS) fail("image_layers.too_large");
      return;
    }
    case "remove": {
      const ids = requireIds(operation.ids, model, false);
      for (const id of ids) requireUnlocked(requireLayer(model, id));
      return;
    }
    case "reorder": {
      const ids = requireIds(operation.ids, model);
      if (ids.length !== model.layers.length) fail("image_layers.bad_request");
      const current = new Set(model.layers.map((layer) => layer.id));
      for (const id of ids) if (!current.has(id)) fail("image_layers.bad_request");
      return;
    }
    case "rename": {
      requireLayer(model, operation.id);
      validateLayerName(operation.name);
      return;
    }
    case "visibility": {
      const layer = requireLayer(model, operation.id);
      if (typeof operation.visible !== "boolean") fail("image_layers.bad_request");
      void layer;
      return;
    }
    case "lock": {
      requireLayer(model, operation.id);
      if (typeof operation.locked !== "boolean") fail("image_layers.bad_request");
      return;
    }
    case "opacity": {
      requireLayer(model, operation.id);
      if (!isFiniteNumber(operation.opacity) || operation.opacity < 0 || operation.opacity > 1) {
        fail("image_layers.bad_request");
      }
      return;
    }
    case "blend": {
      requireLayer(model, operation.id);
      if (!isBlendMode(operation.blend)) fail("image_layers.bad_request");
      return;
    }
    case "transform": {
      const ids = requireIds(operation.ids, model);
      if (typeof operation.linked_mask !== "boolean") fail("image_layers.bad_request");
      validateTransformMatrix(operation.matrix);
      for (const id of ids) requireUnlocked(requireLayer(model, id));
      return;
    }
    case "mask": {
      const layer = requireLayer(model, operation.id);
      requireUnlocked(layer);
      if (operation.mask !== null) validateMask(operation.mask, source);
      return;
    }
    case "merge_down": {
      const index = model.layers.findIndex((layer) => layer.id === operation.id);
      if (index < 0) fail("image_layers.bad_request");
      if (index === 0) fail("image_layers.bad_request");
      const lower = model.layers[index - 1];
      const upper = model.layers[index];
      if (lower.kind !== "raster" || upper.kind !== "raster") fail("image_layers.bad_request");
      requireUnlocked(lower);
      requireUnlocked(upper);
      return;
    }
    case "flatten": {
      if (model.layers.some((layer) => layer.locked)) fail("image_layers.locked");
      return;
    }
    default:
      fail("image_layers.bad_request");
  }
}

export function createDefaultLayerSelection(model: Readonly<ImageModel>): LayerSelectionState {
  const source = sourceSizeOf(model);
  const active = model.layers[model.layers.length - 1]?.id ?? "";
  return {
    active_layer_id: active,
    selected_layer_ids: active ? [active] : [],
    selection: createEmptySelection(source.width, source.height),
    tool: "rectangle",
    viewonly: false,
  };
}

export function validateLayerSelectionState(state: LayerSelectionState, model: Readonly<ImageModel>): void {
  if (!state || !isUuid(state.active_layer_id)) fail("image_layers.bad_request");
  if (!model.layers.some((layer) => layer.id === state.active_layer_id)) fail("image_layers.bad_request");
  if (!Array.isArray(state.selected_layer_ids) || state.selected_layer_ids.length > MAX_SELECTED_LAYERS) {
    fail("image_layers.bad_request");
  }
  const seen = new Set<string>();
  for (const id of state.selected_layer_ids) {
    if (!isUuid(id) || seen.has(id) || !model.layers.some((layer) => layer.id === id)) {
      fail("image_layers.bad_request");
    }
    seen.add(id);
  }
  if (!isSelectionTool(state.tool)) fail("image_layers.bad_request");
  if (typeof state.viewonly !== "boolean") fail("image_layers.bad_request");
  validateSelectionMask(state.selection, sourceSizeOf(model));
}
