import { describe, expect, it } from "vitest";
import { applyStrokeToLayer, coverageAt, eraseAlpha, paintPixel, strokeStamps, StrokeGesture } from "../image-edit/brush";
import { getImageTileStore, publishTileAt } from "../image-edit/tiles";
import { createDefaultGeometry, newUuid } from "../image-edit/types";

describe("image drawing", () => {
  it("erase_fullcoverage_alpha255_becomes0", () => {
    expect(eraseAlpha(255, 1, 1)).toBe(0);
    expect(eraseAlpha(128, 0.5, 1)).toBe(64);
  });

  it("halfopacity_alpha255_becomes128_round_nearest", () => {
    expect(eraseAlpha(255, 1, 0.5)).toBe(128);
    expect(eraseAlpha(255, 1, 0.25)).toBe(191);
  });

  it("stroke_spacing_event_rate_independent", () => {
    const coarse = strokeStamps([{ x: 0, y: 0 }, { x: 8, y: 0 }], 4);
    const fine = strokeStamps(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
        { x: 6, y: 0 },
        { x: 7, y: 0 },
        { x: 8, y: 0 },
      ],
      4,
    );
    expect(fine).toHaveLength(coarse.length);
    coarse.forEach((point, index) => {
      expect(Math.abs(point.x - fine[index].x)).toBeLessThan(1e-6);
      expect(Math.abs(point.y - fine[index].y)).toBeLessThan(1e-6);
    });
    expect(coarse[0]).toEqual({ x: 0, y: 0 });
    expect(coarse[coarse.length - 1]).toEqual({ x: 8, y: 0 });
  });

  it("pointercancel_no_partialcommit", () => {
    const gesture = new StrokeGesture();
    gesture.add({ x: 1, y: 1 });
    gesture.add({ x: 2, y: 2 });
    gesture.cancel();
    expect(gesture.finish()).toBeNull();
    const committed = new StrokeGesture();
    committed.add({ x: 1, y: 1 });
    expect(committed.finish()).toEqual([{ x: 1, y: 1 }]);
  });

  it("coverage is one inside the hard core and zero outside the radius", () => {
    expect(coverageAt(0, 10, 0.5)).toBe(1);
    expect(coverageAt(5, 10, 0.5)).toBe(1);
    expect(coverageAt(10, 10, 0.5)).toBe(0);
    expect(coverageAt(15, 10, 0.5)).toBe(0);
  });

  it("paint uses source-over and preserves the chosen alpha", () => {
    const [r, g, b, a] = paintPixel([0, 0, 0, 255], [255, 0, 0, 255], 1, 1);
    expect([r, g, b, a]).toEqual([255, 0, 0, 255]);
    const half = paintPixel([0, 0, 0, 255], [255, 255, 255, 255], 1, 0.5);
    expect(half[0]).toBe(128);
    expect(half[3]).toBe(255);
  });

  it("committed erase writes through the tile store", async () => {
    const documentId = newUuid();
    const store = getImageTileStore(documentId);
    const tile = await publishTileAt(store, 0, 0, 1, 1, new Uint8Array([10, 20, 30, 255]));
    const result = await applyStrokeToLayer(
      documentId,
      [tile],
      createDefaultGeometry(1, 1),
      { width: 1, height: 1 },
      { points: [{ x: 0, y: 0 }], color: [0, 0, 0, 255], width: 4, hardness: 1, opacity: 1, mode: "erase" },
    );
    expect(result).not.toBeNull();
    const bytes = await store.read(result!.tiles[0].id);
    expect(bytes[3]).toBe(0);
  });
});
