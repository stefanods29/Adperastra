import { describe, expect, it } from "vitest";
import { titlebarCaptionRect } from "../layout/useTitlebarDragRegion";

describe("native title-bar caption geometry", () => {
  const bounds = { left: 4, top: 2, right: 960, bottom: 36 };

  it("excludes tabs and plus controls and converts to physical pixels", () => {
    expect(titlebarCaptionRect(bounds, [94, 158], 1.5)).toEqual([237, 6, 1203, 48]);
  });
  it("clears the caption when overflowing tabs leave no blank area", () => {
    expect(titlebarCaptionRect(bounds, [1020], 1)).toBeNull();
  });
  it("supports a plain title when the tabs are on another edge", () => {
    expect(titlebarCaptionRect(bounds, [], 1)).toEqual([4, 4, 956, 32]);
  });
});
