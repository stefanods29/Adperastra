/** Screen/point and layout math of the slide editor (Step 22a T2, D3).
 *
 * Slide geometry is always in points. The screen is measured in CSS pixels
 * at 96 dpi, so at 100 % zoom one point is 96/72 = 4/3 screen pixels. A
 * pointer position is converted through this one pair of functions; no
 * component keeps its own scale. */

/** CSS pixels per inch used by the canvas. */
export const SCREEN_DPI = 96;
/** Points per inch used by Office geometry. */
export const POINTS_PER_INCH = 72;
/** The conversion factor at 100 % zoom. */
export const SCREEN_PX_PER_POINT = SCREEN_DPI / POINTS_PER_INCH;

/** Slide strip geometry (D2). */
export const SLIDE_STRIP_WIDTH = 196;
export const SLIDE_STRIP_MIN = 160;
export const SLIDE_STRIP_MAX = 320;
export const SLIDE_THUMBNAIL_WIDTH = 160;
export const SLIDE_THUMBNAIL_HEIGHT = 90;
export const SLIDE_STRIP_GAP = 12;
export const SLIDE_ROW_HEIGHT = SLIDE_THUMBNAIL_HEIGHT + SLIDE_STRIP_GAP + 12;
export const SLIDE_STRIP_OVERSCAN = 4;
export const CANVAS_PADDING = 16;
export const NOTES_HEIGHT_DEFAULT = 160;
export const NOTES_HEIGHT_MIN = 96;
export const NOTES_HEIGHT_MAX = 320;
export const SIDE_PANEL_WIDTH = 240;
export const MAX_SLIDES = 10_000;
export const SNAP_POINTS = 4;

/** New decks are 16:9 at 720 x 405 points (D3). */
export const DEFAULT_SLIDE_WIDTH_PT = 720;
export const DEFAULT_SLIDE_HEIGHT_PT = 405;

function zoomFactor(zoomPercent: number): number {
  const zoom = Number.isFinite(zoomPercent) ? Math.min(400, Math.max(10, zoomPercent)) : 100;
  return zoom / 100;
}

/** Convert a screen (CSS pixel) length to points at the given zoom. */
export function screenToPoints(screenPx: number, zoomPercent = 100): number {
  if (!Number.isFinite(screenPx)) return 0;
  return (screenPx * POINTS_PER_INCH) / (SCREEN_DPI * zoomFactor(zoomPercent));
}

/** Convert a point length to screen (CSS pixel) length at the given zoom. */
export function pointsToScreen(points: number, zoomPercent = 100): number {
  if (!Number.isFinite(points)) return 0;
  return (points * SCREEN_DPI * zoomFactor(zoomPercent)) / POINTS_PER_INCH;
}

/** Width / height of a slide in points. Never assumed to be 16:9. */
export function slideAspect(widthPt: number, heightPt: number): number {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    return DEFAULT_SLIDE_WIDTH_PT / DEFAULT_SLIDE_HEIGHT_PT;
  }
  return widthPt / heightPt;
}

/** The zoom percentage that fits one slide inside the available canvas. */
export function fitZoomPercent(
  slideWidthPt: number,
  slideHeightPt: number,
  availableWidthPx: number,
  availableHeightPx: number,
): number {
  const width = Math.max(1, availableWidthPx);
  const height = Math.max(1, availableHeightPx);
  const scale = Math.min(width / pointsToScreen(slideWidthPt, 100), height / pointsToScreen(slideHeightPt, 100));
  return Math.min(400, Math.max(10, Math.round(scale * 100)));
}

/** Snap one point coordinate to the 4 pt grid when snapping is on. */
export function snapPoint(value: number, enabled: boolean): number {
  if (!Number.isFinite(value)) return 0;
  return enabled ? Math.round(value / SNAP_POINTS) * SNAP_POINTS : value;
}

export interface SlideVirtualWindow {
  start: number;
  end: number;
  total: number;
  itemHeight: number;
}

/** The slice of the slide strip that must be mounted. At most a viewport of
 * thumbnails plus the 4-item overscan is rendered, even for 10,000 slides. */
export function slideVirtualWindow(options: {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  itemHeight?: number;
  overscan?: number;
}): SlideVirtualWindow {
  const count = Math.max(0, Math.min(MAX_SLIDES, Math.trunc(options.count) || 0));
  const itemHeight = options.itemHeight && options.itemHeight > 0 ? options.itemHeight : SLIDE_ROW_HEIGHT;
  const overscan = Math.max(0, Math.min(32, Math.trunc(options.overscan ?? SLIDE_STRIP_OVERSCAN)));
  const scrollTop = Number.isFinite(options.scrollTop) ? Math.max(0, options.scrollTop) : 0;
  const viewportHeight = Number.isFinite(options.viewportHeight)
    ? Math.max(0, options.viewportHeight)
    : 0;
  const first = Math.floor(scrollTop / itemHeight);
  const visible = Math.ceil(viewportHeight / itemHeight) + 1;
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, first + visible + overscan));
  return { start, end, total: count, itemHeight };
}

/** Keep a strip or notes panel size inside its documented bounds. */
export function clampPanelSize(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
