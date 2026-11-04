import type { ReactNode } from "react";
import type { FolderTabState } from "../services/folderState";
import {
  activeSplitViewId,
  assertSplittableTab,
  type SplitLeaf,
  type SplitSide,
  type SplitState,
} from "../services/splitViews";
import type { TabState, TabsState } from "../services/tabs";
import { isSerializableViewState } from "../services/viewState";
import SplitView from "../views/split/SplitView";
import { createSplitHost } from "../views/split/splitHost";
import { resolveScrollSyncPort } from "../views/split/scrollSync";

/** The application side of a split tab (Step 09i T3/T5): one `SplitHost`
 * per outer tab, built from explicit callbacks, plus the pure helpers the
 * coordinator needs to render, restore and close leaves. The presentation
 * component stays in `views/split`; this file never queries another
 * component's DOM and never calls `invoke`. */

export type SplitLeafRenderer = (
  leaf: SplitLeaf,
  side: SplitSide,
  active: boolean,
  visible: boolean,
  onFocus: () => void,
) => ReactNode;

export interface SplitTabViewProps {
  tab: TabState;
  active: boolean;
  renderLeaf: SplitLeafRenderer;
  onSplitChange: (split: SplitState) => void;
  onCloseSide: (side: SplitSide) => Promise<void>;
  onOpenHelp: (slug: string) => void;
  /** Active-leaf command router (Decision 4). */
  onLeafCommand: (viewId: string, commandId: string, arg?: string) => void;
  /** The whole-tab close decision for both leaves (Ctrl+W, close button). */
  confirmCloseLeaves: (leaves: readonly SplitLeaf[]) => Promise<boolean>;
}

export function splitSideOf(split: SplitState, viewId: string): SplitSide {
  return split.first.view_id === viewId ? "first" : "second";
}

/** A leaf as the viewer components expect it. The id is the stable leaf
 * view id, so dirty tracking and scroll ports stay keyed to the leaf. */
export function splitLeafTab(leaf: SplitLeaf): TabState {
  const tab: TabState = { id: leaf.view_id, kind: leaf.kind };
  if (leaf.title !== undefined) tab.title = leaf.title;
  if (leaf.handler !== undefined) tab.handler = leaf.handler;
  if (leaf.source !== undefined) {
    tab.source = leaf.source;
    if (leaf.source.kind === "disk") tab.path = leaf.source.path;
  }
  if (leaf.folder !== undefined) {
    tab.folder = { ...leaf.folder, sort: { ...leaf.folder.sort } };
    tab.path = leaf.folder.path;
  }
  if (leaf.view !== undefined) tab.view = leaf.view;
  if (leaf.view_version !== undefined) tab.view_version = leaf.view_version;
  if (leaf.missing !== undefined) tab.missing = { ...leaf.missing };
  return tab;
}

/** Store a leaf's view state. A value the session could not encode is
 * refused here instead of replacing the last good state. */
export function withSplitLeafView(split: SplitState, side: SplitSide, view: unknown): SplitState {
  if (!isSerializableViewState(view)) return split;
  const leaf = side === "first" ? split.first : split.second;
  return side === "first" ? { ...split, first: { ...leaf, view } } : { ...split, second: { ...leaf, view } };
}

/** A folder leaf keeps its own listing state, including sort. */
export function withSplitLeafFolder(split: SplitState, side: SplitSide, folder: FolderTabState): SplitState {
  const leaf = side === "first" ? split.first : split.second;
  const next: SplitLeaf = { ...leaf, folder: { ...folder, sort: { ...folder.sort } } };
  return side === "first" ? { ...split, first: next } : { ...split, second: next };
}

/** Save as in a leaf: only a disk source changes; the leaf identity and
 * its document reference stay. */
export function withSplitLeafPath(split: SplitState, side: SplitSide, path: string): SplitState {
  const leaf = side === "first" ? split.first : split.second;
  if (leaf.kind !== "file") return split;
  const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const next: SplitLeaf = { ...leaf, source: { kind: "disk", path }, title };
  return side === "first" ? { ...split, first: next } : { ...split, second: next };
}

/** The other tab that may join `tab` in a split, or null. A split never
 * moves a tab out of its group: both tabs must have the same membership,
 * because the outer tab is the one that keeps it (Step 09i D8). */
export function splitPartnerFor(tab: TabState, state: TabsState): TabState | null {
  try {
    assertSplittableTab(tab);
  } catch {
    return null;
  }
  const membership = tab.group_id ?? "";
  const eligible = state.tabs.filter((candidate) => {
    if (candidate.id === tab.id) return false;
    if ((candidate.group_id ?? "") !== membership) return false;
    try {
      assertSplittableTab(candidate);
    } catch {
      return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  for (const id of [...state.history].reverse()) {
    const candidate = eligible.find((entry) => entry.id === id);
    if (candidate) return candidate;
  }
  return eligible[0];
}

export function canSplitTab(tab: TabState, state: TabsState): boolean {
  return splitPartnerFor(tab, state) !== null;
}

export default function SplitTabView({
  tab,
  active,
  renderLeaf,
  onSplitChange,
  onCloseSide,
  onOpenHelp,
  onLeafCommand,
  confirmCloseLeaves,
}: SplitTabViewProps) {
  const split = tab.kind === "split" ? tab.split : undefined;
  if (!split) return null;
  const host = createSplitHost({
    renderLeaf: (leaf, leafActive, onFocus) => {
      const side = splitSideOf(split, leaf.view_id);
      return renderLeaf(leaf, side, active && leafActive, true, onFocus);
    },
    getScrollPort: (viewId) => resolveScrollSyncPort(viewId),
    dispatchToLeaf: (viewId, commandId, arg) => {
      // Only the active leaf receives routed commands (Decision 4). A
      // command for a background leaf is dropped instead of hitting the
      // last mounted editor.
      if (activeSplitViewId(tab) !== viewId) return;
      onLeafCommand(viewId, commandId, arg);
    },
    beginClose: (leaves) => confirmCloseLeaves(leaves),
  });
  return (
    <SplitView
      tab_id={tab.id}
      state={split}
      active={active}
      host={host}
      onChange={onSplitChange}
      onCloseSide={onCloseSide}
      onOpenHelp={onOpenHelp}
    />
  );
}
