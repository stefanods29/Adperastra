import { describe, expect, it } from "vitest";
import {
  barLabelVisible,
  ribbonLabelVisible,
  toolbarLayoutFor,
  tooltipPlacement,
} from "../layout/toolbarLayout";

describe("toolbar layout rules", () => {
  it("toolbarLayoutFor turns auto-hide into the full look", () => {
    expect(toolbarLayoutFor("left", "autoHide")).toEqual({ side: "left", orientation: "vertical", mode: "full" });
    expect(toolbarLayoutFor("bottom", "compact")).toEqual({ side: "bottom", orientation: "horizontal", mode: "compact" });
  });

  it("tooltipPlacement points away from the edge", () => {
    expect(tooltipPlacement(toolbarLayoutFor("top", "full"))).toBe("below");
    expect(tooltipPlacement(toolbarLayoutFor("bottom", "full"))).toBe("above");
    expect(tooltipPlacement(toolbarLayoutFor("left", "full"))).toBe("right");
    expect(tooltipPlacement(toolbarLayoutFor("right", "full"))).toBe("left");
  });

  it("barLabelVisible follows the look", () => {
    const across = toolbarLayoutFor("top", "full");
    expect(barLabelVisible(across, "menu")).toBe(true);
    expect(barLabelVisible(across, "command")).toBe(false);
    expect(barLabelVisible(across, "labeledCommand")).toBe(true);
    expect(barLabelVisible(across, "overflow")).toBe(false);
    const column = toolbarLayoutFor("left", "full");
    expect(barLabelVisible(column, "command")).toBe(true);
    expect(barLabelVisible(column, "overflow")).toBe(true);
    expect(barLabelVisible(toolbarLayoutFor("top", "iconsOnly"), "menu")).toBe(false);
  });

  it("ribbonLabelVisible follows the look", () => {
    expect(ribbonLabelVisible(toolbarLayoutFor("top", "full"), false)).toBe(false);
    expect(ribbonLabelVisible(toolbarLayoutFor("top", "full"), undefined)).toBe(true);
    expect(ribbonLabelVisible(toolbarLayoutFor("left", "compact"), false)).toBe(true);
    expect(ribbonLabelVisible(toolbarLayoutFor("top", "iconsOnly"), true)).toBe(false);
  });
});
