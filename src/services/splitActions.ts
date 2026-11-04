import type { DocumentHandle, SerializableViewState } from "../documents/types";
import { TabHistory } from "./tabHistory";
import { sessionFromTabs, type SessionData, type SessionTab, type TabState, type TabsState } from "./tabs";
import type { UndoEntryInput } from "./undo";
import { isSerializableViewState } from "./viewState";
import {
  activeSplitViewId,
  closeSplitSide,
  createSplitTab,
  isSplitTab,
  serializeSplitTab,
  splitLeafOf,
  swapSplitSides,
  viewIdentityOf,
  type SplitDirection,
  type SplitSide,
  type SplitState,
} from "./splitViews";

/** Split transactions (Step 09i T2): the one place that changes a tab
 * between normal and split shape. Every transaction returns the exact
 * state before it, so the caller records exactly one tab-history entry,
 * and keeps leaf view ids stable while the presentation view is remounted
 * into another parent (Decisions 3-5).
 *
 * Nothing here closes a document, writes a file or discards unsaved
 * changes: the host performs the 09a atomic close plan and releases only
 * the view that actually closed. */

export interface SplitPresentationHost {
  /** Freeze a view's validated selection and scroll before it is moved to
   * another React parent. Never returns a live object. */
  captureViewState(viewId: string): SerializableViewState | null;
  /** Hand the captured value to the same view id after the remount. It is
   * queued for the next mount, not applied to a disposed view. */
  restoreViewState(viewId: string, state: SerializableViewState | null): void;
}

export interface SplitCloseHost {
  /** The shared document handles behind these views. Two views of one
   * document return two handles with the same `id`. */
  documentsFor(viewIds: readonly string[]): readonly DocumentHandle[];
  /** Step 09a E11: the only entry for an atomic close decision. It must
   * return false — changing nothing — when the user cancels, a save fails
   * or any prepared content changed. */
  prepareClose(documents: readonly DocumentHandle[], reason: "split"): Promise<boolean>;
  /** Release exactly one view's reference. Never disposes a model that the
   * surviving side still views. */
  releaseView(viewId: string): void;
  /** Optional: freeze the surviving view's current validated selection and
   * scroll before it is remounted as a normal tab. A missing callback or a
   * null result keeps the leaf's stored view state. */
  captureViewState?(viewId: string): SerializableViewState | null;
}

export interface SplitActionOutcome {
  before: TabsState;
  state: TabsState;
  /** The presentation state captured for each leaf view id, so the caller
   * can pass it to the remounted view (empty for pure actions). */
  viewStates: Readonly<Record<string, SerializableViewState | null>>;
}

function capture(
  host: SplitPresentationHost | undefined,
  viewIds: readonly string[],
): Record<string, SerializableViewState | null> {
  const states: Record<string, SerializableViewState | null> = {};
  if (!host) return states;
  for (const viewId of viewIds) states[viewId] = host.captureViewState(viewId);
  return states;
}

function restore(
  host: SplitPresentationHost | undefined,
  states: Record<string, SerializableViewState | null>,
): void {
  if (!host) return;
  for (const [viewId, state] of Object.entries(states)) host.restoreViewState(viewId, state);
}

/** Turn two eligible tabs into one split tab. The leaves keep their view
 * identities (a promoted survivor keeps its leaf view id), so no document
 * reference is acquired or released: the same view now lives inside the
 * outer tab. Throws the split error codes before anything changes when a
 * tab is ineligible, pinned or already a split (`splits.limit`: two sides
 * only). */
export function createSplit(
  state: TabsState,
  firstId: string,
  secondId: string,
  direction: SplitDirection,
  host?: SplitPresentationHost,
): SplitActionOutcome {
  const viewIdOf = (tabId: string): string => {
    const tab = state.tabs.find((entry) => entry.id === tabId);
    return tab ? viewIdentityOf(tab) : tabId;
  };
  const viewStates = capture(host, [viewIdOf(firstId), viewIdOf(secondId)]);
  const next = createSplitTab(state, firstId, secondId, direction);
  restore(host, viewStates);
  return { before: state, state: next, viewStates };
}

/** Exchange the two sides. The active side follows its content, and the
 * two view ids (and their documents) stay exactly as they were. */
export function swapSplit(state: TabsState, id: string, host?: SplitPresentationHost): SplitActionOutcome {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || !isSplitTab(tab)) throw new Error("splits.invalid");
  const viewIds = [tab.split.first.view_id, tab.split.second.view_id];
  const viewStates = capture(host, viewIds);
  const next = swapSplitSides(state, id);
  restore(host, viewStates);
  return { before: state, state: next, viewStates };
}

/** Close one side after the shared dirty decision (Decision 3, U6):
 *  - a split always keeps one side, so at most one document can lose its
 *    last view;
 *  - two views of the same document prompt nothing (the document stays);
 *  - a cancelled or failed decision returns `null` and changes nothing:
 *    no tab, no reference, no view state, no active side;
 *  - on success only the closed view's reference is released, and the
 *    survivor becomes a normal outer tab with the same outer id and its
 *    captured selection/scroll. */
export async function closeSplit(
  state: TabsState,
  id: string,
  side: SplitSide,
  host: SplitCloseHost,
): Promise<SplitActionOutcome | null> {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || !isSplitTab(tab)) throw new Error("splits.invalid");
  const closedLeaf = splitLeafOf(tab, side);
  const survivor = splitLeafOf(tab, side === "first" ? "second" : "first");
  if (!closedLeaf || !survivor) throw new Error("splits.invalid");

  const closedDocuments = host.documentsFor([closedLeaf.view_id]);
  const survivorDocuments = host.documentsFor([survivor.view_id]);
  const survivorIds = new Set(survivorDocuments.map((document) => document.id));
  const closing = closedDocuments.filter((document) => !survivorIds.has(document.id));
  // Capture before the dirty dialog and the parent change: the survivor is
  // remounted as a normal tab under the same view id (Decision 3).
  const captured = host.captureViewState?.(survivor.view_id) ?? null;
  const survivorState = captured !== null && isSerializableViewState(captured) ? captured : null;
  if (closing.length > 0) {
    const approved = await host.prepareClose(closing, "split");
    if (!approved) return null;
  }

  const promotedState = closeSplitSide(state, id, side);
  const next: TabsState =
    survivorState === null
      ? promotedState
      : {
          ...promotedState,
          tabs: promotedState.tabs.map((tab) => (tab.id === id ? { ...tab, view: survivorState } : tab)),
        };
  host.releaseView(closedLeaf.view_id);
  return {
    before: state,
    state: next,
    viewStates: survivorState === null ? {} : { [survivor.view_id]: survivorState },
  };
}

type SplitHistoryTab = SessionTab & {
  split?: SplitState;
  content_view_id?: string;
  group_id?: string;
};

/** Undo entries store the same session shape the app persists. A split
 * leaves its source/folder out of the outer entry (its leaves carry them)
 * and a promoted survivor keeps its leaf view identity, so undoing a
 * structural action restores the split, not a nameless "split" tab. */
function sessionWithSplits(state: TabsState): SessionData {
  const session = sessionFromTabs(state, Math.floor(Date.now() / 1000));
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const tabs: SplitHistoryTab[] = session.tabs.map((entry) => {
    const tab = byId.get(entry.id);
    if (!tab) return entry;
    const runtime = tab as TabState & { content_view_id?: string; group_id?: string };
    let historyTab: SplitHistoryTab = entry;
    if (runtime.group_id !== undefined) historyTab = { ...historyTab, group_id: runtime.group_id };
    const saved = serializeSplitTab(tab);
    if (saved) return { ...historyTab, kind: "split", split: saved.split };
    return runtime.content_view_id === undefined
      ? historyTab
      : { ...historyTab, content_view_id: runtime.content_view_id };
  });
  return { ...session, tabs };
}

function defaultSession(state: TabsState): SessionData {
  return sessionWithSplits(state);
}

/** One Undo entry for one structural split action (Decision 5). The entry
 * stores tab descriptors only, never content, tokens or closures. */
export function splitUndoEntry(
  outcome: SplitActionOutcome,
  labelKey: string,
  toSession: (state: TabsState) => SessionData = defaultSession,
): UndoEntryInput {
  return TabHistory.record(toSession(outcome.before), toSession(outcome.state), labelKey);
}

/** The two leaf view ids of a split tab, in position order. */
export function splitViewIds(tab: TabState): readonly [string, string] | null {
  if (!isSplitTab(tab)) return null;
  return [tab.split.first.view_id, tab.split.second.view_id];
}

/** The view id a drop or command must reach: the active leaf (Decision 4).
 * Re-exported from `splitViews` so there is exactly one definition. */
export { activeSplitViewId };
