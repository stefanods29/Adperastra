/** The tab model (Step 04a, extended by Step 09a): which tabs exist, which
 * one is active, and the order tabs were used in (closing a tab returns to
 * the one used before). Pure functions only, so every rule is unit-tested.
 * `App.tsx` holds one `TabsState` and replaces it with the result of these
 * functions. */

import type { DocumentHandle, DocumentRef, SerializableViewState } from "../documents/types";
import type { FolderTabState } from "./folderState";
import { SESSION_SCHEMA_VERSION, validateSessionData } from "./sessionValidation";
import type { ClosedTabDescriptor } from "./tabActions";
import type { TabGroup } from "./tabGroups";
import { normalizeTabGroups } from "./tabGroupValidation";
import {
  recoverSerializedSplit,
  serializeSplitTab,
  splitTabTitle,
  type SplitLeaf,
  type SplitState,
} from "./splitViews";
import { decodeViewState, encodeViewState } from "./viewState";

export type TabKind = "explorer" | "help" | "settings" | "gallery" | "file" | "folder" | "split";

export interface TabState {
  id: string;
  kind: TabKind;
  title?: string;
  /** File tabs: the file's path as the Explorer showed it. */
  path?: string;
  /** File tabs: the handler id that shows the file. */
  handler?: string;
  /** File tabs: small view state from the handler (zoom, scroll). */
  view?: unknown;
  /** The codec version that wrote `view` (Step 09a D6). */
  view_version?: number;
  /** Tabs pinned into the leading segment (Step 09a D1). */
  pinned?: boolean;
  /** File tabs: the document source this view shows. Several tabs may
   * share one source while keeping their own view state. */
  source?: DocumentRef;
  /** Runtime only, never serialized: the shared document id. */
  document_id?: string;
  /** Runtime only, never serialized: an in-memory draft document opened for
   * editing (Step 15 "Edit media"). Its bytes live with the tab. */
  draft?: DocumentHandle;
  /** The live tab group this tab belongs to (Step 09b D1); omitted when
   * ungrouped. Kept in sync with the group's `tab_ids`. */
  group_id?: string;
  /** Folder tabs: the folder's own listing view (Step 09a D2). */
  folder?: FolderTabState;
  /** Split tabs: the two non-recursive sides inside this one outer tab
   * (Step 09i D1/D7). */
  split?: SplitState;
  /** A normal file/folder tab promoted from a split keeps its stable leaf
   * view id here (Step 09i D3); a plain tab uses its tab id instead. */
  content_view_id?: string;
  /** A restored tab whose source or handler is unavailable. The tab stays
   * visible so the user can locate the file or close it. */
  missing?: { reason: "not_found" | "handler_missing" | "locked"; original_path?: string };
}

export interface TabsState {
  tabs: TabState[];
  activeId: string;
  /** Tab ids in the order they were activated, oldest first. */
  history: string[];
  /** Recently closed tabs, newest last (Step 09a E2). */
  closed?: ClosedTabDescriptor[];
  /** Live tab groups (Step 09b, tab-groups-1). Optional on legacy input
   * and normalized to an array by the group reducers. */
  groups?: readonly TabGroup[];
}

/** One tab in `session.json` (schema 2, Step 09a D5). */
export interface SessionTab {
  id: string;
  kind: string;
  title?: string;
  path?: string;
  handler?: string;
  source?: DocumentRef;
  folder?: FolderTabState;
  pinned?: boolean;
  /** The live group this saved tab belonged to (Step 09b). */
  group_id?: string;
  view?: SerializableViewState;
  view_version?: number;
  missing_reason?: "not_found" | "handler_missing" | "locked";
  /** Split tabs: both sides with their encoded view state (Step 09i D7).
   * Never present on a non-split tab, and a split tab carries no other
   * positional field besides `title`, `pinned` and `group_id`. */
  split?: SplitState;
  /** A promoted survivor's stable leaf view id (file/folder only). */
  content_view_id?: string;
}

/** What `session.json` stores (Rust `SessionState`, schema 2). */
export interface SessionData {
  schema_version: number;
  tabs: SessionTab[];
  active_tab: string;
  saved_unix: number;
  history: string[];
  /** Live groups travel with the session so group Undo and restart keep
   * membership (Step 09b D10; native schema 2 additive default-empty). */
  groups?: readonly TabGroup[];
}

export type { FolderTabState };

export const EXPLORER_TAB: TabState = { id: "explorer", kind: "explorer" };
const SINGLE_KINDS: TabKind[] = ["help", "settings", "gallery"];
const HISTORY_LIMIT = 200;

let idCounter = 0;
/** A new unique tab id such as "file-lx3k9a-1". */
export function newTabId(kind: TabKind): string {
  idCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${idCounter}`;
}

export function initialTabs(): TabsState {
  return { tabs: [EXPLORER_TAB], activeId: EXPLORER_TAB.id, history: [EXPLORER_TAB.id], closed: [] };
}

function samePathText(a: string, b: string): boolean {
  const plain = (path: string) => path.replace(/^\\\\\?\\/, "").toLowerCase();
  return plain(a) === plain(b);
}

/** Make `id` the active tab and remember it in the history. */
export function activateTab(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((tab) => tab.id === id)) return state;
  const history = [...state.history.filter((entry) => entry !== id), id].slice(-HISTORY_LIMIT);
  return { ...state, activeId: id, history };
}

/** Open the single Help, Settings, or Gallery tab, or switch to it. */
export function openSingleTab(state: TabsState, kind: "help" | "settings" | "gallery"): TabsState {
  const existing = state.tabs.find((tab) => tab.kind === kind);
  if (existing) return activateTab(state, existing.id);
  const tab: TabState = { id: newTabId(kind), kind };
  return activateTab({ ...state, tabs: [...state.tabs, tab] }, tab.id);
}

export interface OpenFileTabResult {
  state: TabsState;
  tabId: string;
}

/** `openFileTab`, also reporting which tab now shows the file (Step 09c
 * group drops need the ids without duplicating the dedupe rules). */
export function openFileTabResult(
  state: TabsState,
  file: { path: string; handler: string; title: string },
  background: boolean,
): OpenFileTabResult {
  const existing = state.tabs.find(
    (tab) => tab.kind === "file" && tab.handler === file.handler && tab.path !== undefined && samePathText(tab.path, file.path),
  );
  if (existing) {
    return { state: background ? state : activateTab(state, existing.id), tabId: existing.id };
  }
  const tab: TabState = { id: newTabId("file"), kind: "file", path: file.path, handler: file.handler, title: file.title };
  const next = { ...state, tabs: [...state.tabs, tab] };
  return { state: background ? next : activateTab(next, tab.id), tabId: tab.id };
}

/** Open a file in a tab. The same file with the same handler reuses its
 * tab. `background` keeps the current tab active. New tabs go at the end. */
export function openFileTab(
  state: TabsState,
  file: { path: string; handler: string; title: string },
  background: boolean,
): TabsState {
  return openFileTabResult(state, file, background).state;
}

/** Drop a closed tab's group membership. Remaining members keep their
 * order; a group that loses its last member disappears (Step 09b D1). */
function withoutMembership(
  state: TabsState,
  tabs: TabState[],
  removedId: string,
): Pick<TabsState, "tabs" | "groups"> {
  if (!state.groups || state.groups.length === 0) return { tabs };
  const groups = state.groups
    .map((group) =>
      group.tab_ids.includes(removedId)
        ? { ...group, tab_ids: group.tab_ids.filter((entry) => entry !== removedId) }
        : group,
    )
    .filter((group) => group.tab_ids.length > 0);
  const groupIds = new Set(groups.map((group) => group.id));
  const cleaned = tabs.map((tab) => {
    if (tab.group_id === undefined || groupIds.has(tab.group_id)) return tab;
    const copy = { ...tab };
    delete copy.group_id;
    return copy;
  });
  return { tabs: cleaned, groups };
}

/** Close a tab (never the Explorer tab). If it was active, the most
 * recently used remaining tab becomes active. */
export function closeTab(state: TabsState, id: string): TabsState {
  if (id === EXPLORER_TAB.id || !state.tabs.some((tab) => tab.id === id)) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  const base: TabsState = { ...state, ...withoutMembership(state, tabs, id), history };
  if (state.activeId !== id) return base;
  const previous = [...history].reverse().find((entry) => tabs.some((tab) => tab.id === entry));
  return activateTab({ ...base, activeId: EXPLORER_TAB.id }, previous ?? EXPLORER_TAB.id);
}

/** Store a file tab's view state (from `HandlerViewProps.onStateChange`). */
export function setTabView(state: TabsState, id: string, view: unknown): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, view } : tab)) };
}

/** Save as (Step 06a): the file tab shows its new path and name. */
export function setTabPath(state: TabsState, id: string, path: string, title: string): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, path, title } : tab)) };
}

/** A split whose second side is unusable restores as this normal tab; the
 * leaf keeps its rewritten view id so the document reference never changes
 * hands (Step 09i D7, Decision 3). */
function survivorTab(id: string, leaf: SplitLeaf): TabState {
  const tab: TabState = { id, kind: leaf.kind, content_view_id: leaf.view_id };
  if (leaf.kind === "folder") {
    if (!leaf.folder) return tab;
    tab.folder = { ...leaf.folder, sort: { ...leaf.folder.sort } };
    tab.path = leaf.folder.path;
  } else {
    if (!leaf.source || !leaf.handler) return tab;
    tab.source = leaf.source;
    tab.handler = leaf.handler;
    if (leaf.source.kind === "disk") tab.path = leaf.source.path;
  }
  if (leaf.title !== undefined) tab.title = leaf.title;
  if (leaf.view !== undefined) tab.view = leaf.view;
  if (leaf.view_version !== undefined) tab.view_version = leaf.view_version;
  if (leaf.missing !== undefined) tab.missing = { ...leaf.missing };
  return tab;
}

/** Rebuild tabs from a stored session after schema validation (Step 09a
 * D5). Unknown or broken tabs are dropped by the validator; an unknown
 * handler keeps a recoverable `handler_missing` placeholder instead of
 * losing the tab. The Explorer tab always comes first and exactly once. */
export function tabsFromSession(input: unknown, knownHandlers: readonly string[]): TabsState {
  let session: SessionData;
  try {
    session = validateSessionData(input, knownHandlers);
  } catch {
    // A session from a newer schema (or an oversized payload) is refused
    // as a whole; the caller keeps the current tabs, never writes it down.
    return initialTabs();
  }
  const seen = new Set<string>([EXPLORER_TAB.id]);
  const tabs: TabState[] = [EXPLORER_TAB];
  for (const entry of session.tabs) {
    if (seen.has(entry.id) || entry.kind === "explorer") continue;
    if (entry.kind === "split") {
      // The split codecs decode each leaf and mint fresh view ids; an
      // unknown handler becomes its own placeholder and one usable side
      // still opens as a normal tab (Step 09i D7). The host mounts the
      // leaves through the normal open pipeline.
      const recovery = recoverSerializedSplit(entry.split, knownHandlers);
      if (recovery.state) {
        const tab: TabState = {
          id: entry.id,
          kind: "split",
          title: splitTabTitle(recovery.state),
          split: recovery.state,
          pinned: entry.pinned,
          group_id: entry.group_id,
        };
        tabs.push(tab);
        seen.add(entry.id);
        continue;
      }
      if (recovery.survivor) {
        const tab = survivorTab(entry.id, recovery.survivor);
        tab.pinned = entry.pinned;
        tab.group_id = entry.group_id;
        tabs.push(tab);
        seen.add(entry.id);
      }
      continue;
    }
    if (entry.kind === "folder") {
      if (!entry.folder) continue;
      const tab: TabState = {
        id: entry.id,
        kind: "folder",
        title: entry.title,
        path: entry.folder.path,
        folder: entry.folder,
        pinned: entry.pinned,
        group_id: entry.group_id,
      };
      if (entry.content_view_id !== undefined) tab.content_view_id = entry.content_view_id;
      tabs.push(tab);
      seen.add(entry.id);
      continue;
    }
    if (entry.kind === "file") {
      if (!entry.handler) continue;
      const tab: TabState = {
        id: entry.id,
        kind: "file",
        handler: entry.handler,
        title: entry.title,
        path: entry.path,
        pinned: entry.pinned,
        source: entry.source,
        group_id: entry.group_id,
      };
      if (entry.content_view_id !== undefined) tab.content_view_id = entry.content_view_id;
      if (entry.view !== undefined && entry.view !== null) {
        const decoded = decodeViewState(entry.handler, entry.view, entry.view_version);
        if (decoded !== null) {
          tab.view = decoded;
          tab.view_version = entry.view_version;
        }
      }
      if (entry.missing_reason) {
        tab.missing = { reason: entry.missing_reason, original_path: entry.path };
      }
      tabs.push(tab);
      seen.add(entry.id);
      continue;
    }
    if (SINGLE_KINDS.includes(entry.kind as TabKind) && !tabs.some((tab) => tab.kind === entry.kind)) {
      tabs.push({ id: entry.id, kind: entry.kind as TabKind, title: entry.title });
      seen.add(entry.id);
    }
  }
  const activeId =
    session.active_tab !== "" && tabs.some((tab) => tab.id === session.active_tab)
      ? session.active_tab
      : EXPLORER_TAB.id;
  const history = session.history.filter((id) => seen.has(id));
  if (!history.includes(activeId)) history.push(activeId);
  if (!history.includes(EXPLORER_TAB.id)) history.unshift(EXPLORER_TAB.id);
  return normalizeTabGroups({
    tabs,
    activeId,
    history: history.slice(-HISTORY_LIMIT),
    closed: [],
    groups: session.groups ?? [],
  });
}

/** One live tab in its stored form; `null` for a corrupt split, which is
 * never written down as a valid session entry (Step 09i D7). */
function sessionEntryOf(tab: TabState): SessionTab | null {
  // A live in-memory draft has no restorable source; reopening the app must
  // not invent an empty document from a saved draft id.
  if (tab.draft) return null;
  const entry: SessionTab = { id: tab.id, kind: tab.kind };
  if (tab.kind === "split") {
    // Splits serialize through the split codecs, which encode each leaf's
    // view; the outer entry carries no source, path, view or folder.
    const saved = serializeSplitTab(tab);
    if (!saved) return null;
    entry.split = saved.split;
    entry.title = splitTabTitle(saved.split);
  } else if (tab.kind === "folder") {
    if (tab.folder) entry.folder = tab.folder;
    if (tab.title !== undefined) entry.title = tab.title;
  } else if (tab.kind === "file") {
    if (tab.handler !== undefined) entry.handler = tab.handler;
    if (tab.source !== undefined) {
      entry.source = tab.source;
      // Virtual sources never carry a plain title or path.
      if (tab.source.kind === "disk" && tab.path !== undefined) entry.path = tab.path;
    } else if (tab.path !== undefined) {
      entry.path = tab.path;
    }
    if (tab.source?.kind !== "virtual" && tab.title !== undefined) entry.title = tab.title;
    if (tab.view !== undefined && tab.handler !== undefined && tab.source?.kind !== "virtual") {
      const encoded = encodeViewState(tab.handler, tab.view);
      if (encoded !== null) {
        entry.view = encoded.view;
        entry.view_version = encoded.view_version;
      }
    }
    if (tab.missing !== undefined) entry.missing_reason = tab.missing.reason;
  } else if (tab.title !== undefined) {
    entry.title = tab.title;
  }
  if (tab.pinned === true) entry.pinned = true;
  if (tab.group_id !== undefined) entry.group_id = tab.group_id;
  if (tab.kind !== "split" && tab.content_view_id !== undefined) {
    entry.content_view_id = tab.content_view_id;
  }
  return entry;
}

/** What to write to `session.json` (schema 2). Only descriptors and
 * bounded view state: no `document_id`, tokens, grants or live handles. */
export function sessionFromTabs(state: TabsState, nowUnix: number): SessionData {
  // Group membership is normalized first so a session never stores a
  // group whose members are pinned, stale or split (Step 09b D1/D2).
  const normalized = normalizeTabGroups(state);
  const tabs: SessionTab[] = normalized.tabs
    .map(sessionEntryOf)
    .filter((entry): entry is SessionTab => entry !== null);
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    tabs,
    active_tab: normalized.activeId,
    saved_unix: nowUnix,
    history: normalized.history.slice(-HISTORY_LIMIT),
    groups: (normalized.groups ?? []).map((group) => ({
      ...group,
      tab_ids: [...group.tab_ids],
    })),
  };
}

/** Ids of file tabs whose views stay mounted: the active tab plus the most
 * recently used ones, up to `limit`. Others are unmounted to save memory
 * and mount again when activated. */
export function mountedFileTabs(state: TabsState, limit = 8): Set<string> {
  const fileIds = new Set(state.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.id));
  const recent = [...state.history].reverse().filter((id) => fileIds.has(id));
  const keep = new Set(recent.slice(0, limit));
  if (fileIds.has(state.activeId)) keep.add(state.activeId);
  return keep;
}
