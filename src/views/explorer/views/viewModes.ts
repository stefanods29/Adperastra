/** View-mode rules (Step 05a): sizes, order, shortcuts and zoom. Pure. */

import {
  VIEW_MODE_IDS,
  normalizeViewModeOrder,
  type ExplorerViewSettings,
  type ViewModeId,
} from "../../../services/settings";

/** Every view drawn as a grid (FileGrid). */
export type GridModeId = Exclude<ViewModeId, "details" | "list" | "columns">;

export type GridLayoutKind = "stacked" | "inline" | "tile" | "content";

export interface GridSpec {
  layout: GridLayoutKind;
  /** 0 means full width (Content). */
  cellWidth: number;
  cellHeight: number;
  gap: number;
  tile: number;
  icon: number;
}

/** Sizes from "Grid sizes" in Step 05a. */
export const GRID_SPECS: Record<GridModeId, GridSpec> = {
  extraLargeIcons: { layout: "stacked", cellWidth: 272, cellHeight: 312, gap: 12, tile: 256, icon: 128 },
  largeIcons: { layout: "stacked", cellWidth: 128, cellHeight: 152, gap: 8, tile: 96, icon: 56 },
  mediumIcons: { layout: "stacked", cellWidth: 96, cellHeight: 104, gap: 8, tile: 48, icon: 28 },
  smallIcons: { layout: "inline", cellWidth: 240, cellHeight: 24, gap: 4, tile: 16, icon: 12 },
  tiles: { layout: "tile", cellWidth: 280, cellHeight: 64, gap: 8, tile: 48, icon: 28 },
  content: { layout: "content", cellWidth: 0, cellHeight: 64, gap: 0, tile: 48, icon: 28 },
};

export const GRID_PADDING = 8;
export const GROUP_HEADER_HEIGHT = 32;
export const LIST_ITEM_HEIGHT = 24;
export const LIST_COLUMN_WIDTH = 260;
export const CONTENT_META_WIDTH = 220;
export const FALLBACK_WIDTH = 960;
export const FALLBACK_HEIGHT = 600;
export const ZOOM_STEP_DELTA = 100;
export const ZOOM_STEP_INTERVAL_MS = 150;

/** Ctrl+wheel sizes, smallest first. */
export const ZOOM_ORDER: readonly ViewModeId[] = [
  "details",
  "list",
  "smallIcons",
  "mediumIcons",
  "largeIcons",
  "extraLargeIcons",
];

export function isGridMode(mode: ViewModeId): mode is GridModeId {
  return mode !== "details" && mode !== "list" && mode !== "columns";
}

/** The views the View menu and Settings show, in the chosen order. */
export function visibleViewModes(
  view: Pick<ExplorerViewSettings, "view_mode_order" | "hidden_view_modes">,
): ViewModeId[] {
  return normalizeViewModeOrder(view.view_mode_order).filter(
    (mode) => mode === "details" || !view.hidden_view_modes.includes(mode),
  );
}

/** The folder's own view when memory is on, else the default view. */
export function effectiveViewMode(
  view: Pick<ExplorerViewSettings, "view_mode" | "remember_view_per_folder" | "hidden_view_modes">,
  folderMode: ViewModeId | undefined,
): ViewModeId {
  if (view.remember_view_per_folder && folderMode && !view.hidden_view_modes.includes(folderMode)) {
    return folderMode;
  }
  return view.hidden_view_modes.includes(view.view_mode) ? "details" : view.view_mode;
}

/** One Ctrl+wheel step: bigger (1) or smaller (-1); null at the ends. */
export function zoomTarget(
  current: ViewModeId,
  direction: 1 | -1,
  visible: readonly ViewModeId[],
): ViewModeId | null {
  const steps = ZOOM_ORDER.filter((mode) => visible.includes(mode));
  const position = steps.indexOf(current);
  if (position >= 0) return steps[position + direction] ?? null;
  if (direction === 1) {
    for (const mode of ZOOM_ORDER.slice(ZOOM_ORDER.indexOf("mediumIcons"))) {
      if (steps.includes(mode)) return mode;
    }
    return null;
  }
  return "details";
}

/** Ctrl+Shift+1 to Ctrl+Shift+8, read from the key's position. */
export function viewModeFromKey(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ViewModeId | null {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return null;
  const match = /^Digit([1-8])$/.exec(event.code);
  return match ? VIEW_MODE_IDS[Number(match[1]) - 1] : null;
}

/** The skeleton shape while a folder loads. */
export function skeletonVariant(mode: ViewModeId): "rows" | "tiles" {
  return mode === "mediumIcons" || mode === "largeIcons" || mode === "extraLargeIcons" || mode === "tiles"
    ? "tiles"
    : "rows";
}
