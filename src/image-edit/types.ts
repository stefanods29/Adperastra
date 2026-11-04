import type { MetadataCategory } from "../convert/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

/** Shared image-editing contracts (Step 14b, interface revision
 * `image-document-1`). The native mirror lives in
 * `crates/image-edit/src/types.rs`; rendering messages import these fields
 * through `workerTypes.ts` instead of copying them. */

export const IMAGE_MODEL_SCHEMA_VERSION = 1;
export const TILE_EDGE = 256;
/** Largest decoded image the editor accepts (100 MP). */
export const MAX_IMAGE_PIXELS = 100_000_000;
/** Largest width or height of any image or output. */
export const MAX_IMAGE_EDGE = 32_768;
/** CPU tile budget for one open document. */
export const MAX_DOCUMENT_TILE_BYTES = 512 * 1024 * 1024;
/** CPU tile budget shared by every open document. */
export const MAX_TOTAL_TILE_BYTES = 1024 * 1024 * 1024;
/** GPU texture budget for one open document. */
export const MAX_DOCUMENT_GPU_BYTES = 256 * 1024 * 1024;
/** Undo memory budget for one open document. */
export const MAX_HISTORY_BYTES = 256 * 1024 * 1024;
export const MAX_HISTORY_TRANSACTIONS = 1000;
export const MAX_OPEN_EDITORS = 8;
export const MAX_OVERLAYS = 10_000;
export const MAX_OVERLAY_POINTS = 100_000;
export const MAX_TEXT_SCALARS = 10_000;
export const MAX_METADATA_BYTES = 16 * 1024 * 1024;
export const MAX_METADATA_ENTRIES = 16;
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
export const MAX_BRUSH_WIDTH = 512;
export const MAX_ZOOM_PERCENT = 1600;
export const MIN_ZOOM_PERCENT = 5;

export interface ImageSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps `(x, y)` to `(a*x + c*y + e, b*x + d*y + f)`. */
export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface TileRef {
  id: string;
  tile_x: number;
  tile_y: number;
  width: number;
  height: number;
  byte_len: number;
  generation: number;
}

export interface MaskTileRef {
  id: string;
  tile_x: number;
  tile_y: number;
  width: number;
  height: number;
  generation: number;
}

export type AdjustmentPreset = "original" | "vivid" | "warm" | "cool" | "bw" | "sepia" | "custom";

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  blur: number;
  preset: AdjustmentPreset;
}

export interface ImageGeometry {
  /** Integer source pixels, end-exclusive. */
  crop: Rect;
  quarter_turns: 0 | 1 | 2 | 3;
  /** Positive clockwise, in 0.1-degree increments, -45..45. */
  angle_degrees: number;
  flip_x: boolean;
  flip_y: boolean;
  /** Final canvas after rotation, flips and resize. */
  output_size: ImageSize;
}

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "difference" | "add";

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Affine2D;
  mask_id: string | null;
}

export interface RasterLayer extends LayerBase {
  kind: "raster";
  tiles: TileRef[];
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  font_asset_id: string;
  font_size: number;
  color: [number, number, number, number];
  bounds: Rect;
  align: "left" | "center" | "right";
}

export type OverlayKind = "stroke" | "arrow" | "rectangle" | "ellipse" | "text" | "highlight";

export interface ImageOverlay {
  id: string;
  kind: OverlayKind;
  points: Point[];
  bounds: Rect;
  color: [number, number, number, number];
  width: number;
  opacity: number;
  text?: string;
  font_size?: number;
  fill?: [number, number, number, number];
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  overlay: ImageOverlay;
}

export type ImageAdjustment =
  | { kind: "curves"; points: Point[] }
  | { kind: "levels"; black: number; white: number; gamma: number }
  | { kind: "hue_saturation"; hue_degrees: number; saturation: number; lightness: number }
  | {
      kind: "color_balance";
      shadows: [number, number, number];
      midtones: [number, number, number];
      highlights: [number, number, number];
    }
  | { kind: "gaussian"; radius: number }
  | { kind: "unsharp"; radius: number; amount: number }
  | { kind: "noise_reduce"; radius: number; strength: number }
  | { kind: "artistic"; mode: "posterize" | "emboss" | "pixelate"; amount: number };

export interface AdjustmentLayer extends LayerBase {
  kind: "adjustment";
  adjustment: ImageAdjustment;
}

export type ImageLayer = RasterLayer | TextLayer | ShapeLayer | AdjustmentLayer;

export interface ImageMask {
  id: string;
  width: number;
  height: number;
  inverted: boolean;
  tiles: MaskTileRef[];
}

export interface MetadataBlobRef {
  id: string;
  category: MetadataCategory;
  byte_len: number;
  sha256: string;
}

export interface ImageModel {
  schema_version: 1;
  document_id: string;
  content_id: string;
  width: number;
  height: number;
  source_snapshot: ExportSnapshot;
  /** Immutable oriented source pixels, kept for Compare. */
  original_tiles: TileRef[];
  layers: ImageLayer[];
  masks: ImageMask[];
  geometry: ImageGeometry;
  adjustments: ImageAdjustments;
  overlays: ImageOverlay[];
  metadata: MetadataBlobRef[];
}

export type ImageOperation =
  | { kind: "set_geometry"; geometry: ImageGeometry }
  | { kind: "set_adjustments"; adjustments: ImageAdjustments }
  | { kind: "add_overlay"; overlay: ImageOverlay }
  | { kind: "update_overlay"; id: string; replacement: ImageOverlay }
  | { kind: "remove_overlay"; id: string }
  | {
      kind: "paint_stroke";
      layer_id: string;
      points: Point[];
      color: [number, number, number, number];
      width: number;
      hardness: number;
      opacity: number;
      mode: "paint" | "erase";
    };

export interface ImageRenderLease {
  id: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
  release: () => void;
}

/** E2. The document-owned controller; a second view receives the same model. */
export interface ImageController {
  getModel: () => Readonly<ImageModel>;
  subscribe: (listener: (model: Readonly<ImageModel>) => void) => () => void;
  apply: (operation: ImageOperation) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  capture: (revision: number, contentId: string) => Promise<ExportSnapshot>;
  release: () => void;
}

let fallbackId = 0;

/** A UUID v4 when the runtime has one; a stable local fallback otherwise. */
export function newUuid(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  fallbackId += 1;
  return `00000000-0000-4000-8000-${String(fallbackId).padStart(12, "0")}`;
}

export function fail(code: string): never {
  throw new Error(code);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function assertPixels(width: number, height: number): void {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) fail("image_edit.bad_request");
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) fail("image_edit.too_large");
  if (width * height > MAX_IMAGE_PIXELS) fail("image_edit.too_large");
}

export function validateRect(rect: Rect, requireIntegers = false): void {
  if (!rect || !isFiniteNumber(rect.x) || !isFiniteNumber(rect.y) || !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) {
    fail("image_edit.bad_request");
  }
  if (rect.width < 1 || rect.height < 1) fail("image_edit.bad_request");
  if (requireIntegers && (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.width) || !Number.isInteger(rect.height))) {
    fail("image_edit.bad_request");
  }
}

export function validateAffine(matrix: Affine2D, committed = true): void {
  if (!matrix) fail("image_edit.bad_request");
  for (const value of [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]) {
    if (!isFiniteNumber(value)) fail("image_edit.bad_request");
  }
  if (committed) {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-12) fail("image_edit.bad_request");
  }
}

export function createDefaultAdjustments(): ImageAdjustments {
  return { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" };
}

export function createDefaultGeometry(width: number, height: number): ImageGeometry {
  assertPixels(width, height);
  return {
    crop: { x: 0, y: 0, width, height },
    quarter_turns: 0,
    angle_degrees: 0,
    flip_x: false,
    flip_y: false,
    output_size: { width, height },
  };
}

export function validateAdjustments(adjustments: ImageAdjustments): void {
  if (!adjustments) fail("image_edit.bad_request");
  const { brightness, contrast, saturation, warmth, sharpness, blur } = adjustments;
  for (const value of [brightness, contrast, saturation, warmth]) {
    if (!isFiniteNumber(value) || value < -1 || value > 1) fail("image_edit.bad_request");
  }
  if (!isFiniteNumber(sharpness) || sharpness < 0 || sharpness > 1) fail("image_edit.bad_request");
  if (!isFiniteNumber(blur) || blur < 0 || blur > 64) fail("image_edit.bad_request");
  if (!["original", "vivid", "warm", "cool", "bw", "sepia", "custom"].includes(adjustments.preset)) {
    fail("image_edit.bad_request");
  }
}

export function validateGeometry(geometry: ImageGeometry, sourceSize: ImageSize): void {
  if (!geometry) fail("image_edit.bad_request");
  validateRect(geometry.crop, true);
  if (![0, 1, 2, 3].includes(geometry.quarter_turns)) fail("image_edit.bad_request");
  if (!isFiniteNumber(geometry.angle_degrees) || geometry.angle_degrees < -45 || geometry.angle_degrees > 45) {
    fail("image_edit.bad_request");
  }
  if (Math.abs(geometry.angle_degrees * 10 - Math.round(geometry.angle_degrees * 10)) > 1e-9) {
    fail("image_edit.bad_request");
  }
  assertPixels(geometry.output_size.width, geometry.output_size.height);
  if (geometry.crop.x < 0 || geometry.crop.y < 0) fail("image_edit.bad_request");
  if (geometry.crop.x + geometry.crop.width > sourceSize.width) fail("image_edit.bad_request");
  if (geometry.crop.y + geometry.crop.height > sourceSize.height) fail("image_edit.bad_request");
}

export function validateTileRef(tile: TileRef): void {
  if (!tile || !isUuid(tile.id)) fail("image_edit.bad_request");
  if (!Number.isInteger(tile.tile_x) || tile.tile_x < 0 || !Number.isInteger(tile.tile_y) || tile.tile_y < 0) {
    fail("image_edit.bad_request");
  }
  if (!isPositiveInteger(tile.width) || !isPositiveInteger(tile.height)) fail("image_edit.bad_request");
  if (tile.width > TILE_EDGE || tile.height > TILE_EDGE) fail("image_edit.bad_request");
  if (tile.byte_len !== tile.width * tile.height * 4) fail("image_edit.bad_request");
  if (!isPositiveInteger(tile.generation)) fail("image_edit.bad_request");
}

export function validateOverlay(overlay: ImageOverlay, canvas: ImageSize): void {
  if (!overlay || !isUuid(overlay.id)) fail("image_edit.bad_request");
  if (!["stroke", "arrow", "rectangle", "ellipse", "text", "highlight"].includes(overlay.kind)) fail("image_edit.bad_request");
  if (!Array.isArray(overlay.points) || overlay.points.length > MAX_OVERLAY_POINTS) fail("image_edit.bad_request");
  if (overlay.points.length < (overlay.kind === "text" ? 1 : 2)) fail("image_edit.bad_request");
  for (const point of overlay.points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) fail("image_edit.bad_request");
    if (point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) fail("image_edit.bad_request");
  }
  validateRect(overlay.bounds);
  if (overlay.bounds.x + overlay.bounds.width > canvas.width || overlay.bounds.y + overlay.bounds.height > canvas.height) {
    fail("image_edit.bad_request");
  }
  if (!Array.isArray(overlay.color) || overlay.color.length !== 4) fail("image_edit.bad_request");
  for (const channel of overlay.color) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
  }
  if (!isFiniteNumber(overlay.width) || overlay.width < 1 || overlay.width > MAX_BRUSH_WIDTH) fail("image_edit.bad_request");
  if (!isFiniteNumber(overlay.opacity) || overlay.opacity < 0 || overlay.opacity > 1) fail("image_edit.bad_request");
  if (overlay.kind === "text") {
    if (typeof overlay.text !== "string" || [...overlay.text].length > MAX_TEXT_SCALARS) fail("image_edit.bad_request");
    if (!isFiniteNumber(overlay.font_size) || overlay.font_size < 1 || overlay.font_size > 512) fail("image_edit.bad_request");
  }
}

/** Source-original size derived from the immutable original tiles. */
export function sourceSizeOf(model: Readonly<ImageModel>): ImageSize {
  let width = 0;
  let height = 0;
  for (const tile of model.original_tiles) {
    width = Math.max(width, tile.tile_x + tile.width);
    height = Math.max(height, tile.tile_y + tile.height);
  }
  if (!width || !height) fail("image_edit.bad_request");
  return { width, height };
}

let extendedModelValidator: ((model: Readonly<ImageModel>) => void) | null = null;

/** One trusted producer extension replaces the basic one-layer validation. */
export function registerImageModelValidator(
  validator: (model: Readonly<ImageModel>) => void,
): void {
  extendedModelValidator = validator;
}

export function validateModel(model: Readonly<ImageModel>): void {
  if (extendedModelValidator) {
    extendedModelValidator(model);
    return;
  }
  if (!model || model.schema_version !== IMAGE_MODEL_SCHEMA_VERSION) fail("image_edit.bad_request");
  if (!isUuid(model.document_id) || !isUuid(model.content_id)) fail("image_edit.bad_request");
  assertPixels(model.width, model.height);
  if (!Array.isArray(model.original_tiles) || model.original_tiles.length === 0) fail("image_edit.bad_request");
  model.original_tiles.forEach(validateTileRef);
  const source = sourceSizeOf(model);
  validateGeometry(model.geometry, source);
  validateAdjustments(model.adjustments);
  if (!Array.isArray(model.layers) || model.layers.length !== 1 || model.layers[0].kind !== "raster") {
    fail("image_edit.bad_request");
  }
  const layer = model.layers[0];
  if (!isUuid(layer.id) || layer.name.length < 1 || layer.name.length > 128) fail("image_edit.bad_request");
  if (layer.blend !== "normal" || layer.mask_id !== null) fail("image_edit.bad_request");
  validateAffine(layer.transform);
  if (!Array.isArray(layer.tiles)) fail("image_edit.bad_request");
  layer.tiles.forEach(validateTileRef);
  if (model.masks.length !== 0) fail("image_edit.bad_request");
  if (!Array.isArray(model.overlays) || model.overlays.length > MAX_OVERLAYS) fail("image_edit.bad_request");
  model.overlays.forEach((overlay) => validateOverlay(overlay, model.geometry.output_size));
  if (!Array.isArray(model.metadata) || model.metadata.length > MAX_METADATA_ENTRIES) fail("image_edit.bad_request");
  if (!model.source_snapshot || typeof model.source_snapshot.snapshot_id !== "string") fail("image_edit.bad_request");
}

export function validateOperation(model: Readonly<ImageModel>, operation: ImageOperation): void {
  if (!operation || typeof operation.kind !== "string") fail("image_edit.bad_request");
  switch (operation.kind) {
    case "set_geometry":
      validateGeometry(operation.geometry, sourceSizeOf(model));
      return;
    case "set_adjustments":
      validateAdjustments(operation.adjustments);
      return;
    case "add_overlay":
      validateOverlay(operation.overlay, model.geometry.output_size);
      return;
    case "update_overlay":
      if (!model.overlays.some((overlay) => overlay.id === operation.id)) fail("image_edit.bad_request");
      validateOverlay(operation.replacement, model.geometry.output_size);
      return;
    case "remove_overlay":
      if (!model.overlays.some((overlay) => overlay.id === operation.id)) fail("image_edit.bad_request");
      return;
    case "paint_stroke": {
      if (!model.layers.some((layer) => layer.id === operation.layer_id && layer.kind === "raster")) {
        fail("image_edit.bad_request");
      }
      const layer = model.layers.find((candidate) => candidate.id === operation.layer_id);
      if (layer && layer.locked) fail("image_edit.read_only");
      if (!Array.isArray(operation.points) || operation.points.length < 1 || operation.points.length > MAX_OVERLAY_POINTS) {
        fail("image_edit.bad_request");
      }
      for (const point of operation.points) {
        if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) fail("image_edit.bad_request");
      }
      if (!Array.isArray(operation.color) || operation.color.length !== 4) fail("image_edit.bad_request");
      for (const channel of operation.color) {
        if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
      }
      if (!isFiniteNumber(operation.width) || operation.width < 1 || operation.width > MAX_BRUSH_WIDTH) fail("image_edit.bad_request");
      if (!isFiniteNumber(operation.hardness) || operation.hardness < 0 || operation.hardness > 1) fail("image_edit.bad_request");
      if (!isFiniteNumber(operation.opacity) || operation.opacity < 0 || operation.opacity > 1) fail("image_edit.bad_request");
      if (operation.mode !== "paint" && operation.mode !== "erase") fail("image_edit.bad_request");
      return;
    }
    default:
      fail("image_edit.bad_request");
  }
}
