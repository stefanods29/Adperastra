/** Layout presets (Step 05c, contract 17). Pure. */
import {
  MAX_LAYOUT_NAME,
  MAX_SAVED_LAYOUTS,
  type LayoutSettings,
  type LayoutValues,
  type SavedLayout,
} from "../services/settings";

/** The ready-made presets; the app never stores their values. */
export type BuiltInPresetId = "standard" | "minimal" | "classic";

/** The ready-made presets in the order the menus list them. */
export const BUILT_IN_PRESET_IDS: readonly BuiltInPresetId[] = ["standard", "minimal", "classic"];

/** The six layout values of each ready-made preset. */
export const BUILT_IN_PRESETS: Record<BuiltInPresetId, LayoutValues> = {
  standard: {
    toolbar_position: "top",
    toolbar_mode: "full",
    tab_bar_position: "top",
    tab_bar_collapsed: false,
    nav_pane_position: "left",
    details_pane_position: "right",
  },
  minimal: {
    toolbar_position: "top",
    toolbar_mode: "iconsOnly",
    tab_bar_position: "top",
    tab_bar_collapsed: false,
    nav_pane_position: "hidden",
    details_pane_position: "right",
  },
  classic: {
    toolbar_position: "top",
    toolbar_mode: "compact",
    tab_bar_position: "bottom",
    tab_bar_collapsed: false,
    nav_pane_position: "left",
    details_pane_position: "right",
  },
};

/** The translation key of each ready-made preset's name. */
export const PRESET_LABEL_KEYS: Record<BuiltInPresetId, string> = {
  standard: "commands.presetStandard",
  minimal: "commands.presetMinimal",
  classic: "commands.presetClassic",
};

/** Which preset the current layout matches, if any. */
export type PresetMatch = { kind: "builtIn"; id: BuiltInPresetId } | { kind: "saved"; index: number };

/** Why a typed preset name cannot be saved, if it cannot. */
export type PresetNameError = "full" | "empty" | "tooLong" | "duplicate";

const LAYOUT_FIELDS = [
  "toolbar_position",
  "toolbar_mode",
  "tab_bar_position",
  "tab_bar_collapsed",
  "nav_pane_position",
  "details_pane_position",
] as const;

/** The six layout values of a layout, without its saved presets. */
export function layoutValues(layout: LayoutValues): LayoutValues {
  return {
    toolbar_position: layout.toolbar_position,
    toolbar_mode: layout.toolbar_mode,
    tab_bar_position: layout.tab_bar_position,
    tab_bar_collapsed: layout.tab_bar_collapsed,
    nav_pane_position: layout.nav_pane_position,
    details_pane_position: layout.details_pane_position,
  };
}

/** True when two layouts place everything in the same way. */
export function sameLayout(a: LayoutValues, b: LayoutValues): boolean {
  return LAYOUT_FIELDS.every((field) => a[field] === b[field]);
}

/** The first matching preset: the ready-made ones in order, then the saved
 * ones in their order. */
export function matchingPreset(layout: LayoutSettings): PresetMatch | null {
  for (const id of BUILT_IN_PRESET_IDS) {
    if (sameLayout(BUILT_IN_PRESETS[id], layout)) return { kind: "builtIn", id };
  }
  const index = layout.saved_presets.findIndex((preset) => sameLayout(preset, layout));
  return index === -1 ? null : { kind: "saved", index };
}

/** The layout moved to the given values, keeping the saved presets. */
export function applyLayoutValues(layout: LayoutSettings, values: LayoutValues): LayoutSettings {
  return { ...layout, ...layoutValues(values) };
}

/** Why `name` cannot be saved, or null when it can. */
export function presetNameError(name: string, layout: LayoutSettings): PresetNameError | null {
  if (layout.saved_presets.length >= MAX_SAVED_LAYOUTS) return "full";
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (Array.from(trimmed).length > MAX_LAYOUT_NAME) return "tooLong";
  const lower = trimmed.toLowerCase();
  if (layout.saved_presets.some((preset) => preset.name.toLowerCase() === lower)) return "duplicate";
  return null;
}

/** The layout with the current values saved under `name`, at the end of the
 * list; the layout itself when the name cannot be used. */
export function withSavedPreset(layout: LayoutSettings, name: string): LayoutSettings {
  if (presetNameError(name, layout) !== null) return layout;
  const preset: SavedLayout = { name: name.trim(), ...layoutValues(layout) };
  return { ...layout, saved_presets: [...layout.saved_presets, preset] };
}

/** The layout without the saved preset at `index`; an unchanged copy when
 * there is none. */
export function withoutSavedPreset(layout: LayoutSettings, index: number): LayoutSettings {
  return { ...layout, saved_presets: layout.saved_presets.filter((_, at) => at !== index) };
}
