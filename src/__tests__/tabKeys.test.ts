import { describe, expect, it } from "vitest";
import { tabKeyTarget } from "../services/tabKeys";

describe("tabKeyTarget", () => {
  it("moves with arrows, wraps around, and jumps with Home and End", () => {
    expect(tabKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabKeyTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(tabKeyTarget("Home", 2, 3)).toBe(0);
    expect(tabKeyTarget("End", 0, 3)).toBe(2);
  });
  it("ignores other keys and an empty strip", () => {
    expect(tabKeyTarget("a", 0, 3)).toBeNull();
    expect(tabKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});
