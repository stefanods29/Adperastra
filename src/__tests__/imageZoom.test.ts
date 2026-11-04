import { describe, expect, it } from "vitest";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "../handlers/image/zoom";

describe("image zoom", () => {
  it("fits large images and never enlarges small ones", () => {
    expect(fitPercent(4000, 2000, 1000, 1000)).toBe(25);
    expect(fitPercent(100, 100, 1000, 1000)).toBe(100);
    expect(fitPercent(0, 100, 1000, 1000)).toBe(100);
  });

  it("steps between zoom levels", () => {
    expect(nextZoom(100, 1)).toBe(125);
    expect(nextZoom(100, -1)).toBe(75);
    expect(nextZoom(110, -1)).toBe(100);
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("clamps any value", () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(99999)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(100);
  });
});
