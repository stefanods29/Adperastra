import { describe, expect, it } from "vitest";
import {
  boundsCenter,
  fitDistance,
  measureDistance,
  orbitPosition,
  validateView,
  type Bounds,
} from "../handlers/model/modelCamera";

describe("model camera", () => {
  it("measures (0,0,0)-(3,4,0) as 5 source units", () => {
    expect(measureDistance([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(measureDistance([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("fits a valid bounding box with a finite positive distance", () => {
    const bounds: Bounds = [-1, -2, -1, 1, 2, 1];
    const distance = fitDistance(bounds, 45, 16 / 9);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
    expect(boundsCenter(bounds)).toEqual([0, 0, 0]);
  });

  it("refuses non-finite or inverted bounds", () => {
    expect(() => fitDistance([0, 0, 0, Number.NaN, 1, 1], 45, 1)).toThrow("special_view.corrupt");
    expect(() => fitDistance([2, 0, 0, 1, 1, 1], 45, 1)).toThrow("special_view.corrupt");
  });

  it("puts the camera at a finite orbit position", () => {
    const position = orbitPosition({ yaw: 0.5, pitch: 0.3, distance: 10, target: [1, 2, 3] });
    expect(position.every(Number.isFinite)).toBe(true);
    expect(position[1]).toBeGreaterThan(3);
  });

  it("normalizes an invalid saved view instead of throwing", () => {
    const view = validateView({ yaw: Number.NaN, pitch: 99, distance: -1, target: [0, 0, 0], wireframe: true, unit: "mm" });
    expect(view.yaw).toBe(0);
    expect(view.distance).toBe(1);
    expect(view.unit).toBe("mm");
  });
});
