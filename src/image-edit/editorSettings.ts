/** Image-editor preferences that are applied outside the editor component
 * (schema 48, Steps 14b/18a D8). This module has no imports so the settings
 * service can apply the section at startup and after Save without loading the
 * editor controller, workers or snapshot services. */

export type ImageEditorModeSetting = "edit" | "draw";

export interface ImageEditorRuntimeSettings {
  default_mode: ImageEditorModeSetting;
  background_rgba: [number, number, number, number];
  history_limit_mb: number;
  /** Open an unsaved image in Advanced instead of the default basic mode. */
  advanced: boolean;
  /** Magic-wand and select-by-color tolerance, 0..100. */
  selection_tolerance: number;
  /** Show the Advanced History panel beside the canvas. */
  show_history: boolean;
}

const DEFAULT_SETTINGS: ImageEditorRuntimeSettings = {
  default_mode: "edit",
  background_rgba: [255, 255, 255, 255],
  history_limit_mb: 256,
  advanced: false,
  selection_tolerance: 15,
  show_history: false,
};

function copyBackground(
  value: [number, number, number, number],
): [number, number, number, number] {
  return [value[0], value[1], value[2], value[3]];
}

let current: ImageEditorRuntimeSettings = {
  ...DEFAULT_SETTINGS,
  background_rgba: copyBackground(DEFAULT_SETTINGS.background_rgba),
};

const listeners = new Set<(settings: ImageEditorRuntimeSettings) => void>();

/** Notifies a mounted editor after Save/import, so tolerance and the History
 * panel update without reopening the view. */
export function subscribeImageEditorSettings(
  listener: (settings: ImageEditorRuntimeSettings) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies schema-48 image-editor settings. Values are clamped exactly like
 * the settings normalizer: 64..256 MiB, edit/draw, four 0..255 channels and
 * tolerance 0..100. */
export function configureImageEditorSettings(settings: {
  history_limit_mb?: number;
  default_mode?: "edit" | "draw";
  background_rgba?: [number, number, number, number];
  advanced?: boolean;
  selection_tolerance?: number;
  show_history?: boolean;
}): void {
  const value = settings.history_limit_mb;
  const tolerance = settings.selection_tolerance;
  current = {
    history_limit_mb:
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(256, Math.max(64, Math.round(value)))
        : 256,
    default_mode: settings.default_mode === "draw" ? "draw" : "edit",
    background_rgba:
      Array.isArray(settings.background_rgba) && settings.background_rgba.length === 4
        ? (settings.background_rgba.map((channel) =>
            Number.isInteger(channel) && channel >= 0 && channel <= 255 ? channel : 255,
          ) as [number, number, number, number])
        : copyBackground(current.background_rgba),
    advanced: settings.advanced === true,
    selection_tolerance:
      typeof tolerance === "number" && Number.isFinite(tolerance)
        ? Math.min(100, Math.max(0, Math.round(tolerance)))
        : 15,
    show_history: settings.show_history === true,
  };
  const applied = imageEditorRuntimeSettings();
  for (const listener of listeners) listener(applied);
}

/** A copy, so a caller cannot mutate the applied settings. */
export function imageEditorRuntimeSettings(): ImageEditorRuntimeSettings {
  return {
    ...current,
    background_rgba: copyBackground(current.background_rgba),
  };
}
