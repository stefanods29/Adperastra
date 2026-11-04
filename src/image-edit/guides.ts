import {
  createElement,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import i18n from "../i18n";
import { fail } from "./types";

/** Rulers and guides (Step 18b D5/T4).
 *
 * Guides are view-alignment data stored in an editable project; they are
 * never drawn into a flattened export. Rulers support pixels, centimeters and
 * inches at the project DPI (96 by default, 1..2400). A guide can be moved by
 * pointer or with the arrow keys; every handle is focusable. */

export type GuideAxis = "x" | "y";

export interface Guide {
  x_or_y: GuideAxis;
  position: number;
}

export type RulerUnit = "px" | "cm" | "in";

export const MAX_GUIDES = 1000;
export const GUIDE_SNAP_PX = 6;
export const RULER_SIZE = 20;
export const PROJECT_DEFAULT_DPI = 96;
export const MIN_PROJECT_DPI = 1;
export const MAX_PROJECT_DPI = 2400;
export const MIN_ZOOM_PERCENT = 10;
export const MAX_ZOOM_PERCENT = 3200;
export const PIXEL_GRID_ZOOM_PERCENT = 800;

export function validateGuide(guide: Guide, width: number, height: number): void {
  if (!guide || typeof guide !== "object") fail("image_project.bad_request");
  if (guide.x_or_y !== "x" && guide.x_or_y !== "y") fail("image_project.bad_request");
  if (typeof guide.position !== "number" || !Number.isFinite(guide.position)) fail("image_project.bad_request");
  const maximum = guide.x_or_y === "x" ? width : height;
  if (guide.position < 0 || guide.position > maximum) fail("image_project.bad_request");
}

export function validateGuides(guides: readonly Guide[], width: number, height: number): void {
  if (!Array.isArray(guides)) fail("image_project.bad_request");
  if (guides.length > MAX_GUIDES) fail("image_project.too_large");
  for (const guide of guides) validateGuide(guide, width, height);
}

export function validateDpi(dpi: number): void {
  if (!Number.isInteger(dpi) || dpi < MIN_PROJECT_DPI || dpi > MAX_PROJECT_DPI) fail("image_project.bad_request");
}

/** CSS pixels to canvas pixels at the current zoom (10..3200 %). */
export function canvasLength(cssPixels: number, zoomPercent: number): number {
  if (!Number.isFinite(cssPixels) || cssPixels < 0) fail("image_project.bad_request");
  if (!Number.isFinite(zoomPercent) || zoomPercent < MIN_ZOOM_PERCENT || zoomPercent > MAX_ZOOM_PERCENT) {
    fail("image_project.bad_request");
  }
  return (cssPixels * 100) / zoomPercent;
}

/** The 6 CSS-pixel snap radius converted to canvas pixels. */
export function snapThreshold(zoomPercent: number): number {
  return canvasLength(GUIDE_SNAP_PX, zoomPercent);
}

/** Snaps a dragged position to the nearest candidate within the threshold. */
export function snapGuide(position: number, candidates: readonly number[], threshold: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(threshold) || threshold < 0) fail("image_project.bad_request");
  let best = position;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) fail("image_project.bad_request");
    const distance = Math.abs(candidate - position);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function addGuide(guides: readonly Guide[], guide: Guide, width: number, height: number): Guide[] {
  validateGuides(guides, width, height);
  validateGuide(guide, width, height);
  if (guides.length >= MAX_GUIDES) fail("image_project.too_large");
  return [...guides, { ...guide }];
}

export function moveGuide(guides: readonly Guide[], index: number, position: number, width: number, height: number): Guide[] {
  validateGuides(guides, width, height);
  if (!Number.isInteger(index) || index < 0 || index >= guides.length) fail("image_project.bad_request");
  const next = guides.map((guide) => ({ ...guide }));
  next[index].position = position;
  validateGuide(next[index], width, height);
  return next;
}

export function removeGuide(guides: readonly Guide[], index: number, width: number, height: number): Guide[] {
  validateGuides(guides, width, height);
  if (!Number.isInteger(index) || index < 0 || index >= guides.length) fail("image_project.bad_request");
  return guides.filter((_, position) => position !== index);
}

/** Ruler labels are measured data, not markup. */
export function formatRulerValue(position: number, unit: RulerUnit, dpi: number, locale = "en"): string {
  if (!Number.isFinite(position)) fail("image_project.bad_request");
  validateDpi(dpi);
  const language = locale === "pseudo" ? "en" : locale;
  const formatter = new Intl.NumberFormat(language, { maximumFractionDigits: unit === "px" ? 0 : unit === "cm" ? 1 : 2 });
  if (unit === "px") return formatter.format(Math.round(position));
  const inches = position / dpi;
  return formatter.format(unit === "cm" ? inches * 2.54 : inches);
}

/** Whether the optional pixel grid is shown at this zoom. */
export function pixelGridVisible(zoomPercent: number): boolean {
  return zoomPercent >= PIXEL_GRID_ZOOM_PERCENT;
}

export interface GuideOverlayProps {
  guides: readonly Guide[];
  width: number;
  height: number;
  /** 10..3200. */
  zoom: number;
  units: RulerUnit;
  dpi: number;
  locale?: string;
  onChange: (guides: readonly Guide[]) => void;
}

/** Rulers, guide handles and their two add buttons. The container ignores
 * pointer events so drawing still reaches the canvas; handles and buttons
 * re-enable them. */
export function GuideOverlay({
  guides,
  width,
  height,
  zoom,
  units,
  dpi,
  locale,
  onChange,
}: GuideOverlayProps): ReactElement {
  validateGuides(guides, width, height);
  validateDpi(dpi);
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM_PERCENT || zoom > MAX_ZOOM_PERCENT) fail("image_project.bad_request");
  const language = locale ?? i18n.language;
  const scale = zoom / 100;
  const label = i18n.t("imageProject.guides");
  const add = (axis: GuideAxis) => {
    const next = addGuide(guides, { x_or_y: axis, position: Math.round((axis === "x" ? width : height) / 2) }, width, height);
    onChange(next);
  };
  const move = (index: number, position: number) => {
    const guide = guides[index];
    if (!guide) return;
    const maximum = guide.x_or_y === "x" ? width : height;
    const candidates = [0, maximum, ...guides.filter((candidate, positionIndex) => positionIndex !== index && candidate.x_or_y === guide.x_or_y).map((candidate) => candidate.position)];
    const snapped = snapGuide(position, candidates, snapThreshold(zoom));
    const next = moveGuide(guides, index, Math.min(maximum, Math.max(0, snapped)), width, height);
    onChange(next);
  };
  const handles = guides.map((guide, index) => {
    const horizontal = guide.x_or_y === "x";
    const maximum = horizontal ? width : height;
    const style: CSSProperties = horizontal
      ? { left: guide.position * scale, top: 0, height: height * scale }
      : { top: guide.position * scale, left: 0, width: width * scale };
    return createElement(
      "div",
      {
        key: `${guide.x_or_y}-${index}-${guide.position}`,
        className: `adp-paint-guide adp-paint-guide--${guide.x_or_y}`,
        style,
        role: "slider",
        tabIndex: 0,
        "aria-label": `${label} ${index + 1}`,
        "aria-orientation": horizontal ? "vertical" : "horizontal",
        "aria-valuemin": 0,
        "aria-valuemax": maximum,
        "aria-valuenow": Math.round(guide.position),
        "aria-valuetext": formatRulerValue(guide.position, units, dpi, language),
        "data-adp-guide": `${guide.x_or_y}:${index}`,
        onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
          const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
          const increase = horizontal ? "ArrowRight" : "ArrowDown";
          if (event.key === decrease || event.key === increase) {
            event.preventDefault();
            const step = event.shiftKey ? 10 : 1;
            move(index, guide.position + (event.key === increase ? step : -step));
          } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            onChange(removeGuide(guides, index, width, height));
          }
        },
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!bounds) return;
          const position = horizontal ? (event.clientX - bounds.left) / scale : (event.clientY - bounds.top) / scale;
          move(index, position);
        },
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        },
      },
      createElement("span", { className: "adp-paint-guide-grip", "aria-hidden": "true" }),
    );
  });
  const step = Math.max(1, Math.ceil(64 / scale / 10) * 10);
  const topTicks: ReactElement[] = [];
  const leftTicks: ReactElement[] = [];
  for (let position = 0; position <= width; position += step) {
    topTicks.push(
      createElement(
        "span",
        { key: `x-${position}`, className: "adp-paint-ruler-tick", style: { left: position * scale } },
        formatRulerValue(position, units, dpi, language),
      ),
    );
  }
  for (let position = 0; position <= height; position += step) {
    leftTicks.push(
      createElement(
        "span",
        { key: `y-${position}`, className: "adp-paint-ruler-tick", style: { top: position * scale } },
        formatRulerValue(position, units, dpi, language),
      ),
    );
  }
  return createElement(
    "div",
    { className: "adp-paint-rulers", "aria-label": label, role: "group" },
    createElement("div", { className: "adp-paint-ruler adp-paint-ruler--top", "aria-hidden": "true" }, ...topTicks),
    createElement("div", { className: "adp-paint-ruler adp-paint-ruler--left", "aria-hidden": "true" }, ...leftTicks),
    createElement(
      "div",
      { className: "adp-paint-guide-layer", style: { width: width * scale, height: height * scale } },
      ...handles,
    ),
    createElement(
      "div",
      { className: "adp-paint-guide-actions" },
      createElement(
        "button",
        { type: "button", className: "adp-btn adp-btn--subtle", onClick: () => add("x"), "aria-label": i18n.t("guides.addVertical") },
        i18n.t("guides.addVertical"),
      ),
      createElement(
        "button",
        { type: "button", className: "adp-btn adp-btn--subtle", onClick: () => add("y"), "aria-label": i18n.t("guides.addHorizontal") },
        i18n.t("guides.addHorizontal"),
      ),
    ),
  );
}
