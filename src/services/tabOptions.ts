/** Tab options and file-change behavior (Step 10c T1/T2, tab-options-1).
 *
 * These are pure preferences and reducers. The permanent Explorer tab never
 * closes, pins or duplicates, and group/pinned boundaries are owned by the
 * 09a/09b reducers; the helpers below only choose a valid insertion point or
 * the next active tab.
 */
import type { TabState, TabsState } from "./tabs";
import type { TabGroup } from "./tabGroups";

export const TAB_WIDTH_MODES = ["compact", "fixed", "fit"] as const;
export type TabWidthMode = (typeof TAB_WIDTH_MODES)[number];

export const CLOSE_BUTTON_MODES = ["always", "hover"] as const;
export type CloseButtonMode = (typeof CLOSE_BUTTON_MODES)[number];

export const NEW_TAB_POSITIONS = ["end", "after_active"] as const;
export type NewTabPosition = (typeof NEW_TAB_POSITIONS)[number];

export const CLOSE_ACTIVATIONS = ["mru", "right"] as const;
export type CloseActivation = (typeof CLOSE_ACTIVATIONS)[number];

export const TAB_OVERFLOWS = ["scroll", "shrink"] as const;
export type TabOverflow = (typeof TAB_OVERFLOWS)[number];

export const TAB_WIDTH_FIXED_DEFAULT = 180;
export const TAB_WIDTH_FIXED_MIN = 100;
export const TAB_WIDTH_FIXED_MAX = 320;
export const TAB_ICON_SIZE_PX = 14;
export const TAB_WIDTH_COMPACT_LABEL_PX = 80;
/** Compact mode is the type icon plus an 80 px label area. */
export const TAB_WIDTH_COMPACT_PX = TAB_ICON_SIZE_PX + TAB_WIDTH_COMPACT_LABEL_PX;
export const TAB_WIDTH_FIT_MIN = 100;
export const TAB_WIDTH_FIT_MAX = 280;
export const TAB_WIDTH_SHRINK_MIN = 80;
export const HOVER_DELAY_DEFAULT = 500;
export const HOVER_DELAY_MIN = 300;
export const HOVER_DELAY_MAX = 2000;
export const TITLE_LIMIT_DEFAULT = 40;
export const TITLE_LIMIT_MIN = 12;
export const TITLE_LIMIT_MAX = 120;

export interface TabOptions {
  width_mode: TabWidthMode;
  fixed_width_px: number;
  close_button: CloseButtonMode;
  new_position: NewTabPosition;
  close_activation: CloseActivation;
  hover_preview: boolean;
  hover_delay_ms: number;
  type_icons: boolean;
  type_underline: boolean;
  title_limit: number;
  overflow: TabOverflow;
  double_click_new: boolean;
}

export function defaultTabOptions(): TabOptions {
  return {
    width_mode: "fixed",
    fixed_width_px: TAB_WIDTH_FIXED_DEFAULT,
    close_button: "always",
    new_position: "end",
    close_activation: "mru",
    hover_preview: false,
    hover_delay_ms: HOVER_DELAY_DEFAULT,
    type_icons: true,
    type_underline: true,
    title_limit: TITLE_LIMIT_DEFAULT,
    overflow: "scroll",
    double_click_new: true,
  };
}

export const OPEN_CLICKS = ["single", "double"] as const;
export type OpenClick = (typeof OPEN_CLICKS)[number];

export const CONFIRMATION_KEYS = ["recycle", "move", "rename", "convert", "clean", "save"] as const;
export type ConfirmationKey = (typeof CONFIRMATION_KEYS)[number];

export interface BehaviorSettings {
  open_click: OpenClick;
  confirm_changes: boolean;
  confirmations: Record<ConfirmationKey, boolean>;
}

export function defaultBehaviorSettings(): BehaviorSettings {
  return {
    open_click: "double",
    confirm_changes: false,
    confirmations: {
      recycle: false,
      move: false,
      rename: false,
      convert: false,
      clean: false,
      save: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

/** Repair a saved tab-options section field by field. */
export function normalizeTabOptions(value: unknown): TabOptions {
  const defaults = defaultTabOptions();
  const input = isRecord(value) ? value : {};
  return {
    width_mode: pick(input.width_mode, TAB_WIDTH_MODES, defaults.width_mode),
    fixed_width_px: clampInt(
      input.fixed_width_px,
      TAB_WIDTH_FIXED_MIN,
      TAB_WIDTH_FIXED_MAX,
      defaults.fixed_width_px,
    ),
    close_button: pick(input.close_button, CLOSE_BUTTON_MODES, defaults.close_button),
    new_position: pick(input.new_position, NEW_TAB_POSITIONS, defaults.new_position),
    close_activation: pick(input.close_activation, CLOSE_ACTIVATIONS, defaults.close_activation),
    hover_preview: flag(input.hover_preview, defaults.hover_preview),
    hover_delay_ms: clampInt(input.hover_delay_ms, HOVER_DELAY_MIN, HOVER_DELAY_MAX, defaults.hover_delay_ms),
    type_icons: flag(input.type_icons, defaults.type_icons),
    type_underline: flag(input.type_underline, defaults.type_underline),
    title_limit: clampInt(input.title_limit, TITLE_LIMIT_MIN, TITLE_LIMIT_MAX, defaults.title_limit),
    overflow: pick(input.overflow, TAB_OVERFLOWS, defaults.overflow),
    double_click_new: flag(input.double_click_new, defaults.double_click_new),
  };
}

export function validateTabOptions(value: unknown): string | null {
  if (!isRecord(value)) return "preferences.invalid_tabs";
  if (!TAB_WIDTH_MODES.includes(value.width_mode as TabWidthMode)) return "preferences.invalid_tabs";
  if (
    typeof value.fixed_width_px !== "number" ||
    !Number.isInteger(value.fixed_width_px) ||
    value.fixed_width_px < TAB_WIDTH_FIXED_MIN ||
    value.fixed_width_px > TAB_WIDTH_FIXED_MAX
  ) {
    return "preferences.invalid_tabs";
  }
  if (!CLOSE_BUTTON_MODES.includes(value.close_button as CloseButtonMode)) return "preferences.invalid_tabs";
  if (!NEW_TAB_POSITIONS.includes(value.new_position as NewTabPosition)) return "preferences.invalid_tabs";
  if (!CLOSE_ACTIVATIONS.includes(value.close_activation as CloseActivation)) return "preferences.invalid_tabs";
  if (typeof value.hover_preview !== "boolean") return "preferences.invalid_tabs";
  if (
    typeof value.hover_delay_ms !== "number" ||
    !Number.isInteger(value.hover_delay_ms) ||
    value.hover_delay_ms < HOVER_DELAY_MIN ||
    value.hover_delay_ms > HOVER_DELAY_MAX
  ) {
    return "preferences.invalid_tabs";
  }
  if (typeof value.type_icons !== "boolean" || typeof value.type_underline !== "boolean") {
    return "preferences.invalid_tabs";
  }
  if (
    typeof value.title_limit !== "number" ||
    !Number.isInteger(value.title_limit) ||
    value.title_limit < TITLE_LIMIT_MIN ||
    value.title_limit > TITLE_LIMIT_MAX
  ) {
    return "preferences.invalid_tabs";
  }
  if (!TAB_OVERFLOWS.includes(value.overflow as TabOverflow)) return "preferences.invalid_tabs";
  if (typeof value.double_click_new !== "boolean") return "preferences.invalid_tabs";
  return null;
}

/** Repair and validate the behavior section. */
export function normalizeBehaviorSettings(value: unknown): BehaviorSettings {
  const defaults = defaultBehaviorSettings();
  const input = isRecord(value) ? value : {};
  const confirmationsInput = isRecord(input.confirmations) ? input.confirmations : {};
  const confirmations = { ...defaults.confirmations };
  for (const key of CONFIRMATION_KEYS) {
    confirmations[key] = flag(confirmationsInput[key], defaults.confirmations[key]);
  }
  return {
    open_click: pick(input.open_click, OPEN_CLICKS, defaults.open_click),
    confirm_changes: flag(input.confirm_changes, defaults.confirm_changes),
    confirmations,
  };
}

export function validateBehaviorSettings(value: unknown): string | null {
  if (!isRecord(value)) return "preferences.invalid_format";
  if (!OPEN_CLICKS.includes(value.open_click as OpenClick)) return "preferences.invalid_format";
  if (typeof value.confirm_changes !== "boolean") return "preferences.invalid_format";
  if (!isRecord(value.confirmations)) return "preferences.invalid_format";
  for (const key of CONFIRMATION_KEYS) {
    if (typeof value.confirmations[key] !== "boolean") return "preferences.invalid_format";
  }
  return null;
}

/** The additive 09a/09b placement fields, read without replacing them. */
interface PlacementTab extends TabState {
  pinned?: boolean;
  group_id?: string;
}

interface PlacementTabsState extends TabsState {
  tabs: PlacementTab[];
  groups?: readonly TabGroup[];
}

function placement(state: TabsState): PlacementTabsState {
  return state as PlacementTabsState;
}

function groupOf(state: PlacementTabsState, groupId: string): TabGroup | undefined {
  return state.groups?.find((group) => group.id === groupId);
}

/**
 * Where a new ordinary tab goes. The permanent Explorer tab stays first;
 * `after_active` never splits a pinned segment or a tab group.
 */
export function insertTabIndex(state: TabsState, options: TabOptions): number {
  const placed = placement(state);
  const last = placed.tabs.length;
  if (options.new_position === "end") return last;

  const activeIndex = placed.tabs.findIndex((tab) => tab.id === state.activeId);
  if (activeIndex < 0) return last;
  const active = placed.tabs[activeIndex];

  if (active.kind === "explorer") {
    const lastPinned = placed.tabs.reduce(
      (found, tab, index) => (tab.pinned === true ? index : found),
      -1,
    );
    return Math.min(last, Math.max(1, lastPinned + 1));
  }
  if (active.pinned === true) {
    const lastPinned = placed.tabs.reduce(
      (found, tab, index) => (tab.pinned === true ? index : found),
      -1,
    );
    return Math.min(last, Math.max(1, lastPinned + 1));
  }
  if (typeof active.group_id === "string") {
    const group = groupOf(placed, active.group_id);
    if (group !== undefined) {
      const members = new Set(group.tab_ids);
      let lastMember = -1;
      placed.tabs.forEach((tab, index) => {
        if (members.has(tab.id)) lastMember = index;
      });
      if (lastMember >= 0) return Math.min(last, lastMember + 1);
    }
  }
  return Math.min(last, Math.max(1, activeIndex + 1));
}

/**
 * The tab that becomes active after `id` closes. `right` uses the next
 * visible tab and falls back to the most recently used one; `mru` always
 * uses the most recently used remaining tab.
 */
export function nextAfterClose(state: TabsState, id: string, options: TabOptions): string {
  if (id === "explorer" || !state.tabs.some((tab) => tab.id === id)) return state.activeId;
  if (state.activeId !== id) return state.activeId;
  const remaining = state.tabs.filter((tab) => tab.id !== id);
  if (remaining.length === 0) return "explorer";

  if (options.close_activation === "right") {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const right = state.tabs.slice(index + 1).find((tab) => tab.id !== id);
    if (right !== undefined) return right.id;
  }
  const previous = [...state.history]
    .reverse()
    .find((entry) => entry !== id && remaining.some((tab) => tab.id === entry));
  return previous ?? remaining[0]?.id ?? "explorer";
}
