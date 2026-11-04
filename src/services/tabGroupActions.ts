import { activateTab, type TabsState } from "./tabs";
import {
  groupForTab,
  normalizeTabGroups,
  patchTabGroup,
  type TabGroup,
} from "./tabGroups";

/** Group transactions that need the app around the pure reducers
 * (Step 09b T2): activating a hidden member, and the dirty-safe atomic
 * group close of D5. This module never saves or discards a document
 * itself; the coordinator's 09a close preparation (E11) collects every
 * dirty decision first, and only an approved plan changes any tab. */

export interface GroupCloseDeps {
  /** Documents that would lose their last live view if these tabs
   * closed (09a DocumentRegistry reference counts). Duplicates are
   * removed here, so a document shared by two group tabs is prepared
   * exactly once. */
  lastViewDocumentIds: (
    state: TabsState,
    tabIds: readonly string[],
  ) => readonly string[] | Promise<readonly string[]>;
  /** 09a `prepareDocumentClose(documents, "group")`: true only when
   * every required dirty decision is collected and approved. */
  prepareClose: (documentIds: readonly string[]) => Promise<boolean>;
}

export interface SaveAndCloseDeps extends GroupCloseDeps {
  /** Persist the group's saved descriptors. A rejection keeps the
   * group open and untouched (D5). */
  persist: (state: TabsState, group: TabGroup) => Promise<void>;
}

function requireLiveGroup(state: TabsState, groupId: string): TabGroup {
  const group = (state.groups ?? []).find((candidate) => candidate.id === groupId);
  if (!group) throw new Error("tabs.invalid_group");
  return group;
}

/** D3: activating a member of a collapsed group expands the group,
 * then activates the tab through the existing tab history. */
export function activateTabInGroup(state: TabsState, id: string): TabsState {
  const base = normalizeTabGroups(state);
  if (!base.tabs.some((tab) => tab.id === id)) return state;
  const group = groupForTab(base, id);
  const expanded =
    group && group.collapsed ? patchTabGroup(base, group.id, { collapsed: false }) : base;
  return activateTab(expanded, id);
}

/** The deduplicated documents a group close must prepare, in tab
 * order. Pure helper for the coordinator's registry bridge. */
export async function groupCloseDocuments(
  state: TabsState,
  groupId: string,
  deps: GroupCloseDeps,
): Promise<string[]> {
  const group = requireLiveGroup(normalizeTabGroups(state), groupId);
  const found = await deps.lastViewDocumentIds(state, group.tab_ids);
  return [...new Set(found)];
}

function closedState(state: TabsState, group: TabGroup): TabsState {
  const closing = new Set(group.tab_ids);
  const tabs = state.tabs.filter((tab) => !closing.has(tab.id));
  const groups = (state.groups ?? []).filter((candidate) => candidate.id !== group.id);
  const history = state.history.filter((id) => tabs.some((tab) => tab.id === id));
  const base: TabsState = { ...state, tabs, history, groups };
  if (!closing.has(state.activeId)) return base;
  const previous = [...history].reverse().find((id) => tabs.some((tab) => tab.id === id));
  const fallback = tabs.some((tab) => tab.id === "explorer") ? "explorer" : tabs[0]?.id;
  const nextActive = previous ?? fallback;
  if (nextActive === undefined) return base;
  return activateTab({ ...base, activeId: nextActive }, nextActive);
}

/** Close a group atomically: prepare every dirty document losing its
 * last view, and only then remove the tabs. Cancellation (or a failed
 * preparation) returns null and the caller keeps the original state:
 * no tab removed, no view released, no content discarded. */
export async function closeTabGroup(
  state: TabsState,
  groupId: string,
  deps: GroupCloseDeps,
): Promise<TabsState | null> {
  const base = normalizeTabGroups(state);
  const group = requireLiveGroup(base, groupId);
  const documentIds = await groupCloseDocuments(base, groupId, deps);
  const approved = await deps.prepareClose(documentIds);
  if (!approved) return null;
  return closedState(base, group);
}

/** D5 save-and-close: descriptors are stored successfully before any
 * dirty decision is collected; a storage failure keeps the group open. */
export async function saveAndCloseTabGroup(
  state: TabsState,
  groupId: string,
  deps: SaveAndCloseDeps,
): Promise<TabsState | null> {
  const base = normalizeTabGroups(state);
  const group = requireLiveGroup(base, groupId);
  await deps.persist(base, group);
  return closeTabGroup(base, groupId, deps);
}
