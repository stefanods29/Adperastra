import { applyAdjustments } from "./adjustments";
import { applyAdjustmentToRgba } from "./adjustmentWorker";
import { blendChannels, linearToSrgb, srgbToLinear } from "./blend";
import { invertAffine } from "./coordinates";
import { outputToSourceAffine } from "./geometry";
import { rasterizeOverlays } from "./overlays";
import {
  fail,
  isFiniteNumber,
  TILE_EDGE,
  type AdjustmentLayer,
  type Affine2D,
  type ImageMask,
  type ImageModel,
  type ImageOverlay,
  type ImageSize,
  type MaskTileRef,
  type RasterLayer,
  type Rect,
  type TileRef,
} from "./types";

/** Tiled CPU compositor and worker envelope (Step 18a T2).
 *
 * The pixel engine receives only immutable tile bytes and the immutable
 * model over structured clone. It never reaches a document registry, a path
 * or a File. The WebView may replace this CPU path with the same equations
 * in its WebGL2 worker; the CPU path remains the deterministic fallback. */

export interface CompositeTilePayload {
  id: string;
  bytes: ArrayBuffer;
}

export interface CompositePayload {
  model: Readonly<ImageModel>;
  source_size: ImageSize;
  tiles: CompositeTilePayload[];
  masks: CompositeTilePayload[];
}

export interface CompositeOptions {
  layer_ids?: readonly string[];
  respect_visibility?: boolean;
}

export interface CompositePixelsResult {
  width: number;
  height: number;
  rgba: Uint8Array;
}

type RgbaLinear = readonly [number, number, number, number];

interface StoredTile {
  ref: TileRef | MaskTileRef;
  bytes: Uint8Array;
}

export interface LayerSampler {
  layer: RasterLayer;
  inverse: Affine2D;
  width: number;
  height: number;
  tiles: Map<string, StoredTile>;
  byCell: Map<string, StoredTile>;
  mask: MaskSampler | null;
}

export interface MaskSampler {
  mask: ImageMask;
  tiles: Map<string, StoredTile>;
  byCell: Map<string, StoredTile>;
}

/** One ordered compositor step. Raster groups are composited in source space;
 * an adjustment layer then rewrites the composite below it. */
export type CompositeStep =
  | { kind: "raster"; sampler: LayerSampler }
  | { kind: "adjustment"; layer: AdjustmentLayer };

export interface CompositeView {
  payload: CompositePayload;
  sourceSize: ImageSize;
  layers: LayerSampler[];
  steps: CompositeStep[];
  adjustmentLayers: AdjustmentLayer[];
  masks: Map<string, MaskSampler>;
}

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / TILE_EDGE)}:${Math.floor(y / TILE_EDGE)}`;
}

function storeTile(map: Map<string, StoredTile>, ref: TileRef | MaskTileRef, bytes: Uint8Array): void {
  map.set(ref.id, { ref, bytes });
}

function layerExtent(tiles: readonly TileRef[]): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const tile of tiles) {
    width = Math.max(width, tile.tile_x + tile.width);
    height = Math.max(height, tile.tile_y + tile.height);
  }
  return { width, height };
}

function maskSampler(mask: ImageMask, payload: CompositePayload): MaskSampler {
  const byId = new Map<string, StoredTile>();
  for (const tile of payload.masks) {
    const ref = mask.tiles.find((candidate) => candidate.id === tile.id);
    if (!ref) continue;
    const bytes = new Uint8Array(tile.bytes);
    if (bytes.byteLength !== ref.width * ref.height) fail("image_layers.bad_request");
    storeTile(byId, ref, bytes);
  }
  const byCell = new Map<string, StoredTile>();
  for (const tile of mask.tiles) {
    const stored = byId.get(tile.id);
    if (stored) byCell.set(cellKey(tile.tile_x, tile.tile_y), stored);
  }
  return { mask, tiles: byId, byCell };
}

function layerSampler(layer: RasterLayer, payload: CompositePayload, masks: Map<string, MaskSampler>): LayerSampler {
  const byId = new Map<string, StoredTile>();
  for (const ref of layer.tiles) {
    const tile = payload.tiles.find((candidate) => candidate.id === ref.id);
    if (!tile) fail("image_layers.bad_request");
    const bytes = new Uint8Array(tile.bytes);
    if (bytes.byteLength !== ref.byte_len) fail("image_layers.bad_request");
    storeTile(byId, ref, bytes);
  }
  const byCell = new Map<string, StoredTile>();
  for (const ref of layer.tiles) {
    const stored = byId.get(ref.id);
    if (stored) byCell.set(cellKey(ref.tile_x, ref.tile_y), stored);
  }
  const extent = layerExtent(layer.tiles);
  const mask = layer.mask_id ? (masks.get(layer.mask_id) ?? null) : null;
  if (layer.mask_id && !mask) fail("image_layers.bad_request");
  return {
    layer,
    inverse: invertAffine(layer.transform),
    width: extent.width,
    height: extent.height,
    tiles: byId,
    byCell,
    mask,
  };
}

export function prepareComposite(payload: CompositePayload, options: CompositeOptions = {}): CompositeView {
  if (!payload || !payload.model) fail("image_layers.bad_request");
  const masks = new Map<string, MaskSampler>();
  for (const mask of payload.model.masks) masks.set(mask.id, maskSampler(mask, payload));
  const included = options.layer_ids ? new Set(options.layer_ids) : null;
  const respectVisibility = options.respect_visibility !== false;
  const layers: LayerSampler[] = [];
  const steps: CompositeStep[] = [];
  const adjustmentLayers: AdjustmentLayer[] = [];
  for (const layer of payload.model.layers) {
    if (respectVisibility && !layer.visible) continue;
    if (layer.opacity <= 0) continue;
    if (layer.kind === "adjustment") {
      // A selected-layer copy/merge never applies an adjustment outside the
      // requested layer set; a full composite stages it over the pixels below.
      if (included) continue;
      adjustmentLayers.push(layer);
      steps.push({ kind: "adjustment", layer });
      continue;
    }
    // Text/shape layers need their Step 18b typed renderer. Refuse them
    // rather than silently omitting visible content from the composite.
    if (layer.kind !== "raster") fail("image_layers.failed");
    if (included && !included.has(layer.id)) continue;
    const sampler = layerSampler(layer, payload, masks);
    layers.push(sampler);
    steps.push({ kind: "raster", sampler });
  }
  return { payload, sourceSize: payload.source_size, layers, steps, adjustmentLayers, masks };
}

/** Pure bilinear probe over unpremultiplied sRGB bytes. Coordinates are pixel
 * centers; an out-of-bounds sample is transparent. Exported for the pixel
 * edge test and for future eyedropper code. */
export function samplePremultipliedBilinear(
  bytes: Uint8Array,
  width: number,
  height: number,
  sampleX: number,
  sampleY: number,
): RgbaLinear {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== width * height * 4) fail("image_layers.bad_request");
  if (sampleX <= -0.5 || sampleY <= -0.5 || sampleX > width - 0.5 || sampleY > height - 0.5) return [0, 0, 0, 0];
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const fx = sampleX - x0;
  const fy = sampleY - y0;
  const at = (px: number, py: number): RgbaLinear => {
    if (px < 0 || py < 0 || px >= width || py >= height) return [0, 0, 0, 0];
    const offset = (py * width + px) * 4;
    const alpha = bytes[offset + 3] / 255;
    return [
      srgbToLinear(bytes[offset] / 255) * alpha,
      srgbToLinear(bytes[offset + 1] / 255) * alpha,
      srgbToLinear(bytes[offset + 2] / 255) * alpha,
      alpha,
    ];
  };
  const p00 = at(x0, y0);
  const p10 = at(x0 + 1, y0);
  const p01 = at(x0, y0 + 1);
  const p11 = at(x0 + 1, y0 + 1);
  const mix = (index: number) =>
    p00[index] * (1 - fx) * (1 - fy) +
    p10[index] * fx * (1 - fy) +
    p01[index] * (1 - fx) * fy +
    p11[index] * fx * fy;
  const alpha = mix(3);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [mix(0) / alpha, mix(1) / alpha, mix(2) / alpha, alpha];
}

function storedPixelLinear(tile: StoredTile, ref: TileRef | MaskTileRef, x: number, y: number): RgbaLinear {
  const localX = x - ref.tile_x;
  const localY = y - ref.tile_y;
  if (localX < 0 || localY < 0 || localX >= ref.width || localY >= ref.height) return [0, 0, 0, 0];
  const offset = (localY * ref.width + localX) * 4;
  const bytes = tile.bytes;
  const alpha = bytes[offset + 3] / 255;
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    srgbToLinear(bytes[offset] / 255) * alpha,
    srgbToLinear(bytes[offset + 1] / 255) * alpha,
    srgbToLinear(bytes[offset + 2] / 255) * alpha,
    alpha,
  ];
}

function readLayerPixel(sampler: LayerSampler, x: number, y: number): RgbaLinear {
  if (x < 0 || y < 0 || x >= sampler.width || y >= sampler.height) return [0, 0, 0, 0];
  const tile = sampler.byCell.get(cellKey(x, y));
  if (!tile) return [0, 0, 0, 0];
  return storedPixelLinear(tile, tile.ref, x, y);
}

function sampleLayerLinear(sampler: LayerSampler, canvasX: number, canvasY: number): RgbaLinear {
  const localX = sampler.inverse.a * canvasX + sampler.inverse.c * canvasY + sampler.inverse.e;
  const localY = sampler.inverse.b * canvasX + sampler.inverse.d * canvasY + sampler.inverse.f;
  const sampleX = localX - 0.5;
  const sampleY = localY - 0.5;
  if (sampleX <= -0.5 || sampleY <= -0.5 || sampleX >= sampler.width - 0.5 || sampleY >= sampler.height - 0.5) {
    return [0, 0, 0, 0];
  }
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const fx = sampleX - x0;
  const fy = sampleY - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const p00 = readLayerPixel(sampler, x0, y0);
  const p10 = readLayerPixel(sampler, x1, y0);
  const p01 = readLayerPixel(sampler, x0, y1);
  const p11 = readLayerPixel(sampler, x1, y1);
  const mix = (index: number) =>
    p00[index] * (1 - fx) * (1 - fy) +
    p10[index] * fx * (1 - fy) +
    p01[index] * (1 - fx) * fy +
    p11[index] * fx * fy;
  const alpha = mix(3);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [mix(0) / alpha, mix(1) / alpha, mix(2) / alpha, alpha];
}

function maskCoveragePixel(sampler: MaskSampler, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sampler.mask.width || y >= sampler.mask.height) return sampler.mask.inverted ? 1 : 0;
  const tile = sampler.byCell.get(cellKey(x, y));
  const alpha = tile ? tile.bytes[(y - tile.ref.tile_y) * tile.ref.width + (x - tile.ref.tile_x)] / 255 : 0;
  return sampler.mask.inverted ? 1 - alpha : alpha;
}

function sampleMask(sampler: MaskSampler, x: number, y: number): number {
  const sampleX = x - 0.5;
  const sampleY = y - 0.5;
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const fx = sampleX - x0;
  const fy = sampleY - y0;
  const at = (px: number, py: number) => maskCoveragePixel(sampler, px, py);
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  );
}

function blendLayerOver(
  backdrop: RgbaLinear,
  source: RgbaLinear,
  mask: number,
  opacity: number,
  mode: RasterLayer["blend"],
): RgbaLinear {
  if (source[3] <= 0 || mask <= 0 || opacity <= 0) return backdrop;
  const as = source[3] * opacity * mask;
  const ab = backdrop[3];
  const outA = as + ab * (1 - as);
  if (outA <= 0) return [0, 0, 0, 0];
  const blended = blendChannels(mode, [source[0], source[1], source[2]], [backdrop[0], backdrop[1], backdrop[2]]);
  const mix = (index: number) =>
    (as * (1 - ab) * source[index] + as * ab * blended[index] + (1 - as) * ab * backdrop[index]) / outA;
  return [mix(0), mix(1), mix(2), outA];
}

function compositeAtLinear(view: CompositeView, x: number, y: number): RgbaLinear {
  let backdrop: RgbaLinear = [0, 0, 0, 0];
  for (const sampler of view.layers) {
    const source = sampleLayerLinear(sampler, x, y);
    const mask = sampler.mask ? sampleMask(sampler.mask, x, y) : 1;
    backdrop = blendLayerOver(backdrop, source, mask, sampler.layer.opacity, sampler.layer.blend);
  }
  return backdrop;
}

function linearPixelToRgba(pixel: RgbaLinear): [number, number, number, number] {
  const alpha = Math.round(pixel[3] * 255);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round(linearToSrgb(pixel[0]) * 255),
    Math.round(linearToSrgb(pixel[1]) * 255),
    Math.round(linearToSrgb(pixel[2]) * 255),
    alpha,
  ];
}

export function compositeAtRgba(view: CompositeView, x: number, y: number): [number, number, number, number] {
  return linearPixelToRgba(compositeAtLinear(view, x, y));
}

function rgbaAtLinear(rgba: Uint8Array, offset: number): RgbaLinear {
  const alpha = rgba[offset + 3] / 255;
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    srgbToLinear(rgba[offset] / 255) * alpha,
    srgbToLinear(rgba[offset + 1] / 255) * alpha,
    srgbToLinear(rgba[offset + 2] / 255) * alpha,
    alpha,
  ];
}

function writeRgba(rgba: Uint8Array, offset: number, pixel: RgbaLinear): void {
  const next = linearPixelToRgba(pixel);
  rgba[offset] = next[0];
  rgba[offset + 1] = next[1];
  rgba[offset + 2] = next[2];
  rgba[offset + 3] = next[3];
}

function clippedRegion(region: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const clippedWidth = Math.min(width - x, Math.floor(region.width));
  const clippedHeight = Math.min(height - y, Math.floor(region.height));
  if (clippedWidth < 1 || clippedHeight < 1) fail("image_layers.bad_request");
  return { x, y, width: clippedWidth, height: clippedHeight };
}

function adjustmentMask(view: CompositeView, layer: AdjustmentLayer, region: Rect): Uint8Array | undefined {
  if (!layer.mask_id) return undefined;
  const sampler = view.masks.get(layer.mask_id);
  if (!sampler) fail("image_layers.bad_request");
  const mask = new Uint8Array(region.width * region.height);
  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      mask[row * region.width + column] = Math.round(sampleMask(sampler, region.x + column, region.y + row) * 255);
    }
  }
  return mask;
}

/** Source-space composite with adjustment layers staged over the pixels below
 * them. Used only when the model actually contains an adjustment layer; the
 * per-pixel raster path stays byte-identical otherwise. */
function compositeSourceBuffer(view: CompositeView, requested: Rect): CompositePixelsResult {
  const region = clippedRegion(requested, view.sourceSize.width, view.sourceSize.height);
  const rgba = new Uint8Array(region.width * region.height * 4);
  let group: LayerSampler[] = [];
  const flush = () => {
    if (group.length === 0) return;
    for (let row = 0; row < region.height; row += 1) {
      for (let column = 0; column < region.width; column += 1) {
        const offset = (row * region.width + column) * 4;
        let backdrop = rgbaAtLinear(rgba, offset);
        const x = region.x + column + 0.5;
        const y = region.y + row + 0.5;
        for (const sampler of group) {
          const source = sampleLayerLinear(sampler, x, y);
          const mask = sampler.mask ? sampleMask(sampler.mask, x, y) : 1;
          backdrop = blendLayerOver(backdrop, source, mask, sampler.layer.opacity, sampler.layer.blend);
        }
        writeRgba(rgba, offset, backdrop);
      }
    }
    group = [];
  };
  for (const step of view.steps) {
    if (step.kind === "raster") {
      group.push(step.sampler);
      continue;
    }
    flush();
    const mask = adjustmentMask(view, step.layer, region);
    const adjusted = applyAdjustmentToRgba(
      rgba,
      region.width,
      region.height,
      step.layer.adjustment,
      step.layer.opacity,
      mask,
    );
    rgba.set(adjusted);
  }
  flush();
  return { width: region.width, height: region.height, rgba };
}

function mappedSourceRegion(view: CompositeView, outputRegion: Rect): Rect {
  const inverse = outputToSourceAffine(view.payload.model.geometry, view.sourceSize);
  const corners = [
    { x: outputRegion.x, y: outputRegion.y },
    { x: outputRegion.x + outputRegion.width, y: outputRegion.y },
    { x: outputRegion.x, y: outputRegion.y + outputRegion.height },
    { x: outputRegion.x + outputRegion.width, y: outputRegion.y + outputRegion.height },
  ].map((point) => ({
    x: inverse.a * point.x + inverse.c * point.y + inverse.e,
    y: inverse.b * point.x + inverse.d * point.y + inverse.f,
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  const x = Math.max(0, Math.floor(minX) - 2);
  const y = Math.max(0, Math.floor(minY) - 2);
  return {
    x,
    y,
    width: Math.max(1, Math.min(view.sourceSize.width - x, Math.ceil(maxX) + 3 - x)),
    height: Math.max(1, Math.min(view.sourceSize.height - y, Math.ceil(maxY) + 3 - y)),
  };
}

function sampleBufferRgba(
  buffer: CompositePixelsResult,
  origin: Rect,
  sourceX: number,
  sourceY: number,
): [number, number, number, number] {
  const localX = sourceX - origin.x;
  const localY = sourceY - origin.y;
  return linearPixelToRgba(samplePremultipliedBilinear(buffer.rgba, buffer.width, buffer.height, localX, localY));
}

export function compositeSourcePixels(view: CompositeView, region: Rect): CompositePixelsResult {
  const clipped = clippedRegion(region, view.sourceSize.width, view.sourceSize.height);
  if (view.adjustmentLayers.length > 0) return compositeSourceBuffer(view, clipped);
  const x = clipped.x;
  const y = clipped.y;
  const width = clipped.width;
  const height = clipped.height;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const pixel = compositeAtRgba(view, x + column + 0.5, y + row + 0.5);
      const offset = (row * width + column) * 4;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = pixel[3];
    }
  }
  return { width, height, rgba };
}

function translateOverlay(overlay: ImageOverlay, dx: number, dy: number): ImageOverlay {
  return {
    ...overlay,
    points: overlay.points.map((point) => ({ x: point.x - dx, y: point.y - dy })),
    bounds: {
      x: overlay.bounds.x - dx,
      y: overlay.bounds.y - dy,
      width: overlay.bounds.width,
      height: overlay.bounds.height,
    },
  };
}

function drawTextOverlays(rgba: Uint8Array, width: number, height: number, overlays: readonly ImageOverlay[]): void {
  const textOverlays = overlays.filter((overlay) => overlay.kind === "text");
  if (textOverlays.length === 0) return;
  const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  if (!Offscreen) throw new Error("image_edit.failed");
  for (const overlay of textOverlays) {
    const fontSize = overlay.font_size ?? 24;
    const canvas = new Offscreen(width, height);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("image_edit.failed");
    context.font = `${fontSize}px Inter, sans-serif`;
    context.fillStyle = `rgba(${overlay.color[0]}, ${overlay.color[1]}, ${overlay.color[2]}, ${(overlay.color[3] / 255) * overlay.opacity})`;
    context.textBaseline = "top";
    context.fillText(overlay.text ?? "", overlay.points[0].x, overlay.points[0].y);
    const image = context.getImageData(0, 0, width, height);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const alpha = image.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const da = rgba[offset + 3] / 255;
      const outA = alpha + da * (1 - alpha);
      if (outA <= 0) continue;
      rgba[offset] = Math.round((image.data[offset] * alpha + rgba[offset] * da * (1 - alpha)) / outA);
      rgba[offset + 1] = Math.round((image.data[offset + 1] * alpha + rgba[offset + 1] * da * (1 - alpha)) / outA);
      rgba[offset + 2] = Math.round((image.data[offset + 2] * alpha + rgba[offset + 2] * da * (1 - alpha)) / outA);
      rgba[offset + 3] = Math.round(outA * 255);
    }
  }
}

export function compositeRegionPixels(view: CompositeView, region: Rect): CompositePixelsResult {
  const output = view.payload.model.geometry.output_size;
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(output.width - x, Math.floor(region.width));
  const height = Math.min(output.height - y, Math.floor(region.height));
  if (width < 1 || height < 1) fail("image_layers.bad_request");
  const inverse = outputToSourceAffine(view.payload.model.geometry, view.sourceSize);
  const rgba = new Uint8Array(width * height * 4);
  const staged =
    view.adjustmentLayers.length > 0
      ? (() => {
          const sourceRegion = mappedSourceRegion(view, { x, y, width, height });
          return { region: sourceRegion, pixels: compositeSourceBuffer(view, sourceRegion) };
        })()
      : null;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const outX = x + column + 0.5;
      const outY = y + row + 0.5;
      const sourceX = inverse.a * outX + inverse.c * outY + inverse.e;
      const sourceY = inverse.b * outX + inverse.d * outY + inverse.f;
      const pixel = staged
        ? sampleBufferRgba(staged.pixels, staged.region, sourceX, sourceY)
        : compositeAtRgba(view, sourceX, sourceY);
      const offset = (row * width + column) * 4;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = pixel[3];
    }
  }
  const adjusted = applyAdjustments(rgba, width, height, view.payload.model.adjustments);
  const overlays = view.payload.model.overlays.map((overlay) => translateOverlay(overlay, x, y));
  const textPending = rasterizeOverlays(adjusted, width, height, overlays);
  if (textPending) drawTextOverlays(adjusted, width, height, overlays);
  return { width, height, rgba: adjusted };
}

export interface CompositeWorkerRequest {
  type: "composite";
  request_id: string;
  payload: CompositePayload;
  region: Rect;
  options: CompositeOptions;
  mode: "source" | "region";
}

export interface CompositeWorkerResult {
  type: "result";
  request_id: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export interface CompositeWorkerFailure {
  type: "failure";
  request_id: string;
  error: string;
}

function runRequest(request: CompositeWorkerRequest): CompositePixelsResult {
  const view = prepareComposite(request.payload, request.options);
  return request.mode === "region" ? compositeRegionPixels(view, request.region) : compositeSourcePixels(view, request.region);
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<CompositeWorkerRequest>) => void) | null;
  postMessage: (message: CompositeWorkerResult | CompositeWorkerFailure, transfer?: Transferable[]) => void;
}

const isWorkerScope =
  typeof document === "undefined" &&
  typeof (globalThis as unknown as Partial<WorkerScope>).postMessage === "function" &&
  typeof (globalThis as unknown as Partial<WorkerScope>).onmessage !== "undefined";

if (isWorkerScope) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    const request = event.data;
    try {
      const result = runRequest(request);
      const buffer = result.rgba.buffer as ArrayBuffer;
      scope.postMessage(
        { type: "result", request_id: request.request_id, width: result.width, height: result.height, rgba: buffer },
        [buffer],
      );
    } catch (error) {
      scope.postMessage({
        type: "failure",
        request_id: request.request_id,
        error: error instanceof Error ? error.message : "image_layers.failed",
      });
    }
  };
}

export function runCompositeRequest(request: CompositeWorkerRequest): CompositePixelsResult {
  return runRequest(request);
}
