import { invoke } from "@tauri-apps/api/core";
import type { GroupBy } from "./grouping";

export const SETTINGS_SCHEMA_VERSION = 6;
export const SETTINGS_STORAGE_KEY = "adperastra-settings";

export type LanguageSetting = "en" | "es" | "pseudo";
export type ThemeMode = "light" | "dark" | "system";
export type AccentSource = "design" | "windows" | "custom";

export interface ThemeSettings {
  mode: ThemeMode;
  accent_source: AccentSource;
  accent_custom: string | null;
}

/** How a folder shows its items (Step 05a D1), in Windows' View-menu order. */
export type ViewModeId =
  | "extraLargeIcons"
  | "largeIcons"
  | "mediumIcons"
  | "smallIcons"
  | "list"
  | "details"
  | "tiles"
  | "content";

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
];

export function isViewModeId(value: unknown): value is ViewModeId {
  return typeof value === "string" && (VIEW_MODE_IDS as readonly string[]).includes(value);
}

/** All eight ids: the given order first, then the missing ids in default order. */
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

/** Explorer view options (schema 3): the View menu's toggles and the Sort
 * menu's grouping. Schema 6 (Step 05a) adds the view mode, per-folder
 * memory, and the View menu's order and hidden views. */
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
  /** The View menu's order: all eight ids, each once. */
  view_mode_order: ViewModeId[];
  /** Views left out of the View menu; never "details". */
  hidden_view_modes: ViewModeId[];
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

export interface AppSettings {
  schema_version: number;
  language: LanguageSetting;
  theme: ThemeSettings;
  explorer: ExplorerViewSettings;
  files: FileSettings;
  open: OpenSettings;
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
    },
    files: {
      paste_image_format: "png",
    },
    open: {
      protected_view: true,
      open_with: {},
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
    },
    files: {
      paste_image_format: pick(filesInput.paste_image_format, ["png", "jpg"] as const, defaults.files.paste_image_format),
    },
    open: {
      protected_view: flag(openInput.protected_view, defaults.open.protected_view),
      open_with: normalizeOpenWith(openInput.open_with),
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