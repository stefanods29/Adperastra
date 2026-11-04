import {
  fail,
  MAX_OVERLAYS,
  MAX_OVERLAY_POINTS,
  newUuid,
  validateOverlay,
  type ImageOverlay,
  type ImageSize,
  type OverlayKind,
  type Point,
} from "./types";

/** Editable markup overlays (D8). Overlays stay editable in the open
 * document; an ordinary image export flattens them into pixels. */

export interface OverlayStyle {
  color?: [number, number, number, number];
  width?: number;
  opacity?: number;
  text?: string;
  font_size?: number;
  fill?: [number, number, number, number];
}

export function overlayBounds(kind: OverlayKind, points: readonly Point[], width: number): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) fail("image_edit.bad_request");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (kind === "stroke" || kind === "arrow" || kind === "highlight") {
    const pad = Math.max(1, width / 2);
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
  };
}

export function createOverlay(
  kind: OverlayKind,
  points: readonly Point[],
  canvas: ImageSize,
  style: OverlayStyle = {},
): ImageOverlay {
  if (points.length < (kind === "text" ? 1 : 2)) fail("image_edit.bad_request");
  if (points.length > MAX_OVERLAY_POINTS) fail("image_edit.bad_request");
  // Pointer capture can end outside the canvas; stored coordinates and the
  // padded bounds must stay inside the validated canvas.
  const clamped = points.map((point) => ({
    x: Math.min(canvas.width, Math.max(0, point.x)),
    y: Math.min(canvas.height, Math.max(0, point.y)),
  }));
  const width = style.width ?? 4;
  const raw = overlayBounds(kind, clamped, width);
  const bounds = {
    x: Math.min(raw.x, Math.max(0, canvas.width - 1)),
    y: Math.min(raw.y, Math.max(0, canvas.height - 1)),
    width: 1,
    height: 1,
  };
  bounds.width = Math.max(1, Math.min(raw.width, canvas.width - bounds.x));
  bounds.height = Math.max(1, Math.min(raw.height, canvas.height - bounds.y));
  const overlay: ImageOverlay = {
    id: newUuid(),
    kind,
    points: clamped,
    bounds,
    color: style.color ?? [255, 255, 255, 255],
    width,
    opacity: style.opacity ?? 1,
    text: style.text,
    font_size: style.font_size,
    fill: style.fill,
  };
  validateOverlay(overlay, canvas);
  return overlay;
}

export function addOverlay(model: { overlays: ImageOverlay[] }, overlay: ImageOverlay, canvas: ImageSize): ImageOverlay[] {
  if (model.overlays.length >= MAX_OVERLAYS) fail("image_edit.too_large");
  validateOverlay(overlay, canvas);
  return [...model.overlays, overlay];
}

export function updateOverlay(
  overlays: readonly ImageOverlay[],
  id: string,
  replacement: ImageOverlay,
  canvas: ImageSize,
): ImageOverlay[] {
  if (!overlays.some((overlay) => overlay.id === id)) fail("image_edit.bad_request");
  validateOverlay(replacement, canvas);
  return overlays.map((overlay) => (overlay.id === id ? replacement : overlay));
}

export function removeOverlay(overlays: readonly ImageOverlay[], id: string): ImageOverlay[] {
  if (!overlays.some((overlay) => overlay.id === id)) fail("image_edit.bad_request");
  return overlays.filter((overlay) => overlay.id !== id);
}

function blendPixel(
  rgba: Uint8Array,
  offset: number,
  color: readonly [number, number, number, number],
  coverage: number,
  opacity: number,
): void {
  const sa = Math.min(1, Math.max(0, coverage)) * Math.min(1, Math.max(0, opacity)) * (color[3] / 255);
  if (sa <= 0) return;
  const da = rgba[offset + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  rgba[offset] = Math.round((color[0] * sa + rgba[offset] * da * (1 - sa)) / outA);
  rgba[offset + 1] = Math.round((color[1] * sa + rgba[offset + 1] * da * (1 - sa)) / outA);
  rgba[offset + 2] = Math.round((color[2] * sa + rgba[offset + 2] * da * (1 - sa)) / outA);
  rgba[offset + 3] = Math.round(outA * 255);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function drawLine(
  rgba: Uint8Array,
  width: number,
  height: number,
  start: Point,
  end: Point,
  overlay: ImageOverlay,
): void {
  const radius = Math.max(0.5, overlay.width / 2);
  const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - radius));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + radius));
  const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - radius));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment({ x: x + 0.5, y: y + 0.5 }, start, end);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      if (coverage > 0) blendPixel(rgba, (y * width + x) * 4, overlay.color, coverage, overlay.opacity);
    }
  }
}

function drawFilledRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  overlay: ImageOverlay,
): void {
  const color = overlay.fill ?? overlay.color;
  const minX = Math.max(0, Math.floor(bounds.x));
  const maxX = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const minY = Math.max(0, Math.floor(bounds.y));
  const maxY = Math.min(height, Math.ceil(bounds.y + bounds.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      blendPixel(rgba, (y * width + x) * 4, color, 1, overlay.opacity);
    }
  }
}

function drawEllipse(
  rgba: Uint8Array,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  overlay: ImageOverlay,
): void {
  const radiusX = bounds.width / 2;
  const radiusY = bounds.height / 2;
  const centerX = bounds.x + radiusX;
  const centerY = bounds.y + radiusY;
  if (overlay.fill) {
    for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(height, Math.ceil(bounds.y + bounds.height)); y += 1) {
      for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(width, Math.ceil(bounds.x + bounds.width)); x += 1) {
        const nx = (x + 0.5 - centerX) / radiusX;
        const ny = (y + 0.5 - centerY) / radiusY;
        if (nx * nx + ny * ny <= 1) blendPixel(rgba, (y * width + x) * 4, overlay.fill, 1, overlay.opacity);
      }
    }
  }
  const steps = Math.max(32, Math.ceil((radiusX + radiusY) * 1.5));
  let previous: Point | null = null;
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const point = { x: centerX + radiusX * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) };
    if (previous) drawLine(rgba, width, height, previous, point, overlay);
    previous = point;
  }
}

/** Flattens non-text overlays into pixels. Text overlays return false so the
 * caller must render them with the licensed font in the render worker. */
export function rasterizeOverlays(
  rgba: Uint8Array,
  width: number,
  height: number,
  overlays: readonly ImageOverlay[],
): boolean {
  if (rgba.byteLength !== width * height * 4) fail("image_edit.bad_request");
  let textPending = false;
  for (const overlay of overlays) {
    switch (overlay.kind) {
      case "stroke":
        for (let index = 1; index < overlay.points.length; index += 1) {
          drawLine(rgba, width, height, overlay.points[index - 1], overlay.points[index], overlay);
        }
        break;
      case "arrow": {
        const start = overlay.points[0];
        const end = overlay.points[overlay.points.length - 1];
        drawLine(rgba, width, height, start, end, overlay);
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const head = Math.max(8, overlay.width * 3);
        for (const delta of [Math.PI * 0.82, -Math.PI * 0.82]) {
          drawLine(rgba, width, height, end, { x: end.x + head * Math.cos(angle + delta), y: end.y + head * Math.sin(angle + delta) }, overlay);
        }
        break;
      }
      case "rectangle":
        if (overlay.fill) drawFilledRect(rgba, width, height, overlay.bounds, overlay);
        else {
          const { x, y, width: w, height: h } = overlay.bounds;
          drawLine(rgba, width, height, { x, y }, { x: x + w, y }, overlay);
          drawLine(rgba, width, height, { x: x + w, y }, { x: x + w, y: y + h }, overlay);
          drawLine(rgba, width, height, { x: x + w, y: y + h }, { x, y: y + h }, overlay);
          drawLine(rgba, width, height, { x, y: y + h }, { x, y }, overlay);
        }
        break;
      case "ellipse":
        drawEllipse(rgba, width, height, overlay.bounds, overlay);
        break;
      case "highlight":
        drawFilledRect(rgba, width, height, overlay.bounds, overlay);
        break;
      case "text":
        textPending = true;
        break;
      default:
        fail("image_edit.bad_request");
    }
  }
  return textPending;
}
