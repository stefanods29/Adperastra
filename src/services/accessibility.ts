import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { contrastRatio } from "../appearance/themeMath";
import type { ThemeColor } from "./customThemes";
import { isTauriRuntime } from "./settings";

/** Accessibility preferences and effective state (Step 10f, accessibility-1).
 * The persisted shape is AccessibilitySettings; what the UI actually follows
 * is EffectiveAccessibility, where Windows forced colors, reduced motion and
 * text scale win over stored choices without overwriting them. */

export type FocusPx = 2 | 3 | 4;
export type CursorSize = "normal" | "large" | "xlarge";
export type ColorMode = "none" | "deuteranopia" | "protanopia" | "tritanopia";
export type ReducedMotionSetting = "system" | "on" | "off";
export type SubtitlePosition = "bottom" | "top";

export interface SubtitleAccessibility {
  font_percent: number;
  text_color: string;
  background_color: string;
  background_opacity: number;
  position: SubtitlePosition;
}

export interface AccessibilitySettings {
  large_targets: boolean;
  focus_px: FocusPx;
  cursor: CursorSize;
  color_mode: ColorMode;
  dyslexic_font: boolean;
  letter_spacing_em: number;
  word_spacing_em: number;
  line_height: number;
  simple_mode: boolean;
  persistent_toasts: boolean;
  reduced_motion: ReducedMotionSetting;
  no_autoplay: boolean;
  double_click_ms?: number;
  hover_ms: number;
  drag_threshold_px: number;
  completion_sound: boolean;
  sound_volume: number;
  subtitle: SubtitleAccessibility;
  read_voice_id?: string;
  read_rate: number;
  read_volume: number;
  auto_captions: boolean;
}

export interface SystemAccessibility {
  forced_colors: boolean;
  reduced_motion: boolean;
  text_scale: number;
  double_click_ms: number;
  generation: number;
}

export interface EffectiveAccessibility {
  settings: AccessibilitySettings;
  forced_colors: boolean;
  reduce_motion: boolean;
  effective_zoom: number;
  target_px: 24 | 44;
  generation: number;
}

export const COLOR_MODES: readonly ColorMode[] = ["none", "deuteranopia", "protanopia", "tritanopia"];
export const CURSOR_SIZES: readonly CursorSize[] = ["normal", "large", "xlarge"];
export const REDUCED_MOTION_SETTINGS: readonly ReducedMotionSetting[] = ["system", "on", "off"];
export const SUBTITLE_POSITIONS: readonly SubtitlePosition[] = ["bottom", "top"];

/** App zoom options (Step 10f D3). Steps 05d scales 75-200 are preserved;
 * 225-300 are the additive accessibility-1 extension (U1). */
export const ACCESSIBILITY_ZOOMS: readonly number[] = [
  75, 90, 100, 110, 125, 150, 175, 200, 225, 250, 275, 300,
];
export const MAX_EFFECTIVE_ZOOM = 300;

/** Okabe-Ito palette in listed order, then the per-mode category orders of
 * D4. `none` keeps the listed order; the three listed orders belong to
 * deuteranopia/protanopia/tritanopia respectively (see handoff note). */
export const COLOR_PALETTE: readonly string[] = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#F0E442",
  "#0072B2",
  "#D55E00",
  "#CC79A7",
  "#000000",
];
export const COLOR_MODE_ORDERS: Readonly<Record<ColorMode, readonly number[]>> = {
  none: [0, 1, 2, 3, 4, 5, 6, 7],
  deuteranopia: [0, 1, 2, 3, 4, 5, 6, 7],
  protanopia: [4, 1, 2, 5, 6, 0, 3, 7],
  tritanopia: [5, 2, 0, 4, 6, 1, 3, 7],
};

export function defaultSubtitleAccessibility(): SubtitleAccessibility {
  return {
    font_percent: 100,
    text_color: "#FFFFFF",
    background_color: "#000000",
    background_opacity: 0.75,
    position: "bottom",
  };
}

export function defaultAccessibilitySettings(): AccessibilitySettings {
  return {
    large_targets: false,
    focus_px: 2,
    cursor: "normal",
    color_mode: "none",
    dyslexic_font: false,
    letter_spacing_em: 0,
    word_spacing_em: 0,
    line_height: 1.4,
    simple_mode: false,
    persistent_toasts: false,
    reduced_motion: "system",
    no_autoplay: false,
    hover_ms: 600,
    drag_threshold_px: 4,
    completion_sound: false,
    sound_volume: 0.2,
    subtitle: defaultSubtitleAccessibility(),
    read_rate: 1,
    read_volume: 1,
    auto_captions: false,
  };
}

export function accessibilityError(): Error {
  return new Error("accessibility.invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function validSubtitle(value: unknown): value is SubtitleAccessibility {
  if (!isRecord(value)) return false;
  return (
    finiteIn(value.font_percent, 75, 300) &&
    typeof value.text_color === "string" &&
    HEX6_RE.test(value.text_color) &&
    typeof value.background_color === "string" &&
    HEX6_RE.test(value.background_color) &&
    finiteIn(value.background_opacity, 0, 1) &&
    (SUBTITLE_POSITIONS as readonly string[]).includes(value.position as string)
  );
}

/** Strict shape check for persisted or imported preferences. Any value
 * outside the guide bounds makes the whole section invalid; callers fall
 * back to defaults for the section instead of keeping half-valid data. */
export function isValidAccessibilitySettings(value: unknown): value is AccessibilitySettings {
  if (!isRecord(value)) return false;
  if (typeof value.large_targets !== "boolean") return false;
  if (value.focus_px !== 2 && value.focus_px !== 3 && value.focus_px !== 4) return false;
  if (!(CURSOR_SIZES as readonly string[]).includes(value.cursor as string)) return false;
  if (!(COLOR_MODES as readonly string[]).includes(value.color_mode as string)) return false;
  if (typeof value.dyslexic_font !== "boolean") return false;
  if (!finiteIn(value.letter_spacing_em, 0, 0.2)) return false;
  if (!finiteIn(value.word_spacing_em, 0, 0.5)) return false;
  if (!finiteIn(value.line_height, 1, 2)) return false;
  if (typeof value.simple_mode !== "boolean") return false;
  if (typeof value.persistent_toasts !== "boolean") return false;
  if (!(REDUCED_MOTION_SETTINGS as readonly string[]).includes(value.reduced_motion as string)) {
    return false;
  }
  if (typeof value.no_autoplay !== "boolean") return false;
  if (value.double_click_ms !== undefined && !finiteIn(value.double_click_ms, 100, 1000)) {
    return false;
  }
  if (!finiteIn(value.hover_ms, 200, 2000)) return false;
  if (!finiteIn(value.drag_threshold_px, 2, 32)) return false;
  if (typeof value.completion_sound !== "boolean") return false;
  if (!finiteIn(value.sound_volume, 0, 1)) return false;
  if (!validSubtitle(value.subtitle)) return false;
  // A stored combination that no longer reaches 4.5:1 is refused as a whole
  // (P6); the section then falls back to defaults instead of shipping
  // unreadable cues.
  if (!subtitleMeetsContrast(value.subtitle)) return false;
  if (
    value.read_voice_id !== undefined &&
    (typeof value.read_voice_id !== "string" || [...value.read_voice_id].length > 512)
  ) {
    return false;
  }
  if (!finiteIn(value.read_rate, 0.5, 2)) return false;
  if (!finiteIn(value.read_volume, 0, 1)) return false;
  if (typeof value.auto_captions !== "boolean") return false;
  return true;
}

export function validateAccessibilitySettings(value: unknown): AccessibilitySettings {
  if (!isValidAccessibilitySettings(value)) throw accessibilityError();
  return value;
}

export function isValidSystemAccessibility(value: unknown): value is SystemAccessibility {
  if (!isRecord(value)) return false;
  return (
    typeof value.forced_colors === "boolean" &&
    typeof value.reduced_motion === "boolean" &&
    finiteIn(value.text_scale, 1, 3) &&
    typeof value.double_click_ms === "number" &&
    Number.isInteger(value.double_click_ms) &&
    value.double_click_ms >= 0 &&
    value.double_click_ms <= 65535 &&
    typeof value.generation === "number" &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
  );
}

/** The palette colors in category order for a mode. Categories must still
 * carry a distinct label, icon or pattern; color alone never identifies. */
export function paletteForMode(mode: ColorMode): string[] {
  return COLOR_MODE_ORDERS[mode].map((index) => COLOR_PALETTE[index]);
}

/** WCAG contrast of subtitle text over its background blended at the chosen
 * opacity onto black. Uses the shared 10a contrast math (U2). */
export function subtitleContrast(subtitle: SubtitleAccessibility): number {
  const blend = (hex: string): ThemeColor => {
    const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16);
    const mix = (value: number) => Math.round(value * subtitle.background_opacity);
    const toHex = (value: number) => value.toString(16).padStart(2, "0");
    return `#${toHex(mix(channel(1)))}${toHex(mix(channel(3)))}${toHex(mix(channel(5)))}` as ThemeColor;
  };
  return contrastRatio(subtitle.text_color as ThemeColor, blend(subtitle.background_color));
}

export function subtitleMeetsContrast(subtitle: SubtitleAccessibility): boolean {
  return subtitleContrast(subtitle) >= 4.5;
}

function snapZoom(candidate: number): number {
  for (const scale of ACCESSIBILITY_ZOOMS) {
    if (candidate <= scale + 1e-9) return scale;
  }
  return MAX_EFFECTIVE_ZOOM;
}

/** Combines stored preferences, the user's zoom request and the Windows
 * snapshot. Windows reduced motion cannot be overridden off, forced colors
 * are reported (the OS palette applies through CSS), and zoom is the larger
 * of the two requests snapped to an allowed scale, never their product. */
export function resolveAccessibility(
  settings: AccessibilitySettings,
  userZoom: number,
  system: SystemAccessibility,
): EffectiveAccessibility {
  validateAccessibilitySettings(settings);
  if (!isValidSystemAccessibility(system)) throw accessibilityError();
  if (!(ACCESSIBILITY_ZOOMS as readonly number[]).includes(userZoom)) throw accessibilityError();
  const windowsZoom = system.text_scale * 100;
  const effective_zoom = Math.min(MAX_EFFECTIVE_ZOOM, snapZoom(Math.max(userZoom, windowsZoom)));
  const reduce_motion = system.reduced_motion
    ? true
    : settings.reduced_motion === "on"
      ? true
      : settings.reduced_motion === "off"
        ? false
        : system.reduced_motion;
  return {
    settings,
    forced_colors: system.forced_colors,
    reduce_motion,
    effective_zoom,
    target_px: settings.large_targets ? 44 : 24,
    generation: system.generation,
  };
}

/** Coalesces webview media-query signals over a native snapshot (D1). The
 * stored preferences are never rewritten by system state. */
export function systemFromMedia(
  base: SystemAccessibility,
  media: { forcedColors: boolean; reducedMotion: boolean },
): SystemAccessibility {
  return {
    ...base,
    forced_colors: base.forced_colors || media.forcedColors,
    reduced_motion: base.reduced_motion || media.reducedMotion,
    generation: base.generation + 1,
  };
}

function browserSystemSnapshot(): SystemAccessibility {
  const media = (query: string) =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  return {
    forced_colors: media("(forced-colors: active)"),
    reduced_motion: media("(prefers-reduced-motion: reduce)"),
    text_scale: 1,
    double_click_ms: 500,
    generation: 0,
  };
}

/** Current Windows accessibility snapshot. Outside Tauri (browser preview,
 * tests) the webview media queries are the only available source. */
export async function getSystemAccessibility(): Promise<SystemAccessibility> {
  if (!isTauriRuntime()) return browserSystemSnapshot();
  const value: unknown = await invoke("accessibility_system_state");
  if (!isValidSystemAccessibility(value)) throw accessibilityError();
  return value;
}

/** Subscribes to `accessibility-system` snapshots. The returned function
 * removes the listener (P-28). */
export async function onSystemAccessibility(
  listener: (system: SystemAccessibility) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => undefined;
    }
    const forced = window.matchMedia("(forced-colors: active)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => listener(browserSystemSnapshot());
    forced.addEventListener?.("change", update);
    reduced.addEventListener?.("change", update);
    return () => {
      forced.removeEventListener?.("change", update);
      reduced.removeEventListener?.("change", update);
    };
  }
  return listen("accessibility-system", (event) => {
    if (isValidSystemAccessibility(event.payload)) listener(event.payload);
  });
}

/** Effective motor timings (D8): an explicit double-click choice wins, else
 * the Windows value from the system snapshot. */
export function effectiveDoubleClickMs(
  settings: AccessibilitySettings,
  system: SystemAccessibility,
): number {
  return settings.double_click_ms ?? system.double_click_ms;
}

/** Simple mode hides only advanced presentation (D9). It never changes
 * command availability or safety rules, so a hidden action stays reachable
 * by shortcut and from the command palette. */
export function presentationVisible(advanced: boolean | undefined, settings: AccessibilitySettings): boolean {
  return !settings.simple_mode || advanced !== true;
}

/** Protected views never autoplay; otherwise the stored preference rules. */
export function autoplayAllowed(settings: AccessibilitySettings, protectedView: boolean): boolean {
  return !protectedView && !settings.no_autoplay;
}

/** Animated images show their first frame as a poster when motion is
 * reduced or autoplay is off (D10). */
export function posterOnly(settings: AccessibilitySettings, effective: EffectiveAccessibility): boolean {
  return settings.no_autoplay || effective.reduce_motion;
}

/** A completion sound is optional and brief; the visual toast always
 * happens, so no result is ever sound-only (D7). */
export function completionFeedback(settings: AccessibilitySettings): { sound: boolean; visual: true } {
  return { sound: settings.completion_sound, visual: true };
}
