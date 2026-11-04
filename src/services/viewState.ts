import type { SerializableViewState } from "../documents/types";

/** View-state codecs (Step 09a D6/E7). A handler registers one codec; the
 * session stores only what a codec encoded, and restores only what a codec
 * decodes. Unknown handlers or codec versions keep a recoverable
 * placeholder tab and are never invoked. */

export interface ViewStateCodec {
  version: number;
  encode(state: unknown): SerializableViewState | null;
  decode(state: SerializableViewState): unknown | null;
}

const codecs = new Map<string, ViewStateCodec>();

export function registerViewStateCodec(handlerId: string, codec: ViewStateCodec): void {
  if (!handlerId || !Number.isSafeInteger(codec.version) || codec.version < 0) {
    throw new Error("tabs.invalid_state");
  }
  if (codecs.has(handlerId)) throw new Error("tabs.invalid_state");
  codecs.set(handlerId, codec);
}

export function viewStateCodec(handlerId: string): ViewStateCodec | null {
  return codecs.get(handlerId) ?? null;
}

/** Test and hot-reload helper: forget every registered codec. */
export function clearViewStateCodecs(): void {
  codecs.clear();
}

export const MAX_VIEW_STATE_BYTES = 64 * 1024;
export const MAX_VIEW_STATE_DEPTH = 8;
export const MAX_VIEW_STATE_KEYS = 64;
export const MAX_VIEW_STATE_STRING = 8192;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when `value` stays inside the D6 caps: JSON primitives, arrays and
 * plain objects only; depth 8; 64 keys per object; strings of 8,192 units;
 * finite numbers; no prototype keys; at most 64 KiB as JSON. */
export function isSerializableViewState(value: unknown): value is SerializableViewState {
  const seen = new Set<object>();
  const check = (entry: unknown, depth: number): boolean => {
    if (depth > MAX_VIEW_STATE_DEPTH) return false;
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") {
      return typeof entry !== "string" || entry.length <= MAX_VIEW_STATE_STRING;
    }
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry)) {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return entry.every((item) => check(item, depth + 1));
    }
    if (!isPlainObject(entry)) return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
    const keys = Object.keys(entry);
    if (keys.length > MAX_VIEW_STATE_KEYS) return false;
    return keys.every((key) => !FORBIDDEN_KEYS.has(key) && check(entry[key], depth + 1));
  };
  if (!check(value, 0)) return false;
  try {
    return JSON.stringify(value).length <= MAX_VIEW_STATE_BYTES;
  } catch {
    return false;
  }
}

/** Encode through the handler's codec and re-validate the result, so a
 * codec can never smuggle live objects, tokens or text content into the
 * session. Returns null when there is no codec or the state is invalid. */
export function encodeViewState(handlerId: string, state: unknown): { view: SerializableViewState; view_version: number } | null {
  const codec = codecs.get(handlerId);
  if (!codec) return null;
  let encoded: SerializableViewState | null;
  try {
    encoded = codec.encode(state);
  } catch {
    return null;
  }
  if (encoded === null || !isSerializableViewState(encoded)) return null;
  return { view: encoded, view_version: codec.version };
}

/** Decode a stored state. A version mismatch or an invalid payload returns
 * null (the tab opens with defaults) instead of throwing. */
export function decodeViewState(
  handlerId: string,
  view: SerializableViewState,
  viewVersion: number | undefined,
): unknown | null {
  const codec = codecs.get(handlerId);
  if (!codec) return null;
  if (viewVersion !== undefined && viewVersion !== codec.version) return null;
  if (!isSerializableViewState(view)) return null;
  try {
    return codec.decode(view);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Built-in codecs for the handlers that already keep view state. These are
// registered by the coordinator from `handlers/index.ts` (see the shared
// edit proposal); they only normalize the shapes the views already save.
// ---------------------------------------------------------------------------

function record(value: SerializableViewState): Record<string, SerializableViewState> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finite(value: SerializableViewState | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Image (04a): `{mode, percent, turns}`; fit/manual and turns survive. */
export const imageViewStateCodec: ViewStateCodec = {
  version: 1,
  encode(state) {
    const value = (state ?? {}) as { mode?: unknown; percent?: unknown; turns?: unknown };
    const mode = value.mode === "manual" ? "manual" : "fit";
    const percent = typeof value.percent === "number" && Number.isFinite(value.percent) ? clamp(value.percent, 10, 800) : 100;
    const turns = typeof value.turns === "number" && Number.isFinite(value.turns) ? ((Math.round(value.turns) % 4) + 4) % 4 : 0;
    return { mode, percent, turns };
  },
  decode(state) {
    const value = record(state);
    return imageViewStateCodec.encode(value);
  },
};

const MEDIA_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Media (04c): speed/loop, plus position (never autoplays on restore). */
export const mediaViewStateCodec: ViewStateCodec = {
  version: 1,
  encode(state) {
    const value = (state ?? {}) as { speed?: unknown; loop?: unknown; position_ms?: unknown };
    const speed = typeof value.speed === "number" && MEDIA_SPEEDS.includes(value.speed) ? value.speed : 1;
    const position = typeof value.position_ms === "number" && Number.isFinite(value.position_ms) ? Math.max(0, Math.floor(value.position_ms)) : 0;
    return { speed, loop: value.loop === true, position_ms: position, autoplay: false };
  },
  decode(state) {
    const value = record(state);
    const encoded = mediaViewStateCodec.encode(value);
    return encoded === null ? null : { ...record(encoded), autoplay: false };
  },
};

/** Text (06a): wrap/numbers/zoom/spellcheck plus cursor and scroll. The
 * file's text itself is never part of the state. */
export const textViewStateCodec: ViewStateCodec = {
  version: 1,
  encode(state) {
    const value = (state ?? {}) as Record<string, unknown>;
    return {
      wrap: value.wrap === true,
      numbers: value.numbers !== false,
      zoom: typeof value.zoom === "number" && Number.isFinite(value.zoom) ? clamp(value.zoom, 0.7, 3) : 1,
      spellcheck: value.spellcheck === true,
      cursor_line: Math.max(0, Math.floor(finite(value.cursor_line as SerializableViewState, 0))),
      cursor_column: Math.max(0, Math.floor(finite(value.cursor_column as SerializableViewState, 0))),
      scroll_top: clamp(finite(value.scroll_top as SerializableViewState, 0), 0, 1e9),
    };
  },
  decode(state) {
    return textViewStateCodec.encode(record(state));
  },
};
