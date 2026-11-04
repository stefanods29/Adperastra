import type { TabState, TabsState } from "./tabs";
import type { GroupColor, GroupPatch, TabGroup } from "./tabGroups";

/** Validation and normalization for live tab groups (Step 09b T1).
 * Pure and strict where the guide is strict: a bad name, color, patch or
 * membership throws `tabs.invalid_group` and changes nothing. Session
 * input is normalized leniently instead: broken groups are dropped, their
 * tabs stay open and ungrouped. */

export const MAX_LIVE_GROUPS = 32;
export const MAX_GROUP_MEMBERS = 200;
export const MAX_GROUP_NAME_CHARS = 60;
export const MAX_TOTAL_TABS = 200;
export const GROUP_INVALID = "tabs.invalid_group";

const GROUP_COLOR_SET: ReadonlySet<string> = new Set([
  "purple",
  "blue",
  "green",
  "teal",
  "orange",
  "red",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function invalid(): Error {
  return new Error(GROUP_INVALID);
}

/** A group name: trimmed, 1-60 Unicode scalar values (code points). */
export function validateGroupName(name: unknown): string {
  if (typeof name !== "string") throw invalid();
  const trimmed = name.trim();
  const scalars = [...trimmed].length;
  if (scalars < 1 || scalars > MAX_GROUP_NAME_CHARS) throw invalid();
  return trimmed;
}

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && GROUP_COLOR_SET.has(value);
}

export function validateGroupColor(value: unknown): GroupColor {
  if (!isGroupColor(value)) throw invalid();
  return value;
}

/** A patch carries at least one of name/color/collapsed and nothing else. */
export function validateGroupPatch(patch: unknown): GroupPatch {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw invalid();
  const record = patch as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) throw invalid();
  const out: GroupPatch = {};
  for (const key of keys) {
    if (key === "name") out.name = validateGroupName(record.name);
    else if (key === "color") out.color = validateGroupColor(record.color);
    else if (key === "collapsed") {
      if (typeof record.collapsed !== "boolean") throw invalid();
      out.collapsed = record.collapsed;
    } else {
      throw invalid();
    }
  }
  return out;
}

/** Eligible members (D1): unpinned file, folder and split tabs. The
 * permanent Explorer and Help/Settings/Gallery tabs never join a group.
 * A split is one outer tab; its leaves never join independently (Step
 * 09i D8), so membership is safe to keep through a session. */
export function isEligibleGroupMember(tab: TabState): boolean {
  return (
    (tab.kind === "file" || tab.kind === "folder" || tab.kind === "split") &&
    tab.id !== "explorer" &&
    tab.pinned !== true
  );
}

/** The invariants every live state must hold after a reducer runs. */
export function assertGroupInvariants(state: TabsState): void {
  const groups = state.groups ?? [];
  if (groups.length > MAX_LIVE_GROUPS) throw invalid();
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const groupIds = new Set<string>();
  const memberOwner = new Map<string, string>();
  for (const group of groups) {
    if (!isUuid(group.id) || groupIds.has(group.id)) throw invalid();
    groupIds.add(group.id);
    validateGroupName(group.name);
    validateGroupColor(group.color);
    if (group.tab_ids.length < 1 || group.tab_ids.length > MAX_GROUP_MEMBERS) throw invalid();
    for (const tabId of group.tab_ids) {
      const tab = byId.get(tabId);
      if (!tab || !isEligibleGroupMember(tab)) throw invalid();
      if (memberOwner.has(tabId)) throw invalid();
      memberOwner.set(tabId, group.id);
      if (tab.group_id !== group.id) throw invalid();
    }
  }
  for (const tab of state.tabs) {
    if (tab.group_id !== undefined && memberOwner.get(tab.id) !== tab.group_id) throw invalid();
  }
}

/** Lenient session/input normalization (D10): legacy states get no
 * groups; empty or broken groups disappear; duplicate members keep their
 * first group; members become one contiguous segment at the earliest
 * member position; `group_id` is rewritten to match membership. */
export function normalizeTabGroups(state: TabsState): TabsState {
  const rawGroups: readonly unknown[] = Array.isArray(state.groups) ? state.groups : [];
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const claimed = new Set<string>();
  const groupIds = new Set<string>();
  const groups: TabGroup[] = [];
  for (const raw of rawGroups) {
    if (groups.length >= MAX_LIVE_GROUPS) break;
    if (raw === null || typeof raw !== "object") continue;
    const candidate = raw as Partial<TabGroup>;
    if (!isUuid(candidate.id) || groupIds.has(candidate.id)) continue;
    if (typeof candidate.name !== "string") continue;
    const name = candidate.name.trim();
    if ([...name].length < 1 || [...name].length > MAX_GROUP_NAME_CHARS) continue;
    const rawIds = Array.isArray(candidate.tab_ids) ? candidate.tab_ids : [];
    const tabIds: string[] = [];
    for (const tabId of rawIds) {
      if (tabIds.length >= MAX_GROUP_MEMBERS) break;
      if (typeof tabId !== "string" || claimed.has(tabId)) continue;
      const tab = byId.get(tabId);
      if (!tab || !isEligibleGroupMember(tab)) continue;
      claimed.add(tabId);
      tabIds.push(tabId);
    }
    if (tabIds.length === 0) continue;
    groupIds.add(candidate.id);
    groups.push({
      id: candidate.id,
      name,
      color: isGroupColor(candidate.color) ? candidate.color : "purple",
      collapsed: candidate.collapsed === true,
      tab_ids: tabIds,
    });
  }

  const owner = new Map<string, TabGroup>();
  for (const group of groups) {
    for (const tabId of group.tab_ids) owner.set(tabId, group);
  }
  const emitted = new Set<string>();
  const tabs: TabState[] = [];
  const emit = (tab: TabState) => {
    const group = owner.get(tab.id);
    if (group) tabs.push({ ...tab, group_id: group.id });
    else if (tab.group_id === undefined) tabs.push(tab);
    else {
      const copy = { ...tab };
      delete copy.group_id;
      tabs.push(copy);
    }
  };
  for (const tab of state.tabs) {
    const group = owner.get(tab.id);
    if (!group) {
      emit(tab);
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    for (const memberId of group.tab_ids) {
      const member = byId.get(memberId);
      if (member) emit(member);
    }
  }

  const present = new Set(tabs.map((tab) => tab.id));
  const history = state.history.filter((id) => present.has(id));
  let activeId = state.activeId;
  if (!present.has(activeId)) {
    activeId = present.has("explorer") ? "explorer" : (tabs[0]?.id ?? "explorer");
  }
  if (history[history.length - 1] !== activeId) history.push(activeId);
  return { ...state, tabs, activeId, history, groups };
}

/** Parse the additive `groups` array of a stored session. Broken entries
 * are dropped rather than rejecting the whole session; member existence,
 * eligibility and contiguity are enforced by `normalizeTabGroups` once
 * the tabs are rebuilt (Step 09b D10). */
export function sanitizeSessionGroups(raw: unknown): TabGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: TabGroup[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (groups.length >= MAX_LIVE_GROUPS) break;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Partial<TabGroup>;
    if (!isUuid(candidate.id) || ids.has(candidate.id)) continue;
    if (typeof candidate.name !== "string") continue;
    const name = candidate.name.trim();
    const length = [...name].length;
    if (length < 1 || length > MAX_GROUP_NAME_CHARS) continue;
    const rawIds = Array.isArray(candidate.tab_ids) ? candidate.tab_ids : [];
    const tabIds: string[] = [];
    const seen = new Set<string>();
    for (const tabId of rawIds) {
      if (tabIds.length >= MAX_GROUP_MEMBERS) break;
      if (typeof tabId !== "string" || tabId === "" || seen.has(tabId)) continue;
      seen.add(tabId);
      tabIds.push(tabId);
    }
    if (tabIds.length === 0) continue;
    ids.add(candidate.id);
    groups.push({
      id: candidate.id,
      name,
      color: isGroupColor(candidate.color) ? candidate.color : "purple",
      collapsed: candidate.collapsed === true,
      tab_ids: tabIds,
    });
  }
  return groups;
}
