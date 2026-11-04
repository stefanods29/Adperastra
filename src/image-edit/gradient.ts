import { linearToSrgb, srgbToLinear } from "./blend";
import { applyPixelField, cancelFieldWork, commitBrushResult, fieldChecker } from "./brush";
import { selectionCoverageAt } from "./selectionRaster";
import type { SelectionMask } from "./selectionTypes";
import { getImageEditorModel } from "./ImageDocument";
import { fail, sourceSizeOf, type Point } from "./types";

/** Linear and radial gradients (Step 18b D3).
 *
 * Stops are ordered, 2..32, inside 0..1. Colors interpolate in premultiplied
 * linear RGB and are stored unpremultiplied sRGB, like the rest of the image
 * pipeline. Coincident geometry or duplicate stop positions are refused. */

export type GradientColor = [number, number, number, number];

export interface GradientStop {
  position: number;
  color: GradientColor;
}

export type GradientGeometry =
  | { kind: "linear"; start: Point; end: Point }
  | { kind: "radial"; center: Point; radius: number };

export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 32;

export function validateGradientStops(stops: readonly GradientStop[]): void {
  if (!Array.isArray(stops)) fail("image_edit.bad_request");
  if (stops.length < MIN_GRADIENT_STOPS || stops.length > MAX_GRADIENT_STOPS) fail("image_edit.bad_request");
  let previous = -Infinity;
  for (const stop of stops) {
    if (!stop || typeof stop.position !== "number" || !Number.isFinite(stop.position)) fail("image_edit.bad_request");
    if (stop.position < 0 || stop.position > 1) fail("image_edit.bad_request");
    if (stop.position <= previous) fail("image_edit.bad_request");
    previous = stop.position;
    if (!Array.isArray(stop.color) || stop.color.length !== 4) fail("image_edit.bad_request");
    for (const channel of stop.color) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
    }
  }
}

export function validateGradientGeometry(geometry: GradientGeometry): void {
  if (!geometry || typeof geometry !== "object") fail("image_edit.bad_request");
  if (geometry.kind === "linear") {
    const { start, end } = geometry;
    if (!start || !end) fail("image_edit.bad_request");
    for (const value of [start.x, start.y, end.x, end.y]) {
      if (typeof value !== "number" || !Number.isFinite(value)) fail("image_edit.bad_request");
    }
    if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) fail("image_edit.bad_request");
    return;
  }
  if (geometry.kind === "radial") {
    const { center, radius } = geometry;
    if (!center || typeof center.x !== "number" || typeof center.y !== "number") fail("image_edit.bad_request");
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) fail("image_edit.bad_request");
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) fail("image_edit.bad_request");
    return;
  }
  fail("image_edit.bad_request");
}

export function gradientParameter(geometry: GradientGeometry, point: Point): number {
  if (geometry.kind === "linear") {
    const dx = geometry.end.x - geometry.start.x;
    const dy = geometry.end.y - geometry.start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0) fail("image_edit.bad_request");
    const t = ((point.x - geometry.start.x) * dx + (point.y - geometry.start.y) * dy) / lengthSquared;
    return Math.min(1, Math.max(0, t));
  }
  const distance = Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y);
  return Math.min(1, Math.max(0, distance / geometry.radius));
}

function stopColor(stop: GradientStop): GradientColor {
  return [stop.color[0], stop.color[1], stop.color[2], stop.color[3]];
}

/** Exact at the endpoints, premultiplied-linear in between. */
export function gradientColorAt(geometry: GradientGeometry, stops: readonly GradientStop[], point: Point): GradientColor {
  validateGradientGeometry(geometry);
  validateGradientStops(stops);
  const t = gradientParameter(geometry, point);
  if (t <= 0) return stopColor(stops[0]);
  if (t >= 1) return stopColor(stops[stops.length - 1]);
  let index = 0;
  while (index + 1 < stops.length && stops[index + 1].position < t) index += 1;
  const left = stops[index];
  const right = stops[Math.min(stops.length - 1, index + 1)];
  const span = right.position - left.position;
  const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - left.position) / span));
  const alphaLeft = left.color[3] / 255;
  const alphaRight = right.color[3] / 255;
  const alpha = alphaLeft + (alphaRight - alphaLeft) * ratio;
  if (alpha <= 0) return [0, 0, 0, 0];
  const channel = (offset: number): number => {
    const low = srgbToLinear(left.color[offset] / 255) * alphaLeft;
    const high = srgbToLinear(right.color[offset] / 255) * alphaRight;
    return linearToSrgb((low + (high - low) * ratio) / alpha);
  };
  return [
    Math.max(0, Math.min(255, Math.round(channel(0) * 255))),
    Math.max(0, Math.min(255, Math.round(channel(1) * 255))),
    Math.max(0, Math.min(255, Math.round(channel(2) * 255))),
    Math.max(0, Math.min(255, Math.round(alpha * 255))),
  ];
}

function colorAtPrepared(
  geometry: GradientGeometry,
  stops: readonly GradientStop[],
): (x: number, y: number) => GradientColor {
  return (x, y) => {
    const t = gradientParameter(geometry, { x: x + 0.5, y: y + 0.5 });
    if (t <= 0) return stopColor(stops[0]);
    if (t >= 1) return stopColor(stops[stops.length - 1]);
    let index = 0;
    while (index + 1 < stops.length && stops[index + 1].position < t) index += 1;
    const left = stops[index];
    const right = stops[Math.min(stops.length - 1, index + 1)];
    const span = right.position - left.position;
    const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - left.position) / span));
    const alphaLeft = left.color[3] / 255;
    const alphaRight = right.color[3] / 255;
    const alpha = alphaLeft + (alphaRight - alphaLeft) * ratio;
    if (alpha <= 0) return [0, 0, 0, 0];
    const channel = (offset: number): number => {
      const low = srgbToLinear(left.color[offset] / 255) * alphaLeft;
      const high = srgbToLinear(right.color[offset] / 255) * alphaRight;
      return linearToSrgb((low + (high - low) * ratio) / alpha);
    };
    return [
      Math.max(0, Math.min(255, Math.round(channel(0) * 255))),
      Math.max(0, Math.min(255, Math.round(channel(1) * 255))),
      Math.max(0, Math.min(255, Math.round(channel(2) * 255))),
      Math.max(0, Math.min(255, Math.round(alpha * 255))),
    ];
  };
}

/** E1 companion: paints a gradient through the selection in one transaction. */
export async function applyGradient(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  geometry: GradientGeometry,
  stops: readonly GradientStop[],
  selection: SelectionMask,
  opacity = 1,
): Promise<void> {
  validateGradientGeometry(geometry);
  validateGradientStops(stops);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail("image_edit.bad_request");
  if (!selection) fail("image_edit.bad_request");
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  const sourceSize = sourceSizeOf(model);
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_edit.bad_request");
  if (layer.locked) fail("image_edit.read_only");
  if (selection.width !== sourceSize.width || selection.height !== sourceSize.height) fail("image_edit.bad_request");
  if (selection.kind === "empty" || opacity === 0) return;
  const coverage = new Uint8Array(sourceSize.width * sourceSize.height);
  if (selection.kind === "full") {
    coverage.fill(255);
  } else {
    for (let y = 0; y < sourceSize.height; y += 1) {
      for (let x = 0; x < sourceSize.width; x += 1) {
        coverage[y * sourceSize.width + x] = Math.round(selectionCoverageAt(selection, x, y) * 255);
      }
    }
  }
  const result = await applyPixelField(
    documentId,
    layer.tiles,
    sourceSize,
    coverage,
    colorAtPrepared(geometry, stops),
    opacity,
    fieldChecker(),
  );
  if (!result) return;
  await commitBrushResult(documentId, expectedContentId, layerId, result.tiles, result.changed_bytes);
}

export { cancelFieldWork as cancelGradientWork };
