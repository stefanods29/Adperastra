import type { SerializableViewState } from "../../documents/types";
import type { OfficeSelection, TextPosition } from "../types";
import { documentTabIds, type DocumentEditorViewState } from "./documentUiTypes";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : {};
}
function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function position(value: unknown): TextPosition | null {
  const item = record(value);
  if (typeof item.block_id !== "string" || !uuid.test(item.block_id) ||
      typeof item.offset_utf16 !== "number" || !Number.isInteger(item.offset_utf16) ||
      item.offset_utf16 < 0 || item.offset_utf16 > 0xffffffff) return null;
  return { block_id: item.block_id, offset_utf16: item.offset_utf16 };
}
function selection(value: unknown): OfficeSelection | null {
  const item = record(value);
  const span = record(item.span);
  const anchor = position(span.anchor);
  const focus = position(span.focus);
  if (item.kind !== "document" || !anchor || !focus ||
      typeof span.revision !== "number" || !Number.isSafeInteger(span.revision) || span.revision < 0) return null;
  return {
    kind: "document", page: Math.trunc(finite(item.page, 1, 1, 0xffffffff)),
    span: { anchor, focus, revision: span.revision },
  };
}

/** An allowlist copy, never persistence of an engine object or document contents. */
export function normalizeDocumentViewState(value: unknown): DocumentEditorViewState {
  const item = record(value);
  const viewport = record(item.viewport);
  return {
    selection: selection(item.selection),
    viewport: {
      x_px: finite(viewport.x_px, 0, 0, 1e9), y_px: finite(viewport.y_px, 0, 0, 1e9),
      width_px: Math.trunc(finite(viewport.width_px, 640, 1, 16384)),
      height_px: Math.trunc(finite(viewport.height_px, 800, 1, 16384)),
      zoom_percent: finite(viewport.zoom_percent, 100, 10, 400),
      device_scale: finite(viewport.device_scale, 1, 0.5, 4),
      // A render generation is runtime-only, never reused across view lifetimes.
      view_revision: 0,
    },
    navigation_open: item.navigation_open === true,
    comments_open: item.comments_open === true,
    ruler: item.ruler !== false,
    active_ribbon_tab: documentTabIds.find((id) => id === item.active_ribbon_tab) ?? "doc.home",
  };
}

export const documentViewStateCodec = {
  version: 1,
  encode(value: unknown): SerializableViewState | null {
    if (value === null || typeof value !== "object") return null;
    // JSON copy also ensures this is the canonical plain JSON value type.
    return JSON.parse(JSON.stringify(normalizeDocumentViewState(value))) as SerializableViewState;
  },
  decode(value: SerializableViewState): DocumentEditorViewState | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return normalizeDocumentViewState(value);
  },
};
