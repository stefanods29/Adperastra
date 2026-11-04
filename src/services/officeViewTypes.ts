import type { ConversionInput } from "../convert/types";
import type { CacheLease } from "./cache";
import type { OfficeFormat } from "./engineTypes";

/** Canonical read-only Office view types (Step 13, `office-view-1`).
 *
 * The native mirror is `src-tauri/src/office_view_types.rs`. Every field is
 * snake_case on both sides. `OfficeFormat` remains owned by 12b's
 * `engineTypes.ts`; this module re-exports it and never defines a second
 * format union. */

export type { OfficeFormat };

export type OfficeQuality = "quick" | "accurate";
export type OfficeSectionKind = "document" | "sheet" | "slide";
export type OfficeViewMode = "quick" | "pages";
export type OfficeAnchorKind = "paragraph" | "cell" | "slide";
export type OfficeCellValueKind = "text" | "number" | "date" | "boolean" | "error" | "formula";

export interface OfficeCapabilities {
  comments: boolean;
  presentation: boolean;
  exact_render: boolean;
}

export interface OfficeSession {
  session_id: string;
  format: OfficeFormat;
  source_revision: number;
  engine_version: string;
  quality: OfficeQuality;
  section_count: number;
  read_only: true;
  capabilities: OfficeCapabilities;
}

export interface OfficeSection {
  id: string;
  name: string;
  kind: OfficeSectionKind;
  index: number;
  page_count: number;
  rows?: number;
  columns?: number;
}

export interface OfficeSectionPage {
  items: OfficeSection[];
  next_cursor?: string | null;
  complete: boolean;
}

export interface OfficePage {
  section_id: string;
  page: number;
  image: CacheLease;
  width_pt: number;
  height_pt: number;
  quality: OfficeQuality;
  source_revision: number;
}

export interface OfficeLayoutRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  direction: "ltr" | "rtl";
  font_size: number;
  order: number;
}

export interface OfficeCommentAnchor {
  kind: OfficeAnchorKind;
  index: number;
}

export interface OfficeComment {
  id: string;
  section_id: string;
  page?: number | null;
  author: string;
  text: string;
  parent_id?: string | null;
  source_anchor: OfficeCommentAnchor;
}

export interface OfficeCommentPage {
  items: OfficeComment[];
  next_cursor?: string | null;
  complete: boolean;
}

export interface OfficeOutlineNode {
  id: string;
  title: string;
  section_id: string;
  page?: number | null;
  depth: number;
}

export interface OfficeViewState {
  section_id: string;
  page: number;
  zoom: number;
  scroll_top: number;
  mode: OfficeViewMode;
}

export interface OfficeCell {
  row: number;
  column: number;
  text: string;
  value_kind: OfficeCellValueKind;
  formula?: string | null;
  cached: boolean;
}

export interface OfficeCellPage {
  section_id: string;
  /** Absolute zero-based row of the first returned row. */
  row_start: number;
  /** Absolute zero-based column of the first cell in every returned row. */
  column_start: number;
  rows: OfficeCell[][];
  total_rows: number;
  /** Total used columns (the horizontal scroll extent). */
  columns: number;
  /** Width of the returned column window, at most OFFICE_MAX_CELL_COLUMNS. */
  column_count: number;
  truncated: boolean;
  /** `"<row>:<column>"` of the first withheld cell when `truncated` is true;
   * null for a complete window. Session- and section-bound; resume with
   * explicit `row_start`/`column_start`, never across sessions. */
  next_cursor?: string | null;
}

/** Bounds shared by the service, the view and the native tests. */
export const OFFICE_MAX_SESSIONS = 8;
export const OFFICE_IDLE_SECONDS = 10 * 60;
export const OFFICE_MAX_SECTIONS = 1_000;
export const OFFICE_MAX_SECTION_PAGE = 200;
export const OFFICE_MAX_PAGES = 10_000;
export const OFFICE_MAX_SIDE_PT = 14_400;
export const OFFICE_MIN_SCALE = 0.25;
export const OFFICE_MAX_SCALE = 4;
export const OFFICE_MIN_ZOOM = 25;
export const OFFICE_MAX_ZOOM = 400;
export const OFFICE_MAX_SCROLL = 1_000_000_000;
export const OFFICE_MAX_COMMENTS = 10_000;
export const OFFICE_MAX_COMMENT_PAGE = 200;
export const OFFICE_MAX_COMMENT_TEXT = 8_192;
export const OFFICE_MAX_OUTLINE_NODES = 10_000;
export const OFFICE_MAX_OUTLINE_DEPTH = 32;
export const OFFICE_MAX_OUTLINE_TITLE = 512;
export const OFFICE_MAX_CELL_ROWS = 500;
export const OFFICE_MAX_CELL_COLUMNS = 200;
export const OFFICE_MAX_CELL_PAGE_CELLS = 25_000;
export const OFFICE_MAX_CELL_TEXT = 32_767;
export const OFFICE_MAX_ANSWER_BYTES = 768 * 1024;
export const OFFICE_MAX_SHEET_ROWS = 1_000_000;
export const OFFICE_MAX_SHEET_COLUMNS = 16_384;
export const OFFICE_MAX_CELL_START = 100_000_000;

/** True for the handlers this step advertises. Template formats potx/otp are
 * reserved for 22a/22b and are not advertised here. */
export function isOfficeViewFormatForHandler(format: OfficeFormat): boolean {
  return format !== "potx" && format !== "otp";
}

/** Validate a conversion input without inventing a path. */
export function validOfficeInput(input: ConversionInput): boolean {
  if (input.kind === "file") {
    return (
      typeof input.path === "string" &&
      input.path.length > 0 &&
      input.path.length <= 32_768 &&
      !input.path.includes("\0")
    );
  }
  return (
    typeof input.snapshot_id === "string" &&
    input.snapshot_id.length > 0 &&
    typeof input.document_id === "string" &&
    input.document_id.length > 0 &&
    Number.isSafeInteger(input.revision) &&
    input.revision >= 1
  );
}

export function validSectionId(id: string): boolean {
  // `document` is the canonical Writer ID; `document:0` is accepted only as
  // the old saved-tab spelling.
  return /^(document|document:0|sheet:\d{1,7}|slide:\d{1,7})$/.test(id) && id.length <= 64;
}

export function validOfficePageNumber(page: number): boolean {
  return Number.isSafeInteger(page) && page >= 1 && page <= OFFICE_MAX_PAGES;
}

export function validOfficeScale(scale: number): boolean {
  return Number.isFinite(scale) && scale >= OFFICE_MIN_SCALE && scale <= OFFICE_MAX_SCALE;
}

/** Clamp a saved view state; tokens, passwords and text are not fields here. */
export function normalizeOfficeViewState(
  input: unknown,
  defaultSection = "document",
): OfficeViewState {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const section = typeof value.section_id === "string" && validSectionId(value.section_id) ? (value.section_id === "document:0" ? "document" : value.section_id) : defaultSection;
  const page = typeof value.page === "number" && Number.isSafeInteger(value.page) ? Math.min(OFFICE_MAX_PAGES, Math.max(1, value.page)) : 1;
  const zoom = typeof value.zoom === "number" && Number.isFinite(value.zoom) ? Math.min(OFFICE_MAX_ZOOM, Math.max(OFFICE_MIN_ZOOM, value.zoom)) : 100;
  const scroll = typeof value.scroll_top === "number" && Number.isFinite(value.scroll_top) ? Math.min(OFFICE_MAX_SCROLL, Math.max(0, value.scroll_top)) : 0;
  const mode: OfficeViewMode = value.mode === "quick" ? "quick" : "pages";
  return { section_id: section, page, zoom, scroll_top: scroll, mode };
}

/** Encode the view codec. The result is JSON-only and never contains a
 * session ID, cache token, lease, password or document text. */
export function encodeOfficeViewState(state: unknown): OfficeViewState {
  return normalizeOfficeViewState(state);
}

export function decodeOfficeViewState(state: unknown): OfficeViewState {
  return normalizeOfficeViewState(state);
}

/** The one codec 09a registers for all three Office handlers. */
export const officeViewStateCodec = {
  version: 1,
  encode: encodeOfficeViewState,
  decode: decodeOfficeViewState,
} as const;
