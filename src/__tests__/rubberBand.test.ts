import { describe, expect, it } from "vitest";
import { contentPoint, intersectSelection } from "../views/explorer/selectionGeometry";
const items = ["a", "b", "c"].map((id, i) => ({ id, x: 0, y: i * 20, width: 100, height: 20 }));
describe("rubber band geometry", () => {
  it("edge-only excluded", () => expect(intersectSelection(items, { x: 100, y: 0, width: 20, height: 20 }, [], "replace")).toEqual([]));
  it("Ctrl toggles captured set", () => expect(intersectSelection(items, { x: 0, y: 0, width: 50, height: 40 }, ["a", "c"], "toggle")).toEqual(["b", "c"]));
  it("shift adds", () => expect(intersectSelection(items, { x: 0, y: 0, width: 50, height: 20 }, ["c"], "add")).toEqual(["a", "c"]));
  it("scrolled grid correct", () => {
    const root = { offsetWidth: 200, offsetHeight: 100, clientLeft: 1, clientTop: 1, scrollLeft: 50, scrollTop: 100, getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200 }) } as HTMLElement;
    expect(contentPoint(root, 32, 42)).toEqual({ x: 60, y: 110 });
  });
  it("10k virtual rows not 10k DOM nodes", () => {
    const before = document.querySelectorAll("*").length;
    const rows = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), x: 0, y: i * 28, width: 100, height: 28 }));
    expect(intersectSelection(rows, { x: 0, y: 279972, width: 50, height: 28 }, [], "replace")).toEqual(["9999"]);
    expect(document.querySelectorAll("*").length).toBe(before);
  });
});
