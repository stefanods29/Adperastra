import type { PdfPageInfo, PdfRotation } from "../../services/pdf";

/** Page coordinates for the PDF viewer (Step 07d D7, E5).
 *
 * PDF text runs are in PDF points on the unrotated page, with the origin at
 * the top-left. The screen needs them in the rotated, zoomed page box. One
 * affine matrix (the same order PDF.js uses: `[a, b, c, d, e, f]`) does the
 * whole job, so the overlay and anything later (OCR boxes, annotations) use
 * one transform and never compose their own.
 *
 * The point functions are pure and unit-tested. */

/** `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type PdfMatrix = readonly [number, number, number, number, number, number];

export interface PdfPoint {
  x: number;
  y: number;
}

function scaleOf(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return zoom / 100;
}

/** The rotated page box at this zoom, in CSS pixels. */
export function pdfViewportSize(
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): { width: number; height: number } {
  const s = scaleOf(zoom);
  const width = Math.max(0, info.width_pt) * s;
  const height = Math.max(0, info.height_pt) * s;
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * The viewport matrix of one page (the PDF.js "flipped" default viewport).
 *
 * rotation 0:   [ s, 0, 0, s, 0, 0]
 * rotation 90:  [ 0, s, s, 0, 0, 0]   (a 100×200 pt page becomes 200×100)
 * rotation 180: [-s, 0, 0,-s, s·w, s·h]
 * rotation 270: [ 0,-s,-s, 0, s·h, s·w]
 */
export function pdfViewportMatrix(
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): PdfMatrix {
  const s = scaleOf(zoom);
  const w = Math.max(0, info.width_pt) * s;
  const h = Math.max(0, info.height_pt) * s;
  switch (rotation) {
    case 90:
      return [0, s, s, 0, 0, 0];
    case 180:
      return [-s, 0, 0, -s, w, h];
    case 270:
      return [0, -s, -s, 0, h, w];
    default:
      return [s, 0, 0, s, 0, 0];
  }
}

/** One point through a matrix. */
export function applyPdfMatrix(matrix: PdfMatrix, point: PdfPoint): PdfPoint {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** The inverse of an affine matrix; a singular matrix keeps the origin. */
export function invertPdfMatrix(matrix: PdfMatrix): PdfMatrix {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) return [0, 0, 0, 0, 0, 0];
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

/** A PDF-point position to the page box, in CSS pixels. */
export function pdfViewportPoint(
  x: number,
  y: number,
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): PdfPoint {
  return applyPdfMatrix(pdfViewportMatrix(info, zoom, rotation), { x, y });
}

/** A page-box position back to PDF points (selection, later annotations). */
export function pdfInversePoint(
  x: number,
  y: number,
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): PdfPoint {
  return applyPdfMatrix(invertPdfMatrix(pdfViewportMatrix(info, zoom, rotation)), { x, y });
}

/** A text run's box in page pixels, for the selection overlay. */
export function pdfRunBox(
  run: { x: number; y: number; width: number; height: number },
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): { left: number; top: number; width: number; height: number } {
  const start = pdfViewportPoint(run.x, run.y, info, zoom, rotation);
  const end = pdfViewportPoint(run.x + run.width, run.y + run.height, info, zoom, rotation);
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
