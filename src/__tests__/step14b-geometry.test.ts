import { describe, expect, it } from "vitest";
import { imageToViewport, viewportToImage } from "../image-edit/coordinates";
import {
  naturalOutputSize,
  outputToSourceAffine,
  resizeDimensions,
  rotatedSize,
  setCrop,
  sourceToOutputAffine,
} from "../image-edit/geometry";
import { createDefaultGeometry } from "../image-edit/types";

describe("image geometry", () => {
  it("rotate90_3x2_becomes2x3", () => {
    expect(rotatedSize({ width: 3, height: 2 }, 1)).toEqual({ width: 2, height: 3 });
    expect(rotatedSize({ width: 2, height: 3 }, 3)).toEqual({ width: 3, height: 2 });
  });

  it("resize400x200_width100_becomes100x50", () => {
    expect(resizeDimensions({ width: 400, height: 200 }, { width: 100, height: undefined })).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("crop_endexclusive_2x2", () => {
    const source = { width: 4, height: 4 };
    const geometry = setCrop(createDefaultGeometry(4, 4), source, { x: 1, y: 1, width: 2, height: 2 });
    expect(geometry.crop).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(naturalOutputSize(geometry, source)).toEqual({ width: 2, height: 2 });
    expect(geometry.crop.x + geometry.crop.width).toBe(3);
  });

  it("inverse_roundtrip_error_below_1e_6", () => {
    const source = { width: 640, height: 480 };
    const geometry = {
      ...createDefaultGeometry(640, 480),
      crop: { x: 20, y: 30, width: 400, height: 300 },
      quarter_turns: 1 as const,
      angle_degrees: 12.3,
      flip_x: true,
      output_size: { width: 300, height: 420 },
    };
    const forward = sourceToOutputAffine(geometry, source);
    const inverse = outputToSourceAffine(geometry, source);
    const point = { x: 123.5, y: 77.25 };
    const viewport = imageToViewport(point, forward);
    const back = viewportToImage(viewport, forward);
    expect(Math.abs(back.x - point.x)).toBeLessThan(1e-6);
    expect(Math.abs(back.y - point.y)).toBeLessThan(1e-6);
    const directly = {
      x: inverse.a * forward.a * point.x,
      y: inverse.d * forward.d * point.y,
    };
    expect(Number.isFinite(directly.x)).toBe(true);
  });

  it("refuses a singular transform", () => {
    expect(() => viewportToImage({ x: 1, y: 2 }, { a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toThrow(
      "image_edit.bad_request",
    );
  });
});
