import { invoke } from "@tauri-apps/api/core";
import type { GroupBy } from "./grouping";

export const SETTINGS_SCHEMA_VERSION = 9;
export const SETTINGS_STORAGE_KEY = "adperastra-settings";

export type LanguageSetting = "en" | "es" | "pseudo";
export type ThemeMode = "light" | "dark" | "system";
export type AccentSource = "design" | "windows" | "custom";

/** The built-in themes of light mode (schema 9, Step 05d). */
export type LightThemeId = "light" | "bright" | "paper";
/** The built-in themes of dark mode (schema 9, Step 05d). */
export type DarkThemeId = "dark" | "amoled" | "highContrast";
export type ThemeId = LightThemeId | DarkThemeId;

export const LIGHT_THEME_IDS: readonly LightThemeId[] = ["light", "bright", "paper"];
export const DARK_THEME_IDS: readonly DarkThemeId[] = ["dark", "amoled", "highContrast"];

export interface ThemeSettings {
  mode: ThemeMode;
  accent_source: AccentSource;
  accent_custom: string | null;
  /** The theme light mode uses (schema 9). */
  light_theme: LightThemeId;
  /** The theme dark mode uses (schema 9). */
  dark_theme: DarkThemeId;
}

/** How a folder shows its items (Step 05a D1), in Windows' View-menu order.
 * Step 05b D1 adds Column view as the ninth id. */
export type ViewModeId =
  | "extraLargeIcons"
  | "largeIcons"
  | "mediumIcons"
  | "smallIcons"
  | "list"
  | "details"
  | "tiles"
  | "content"
  | "columns";

/** Same ids and order as Rust `fs_service::VIEW_MODES`. */
export const VIEW_MODE_IDS: readonly ViewModeId[] = [
  "extraLargeIcons",
  "largeIcons",
  "mediumIcons",
  "smallIcons",
  "list",
  "details",
  "tiles",
  "content",
  "columns",
];

export function isViewModeId(value: unknown): value is ViewModeId {
  return typeof value === "string" && (VIEW_MODE_IDS as readonly string[]).includes(value);
}

/** All nine ids: the given order first, then the missing ids in default order. */
export function normalizeViewModeOrder(value: unknown): ViewModeId[] {
  if (!Array.isArray(value)) return [...VIEW_MODE_IDS];
  const result: ViewModeId[] = [];
  for (const entry of value) {
    if (isViewModeId(entry) && !result.includes(entry)) result.push(entry);
  }
  for (const id of VIEW_MODE_IDS) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

/** Valid hidden views, first occurrence only; `details` can never be hidden. */
export function normalizeHiddenViewModes(value: unknown): ViewModeId[] {
  if (!Array.isArray(value)) return [];
  const result: ViewModeId[] = [];
  for (const entry of value) {
    if (isViewModeId(entry) && entry !== "details" && !result.includes(entry)) result.push(entry);
  }
  return result;
}

/** Column view's standard column width in pixels (Step 05b D13). */
export const COLUMN_WIDTH_DEFAULT = 240;
/** Column view's narrowest column in pixels. */
export const COLUMN_WIDTH_MIN = 160;
/** Column view's widest column in pixels. */
export const COLUMN_WIDTH_MAX = 480;

export function clampColumnWidth(width: number): number {
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, Math.round(width)));
}

export function normalizeColumnWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clampColumnWidth(value) : COLUMN_WIDTH_DEFAULT;
}

/** Explorer view options (schema 3): the View menu's toggles and the Sort
 * menu's grouping. Schema 6 (Step 05a) adds the view mode, per-folder
 * memory, and the View menu's order and hidden views. Schema 7 (Step 05b)
 * adds the Column view's column width and preview column. */
export interface ExplorerViewSettings {
  show_hidden: boolean;
  show_extensions: boolean;
  item_checkboxes: boolean;
  details_pane: boolean;
  group_by: GroupBy;
  /** The view folders without their own use, and the default view. */
  view_mode: ViewModeId;
  /** Remember a view per folder when this is on. */
  remember_view_per_folder: boolean;
  /** The View menu's order: all nine ids, each once. */
  view_mode_order: ViewModeId[];
  /** Views left out of the View menu; never "details". */
  hidden_view_modes: ViewModeId[];
  /** Column view's column width in pixels (schema 7). */
  column_width: number;
  /** Column view shows a preview of the selected file (schema 7). */
  column_preview: boolean;
}

export type PasteImageFormat = "png" | "jpg";

/** File-operation choices (schema 4): what Paste as file saves images as. */
export interface FileSettings {
  paste_image_format: PasteImageFormat;
}

export type OpenWith = "builtin" | "windows";

/** How files open (schema 5, Step 04c): Settings > Opening files. */
export interface OpenSettings {
  /** Files from the internet open in protected view. */
  protected_view: boolean;
  /** Extension (lower case, no dot) to where it opens. An extension that
   * is not listed opens in the built-in viewer when there is one. */
  open_with: Record<string, OpenWith>;
}

/** Where the toolbar sits (schema 8, Step 05c). */
export type ToolbarPosition = "top" | "bottom" | "left" | "right";

/** How the toolbar is drawn (schema 8, Step 05c). */
export type ToolbarMode = "full" | "compact" | "iconsOnly" | "autoHide";

/** Where the tabs sit (schema 8, Step 05c). */
export type TabBarPosition = "top" | "bottom" | "left" | "right";

/** Where the navigation pane sits (schema 8, Step 05c). */
export type NavPanePosition = "left" | "right" | "hidden";

/** Where the Details pane sits, when it is shown (schema 8, Step 05c). */
export type DetailsPanePosition = "right" | "bottom";

/** The six layout values a preset stores (schema 8, Step 05c). */
export interface LayoutValues {
  toolbar_position: ToolbarPosition;
  toolbar_mode: ToolbarMode;
  tab_bar_position: TabBarPosition;
  tab_bar_collapsed: boolean;
  nav_pane_position: NavPanePosition;
  details_pane_position: DetailsPanePosition;
}

/** One saved layout preset (schema 8, Step 05c). */
export interface SavedLayout extends LayoutValues {
  name: string;
}

/** Where the toolbar, tabs and panes go (schema 8, Step 05c). The Details
 * pane's visibility stays `explorer.details_pane`. */
export interface LayoutSettings extends LayoutValues {
  saved_presets: SavedLayout[];
}

/** Every toolbar position, in the order the menu shows them. */
export const TOOLBAR_POSITIONS: readonly ToolbarPosition[] = ["top", "bottom", "left", "right"];
/** Every toolbar look, in the order the menu shows them. */
export const TOOLBAR_MODES: readonly ToolbarMode[] = ["full", "compact", "iconsOnly", "autoHide"];
/** Every navigation pane position. */
export const NAV_PANE_POSITIONS: readonly NavPanePosition[] = ["left", "right", "hidden"];
/** Every Details pane position. */
export const DETAILS_PANE_POSITIONS: readonly DetailsPanePosition[] = ["right", "bottom"];
/** Most saved layout presets (Step 05c). */
export const MAX_SAVED_LAYOUTS = 20;
/** Longest saved layout preset name, in characters (Step 05c). */
export const MAX_LAYOUT_NAME = 60;

/** The layout section's defaults, before any saved preset. */
const LAYOUT_DEFAULTS: LayoutValues = {
  toolbar_position: "top",
  toolbar_mode: "full",
  tab_bar_position: "top",
  tab_bar_collapsed: false,
  nav_pane_position: "left",
  details_pane_position: "right",
};

/** The webview's page zoom, in percent (schema 9, Step 05d). */
export type UiScale = number;
/** Every UI scale, in the order the settings select shows them. */
export const UI_SCALES: readonly UiScale[] = [75, 90, 100, 110, 125, 150, 175, 200];

/** How much space the app leaves around things (schema 9, Step 05d). */
export type Density = "compact" | "comfortable" | "spacious";
export const DENSITIES: readonly Density[] = ["compact", "comfortable", "spacious"];

/** How round the corners are (schema 9, Step 05d). */
export type CornerRadius = "square" | "standard" | "round";
export const CORNER_RADII: readonly CornerRadius[] = ["square", "standard", "round"];

/** How much motion the app shows (schema 9, Step 05d). */
export type AnimationLevel = "full" | "reduced" | "off";
export const ANIMATION_LEVELS: readonly AnimationLevel[] = ["full", "reduced", "off"];

/** UI scale, density, corner radius and animations (schema 9, Step 05d). */
export interface AppearanceSettings {
  ui_scale: UiScale;
  density: Density;
  corner_radius: CornerRadius;
  animations: AnimationLevel;
}

export interface AppSettings {
  schema_version: number;
  language: LanguageSetting;
  theme: ThemeSettings;
  explorer: ExplorerViewSettings;
  files: FileSettings;
  open: OpenSettings;
  layout: LayoutSettings;
  appearance: AppearanceSettings;
}

const LANGUAGES: readonly LanguageSetting[] = ["en", "es", "pseudo"];
const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];
const ACCENT_SOURCES: readonly AccentSource[] = ["design", "windows", "custom"];
const GROUP_BY: readonly GroupBy[] = ["none", "name", "modified", "type", "size"];
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultSettings(): AppSettings {
  return {
    schema_version: SETTINGS_SCHEMA_VERSION,
    language: "en",
    theme: {
      mode: "system",
      accent_source: "design",
      accent_custom: null,
      light_theme: "light",
      dark_theme: "dark",
    },
    explorer: {
      show_hidden: false,
      show_extensions: true,
      item_checkboxes: false,
      details_pane: false,
      group_by: "none",
      view_mode: "details",
      remember_view_per_folder: true,
      view_mode_order: [...VIEW_MODE_IDS],
      hidden_view_modes: [],
      column_width: COLUMN_WIDTH_DEFAULT,
      column_preview: true,
    },
    files: {
      paste_image_format: "png",
    },
    open: {
      protected_view: true,
      open_with: {},
    },
    layout: {
      ...LAYOUT_DEFAULTS,
      saved_presets: [],
    },
    appearance: {
      ui_scale: 100,
      density: "comfortable",
      corner_radius: "standard",
      animations: "full",
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

/** Same rule as Rust `is_valid_extension_key`. */
const EXTENSION_KEY_RE = /^[a-z0-9_+-]{1,16}$/;
/** Same limit as Rust `MAX_OPEN_WITH`. */
export const MAX_OPEN_WITH = 500;

/** Keep only valid `open_with` entries, at most `MAX_OPEN_WITH`. */
function normalizeOpenWith(value: unknown): Record<string, OpenWith> {
  const result: Record<string, OpenWith> = {};
  if (!isRecord(value)) return result;
  let count = 0;
  for (const [ext, choice] of Object.entries(value)) {
    if (count >= MAX_OPEN_WITH) break;
    if (EXTENSION_KEY_RE.test(ext) && (choice === "builtin" || choice === "windows")) {
      result[ext] = choice;
      count += 1;
    }
  }
  return result;
}

/** The first `MAX_LAYOUT_NAME` code points of a name, trimmed at both ends. */
function layoutName(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_LAYOUT_NAME).join("").trim();
}

/** The layout section, repaired field by field (schema 8, Step 05c). */
function normalizeLayout(value: unknown): LayoutSettings {
  const input = isRecord(value) ? value : {};
  const values: LayoutValues = {
    toolbar_position: pick(input.toolbar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.toolbar_position),
    toolbar_mode: pick(input.toolbar_mode, TOOLBAR_MODES, LAYOUT_DEFAULTS.toolbar_mode),
    tab_bar_position: pick(input.tab_bar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.tab_bar_position),
    tab_bar_collapsed: typeof input.tab_bar_collapsed === "boolean" ? input.tab_bar_collapsed : LAYOUT_DEFAULTS.tab_bar_collapsed,
    nav_pane_position: pick(input.nav_pane_position, NAV_PANE_POSITIONS, LAYOUT_DEFAULTS.nav_pane_position),
    details_pane_position: pick(input.details_pane_position, DETAILS_PANE_POSITIONS, LAYOUT_DEFAULTS.details_pane_position),
  };
  const savedPresets: SavedLayout[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.saved_presets)) {
    for (const entry of input.saved_presets) {
      if (savedPresets.length >= MAX_SAVED_LAYOUTS) break;
      if (!isRecord(entry) || typeof entry.name !== "string") continue;
      const name = layoutName(entry.name);
      if (name === "") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      savedPresets.push({
        name,
        toolbar_position: pick(entry.toolbar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.toolbar_position),
        toolbar_mode: pick(entry.toolbar_mode, TOOLBAR_MODES, LAYOUT_DEFAULTS.toolbar_mode),
        tab_bar_position: pick(entry.tab_bar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.tab_bar_position),
        tab_bar_collapsed: typeof entry.tab_bar_collapsed === "boolean" ? entry.tab_bar_collapsed : LAYOUT_DEFAULTS.tab_bar_collapsed,
        nav_pane_position: pick(entry.nav_pane_position, NAV_PANE_POSITIONS, LAYOUT_DEFAULTS.nav_pane_position),
        details_pane_position: pick(entry.details_pane_position, DETAILS_PANE_POSITIONS, LAYOUT_DEFAULTS.details_pane_position),
      });
    }
  }
  return { ...values, saved_presets: savedPresets };
}

/** Pure: every field falls back independently when missing or invalid. */
export function normalizeSettings(input: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!isRecord(input)) return defaults;

  const schemaVersion =
    typeof input.schema_version === "number" &&
    Number.isInteger(input.schema_version) &&
    input.schema_version >= 1
      ? input.schema_version
      : defaults.schema_version;

  const themeInput = isRecord(input.theme) ? input.theme : {};
  const explorerInput = isRecord(input.explorer) ? input.explorer : {};
  const filesInput = isRecord(input.files) ? input.files : {};
  const openInput = isRecord(input.open) ? input.open : {};
  const appearanceInput = isRecord(input.appearance) ? input.appearance : {};
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const accentCustom =
    typeof themeInput.accent_custom === "string" && HEX_COLOR_RE.test(themeInput.accent_custom)
      ? themeInput.accent_custom
      : null;
  const hiddenViewModes = normalizeHiddenViewModes(explorerInput.hidden_view_modes);
  const viewModeCandidate = isViewModeId(explorerInput.view_mode)
    ? explorerInput.view_mode
    : defaults.explorer.view_mode;
  const viewMode = hiddenViewModes.includes(viewModeCandidate) ? "details" : viewModeCandidate;

  return {
    schema_version: schemaVersion,
    language: pick(input.language, LANGUAGES, defaults.language),
    theme: {
      mode: pick(themeInput.mode, THEME_MODES, defaults.theme.mode),
      accent_source: pick(themeInput.accent_source, ACCENT_SOURCES, defaults.theme.accent_source),
      accent_custom: accentCustom,
      light_theme: pick(themeInput.light_theme, LIGHT_THEME_IDS, defaults.theme.light_theme),
      dark_theme: pick(themeInput.dark_theme, DARK_THEME_IDS, defaults.theme.dark_theme),
    },
    explorer: {
      show_hidden: flag(explorerInput.show_hidden, defaults.explorer.show_hidden),
      show_extensions: flag(explorerInput.show_extensions, defaults.explorer.show_extensions),
      item_checkboxes: flag(explorerInput.item_checkboxes, defaults.explorer.item_checkboxes),
      details_pane: flag(explorerInput.details_pane, defaults.explorer.details_pane),
      group_by: pick(explorerInput.group_by, GROUP_BY, defaults.explorer.group_by),
      view_mode: viewMode,
      remember_view_per_folder: flag(explorerInput.remember_view_per_folder, defaults.explorer.remember_view_per_folder),
      view_mode_order: normalizeViewModeOrder(explorerInput.view_mode_order),
      hidden_view_modes: hiddenViewModes,
      column_width: normalizeColumnWidth(explorerInput.column_width),
      column_preview: flag(explorerInput.column_preview, defaults.explorer.column_preview),
    },
    files: {
      paste_image_format: pick(filesInput.paste_image_format, ["png", "jpg"] as const, defaults.files.paste_image_format),
    },
    open: {
      protected_view: flag(openInput.protected_view, defaults.open.protected_view),
      open_with: normalizeOpenWith(openInput.open_with),
    },
    layout: normalizeLayout(input.layout),
    appearance: {
      ui_scale:
        typeof appearanceInput.ui_scale === "number" &&
        (UI_SCALES as readonly number[]).includes(appearanceInput.ui_scale)
          ? appearanceInput.ui_scale
          : defaults.appearance.ui_scale,
      density: pick(appearanceInput.density, DENSITIES, defaults.appearance.density),
      corner_radius: pick(appearanceInput.corner_radius, CORNER_RADII, defaults.appearance.corner_radius),
      animations: pick(appearanceInput.animations, ANIMATION_LEVELS, defaults.appearance.animations),
    },
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<AppSettings> {
  if (isTauriRuntime()) {
    try {
      return normalizeSettings(await invoke<unknown>("get_settings"));
    } catch {
      return defaultSettings();
    }
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  if (isTauriRuntime()) {
    await invoke("save_settings", { settings: normalized });
    return normalized;
  }
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable (private mode, quota); settings stay in memory for callers.
  }
  return normalized;
}