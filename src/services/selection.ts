/** Selection model for item lists (Step 03a, the selection context of
 * contract 7). Pure: every operation returns a new state. `order` is the
 * list's display order (paths), so Shift ranges and keyboard moves follow
 * what the user sees, including grouping. */

export interface SelectionState {
  readonly selected: ReadonlySet<string>;
  /** Start of Shift ranges. */
  readonly anchor: string | null;
  /** Keyboard caret: the item arrow keys move from. */
  readonly focus: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null, focus: null };

export function selectOnly(path: string): SelectionState {
  return { selected: new Set([path]), anchor: path, focus: path };
}

/** Ctrl+click and the item check boxes. */
export function toggleItem(state: SelectionState, path: string): SelectionState {
  const selected = new Set(state.selected);
  if (selected.has(path)) selected.delete(path);
  else selected.add(path);
  return { selected, anchor: path, focus: path };
}

/** Shift+click: everything between the anchor and `path`; with Ctrl the
 * range is added to the current selection. */
export function selectRange(
  state: SelectionState,
  order: readonly string[],
  path: string,
  additive = false,
): SelectionState {
  const target = order.indexOf(path);
  if (target === -1) return state;
  const anchor =
    state.anchor !== null && order.includes(state.anchor) ? state.anchor : (state.focus ?? path);
  const start = Math.max(0, order.indexOf(anchor));
  const [low, high] = start <= target ? [start, target] : [target, start];
  const selected = additive ? new Set(state.selected) : new Set<string>();
  for (let index = low; index <= high; index += 1) selected.add(order[index]);
  return { selected, anchor, focus: path };
}

export function selectAll(state: SelectionState, order: readonly string[]): SelectionState {
  return { selected: new Set(order), anchor: state.anchor ?? order[0] ?? null, focus: state.focus ?? order[0] ?? null };
}

export function clearSelection(state: SelectionState): SelectionState {
  return { selected: new Set(), anchor: state.focus, focus: state.focus };
}

export function invertSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const selected = new Set<string>();
  for (const path of order) if (!state.selected.has(path)) selected.add(path);
  return { ...state, selected };
}

/** After a refresh: forget items that are gone. */
export function pruneSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const present = new Set(order);
  const selected = new Set([...state.selected].filter((path) => present.has(path)));
  if (selected.size === state.selected.size && (state.focus === null || present.has(state.focus))) {
    return state;
  }
  return {
    selected,
    anchor: state.anchor !== null && present.has(state.anchor) ? state.anchor : null,
    focus: state.focus !== null && present.has(state.focus) ? state.focus : null,
  };
}

export type FocusMove = "next" | "previous" | "first" | "last" | "pageDown" | "pageUp";

export interface MoveOptions {
  shift?: boolean;
  ctrl?: boolean;
  pageSize?: number;
}

/** Arrow keys, Home/End and Page Up/Down. Plain moves select the target;
 * Shift extends from the anchor; Ctrl moves only the caret. */
export function moveFocus(
  state: SelectionState,
  order: readonly string[],
  move: FocusMove,
  options: MoveOptions = {},
): SelectionState {
  if (order.length === 0) return state;
  const current = state.focus !== null ? order.indexOf(state.focus) : -1;
  const last = order.length - 1;
  const page = Math.max(1, options.pageSize ?? 10);
  let target: number;
  if (move === "first") target = 0;
  else if (move === "last") target = last;
  else if (current < 0) target = 0;
  else if (move === "next") target = Math.min(last, current + 1);
  else if (move === "previous") target = Math.max(0, current - 1);
  else if (move === "pageDown") target = Math.min(last, current + page);
  else target = Math.max(0, current - page);
  const path = order[target];
  if (options.shift) return selectRange(state, order, path, options.ctrl === true);
  if (options.ctrl) return { ...state, focus: path };
  return selectOnly(path);
}

/** Ctrl+Space: toggle the item under the caret. */
export function toggleFocused(state: SelectionState): SelectionState {
  return state.focus === null ? state : toggleItem(state, state.focus);
}

/** Windows-style type-ahead. A fresh letter (or the same letter typed
 * again) finds the next name starting with it after the caret, cycling; a
 * longer prefix is matched from the caret on. Returns -1 when nothing
 * matches. */
export function typeAheadIndex(names: readonly string[], currentIndex: number, buffer: string): number {
  if (buffer.length === 0 || names.length === 0) return -1;
  const query = buffer.toLocaleLowerCase();
  const sameLetter = [...query].every((char) => char === query[0]);
  const prefix = sameLetter ? query[0] : query;
  const start = sameLetter ? currentIndex + 1 : Math.max(0, currentIndex);
  for (let step = 0; step < names.length; step += 1) {
    const index = (((start + step) % names.length) + names.length) % names.length;
    if (names[index].toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

export interface SummaryItem {
  kind: string;
  size: number;
}

export interface SelectionSummary {
  count: number;
  files: number;
  folders: number;
  /** Total size of the selected files; folder sizes are not counted. */
  bytes: number;
}

export function summarizeSelection(
  selected: ReadonlySet<string>,
  lookup: (path: string) => SummaryItem | undefined,
): SelectionSummary {
  let files = 0;
  let folders = 0;
  let bytes = 0;
  for (const path of selected) {
    const item = lookup(path);
    if (!item) continue;
    if (item.kind === "folder" || item.kind === "drive") folders += 1;
    else {
      files += 1;
      bytes += item.size;
    }
  }
  return { count: files + folders, files, folders, bytes };
}
