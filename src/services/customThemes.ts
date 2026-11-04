/** Custom theme data and native transfer (Step 10a, custom-theme-1).
 *
 * A custom theme is bounded data, never CSS. This module owns the canonical
 * TypeScript DTO; the native mirror is `custom_theme_types.rs` backed by
 * `crates/fs-service/src/theme_data.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import {
  defaultThemeTokens,
  isEditorTokenPath,
  isOpaqueThemeColor,
  isThemeColor,
  isThemeTokenPath,
  normalizeThemeColor,
  rgbaToHex,
  THEME_EDITOR_TOKEN_PATHS,
  THEME_TOKEN_PATHS,
  themeTokenAllowsAlpha,
  themeTokenSpec,
} from "../appearance/themeTokens";
import type { ThemeId, ThemeSettings } from "./settings";

export const THEME_SCHEMA_VERSION = 1;
export const MAX_THEMES = 100;
export const MAX_THEME_BYTES = 128 * 1024;
export const MAX_THEME_STORAGE_BYTES = 16 * 1024 * 1024;
export const MAX_THEME_NAME = 60;
export const MAX_THEME_TOKENS = 512;
export const MAX_EDITOR_TOKENS = 64;
export const MAX_THEME_STYLES = 32;
export const MAX_FONT_NAME = 128;
export const MAX_THEME_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_THEME_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BACKGROUND_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_BACKGROUND_EDGE = 4096;
export const MAX_BACKGROUND_PIXELS = 16_000_000;

export type ThemeValue = string | number;
/** A normalized `#RRGGBB` or `#RRGGBBAA` value. */
export type ThemeColor = string;
export type ThemeMaterial = "solid" | "mica" | "acrylic";
export type ThemeTabShape = "square" | "rounded" | "pill";
export type ThemeIconMode = "lucide" | "system";
export type ThemeFit = "fill" | "fit" | "tile";
export type ThemeStyleSelector = ".adp-window" | ".adp-tab" | ".adp-command-bar" | ".adp-filelist-scroll";
export type ThemeStyleProperty =
  | "border-radius"
  | "padding-inline"
  | "padding-block"
  | "letter-spacing"
  | "line-height";
export type ThemeStyleUnit = "px" | "ratio";

export const THEME_STYLE_SELECTORS: readonly ThemeStyleSelector[] = [
  ".adp-window",
  ".adp-tab",
  ".adp-command-bar",
  ".adp-filelist-scroll",
];
export const THEME_STYLE_PROPERTIES: readonly ThemeStyleProperty[] = [
  "border-radius",
  "padding-inline",
  "padding-block",
  "letter-spacing",
  "line-height",
];
export const THEME_CANONICAL_TYPE_IDS = [
  "explorer",
  "excel",
  "word",
  "pdf",
  "image",
  "powerpoint",
  "group",
] as const;
export type ThemeTypeId = (typeof THEME_CANONICAL_TYPE_IDS)[number];

export type ThemeRef =
  | { kind: "builtin"; id: ThemeId }
  | { kind: "custom"; id: string };

export interface ThemeStyleRule {
  selector: ThemeStyleSelector;
  property: ThemeStyleProperty;
  value: number;
  unit: ThemeStyleUnit;
}

export interface ThemeBackground {
  asset_id?: string;
  fit: ThemeFit;
  opacity: number;
  blur_px: number;
}

export interface CustomTheme {
  schema_version: 1;
  id: string;
  name: string;
  scheme: "light" | "dark";
  tokens: Record<string, ThemeValue>;
  editor_tokens: Record<string, ThemeValue>;
  material: ThemeMaterial;
  ui_font: string;
  ui_font_size_px: number;
  tab_shape: ThemeTabShape;
  icon_mode: ThemeIconMode;
  styles: ThemeStyleRule[];
  background?: ThemeBackground;
  modified_unix: number;
}

export interface CustomThemeSummary {
  id: string;
  name: string;
  scheme: "light" | "dark";
  modified_unix: number;
  has_background: boolean;
}

export interface ThemeCustomSettings {
  day: ThemeRef;
  night: ThemeRef;
  mode: "manual" | "windows" | "clock";
  manual_scheme: "light" | "dark";
  day_start_minute: number;
  night_start_minute: number;
  follow_wallpaper: boolean;
  type_accents: Partial<Record<ThemeTypeId, string>>;
}

export interface ThemeRuntime {
  requested: ThemeRef;
  applied: ThemeRef;
  scheme: "light" | "dark";
  material_requested: ThemeMaterial;
  material_applied: ThemeMaterial;
  temporary_override: boolean;
  warning_codes: string[];
}

export interface WallpaperPalette {
  colors: string[];
  source_stamp?: SourceStamp;
  available: boolean;
  reason?: string;
}

/** Additive transport for an owned background image (not a source path). */
export interface ThemeBackgroundAsset {
  asset_id: string;
  token: string;
  name: string;
  mime: string;
  byte_len: number;
  width: number;
  height: number;
}

export interface ThemeExportResult {
  path: string;
  bytes: number;
}

export interface MaterialResult {
  requested: ThemeMaterial;
  applied: ThemeMaterial;
  fallback: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILTIN_IDS: readonly string[] = ["light", "bright", "paper", "dark", "amoled", "highContrast"];

export function isThemeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isThemeRef(value: unknown): value is ThemeRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "builtin") return typeof record.id === "string" && BUILTIN_IDS.includes(record.id);
  if (record.kind === "custom") return isThemeUuid(record.id);
  return false;
}

export function defaultThemeCustomSettings(): ThemeCustomSettings {
  return {
    day: { kind: "builtin", id: "light" },
    night: { kind: "builtin", id: "dark" },
    mode: "windows",
    manual_scheme: "light",
    day_start_minute: 420,
    night_start_minute: 1140,
    follow_wallpaper: false,
    type_accents: {},
  };
}

/** Schema 27 -> 28: the legacy light/dark choices become today/tomorrow refs. */
export function themeCustomFromLegacy(theme: ThemeSettings): ThemeCustomSettings {
  const defaults = defaultThemeCustomSettings();
  const mode = theme.mode === "light" || theme.mode === "dark" ? "manual" : "windows";
  const manual = theme.mode === "dark" ? "dark" : "light";
  return {
    ...defaults,
    day: { kind: "builtin", id: theme.light_theme },
    night: { kind: "builtin", id: theme.dark_theme },
    mode,
    manual_scheme: manual,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeRef(value: unknown, fallback: ThemeRef): ThemeRef {
  return isThemeRef(value) ? value : fallback;
}

/** Repairs a theme_custom section field by field. */
export function normalizeThemeCustom(value: unknown, legacy?: ThemeSettings): ThemeCustomSettings {
  const defaults = legacy ? themeCustomFromLegacy(legacy) : defaultThemeCustomSettings();
  if (!isRecord(value)) return defaults;
  const typeAccents: Partial<Record<ThemeTypeId, string>> = {};
  if (isRecord(value.type_accents)) {
    for (const id of THEME_CANONICAL_TYPE_IDS) {
      const color = value.type_accents[id];
      if (isOpaqueThemeColor(color)) typeAccents[id] = normalizeThemeColor(color)!;
    }
  }
  const dayStart = normalizeMinute(value.day_start_minute, defaults.day_start_minute);
  let nightStart = normalizeMinute(value.night_start_minute, defaults.night_start_minute);
  if (nightStart === dayStart) nightStart = defaults.night_start_minute === dayStart ? (dayStart + 720) % 1440 : defaults.night_start_minute;
  return {
    day: normalizeRef(value.day, defaults.day),
    night: normalizeRef(value.night, defaults.night),
    mode: pick(value.mode, ["manual", "windows", "clock"] as const, defaults.mode),
    manual_scheme: pick(value.manual_scheme, ["light", "dark"] as const, defaults.manual_scheme),
    day_start_minute: dayStart,
    night_start_minute: nightStart,
    follow_wallpaper: typeof value.follow_wallpaper === "boolean" ? value.follow_wallpaper : defaults.follow_wallpaper,
    type_accents: typeAccents,
  };
}

function normalizeMinute(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439 ? value : fallback;
}

export function isThemeStyleRule(value: unknown): value is ThemeStyleRule {
  if (!isRecord(value)) return false;
  if (!THEME_STYLE_SELECTORS.includes(value.selector as ThemeStyleSelector)) return false;
  if (!THEME_STYLE_PROPERTIES.includes(value.property as ThemeStyleProperty)) return false;
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) return false;
  const property = value.property as ThemeStyleProperty;
  const expectedUnit: ThemeStyleUnit = property === "line-height" ? "ratio" : "px";
  if (value.unit !== expectedUnit) return false;
  if (property === "border-radius") return value.value >= 0 && value.value <= 16;
  if (property === "padding-inline" || property === "padding-block") return value.value >= 0 && value.value <= 24;
  if (property === "letter-spacing") return value.value >= 0 && value.value <= 2;
  return value.value >= 1 && value.value <= 2;
}

/** True when a string can be shown as a theme name. */
export function isValidThemeName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0) return false;
  const characters = Array.from(trimmed);
  if (characters.length > MAX_THEME_NAME) return false;
  return characters.every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
}

/** Font families are references, never embedded files. Control characters
 * match the native `is_safe_font_family`, including the C1 range. */
export function isSafeFontFamily(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (Array.from(value).length > MAX_FONT_NAME) return false;
  return !/[\u0000-\u001f\u007f-\u009f;{}<>"\\]/.test(value);
}

function normalizeTokenMap(
  value: unknown,
  allowed: (path: string) => boolean,
  max: number,
): Record<string, ThemeValue> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > max) return null;
  const result: Record<string, ThemeValue> = {};
  for (const [path, raw] of entries) {
    if (!allowed(path)) return null;
    const spec = themeTokenSpec(path);
    if (!spec) return null;
    if (spec.kind === "color") {
      const color = normalizeThemeColor(raw);
      if (!color) return null;
      if (!themeTokenAllowsAlpha(path) && color.length !== 7) return null;
      result[path] = color;
    } else {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
      if (spec.min !== undefined && raw < spec.min) return null;
      if (spec.max !== undefined && raw > spec.max) return null;
      result[path] = raw;
    }
  }
  return result;
}

/** Full validation. Returns the normalized theme, or null with no mutation. */
export function normalizeCustomTheme(value: unknown): CustomTheme | null {
  if (!isRecord(value)) return null;
  if (value.schema_version !== THEME_SCHEMA_VERSION) return null;
  if (!isThemeUuid(value.id) || !isValidThemeName(value.name)) return null;
  if (value.scheme !== "light" && value.scheme !== "dark") return null;
  const tokens = normalizeTokenMap(value.tokens, isThemeTokenPath, MAX_THEME_TOKENS);
  if (!tokens) return null;
  const editorTokens = normalizeTokenMap(value.editor_tokens, isEditorTokenPath, MAX_EDITOR_TOKENS);
  if (!editorTokens) return null;
  if (!isSafeFontFamily(value.ui_font)) return null;
  if (
    typeof value.ui_font_size_px !== "number" ||
    !Number.isInteger(value.ui_font_size_px) ||
    value.ui_font_size_px < 10 ||
    value.ui_font_size_px > 24
  ) {
    return null;
  }
  if (
    value.styles !== undefined &&
    (!Array.isArray(value.styles) || value.styles.length > MAX_THEME_STYLES)
  ) {
    return null;
  }
  const styles = value.styles === undefined ? [] : (value.styles as ThemeStyleRule[]);
  if (!styles.every(isThemeStyleRule)) return null;
  if (!["solid", "mica", "acrylic"].includes(value.material as string)) return null;
  if (!["square", "rounded", "pill"].includes(value.tab_shape as string)) return null;
  if (!["lucide", "system"].includes(value.icon_mode as string)) return null;
  let background: ThemeBackground | undefined;
  if (value.background !== undefined && value.background !== null) {
    if (!isRecord(value.background)) return null;
    const candidate = value.background;
    if (candidate.asset_id !== undefined && candidate.asset_id !== null && !isThemeUuid(candidate.asset_id)) return null;
    if (!["fill", "fit", "tile"].includes(candidate.fit as string)) return null;
    if (typeof candidate.opacity !== "number" || !Number.isFinite(candidate.opacity)) return null;
    if (candidate.opacity < 0 || candidate.opacity > 0.5) return null;
    if (
      typeof candidate.blur_px !== "number" ||
      !Number.isInteger(candidate.blur_px) ||
      candidate.blur_px < 0 ||
      candidate.blur_px > 32
    ) {
      return null;
    }
    background = {
      ...(typeof candidate.asset_id === "string" ? { asset_id: candidate.asset_id } : {}),
      fit: candidate.fit as ThemeFit,
      opacity: candidate.opacity,
      blur_px: candidate.blur_px,
    };
  }
  return {
    schema_version: 1,
    id: value.id,
    name: value.name,
    scheme: value.scheme,
    tokens,
    editor_tokens: editorTokens,
    material: value.material as ThemeMaterial,
    ui_font: value.ui_font,
    ui_font_size_px: value.ui_font_size_px,
    tab_shape: value.tab_shape as ThemeTabShape,
    icon_mode: value.icon_mode as ThemeIconMode,
    styles,
    ...(background ? { background } : {}),
    modified_unix:
      typeof value.modified_unix === "number" && Number.isSafeInteger(value.modified_unix) && value.modified_unix >= 0
        ? value.modified_unix
        : 0,
  };
}

export function customThemeSummary(theme: CustomTheme): CustomThemeSummary {
  return {
    id: theme.id,
    name: theme.name,
    scheme: theme.scheme,
    modified_unix: theme.modified_unix,
    has_background: theme.background !== undefined,
  };
}

/** A new draft cloned from a built-in token snapshot. */
export function createCustomTheme(
  name: string,
  scheme: "light" | "dark",
  id: string = crypto.randomUUID(),
): CustomTheme {
  return {
    schema_version: 1,
    id,
    name,
    scheme,
    tokens: defaultThemeTokens(scheme),
    editor_tokens: editorTokenSnapshot(scheme),
    material: "solid",
    ui_font: "Inter",
    ui_font_size_px: 12,
    tab_shape: "rounded",
    icon_mode: "lucide",
    styles: [],
    modified_unix: 0,
  };
}

function editorTokenSnapshot(scheme: "light" | "dark"): Record<string, ThemeValue> {
  const tokens = defaultThemeTokens(scheme);
  const result: Record<string, ThemeValue> = {};
  for (const path of THEME_EDITOR_TOKEN_PATHS) {
    const value = tokens[path];
    if (value !== undefined) result[path] = value;
  }
  return result;
}

/** Trusted CSS text for the validated style rows only. The row count is
 * capped here as well, so an unvalidated draft can never generate an
 * unbounded stylesheet. */
export function themeStyleCss(theme: CustomTheme, scope = ""): string {
  if (scope !== "" && !/^#[A-Za-z][A-Za-z0-9_-]*$/.test(scope)) return "";
  const prefix = scope === "" ? "" : `${scope} `;
  return theme.styles
    .filter(isThemeStyleRule)
    .slice(0, MAX_THEME_STYLES)
    .map((rule) => {
      const value =
        rule.unit === "ratio"
          ? String(rule.value)
          : `${Number.isInteger(rule.value) ? rule.value : rule.value.toFixed(2)}px`;
      return `${prefix}${rule.selector}{${rule.property}:${value};}`;
    })
    .join("\n");
}

/** True when another theme may be added to a catalog of `count` themes. */
export function canAddTheme(count: number): boolean {
  return Number.isInteger(count) && count >= 0 && count < MAX_THEMES;
}

export function themeStorageFits(currentBytes: number, nextBytes: number, replacingBytes = 0): boolean {
  const total = currentBytes - replacingBytes + nextBytes;
  return Number.isFinite(total) && total >= 0 && total <= MAX_THEME_STORAGE_BYTES;
}

function assertTheme(theme: CustomTheme): CustomTheme {
  const normalized = normalizeCustomTheme(theme);
  if (!normalized) throw new Error("theme.invalid");
  return normalized;
}

// ---------------------------------------------------------------------------
// Native service (the only place this module calls invoke)
// ---------------------------------------------------------------------------

export async function listCustomThemes(): Promise<CustomThemeSummary[]> {
  const result = (await invoke("theme_list")) as unknown;
  if (!Array.isArray(result) || result.length > MAX_THEMES) throw new Error("theme.invalid");
  return result as CustomThemeSummary[];
}

export async function readCustomTheme(id: string): Promise<CustomTheme> {
  if (!isThemeUuid(id)) throw new Error("theme.invalid");
  const result = normalizeCustomTheme(await invoke("theme_read", { id }));
  if (!result) throw new Error("theme.invalid");
  return result;
}

export async function saveCustomTheme(theme: CustomTheme): Promise<CustomTheme> {
  const normalized = assertTheme(theme);
  const result = normalizeCustomTheme(await invoke("theme_save", { theme: normalized }));
  if (!result) throw new Error("theme.invalid");
  return result;
}

export async function removeCustomTheme(id: string): Promise<void> {
  if (!isThemeUuid(id)) throw new Error("theme.invalid");
  await invoke("theme_remove", { id });
}

/** Validated draft; nothing is applied or listed until Save. */
export async function importTheme(path: string): Promise<CustomTheme> {
  if (path.trim() === "") throw new Error("theme.invalid");
  const result = normalizeCustomTheme(await invoke("theme_import", { path }));
  if (!result) throw new Error("theme.invalid");
  return result;
}

export async function exportTheme(
  id: string,
  destPath: string,
  includeImage: boolean,
): Promise<ThemeExportResult> {
  if (!isThemeUuid(id) || destPath.trim() === "") throw new Error("theme.invalid");
  return (await invoke("theme_export", {
    id,
    destPath,
    includeImage,
  })) as ThemeExportResult;
}

export async function wallpaperPalette(): Promise<WallpaperPalette> {
  const result = (await invoke("theme_wallpaper_palette")) as unknown;
  if (!isRecord(result) || !Array.isArray(result.colors)) throw new Error("theme.wallpaper_unavailable");
  return result as unknown as WallpaperPalette;
}

export async function listSystemFontFamilies(): Promise<string[]> {
  const result = (await invoke("theme_system_fonts")) as unknown;
  if (!Array.isArray(result)) return [];
  return result
    .filter((name): name is string => isSafeFontFamily(name))
    .slice(0, 1000);
}

/** Explicit local background choice; returns an owned, leased image. */
export async function importThemeBackground(path: string): Promise<ThemeBackgroundAsset> {
  if (path.trim() === "") throw new Error("theme.invalid");
  return (await invoke("theme_background_import", { path })) as ThemeBackgroundAsset;
}

/** Shows the image picker and imports the chosen local image. */
export async function pickThemeBackground(
  title: string,
  filterName: string,
): Promise<ThemeBackgroundAsset | null> {
  return (await invoke("theme_pick_background", {
    title,
    filterName,
  })) as ThemeBackgroundAsset | null;
}

/** Leases an already-owned background for preview; revoke the token on close. */
export async function leaseThemeBackground(assetId: string): Promise<ThemeBackgroundAsset> {
  if (!isThemeUuid(assetId)) throw new Error("theme.invalid");
  return (await invoke("theme_background_lease", { assetId })) as ThemeBackgroundAsset;
}

export async function revokeThemeBackground(token: string): Promise<void> {
  if (token.length !== 32) throw new Error("theme.invalid");
  await invoke("file_revoke", { token });
}

const MATERIAL_VALUES: readonly ThemeMaterial[] = ["solid", "mica", "acrylic"];

/** Records what the PC accepted without forgetting an earlier native success:
 * asking for solid must not make a later mica theme look unsupported. */
function recordMaterial(result: MaterialResult): MaterialResult {
  const root = document.documentElement;
  const applied = MATERIAL_VALUES.includes(result.applied) ? result.applied : "solid";
  root.dataset.material = applied;
  if (!result.fallback && applied !== "solid") {
    root.dataset.materialSupport = applied;
  } else if (result.fallback && root.dataset.materialSupport === undefined) {
    root.dataset.materialSupport = "solid";
  }
  return { ...result, applied };
}

/** Applies the native material and records what the PC actually accepted. */
export async function applyThemeMaterial(material: ThemeMaterial): Promise<MaterialResult> {
  if (!MATERIAL_VALUES.includes(material)) throw new Error("theme.invalid");
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    const fallback = material !== "solid";
    if (fallback) document.documentElement.dataset.materialSupport = "solid";
    return recordMaterial({ requested: material, applied: "solid", fallback });
  }
  const result = (await invoke("theme_apply_material", { material })) as MaterialResult;
  return recordMaterial(result);
}

/** The picker helpers, kept here so a component never touches invoke. */
export async function pickThemeToImport(
  title: string,
  filterName: string,
): Promise<CustomTheme | null> {
  const result = (await invoke("theme_pick_import", { title, filterName })) as unknown;
  if (result === null) return null;
  const normalized = normalizeCustomTheme(result);
  if (!normalized) throw new Error("theme.invalid");
  return normalized;
}

export async function pickThemeToExport(
  id: string,
  includeImage: boolean,
  title: string,
  fileName: string,
  filterName: string,
): Promise<ThemeExportResult | null> {
  if (!isThemeUuid(id)) throw new Error("theme.invalid");
  return (await invoke("theme_pick_export", {
    id,
    includeImage,
    title,
    fileName,
    filterName,
  })) as ThemeExportResult | null;
}

export { isThemeColor, isOpaqueThemeColor, rgbaToHex, THEME_TOKEN_PATHS, THEME_EDITOR_TOKEN_PATHS };
