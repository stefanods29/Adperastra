import { fail, validateAffine, type Affine2D, type Point } from "./types";

/** Exact stored-pixel math (E4). Screen coordinates are never stored; every
 * tool converts through these matrices. */

export function identityAffine(): Affine2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function determinant(matrix: Affine2D): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

export function invertAffine(matrix: Affine2D): Affine2D {
  validateAffine(matrix, true);
  const det = determinant(matrix);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) fail("image_edit.bad_request");
  const a = matrix.d / det;
  const b = -matrix.b / det;
  const c = -matrix.c / det;
  const d = matrix.a / det;
  return {
    a,
    b,
    c,
    d,
    e: -(a * matrix.e + c * matrix.f),
    f: -(b * matrix.e + d * matrix.f),
  };
}

/** Applies `matrix` to an image point. */
export function applyAffine(point: Point, matrix: Affine2D): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) fail("image_edit.bad_request");
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function imageToViewport(point: Point, matrix: Affine2D): Point {
  return applyAffine(point, matrix);
}

export function viewportToImage(point: Point, matrix: Affine2D): Point {
  return applyAffine(point, invertAffine(matrix));
}

/** Returns `outer ∘ inner`: the point passes through `inner` first. */
export function composeAffine(outer: Affine2D, inner: Affine2D): Affine2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function translateAffine(x: number, y: number): Affine2D {
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail("image_edit.bad_request");
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleAffine(x: number, y: number): Affine2D {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) fail("image_edit.bad_request");
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotateAffine(degrees: number): Affine2D {
  if (!Number.isFinite(degrees)) fail("image_edit.bad_request");
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Rotates about `(cx, cy)`. */
export function rotateAbout(degrees: number, cx: number, cy: number): Affine2D {
  return composeAffine(translateAffine(cx, cy), composeAffine(rotateAffine(degrees), translateAffine(-cx, -cy)));
}

export function mapRect(rect: { x: number; y: number; width: number; height: number }, matrix: Affine2D) {
  const corners = [
    applyAffine({ x: rect.x, y: rect.y }, matrix),
    applyAffine({ x: rect.x + rect.width, y: rect.y }, matrix),
    applyAffine({ x: rect.x, y: rect.y + rect.height }, matrix),
    applyAffine({ x: rect.x + rect.width, y: rect.y + rect.height }, matrix),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
