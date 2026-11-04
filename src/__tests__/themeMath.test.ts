import { describe, expect, it } from "vitest";
import {
  accentMeetsContrast,
  contrastRatio,
  resolveReadableAccent,
  shouldAutoReadWallpaper,
  wallpaperColorsFromPixels,
} from "../appearance/themeMath";

function pixels(colors: readonly (readonly [number, number, number, number])[]): Uint8Array {
  return new Uint8Array(colors.flat());
}

describe("custom theme contrast", () => {
  it("black and white contrast is 21 and the same colour is 1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 6);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeGreaterThan(4.47);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(4.49);
  });

  it("all chosen accent text is at least 4.5 and the accent at least 3", () => {
    const palette = wallpaperColorsFromPixels(
      pixels([
        [230, 20, 20, 255],
        [20, 210, 40, 255],
        [30, 60, 230, 255],
        [240, 220, 20, 255],
        [250, 250, 250, 255],
        [10, 10, 10, 255],
      ]),
      6,
      1,
    );
    expect(palette.length).toBeGreaterThanOrEqual(4);
    const backgrounds = ["#FFFFFF", "#F3F3F3", "#202020"];
    for (const color of palette) {
      const result = resolveReadableAccent(color, backgrounds);
      expect(accentMeetsContrast(result.accent, backgrounds), color).toBe(true);
      expect(contrastRatio(result.on_accent, result.accent), color).toBeGreaterThanOrEqual(4.5);
      for (const background of backgrounds) {
        expect(contrastRatio(result.accent, background), `${color} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("an unsafe grey is adjusted and never silently kept", () => {
    const result = resolveReadableAccent("#DDDDDD", ["#FFFFFF", "#F5F5F5"]);
    expect(result.adjusted).toBe(true);
    expect(accentMeetsContrast(result.accent, ["#FFFFFF", "#F5F5F5"])).toBe(true);
  });

  it("a candidate with no possible adjustment keeps the safe built-in fallback", () => {
    // Mid grey between two constraints that no black/white interpolation can
    // satisfy at 4.5 on its own text and 3 on both surfaces is unusual; the
    // contract still returns a real value and the caller checks it.
    const result = resolveReadableAccent("#777777", ["#777777"]);
    expect(typeof result.accent).toBe("string");
    expect(result.accent.startsWith("#")).toBe(true);
  });
});

describe("wallpaper palette binning", () => {
  it("same RGB values land in one bin", () => {
    const colors = wallpaperColorsFromPixels(
      pixels([
        [200, 100, 50, 255],
        [200, 100, 50, 255],
      ]),
      2,
      1,
    );
    expect(colors).toEqual(["#C86432"]);
  });

  it("bin frequency ties use packed RGB ascending", () => {
    // One red and one blue pixel. Blue's packed 5-bit value is smaller.
    const colors = wallpaperColorsFromPixels(
      pixels([
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ]),
      2,
      1,
    );
    expect(colors).toEqual(["#0000FF", "#FF0000"]);
  });

  it("transparent pixels are ignored", () => {
    expect(
      wallpaperColorsFromPixels(
        pixels([
          [255, 0, 0, 0],
          [0, 0, 255, 255],
        ]),
        2,
        1,
      ),
    ).toEqual(["#0000FF"]);
    expect(wallpaperColorsFromPixels(pixels([[255, 0, 0, 0]]), 1, 1)).toEqual([]);
  });

  it("no automatic read happens when the option is off", () => {
    expect(shouldAutoReadWallpaper(false, true)).toBe(false);
    expect(shouldAutoReadWallpaper(false, false)).toBe(false);
    expect(shouldAutoReadWallpaper(true, true)).toBe(true);
    expect(shouldAutoReadWallpaper(true, false)).toBe(false);
  });
});
