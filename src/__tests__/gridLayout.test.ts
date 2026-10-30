import { describe, expect, it } from "vitest";
import {
  buildGridLayout,
  columnsFor,
  flowMove,
  gridMove,
  lineOfIndex,
} from "../views/explorer/views/gridLayout";

describe("grid layout", () => {
  it("columnsFor fits whole cells", () => {
    expect(columnsFor(960, 128, 8)).toBe(7);
    expect(columnsFor(135, 128, 8)).toBe(1);
    expect(columnsFor(264, 128, 8)).toBe(2);
    expect(columnsFor(0, 128, 8)).toBe(1);
    expect(columnsFor(500, 0, 8)).toBe(1);
  });

  it("buildGridLayout splits a group into rows", () => {
    const layout = buildGridLayout([5], 2, false);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.map((row) => (row.type === "cells" ? row.first : -1))).toEqual([0, 2, 4]);
    expect(layout.rows.map((row) => (row.type === "cells" ? row.count : -1))).toEqual([2, 2, 1]);
    expect(layout.lines).toEqual([0, 1, 2]);
    expect(layout.count).toBe(5);
  });

  it("starts each group on a new row under its header", () => {
    const layout = buildGridLayout([3, 2], 2, true);
    expect(layout.rows.map((row) => row.type)).toEqual(["header", "cells", "cells", "header", "cells"]);
    expect(layout.rows.map((row) => (row.type === "cells" ? row.first : -1))).toEqual([-1, 0, 2, -1, 3]);
    expect(layout.rows.map((row) => (row.type === "cells" ? row.count : -1))).toEqual([-1, 2, 1, -1, 2]);
    expect(layout.lines).toEqual([1, 2, 4]);
    expect(layout.rows.filter((row) => row.type === "header").map((row) => row.group)).toEqual([0, 1]);
  });

  it("skips empty groups", () => {
    const layout = buildGridLayout([0, 3], 3, true);
    expect(layout.rows[0]).toMatchObject({ type: "header", group: 1 });
    expect(layout.rows[1]).toMatchObject({ type: "cells", first: 0, count: 3 });
    expect(layout.rows).toHaveLength(2);
  });

  it("lineOfIndex finds the line of an item", () => {
    const layout = buildGridLayout([3, 2], 2, true);
    expect(lineOfIndex(layout, 0)).toBe(0);
    expect(lineOfIndex(layout, 2)).toBe(1);
    expect(lineOfIndex(layout, 4)).toBe(2);
    expect(lineOfIndex(layout, 5)).toBe(-1);
  });

  it("gridMove: left and right wrap across rows", () => {
    const layout = buildGridLayout([7], 3, false);
    expect(gridMove(layout, 2, "right", 1)).toBe(3);
    expect(gridMove(layout, 3, "left", 1)).toBe(2);
    expect(gridMove(layout, 0, "left", 1)).toBe(0);
    expect(gridMove(layout, 6, "right", 1)).toBe(6);
  });

  it("gridMove: up and down keep the column", () => {
    const layout = buildGridLayout([7], 3, false);
    expect(gridMove(layout, 1, "down", 1)).toBe(4);
    expect(gridMove(layout, 4, "down", 1)).toBe(6);
    expect(gridMove(layout, 6, "down", 1)).toBe(6);
    expect(gridMove(layout, 6, "up", 1)).toBe(3);
    expect(gridMove(layout, 1, "up", 1)).toBe(1);
  });

  it("gridMove: home, end and pages", () => {
    const layout = buildGridLayout([7], 3, false);
    expect(gridMove(layout, 5, "home", 1)).toBe(0);
    expect(gridMove(layout, 0, "end", 1)).toBe(6);
    expect(gridMove(layout, 0, "pageDown", 2)).toBe(6);
    expect(gridMove(layout, 6, "pageUp", 5)).toBe(0);
  });

  it("gridMove: starts at the first item without a caret", () => {
    const layout = buildGridLayout([7], 3, false);
    expect(gridMove(layout, -1, "down", 1)).toBe(0);
    expect(gridMove(buildGridLayout([], 3, false), 0, "down", 1)).toBe(-1);
  });

  it("gridMove: crosses group headers", () => {
    const layout = buildGridLayout([2, 3], 2, true);
    expect(gridMove(layout, 1, "down", 1)).toBe(3);
    expect(gridMove(layout, 3, "down", 1)).toBe(4);
    expect(gridMove(layout, 2, "up", 1)).toBe(0);
  });

  it("flowMove moves by items and columns", () => {
    const move = (index: number, direction: Parameters<typeof flowMove>[4]) => flowMove(10, 4, 2, index, direction);
    expect(move(3, "down")).toBe(4);
    expect(move(4, "up")).toBe(3);
    expect(move(1, "right")).toBe(5);
    expect(move(5, "right")).toBe(9);
    expect(move(7, "right")).toBe(9);
    expect(move(9, "right")).toBe(9);
    expect(move(2, "left")).toBe(2);
    expect(move(6, "left")).toBe(2);
    expect(move(0, "pageDown")).toBe(8);
    expect(move(9, "pageUp")).toBe(1);
    expect(move(5, "home")).toBe(0);
    expect(move(0, "end")).toBe(9);
    expect(move(-1, "down")).toBe(0);
  });
});
