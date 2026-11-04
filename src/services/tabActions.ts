import { isAbsolutePath } from "../documents/types";
import { HOME_FOLDER_PATH, type FolderTabState } from "./folderState";
import {
  EXPLORER_TAB,
  activateTab,
  closeTab,
  newTabId,
  type TabState,
  type TabsState,
} from "./tabs";

/** Tab actions (Step 09a E1/E2). Pure reducers over `TabsState`; the
 * coordinator re-exports these from `services/tabs.ts`. The permanent
 * Explorer tab exists exactly once and can never be closed, pinned,
 * duplicated or moved. */

export const MAX_TABS = 200;
export const MAX_PINNED_TABS = 20;
export const MAX_CLOSED_TABS = 50;

/** A closed tab, kept for reopen. Only the descriptor survives: reopening
 * goes through the normal open pipeline and never reuses an old grant,
 * password or runtime handle. */
export interface ClosedTabDescriptor {
  tab: TabState;
  closed_unix: number;
}

export function closedTabsOf(state: TabsState): readonly ClosedTabDescriptor[] {
  return state.closed ?? [];
}

function withClosed(state: TabsState, closed: ClosedTabDescriptor[]): TabsState {
  return { ...state, closed: closed.slice(-MAX_CLOSED_TABS) };
}

export function isPermanentExplorer(tab: TabState): boolean {
  return tab.id === EXPLORER_TAB.id && tab.kind === "explorer";
}

function pinnedCount(state: TabsState): number {
  return state.tabs.filter((tab) => tab.pinned === true).length;
}

/** Index just after the pinned segment (the Explorer always leads it). */
function pinnedEnd(state: TabsState): number {
  let index = 0;
  while (index < state.tabs.length && (index === 0 || state.tabs[index].pinned === true || isPermanentExplorer(state.tabs[index]))) {
    index += 1;
  }
  return index;
}

/** Take one tab out of its group before it leaves the group segment
 * (Step 09b D1: pinning a grouped tab removes membership first). */
function withoutGroup(state: TabsState, id: string): TabsState {
  if (!state.groups || !state.groups.some((group) => group.tab_ids.includes(id))) {
    return state;
  }
  const groups = state.groups
    .map((group) =>
      group.tab_ids.includes(id)
        ? { ...group, tab_ids: group.tab_ids.filter((entry) => entry !== id) }
        : group,
    )
    .filter((group) => group.tab_ids.length > 0);
  const groupIds = new Set(groups.map((group) => group.id));
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== id && (tab.group_id === undefined || groupIds.has(tab.group_id))) {
      return tab;
    }
    if (tab.group_id === undefined) return tab;
    const copy = { ...tab };
    delete copy.group_id;
    return copy;
  });
  return { ...state, tabs, groups };
}

/** Open a folder in its own tab (E1). No forced dedup: the same folder can
 * have several tabs with independent view state. Refused at 200 tabs. */
export function openFolderTab(state: TabsState, folder: FolderTabState, background: boolean): TabsState {
  if (state.tabs.length >= MAX_TABS || (folder.path !== HOME_FOLDER_PATH && !isAbsolutePath(folder.path))) return state;
  const tab: TabState = {
    id: newTabId("folder"),
    kind: "folder",
    title: folder.path === HOME_FOLDER_PATH ? undefined : folder.path.split(/[\\/]/).filter(Boolean).pop() ?? folder.path,
    path: folder.path,
    folder: { ...folder },
  };
  const next: TabsState = { ...state, tabs: [...state.tabs, tab] };
  return background ? next : activateTab(next, tab.id);
}

/** Pin or unpin a tab (E2). Pinning moves the tab into the pinned segment;
 * unpinning moves it just after that segment. The permanent Explorer and
 * unknown ids are refused; at most 20 tabs are pinned. */
export function pinTab(state: TabsState, id: string, pinned: boolean): TabsState {
  // Pinning a grouped tab removes its membership first (Step 09b D1).
  const source = pinned ? withoutGroup(state, id) : state;
  const tab = source.tabs.find((entry) => entry.id === id);
  if (!tab || isPermanentExplorer(tab)) return state;
  if (pinned && tab.pinned !== true && pinnedCount(source) >= MAX_PINNED_TABS) return state;
  const rest = source.tabs.filter((entry) => entry.id !== id);
  const moved: TabState = { ...tab, pinned };
  const without: TabsState = { ...source, tabs: rest };
  const insertAt = pinnedEnd(without);
  const tabs = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  return { ...source, tabs };
}

/** Duplicate a tab (E2): a new view id with the same validated source and
 * view state. File duplicates share the document (same `document_id`), so
 * editing in one view is editing in both. */
export function duplicateTab(state: TabsState, id: string): TabsState {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || isPermanentExplorer(tab) || state.tabs.length >= MAX_TABS) return state;
  const copy: TabState = {
    ...tab,
    id: newTabId(tab.kind),
    folder: tab.folder ? { ...tab.folder } : undefined,
    view: tab.view,
  };
  // A duplicate is its own tab and starts outside the original group. It
  // lands after the whole group segment so members stay contiguous (D2).
  delete copy.group_id;
  let index = state.tabs.indexOf(tab);
  if (tab.group_id !== undefined) {
    const group = state.groups?.find((candidate) => candidate.id === tab.group_id);
    for (const memberId of group?.tab_ids ?? []) {
      index = Math.max(index, state.tabs.findIndex((entry) => entry.id === memberId));
    }
  }
  const tabs = [...state.tabs.slice(0, index + 1), copy, ...state.tabs.slice(index + 1)];
  return activateTab({ ...state, tabs }, copy.id);
}

/** Move a tab to `targetIndex` (E2). A tab never crosses the pinned
 * segment boundary and the permanent Explorer never moves; the target is
 * clamped into the tab's own segment. */
export function reorderTab(state: TabsState, id: string, targetIndex: number): TabsState {
  const from = state.tabs.findIndex((entry) => entry.id === id);
  if (from < 0) return state;
  const tab = state.tabs[from];
  if (isPermanentExplorer(tab)) return state;
  const boundary = pinnedEnd(state);
  const pinned = tab.pinned === true;
  const min = pinned ? 1 : boundary;
  const max = pinned ? boundary - 1 : state.tabs.length - 1;
  const target = Math.min(max, Math.max(min, Math.floor(targetIndex)));
  if (target === from) return state;
  const tabs = state.tabs.filter((entry) => entry.id !== id);
  tabs.splice(target, 0, tab);
  return { ...state, tabs };
}

/** Close a tab and remember its descriptor (newest 50 kept). Closing the
 * permanent Explorer is refused, as in `closeTab`. */
export function closeTabRecording(state: TabsState, id: string, closedUnix: number): TabsState {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || isPermanentExplorer(tab)) return state;
  const closed: ClosedTabDescriptor = {
    tab: { ...tab, view: undefined, view_version: undefined, document_id: undefined },
    closed_unix: closedUnix,
  };
  return withClosed(closeTab(state, id), [...closedTabsOf(state), closed]);
}

/** Reopen a closed tab (E2): a new view id through the caller's normal
 * open pipeline. This reducer only places the descriptor; the host must
 * re-validate the source (existence, handler, protected view) before
 * inserting a file tab, and drops the entry when the source is gone. */
export function reopenClosedTab(state: TabsState, closed: ClosedTabDescriptor): TabsState {
  if (state.tabs.length >= MAX_TABS) return state;
  const tab: TabState = {
    ...closed.tab,
    id: newTabId(closed.tab.kind),
    document_id: undefined,
    view: undefined,
  };
  // The old group may be gone or changed; rejoin through an explicit action.
  delete tab.group_id;
  const next: TabsState = {
    ...state,
    tabs: [...state.tabs, tab],
    closed: closedTabsOf(state).filter((entry) => entry !== closed),
  };
  return activateTab(next, tab.id);
}

/** The next tab in most-recently-used order, without changing the visible
 * order (D4). `direction` 1 cycles forward, -1 backward. */
export function mruCycleTarget(state: TabsState, direction: 1 | -1): string | null {
  const recent = [...state.history].reverse().filter((id) => state.tabs.some((tab) => tab.id === id));
  // Tabs opened in the background have never been active and are missing
  // from the history; include them in visible order so Ctrl+Tab still
  // reaches them instead of doing nothing.
  for (const tab of state.tabs) {
    if (!recent.includes(tab.id)) recent.push(tab.id);
  }
  if (recent.length < 2) return null;
  const current = recent.indexOf(state.activeId);
  const next = recent[(current + direction + recent.length) % recent.length];
  return next ?? null;
}
