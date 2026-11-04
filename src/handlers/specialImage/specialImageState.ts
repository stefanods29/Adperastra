/** Saved state for RAW/HEIC image tabs (Step 07g D4). */
import type { SpecialImageState } from "../../services/specialViews";

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 400;
export const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400];

export function readSpecialImageState(state: unknown): SpecialImageState {
  const value = (state ?? {}) as Partial<SpecialImageState>;
  const zoom = typeof value.zoom === "number" && value.zoom >= MIN_ZOOM && value.zoom <= MAX_ZOOM ? Math.round(value.zoom) : 100;
  const rotation = value.rotation === 90 || value.rotation === 180 || value.rotation === 270 ? value.rotation : 0;
  return {
    zoom,
    rotation,
    layers_open: value.layers_open !== false,
    // D5: restoring a tab must not start a background full decode.
    full_resolution: false,
  };
}

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > current) ?? MAX_ZOOM;
  const lower = [...ZOOM_STEPS].reverse().find((step) => step < current);
  return lower ?? MIN_ZOOM;
}

export function rotate(current: 0 | 90 | 180 | 270, clockwise: boolean): 0 | 90 | 180 | 270 {
  return ((current + (clockwise ? 90 : 270)) % 360) as 0 | 90 | 180 | 270;
}
