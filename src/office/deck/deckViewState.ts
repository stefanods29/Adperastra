import type { SerializableViewState } from "../../documents/types";
import type { TextPosition, TextSpan } from "../types";
import {
  deckRibbonTabIds,
  defaultDeckViewState,
  defaultDeckViewport,
  type DeckEditorViewState,
  type DeckSelection,
} from "./deckUiTypes";

/** Bounded view-state codec of the slide editor (Step 22a E4, 09a version 1).
 * Only view choices survive: selection shape, viewport numbers, tab and panel
 * flags. Unknown values are dropped instead of being carried forward. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MAX_SLIDES_IN_SELECTION = 1000;
const MAX_SHAPES_IN_SELECTION = 1000;
const MAX_VIEWPORT_PX = 16384;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.trunc(finite(value, fallback, min, max));
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function uuidList(value: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const id = uuid(entry);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function position(value: unknown): TextPosition | null {
  const item = record(value);
  const blockId = uuid(item.block_id);
  if (!blockId) return null;
  if (typeof item.offset_utf16 !== "number" || !Number.isInteger(item.offset_utf16) ||
      item.offset_utf16 < 0 || item.offset_utf16 > 0xffffffff) return null;
  return { block_id: blockId, offset_utf16: item.offset_utf16 };
}

function span(value: unknown): TextSpan | null {
  const item = record(value);
  const anchor = position(item.anchor);
  const focus = position(item.focus);
  if (!anchor || !focus) return null;
  if (typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) ||
      item.revision < 0) return null;
  return { anchor, focus, revision: item.revision };
}

/** A deck selection: at least one slide, optional shapes, optional text span. */
export function normalizeDeckSelection(value: unknown): DeckSelection | null {
  const item = record(value);
  if (item.kind !== "deck") return null;
  const slideIds = uuidList(item.slide_ids, 1, MAX_SLIDES_IN_SELECTION);
  if (!slideIds) return null;
  const shapeIds = uuidList(item.shape_ids ?? [], 0, MAX_SHAPES_IN_SELECTION);
  if (!shapeIds) return null;
  let textSpan: TextSpan | null = null;
  if (item.text_span !== undefined && item.text_span !== null) {
    textSpan = span(item.text_span);
    if (!textSpan) return null;
  }
  return { kind: "deck", slide_ids: slideIds, shape_ids: shapeIds, text_span: textSpan };
}

/** Clamp one viewport; render revisions are runtime-only and restart at 0. */
export function normalizeDeckViewport(value: unknown) {
  const item = record(value);
  return {
    x_px: finite(item.x_px, 0, 0, 1e9),
    y_px: finite(item.y_px, 0, 0, 1e9),
    width_px: integer(item.width_px, defaultDeckViewport().width_px, 1, MAX_VIEWPORT_PX),
    height_px: integer(item.height_px, defaultDeckViewport().height_px, 1, MAX_VIEWPORT_PX),
    zoom_percent: finite(item.zoom_percent, 100, 10, 400),
    device_scale: finite(item.device_scale, 1, 0.5, 4),
    view_revision: 0,
  };
}

/** Allowlist copy of one saved deck view. */
export function normalizeDeckViewState(value: unknown): DeckEditorViewState {
  const item = record(value);
  const fallback = defaultDeckViewState();
  return {
    slide_id: uuid(item.slide_id),
    selection: normalizeDeckSelection(item.selection),
    viewport: normalizeDeckViewport(item.viewport),
    active_ribbon_tab:
      deckRibbonTabIds.find((id) => id === item.active_ribbon_tab) ?? fallback.active_ribbon_tab,
    notes_open: item.notes_open !== false,
    slides_open: item.slides_open !== false,
    comments_open: item.comments_open === true,
    snap: item.snap === true,
  };
}

export const deckViewStateCodec = {
  version: 1,
  encode(value: unknown): SerializableViewState | null {
    if (value === null || typeof value !== "object") return null;
    // The JSON copy also proves the value is plain serializable data.
    return JSON.parse(JSON.stringify(normalizeDeckViewState(value))) as SerializableViewState;
  },
  decode(value: SerializableViewState): DeckEditorViewState | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return normalizeDeckViewState(value);
  },
};
