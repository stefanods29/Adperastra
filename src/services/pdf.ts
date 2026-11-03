import { invoke } from "@tauri-apps/api/core";
import type { CacheLease, SourceStamp } from "./cache";
import { runJob, type JobHandle } from "./jobs";

/** PDF viewer (Step 07d): the UI's half of the PDF contracts. Rust mirrors
 * these shapes in `src-tauri/src/pdf_types.rs`; every field keeps its
 * snake_case name, exactly as the plan's data table says.
 *
 * The PDF itself is parsed by PDF.js inside a separate trusted helper
 * process (plan/rules.md R-SEC-9). Nothing here ever receives PDF bytes,
 * HTML or PDF-specified URLs: pages arrive as bounded PNG leases and text
 * as plain runs. */

/** Largest PDF the viewer accepts (D5). */
export const PDF_MAX_BYTES = 512 * 1024 * 1024;
/** Most pages one document may have (D5). */
export const PDF_MAX_PAGES = 10_000;
/** Longest path the native side accepts, in UTF-16 units. */
export const PDF_MAX_PATH_UNITS = 32_768;
/** Largest render, in pixels (D5): 4,194,304. */
export const PDF_MAX_RENDER_PIXELS = 4_194_304;
/** Largest PNG one page render may produce (D5). */
export const PDF_MAX_PNG_BYTES = 8 * 1024 * 1024;
/** Smallest and largest page zoom (D6), in percent. */
export const PDF_MIN_ZOOM = 10;
export const PDF_MAX_ZOOM = 400;
/** Rendering buckets: the longest page edge in pixels (D6). */
export const PDF_RENDER_BUCKETS = [512, 1024, 2048] as const;
/** Text runs one page may return; further runs come in continuation chunks. */
export const PDF_MAX_TEXT_RUNS = 50_000;
/** Characters one text run may hold. */
export const PDF_MAX_RUN_CHARS = 4_096;
/** Outline nodes and depth the viewer shows (D7). */
export const PDF_MAX_OUTLINE_NODES = 5_000;
export const PDF_MAX_OUTLINE_DEPTH = 32;
export const PDF_MAX_OUTLINE_TITLE = 512;
/** Search: matches per answer, characters of a query, excerpt length (D6/D7). */
export const PDF_MAX_SEARCH_MATCHES = 128;
export const PDF_MAX_SEARCH_QUERY = 256;
export const PDF_MAX_SEARCH_EXCERPT = 256;
/** Print: most pages one operation may print (D8). */
export const PDF_MAX_PRINT_PAGES = 100;
/** The DPI the trusted print view renders at (D8). */
export const PDF_PRINT_DPI = 150;
/** Page the cache keys use as the provider version (D6). */
export const PDF_PROVIDER = "pdfjs";
export const PDF_PROVIDER_VERSION = "6.4.299";
/** Bounded sizes the native session keeps (D5). */
export const PDF_MAX_RENDER_REQUEST_REVISION = 4_294_967_295;

export type PdfRotation = 0 | 90 | 180 | 270;
export type PdfFit = "width" | "page" | "none";
export type PdfTextDirection = "ltr" | "rtl";

/** Mirrors Rust `PdfSnapshotRef` (E9): all four fields are checked by the
 * native resolver against one immutable snapshot. */
export interface PdfSnapshotRef {
  snapshot_id: string;
  document_id: string;
  revision: number;
  content_id: string;
}

/** What to open. A snapshot never carries a path or raw bytes. */
export type PdfInput =
  | { kind: "file"; path: string; expected?: SourceStamp }
  | { kind: "snapshot"; reference: PdfSnapshotRef };

/** The immutable identity every page, text chunk and cursor belongs to. */
export type PdfSourceIdentity =
  | { kind: "disk"; stamp: SourceStamp }
  | {
      kind: "snapshot";
      document_id: string;
      revision: number;
      content_id: string;
      sensitive: boolean;
    };

export interface PdfPermissions {
  can_copy: boolean;
  can_print: boolean;
}

/** Mirrors Rust `PdfSession`. */
export interface PdfSession {
  session_id: string;
  source: PdfSourceIdentity;
  page_count: number;
  password_required: boolean;
  permissions: PdfPermissions;
}

export interface PdfPageInfo {
  /** 1-based page number. */
  page: number;
  width_pt: number;
  height_pt: number;
  rotation: PdfRotation;
}

/** One rendered page: its info and the lease that serves the PNG. */
export interface PdfPageImage {
  info: PdfPageInfo;
  image: CacheLease;
  render_width: number;
  render_height: number;
  resolved_scale: number;
  rendered_rotation: PdfRotation;
  request_revision: number;
}

export interface PdfTextRun {
  text: string;
  /** PDF points, origin at the top-left of the unrotated page. */
  x: number;
  y: number;
  width: number;
  height: number;
  direction: PdfTextDirection;
  font_size: number;
  order: number;
}

/** One bounded chunk of a page's text (E3). */
export interface PdfTextPage {
  page: number;
  runs: PdfTextRun[];
  next_run?: number | null;
  complete: boolean;
  source: PdfSourceIdentity;
}

export interface PdfOutlineNode {
  id: string;
  title: string;
  page?: number | null;
  children: PdfOutlineNode[];
}

/** One bounded page of the (hierarchical) outline (E4). */
export interface PdfOutlinePage {
  nodes: PdfOutlineNode[];
  next_cursor?: string | null;
  complete: boolean;
}

export interface PdfSearchMatch {
  page: number;
  run: number;
  /** Offsets in Unicode scalar values inside the run's text. */
  offset: number;
  length: number;
  excerpt: string;
}

/** One bounded page of search matches (E4). */
export interface PdfSearchPage {
  matches: PdfSearchMatch[];
  next_cursor?: string | null;
  complete: boolean;
  scanned_pages: number;
  total_pages: number;
}

/** What a PDF tab remembers (D9). Never a password, token or path. */
export interface PdfViewState {
  page: number;
  zoom: number;
  fit: PdfFit;
  rotation: PdfRotation;
  thumbnails_open: boolean;
  outline_open: boolean;
}

/** How a page is rastered: a display bucket or an exact DPI. */
export type PdfRasterSpec = { kind: "bucket"; edge: 512 | 1024 | 2048 } | { kind: "dpi"; value: number };

export interface PdfRenderRequest {
  session_id: string;
  page: number;
  raster: PdfRasterSpec;
  rotation: PdfRotation;
  request_revision: number;
}

// ---------------------------------------------------------------------------
// Services: only this file calls the PDF commands (plan/conventions.md 4.1).
// ---------------------------------------------------------------------------

/** Open a PDF from a normal file path (E1). */
export async function openPdf(path: string, password?: string): Promise<JobHandle<PdfSession>> {
  return runJob<PdfSession>("pdfopen", (requestId) =>
    invoke("pdf_open_start", { requestId, path, password: password ?? null }),
  );
}

/** Open any PDF input: a granted file, or an immutable snapshot (E1). */
export async function openPdfInput(input: PdfInput, password?: string): Promise<JobHandle<PdfSession>> {
  return runJob<PdfSession>("pdfopen", (requestId) =>
    invoke("pdf_open_input_start", { requestId, input, password: password ?? null }),
  );
}

/** Close a session. Unknown sessions are already closed (idempotent). */
export async function closePdf(sessionId: string): Promise<void> {
  try {
    await invoke("pdf_close", { sessionId });
  } catch {
    // The session was evicted or already closed.
  }
}

/** Render one page as a bounded PNG (E2). */
export async function renderPdfPage(request: PdfRenderRequest): Promise<JobHandle<PdfPageImage>> {
  return runJob<PdfPageImage>("pdfrender", (requestId) =>
    invoke("pdf_render_start", { requestId, request }),
  );
}

/** Read one bounded chunk of a page's text runs (E3). */
export async function readPdfText(
  sessionId: string,
  page: number,
  afterRun?: number,
): Promise<PdfTextPage> {
  return (await invoke("pdf_text_page", {
    sessionId,
    page,
    afterRun: afterRun ?? null,
  })) as PdfTextPage;
}

/** One bounded page of the outline (E4). */
export async function pdfOutline(sessionId: string, cursor?: string): Promise<PdfOutlinePage> {
  return (await invoke("pdf_outline", { sessionId, cursor: cursor ?? null })) as PdfOutlinePage;
}

/** Search the document; each answer is one bounded page of matches (E4). */
export async function searchPdf(
  sessionId: string,
  query: string,
  matchCase: boolean,
  cursor?: string,
): Promise<JobHandle<PdfSearchPage>> {
  return runJob<PdfSearchPage>("pdfsearch", (requestId) =>
    invoke("pdf_search_start", {
      requestId,
      sessionId,
      query,
      matchCase,
      cursor: cursor ?? null,
    }),
  );
}

/** Print a page range through the trusted print view (E6). */
export async function printPdf(
  sessionId: string,
  firstPage: number,
  lastPage: number,
): Promise<JobHandle<void>> {
  return runJob<void>("pdfprint", (requestId) =>
    invoke("pdf_print_start", { requestId, sessionId, firstPage, lastPage }),
  );
}

// ---------------------------------------------------------------------------
// Pure rules: shared by the UI and its tests.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for a canonical lower-case UUID (the only ID form the wire accepts). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isSafeInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isPdfRotation(value: unknown): value is PdfRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** A stable key for one source identity (search and outline cursors bind to it). */
export function pdfSourceKey(source: PdfSourceIdentity): string {
  if (source.kind === "disk") {
    return `d:${source.stamp.volume_id}:${source.stamp.file_id}:${source.stamp.modified_ticks}:${source.stamp.size_bytes}`;
  }
  return `s:${source.document_id}:${source.revision}:${source.content_id}`;
}

/** 10 to 400 percent; anything else falls back to 100. */
export function clampPdfZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, Math.round(percent)));
}

export function nextPdfZoom(current: number, direction: 1 | -1): number {
  const steps = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];
  if (direction === 1) return steps.find((step) => step > current) ?? PDF_MAX_ZOOM;
  return [...steps].reverse().find((step) => step < current) ?? PDF_MIN_ZOOM;
}

/** The rotated page size in PDF points (rotation 90/270 swaps the sides). */
export function rotatedPageSize(info: Pick<PdfPageInfo, "width_pt" | "height_pt">, rotation: PdfRotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: info.height_pt, height: info.width_pt }
    : { width: info.width_pt, height: info.height_pt };
}

/**
 * The scale and pixel size of one raster (D5, exact math).
 *
 * A bucket scales the longest rotated edge to `edge`; a DPI scales by
 * `value / 72`. A product above 4,194,304 pixels is refused before any
 * allocation: the viewer never silently lowers the requested quality.
 */
export function pdfRasterDimensions(
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  raster: PdfRasterSpec,
  rotation: PdfRotation,
): { width: number; height: number; scale: number } {
  if (!Number.isFinite(info.width_pt) || !Number.isFinite(info.height_pt)) {
    throw new Error("pdf.bad_request");
  }
  if (info.width_pt <= 0 || info.height_pt <= 0) throw new Error("pdf.bad_request");
  const size = rotatedPageSize(info, rotation);
  let scale: number;
  if (raster.kind === "bucket") {
    const edge = raster.edge;
    if (edge !== 512 && edge !== 1024 && edge !== 2048) throw new Error("pdf.bad_request");
    scale = edge / Math.max(size.width, size.height);
  } else if (raster.kind === "dpi") {
    const value = raster.value;
    if (!Number.isInteger(value) || value < 72 || value > 600) throw new Error("pdf.bad_request");
    scale = value / 72;
  } else {
    throw new Error("pdf.bad_request");
  }
  const width = Math.max(1, Math.ceil(size.width * scale));
  const height = Math.max(1, Math.ceil(size.height * scale));
  if (width * height > PDF_MAX_RENDER_PIXELS) throw new Error("pdf.too_large");
  return { width, height, scale };
}

/** The render bucket that covers a page shown at `cssWidth` CSS pixels. */
export function bucketForDisplay(cssWidth: number, devicePixelRatio: number): 512 | 1024 | 2048 {
  const wanted = Math.max(0, cssWidth) * (Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1);
  return PDF_RENDER_BUCKETS.find((edge) => edge >= wanted) ?? 2048;
}

/** The cache options key of one page result (D6): ASCII, bounded, stable. */
export function pdfPageCacheOptions(page: number, rotation: PdfRotation, raster: PdfRasterSpec): string {
  const shape = raster.kind === "bucket" ? `bucket=${raster.edge}` : `dpi=${raster.value}`;
  return `ver=${PDF_PROVIDER_VERSION};page=${page};rot=${rotation};${shape}`;
}

/** Validate one render request before it reaches Rust or the helper. */
export function pdfRenderRequestError(request: PdfRenderRequest): string | null {
  if (!isUuid(request.session_id)) return "pdf.bad_request";
  if (!isSafeInteger(request.page, 1, PDF_MAX_PAGES)) return "pdf.bad_request";
  if (!isPdfRotation(request.rotation)) return "pdf.bad_request";
  if (!isSafeInteger(request.request_revision, 1, PDF_MAX_RENDER_REQUEST_REVISION)) return "pdf.bad_request";
  if (request.raster.kind === "bucket") {
    if (!(PDF_RENDER_BUCKETS as readonly number[]).includes(request.raster.edge)) return "pdf.bad_request";
  } else if (request.raster.kind === "dpi") {
    if (!Number.isInteger(request.raster.value) || request.raster.value < 72 || request.raster.value > 600) {
      return "pdf.bad_request";
    }
  } else {
    return "pdf.bad_request";
  }
  return null;
}

/** Validate what to open. Refuses anything a snapshot must not carry. */
export function pdfInputError(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return "pdf.bad_request";
  const value = input as Record<string, unknown>;
  if (value.kind === "file") {
    if (typeof value.path !== "string" || value.path.length === 0) return "pdf.bad_request";
    if (value.path.length > PDF_MAX_PATH_UNITS) return "pdf.too_large";
    if (!/^([a-zA-Z]:\\|\\\\\?\\)/.test(value.path)) return "pdf.bad_request";
    return null;
  }
  if (value.kind === "snapshot") {
    if ("path" in value || "bytes" in value) return "pdf.bad_request";
    const reference = value.reference as Record<string, unknown> | undefined;
    if (!reference || typeof reference !== "object") return "pdf.bad_request";
    if (!isUuid(reference.snapshot_id)) return "pdf.bad_request";
    if (!isUuid(reference.content_id)) return "pdf.bad_request";
    if (typeof reference.document_id !== "string" || reference.document_id.length < 1 || reference.document_id.length > 128) {
      return "pdf.bad_request";
    }
    if (!isSafeInteger(reference.revision, 0, Number.MAX_SAFE_INTEGER)) return "pdf.bad_request";
    return null;
  }
  return "pdf.bad_request";
}

/** Default view state of a freshly opened PDF. */
export function defaultPdfViewState(): PdfViewState {
  return { page: 1, zoom: 100, fit: "width", rotation: 0, thumbnails_open: true, outline_open: false };
}

/**
 * Read a saved tab state. Unknown fields, passwords, tokens and page numbers
 * outside the document are dropped; the result is always a full state.
 */
export function readPdfViewState(raw: unknown, pageCount: number): PdfViewState {
  const base = defaultPdfViewState();
  if (typeof raw !== "object" || raw === null) return base;
  const value = raw as Record<string, unknown>;
  const maxPage = Math.max(1, Math.min(PDF_MAX_PAGES, Math.floor(pageCount) || 1));
  if (isSafeInteger(value.page, 1, maxPage)) base.page = value.page;
  if (typeof value.zoom === "number") base.zoom = clampPdfZoom(value.zoom);
  if (value.fit === "width" || value.fit === "page" || value.fit === "none") base.fit = value.fit;
  if (isPdfRotation(value.rotation)) base.rotation = value.rotation;
  if (typeof value.thumbnails_open === "boolean") base.thumbnails_open = value.thumbnails_open;
  if (typeof value.outline_open === "boolean") base.outline_open = value.outline_open;
  return base;
}

/** The keys a serialized view state is allowed to keep. */
export const PDF_VIEW_STATE_KEYS = [
  "page",
  "zoom",
  "fit",
  "rotation",
  "thumbnails_open",
  "outline_open",
] as const;

/** True when the state contains only the six bounded view fields (D9). */
export function isBoundedPdfViewState(state: PdfViewState): boolean {
  const keys = Object.keys(state as unknown as Record<string, unknown>);
  return keys.length === PDF_VIEW_STATE_KEYS.length && PDF_VIEW_STATE_KEYS.every((key) => keys.includes(key));
}

/** The print range rule shared by the dialog and Rust (D8/E6). */
export function pdfPrintRangeError(first: number, last: number, pageCount: number, canPrint: boolean): string | null {
  if (!canPrint) return "pdf.permissions";
  if (!isSafeInteger(first, 1, PDF_MAX_PAGES) || !isSafeInteger(last, 1, PDF_MAX_PAGES)) return "pdf.bad_request";
  if (first > last) return "pdf.bad_request";
  if (last > pageCount) return "pdf.bad_request";
  if (last - first + 1 > PDF_MAX_PRINT_PAGES) return "pdf.too_large";
  return null;
}
