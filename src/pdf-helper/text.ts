import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfTextDirection, PdfTextRun } from "../services/pdf";
import { PDF_HELPER_LIMITS } from "./types";

/** Turning a page's text content into bounded, position-aware runs
 * (Step 07d D7).
 *
 * PDF.js gives text items with a text matrix. We keep only what the viewer
 * needs: the text, its box in PDF points with the origin at the top-left of
 * the unrotated page, its reading direction and its order. No font URL, no
 * HTML, no marked content. */

/** The part of a PDF.js text item this module reads. */
export interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir?: string;
  hasEOL?: boolean;
}

function directionOf(item: PdfTextItemLike): PdfTextDirection {
  return item.dir === "rtl" ? "rtl" : "ltr";
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** The text runs of one page, in reading order, inside the limits. */
export function runsFromItems(items: readonly PdfTextItemLike[], pageHeight: number): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  let order = 0;
  for (const item of items) {
    if (runs.length >= PDF_HELPER_LIMITS.textRuns) break;
    const text = Array.from(item.str).slice(0, PDF_HELPER_LIMITS.runChars).join("");
    if (text === "") {
      order += 1;
      continue;
    }
    const transform = Array.isArray(item.transform) && item.transform.length === 6 ? item.transform : [1, 0, 0, 1, 0, 0];
    const fontHeight = Math.abs(finite(item.height, 0)) || Math.abs(transform[3]) || 1;
    const width = Math.abs(finite(item.width, 0)) || text.length * fontHeight * 0.5;
    const x = finite(transform[4], 0);
    const baseline = finite(transform[5], pageHeight);
    runs.push({
      text,
      x,
      // PDF user space counts up from the bottom; the viewer counts down.
      y: finite(pageHeight - baseline - fontHeight, pageHeight),
      width,
      height: fontHeight,
      direction: directionOf(item),
      font_size: Math.max(0.01, fontHeight),
      order,
    });
    order += 1;
  }
  return runs;
}

/** True when the page's text is mostly right-to-left. */
export function pageDirection(runs: readonly PdfTextRun[]): PdfTextDirection {
  let rtl = 0;
  let ltr = 0;
  for (const run of runs) {
    if (run.direction === "rtl") rtl += 1;
    else ltr += 1;
  }
  return rtl > ltr ? "rtl" : "ltr";
}

/** One bounded chunk of runs: after `afterRun`, at most `maxRuns`. */
export function chunkTextRuns(
  runs: readonly PdfTextRun[],
  afterRun: number | null | undefined,
  maxRuns = 4_000,
): { runs: PdfTextRun[]; next_run: number | null; complete: boolean } {
  const start = typeof afterRun === "number" && Number.isInteger(afterRun) && afterRun >= 0 ? afterRun + 1 : 0;
  const slice = runs.slice(start, start + Math.max(1, maxRuns));
  const next = start + slice.length;
  return {
    runs: slice,
    next_run: next < runs.length ? next - 1 : null,
    complete: next >= runs.length,
  };
}

/** Read a page's text once; `runs` is stable for the page's lifetime. */
export async function readPageText(page: PDFPageProxy, pageHeight: number): Promise<PdfTextRun[]> {
  const content = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const items: PdfTextItemLike[] = [];
  for (const entry of content.items) {
    const item = entry as unknown as PdfTextItemLike;
    if (typeof item.str !== "string") continue;
    items.push(item);
    if (items.length >= PDF_HELPER_LIMITS.textRuns) break;
  }
  const runs = runsFromItems(items, pageHeight);
  if (new TextEncoder().encode(JSON.stringify(runs)).byteLength > 1024 * 1024) throw new Error("pdf.too_large");
  return runs;
}
