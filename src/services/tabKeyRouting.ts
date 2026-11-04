import { EXPLORER_TAB, type TabState, type TabsState } from "./tabs";
import { mruCycleTarget } from "./tabActions";

/** Tab keyboard routing (Step 09a D4/T6). One router decides what a key
 * means for the tab strip; views and the future remapping step extend
 * this context instead of adding competing listeners. */

export interface TabKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface TabKeyContext {
  /** Focus is in a search box that uses Ctrl+Tab for its own mode cycling
   * (Step 11a): the tab router must not switch tabs. */
  searchFocused: boolean;
  /** Focus is in a text editor: tab shortcuts belong to the editor. */
  textEditing: boolean;
}

export type TabKeyAction =
  | { type: "activate"; id: string }
  | { type: "close"; id: string }
  | { type: "reopenClosed" }
  | { type: "none" };

const NONE: TabKeyAction = { type: "none" };

/** Resolve one key press. Visible order (not MRU) drives Ctrl+1..9:
 * positions 1-8 target the tab at that position, Ctrl+9 always targets
 * the last tab. Ctrl+Tab cycles in MRU order without reordering the
 * visible list. */
export function resolveTabKey(event: TabKeyEvent, state: TabsState, context: TabKeyContext): TabKeyAction {
  if (context.textEditing || event.altKey || event.metaKey) return NONE;
  if (!event.ctrlKey) return NONE;
  const tabs: readonly TabState[] = state.tabs;
  if (tabs.length === 0) return NONE;

  if (event.key === "Tab") {
    if (context.searchFocused) return NONE;
    const target = mruCycleTarget(state, event.shiftKey ? -1 : 1);
    return target ? { type: "activate", id: target } : NONE;
  }
  if (event.shiftKey && (event.key === "T" || event.key === "t")) return { type: "reopenClosed" };
  if (event.key === "9") {
    const last = tabs[tabs.length - 1];
    return last ? { type: "activate", id: last.id } : NONE;
  }
  if (/^[1-8]$/.test(event.key)) {
    const tab = tabs[Number(event.key) - 1];
    return tab ? { type: "activate", id: tab.id } : NONE;
  }
  if (event.key === "w" || event.key === "W") {
    if (state.activeId === EXPLORER_TAB.id) return NONE;
    return { type: "close", id: state.activeId };
  }
  return NONE;
}
