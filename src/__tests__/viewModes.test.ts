import { describe, expect, it } from "vitest";
import { defaultSettings, type ExplorerViewSettings, type ViewModeId } from "../services/settings";
import {
  GRID_SPECS,
  ZOOM_ORDER,
  effectiveViewMode,
  skeletonVariant,
  viewModeFromKey,
  visibleViewModes,
  zoomTarget,
} from "../views/explorer/views/viewModes";

const view = (patch: Partial<ExplorerViewSettings> = {}): ExplorerViewSettings => ({
  ...defaultSettings().explorer,
  ...patch,
});

const key = (patch: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  code: "Digit1",
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  ...patch,
});

describe("view modes", () => {
  it("effectiveViewMode prefers the folder's own view", () => {
    const details = view({ view_mode: "details" });
    expect(effectiveViewMode(details, "tiles")).toBe("tiles");
    expect(effectiveViewMode(details, undefined)).toBe("details");
    expect(effectiveViewMode({ ...details, remember_view_per_folder: false }, "tiles")).toBe("details");
    expect(effectiveViewMode({ ...details, hidden_view_modes: ["tiles"] }, "tiles")).toBe("details");
    expect(effectiveViewMode(view({ view_mode: "list", hidden_view_modes: ["list"] }), undefined)).toBe("details");
  });

  it("visibleViewModes keeps the order and drops hidden views", () => {
    const modes = visibleViewModes(view({ hidden_view_modes: ["tiles", "details"] }));
    expect(modes).toEqual(["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "content"]);
  });

  it("zoomTarget walks the sizes and skips hidden views", () => {
    const all = ZOOM_ORDER.slice();
    expect(zoomTarget("details", 1, all)).toBe("list");
    expect(zoomTarget("list", 1, all)).toBe("smallIcons");
    expect(zoomTarget("extraLargeIcons", 1, all)).toBeNull();
    expect(zoomTarget("details", -1, all)).toBeNull();
    expect(zoomTarget("mediumIcons", -1, all)).toBe("smallIcons");
    expect(zoomTarget("tiles", 1, all)).toBe("mediumIcons");
    expect(zoomTarget("content", -1, all)).toBe("details");
    const withoutSmall: readonly ViewModeId[] = all.filter((mode) => mode !== "smallIcons");
    expect(zoomTarget("list", 1, withoutSmall)).toBe("mediumIcons");
    const withoutMedium: readonly ViewModeId[] = all.filter((mode) => mode !== "mediumIcons");
    expect(zoomTarget("tiles", 1, withoutMedium)).toBe("largeIcons");
  });

  it("viewModeFromKey reads the key position", () => {
    expect(viewModeFromKey(key({ code: "Digit1" }))).toBe("extraLargeIcons");
    expect(viewModeFromKey(key({ code: "Digit6" }))).toBe("details");
    expect(viewModeFromKey(key({ code: "Digit8" }))).toBe("content");
    expect(viewModeFromKey(key({ code: "Digit9" }))).toBeNull();
    expect(viewModeFromKey(key({ shiftKey: false }))).toBeNull();
    expect(viewModeFromKey(key({ altKey: true }))).toBeNull();
    expect(viewModeFromKey(key({ code: "Digit2", ctrlKey: false, metaKey: true, shiftKey: true }))).toBe("largeIcons");
  });

  it("skeletonVariant and sizes", () => {
    expect(skeletonVariant("largeIcons")).toBe("tiles");
    expect(skeletonVariant("list")).toBe("rows");
    expect(skeletonVariant("details")).toBe("rows");
    expect(GRID_SPECS.mediumIcons.cellHeight).toBe(104);
    expect(GRID_SPECS.largeIcons.cellHeight).toBe(152);
    expect(GRID_SPECS.extraLargeIcons.cellHeight).toBe(312);
    expect(GRID_SPECS.content.cellWidth).toBe(0);
  });
});
