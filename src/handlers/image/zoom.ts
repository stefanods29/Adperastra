/** Zoom math for the image viewer (pure, unit-tested). Percent values. */

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 1600;
export const ZOOM_STEPS = [5, 10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1200, 1600];

export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
}

/** The percent that fits the whole image in the box, never above 100 %. */
export function fitPercent(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): number {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 100;
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight, 1);
  return clampZoom(scale * 100);
}

/** The next zoom step above (direction 1) or below (-1) the current value. */
export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((step) => step > current) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < current) ?? MIN_ZOOM;
}
