/** Pure tab-option reducers used by the 09a tab host (Step 10c T2).
 *
 * `insertTabIndex` and `nextAfterClose` are the canonical E2 exports in
 * `tabOptions.ts`; this module re-exports them and adds the small pure
 * helpers the tab strip needs for placement, widths and labels.
 */
import { EXPLORER_TAB, type TabState, type TabsState } from "./tabs";
import {
  insertTabIndex,
  nextAfterClose,
  TAB_WIDTH_COMPACT_PX,
  TAB_WIDTH_FIT_MAX,
  TAB_WIDTH_FIT_MIN,
  TAB_WIDTH_SHRINK_MIN,
  type TabOptions,
} from "./tabOptions";
import { titleWithFullName } from "./displayFormats";

export { insertTabIndex, nextAfterClose };

/** Insert a tab at `index`, never before the permanent Explorer tab. */
export function insertTabAt(state: TabsState, tab: TabState, index: number): TabsState {
  const target = Math.max(1, Math.min(state.tabs.length, Math.trunc(index)));
  const tabs = [...state.tabs.slice(0, target), tab, ...state.tabs.slice(target)];
  return { ...state, tabs };
}

/** Close with the configured activation rule; the permanent tab is fixed. */
export function closeTabWithOptions(state: TabsState, id: string, options: TabOptions): TabsState {
  if (id === EXPLORER_TAB.id || !state.tabs.some((tab) => tab.id === id)) return state;
  const nextId = nextAfterClose(state, id, options);
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  if (state.activeId !== id) return { ...state, tabs, history };
  const activeId = tabs.some((tab) => tab.id === nextId) ? nextId : EXPLORER_TAB.id;
  const nextHistory = [...history.filter((entry) => entry !== activeId), activeId].slice(-50);
  return { tabs, activeId, history: nextHistory };
}

export interface TabTitlePresentation {
  /** The short text drawn in the tab. */
  visible: string;
  /** The full name for `aria-label` and the tooltip. */
  full: string;
}

/** Shorten a tab title for display, keeping the real name everywhere else. */
export function tabTitlePresentation(fullName: string, options: TabOptions): TabTitlePresentation {
  return titleWithFullName(fullName, options.title_limit);
}

/** The width of one tab in pixels for the current mode and space. */
export function tabWidthPx(options: TabOptions, availablePx: number, tabCount: number): number {
  const count = Math.max(1, tabCount);
  if (options.width_mode === "compact") {
    return TAB_WIDTH_COMPACT_PX;
  }
  if (options.width_mode === "fit") {
    const fitted = Math.floor(Math.max(0, availablePx) / count);
    return Math.max(TAB_WIDTH_FIT_MIN, Math.min(TAB_WIDTH_FIT_MAX, fitted));
  }
  if (options.overflow === "shrink") {
    const fitted = Math.floor(Math.max(0, availablePx) / count);
    return Math.max(TAB_WIDTH_SHRINK_MIN, Math.min(options.fixed_width_px, fitted));
  }
  return options.fixed_width_px;
}

/** Whether a tab shows its close button for the current pointer/focus state. */
export function closeButtonShown(options: TabOptions, hovered: boolean, focused: boolean): boolean {
  return options.close_button === "always" || hovered || focused;
}
