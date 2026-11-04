/** Canonical display-format types and formatting (Step 10c T1/T3,
 * display-formats-1).
 *
 * The two-argument `formatSize` and `formatDate` in `format.ts` keep their
 * exact old meaning. These functions add typed options; when no options are
 * passed, `formatSizeWithOptions` is the old function. No sorting or
 * comparison ever uses the formatted text.
 */
import { formatSize as legacyFormatSize } from "./format";
import { formatCustomDatePattern, isValidCustomDatePattern, CUSTOM_DATE_PATTERN_MAX } from "./customDatePattern";
import {
  splitFinalExtension,
  splitGraphemes,
  truncateEnd,
  truncateFileName,
} from "./nameDisplay";

export const FORMAT_DATE_STYLES = ["relative", "short", "long", "custom"] as const;
export type FormatDateStyle = (typeof FORMAT_DATE_STYLES)[number];

export const FORMAT_TIME_CYCLES = ["system", "h12", "h23"] as const;
export type FormatTimeCycle = (typeof FORMAT_TIME_CYCLES)[number];

export const FORMAT_WEEK_STARTS = ["system", "monday", "sunday"] as const;
export type FormatWeekStart = (typeof FORMAT_WEEK_STARTS)[number];

export const FORMAT_SIZE_BASES = ["legacy", "decimal", "binary"] as const;
export type FormatSizeBase = (typeof FORMAT_SIZE_BASES)[number];

export const FORMAT_NAME_TRUNCATIONS = ["middle", "end"] as const;
export type FormatNameTruncation = (typeof FORMAT_NAME_TRUNCATIONS)[number];

export const MAX_FORMAT_LOCALE_CHARS = 64;
export const MAX_EXTENSION_OVERRIDES = 256;
export const MAX_EXTENSION_KEY_CHARS = 32;
export const MAX_SIZE_DECIMALS = 4;
export const DEFAULT_CUSTOM_DATE = "YYYY-MM-DD HH:mm";
/** The default display budget for a file name, in grapheme clusters. */
export const DEFAULT_FILE_NAME_LIMIT = 40;

export interface FormatOptions {
  /** "system" or a validated BCP 47 tag (at most 64 characters). */
  locale: string;
  date_style: FormatDateStyle;
  custom_date: string;
  time_cycle: FormatTimeCycle;
  week_start: FormatWeekStart;
  size_base: FormatSizeBase;
  /** 0 to 4 fraction digits. */
  decimals: number;
  name_truncation: FormatNameTruncation;
  /** Lower-case extension (no dot) to show/hide, at most 256 entries. */
  extension_overrides: Record<string, boolean>;
}

const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
const EXTENSION_KEY_RE = /^[a-z0-9_+-]{1,32}$/;

/** A validated BCP 47 tag. `system` is not a tag and is handled separately. */
export function isValidLocaleTag(value: string): boolean {
  if (value.length < 2 || value.length > MAX_FORMAT_LOCALE_CHARS) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export function isValidFormatLocale(value: string): boolean {
  return value === "system" || isValidLocaleTag(value);
}

/**
 * The defaults for a fresh settings file. A legacy settings file (schema 29
 * and older) keeps its old KB/MB labels by passing `legacy: true`.
 */
export function defaultFormatOptions(legacy = false): FormatOptions {
  return {
    locale: "system",
    date_style: "short",
    custom_date: DEFAULT_CUSTOM_DATE,
    time_cycle: "system",
    week_start: "system",
    size_base: legacy ? "legacy" : "binary",
    decimals: 1,
    name_truncation: "end",
    extension_overrides: {},
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

function normalizeDecimals(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SIZE_DECIMALS
    ? value
    : 1;
}

function normalizeExtensionOverrides(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!isRecord(value)) return result;
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (count >= MAX_EXTENSION_OVERRIDES) break;
    const key = rawKey.replace(/^\./, "").toLowerCase();
    if (!EXTENSION_KEY_RE.test(key) || typeof rawValue !== "boolean") continue;
    result[key] = rawValue;
    count += 1;
  }
  return result;
}

/** Repair a saved format section field by field. */
export function normalizeFormatOptions(value: unknown, legacy = false): FormatOptions {
  const defaults = defaultFormatOptions(legacy);
  const input = isRecord(value) ? value : {};
  const customDate =
    typeof input.custom_date === "string" && isValidCustomDatePattern(input.custom_date)
      ? input.custom_date
      : defaults.custom_date;
  return {
    locale:
      typeof input.locale === "string" && isValidFormatLocale(input.locale)
        ? input.locale
        : defaults.locale,
    date_style: pick(input.date_style, FORMAT_DATE_STYLES, defaults.date_style),
    custom_date: customDate,
    time_cycle: pick(input.time_cycle, FORMAT_TIME_CYCLES, defaults.time_cycle),
    week_start: pick(input.week_start, FORMAT_WEEK_STARTS, defaults.week_start),
    size_base: pick(input.size_base, FORMAT_SIZE_BASES, defaults.size_base),
    decimals: normalizeDecimals(input.decimals),
    name_truncation: pick(input.name_truncation, FORMAT_NAME_TRUNCATIONS, defaults.name_truncation),
    extension_overrides: normalizeExtensionOverrides(input.extension_overrides),
  };
}

/**
 * Validate a format section without repairing it. Returns the stable error
 * code `preferences.invalid_format`, or null when every field is valid.
 */
export function validateFormatOptions(value: unknown): string | null {
  if (!isRecord(value)) return "preferences.invalid_format";
  if (typeof value.locale !== "string" || !isValidFormatLocale(value.locale)) {
    return "preferences.invalid_format";
  }
  if (!FORMAT_DATE_STYLES.includes(value.date_style as FormatDateStyle)) {
    return "preferences.invalid_format";
  }
  if (typeof value.custom_date !== "string" || !isValidCustomDatePattern(value.custom_date)) {
    return "preferences.invalid_format";
  }
  if (Array.from(value.custom_date).length > CUSTOM_DATE_PATTERN_MAX) {
    return "preferences.invalid_format";
  }
  if (!FORMAT_TIME_CYCLES.includes(value.time_cycle as FormatTimeCycle)) {
    return "preferences.invalid_format";
  }
  if (!FORMAT_WEEK_STARTS.includes(value.week_start as FormatWeekStart)) {
    return "preferences.invalid_format";
  }
  if (!FORMAT_SIZE_BASES.includes(value.size_base as FormatSizeBase)) {
    return "preferences.invalid_format";
  }
  if (
    typeof value.decimals !== "number" ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > MAX_SIZE_DECIMALS
  ) {
    return "preferences.invalid_format";
  }
  if (!FORMAT_NAME_TRUNCATIONS.includes(value.name_truncation as FormatNameTruncation)) {
    return "preferences.invalid_format";
  }
  if (!isRecord(value.extension_overrides)) return "preferences.invalid_format";
  const entries = Object.entries(value.extension_overrides);
  if (entries.length > MAX_EXTENSION_OVERRIDES) return "preferences.invalid_format";
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.replace(/^\./, "").toLowerCase();
    if (!EXTENSION_KEY_RE.test(key) || typeof rawValue !== "boolean") {
      return "preferences.invalid_format";
    }
  }
  return null;
}

/** The locale to hand to `Intl`: "system" follows the Windows locale. */
export function resolveFormatLocale(locale: string, fallback: string): string {
  if (locale !== "system") return locale;
  if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language !== "") {
    return navigator.language;
  }
  return fallback === "pseudo" ? "en" : fallback;
}

/**
 * Format a byte count. Without options it is exactly the old `formatSize`
 * (1024 divisor, KB/MB labels, at most one fraction digit).
 */
export function formatSizeWithOptions(bytes: number, locale: string, options?: FormatOptions): string {
  if (options === undefined || options.size_base === "legacy") {
    return legacyFormatSize(bytes, locale);
  }
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const resolvedLocale = resolveFormatLocale(locale, "en");
  const base = options.size_base === "decimal" ? 1000 : 1024;
  const units = base === 1000 ? DECIMAL_UNITS : BINARY_UNITS;
  let value = safeBytes;
  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit += 1;
  }
  const decimals = Math.min(MAX_SIZE_DECIMALS, Math.max(0, Math.trunc(options.decimals)));
  const formatted = new Intl.NumberFormat(resolvedLocale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}

function absoluteDate(
  unixSeconds: number,
  locale: string,
  style: "short" | "long",
  cycle: FormatTimeCycle,
): string {
  const date = new Date(unixSeconds * 1000);
  if (cycle === "system") {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: style,
      timeStyle: "short",
    }).format(date);
  }
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: cycle === "h12",
        }
      : {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: cycle === "h12",
        };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function relativeDate(unixSeconds: number, locale: string, nowUnix: number): string {
  const delta = Math.trunc(unixSeconds - nowUnix);
  const absolute = Math.abs(delta);
  // `numeric: "auto"` is only used for the localized "now"; "always" keeps
  // "1 day ago" instead of the special word "yesterday".
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (absolute < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  }
  if (absolute < 3600) return relative.format(Math.trunc(delta / 60), "minute");
  if (absolute < 86400) return relative.format(Math.trunc(delta / 3600), "hour");
  if (absolute < 30 * 86400) return relative.format(Math.trunc(delta / 86400), "day");
  return absoluteDate(unixSeconds, locale, "short", "system");
}

/**
 * Format a Unix timestamp. `0` stays blank, exactly like the old
 * `formatDate`. `nowUnix` is injected so relative text is testable.
 */
export function formatDateWithOptions(
  unixSeconds: number,
  locale: string,
  options: FormatOptions,
  nowUnix: number,
): string {
  if (!unixSeconds) return "";
  const resolved = resolveFormatLocale(locale, "en");
  if (options.date_style === "custom") {
    return formatCustomDatePattern(options.custom_date, new Date(unixSeconds * 1000), resolved);
  }
  if (options.date_style === "relative") {
    return relativeDate(unixSeconds, resolved, nowUnix);
  }
  return absoluteDate(
    unixSeconds,
    resolved,
    options.date_style === "long" ? "long" : "short",
    options.time_cycle,
  );
}

export interface DisplayFileName {
  /** The name as it should be drawn. */
  display: string;
  /** The real file name for tooltips and accessibility. */
  full: string;
}

/**
 * Show or hide the final extension and truncate for display only. Hiding an
 * extension never renames the file, and `full` is always the real name.
 */
export function displayFileName(
  name: string,
  extension: string,
  showExtensions: boolean,
  options: FormatOptions,
  maxLength = DEFAULT_FILE_NAME_LIMIT,
): DisplayFileName {
  const extensionKey = extension.replace(/^\./, "").toLowerCase();
  const override = Object.prototype.hasOwnProperty.call(options.extension_overrides, extensionKey)
    ? options.extension_overrides[extensionKey]
    : undefined;
  const visibleExtension = override ?? showExtensions;
  const limit = Math.max(4, Math.min(1024, Math.trunc(maxLength)));
  if (visibleExtension) {
    return {
      display: truncateFileName(name, limit, options.name_truncation, true),
      full: name,
    };
  }
  const { base } = splitFinalExtension(name);
  return {
    display: truncateFileName(base, limit, options.name_truncation, false),
    full: name,
  };
}

/** The number of grapheme clusters in a name (used by tab titles). */
export function nameLength(name: string): number {
  return splitGraphemes(name).length;
}

/** A short, display-only title with the real name kept for accessibility. */
export function titleWithFullName(name: string, limit: number): { visible: string; full: string } {
  return { visible: truncateEnd(name, Math.max(1, Math.trunc(limit))), full: name };
}
