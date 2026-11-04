import type { PdfPageInfo, PdfRasterSpec, PdfRotation, PdfSearchMatch, PdfTextRun, PdfTextPage } from "../services/pdf";

/** Private payloads of the PDF helper (Step 07d, `pdf-reader-2`).
 *
 * These types live only inside the trusted helper frontend and its native
 * mirror `src-tauri/src/pdf_helper_types.rs`. They are not the browser
 * services in `src/services/pdf.ts`: the helper payloads name a `grant_id`
 * instead of a session, never carry a path, a stamp or a token, and the
 * native parent checks every answer against the live session. */

export interface PdfHelperOpenRequest {
  grant_id: string;
  /** Kept in memory for this call only; never logged or stored. */
  password?: string | null;
}

export interface PdfHelperOpenReply {
  page_count: number;
  can_copy: boolean;
  can_print: boolean;
}

export interface PdfHelperRenderRequest {
  page: number;
  raster: PdfRasterSpec;
  rotation: PdfRotation;
  request_revision: number;
}

export interface PdfHelperRenderReply {
  info: PdfPageInfo;
  render_width: number;
  render_height: number;
  resolved_scale: number;
  rendered_rotation: PdfRotation;
  request_revision: number;
}

export interface PdfHelperTextRequest {
  page: number;
  after_run?: number | null;
}

export interface PdfHelperTextReply {
  page: number;
  runs: PdfTextRun[];
  next_run?: number | null;
  complete: boolean;
}

export interface PdfHelperOutlineRequest {
  /** Index into the preorder traversal (0 starts at the first node). */
  offset: number;
}

export interface PdfHelperOutlineNode {
  id: string;
  title: string;
  page?: number | null;
  children: PdfHelperOutlineNode[];
}

export interface PdfHelperOutlineReply {
  nodes: PdfHelperOutlineNode[];
  next_offset?: number | null;
  complete: boolean;
}

export interface PdfHelperSearchPosition {
  page: number;
  run: number;
  offset: number;
}

export interface PdfHelperSearchRequest {
  query: string;
  match_case: boolean;
  page: number;
  run: number;
  offset: number;
}

export interface PdfHelperSearchReply {
  matches: PdfSearchMatch[];
  next_position?: PdfHelperSearchPosition | null;
  complete: boolean;
  scanned_pages: number;
}

export interface PdfHelperPrintRequest {
  first_page: number;
  last_page: number;
  dpi: number;
}

export interface PdfHelperPrintReply {
  completed: boolean;
}

/** Bounds the helper enforces before doing any work (D5/D7). */
export const PDF_HELPER_LIMITS = {
  /** Largest PNG one page render may produce. */
  pngBytes: 8 * 1024 * 1024,
  /** Largest page render in pixels. */
  pixels: 4_194_304,
  /** Text runs kept per page. */
  textRuns: 50_000,
  /** Characters of one text run. */
  runChars: 4_096,
  /** Search: matches per answer and characters of a query. */
  searchMatches: 128,
  searchQuery: 256,
  /** Outline nodes, page of nodes, depth and title characters. */
  outlineNodes: 5_000,
  outlinePage: 256,
  outlineDepth: 32,
  outlineTitle: 512,
  /** Pages one print operation may include. */
  printPages: 100,
  /** DPI the trusted print view uses. */
  printDpi: 150,
} as const;

/**
 * The exact PDF.js loading flags of D4. Wasm and JS evaluation stay off,
 * remote fetching stays off, and the one granted URL is the only source.
 * `isEvalSupported` is deliberately absent: the pinned version removed it.
 */
export const PDF_HELPER_INIT = {
  rangeChunkSize: 65_536,
  disableStream: true,
  disableAutoFetch: true,
  useWorkerFetch: false,
  useWasm: false,
  useSystemFonts: false,
  disableFontFace: true,
  enableXfa: false,
  maxImageSize: 100_000_000,
  canvasMaxAreaInBytes: 67_108_864,
} as const;

/** The full `getDocument` options: the granted URL plus packaged assets. */
export function pdfDocumentInit(url: string, cMapUrl: string, standardFontDataUrl: string) {
  return {
    ...PDF_HELPER_INIT,
    url,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    // No scripting manager, no `enableScripting`, no link service that opens
    // anything: PDF actions never run (D1/D4).
  };
}

/** True for a text page answer that still has runs to read. */
export function needsMoreText(answer: PdfTextPage): boolean {
  return !answer.complete && typeof answer.next_run === "number";
}
