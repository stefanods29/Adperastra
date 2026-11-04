/** Pure colour, contrast, wallpaper-palette and schedule math (Step 10a).
 *
 * Shared by 10d (folder colours), 10f (accessibility) and 11b (tags). This is
 * deliberately a new module: Step 05d's `contrast.ts` keeps its threshold for
 * the built-in theme tests, while custom themes use the WCAG 2 threshold
 * 0.04045 required by Step 10a.
 */
import type { ThemeColor } from "../services/customThemes";

export type ThemeScheme = "light" | "dark";

const HEX_RE = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

export interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** Parses `#RRGGBB` or `#RRGGBBAA`; null when the value is not a colour. */
export function parseThemeColor(value: string): RgbaColor | null {
  const match = HEX_RE.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    red: parseInt(hex.slice(0, 2), 16),
    green: parseInt(hex.slice(2, 4), 16),
    blue: parseInt(hex.slice(4, 6), 16),
    alpha: match[2] === undefined ? 1 : parseInt(match[2], 16) / 255,
  };
}

export function themeColorHex(red: number, green: number, blue: number): ThemeColor {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. Alpha is ignored: contrast colours are opaque. */
export function relativeLuminance(color: ThemeColor): number {
  const parsed = parseThemeColor(color);
  if (!parsed) return 0;
  return 0.2126 * linearChannel(parsed.red) + 0.7152 * linearChannel(parsed.green) + 0.0722 * linearChannel(parsed.blue);
}

/** From 1 (the same colour) to 21 (black on white). */
export function contrastRatio(a: ThemeColor, b: ThemeColor): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export const CONTRAST_NORMAL_TEXT = 4.5;
export const CONTRAST_LARGER_OR_NONTEXT = 3;

function readableInk(accent: ThemeColor): ThemeColor {
  const black = contrastRatio("#000000", accent);
  const white = contrastRatio("#FFFFFF", accent);
  return white > black ? "#FFFFFF" : "#000000";
}

export interface ReadableAccent {
  accent: ThemeColor;
  on_accent: ThemeColor;
  adjusted: boolean;
}

/** True when the accent is readable for normal text and for adjacent surfaces. */
export function accentMeetsContrast(accent: ThemeColor, backgrounds: readonly ThemeColor[]): boolean {
  if (parseThemeColor(accent) === null) return false;
  if (contrastRatio(readableInk(accent), accent) < CONTRAST_NORMAL_TEXT) return false;
  return backgrounds.every((background) => contrastRatio(accent, background) >= CONTRAST_LARGER_OR_NONTEXT);
}

function rgbDistance(a: ThemeColor, b: ThemeColor): number {
  const first = parseThemeColor(a);
  const second = parseThemeColor(b);
  if (!first || !second) return Number.POSITIVE_INFINITY;
  return Math.hypot(first.red - second.red, first.green - second.green, first.blue - second.blue);
}

function interpolate(color: ThemeColor, target: 0 | 255, step: number): ThemeColor {
  const parsed = parseThemeColor(color);
  if (!parsed) return color;
  const amount = step / 255;
  return themeColorHex(
    parsed.red + (target - parsed.red) * amount,
    parsed.green + (target - parsed.green) * amount,
    parsed.blue + (target - parsed.blue) * amount,
  );
}

/** The smallest adjustment toward black or white that satisfies every surface.
 * Ties choose the darker candidate. When nothing qualifies the safe built-in
 * accent is retained by the caller (`adjusted` is false and
 * `accentMeetsContrast` remains false).
 */
export function resolveReadableAccent(
  candidate: ThemeColor,
  backgrounds: readonly ThemeColor[],
): ReadableAccent {
  if (accentMeetsContrast(candidate, backgrounds)) {
    return { accent: candidate, on_accent: readableInk(candidate), adjusted: false };
  }
  let best: { accent: ThemeColor; distance: number; luminance: number } | null = null;
  for (const target of [0, 255] as const) {
    for (let step = 1; step <= 255; step += 1) {
      const adjusted = interpolate(candidate, target, step);
      if (!accentMeetsContrast(adjusted, backgrounds)) continue;
      const distance = rgbDistance(candidate, adjusted);
      const luminance = relativeLuminance(adjusted);
      if (
        best === null ||
        distance < best.distance - 1e-9 ||
        (Math.abs(distance - best.distance) <= 1e-9 && luminance < best.luminance)
      ) {
        best = { accent: adjusted, distance, luminance };
      }
    }
  }
  if (best) {
    return { accent: best.accent, on_accent: readableInk(best.accent), adjusted: true };
  }
  return { accent: candidate, on_accent: readableInk(candidate), adjusted: false };
}

// ---------------------------------------------------------------------------
// Wallpaper palette
// ---------------------------------------------------------------------------

export interface WallpaperBin {
  packed: number;
  count: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
}

/** RGBA pixels -> 5-bit-per-channel bins, sorted by count then packed RGB. */
export function wallpaperBins(rgba: Uint8Array, width: number, height: number): WallpaperBin[] {
  const bins = new Map<number, WallpaperBin>();
  const pixels = Math.min(Math.floor(rgba.length / 4), Math.max(0, width * height));
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3];
    if (alpha === 0) continue;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const packed = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
    const existing = bins.get(packed);
    if (existing) {
      existing.count += 1;
      existing.redSum += red;
      existing.greenSum += green;
      existing.blueSum += blue;
    } else {
      bins.set(packed, { packed, count: 1, redSum: red, greenSum: green, blueSum: blue });
    }
  }
  return [...bins.values()].sort((a, b) => b.count - a.count || a.packed - b.packed);
}

export interface WallpaperColorOptions {
  maxColors?: number;
  minDistance?: number;
}

/** At most six representative colours, each at least 40 RGB units apart. */
export function wallpaperColorsFromPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: WallpaperColorOptions = {},
): ThemeColor[] {
  const maxColors = options.maxColors ?? 6;
  const minDistance = options.minDistance ?? 40;
  const colors: ThemeColor[] = [];
  for (const bin of wallpaperBins(rgba, width, height)) {
    const representative = themeColorHex(
      bin.redSum / bin.count,
      bin.greenSum / bin.count,
      bin.blueSum / bin.count,
    );
    if (colors.some((chosen) => rgbDistance(chosen, representative) < minDistance)) continue;
    colors.push(representative);
    if (colors.length >= maxColors) break;
  }
  return colors;
}

/** Automatic wallpaper reads are opt-in and never run in the background. */
export function shouldAutoReadWallpaper(followWallpaper: boolean, eligible: boolean): boolean {
  return followWallpaper && eligible;
}

// ---------------------------------------------------------------------------
// Clock schedule
// ---------------------------------------------------------------------------

/** Clock interval: day includes its start and excludes the night start. */
export function scheduleScheme(minute: number, dayStart: number, nightStart: number): ThemeScheme {
  const current = normalizeMinute(minute);
  const day = normalizeMinute(dayStart);
  const night = normalizeMinute(nightStart);
  if (day === night) return "light";
  if (day < night) return current >= day && current < night ? "light" : "dark";
  return current >= day || current < night ? "light" : "dark";
}

export function normalizeMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  const whole = Math.floor(minute);
  return ((whole % 1440) + 1440) % 1440;
}

export function isValidSchedule(dayStart: number, nightStart: number): boolean {
  return (
    Number.isInteger(dayStart) &&
    Number.isInteger(nightStart) &&
    dayStart >= 0 &&
    dayStart <= 1439 &&
    nightStart >= 0 &&
    nightStart <= 1439 &&
    dayStart !== nightStart
  );
}
