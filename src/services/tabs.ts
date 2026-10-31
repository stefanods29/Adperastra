/** The tab model (Step 04a): which tabs exist, which one is active, and the
 * order tabs were used in (closing a tab returns to the one used before).
 * Pure functions only, so every rule is unit-tested. `App.tsx` holds one
 * `TabsState` and replaces it with the result of these functions. */

export type TabKind = "explorer" | "help" | "settings" | "gallery" | "file";

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
}

export interface TabsState {
  tabs: TabState[];
  activeId: string;
  /** Tab ids in the order they were activated, oldest first. */
  history: string[];
}

/** What `session.json` stores (Rust `SessionState`). */
export interface SessionData {
  tabs: { id: string; kind: string; title?: string; path?: string; handler?: string }[];
  active_tab: string;
  saved_unix: number;
}

export const EXPLORER_TAB: TabState = { id: "explorer", kind: "explorer" };
const SINGLE_KINDS: TabKind[] = ["help", "settings", "gallery"];
const HISTORY_LIMIT = 50;

let idCounter = 0;
/** A new unique tab id such as "file-lx3k9a-1". */
export function newTabId(kind: TabKind): string {
  idCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${idCounter}`;
}

export function initialTabs(): TabsState {
  return { tabs: [EXPLORER_TAB], activeId: EXPLORER_TAB.id, history: [EXPLORER_TAB.id] };
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

/** Open a file in a tab. The same file with the same handler reuses its
 * tab. `background` keeps the current tab active. New tabs go at the end. */
export function openFileTab(
  state: TabsState,
  file: { path: string; handler: string; title: string },
  background: boolean,
): TabsState {
  const existing = state.tabs.find(
    (tab) => tab.kind === "file" && tab.handler === file.handler && tab.path !== undefined && samePathText(tab.path, file.path),
  );
  if (existing) return background ? state : activateTab(state, existing.id);
  const tab: TabState = { id: newTabId("file"), kind: "file", path: file.path, handler: file.handler, title: file.title };
  const next = { ...state, tabs: [...state.tabs, tab] };
  return background ? next : activateTab(next, tab.id);
}

/** Close a tab (never the Explorer tab). If it was active, the most
 * recently used remaining tab becomes active. */
export function closeTab(state: TabsState, id: string): TabsState {
  if (id === EXPLORER_TAB.id || !state.tabs.some((tab) => tab.id === id)) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId, history };
  const previous = [...history].reverse().find((entry) => tabs.some((tab) => tab.id === entry));
  return activateTab({ tabs, activeId: EXPLORER_TAB.id, history }, previous ?? EXPLORER_TAB.id);
}

/** Store a file tab's view state (from `HandlerViewProps.onStateChange`). */
export function setTabView(state: TabsState, id: string, view: unknown): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, view } : tab)) };
}

/** Save as (Step 06a): the file tab shows its new path and name. */
export function setTabPath(state: TabsState, id: string, path: string, title: string): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, path, title } : tab)) };
}

/** Rebuild tabs from a stored session. Unknown or broken entries are
 * dropped; the Explorer tab always comes first and exactly once. */
export function tabsFromSession(input: unknown, knownHandlers: readonly string[]): TabsState {
  const raw =
    input !== null && typeof input === "object" && Array.isArray((input as SessionData).tabs)
      ? ((input as SessionData).tabs as unknown[])
      : [];
  const seen = new Set<string>([EXPLORER_TAB.id]);
  const tabs: TabState[] = [EXPLORER_TAB];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = candidate.id;
    const kind = candidate.kind;
    if (typeof id !== "string" || seen.has(id)) continue;
    const title = typeof candidate.title === "string" ? candidate.title : undefined;
    if (kind === "file") {
      const path = candidate.path;
      const handler = candidate.handler;
      if (typeof path !== "string" || path === "" || typeof handler !== "string" || !knownHandlers.includes(handler)) continue;
      tabs.push({ id, kind: "file", path, handler, title });
    } else if (SINGLE_KINDS.includes(kind as TabKind) && !tabs.some((tab) => tab.kind === kind)) {
      tabs.push({ id, kind: kind as TabKind, title });
    } else {
      continue;
    }
    seen.add(id);
  }
  const stored =
    input !== null && typeof input === "object" ? (input as SessionData).active_tab : undefined;
  const activeId = typeof stored === "string" && tabs.some((tab) => tab.id === stored) ? stored : EXPLORER_TAB.id;
  const history = activeId === EXPLORER_TAB.id ? [EXPLORER_TAB.id] : [EXPLORER_TAB.id, activeId];
  return { tabs, activeId, history };
}

/** What to write to `session.json`. View state is not stored yet (Step 09a). */
export function sessionFromTabs(state: TabsState, nowUnix: number): SessionData {
  return {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      path: tab.path,
      handler: tab.handler,
    })),
    active_tab: state.activeId,
    saved_unix: nowUnix,
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
