import type { ReactNode } from "react";
import { MAX_SPLIT_LEAVES, type SplitLeaf, type SplitSide, type SplitState } from "../../services/splitViews";
import type { ScrollSyncPort } from "./scrollSync";

/** What a split view is allowed to ask the application for (Step 09i,
 * `SplitHost` in the Data table). This is trusted app composition, never
 * data from a file: `renderLeaf` draws the leaf's presentation view for the
 * coordinator's existing FileTabView/FolderTabView, `dispatchToLeaf` runs a
 * command against exactly that leaf's context, and `beginClose` is the
 * 09a/06a dirty decision for the leaves that would lose their last view. */

export interface SplitHost {
  renderLeaf(leaf: SplitLeaf, active: boolean, onFocus: () => void): ReactNode;
  getScrollPort(viewId: string): ScrollSyncPort | null;
  dispatchToLeaf(viewId: string, commandId: string, arg?: string): void;
  beginClose(leaves: readonly SplitLeaf[]): Promise<boolean>;
}

export type SplitHostParts = SplitHost;

const COMMAND_ID = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

/** Build the host from explicit application callbacks. There are no
 * defaults: a missing callback must fail loudly here instead of silently
 * looking like a working split (no fake success, no fake close). */
export function createSplitHost(parts: SplitHostParts): SplitHost {
  for (const name of ["renderLeaf", "getScrollPort", "dispatchToLeaf", "beginClose"] as const) {
    if (typeof parts[name] !== "function") throw new Error("splits.invalid");
  }
  return {
    renderLeaf: parts.renderLeaf,
    getScrollPort(viewId) {
      const port = parts.getScrollPort(viewId);
      // A port registered for another view must never drive this leaf.
      return port && port.view_id === viewId ? port : null;
    },
    dispatchToLeaf(viewId, commandId, arg) {
      if (!viewId || !COMMAND_ID.test(commandId)) throw new Error("splits.invalid");
      parts.dispatchToLeaf(viewId, commandId, arg);
    },
    async beginClose(leaves) {
      if (leaves.length === 0 || leaves.length > MAX_SPLIT_LEAVES) return false;
      try {
        return (await parts.beginClose(leaves)) === true;
      } catch {
        // A failing close plan closes nothing (Step 09a E11).
        return false;
      }
    },
  };
}

/** Where F6 goes from a side (Decision 4): Side 1 -> Side 2 -> the next
 * application region (the toolbar). The split view owns the first step;
 * the app router owns the step after it. */
export type SplitFocusRoute = SplitSide | "after";

export function splitFocusRoute(side: SplitSide): SplitFocusRoute {
  return side === "first" ? "second" : "after";
}

/** The whole-tab close path (Ctrl+W, the tab's close button, a group
 * close): one close decision covering both leaves, taken before anything
 * is removed. `beginClose` is false for a cancelled plan, so nothing
 * closes. */
export async function beginCloseWholeSplit(host: SplitHost, state: SplitState): Promise<boolean> {
  const leaves = [state.first, state.second];
  return host.beginClose(leaves);
}
