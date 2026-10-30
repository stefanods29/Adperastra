/** Built-in themes (Step 05d). The colors live in themes/<id>.tokens.json. */
import type { ThemeId, ThemeSettings } from "../services/settings";

export type ThemeScheme = "light" | "dark";

export interface ThemeEntry {
  id: ThemeId;
  labelKey: string;
  scheme: ThemeScheme;
}

/** Every built-in theme, light themes first, in the Settings order. */
export const THEMES: readonly ThemeEntry[] = [
  { id: "light", labelKey: "themes.light", scheme: "light" },
  { id: "bright", labelKey: "themes.bright", scheme: "light" },
  { id: "paper", labelKey: "themes.paper", scheme: "light" },
  { id: "dark", labelKey: "themes.dark", scheme: "dark" },
  { id: "amoled", labelKey: "themes.amoled", scheme: "dark" },
  { id: "highContrast", labelKey: "themes.highContrast", scheme: "dark" },
];

/** The scheme a theme draws (never depends on Windows). */
export function themeScheme(id: ThemeId): ThemeScheme {
  return id === "light" || id === "bright" || id === "paper" ? "light" : "dark";
}

/** The theme the chosen mode uses; `system` follows Windows' light/dark. */
export function resolveThemeId(theme: ThemeSettings, systemDark: boolean): ThemeId {
  if (theme.mode === "light") return theme.light_theme;
  if (theme.mode === "dark") return theme.dark_theme;
  return systemDark ? theme.dark_theme : theme.light_theme;
}
