/** Resolves day/night custom appearances and applies safe theme data.
 *
 * The built-in `themes.ts` functions stay unchanged: `ThemeId` never grows a
 * custom id. A `ThemeRef` is either a built-in `ThemeId` or a custom UUID.
 */
import {
  defaultThemeCustomSettings,
  type CustomTheme,
  type ThemeColor,
  type ThemeCustomSettings,
  type ThemeMaterial,
  type ThemeRef,
  type ThemeRuntime,
  themeStyleCss,
} from "../services/customThemes";
import type { ThemeEntry, ThemeScheme } from "./themes";
import {
  accentMeetsContrast,
  contrastRatio,
  CONTRAST_NORMAL_TEXT,
  resolveReadableAccent,
  scheduleScheme,
} from "./themeMath";
import {
  defaultThemeTokens,
  normalizeThemeColor,
  THEME_EDITOR_TOKEN_PATHS,
  THEME_TOKEN_PATHS,
  themeTokenCss,
  themeVariableName,
} from "./themeTokens";

export interface ThemeResolutionInput {
  settings: ThemeCustomSettings;
  builtins: readonly ThemeEntry[];
  custom: readonly CustomTheme[];
  systemDark: boolean;
  localMinute: number;
  override?: ThemeScheme | null;
}

export interface MaterialResolution {
  requested: ThemeMaterial;
  applied: ThemeMaterial;
  fallback: boolean;
}

/** True when the WebView2 host reports a native material backend. */
export function supportsNativeMaterial(): boolean {
  if (typeof document === "undefined") return false;
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(forced-colors: active)").matches
  ) {
    return false;
  }
  const support = document.documentElement.dataset.materialSupport;
  return support === "mica" || support === "acrylic";
}

export function resolveMaterial(requested: ThemeMaterial): MaterialResolution {
  const applied = requested === "solid" || supportsNativeMaterial() ? requested : "solid";
  return { requested, applied, fallback: applied !== requested };
}

function builtinForScheme(builtins: readonly ThemeEntry[], scheme: ThemeScheme): ThemeEntry | undefined {
  return builtins.find((entry) => entry.scheme === scheme) ?? builtins[0];
}

function refScheme(ref: ThemeRef, builtins: readonly ThemeEntry[], custom: readonly CustomTheme[]): ThemeScheme {
  if (ref.kind === "builtin") return builtins.find((entry) => entry.id === ref.id)?.scheme ?? "light";
  return custom.find((theme) => theme.id === ref.id)?.scheme ?? "light";
}

function refMatches(a: ThemeRef, b: ThemeRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Which slot (day or night) the chosen mode and clock select. */
export function selectedSlot(
  settings: ThemeCustomSettings,
  systemDark: boolean,
  localMinute: number,
): ThemeScheme {
  if (settings.mode === "manual") return settings.manual_scheme;
  if (settings.mode === "clock") {
    return scheduleScheme(localMinute, settings.day_start_minute, settings.night_start_minute);
  }
  return systemDark ? "dark" : "light";
}

export function resolveTheme(
  inputSettings: ThemeCustomSettings,
  builtins: readonly ThemeEntry[],
  customThemes: readonly CustomTheme[],
  systemDark: boolean,
  localMinute: number,
  override: ThemeScheme | null = null,
): ThemeRuntime {
  const settings = inputSettings ?? defaultThemeCustomSettings();
  const baseScheme = selectedSlot(settings, systemDark, localMinute);
  const scheme = override ?? baseScheme;
  const requested = scheme === "light" ? settings.day : settings.night;
  const warnings: string[] = [];
  let applied = requested;
  let appliedScheme = refScheme(requested, builtins, customThemes);

  if (requested.kind === "custom") {
    const theme = customThemes.find((entry) => entry.id === requested.id);
    if (!theme) {
      const fallback = builtinForScheme(builtins, scheme);
      if (fallback) {
        applied = { kind: "builtin", id: fallback.id };
        appliedScheme = fallback.scheme;
      }
      warnings.push("theme.missing_custom");
    }
  } else if (!builtins.some((entry) => entry.id === requested.id)) {
    const fallback = builtinForScheme(builtins, scheme);
    if (fallback) {
      applied = { kind: "builtin", id: fallback.id };
      appliedScheme = fallback.scheme;
    }
    warnings.push("theme.missing_builtin");
  }

  const custom = applied.kind === "custom" ? customThemes.find((entry) => entry.id === applied.id) : undefined;
  const material = resolveMaterial(custom?.material ?? "solid");
  if (material.fallback) warnings.push("theme.unavailable");

  return {
    requested,
    applied,
    scheme: appliedScheme,
    material_requested: material.requested,
    material_applied: material.applied,
    temporary_override: override !== null && override !== baseScheme,
    warning_codes: [...new Set(warnings)].slice(0, 16),
  };
}

/** The token colour, else the built-in snapshot colour, else a safe value.
 * Missing tokens are rendered from the same built-in snapshot that
 * `applyCustomThemeAttributes` uses, so contrast checks see exactly the
 * colours the preview and the root will show. */
export function themeTokenColor(theme: CustomTheme, path: string): ThemeColor {
  const value = theme.tokens[path] ?? defaultThemeTokens(theme.scheme)[path];
  if (typeof value === "string") return normalizeThemeColor(value) ?? "#000000";
  return path.startsWith("color.text") ? (theme.scheme === "dark" ? "#F3F3F3" : "#202020") : "#808080";
}

const TEXT_SURFACE_PAIRS: readonly (readonly [string, string, number])[] = [
  ["color.text.primary", "color.surface.window", CONTRAST_NORMAL_TEXT],
  ["color.text.primary", "color.surface.selectedRow", CONTRAST_NORMAL_TEXT],
  ["color.text.secondary", "color.surface.window", CONTRAST_NORMAL_TEXT],
  ["color.text.bodyMuted", "color.surface.window", CONTRAST_NORMAL_TEXT],
  ["color.text.onAccent", "color.accent.explorer", CONTRAST_NORMAL_TEXT],
  ["color.accent.explorer", "color.surface.window", 3],
];

/** Contrast problems in the effective tokens (missing values use the built-in
 * snapshot); an empty list allows Save. */
export function customThemeContrastProblems(theme: CustomTheme): string[] {
  const problems: string[] = [];
  for (const [foreground, background, minimum] of TEXT_SURFACE_PAIRS) {
    const ratio = contrastRatio(themeTokenColor(theme, foreground), themeTokenColor(theme, background));
    if (ratio + 1e-9 < minimum) problems.push(`${foreground}/${background}`);
  }
  return problems;
}

/** The readable accent for a draft, with an honest fallback flag. */
export function readableCustomAccent(theme: CustomTheme): { color: ThemeColor; adjusted: boolean } {
  const candidate = themeTokenColor(theme, "color.accent.explorer");
  const backgrounds = [
    themeTokenColor(theme, "color.surface.window"),
    themeTokenColor(theme, "color.surface.chrome"),
  ];
  const resolved = resolveReadableAccent(candidate, backgrounds);
  if (!accentMeetsContrast(resolved.accent, backgrounds)) {
    return { color: theme.scheme === "dark" ? "#4CC2FF" : "#0067C0", adjusted: false };
  }
  return { color: resolved.accent, adjusted: resolved.adjusted };
}

export function fontFamilyCss(font: string): string {
  if (font === "system-ui") return "system-ui, sans-serif";
  if (font === "Inter") return "Inter, system-ui, sans-serif";
  return `"${font.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}", system-ui, sans-serif`;
}

/** Trusted CSS text generated only from validated style rows. */
export function customThemeCss(theme: CustomTheme, scope = ""): string {
  return themeStyleCss(theme, scope);
}

interface CustomLayerSnapshot {
  theme?: string;
  scheme?: string;
  tabShape?: string;
  iconMode?: string;
  colorScheme: string;
  accentCurrent: string;
}

/** What the element showed before the custom layer, per element. */
const CUSTOM_LAYER = new WeakMap<HTMLElement, CustomLayerSnapshot>();

function restoreData(root: HTMLElement, key: "theme" | "scheme" | "tabShape" | "iconMode", value?: string): void {
  if (value === undefined) delete root.dataset[key];
  else root.dataset[key] = value;
}

function restoreInline(root: HTMLElement, property: string, value: string): void {
  if (value === "") root.style.removeProperty(property);
  else root.style.setProperty(property, value);
}

/** Applies the custom layer after the legacy theme attributes (U2). Missing
 * tokens fall back to the built-in snapshot of the theme's own scheme, so a
 * partially imported theme can never leave a CSS variable undefined.
 *
 * Only the fixed allowlists below are written: the number of declarations is
 * capped by the token schema, never by the size of an imported map. A built-in
 * `data-theme` is kept because it still supplies the non-whitelisted values
 * (shadows) that a data theme may never carry; the custom values are inline
 * and therefore win. */
export function applyCustomThemeAttributes(root: HTMLElement, theme: CustomTheme): void {
  if (!CUSTOM_LAYER.has(root)) {
    CUSTOM_LAYER.set(root, {
      theme: root.dataset.theme,
      scheme: root.dataset.scheme,
      tabShape: root.dataset.tabShape,
      iconMode: root.dataset.iconMode,
      colorScheme: root.style.getPropertyValue("color-scheme"),
      accentCurrent: root.style.getPropertyValue("--adp-accent-current"),
    });
  }
  const defaults = defaultThemeTokens(theme.scheme);
  if (!root.dataset.theme || root.dataset.theme === "custom") root.dataset.theme = "custom";
  root.dataset.scheme = theme.scheme;
  root.style.colorScheme = theme.scheme;
  root.dataset.tabShape = theme.tab_shape;
  root.dataset.iconMode = theme.icon_mode;
  for (const path of THEME_TOKEN_PATHS) {
    const value = theme.tokens[path] ?? defaults[path];
    if (value === undefined) continue;
    const css = themeTokenCss(path, value);
    if (css !== null) root.style.setProperty(themeVariableName(path), css);
  }
  // The editor palette is a second allowlist: its variables are only consumed
  // by code surfaces, so they are set after the main token layer. A theme
  // without an editor value falls back to its main token, not to a default
  // that would silently hide an edited syntax colour.
  for (const path of THEME_EDITOR_TOKEN_PATHS) {
    const value = theme.editor_tokens[path] ?? theme.tokens[path] ?? defaults[path];
    if (value === undefined) continue;
    const css = themeTokenCss(path, value);
    if (css !== null) root.style.setProperty(themeVariableName(path), css);
  }
  root.style.setProperty("--adp-font-family", fontFamilyCss(theme.ui_font));
  root.style.setProperty("--adp-font-body", `${theme.ui_font_size_px}px`);
  root.style.setProperty("--adp-accent-current", themeTokenColor(theme, "color.accent.explorer"));
}

/** Removes every custom property the previous custom layer set and restores
 * the attributes and inline values the element had before it. */
export function clearCustomThemeAttributes(root: HTMLElement, _theme?: CustomTheme): void {
  for (const path of THEME_TOKEN_PATHS) {
    root.style.removeProperty(themeVariableName(path));
  }
  for (const path of THEME_EDITOR_TOKEN_PATHS) {
    root.style.removeProperty(themeVariableName(path));
  }
  root.style.removeProperty("--adp-font-family");
  root.style.removeProperty("--adp-font-body");
  const previous = CUSTOM_LAYER.get(root);
  if (previous) {
    CUSTOM_LAYER.delete(root);
    // A built-in `data-theme` was never replaced, so a newer legacy choice
    // must win over the value remembered at apply time.
    if (root.dataset.theme === "custom") restoreData(root, "theme", previous.theme);
    restoreData(root, "scheme", previous.scheme);
    restoreData(root, "tabShape", previous.tabShape);
    restoreData(root, "iconMode", previous.iconMode);
    restoreInline(root, "color-scheme", previous.colorScheme);
    restoreInline(root, "--adp-accent-current", previous.accentCurrent);
    return;
  }
  root.style.removeProperty("color-scheme");
  delete root.dataset.tabShape;
  delete root.dataset.iconMode;
}

export function sameThemeRef(a: ThemeRef, b: ThemeRef): boolean {
  return refMatches(a, b);
}
