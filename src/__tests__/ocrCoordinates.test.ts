import { describe, expect, it } from "vitest";
import { pdfRunBox } from "../handlers/pdf/pdfCoordinates";
import { ocrBoxToSource, ocrSourceToView } from "../ocr/ocrCoordinates";

describe("OCR box geometry", () => {
  it("scales a recognised box to the original picture", () => {
    expect(ocrBoxToSource({ x: 10, y: 20, width: 30, height: 40 }, 1000, 500, 4000, 2000)).toEqual({
      x: 40,
      y: 80,
      width: 120,
      height: 160,
    });
  });

  it("checks every ratio before dividing", () => {
    expect(() => ocrBoxToSource({ x: 0, y: 0, width: 1, height: 1 }, 0, 500, 4000, 2000)).toThrow(
      RangeError,
    );
    expect(() =>
      ocrBoxToSource({ x: Number.NaN, y: 0, width: 1, height: 1 }, 1000, 500, 4000, 2000),
    ).toThrow(RangeError);
    expect(() =>
      ocrSourceToView({ x: 0, y: 0, width: 1, height: 1 }, 4000, 2000, 1000, 500, 45, 0.25),
    ).toThrow(RangeError);
  });

  it("places a zoomed box in the viewer", () => {
    expect(
      ocrSourceToView({ x: 40, y: 80, width: 120, height: 160 }, 4000, 2000, 1000, 500, 0, 0.25),
    ).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("maps corners correctly at 90 and 270 degrees", () => {
    // A 200 x 100 source becomes a 100 x 200 view when turned clockwise.
    expect(
      ocrSourceToView({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 100, 200, 90, 1),
    ).toEqual({ x: 40, y: 10, width: 40, height: 30 });
    expect(
      ocrSourceToView({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 100, 200, 270, 1),
    ).toEqual({ x: 20, y: 160, width: 40, height: 30 });
    expect(
      ocrSourceToView({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 200, 100, 180, 1),
    ).toEqual({ x: 160, y: 40, width: 30, height: 40 });
  });

  it("keeps a 90-degree PDF page aligned with the 07d viewport", () => {
    const info = { width_pt: 100, height_pt: 200 };
    expect(pdfRunBox({ x: 10, y: 20, width: 30, height: 40 }, info, 100, 90)).toEqual({
      left: 20,
      top: 10,
      width: 40,
      height: 30,
    });
    // The rendered page is already turned; its raster box maps 1:1.
    expect(
      ocrSourceToView({ x: 20, y: 10, width: 40, height: 30 }, 200, 100, 200, 100, 0, 1),
    ).toEqual({ x: 20, y: 10, width: 40, height: 30 });
  });
});
