import { applyAdjustments } from "./adjustments";
import { rasterizeOverlays } from "./overlays";
import { outputToSourceAffine } from "./geometry";
import {
  assertPixels,
  fail,
  MAX_IMAGE_EDGE,
  type ImageGeometry,
  type ImageOverlay,
  type ImageSize,
  type ImageAdjustments,
  type Rect,
  type TileRef,
} from "./types";
import type { RenderWorkerFailure, RenderWorkerRequest, RenderWorkerResult, WorkerTile } from "./workerTypes";

/** Rendering worker (E3 preview path). The pixel algorithm is exported for
 * the bounded non-worker fallback used by tests and environments without
 * `Worker`; production always uses the worker. Full-resolution export is
 * rendered by the native helper. */

interface SourcePixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function buildSource(tiles: readonly TileRef[], payload: readonly WorkerTile[], width: number, height: number): SourcePixels {
  const rgba = new Uint8Array(width * height * 4);
  const bytes = new Map(payload.map((tile) => [tile.ref.id, new Uint8Array(tile.bytes)]));
  for (const ref of tiles) {
    const data = bytes.get(ref.id);
    if (!data || data.byteLength !== ref.byte_len) fail("image_edit.bad_request");
    for (let row = 0; row < ref.height; row += 1) {
      const sourceStart = row * ref.width * 4;
      const targetStart = ((ref.tile_y + row) * width + ref.tile_x) * 4;
      rgba.set(data.subarray(sourceStart, sourceStart + ref.width * 4), targetStart);
    }
  }
  return { width, height, rgba };
}

function sample(source: SourcePixels, x: number, y: number): [number, number, number, number] {
  const clampX = Math.min(source.width - 1.001, Math.max(0, x - 0.5));
  const clampY = Math.min(source.height - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(clampX);
  const y0 = Math.floor(clampY);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const fx = clampX - x0;
  const fy = clampY - y0;
  const at = (px: number, py: number): [number, number, number, number] => {
    const offset = (py * source.width + px) * 4;
    return [source.rgba[offset], source.rgba[offset + 1], source.rgba[offset + 2], source.rgba[offset + 3]];
  };
  const p00 = at(x0, y0);
  const p10 = at(x1, y0);
  const p01 = at(x0, y1);
  const p11 = at(x1, y1);
  // Interpolate premultiplied color, then unpremultiply.
  const premultiply = (p: [number, number, number, number]) => {
    const a = p[3] / 255;
    return [p[0] * a, p[1] * a, p[2] * a, a] as [number, number, number, number];
  };
  const m00 = premultiply(p00);
  const m10 = premultiply(p10);
  const m01 = premultiply(p01);
  const m11 = premultiply(p11);
  const mix = (index: number) =>
    m00[index] * (1 - fx) * (1 - fy) + m10[index] * fx * (1 - fy) + m01[index] * (1 - fx) * fy + m11[index] * fx * fy;
  const alpha = mix(3);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [Math.round(mix(0) / alpha), Math.round(mix(1) / alpha), Math.round(mix(2) / alpha), Math.round(alpha * 255)];
}

function renderMapped(
  source: SourcePixels,
  geometry: ImageGeometry,
  output: ImageSize,
  region: Rect,
): Uint8Array {
  const rgba = new Uint8Array(output.width * output.height * 4);
  const inverse = outputToSourceAffine(geometry, { width: source.width, height: source.height });
  const scaleX = geometry.output_size.width / output.width;
  const scaleY = geometry.output_size.height / output.height;
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const outX = region.x + (x + 0.5) * scaleX;
      const outY = region.y + (y + 0.5) * scaleY;
      const sourceX = inverse.a * outX + inverse.c * outY + inverse.e;
      const sourceY = inverse.b * outX + inverse.d * outY + inverse.f;
      const pixel = sample(source, sourceX, sourceY);
      const offset = (y * output.width + x) * 4;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = pixel[3];
    }
  }
  return rgba;
}

/** Compare view: the oriented original fitted into the same output canvas. */
function renderCompare(source: SourcePixels, output: ImageSize): Uint8Array {
  const scale = Math.min(output.width / source.width, output.height / source.height);
  const width = Math.max(1, Math.min(output.width, Math.round(source.width * scale)));
  const height = Math.max(1, Math.min(output.height, Math.round(source.height * scale)));
  const offsetX = Math.floor((output.width - width) / 2);
  const offsetY = Math.floor((output.height - height) / 2);
  const rgba = new Uint8Array(output.width * output.height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = sample(source, ((x + 0.5) * source.width) / width, ((y + 0.5) * source.height) / height);
      const offset = ((y + offsetY) * output.width + x + offsetX) * 4;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = pixel[3];
    }
  }
  return rgba;
}

function drawTextOverlays(
  rgba: Uint8Array,
  width: number,
  height: number,
  overlays: readonly ImageOverlay[],
): boolean {
  const textOverlays = overlays.filter((overlay) => overlay.kind === "text");
  if (textOverlays.length === 0) return true;
  const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  if (!Offscreen) return false;
  for (const overlay of textOverlays) {
    const fontSize = overlay.font_size ?? 24;
    const canvas = new Offscreen(width, height);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!context) return false;
    context.font = `${fontSize}px Inter, sans-serif`;
    context.fillStyle = `rgba(${overlay.color[0]}, ${overlay.color[1]}, ${overlay.color[2]}, ${(overlay.color[3] / 255) * overlay.opacity})`;
    context.textBaseline = "top";
    context.fillText(overlay.text ?? "", overlay.points[0].x, overlay.points[0].y);
    const image = context.getImageData(0, 0, width, height);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const alpha = image.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const destination = rgba[offset + 3] / 255;
      const outA = alpha + destination * (1 - alpha);
      if (outA <= 0) continue;
      rgba[offset] = Math.round((image.data[offset] * alpha + rgba[offset] * destination * (1 - alpha)) / outA);
      rgba[offset + 1] = Math.round((image.data[offset + 1] * alpha + rgba[offset + 1] * destination * (1 - alpha)) / outA);
      rgba[offset + 2] = Math.round((image.data[offset + 2] * alpha + rgba[offset + 2] * destination * (1 - alpha)) / outA);
      rgba[offset + 3] = Math.round(outA * 255);
    }
  }
  return true;
}

function scaleOverlays(
  overlays: readonly ImageOverlay[],
  sx: number,
  sy: number,
  region: Rect,
): ImageOverlay[] {
  return overlays.map((overlay) => ({
    ...overlay,
    points: overlay.points.map((point) => ({ x: (point.x - region.x) * sx, y: (point.y - region.y) * sy })),
    bounds: {
      x: (overlay.bounds.x - region.x) * sx,
      y: (overlay.bounds.y - region.y) * sy,
      width: overlay.bounds.width * sx,
      height: overlay.bounds.height * sy,
    },
    width: Math.max(1, overlay.width * Math.min(sx, sy)),
    font_size: overlay.font_size ? Math.max(1, overlay.font_size * Math.min(sx, sy)) : undefined,
  }));
}

export function renderPixels(request: RenderWorkerRequest): { width: number; height: number; rgba: Uint8Array; textPending: boolean } {
  assertPixels(request.source_size.width, request.source_size.height);
  const source = buildSource(
    request.compare_original ? request.original_tiles : request.layer_tiles,
    request.tiles,
    request.source_size.width,
    request.source_size.height,
  );
  let outputWidth = request.geometry.output_size.width;
  let outputHeight = request.geometry.output_size.height;
  if (request.region) {
    if (!Number.isFinite(request.region.x) || !Number.isFinite(request.region.y) || request.region.width < 1 || request.region.height < 1) {
      fail("image_edit.bad_request");
    }
    outputWidth = Math.min(request.geometry.output_size.width, Math.ceil(request.region.width));
    outputHeight = Math.min(request.geometry.output_size.height, Math.ceil(request.region.height));
  }
  const edge = Math.min(MAX_IMAGE_EDGE, Math.max(1, Math.floor(request.edge)));
  const scale = Math.min(1, edge / Math.max(outputWidth, outputHeight));
  outputWidth = Math.max(1, Math.min(outputWidth, Math.round(outputWidth * scale)));
  outputHeight = Math.max(1, Math.min(outputHeight, Math.round(outputHeight * scale)));
  const region: Rect = request.region ?? { x: 0, y: 0, width: request.geometry.output_size.width, height: request.geometry.output_size.height };
  let rgba = request.compare_original
    ? renderCompare(source, { width: outputWidth, height: outputHeight })
    : renderMapped(source, request.geometry, { width: outputWidth, height: outputHeight }, region);
  let textPending = false;
  if (!request.compare_original) {
    rgba = applyAdjustments(rgba, outputWidth, outputHeight, request.adjustments);
    const sx = outputWidth / Math.max(1, region.width);
    const sy = outputHeight / Math.max(1, region.height);
    const overlays = sx === 1 && sy === 1 && region.x === 0 && region.y === 0
      ? request.overlays
      : scaleOverlays(request.overlays, sx, sy, region);
    const pending = rasterizeOverlays(rgba, outputWidth, outputHeight, overlays);
    textPending = pending ? !drawTextOverlays(rgba, outputWidth, outputHeight, overlays) : false;
  }
  return { width: outputWidth, height: outputHeight, rgba, textPending };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null;
  postMessage: (message: RenderWorkerResult | RenderWorkerFailure, transfer?: Transferable[]) => void;
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
      const result = renderPixels(request);
      const buffer = result.rgba.buffer as ArrayBuffer;
      scope.postMessage(
        {
          type: "result",
          request_id: request.request_id,
          width: result.width,
          height: result.height,
          rgba: buffer,
          text_pending: result.textPending,
        },
        [buffer],
      );
    } catch (error) {
      scope.postMessage({
        type: "failure",
        request_id: request.request_id,
        error: error instanceof Error ? error.message : "image_edit.failed",
      });
    }
  };
}
