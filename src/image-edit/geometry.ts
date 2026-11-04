import { composeAffine, invertAffine, mapRect, rotateAbout, scaleAffine, translateAffine } from "./coordinates";
import {
  assertPixels,
  fail,
  validateGeometry,
  type Affine2D,
  type ImageGeometry,
  type ImageSize,
  type Rect,
} from "./types";

/** Geometry pipeline (D3): crop -> quarter turns -> flips -> angle -> resize.
 * Crop coordinates are integer source pixels, end-exclusive. */

export function rotatedSize(size: ImageSize, quarterTurns: number): ImageSize {
  if (![0, 1, 2, 3].includes(quarterTurns)) fail("image_edit.bad_request");
  return quarterTurns % 2 === 0 ? { width: size.width, height: size.height } : { width: size.height, height: size.width };
}

/** Bounding box of a `size` rectangle rotated by `degrees`. */
export function angleBounds(size: ImageSize, degrees: number): ImageSize {
  if (!Number.isFinite(degrees)) fail("image_edit.bad_request");
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.ceil(size.width * cos + size.height * sin - 1e-9)),
    height: Math.max(1, Math.ceil(size.width * sin + size.height * cos - 1e-9)),
  };
}

export function cropSize(crop: Rect): ImageSize {
  if (!Number.isInteger(crop.x) || !Number.isInteger(crop.y)) fail("image_edit.bad_request");
  if (!Number.isInteger(crop.width) || !Number.isInteger(crop.height)) fail("image_edit.bad_request");
  if (crop.width < 1 || crop.height < 1) fail("image_edit.bad_request");
  return { width: crop.width, height: crop.height };
}

/** Rounds and clips a crop into the source; keeps at least one pixel. */
export function normalizeCrop(crop: Rect, source: ImageSize): Rect {
  let width = Math.max(1, Math.min(source.width, Math.round(crop.width)));
  let height = Math.max(1, Math.min(source.height, Math.round(crop.height)));
  let x = Math.round(crop.x);
  let y = Math.round(crop.y);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > source.width) x = Math.max(0, source.width - width);
  if (y + height > source.height) y = Math.max(0, source.height - height);
  if (x + width > source.width) width = source.width - x;
  if (y + height > source.height) height = source.height - y;
  if (width < 1 || height < 1) fail("image_edit.bad_request");
  return { x, y, width, height };
}

/** Size after crop, turns, flips and angle, before an explicit resize. */
export function naturalOutputSize(geometry: ImageGeometry, source: ImageSize): ImageSize {
  const cropped = cropSize(geometry.crop);
  const turned = rotatedSize(cropped, geometry.quarter_turns);
  return angleBounds(turned, geometry.angle_degrees);
}

export interface ResizeRequest {
  width?: number;
  height?: number;
  keepAspect?: boolean;
  allowUpscale?: boolean;
  percent?: number;
}

/** D4 resize math. With `keepAspect`, the other side derives by rounding. */
export function resizeDimensions(source: ImageSize, request: ResizeRequest): ImageSize {
  assertPixels(source.width, source.height);
  const keepAspect = request.keepAspect !== false;
  let width = request.width;
  let height = request.height;
  if (request.percent !== undefined) {
    if (!Number.isFinite(request.percent) || request.percent < 1 || request.percent > 1000) fail("image_edit.bad_request");
    width = Math.max(1, Math.round((source.width * request.percent) / 100));
    height = Math.max(1, Math.round((source.height * request.percent) / 100));
  }
  if (width === undefined && height === undefined) fail("image_edit.bad_request");
  if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 32768)) fail("image_edit.bad_request");
  if (height !== undefined && (!Number.isInteger(height) || height < 1 || height > 32768)) fail("image_edit.bad_request");
  if (keepAspect) {
    if (width === undefined) width = Math.max(1, Math.round((source.width * (height as number)) / source.height));
    if (height === undefined) height = Math.max(1, Math.round((source.height * width) / source.width));
  } else {
    width ??= source.width;
    height ??= source.height;
  }
  assertPixels(width as number, height as number);
  if (request.allowUpscale !== true && ((width as number) > source.width || (height as number) > source.height)) {
    fail("image_edit.bad_request");
  }
  return { width: width as number, height: height as number };
}

export function setCrop(geometry: ImageGeometry, source: ImageSize, crop: Rect): ImageGeometry {
  const normalized = normalizeCrop(crop, source);
  const next: ImageGeometry = { ...geometry, crop: normalized };
  next.output_size = naturalOutputSize(next, source);
  return next;
}

export function setOutputSize(geometry: ImageGeometry, source: ImageSize, outputSize: ImageSize): ImageGeometry {
  assertPixels(outputSize.width, outputSize.height);
  naturalOutputSize(geometry, source);
  return { ...geometry, output_size: outputSize };
}

export function rotateGeometry(geometry: ImageGeometry, source: ImageSize, clockwise: boolean): ImageGeometry {
  const quarterTurns = ((((geometry.quarter_turns + (clockwise ? 1 : 3)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const next: ImageGeometry = { ...geometry, quarter_turns: quarterTurns };
  next.output_size = naturalOutputSize(next, source);
  return next;
}

export function flipGeometry(geometry: ImageGeometry, horizontal: boolean): ImageGeometry {
  return horizontal ? { ...geometry, flip_x: !geometry.flip_x } : { ...geometry, flip_y: !geometry.flip_y };
}

export function setAngle(geometry: ImageGeometry, source: ImageSize, degrees: number): ImageGeometry {
  if (!Number.isFinite(degrees) || degrees < -45 || degrees > 45) fail("image_edit.bad_request");
  const rounded = Math.round(degrees * 10) / 10;
  const next: ImageGeometry = { ...geometry, angle_degrees: rounded };
  next.output_size = naturalOutputSize(next, source);
  return next;
}

export function cropTranslate(crop: Rect): Affine2D {
  return translateAffine(-crop.x, -crop.y);
}

export function quarterTurnAffine(quarterTurns: 0 | 1 | 2 | 3, cropped: ImageSize): Affine2D {
  switch (quarterTurns) {
    case 1:
      return { a: 0, b: 1, c: -1, d: 0, e: cropped.height, f: 0 };
    case 2:
      return { a: -1, b: 0, c: 0, d: -1, e: cropped.width, f: cropped.height };
    case 3:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: cropped.width };
    default:
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
}

export function flipAffine(flipX: boolean, flipY: boolean, size: ImageSize): Affine2D {
  return {
    a: flipX ? -1 : 1,
    b: 0,
    c: 0,
    d: flipY ? -1 : 1,
    e: flipX ? size.width : 0,
    f: flipY ? size.height : 0,
  };
}

/** Source pixel -> output pixel for the complete geometry. */
export function sourceToOutputAffine(geometry: ImageGeometry, source: ImageSize): Affine2D {
  validateGeometry(geometry, source);
  const cropped = cropSize(geometry.crop);
  const turned = rotatedSize(cropped, geometry.quarter_turns);
  let matrix = cropTranslate(geometry.crop);
  matrix = composeAffine(quarterTurnAffine(geometry.quarter_turns, cropped), matrix);
  matrix = composeAffine(flipAffine(geometry.flip_x, geometry.flip_y, turned), matrix);
  const bound = angleBounds(turned, geometry.angle_degrees);
  const rotated = rotateAbout(geometry.angle_degrees, turned.width / 2, turned.height / 2);
  const bounds = mapRect({ x: 0, y: 0, width: turned.width, height: turned.height }, rotated);
  matrix = composeAffine(translateAffine(-bounds.x, -bounds.y), composeAffine(rotated, matrix));
  matrix = composeAffine(
    scaleAffine(geometry.output_size.width / bound.width, geometry.output_size.height / bound.height),
    matrix,
  );
  return matrix;
}

export function outputToSourceAffine(geometry: ImageGeometry, source: ImageSize): Affine2D {
  return invertAffine(sourceToOutputAffine(geometry, source));
}

/** Average source pixels per output pixel; used to scale brush radius. */
export function outputToSourceScale(geometry: ImageGeometry, source: ImageSize): number {
  const matrix = outputToSourceAffine(geometry, source);
  return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
}

/** Maps output coordinates to source pixels for painting and crop previews. */
export function outputPointToSource(
  point: { x: number; y: number },
  geometry: ImageGeometry,
  source: ImageSize,
): { x: number; y: number } {
  const matrix = outputToSourceAffine(geometry, source);
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}
