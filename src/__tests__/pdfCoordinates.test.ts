import { describe, expect, it } from "vitest";
import {
  applyPdfMatrix,
  invertPdfMatrix,
  pdfInversePoint,
  pdfRunBox,
  pdfViewportMatrix,
  pdfViewportPoint,
  pdfViewportSize,
} from "../handlers/pdf/pdfCoordinates";

/** The exact page transform of Step 07d T5: one viewport matrix, its
 * inverse, and the flipped default viewport of the plan. */

const page = { page: 1, width_pt: 100, height_pt: 200, rotation: 0 as const };

describe("pdf page coordinates", () => {
  it("uses the PDF.js flipped viewport for rotation 90", () => {
    expect(pdfViewportMatrix(page, 100, 90)).toEqual([0, 1, 1, 0, 0, 0]);
    expect(pdfViewportSize(page, 100, 90)).toEqual({ width: 200, height: 100 });
    expect(pdfViewportPoint(10, 20, page, 100, 90)).toEqual({ x: 20, y: 10 });
    expect(pdfViewportSize(page, 100, 0)).toEqual({ width: 100, height: 200 });
  })

  it("returns the same point through the inverse", () => {
    const forward = pdfViewportPoint(10, 20, page, 100, 90);
    const back = pdfInversePoint(forward.x, forward.y, page, 100, 90);
    expect(back.x).toBeCloseTo(10, 6);
    expect(back.y).toBeCloseTo(20, 6);
    // Every rotation round-trips too.
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const zoom of [10, 100, 400]) {
        const point = pdfViewportPoint(37, 61, page, zoom, rotation);
        const inverse = pdfInversePoint(point.x, point.y, page, zoom, rotation);
        expect(inverse.x).toBeCloseTo(37, 6);
        expect(inverse.y).toBeCloseTo(61, 6);
      }
    }
  })

  it("keeps every rotated page inside its box", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const size = pdfViewportSize(page, 100, rotation);
      const corners = [
        pdfViewportPoint(0, 0, page, 100, rotation),
        pdfViewportPoint(100, 0, page, 100, rotation),
        pdfViewportPoint(0, 200, page, 100, rotation),
        pdfViewportPoint(100, 200, page, 100, rotation),
      ];
      for (const corner of corners) {
        expect(corner.x).toBeGreaterThanOrEqual(-1e-9);
        expect(corner.y).toBeGreaterThanOrEqual(-1e-9);
        expect(corner.x).toBeLessThanOrEqual(size.width + 1e-9);
        expect(corner.y).toBeLessThanOrEqual(size.height + 1e-9);
      }
    }
  })

  it("applies the matrix once, without composed transforms", () => {
    const matrix = pdfViewportMatrix(page, 200, 180);
    expect(matrix).toEqual([-2, 0, 0, -2, 200, 400]);
    expect(applyPdfMatrix(matrix, { x: 0, y: 0 })).toEqual({ x: 200, y: 400 });
    expect(applyPdfMatrix(matrix, { x: 100, y: 200 })).toEqual({ x: 0, y: 0 });
    const inverted = invertPdfMatrix(matrix);
    const back = applyPdfMatrix(inverted, { x: 200, y: 400 });
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.y).toBeCloseTo(0, 6);
    // A singular matrix changes nothing and never throws.
    expect(invertPdfMatrix([0, 0, 0, 0, 1, 1])).toEqual([0, 0, 0, 0, 0, 0]);
  })

  it("gives a text run its box on the page", () => {
    const run = { x: 10, y: 20, width: 30, height: 10 };
    expect(pdfRunBox(run, page, 100, 0)).toEqual({ left: 10, top: 20, width: 30, height: 10 });
    expect(pdfRunBox(run, page, 100, 90)).toEqual({ left: 20, top: 10, width: 10, height: 30 });
  })
})
