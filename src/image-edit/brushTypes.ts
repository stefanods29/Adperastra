import { fail, isUuid } from "./types";

/** Painting contracts (Step 18b, interface revision `image-brush-1`).
 *
 * These are the canonical brush settings and samples used by the brush, fill,
 * gradient and clone tools. The 14b `brush.ts` keeps its basic drawing
 * helpers; 18b adds `paintStroke` there and imports these types instead of
 * defining a second settings shape.
 */

export type BrushMode = "paint" | "erase" | "clone";
export type BrushSampleSource = "composite" | "layer";

export interface BrushSettings {
  /** Brush diameter in canvas pixels, 1..2048. */
  width: number;
  /** 0 (soft edge) to 1 (hard edge). */
  hardness: number;
  /** 0..1. */
  opacity: number;
  /** 0..1; multiplies the stamp alpha together with opacity. */
  flow: number;
  /** Stamp interval in brush diameters, 0.01..2. */
  spacing: number;
  /** Straight RGBA8; the alpha channel is the brush color's transparency. */
  color: [number, number, number, number];
  mode: BrushMode;
  /** Default true: width follows pen pressure. */
  pressure_size: boolean;
  /** Default false: opacity does not follow pen pressure. */
  pressure_opacity: boolean;
  /** Clone source; default `layer`. */
  sample: BrushSampleSource;
}

/** One pointer event in canvas (source-pixel) coordinates. */
export interface BrushSample {
  x: number;
  y: number;
  /** 0..1; a mouse always reports 1. */
  pressure: number;
  /** Tilt in degrees, -90..90. */
  tilt_x: number;
  tilt_y: number;
  /** Safe integer microseconds from the gesture start. */
  time_us: number;
}

export const BRUSH_MIN_WIDTH = 1;
export const BRUSH_MAX_WIDTH = 2048;
export const BRUSH_MIN_SPACING = 0.01;
export const BRUSH_MAX_SPACING = 2;
export const BRUSH_MAX_SAMPLES = 100_000;
export const BRUSH_DEFAULT_WIDTH = 20;
export const BRUSH_DEFAULT_HARDNESS = 0.8;
export const BRUSH_DEFAULT_OPACITY = 1;
export const BRUSH_DEFAULT_FLOW = 1;
export const BRUSH_DEFAULT_SPACING = 0.25;

export function defaultBrushSettings(): BrushSettings {
  return {
    width: BRUSH_DEFAULT_WIDTH,
    hardness: BRUSH_DEFAULT_HARDNESS,
    opacity: BRUSH_DEFAULT_OPACITY,
    flow: BRUSH_DEFAULT_FLOW,
    spacing: BRUSH_DEFAULT_SPACING,
    color: [0, 0, 0, 255],
    mode: "paint",
    pressure_size: true,
    pressure_opacity: false,
    sample: "layer",
  };
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateBrushSettings(settings: BrushSettings): void {
  if (!settings || typeof settings !== "object") fail("image_edit.bad_request");
  if (typeof settings.width !== "number" || !Number.isFinite(settings.width)) fail("image_edit.bad_request");
  if (settings.width < BRUSH_MIN_WIDTH || settings.width > BRUSH_MAX_WIDTH) fail("image_edit.bad_request");
  if (!isUnit(settings.hardness) || !isUnit(settings.opacity) || !isUnit(settings.flow)) fail("image_edit.bad_request");
  if (typeof settings.spacing !== "number" || !Number.isFinite(settings.spacing)) fail("image_edit.bad_request");
  if (settings.spacing < BRUSH_MIN_SPACING || settings.spacing > BRUSH_MAX_SPACING) fail("image_edit.bad_request");
  if (!Array.isArray(settings.color) || settings.color.length !== 4) fail("image_edit.bad_request");
  for (const channel of settings.color) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
  }
  if (settings.mode !== "paint" && settings.mode !== "erase" && settings.mode !== "clone") {
    fail("image_edit.bad_request");
  }
  if (typeof settings.pressure_size !== "boolean" || typeof settings.pressure_opacity !== "boolean") {
    fail("image_edit.bad_request");
  }
  if (settings.sample !== "composite" && settings.sample !== "layer") fail("image_edit.bad_request");
}

export function validateBrushSample(sample: BrushSample): void {
  if (!sample || typeof sample !== "object") fail("image_edit.bad_request");
  if (typeof sample.x !== "number" || !Number.isFinite(sample.x)) fail("image_edit.bad_request");
  if (typeof sample.y !== "number" || !Number.isFinite(sample.y)) fail("image_edit.bad_request");
  if (!isUnit(sample.pressure)) fail("image_edit.bad_request");
  if (typeof sample.tilt_x !== "number" || !Number.isFinite(sample.tilt_x) || sample.tilt_x < -90 || sample.tilt_x > 90) {
    fail("image_edit.bad_request");
  }
  if (typeof sample.tilt_y !== "number" || !Number.isFinite(sample.tilt_y) || sample.tilt_y < -90 || sample.tilt_y > 90) {
    fail("image_edit.bad_request");
  }
  if (!Number.isSafeInteger(sample.time_us) || sample.time_us < 0) fail("image_edit.bad_request");
}

export function validateBrushSamples(samples: readonly BrushSample[]): void {
  if (!Array.isArray(samples)) fail("image_edit.bad_request");
  if (samples.length < 1) fail("image_edit.bad_request");
  if (samples.length > BRUSH_MAX_SAMPLES) fail("image_edit.too_large");
  samples.forEach(validateBrushSample);
}

/** Pressure-scaled diameter. A pen at pressure 0 still paints one pixel so a
 * stroke cannot silently disappear; a mouse reports pressure 1 and keeps the
 * configured width. */
export function effectiveDiameter(settings: BrushSettings, pressure: number): number {
  if (!settings.pressure_size) return settings.width;
  const clamped = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0;
  return Math.max(1, settings.width * Math.sqrt(clamped));
}

/** Pressure-scaled opacity; off by default. */
export function effectiveOpacity(settings: BrushSettings, pressure: number): number {
  if (!settings.pressure_opacity) return settings.opacity;
  const clamped = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0;
  return settings.opacity * clamped;
}

/* ---------------------------- brush presets ----------------------------- */

/** App-owned brush presets (D9): schema 1, names and bounded settings only.
 * No executable brush, script or downloaded data is ever stored. */
export interface BrushPreset {
  id: string;
  name: string;
  settings: BrushSettings;
}

export interface BrushPresetCatalog {
  schema_version: 1;
  presets: BrushPreset[];
}

export const BRUSH_PRESET_SCHEMA_VERSION = 1;
export const MAX_BRUSH_PRESETS = 100;
export const MAX_BRUSH_PRESET_NAME = 60;

export function validateBrushPreset(preset: BrushPreset): void {
  if (!preset || !isUuid(preset.id)) fail("image_edit.bad_request");
  if (typeof preset.name !== "string") fail("image_edit.bad_request");
  const length = Array.from(preset.name).length;
  if (length < 1 || length > MAX_BRUSH_PRESET_NAME) fail("image_edit.bad_request");
  validateBrushSettings(preset.settings);
}

export function validateBrushPresetCatalog(catalog: BrushPresetCatalog): void {
  if (!catalog || catalog.schema_version !== BRUSH_PRESET_SCHEMA_VERSION) fail("image_edit.bad_request");
  if (!Array.isArray(catalog.presets) || catalog.presets.length > MAX_BRUSH_PRESETS) fail("image_edit.too_large");
  const ids = new Set<string>();
  for (const preset of catalog.presets) {
    validateBrushPreset(preset);
    if (ids.has(preset.id)) fail("image_edit.bad_request");
    ids.add(preset.id);
  }
}
