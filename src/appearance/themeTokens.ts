/** Token whitelist for custom themes (Step 10a, custom-theme-1).
 *
 * A custom theme is data, never CSS. Only the token paths that exist in the
 * generated `themes/*.tokens.json` schema may be changed. Notes (`_note`,
 * `_source`, `_derived`) are not tokens. `font.family` and `shadow.*` are
 * deliberately excluded: fonts are chosen through `ui_font`, and shadow
 * strings are raw CSS that a data theme may not carry.
 */
import dark from "../../themes/dark.tokens.json";
import light from "../../themes/light.tokens.json";

export type ThemeTokenKind = "color" | "fontSize" | "radius" | "space";

export interface ThemeTokenSpec {
  path: string;
  kind: ThemeTokenKind;
  /** Inclusive pixel bounds for numeric tokens; ignored for colors. */
  min?: number;
  max?: number;
}

const COLOR_PATHS = [
  "color.surface.window",
  "color.surface.chrome",
  "color.surface.pane",
  "color.surface.sidebar",
  "color.surface.selected",
  "color.surface.tabInactive",
  "color.surface.header",
  "color.surface.segmentTrack",
  "color.surface.canvasDoc",
  "color.surface.canvasMedia",
  "color.surface.selectedRow",
  "color.text.primary",
  "color.text.secondary",
  "color.text.tertiary",
  "color.text.bodyMuted",
  "color.text.onAccent",
  "color.border.default",
  "color.border.subtle",
  "color.border.panel",
  "color.border.input",
  "color.border.chip",
  "color.accent.explorer",
  "color.accent.excel",
  "color.accent.word",
  "color.accent.pdf",
  "color.accent.image",
  "color.accent.powerpoint",
  "color.accent.group",
  "color.accentDark.excel",
  "color.accentDark.word",
  "color.accentLight.explorer",
  "color.accentLight.excel",
  "color.accentLight.word",
  "color.accentLight.image",
  "color.accentLight.group",
  "color.status.caution",
  "color.status.cautionBackground",
  "syntax.keyword",
  "syntax.string",
  "syntax.number",
  "syntax.comment",
  "syntax.function",
  "syntax.type",
  "syntax.tag",
  "syntax.attribute",
  "syntax.property",
  "syntax.invalid",
  "syntax.match",
  "syntax.matchSelected",
] as const;

const FONT_SIZE_NAMES = ["tiny", "caption", "small", "body", "command", "section", "gallerySample"] as const;
const RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "pill", "round"] as const;

const NUMERIC_SPECS: readonly ThemeTokenSpec[] = [
  ...FONT_SIZE_NAMES.map((name) => ({ path: `font.size.${name}`, kind: "fontSize" as const, min: 8, max: 48 })),
  ...RADIUS_NAMES.map((name) => ({ path: `radius.${name}`, kind: "radius" as const, min: 0, max: 32 })),
  ...Array.from({ length: 11 }, (_, index) => ({
    path: `space.${index}`,
    kind: "space" as const,
    min: 0,
    max: 64,
  })),
];

/** Every token a custom theme may change, in a stable order. */
export const THEME_TOKEN_SPECS: readonly ThemeTokenSpec[] = [
  ...COLOR_PATHS.map((path) => ({ path, kind: "color" as const })),
  ...NUMERIC_SPECS,
];

export const THEME_TOKEN_PATHS: readonly string[] = THEME_TOKEN_SPECS.map((spec) => spec.path);

/** Editor surfaces use this second, smaller allowlist (syntax colors only). */
export const THEME_EDITOR_TOKEN_PATHS: readonly string[] = COLOR_PATHS.filter((path) => path.startsWith("syntax."));

const SPEC_BY_PATH = new Map(THEME_TOKEN_SPECS.map((spec) => [spec.path, spec]));
const EDITOR_PATHS = new Set(THEME_EDITOR_TOKEN_PATHS);

export function themeTokenSpec(path: string): ThemeTokenSpec | undefined {
  return SPEC_BY_PATH.get(path);
}

export function isThemeTokenPath(path: string): boolean {
  return SPEC_BY_PATH.has(path);
}

export function isEditorTokenPath(path: string): boolean {
  return EDITOR_PATHS.has(path);
}

/** Surfaces, accent light fills and syntax match fills may carry alpha. */
export function themeTokenAllowsAlpha(path: string): boolean {
  return path.startsWith("color.surface.") ||
    path.startsWith("color.accentLight.") ||
    path === "syntax.match" ||
    path === "syntax.matchSelected";
}

const HEX_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `#RRGGBB` or `#RRGGBBAA`, upper case, or null when it is not a colour. */
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_RE.test(value)) return null;
  return value.toUpperCase();
}

export function isThemeColor(value: unknown): value is string {
  return normalizeThemeColor(value) !== null;
}

/** Text colours are opaque: alpha would break contrast checks. */
export function isOpaqueThemeColor(value: unknown): value is string {
  const color = normalizeThemeColor(value);
  return color !== null && color.length === 7;
}

/** `rgba(1,2,3,0.5)` (the theme files' alpha form) to `#01020380`. */
export function rgbaToHex(value: string): string | null {
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const channels = [match[1], match[2], match[3]].map((part) => Number(part));
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  const hex = channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
  if (alpha >= 1) return `#${hex}`.toUpperCase();
  return `#${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`.toUpperCase();
}

function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** The CSS custom property a token path writes, exactly like build-tokens.mjs. */
export function themeVariableName(path: string): string {
  const parts = path.split(".");
  if (parts[0] === "color" && parts[1] === "accent") return `--adp-accent-${kebab(parts[2])}`;
  if (parts[0] === "color" && parts[1] === "accentDark") return `--adp-accent-dark-${kebab(parts[2])}`;
  if (parts[0] === "color" && parts[1] === "accentLight") return `--adp-accent-light-${kebab(parts[2])}`;
  if (parts[0] === "font" && parts[1] === "size") return `--adp-font-${kebab(parts[2])}`;
  if (parts[0] === "space") return `--adp-space-${parts[1]}`;
  return `--adp-${parts.map(kebab).join("-")}`;
}

/** A validated token value in CSS form (numbers get `px`), or null. */
export function themeTokenCss(path: string, value: string | number): string | null {
  const spec = themeTokenSpec(path);
  if (!spec) return null;
  if (spec.kind === "color") return normalizeThemeColor(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (spec.min !== undefined && value < spec.min) return null;
  if (spec.max !== undefined && value > spec.max) return null;
  return `${value}px`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type ThemeTokenTree = Record<string, unknown>;

function flattenTree(value: unknown, prefix: string[], out: Map<string, unknown>): void {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      flattenTree(child, [...prefix, key], out);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenTree(child, [...prefix, String(index)], out));
    return;
  }
  out.set(prefix.join("."), value);
}

/** Every leaf in a theme token file, notes removed. */
export function flattenThemeTokens(tree: ThemeTokenTree): Map<string, string | number> {
  const out = new Map<string, unknown>();
  flattenTree(tree, [], out);
  const result = new Map<string, string | number>();
  for (const [path, value] of out) {
    if (typeof value === "number") result.set(path, value);
    else if (typeof value === "string") {
      const color = rgbaToHex(value);
      result.set(path, color ?? value);
    }
  }
  return result;
}

const BUILTIN_TOKENS: Record<"light" | "dark", Map<string, string | number>> = {
  light: flattenThemeTokens(light as ThemeTokenTree),
  dark: flattenThemeTokens(dark as ThemeTokenTree),
};

/** The editable snapshot of a built-in theme (light or dark). */
export function defaultThemeTokens(scheme: "light" | "dark"): Record<string, string | number> {
  const source = BUILTIN_TOKENS[scheme];
  const result: Record<string, string | number> = {};
  for (const path of THEME_TOKEN_PATHS) {
    const value = source.get(path);
    if (value === undefined) continue;
    if (isThemeTokenPath(path)) {
      const spec = themeTokenSpec(path);
      if (spec?.kind === "color") {
        const color = typeof value === "string" ? normalizeThemeColor(value) : null;
        if (color) result[path] = color;
      } else if (typeof value === "number") {
        result[path] = value;
      }
    }
  }
  return result;
}

/** True when the token path exists in the built-in light schema. */
export function existsInBuiltinSchema(path: string): boolean {
  return BUILTIN_TOKENS.light.has(path);
}
