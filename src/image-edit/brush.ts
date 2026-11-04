import { outputPointToSource, outputToSourceScale } from "./geometry";
import { getImageEditorModel } from "./ImageDocument";
import { getImageTileStore, publishTileAt } from "./tiles";
import { commitImageTransaction } from "./transactions";
import { selectionCoverageAt } from "./selectionRaster";
import type { SelectionMask } from "./selectionTypes";
import {
  effectiveOpacity,
  type BrushSample,
  type BrushSettings,
} from "./brushTypes";
import { resampleStroke, type BrushStamp } from "./strokeResampler";
import {
  fail,
  MAX_BRUSH_WIDTH,
  MAX_OVERLAY_POINTS,
  sourceSizeOf,
  TILE_EDGE,
  type ImageGeometry,
  type ImageModel,
  type ImageSize,
  type Point,
  type TileRef,
} from "./types";

/** Deterministic brush stamping (D7/D8).
 *
 * Points arrive in current-output coordinates. The stroke is resampled at a
 * fixed spacing derived from the brush width, so the result depends only on
 * the path and the settings, never on pointer event frequency. Erase reduces
 * alpha; paint uses source-over in premultiplied math and stores
 * unpremultiplied pixels. */

export interface StrokeOptions {
  /** The committed gesture's path in current-output coordinates. */
  points: readonly Point[];
  color: [number, number, number, number];
  /** Brush diameter in output pixels. */
  width: number;
  hardness: number;
  opacity: number;
  mode: "paint" | "erase";
}

export interface StrokeResult {
  tiles: TileRef[];
  changed_bytes: number;
}

export function coverageAt(distance: number, radius: number, hardness: number): number {
  if (!Number.isFinite(distance) || distance < 0) fail("image_edit.bad_request");
  if (radius <= 0) return 0;
  const inner = radius * Math.min(1, Math.max(0, hardness));
  if (distance <= inner) return 1;
  if (distance >= radius) return 0;
  if (radius <= inner) return 1;
  return 1 - (distance - inner) / (radius - inner);
}

/** Opaque alpha 255 erased at half opacity becomes 128 (round nearest). */
export function eraseAlpha(alpha: number, coverage: number, opacity: number): number {
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) fail("image_edit.bad_request");
  const factor = 1 - Math.min(1, Math.max(0, coverage)) * Math.min(1, Math.max(0, opacity));
  return Math.max(0, Math.min(255, Math.round(alpha * factor)));
}

export function paintPixel(
  destination: [number, number, number, number],
  source: [number, number, number, number],
  coverage: number,
  opacity: number,
): [number, number, number, number] {
  const sa = Math.min(1, Math.max(0, coverage)) * Math.min(1, Math.max(0, opacity)) * (source[3] / 255);
  const da = destination[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  const mix = (channel: number) => Math.round((source[channel] * sa + destination[channel] * da * (1 - sa)) / outA);
  return [mix(0), mix(1), mix(2), Math.round(outA * 255)];
}

/** Fixed-spacing stamps along a polyline, including the final point once. */
export function strokeStamps(points: readonly Point[], widthOutput: number): Point[] {
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_OVERLAY_POINTS) fail("image_edit.bad_request");
  if (!Number.isFinite(widthOutput) || widthOutput < 1 || widthOutput > MAX_BRUSH_WIDTH) fail("image_edit.bad_request");
  const spacing = Math.max(0.5, 0.25 * widthOutput);
  const stamps: Point[] = [{ x: points[0].x, y: points[0].y }];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    let travelled = spacing - carried;
    while (travelled <= length + 1e-9) {
      const ratio = Math.min(1, travelled / length);
      stamps.push({ x: start.x + dx * ratio, y: start.y + dy * ratio });
      travelled += spacing;
    }
    carried = (carried + length) % spacing;
  }
  const last = points[points.length - 1];
  const previous = stamps[stamps.length - 1];
  if (Math.hypot(last.x - previous.x, last.y - previous.y) > 1e-6) stamps.push({ x: last.x, y: last.y });
  return stamps;
}

interface TileWork {
  ref: TileRef;
  bytes: Uint8Array;
  dirty: boolean;
}

function tileIndex(tiles: readonly TileRef[]): Map<string, TileRef> {
  return new Map(tiles.map((tile) => [`${tile.tile_x}:${tile.tile_y}`, tile]));
}

function validateSelection(selection: SelectionMask, sourceSize: ImageSize): void {
  if (!selection) fail("image_edit.bad_request");
  if (selection.width !== sourceSize.width || selection.height !== sourceSize.height) fail("image_edit.bad_request");
}

/** Applies a completed stroke to immutable layer tiles. Returns new refs only
 * for changed tiles; unaffected tiles keep their identity. */
export async function applyStrokeToLayer(
  documentId: string,
  layerTiles: readonly TileRef[],
  geometry: ImageGeometry,
  sourceSize: ImageSize,
  stroke: StrokeOptions,
): Promise<StrokeResult | null> {
  if (!Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > MAX_BRUSH_WIDTH) fail("image_edit.bad_request");
  if (!Number.isFinite(stroke.hardness) || stroke.hardness < 0 || stroke.hardness > 1) fail("image_edit.bad_request");
  if (!Number.isFinite(stroke.opacity) || stroke.opacity < 0 || stroke.opacity > 1) fail("image_edit.bad_request");
  if (stroke.mode !== "paint" && stroke.mode !== "erase") fail("image_edit.bad_request");
  if (stroke.opacity === 0) return null;
  const store = getImageTileStore(documentId);
  const scale = outputToSourceScale(geometry, sourceSize);
  const sourceWidth = Math.max(1, stroke.width * scale);
  const radius = sourceWidth / 2;
  const stamps = strokeStamps(stroke.points, stroke.width).map((point) => outputPointToSource(point, geometry, sourceSize));
  const byPosition = tileIndex(layerTiles);
  const work = new Map<string, TileWork>();

  const ensureTile = async (tileX: number, tileY: number): Promise<TileWork | null> => {
    const key = `${tileX}:${tileY}`;
    const existing = work.get(key);
    if (existing) return existing;
    const ref = byPosition.get(key);
    if (!ref) return null;
    const bytes = await store.read(ref.id);
    const item: TileWork = { ref, bytes, dirty: false };
    work.set(key, item);
    return item;
  };

  for (const stamp of stamps) {
    if (stamp.x + radius < 0 || stamp.y + radius < 0 || stamp.x - radius > sourceSize.width || stamp.y - radius > sourceSize.height) {
      continue;
    }
    const minTileX = Math.max(0, Math.floor((stamp.x - radius) / TILE_EDGE));
    const minTileY = Math.max(0, Math.floor((stamp.y - radius) / TILE_EDGE));
    const maxTileX = Math.floor(Math.min(sourceSize.width - 1, stamp.x + radius) / TILE_EDGE);
    const maxTileY = Math.floor(Math.min(sourceSize.height - 1, stamp.y + radius) / TILE_EDGE);
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const item = await ensureTile(tileX, tileY);
        if (!item) continue;
        const startX = Math.max(0, Math.floor(stamp.x - radius));
        const endX = Math.min(item.ref.tile_x + item.ref.width - 1, Math.ceil(stamp.x + radius));
        const startY = Math.max(0, Math.floor(stamp.y - radius));
        const endY = Math.min(item.ref.tile_y + item.ref.height - 1, Math.ceil(stamp.y + radius));
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            const coverage = coverageAt(Math.hypot(x + 0.5 - stamp.x, y + 0.5 - stamp.y), radius, stroke.hardness);
            if (coverage <= 0) continue;
            const localX: number = x - item.ref.tile_x;
            const localY: number = y - item.ref.tile_y;
            const offset = (localY * item.ref.width + localX) * 4;
            const before = item.bytes[offset + 3];
            if (stroke.mode === "erase") {
              const alpha = eraseAlpha(before, coverage, stroke.opacity);
              if (alpha !== before) {
                item.bytes[offset + 3] = alpha;
                if (alpha === 0) {
                  item.bytes[offset] = 0;
                  item.bytes[offset + 1] = 0;
                  item.bytes[offset + 2] = 0;
                }
                item.dirty = true;
              }
            } else {
              const pixel = paintPixel(
                [item.bytes[offset], item.bytes[offset + 1], item.bytes[offset + 2], item.bytes[offset + 3]],
                stroke.color,
                coverage,
                stroke.opacity,
              );
              if (
                pixel[0] !== item.bytes[offset] ||
                pixel[1] !== item.bytes[offset + 1] ||
                pixel[2] !== item.bytes[offset + 2] ||
                pixel[3] !== item.bytes[offset + 3]
              ) {
                item.bytes[offset] = pixel[0];
                item.bytes[offset + 1] = pixel[1];
                item.bytes[offset + 2] = pixel[2];
                item.bytes[offset + 3] = pixel[3];
                item.dirty = true;
              }
            }
          }
        }
      }
    }
  }

  return publishChangedTiles(store, layerTiles, work);
}

/** A gesture holds points until a successful pointerup. Cancel never leaves a
 * partial operation behind. */
export class StrokeGesture {
  private points: Point[] = [];
  private cancelled = false;

  add(point: Point): void {
    if (this.cancelled) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) fail("image_edit.bad_request");
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
    if (this.points.length >= MAX_OVERLAY_POINTS) return;
    this.points.push({ x: point.x, y: point.y });
  }

  get length(): number {
    return this.points.length;
  }

  cancel(): void {
    this.cancelled = true;
    this.points = [];
  }

  finish(): Point[] | null {
    if (this.cancelled || this.points.length === 0) return null;
    const finished = this.points.map((point) => ({ ...point }));
    this.points = [];
    return finished;
  }
}

async function publishChangedTiles(
  store: ReturnType<typeof getImageTileStore>,
  layerTiles: readonly TileRef[],
  work: ReadonlyMap<string, TileWork>,
): Promise<StrokeResult | null> {
  const replacements = new Map<string, TileRef>();
  let changedBytes = 0;
  for (const item of work.values()) {
    if (!item.dirty) continue;
    const ref = await publishTileAt(store, item.ref.tile_x, item.ref.tile_y, item.ref.width, item.ref.height, item.bytes);
    replacements.set(item.ref.id, ref);
    changedBytes += item.ref.byte_len;
  }
  if (replacements.size === 0) return null;
  return {
    tiles: layerTiles.map((tile) => replacements.get(tile.id) ?? tile),
    changed_bytes: changedBytes,
  };
}

/* ------------------------------------------------------------------------- */
/* Step 18b: pressure brush, mask paint and color fields (image-brush-1).    */
/* ------------------------------------------------------------------------- */

let fieldGeneration = 0;

/** Cancels the in-flight fill/gradient at its next 4096-pixel check. */
export function cancelFieldWork(): void {
  fieldGeneration += 1;
}

function fieldChecker(): () => void {
  const generation = fieldGeneration;
  return () => {
    if (generation !== fieldGeneration) fail("image_edit.failed");
  };
}

/** Applies one completed pressure brush gesture. The stroke is one 14b E6
 * transaction; a cancelled or empty gesture changes nothing. */
export async function paintStroke(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  samples: readonly BrushSample[],
  settings: BrushSettings,
  selection: SelectionMask,
): Promise<void> {
  if (settings.mode === "clone") {
    // Clone needs its Alt-click anchor and pre-stroke snapshot.
    fail("image_edit.bad_request");
  }
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  const sourceSize = sourceSizeOf(model);
  validateSelection(selection, sourceSize);
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_edit.bad_request");
  if (layer.locked) fail("image_edit.read_only");
  const stamps = resampleStroke(samples, settings);
  if (stamps.length === 0) return;
  const result = await applyStampField(documentId, layer.tiles, sourceSize, stamps, settings, selection);
  if (!result) return;
  await commitBrushResult(documentId, expectedContentId, layerId, result.tiles, result.changed_bytes);
}

/** Applies stamps to one raster layer. `sourcePixel` lets clone read the
 * immutable pre-stroke snapshot; paint uses the brush color. */
export async function applyStampField(
  documentId: string,
  layerTiles: readonly TileRef[],
  sourceSize: ImageSize,
  stamps: readonly BrushStamp[],
  settings: BrushSettings,
  selection: SelectionMask,
  sourcePixel?: (x: number, y: number) => [number, number, number, number] | null,
): Promise<StrokeResult | null> {
  validateSelection(selection, sourceSize);
  if (!Array.isArray(stamps) || stamps.length === 0) return null;
  const store = getImageTileStore(documentId);
  const byPosition = tileIndex(layerTiles);
  const work = new Map<string, TileWork>();

  const ensureTile = async (tileX: number, tileY: number): Promise<TileWork | null> => {
    const key = `${tileX}:${tileY}`;
    const existing = work.get(key);
    if (existing) return existing;
    const ref = byPosition.get(key);
    if (!ref) return null;
    const bytes = await store.read(ref.id);
    const item: TileWork = { ref, bytes, dirty: false };
    work.set(key, item);
    return item;
  };

  for (const stamp of stamps) {
    const radius = Math.max(0.5, stamp.diameter / 2);
    if (stamp.x + radius < 0 || stamp.y + radius < 0 || stamp.x - radius > sourceSize.width || stamp.y - radius > sourceSize.height) {
      continue;
    }
    const minTileX = Math.max(0, Math.floor((stamp.x - radius) / TILE_EDGE));
    const minTileY = Math.max(0, Math.floor((stamp.y - radius) / TILE_EDGE));
    const maxTileX = Math.floor(Math.min(sourceSize.width - 1, stamp.x + radius) / TILE_EDGE);
    const maxTileY = Math.floor(Math.min(sourceSize.height - 1, stamp.y + radius) / TILE_EDGE);
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const item = await ensureTile(tileX, tileY);
        if (!item) continue;
        const startX = Math.max(0, Math.floor(stamp.x - radius));
        const endX = Math.min(item.ref.tile_x + item.ref.width - 1, Math.ceil(stamp.x + radius));
        const startY = Math.max(0, Math.floor(stamp.y - radius));
        const endY = Math.min(item.ref.tile_y + item.ref.height - 1, Math.ceil(stamp.y + radius));
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            const coverage = coverageAt(Math.hypot(x + 0.5 - stamp.x, y + 0.5 - stamp.y), radius, settings.hardness);
            if (coverage <= 0) continue;
            const selected = selectionCoverageAt(selection, x, y);
            if (selected <= 0) continue;
            const opacity = effectiveOpacity(settings, stamp.pressure) * settings.flow;
            if (opacity <= 0) continue;
            const localX: number = x - item.ref.tile_x;
            const localY: number = y - item.ref.tile_y;
            const offset = (localY * item.ref.width + localX) * 4;
            const before = item.bytes[offset + 3];
            if (settings.mode === "erase") {
              const alpha = eraseAlpha(before, coverage * selected, opacity);
              if (alpha !== before) {
                item.bytes[offset + 3] = alpha;
                if (alpha === 0) {
                  item.bytes[offset] = 0;
                  item.bytes[offset + 1] = 0;
                  item.bytes[offset + 2] = 0;
                }
                item.dirty = true;
              }
              continue;
            }
            const source = sourcePixel ? sourcePixel(x, y) : settings.color;
            if (!source || source[3] === 0) continue;
            const pixel = paintPixel(
              [item.bytes[offset], item.bytes[offset + 1], item.bytes[offset + 2], item.bytes[offset + 3]],
              source,
              coverage * selected,
              opacity,
            );
            if (
              pixel[0] !== item.bytes[offset] ||
              pixel[1] !== item.bytes[offset + 1] ||
              pixel[2] !== item.bytes[offset + 2] ||
              pixel[3] !== item.bytes[offset + 3]
            ) {
              item.bytes[offset] = pixel[0];
              item.bytes[offset + 1] = pixel[1];
              item.bytes[offset + 2] = pixel[2];
              item.bytes[offset + 3] = pixel[3];
              item.dirty = true;
            }
          }
        }
      }
    }
  }
  return publishChangedTiles(store, layerTiles, work);
}

/** Paints a per-pixel color field (fill, gradient) through a coverage plane.
 * Only pixels with coverage > 0 are read and only changed tiles are
 * published. Cancellation is checked every 4096 visited pixels. */
export async function applyPixelField(
  documentId: string,
  layerTiles: readonly TileRef[],
  sourceSize: ImageSize,
  coverage: Uint8Array,
  colorAt: (x: number, y: number) => [number, number, number, number] | null,
  opacity: number,
  check?: () => void,
): Promise<StrokeResult | null> {
  if (!(coverage instanceof Uint8Array) || coverage.byteLength !== sourceSize.width * sourceSize.height) {
    fail("image_edit.bad_request");
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail("image_edit.bad_request");
  if (opacity === 0) return null;
  const store = getImageTileStore(documentId);
  const work = new Map<string, TileWork>();
  let visited = 0;
  for (const ref of layerTiles) {
    let item = work.get(`${ref.tile_x}:${ref.tile_y}`);
    for (let row = 0; row < ref.height; row += 1) {
      for (let column = 0; column < ref.width; column += 1) {
        const x = ref.tile_x + column;
        const y = ref.tile_y + row;
        if (x >= sourceSize.width || y >= sourceSize.height) continue;
        const amount = coverage[y * sourceSize.width + x];
        visited += 1;
        if ((visited & 4095) === 0) check?.();
        if (amount === 0) continue;
        if (!item) {
          item = { ref, bytes: await store.read(ref.id), dirty: false };
          work.set(`${ref.tile_x}:${ref.tile_y}`, item);
        }
        const source = colorAt(x, y);
        if (!source || source[3] === 0) continue;
        const offset = (row * ref.width + column) * 4;
        const pixel = paintPixel(
          [item.bytes[offset], item.bytes[offset + 1], item.bytes[offset + 2], item.bytes[offset + 3]],
          source,
          amount / 255,
          opacity,
        );
        if (
          pixel[0] !== item.bytes[offset] ||
          pixel[1] !== item.bytes[offset + 1] ||
          pixel[2] !== item.bytes[offset + 2] ||
          pixel[3] !== item.bytes[offset + 3]
        ) {
          item.bytes[offset] = pixel[0];
          item.bytes[offset + 1] = pixel[1];
          item.bytes[offset + 2] = pixel[2];
          item.bytes[offset + 3] = pixel[3];
          item.dirty = true;
        }
      }
    }
  }
  check?.();
  return publishChangedTiles(store, layerTiles, work);
}

/** Shared one-transaction commit for brush, fill, gradient and clone. */
export async function commitBrushResult(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  tiles: readonly TileRef[],
  changedBytes = 0,
): Promise<void> {
  await commitImageTransaction(
    documentId,
    expectedContentId,
    (current: Readonly<ImageModel>) => {
      const target = current.layers.find((candidate) => candidate.id === layerId);
      if (!target || target.kind !== "raster") fail("image_edit.changed");
      return {
        ...current,
        layers: current.layers.map((candidate) =>
          candidate.id === layerId && candidate.kind === "raster" ? { ...candidate, tiles: [...tiles] } : candidate,
        ),
      } as ImageModel;
    },
    changedBytes,
  );
}

export { fieldChecker };
