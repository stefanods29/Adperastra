import type { DocumentRef, SerializableViewState } from "../documents/types";
import type { FolderTabState } from "./folderState";
import {
  MAX_SPLIT_TAB_TITLE_CHARS,
  MAX_SPLIT_TITLE_CHARS,
  SPLIT_ERROR_INVALID,
  SPLIT_ERROR_LIMIT,
  SPLIT_ERROR_UNSUPPORTED,
  SPLIT_RATIO_DEFAULT,
  isSplitDirection,
  isSplitRatio,
  isSplitSide,
  otherSplitSide,
  splitLeafHandlerMissing,
  validateSavedSplitDescriptor,
  validateSplitLeaf,
  validateSplitState,
} from "./splitValidation";
import { EXPLORER_TAB, activateTab, newTabId, type TabState, type TabsState } from "./tabs";
import { decodeViewState, encodeViewState, isSerializableViewState } from "./viewState";

/** Split views inside one tab (Step 09i, split-view-1): canonical types and
 * pure reducers. One split is *one* outer tab (one of the 200 tabs) with
 * two leaf views; a leaf owns its presentation state under a stable
 * `view_id` while the Step 09a document behind it is shared. Splits never
 * nest: two sides, always. */

export type SplitSide = "first" | "second";
/** `vertical` puts the divider left/right (side by side); `horizontal`
 * puts it top/bottom (above and below). */
export type SplitDirection = "vertical" | "horizontal";
export type SplitLeafKind = "file" | "folder";
export type SplitLeafMissingReason = "not_found" | "handler_missing" | "locked";

/** The placeholder a missing tab shows (Step 09a), with the same meanings.
 * A locked entry keeps no plain name here. */
export interface SplitLeafMissing {
  reason: SplitLeafMissingReason;
  original_path?: string;
}

/** One side of a split: a descriptor, never a live handle. No split, group,
 * pinned or child fields exist (no nested splits). A file leaf needs a
 * source and a handler; a folder leaf needs a folder state and keeps its
 * scroll there, never in `view`. A virtual (locked) leaf never carries a
 * plain title or view state. */
export interface SplitLeaf {
  view_id: string;
  kind: SplitLeafKind;
  source?: DocumentRef;
  handler?: string;
  folder?: FolderTabState;
  title?: string;
  view?: SerializableViewState;
  view_version?: number;
  missing?: SplitLeafMissing;
}

export interface SplitState {
  first: SplitLeaf;
  second: SplitLeaf;
  direction: SplitDirection;
  /** Fraction of the space given to the first leaf, 0.2-0.8. */
  ratio: number;
  active_side: SplitSide;
  /** Off by default; only linkable when both leaves register a port. */
  sync_scroll: boolean;
}

/** The serialized split in a session (session-2) or a saved group
 * (saved-groups-1). View ids are rewritten on restore. */
export interface SavedSplitDescriptor {
  kind: "split";
  split: SplitState;
}

export {
  MAX_SPLIT_LEAVES, MAX_SPLIT_TAB_TITLE_CHARS, MAX_SPLIT_TITLE_CHARS, MAX_SPLIT_VIEW_BYTES,
  MAX_SPLIT_VIEW_ID_CHARS,
  SPLIT_DIVIDER_SIZE, SPLIT_ERROR_INVALID, SPLIT_ERROR_LIMIT, SPLIT_ERROR_UNSUPPORTED,
  SPLIT_LEAF_MIN_HEIGHT, SPLIT_LEAF_MIN_WIDTH, SPLIT_RATIO_DEFAULT, SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN, SPLIT_RATIO_STEP, SPLIT_RATIO_STEP_LARGE, clampSplitRatio,
  isSplitDirection, isSplitRatio, isSplitSide, otherSplitSide, splitSideLabelKey,
  stepSplitRatio, validateSavedSplitDescriptor, validateSplitLeaf, validateSplitState,
} from "./splitValidation";

let viewCounter = 0;

/** A fresh, stable leaf view id. It never changes when the presentation
 * view remounts into another parent; only a restore mints new ids. */
export function newSplitViewId(): string {
  viewCounter += 1;
  return `splitview-${Date.now().toString(36)}-${viewCounter}`;
}

export function isSplitTab(tab: TabState): tab is TabState & { kind: "split"; split: SplitState } {
  return tab.kind === "split" && tab.split !== undefined && tab.split !== null;
}

/** A promoted survivor keeps its leaf view id; every other tab is its own
 * view identity (Decision 3). */
export function viewIdentityOf(tab: TabState): string {
  return tab.content_view_id ?? tab.id;
}

export function splitLeavesOf(tab: TabState): readonly SplitLeaf[] {
  return isSplitTab(tab) ? [tab.split.first, tab.split.second] : [];
}

export function splitLeafOf(tab: TabState, side: SplitSide): SplitLeaf | null {
  if (!isSplitTab(tab)) return null;
  return side === "first" ? tab.split.first : tab.split.second;
}

export function activeSplitLeaf(tab: TabState): SplitLeaf | null {
  if (!isSplitTab(tab)) return null;
  return tab.split.active_side === "first" ? tab.split.first : tab.split.second;
}

/** The view id a command or a drop must reach: the active leaf. */
export function activeSplitViewId(tab: TabState): string | null {
  return activeSplitLeaf(tab)?.view_id ?? null;
}

/** Groups belong to outer tabs only, so the leaves lose their membership
 * (Step 09b D1, Step 09i D8). */
export function splitOuterGroupId(first: TabState, second: TabState): string | undefined {
  return first.group_id ?? second.group_id;
}

function leafLabel(leaf: SplitLeaf): string {
  if (leaf.title) return leaf.title;
  if (leaf.kind === "folder" && leaf.folder) {
    return leaf.folder.path.split(/[\\/]/).filter(Boolean).pop() ?? leaf.folder.path;
  }
  if (leaf.source?.kind === "disk") {
    return leaf.source.path.split(/[\\/]/).filter(Boolean).pop() ?? leaf.source.path;
  }
  return "";
}

/** Clip by UTF-16 units (what the session validator counts) without
 * cutting a surrogate pair in half. */
function clipLabel(label: string, maxUnits: number): string {
  if (label.length <= maxUnits) return label;
  let end = Math.max(0, maxUnits);
  const last = end > 0 ? label.charCodeAt(end - 1) : 0;
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return label.slice(0, end);
}

/** The outer tab's name: both sides, never a product or app label. It is
 * written as one session tab title, so it stays inside the existing
 * 255-character cap; both side names keep a share instead of one side
 * dropping out of the tab label. */
export function splitTabTitle(split: SplitState): string {
  const first = leafLabel(split.first);
  const second = leafLabel(split.second);
  if (first === "" || second === "") {
    return clipLabel(first || second, MAX_SPLIT_TAB_TITLE_CHARS);
  }
  const separator = " / ";
  const available = MAX_SPLIT_TAB_TITLE_CHARS - separator.length;
  const firstLength = first.length;
  const secondLength = second.length;
  // The short side keeps only what it needs; the rest goes to the long one.
  const half = Math.floor(available / 2);
  const firstBudget = Math.min(firstLength, Math.max(half, available - secondLength));
  const secondBudget = available - firstBudget;
  return `${clipLabel(first, firstBudget)}${separator}${clipLabel(second, secondBudget)}`;
}

function invalid(): Error {
  return new Error(SPLIT_ERROR_INVALID);
}

function tabById(state: TabsState, id: string): TabState {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab) throw invalid();
  return tab;
}

function replaceTab(state: TabsState, id: string, tab: TabState): TabsState {
  return { ...state, tabs: state.tabs.map((entry) => (entry.id === id ? tab : entry)) };
}

function assertSplit(tab: TabState): SplitState {
  if (!isSplitTab(tab)) throw invalid();
  return tab.split;
}

/** Tabs that may become a leaf: an unpinned file or folder tab. The
 * permanent Explorer, Help/Settings/Components and pinned tabs are refused
 * (Decision 1). */
export function assertSplittableTab(tab: TabState): void {
  if (isSplitTab(tab)) throw new Error(SPLIT_ERROR_LIMIT);
  if (tab.pinned === true) throw new Error(SPLIT_ERROR_UNSUPPORTED);
  if (tab.id === EXPLORER_TAB.id || (tab.kind !== "file" && tab.kind !== "folder")) {
    throw new Error(SPLIT_ERROR_UNSUPPORTED);
  }
}

/** Turn one eligible tab into a leaf. A normal tab's id is its view id; a
 * promoted survivor keeps its `content_view_id`, so the document
 * reference never changes hands when the tab is split again. */
export function leafFromTab(tab: TabState): SplitLeaf {
  assertSplittableTab(tab);
  // A promoted survivor's content still belongs to its leaf view id, not
  // to the outer tab id it now uses (Decision 3).
  const viewId = viewIdentityOf(tab);
  if (tab.kind === "folder") {
    if (!tab.folder) throw invalid();
    const folderLeaf: SplitLeaf = {
      view_id: viewId,
      kind: "folder",
      folder: { ...tab.folder, sort: { ...tab.folder.sort } },
    };
    if (tab.title !== undefined) folderLeaf.title = tab.title;
    if (tab.missing !== undefined) folderLeaf.missing = { ...tab.missing };
    return folderLeaf;
  }
  const source = tab.source ?? (tab.path ? ({ kind: "disk", path: tab.path } as const) : null);
  if (!source || !tab.handler) throw invalid();
  const leaf: SplitLeaf = { view_id: viewId, kind: "file", source, handler: tab.handler };
  const virtual = source.kind === "virtual";
  if (!virtual && tab.title !== undefined) leaf.title = tab.title;
  if (!virtual && tab.view !== undefined && tab.view !== null && isSerializableViewState(tab.view)) {
    leaf.view = tab.view;
    const version = tab.view_version;
    if (typeof version === "number" && Number.isSafeInteger(version) && version >= 0 && version <= 4_294_967_295) {
      leaf.view_version = version;
    }
  }
  if (tab.missing !== undefined) leaf.missing = { ...tab.missing };
  return leaf;
}

// SplitState-level helpers: the view component owns a SplitState, the tab
// reducers own a TabsState. Both use these, so the rules live in one place.

export function withSplitRatio(split: SplitState, value: number): SplitState {
  if (!isSplitRatio(value)) throw invalid();
  return { ...split, ratio: value };
}

/** Changing the direction keeps the ratio (Decision 5). */
export function withSplitDirection(split: SplitState, direction: SplitDirection): SplitState {
  if (!isSplitDirection(direction)) throw invalid();
  return { ...split, direction };
}

export function withSplitActiveSide(split: SplitState, side: SplitSide): SplitState {
  if (!isSplitSide(side)) throw invalid();
  return { ...split, active_side: side };
}

/** Swap exchanges the positions; the active side follows its own content,
 * so the same document stays active in its new position. View ids,
 * documents and models do not change (Decision 5). */
export function swapSplitState(split: SplitState): SplitState {
  return { ...split, first: split.second, second: split.first, active_side: otherSplitSide(split.active_side) };
}

export function withSplitSyncScroll(split: SplitState, syncScroll: boolean): SplitState {
  return { ...split, sync_scroll: syncScroll === true };
}

/** Replace one leaf's content, keeping the other side, direction, ratio and
 * active side. The caller supplies a leaf with a fresh view id. */
export function withSplitLeaf(split: SplitState, side: SplitSide, leaf: SplitLeaf): SplitState {
  const validated = validateSplitLeaf(leaf);
  if (!validated) throw invalid();
  const other = side === "first" ? split.second : split.first;
  if (validated.view_id === other.view_id) throw invalid();
  return side === "first" ? { ...split, first: validated } : { ...split, second: validated };
}

// E1: pure tab reducers. Invalid input throws splits.invalid /
// splits.unsupported / splits.limit and changes nothing.

/** Consume two eligible tabs into one split outer tab (E1). The outer tab
 * takes the earlier position, counts once of the 200 tabs and becomes
 * active. Leaves keep their view ids and document references; nothing is
 * closed or discarded. */
export function createSplitTab(
  state: TabsState,
  firstId: string,
  secondId: string,
  direction: SplitDirection,
): TabsState {
  if (firstId === secondId) throw invalid();
  const first = tabById(state, firstId);
  const second = tabById(state, secondId);
  if (first.kind === "split" || second.kind === "split") throw new Error(SPLIT_ERROR_LIMIT);
  if (!isSplitDirection(direction)) throw invalid();
  const firstLeaf = validateSplitLeaf(leafFromTab(first));
  const secondLeaf = validateSplitLeaf(leafFromTab(second));
  if (!firstLeaf || !secondLeaf || firstLeaf.view_id === secondLeaf.view_id) throw invalid();
  const split: SplitState = {
    first: firstLeaf,
    second: secondLeaf,
    direction,
    ratio: SPLIT_RATIO_DEFAULT,
    active_side: "first",
    sync_scroll: false,
  };
  const outer: TabState = { id: newTabId("split"), kind: "split", title: splitTabTitle(split), split };
  const groupId = splitOuterGroupId(first, second);
  if (groupId !== undefined) outer.group_id = groupId;
  const insertAt = Math.min(state.tabs.indexOf(first), state.tabs.indexOf(second));
  const before = state.tabs.slice(0, insertAt).filter((tab) => tab.id !== firstId && tab.id !== secondId).length;
  const tabs = state.tabs.filter((tab) => tab.id !== firstId && tab.id !== secondId);
  tabs.splice(before, 0, outer);
  // The consumed tabs leave the activation history so it only names live
  // tabs; the outer tab becomes the newest entry.
  const history = state.history.filter((entry) => entry !== firstId && entry !== secondId);
  return activateTab({ ...state, tabs, history }, outer.id);
}

function patchSplit(state: TabsState, id: string, change: (split: SplitState) => SplitState): TabsState {
  const tab = tabById(state, id);
  const split = assertSplit(tab);
  const next = change(split);
  if (next === split) return state;
  // The outer name follows the positions (a swap exchanges both names).
  return replaceTab(state, id, { ...tab, split: next, title: splitTabTitle(next) });
}

/** Exchange the two sides of a split (E1); the active side follows. */
export function swapSplitSides(state: TabsState, id: string): TabsState {
  return patchSplit(state, id, swapSplitState);
}

/** Set the divider ratio (E1): committed once per pointer release or key
 * press, never per pixel. */
export function setSplitRatio(state: TabsState, id: string, value: number): TabsState {
  return patchSplit(state, id, (split) => withSplitRatio(split, value));
}

export function setSplitDirection(state: TabsState, id: string, direction: SplitDirection): TabsState {
  return patchSplit(state, id, (split) => (split.direction === direction ? split : withSplitDirection(split, direction)));
}

export function setSplitActiveSide(state: TabsState, id: string, side: SplitSide): TabsState {
  return patchSplit(state, id, (split) => (split.active_side === side ? split : withSplitActiveSide(split, side)));
}

export function setSplitSyncScroll(state: TabsState, id: string, syncScroll: boolean): TabsState {
  return patchSplit(state, id, (split) => withSplitSyncScroll(split, syncScroll));
}

/** Replace the whole split state (the view's `onChange`). The value is
 * re-validated, so a component can never write a ratio, a nested leaf or a
 * locked title the session would refuse. */
export function setSplitState(state: TabsState, id: string, split: SplitState): TabsState {
  const tab = tabById(state, id);
  if (!isSplitTab(tab)) throw invalid();
  const validated = validateSplitState(split);
  if (!validated) throw invalid();
  return replaceTab(state, id, { ...tab, split: validated, title: splitTabTitle(validated) });
}

/** Open a new source into one side (Decision 1: a normal open inside a
 * split creates the destination leaf through the normal pipeline). The host
 * mints the leaf with `newSplitViewId()` and acquires the document
 * reference under that id first; the other side is untouched. */
export function setSplitLeaf(state: TabsState, id: string, side: SplitSide, leaf: SplitLeaf): TabsState {
  return patchSplit(state, id, (split) => withSplitLeaf(split, side, leaf));
}

/** Promote the surviving side after the host confirmed the close (E1): the
 * outer id stays, `content_view_id` records the surviving view, and only
 * the closed leaf is gone. */
export function closeSplitSide(state: TabsState, id: string, side: SplitSide): TabsState {
  if (!isSplitSide(side)) throw invalid();
  const tab = tabById(state, id);
  const split = assertSplit(tab);
  const survivor = side === "first" ? split.second : split.first;
  const promoted: TabState = { id: tab.id, kind: survivor.kind, content_view_id: survivor.view_id };
  if (survivor.kind === "folder") {
    if (!survivor.folder) throw invalid();
    promoted.folder = { ...survivor.folder, sort: { ...survivor.folder.sort } };
    promoted.path = survivor.folder.path;
  } else {
    if (!survivor.source || !survivor.handler) throw invalid();
    promoted.source = survivor.source;
    promoted.handler = survivor.handler;
    if (survivor.source.kind === "disk") promoted.path = survivor.source.path;
  }
  if (survivor.title !== undefined) promoted.title = survivor.title;
  if (survivor.view !== undefined) promoted.view = survivor.view;
  if (survivor.view_version !== undefined) promoted.view_version = survivor.view_version;
  if (survivor.missing !== undefined) promoted.missing = { ...survivor.missing };
  if (tab.group_id !== undefined) promoted.group_id = tab.group_id;
  return replaceTab(state, id, promoted);
}

// E2: serialize / restore. No native handle, token or runtime flag is ever
// written; a restore mints fresh view ids and the host opens the sources
// through the normal pipeline (never a pure function).

function copySource(source: DocumentRef): DocumentRef {
  if (source.kind === "disk") return { kind: "disk", path: source.path };
  if (source.kind === "virtual") {
    return {
      kind: "virtual",
      provider: "locked",
      container_path: source.container_path,
      entry_id: source.entry_id,
    };
  }
  return { kind: "draft", draft_id: source.draft_id };
}

function copyViewState(view: SerializableViewState): SerializableViewState {
  // A saved descriptor is a snapshot: later live scroll/selection changes
  // must not mutate the object a session or saved group holds.
  return JSON.parse(JSON.stringify(view)) as SerializableViewState;
}

function savedLeaf(leaf: SplitLeaf): SplitLeaf {
  const copy: SplitLeaf = { view_id: leaf.view_id, kind: leaf.kind };
  if (leaf.source) copy.source = copySource(leaf.source);
  if (leaf.handler !== undefined) copy.handler = leaf.handler;
  if (leaf.folder) copy.folder = { ...leaf.folder, sort: { ...leaf.folder.sort } };
  const virtual = leaf.source?.kind === "virtual";
  if (!virtual && leaf.title !== undefined && [...leaf.title].length <= MAX_SPLIT_TITLE_CHARS) {
    copy.title = leaf.title;
  }
  // A live leaf holds the handler's view state; a session or saved group
  // stores only what the registered codec encoded, exactly like a normal
  // file tab. Without a codec the state is omitted, never written raw.
  if (!virtual && leaf.view !== undefined && isSerializableViewState(leaf.view)) {
    const encoded = leaf.handler ? encodeViewState(leaf.handler, leaf.view) : null;
    if (encoded !== null) {
      copy.view = copyViewState(encoded.view);
      copy.view_version = encoded.view_version;
    }
  }
  if (leaf.missing) copy.missing = { ...leaf.missing };
  return copy;
}

/** Serialize a split for a session or a saved group. Returns `null` (never
 * throws) when the state is not a valid split, so a broken live state can
 * never be written down as if it were valid. */
export function serializeSplit(state: SplitState): SavedSplitDescriptor | null {
  const validated = validateSplitState(state);
  if (!validated) return null;
  const split: SplitState = {
    first: savedLeaf(validated.first),
    second: savedLeaf(validated.second),
    direction: validated.direction,
    ratio: validated.ratio,
    active_side: validated.active_side,
    sync_scroll: validated.sync_scroll,
  };
  if (!validateSplitState(split)) return null;
  return { kind: "split", split };
}

/** Serialize a split outer tab; `null` for every other tab, so legacy tabs
 * keep exactly their existing shape. */
export function serializeSplitTab(tab: TabState): SavedSplitDescriptor | null {
  if (!isSplitTab(tab)) return null;
  return serializeSplit(tab.split);
}

/** Turn a stored leaf's encoded view back into the handler's live state.
 * An unknown handler, a version mismatch or a state the codec cannot
 * decode drops the view and its version, as `tabsFromSession` does. */
function decodedLeaf(leaf: SplitLeaf): SplitLeaf {
  if (leaf.view === undefined) {
    if (leaf.view_version === undefined) return leaf;
    const copy: SplitLeaf = { ...leaf };
    delete copy.view_version;
    return copy;
  }
  if (leaf.handler === undefined) return leaf;
  const decoded = decodeViewState(leaf.handler, leaf.view, leaf.view_version);
  if (decoded === null || !isSerializableViewState(decoded)) {
    const copy: SplitLeaf = { ...leaf };
    delete copy.view;
    delete copy.view_version;
    return copy;
  }
  return { ...leaf, view: decoded };
}

/** Strict restore: a valid descriptor becomes a live split with two fresh
 * view ids. Invalid data throws `splits.invalid`. */
export function restoreSplit(descriptor: SavedSplitDescriptor): SplitState {
  const validated = validateSavedSplitDescriptor(descriptor);
  if (!validated) throw invalid();
  return {
    ...validated.split,
    first: { ...decodedLeaf(validated.split.first), view_id: newSplitViewId() },
    second: { ...decodedLeaf(validated.split.second), view_id: newSplitViewId() },
  };
}

export interface SplitRecovery {
  /** Both sides usable: a live split with fresh view ids. */
  state: SplitState | null;
  /** Exactly one usable side: open it as a normal tab (fresh view id). */
  survivor: SplitLeaf | null;
}

/** Lenient restore for sessions and saved groups (Step 09a D5, Step 09i
 * D7): an unknown handler becomes its own `handler_missing` placeholder,
 * and one broken side never drops the other. The input is not modified. */
export function recoverSerializedSplit(value: unknown, knownHandlers?: readonly string[]): SplitRecovery {
  const empty: SplitRecovery = { state: null, survivor: null };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return empty;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return empty;
  const record = value as Record<string, unknown>;
  const direction = isSplitDirection(record.direction) ? record.direction : "vertical";
  const ratio = isSplitRatio(record.ratio) ? record.ratio : SPLIT_RATIO_DEFAULT;
  const activeSide = isSplitSide(record.active_side) ? record.active_side : "first";
  const syncScroll = record.sync_scroll === true;
  const usable = (raw: unknown): SplitLeaf | null => {
    const parsed = validateSplitLeaf(raw);
    if (!parsed) return null;
    const leaf = decodedLeaf(parsed);
    if (leaf.missing || !splitLeafHandlerMissing(leaf, knownHandlers)) return leaf;
    return { ...leaf, missing: { reason: "handler_missing" } };
  };
  const left = usable(record.first);
  const right = usable(record.second);
  if (left && right && left.view_id !== right.view_id) {
    return {
      state: {
        first: { ...left, view_id: newSplitViewId() },
        second: { ...right, view_id: newSplitViewId() },
        direction,
        ratio,
        active_side: activeSide,
        sync_scroll: syncScroll,
      },
      survivor: null,
    };
  }
  const only = left ?? right;
  if (!only) return empty;
  return { state: null, survivor: { ...only, view_id: newSplitViewId() } };
}
