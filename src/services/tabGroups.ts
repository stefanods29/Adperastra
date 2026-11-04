import type { TabState, TabsState } from "./tabs";
import {
  GROUP_INVALID,
  MAX_GROUP_MEMBERS,
  MAX_LIVE_GROUPS,
  assertGroupInvariants,
  isEligibleGroupMember,
  normalizeTabGroups,
  validateGroupColor,
  validateGroupName,
  validateGroupPatch,
} from "./tabGroupValidation";

/** Live tab groups (Step 09b, revision tab-groups-1): canonical types and
 * the pure reducers E1-E3. Every reducer validates the whole change
 * before building the next state, so a refused change leaves the input
 * untouched. Members always occupy one contiguous segment of
 * `TabsState.tabs` (D2); `TabState.group_id` mirrors membership. */

export type GroupColor = "purple" | "blue" | "green" | "teal" | "orange" | "red";

export const GROUP_COLORS: readonly GroupColor[] = [
  "purple",
  "blue",
  "green",
  "teal",
  "orange",
  "red",
];

export interface TabGroup {
  id: string;
  name: string;
  color: GroupColor;
  collapsed: boolean;
  tab_ids: string[];
}

export interface GroupPatch {
  name?: string;
  color?: GroupColor;
  collapsed?: boolean;
}

export { normalizeTabGroups };

let fallbackCounter = 0;

/** A fresh UUID for a live or saved group. */
export function newGroupId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  fallbackCounter += 1;
  const bytes = new Uint8Array(16);
  if (cryptoObject && typeof cryptoObject.getRandomValues === "function") {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (Date.now() >> (index % 4)) & 0xff;
    }
    bytes[15] = fallbackCounter & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function invalid(): Error {
  return new Error(GROUP_INVALID);
}

function syncGroupIds(tabs: readonly TabState[], groups: readonly TabGroup[]): TabState[] {
  const owner = new Map<string, string>();
  for (const group of groups) {
    for (const tabId of group.tab_ids) owner.set(tabId, group.id);
  }
  return tabs.map((tab) => {
    const groupId = owner.get(tab.id);
    if (groupId === undefined) {
      if (tab.group_id === undefined) return tab;
      const copy = { ...tab };
      delete copy.group_id;
      return copy;
    }
    return tab.group_id === groupId ? tab : { ...tab, group_id: groupId };
  });
}

function finish(state: TabsState, tabs: TabState[], groups: TabGroup[]): TabsState {
  const next: TabsState = {
    ...state,
    tabs: syncGroupIds(tabs, groups),
    groups,
  };
  assertGroupInvariants(next);
  return next;
}

function checkedIds(tabIds: readonly string[]): string[] {
  if (!Array.isArray(tabIds) || tabIds.length === 0 || tabIds.length > MAX_GROUP_MEMBERS) {
    throw invalid();
  }
  const seen = new Set<string>();
  for (const id of tabIds) {
    if (typeof id !== "string" || id === "" || seen.has(id)) throw invalid();
    seen.add(id);
  }
  return [...tabIds];
}

function requireGroup(state: TabsState, groupId: string): TabGroup {
  const group = (state.groups ?? []).find((candidate) => candidate.id === groupId);
  if (!group) throw invalid();
  return group;
}

export function groupForTab(state: TabsState, tabId: string): TabGroup | undefined {
  return (state.groups ?? []).find((group) => group.tab_ids.includes(tabId));
}

/** Tabs a collapsed group hides (D3): every member except the active
 * one, which stays visible after the label. Tabs are hidden visually,
 * never closed or unmounted merely by collapse. */
export function hiddenByCollapse(state: TabsState): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const group of state.groups ?? []) {
    if (!group.collapsed) continue;
    for (const tabId of group.tab_ids) {
      if (tabId !== state.activeId) hidden.add(tabId);
    }
  }
  return hidden;
}

/** E1: create a group from scattered eligible tabs. They gather in
 * existing display order at the earliest selected position (D2). */
export function createTabGroup(
  state: TabsState,
  tabIds: readonly string[],
  name: string,
  color: GroupColor,
): TabsState {
  const base = normalizeTabGroups(state);
  const cleanName = validateGroupName(name);
  const cleanColor = validateGroupColor(color);
  if ((base.groups ?? []).length >= MAX_LIVE_GROUPS) throw invalid();
  const wanted = new Set(checkedIds(tabIds));
  const byId = new Map(base.tabs.map((tab) => [tab.id, tab]));
  for (const id of wanted) {
    const tab = byId.get(id);
    if (!tab || !isEligibleGroupMember(tab) || groupForTab(base, id)) throw invalid();
  }
  const members = base.tabs.filter((tab) => wanted.has(tab.id));
  const group: TabGroup = {
    id: newGroupId(),
    name: cleanName,
    color: cleanColor,
    collapsed: false,
    tab_ids: members.map((tab) => tab.id),
  };
  const tabs: TabState[] = [];
  let inserted = false;
  for (const tab of base.tabs) {
    if (wanted.has(tab.id)) {
      if (!inserted) {
        tabs.push(...members);
        inserted = true;
      }
      continue;
    }
    tabs.push(tab);
  }
  return finish(base, tabs, [...(base.groups ?? []), group]);
}

/** E2: rename, recolor or collapse one group. Unknown patch fields and
 * unknown group IDs are refused. */
export function patchTabGroup(state: TabsState, id: string, patch: GroupPatch): TabsState {
  const base = normalizeTabGroups(state);
  const clean = validateGroupPatch(patch);
  requireGroup(base, id);
  const groups = (base.groups ?? []).map((group) =>
    group.id === id ? { ...group, ...clean } : group,
  );
  return finish(base, [...base.tabs], groups);
}

/** E2: append tabs after the group's last member (D2). */
export function addTabsToGroup(
  state: TabsState,
  id: string,
  tabIds: readonly string[],
): TabsState {
  const base = normalizeTabGroups(state);
  const group = requireGroup(base, id);
  const wanted = new Set(checkedIds(tabIds));
  if (group.tab_ids.length + wanted.size > MAX_GROUP_MEMBERS) throw invalid();
  const byId = new Map(base.tabs.map((tab) => [tab.id, tab]));
  for (const tabId of wanted) {
    const tab = byId.get(tabId);
    if (!tab || !isEligibleGroupMember(tab) || groupForTab(base, tabId)) throw invalid();
  }
  const added = base.tabs.filter((tab) => wanted.has(tab.id));
  const rest = base.tabs.filter((tab) => !wanted.has(tab.id));
  const lastMember = rest.map((tab) => tab.id).lastIndexOf(group.tab_ids[group.tab_ids.length - 1]);
  const tabs = [
    ...rest.slice(0, lastMember + 1),
    ...added,
    ...rest.slice(lastMember + 1),
  ];
  const groups = (base.groups ?? []).map((candidate) =>
    candidate.id === id
      ? { ...candidate, tab_ids: [...candidate.tab_ids, ...added.map((tab) => tab.id)] }
      : candidate,
  );
  return finish(base, tabs, groups);
}

/** E2: take tabs out of their groups. Each removed tab lands immediately
 * after its group; a group that loses its last member disappears (D1). */
export function removeTabsFromGroup(state: TabsState, tabIds: readonly string[]): TabsState {
  const base = normalizeTabGroups(state);
  const wanted = new Set(checkedIds(tabIds));
  for (const tabId of wanted) {
    if (!groupForTab(base, tabId)) throw invalid();
  }
  const byId = new Map(base.tabs.map((tab) => [tab.id, tab]));
  const groups: TabGroup[] = [];
  const removedAfter = new Map<string, TabState[]>();
  for (const group of base.groups ?? []) {
    const removed = group.tab_ids.filter((tabId) => wanted.has(tabId));
    const remaining = group.tab_ids.filter((tabId) => !wanted.has(tabId));
    if (removed.length > 0) {
      removedAfter.set(
        group.id,
        removed
          .map((tabId) => byId.get(tabId))
          .filter((tab): tab is TabState => tab !== undefined),
      );
    }
    if (remaining.length > 0) groups.push({ ...group, tab_ids: remaining });
  }
  const emitted = new Set<string>();
  const tabs: TabState[] = [];
  for (const tab of base.tabs) {
    const group = groupForTab(base, tab.id);
    if (!group) {
      tabs.push(tab);
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    const kept = (base.groups ?? [])
      .find((candidate) => candidate.id === group.id)
      ?.tab_ids.filter((tabId) => !wanted.has(tabId));
    for (const memberId of kept ?? []) {
      const member = byId.get(memberId);
      if (member) tabs.push(member);
    }
    tabs.push(...(removedAfter.get(group.id) ?? []));
  }
  return finish(base, tabs, groups);
}

/** E2: dissolve a group; its tabs stay open in the same order. */
export function ungroupTabGroup(state: TabsState, id: string): TabsState {
  const base = normalizeTabGroups(state);
  requireGroup(base, id);
  const groups = (base.groups ?? []).filter((group) => group.id !== id);
  return finish(base, [...base.tabs], groups);
}

/** E3: move a whole group segment. `targetIndex` counts positions in
 * the tab array after the segment is removed; the segment may not enter
 * the pinned segment or split another group (D2). */
export function moveTabGroup(state: TabsState, id: string, targetIndex: number): TabsState {
  const base = normalizeTabGroups(state);
  const group = requireGroup(base, id);
  const byId = new Map(base.tabs.map((tab) => [tab.id, tab]));
  const segment = group.tab_ids
    .map((tabId) => byId.get(tabId))
    .filter((tab): tab is TabState => tab !== undefined);
  const members = new Set(group.tab_ids);
  const rest = base.tabs.filter((tab) => !members.has(tab.id));
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > rest.length) {
    throw invalid();
  }
  let pinnedBoundary = 0;
  for (const tab of rest) {
    if (tab.id === "explorer" || tab.pinned === true) pinnedBoundary += 1;
    else break;
  }
  if (targetIndex < pinnedBoundary) throw invalid();
  for (const other of base.groups ?? []) {
    if (other.id === id) continue;
    const indices = other.tab_ids
      .map((tabId) => rest.findIndex((tab) => tab.id === tabId))
      .filter((index) => index >= 0);
    if (indices.length === 0) continue;
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    if (targetIndex > first && targetIndex <= last) throw invalid();
  }
  const tabs = [...rest.slice(0, targetIndex), ...segment, ...rest.slice(targetIndex)];
  return finish(base, tabs, [...(base.groups ?? [])]);
}
