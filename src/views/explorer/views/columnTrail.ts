/** Column view (Step 05b): which folders form the columns, and when
 * Column view stays on. Pure. */

import type { MouseEvent as ReactMouseEvent } from "react";
import type { ExplorerItem } from "../../../services/explorer";
import { displayPath, parentPathOf, pathSegments } from "../../../services/explorer";
import { folderViewKey } from "../../../services/folderViews";
import { groupItems, type GroupBy, type ItemGroup } from "../../../services/grouping";
import type { SelectionState } from "../../../services/selection";
import type { ViewModeId } from "../../../services/settings";

/** What the open folder's column shows instead of rows. */
export type ColumnNote = "loading" | "empty" | "noResults" | null;

/** The view a folder shows and, in Column view, the first column. */
export interface ColumnStep {
  mode: ViewModeId;
  root: string | null;
}

/** What the Explorer gives the column view (Step 05b D2, D6, D13). */
export interface ColumnViewOptions {
  /** The open folder (the Explorer's location path). */
  folder: string;
  /** The first column's folder. */
  root: string;
  note: ColumnNote;
  /** The Explorer is still loading the open folder. */
  loading: boolean;
  showHidden: boolean;
  /** Columns keep the grouped order without headers. */
  groupBy: GroupBy;
  /** Changes when the side columns must reload. */
  refreshKey: number;
  /** `column_width` from settings. */
  width: number;
  showPreview: boolean;
  onWidthChange: (width: number) => void;
  onNavigate: (folder: string, select: string | null, menuPoint: { x: number; y: number } | null) => void;
  onDragItem: (event: ReactMouseEvent, item: ExplorerItem) => void;
}

export const COLUMN_ROW_HEIGHT = 28;
export const PREVIEW_MIN_WIDTH = 280;
export const MAX_TRAIL_COLUMNS = 24;
export const CHILD_LOAD_DELAY_MS = 150;
export const COLUMN_CACHE_LIMIT = 24;
export const COLUMN_SKELETON_ROWS = 6;
export const SKELETON_DELAY_MS = 100;
export const SLOW_NOTE_DELAY_MS = 1000;
export const LISTING_TIMEOUT_MS = 15000;
export const PENDING_MENU_MS = 1000;

/** True when `path` is `root` or a folder inside it (whole names only). */
export function isSameOrInside(path: string, root: string): boolean {
  const k = folderViewKey(path);
  const r = folderViewKey(root);
  if (r === "") return false;
  return k === r || k.startsWith(`${r}\\`);
}

/** The label of the last part of a folder path. */
export function columnName(path: string): string {
  const segments = pathSegments(path);
  return segments.length > 0 ? segments[segments.length - 1].label : displayPath(path);
}

/** The folders from the trail root down to `folder`, newest last. */
export function columnChain(root: string, folder: string): string[] {
  const segments = pathSegments(folder);
  if (segments.length === 0) return [displayPath(folder)];
  if (!isSameOrInside(folder, root)) return [segments[segments.length - 1].path];
  const rootKey = folderViewKey(root);
  const start = segments.findIndex((segment) => folderViewKey(segment.path) === rootKey);
  if (start < 0) return [segments[segments.length - 1].path];
  const paths = segments.slice(start).map((segment) => segment.path);
  return paths.slice(-MAX_TRAIL_COLUMNS);
}

/** Whether Column view stays on for the next folder, and the first column. */
export function columnTrailStep(
  trailRoot: string | null,
  folder: string | null,
  baseMode: ViewModeId,
  columnsVisible: boolean,
): ColumnStep {
  if (!columnsVisible) return { mode: baseMode, root: null };
  if (folder === null) return { mode: baseMode, root: trailRoot };
  if (trailRoot !== null && isSameOrInside(folder, trailRoot)) {
    return { mode: "columns", root: trailRoot };
  }
  if (trailRoot !== null && isSameOrInside(trailRoot, folder)) {
    return { mode: "columns", root: folder };
  }
  if (baseMode === "columns") return { mode: "columns", root: folder };
  return { mode: baseMode, root: null };
}

/** The rows in display order: the items as given, or the groups flattened. */
export function displayItems(
  items: readonly ExplorerItem[],
  groups: ItemGroup<ExplorerItem>[] | null,
): readonly ExplorerItem[] {
  if (!groups) return items;
  const out: ExplorerItem[] = [];
  for (const group of groups) out.push(...group.items);
  return out;
}

/** A column's rows: hidden items filtered, then grouped order (no headers). */
export function columnItems(
  items: readonly ExplorerItem[],
  showHidden: boolean,
  groupBy: GroupBy,
  typeLabel: (item: ExplorerItem) => string,
  now: Date,
): ExplorerItem[] {
  const visible = items.filter((item) => showHidden || !(item.hidden || item.system));
  if (groupBy === "none") return visible;
  const out: ExplorerItem[] = [];
  for (const group of groupItems(visible, groupBy, now, typeLabel)) out.push(...group.items);
  return out;
}

/** The one selected item, when exactly one is selected and it is here. */
export function singleSelected(
  selection: SelectionState,
  items: readonly ExplorerItem[],
): ExplorerItem | null {
  if (selection.selected.size !== 1) return null;
  const [path] = selection.selected;
  return items.find((item) => item.path === path) ?? null;
}

/** Folders and drives open a column of their own. */
export function isFolderLike(item: ExplorerItem): boolean {
  return item.kind === "folder" || item.kind === "drive";
}

/** The column before the first one, or the folder above the first column. */
export function columnLeftTarget(
  chain: readonly string[],
  folder: string,
): { folder: string; select: string } | null {
  if (chain.length >= 2) {
    return { folder: chain[chain.length - 2], select: displayPath(folder) };
  }
  const parent = parentPathOf(folder);
  if (parent === null) return null;
  return { folder: parent, select: displayPath(folder) };
}
