import { isAbsolutePath } from "../documents/types";
import type { SortSpec } from "./explorer";
import type { GroupBy } from "./grouping";
import { isViewModeId, type ViewModeId } from "./settings";

/** Per-folder-tab view state (Step 09a D2): each folder tab owns its
 * listing position, sort and column root. No selected items or listing
 * contents are stored here or in the session. */
export interface FolderTabState {
  path: string;
  view_mode: ViewModeId;
  sort: SortSpec;
  group_by: GroupBy;
  column_root?: string;
  scroll_top: number;
  focus_path?: string;
}

const SORT_KEYS: readonly string[] = ["name", "modified", "size", "kind"];
const GROUP_BY: readonly string[] = ["none", "name", "modified", "type", "size"];
export const MAX_FOLDER_PATH_UNITS = 32768;
/** UI location only; never pass this value to a filesystem service. */
export const HOME_FOLDER_PATH = "home";
export const MAX_SCROLL_TOP = 1e9;

export function defaultFolderTabState(path: string): FolderTabState {
  return {
    path,
    view_mode: "details",
    sort: { key: "name", direction: "ascending" },
    group_by: "none",
    scroll_top: 0,
  };
}

/** Validate untrusted (session) folder state. Returns null when the path is
 * not absolute or a field is outside its bounds; the caller keeps a
 * placeholder instead of dropping the whole session. */
export function validateFolderTabState(value: unknown): FolderTabState | null {
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.path !== HOME_FOLDER_PATH && !isAbsolutePath(input.path)) return null;
  const sort = input.sort as Record<string, unknown> | null;
  if (sort === null || typeof sort !== "object") return null;
  if (typeof sort.key !== "string" || !SORT_KEYS.includes(sort.key)) return null;
  if (sort.direction !== "ascending" && sort.direction !== "descending") return null;
  if (!isViewModeId(input.view_mode)) return null;
  if (typeof input.group_by !== "string" || !GROUP_BY.includes(input.group_by)) return null;
  const scroll = input.scroll_top;
  if (typeof scroll !== "number" || !Number.isFinite(scroll) || scroll < 0 || scroll > MAX_SCROLL_TOP) return null;
  const result: FolderTabState = {
    path: input.path,
    view_mode: input.view_mode,
    sort: { key: sort.key as SortSpec["key"], direction: sort.direction },
    group_by: input.group_by as GroupBy,
    scroll_top: scroll,
  };
  if (input.column_root !== undefined) {
    if (!isAbsolutePath(input.column_root)) return null;
    result.column_root = input.column_root;
  }
  if (input.focus_path !== undefined) {
    if (!isAbsolutePath(input.focus_path)) return null;
    result.focus_path = input.focus_path;
  }
  return result;
}

/** Clamp a live folder state back into the serializable bounds. */
export function clampFolderTabState(state: FolderTabState): FolderTabState {
  return {
    ...state,
    scroll_top: Number.isFinite(state.scroll_top)
      ? Math.min(MAX_SCROLL_TOP, Math.max(0, state.scroll_top))
      : 0,
  };
}
