import type { DocumentRef, SerializableViewState } from "../documents/types";
import { isAbsolutePath, validateDocumentRef } from "../documents/types";
import type { FolderTabState } from "./folderState";
import { validateFolderTabState } from "./folderState";
import type {
  SavedSplitDescriptor,
  SplitDirection,
  SplitLeaf,
  SplitLeafMissing,
  SplitSide,
  SplitState,
} from "./splitViews";
import { isSerializableViewState } from "./viewState";

/** Validation and bounds for split views (Step 09i, split-view-1).
 *
 * The canonical split *types* live in `splitViews.ts`; this module is the
 * only place that decides whether untrusted split data (session JSON, a
 * saved group, a drop descriptor) may become a live `SplitState`. It is
 * imported by `splitViews.ts`, `splitRestore.ts` and the session/catalog
 * normalizers, and never imports a runtime value from `splitViews.ts`
 * (type-only import), so there is no module cycle.
 *
 * Limits fixed by the guide, Decisions 1-6 and the Data table:
 * two leaves, ratio 0.2-0.8, 240 x 180 px per leaf, 6 px divider,
 * 64 KiB view state per leaf, 128-character view ids, and a 255-character
 * outer title (the session tab cap). */

/** A split view always has exactly two sides: this is the nest guard. */
export const MAX_SPLIT_LEAVES = 2;
export const MAX_SPLIT_VIEW_ID_CHARS = 128;
export const MAX_SPLIT_TITLE_CHARS = 512;
export const MAX_SPLIT_HANDLER_CHARS = 64;
/** Per-leaf view state, the same 64 KiB the session allows per tab. */
export const MAX_SPLIT_VIEW_BYTES = 64 * 1024;
/** The outer split tab is one session tab, so its composed title stays
 * inside the existing 255-character session title cap. */
export const MAX_SPLIT_TAB_TITLE_CHARS = 255;

export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_RATIO_STEP = 0.01;
export const SPLIT_RATIO_STEP_LARGE = 0.05;

/** Below this each leaf would be unusable, so the host shows one side. */
export const SPLIT_LEAF_MIN_WIDTH = 240;
export const SPLIT_LEAF_MIN_HEIGHT = 180;
export const SPLIT_DIVIDER_SIZE = 6;

export const SPLIT_ERROR_INVALID = "splits.invalid";
export const SPLIT_ERROR_UNSUPPORTED = "splits.unsupported";
export const SPLIT_ERROR_LIMIT = "splits.limit";

const SIDES: readonly string[] = ["first", "second"];
const DIRECTIONS: readonly string[] = ["vertical", "horizontal"];
const LEAF_KINDS: readonly string[] = ["file", "folder"];
const MISSING_REASONS: readonly string[] = ["not_found", "handler_missing", "locked"];
/** A leaf is a leaf: any field outside this list (including `split`,
 * `children`, `leaves`, `group_id`, `group`, `pinned` and `tabs`) is
 * refused, so a descriptor can never become recursive. */
const LEAF_KEYS: readonly string[] = [
  "view_id",
  "kind",
  "source",
  "handler",
  "folder",
  "title",
  "view",
  "view_version",
  "missing",
];
const SPLIT_KEYS: readonly string[] = ["first", "second", "direction", "ratio", "active_side", "sync_scroll"];
const DESCRIPTOR_KEYS: readonly string[] = ["kind", "split", "pinned"];
const MISSING_KEYS: readonly string[] = ["reason", "original_path"];
const HANDLER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VIEW_ID_PATTERN = /^[^\s\u0000-\u001f\u007f-\u009f]+$/;
const MAX_VIEW_ID_CODE_POINTS = MAX_SPLIT_VIEW_ID_CHARS;
const U32_MAX = 4_294_967_295;

/** Untrusted data must be a plain JSON object: a class instance, an array
 * or an object with a foreign prototype is refused instead of read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isSplitSide(value: unknown): value is SplitSide {
  return typeof value === "string" && SIDES.includes(value);
}

export function isSplitDirection(value: unknown): value is SplitDirection {
  return typeof value === "string" && DIRECTIONS.includes(value);
}

/** `true` for a finite ratio inside 0.2-0.8. NaN and Infinity are refused,
 * never rounded into range. */
export function isSplitRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= SPLIT_RATIO_MIN &&
    value <= SPLIT_RATIO_MAX
  );
}

/** The only clamping used by pointer and keyboard resizing: a non-finite
 * input becomes the neutral ratio instead of NaN reaching the state. */
export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One resize step from the divider, rounded to whole percent so the ARIA
 * value and the stored ratio never drift apart. */
export function stepSplitRatio(ratio: number, delta: number): number {
  return clampSplitRatio(roundPercent(clampSplitRatio(ratio) + delta));
}

export function splitSideLabelKey(side: SplitSide): "splits.first" | "splits.second" {
  return side === "first" ? "splits.first" : "splits.second";
}

export function otherSplitSide(side: SplitSide): SplitSide {
  return side === "first" ? "second" : "first";
}

function hasUnknownLeafKey(value: Record<string, unknown>): boolean {
  return !hasOnlyKeys(value, LEAF_KEYS);
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && [...value].length <= max ? value : undefined;
}

function viewStateBytes(view: SerializableViewState): number {
  try {
    return new TextEncoder().encode(JSON.stringify(view)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateMissing(value: unknown): SplitLeafMissing | null {
  if (!isRecord(value) || !hasOnlyKeys(value, MISSING_KEYS)) return null;
  const reason = value.reason;
  if (typeof reason !== "string" || !MISSING_REASONS.includes(reason)) return null;
  const missing: SplitLeafMissing = { reason: reason as SplitLeafMissing["reason"] };
  if (value.original_path !== undefined) {
    if (!isAbsolutePath(value.original_path)) return null;
    missing.original_path = value.original_path;
  }
  return missing;
}

function isVirtualSource(source: DocumentRef): boolean {
  // Only a locked container entry is sensitive; a draft (Step 20a) keeps
  // the same title/view rules as a disk document, as in Step 09a.
  return source.kind === "virtual";
}

/** Validate one leaf. Returns a normalized copy with known fields only, or
 * `null` when the descriptor is not a valid, non-recursive leaf. A
 * virtual (locked) leaf never carries a plain title or view state. */
export function validateSplitLeaf(value: unknown): SplitLeaf | null {
  if (!isRecord(value) || hasUnknownLeafKey(value)) return null;
  const viewId = value.view_id;
  if (
    typeof viewId !== "string" ||
    !VIEW_ID_PATTERN.test(viewId) ||
    [...viewId].length > MAX_VIEW_ID_CODE_POINTS
  ) {
    return null;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !LEAF_KINDS.includes(kind)) return null;
  const leaf: SplitLeaf = { view_id: viewId, kind: kind as SplitLeaf["kind"] };

  if (kind === "file") {
    const source = validateDocumentRef(value.source);
    if (!source) return null;
    const handler = boundedText(value.handler, MAX_SPLIT_HANDLER_CHARS);
    if (!handler || !HANDLER_PATTERN.test(handler)) return null;
    leaf.source = source;
    leaf.handler = handler;
    if (value.folder !== undefined) return null;
  } else {
    const folder: FolderTabState | null = validateFolderTabState(value.folder);
    if (!folder) return null;
    leaf.folder = folder;
    if (value.source !== undefined || value.handler !== undefined) return null;
  }

  if (value.title !== undefined) {
    const title = boundedText(value.title, MAX_SPLIT_TITLE_CHARS);
    if (title === undefined) return null;
    leaf.title = title;
  }
  if (value.view !== undefined && value.view !== null) {
    if (!isSerializableViewState(value.view)) return null;
    if (viewStateBytes(value.view) > MAX_SPLIT_VIEW_BYTES) return null;
    leaf.view = value.view;
  }
  if (value.view_version !== undefined) {
    const version = value.view_version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 || version > U32_MAX) {
      return null;
    }
    leaf.view_version = version;
  }
  if (value.missing !== undefined) {
    const missing = validateMissing(value.missing);
    if (!missing) return null;
    leaf.missing = missing;
  }

  // A folder leaf's scroll and layout live in `folder` (scroll_top), the
  // same shape a folder tab uses; a top-level `view` would be dropped on
  // restore instead of applied.
  if (leaf.kind === "folder" && (leaf.view !== undefined || leaf.view_version !== undefined)) {
    return null;
  }

  // Locked or missing-locked content keeps no plain title, view or view
  // version: those would leak the inner name or content outside the
  // provider's encrypted store (Step 09a D6/D8, Step 09i U3).
  const locked = leaf.source !== undefined && isVirtualSource(leaf.source);
  if (locked || leaf.missing?.reason === "locked") {
    if (leaf.title !== undefined || leaf.view !== undefined || leaf.view_version !== undefined) {
      return null;
    }
  }
  return leaf;
}

/** Validate a whole split. Both sides are required, the view ids must
 * differ (two views of one document are allowed, one view id twice is
 * not), and `sync_scroll` defaults to false. */
export function validateSplitState(value: unknown): SplitState | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SPLIT_KEYS)) return null;
  const direction = value.direction;
  if (!isSplitDirection(direction)) return null;
  const ratio = value.ratio;
  if (!isSplitRatio(ratio)) return null;
  const activeSide = value.active_side;
  if (!isSplitSide(activeSide)) return null;
  if (value.sync_scroll !== undefined && typeof value.sync_scroll !== "boolean") return null;
  const first = validateSplitLeaf(value.first);
  if (!first) return null;
  const second = validateSplitLeaf(value.second);
  if (!second) return null;
  if (first.view_id === second.view_id) return null;
  return {
    first,
    second,
    direction,
    ratio,
    active_side: activeSide,
    sync_scroll: value.sync_scroll === true,
  };
}

/** The saved-group and session shape: `{ kind: "split", split }` and
 * nothing else. A descriptor for another kind is not a split descriptor. */
export function validateSavedSplitDescriptor(value: unknown): SavedSplitDescriptor | null {
  if (!isRecord(value) || value.kind !== "split" || !hasOnlyKeys(value, DESCRIPTOR_KEYS)) return null;
  // A saved group descriptor may spell `pinned: false`; a pinned split is
  // never a saved position (Step 09b D1).
  if (value.pinned !== undefined && value.pinned !== false) return null;
  const split = validateSplitState(value.split);
  if (!split) return null;
  return { kind: "split", split };
}

/** Whether a session/catalog handler id may present this leaf. Unknown
 * handlers keep the leaf as a recoverable placeholder instead of dropping
 * the whole split (Step 09a D5). */
export function splitLeafHandlerMissing(leaf: SplitLeaf, knownHandlers?: readonly string[]): boolean {
  if (leaf.kind !== "file" || !leaf.handler) return false;
  if (leaf.missing) return leaf.missing.reason === "handler_missing";
  if (!knownHandlers) return false;
  return !knownHandlers.includes(leaf.handler);
}
