import { describe, expect, it } from "vitest";
import {
  layoutTreemap,
  MAX_VISIBLE_TILES,
  type TreemapItem,
} from "../storage/treemapLayout";

function item(id: string, bytes: number, path = `C:\\scan\\${id}`): TreemapItem {
  return {
    id,
    path,
    name: id,
    kind: "file",
    logical_bytes: bytes,
    children_count: 0,
  };
}

describe("treemap layout", () => {
  it("allocates a 3:1 horizontal axis before the 1 px visual gap", () => {
    const rects = layoutTreemap(
      { x: 0, y: 0, width: 100, height: 50 },
      [item("large", 75), item("small", 25)],
      0,
    );
    expect(rects.map((rect) => rect.width)).toEqual([75, 25]);
    expect(rects.map((rect) => rect.draw_width)).toEqual([74, 24]);
    expect(rects[0].x).toBe(0);
    expect(rects[1].x).toBe(75);
    expect(rects[0].height).toBe(50);
  });

  it("never produces NaN or a negative rectangle for zero-sized items", () => {
    const rects = layoutTreemap(
      { x: 10, y: 20, width: 100, height: 50 },
      [item("a", 0), item("b", 0)],
      0,
    );
    for (const rect of rects) {
      for (const value of [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.draw_width,
        rect.draw_height,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(rect.width).toBe(0);
    }
  });

  it("gives the final positive child the exact remaining pixels", () => {
    const rects = layoutTreemap(
      { x: 0, y: 0, width: 100, height: 50 },
      [item("a", 1), item("b", 1), item("c", 1)],
      0,
    );
    expect(rects.map((rect) => rect.width)).toEqual([33, 33, 34]);
    expect(rects[2].x + rects[2].width).toBe(100);
  });

  it("alternates to the vertical axis at the next depth", () => {
    const rects = layoutTreemap(
      { x: 0, y: 0, width: 100, height: 50 },
      [item("a", 3), item("b", 1)],
      1,
    );
    expect(rects.map((rect) => rect.height)).toEqual([37, 13]);
    expect(rects[0].width).toBe(100);
  });

  it("folds items beyond 2000 into one Other tile with its count", () => {
    const items = Array.from({ length: MAX_VISIBLE_TILES + 1 }, (_, index) =>
      item(`f${index}`, 1),
    );
    const rects = layoutTreemap({ x: 0, y: 0, width: 1000, height: 500 }, items, 0);
    expect(rects).toHaveLength(MAX_VISIBLE_TILES);
    const other = rects[rects.length - 1];
    expect(other.id).toBe("other");
    expect(other.other_count).toBe(2);
    expect(other.logical_bytes).toBe(2);
  });
});
