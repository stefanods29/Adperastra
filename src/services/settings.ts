import { invoke } from "@tauri-apps/api/core";
import type { GroupBy } from "./grouping";

export const SETTINGS_SCHEMA_VERSION = 3;
export const SETTINGS_STORAGE_KEY = "adperastra-settings";

export type LanguageSetting = "en" | "es" | "pseudo";
export type ThemeMode = "light" | "dark" | "system";
export type AccentSource = "design" | "windows" | "custom";

export interface ThemeSettings {
  mode: ThemeMode;
  accent_source: AccentSource;
  accent_custom: string | null;
}

/** Explorer view options (schema 3): the View menu's toggles and the Sort
 * menu's grouping. */
export interface ExplorerViewSettings {
  show_hidden: boolean;
  show_extensions: boolean;
  item_checkboxes: boolean;
  details_pane: boolean;
  group_by: GroupBy;
}

export interface AppSettings {
  schema_version: number;
  language: LanguageSetting;
  theme: ThemeSettings;
  explorer: ExplorerViewSettings;
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
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const accentCustom =
    typeof themeInput.accent_custom === "string" && HEX_COLOR_RE.test(themeInput.accent_custom)
      ? themeInput.accent_custom
      : null;

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