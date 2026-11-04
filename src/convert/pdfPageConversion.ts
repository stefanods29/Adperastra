/** PDF-pages-to-images orchestration (Step 08b D3, E1/E2/U3).
 *
 * The native conversion adapter owns publication; this pure orchestration
 * fixes the lifecycle that adapter must follow:
 *
 * - one Step 07d session is opened from the exact `PdfInput`;
 * - every page request uses `{ kind: "dpi", value: options.dpi }`, never a
 *   fabricated bucket or a top-edge field;
 * - the page order is the normalized ascending list;
 * - every returned `CacheLease` is released after its page is used;
 * - `closePdf` runs last, in `finally`, so a snapshot lease is retained for
 *   the whole conversion and released only after the last page.
 *
 * The service functions are injected so tests never call Tauri. */

import type { ConversionNaming, PageRange } from "./types";
import {
  PDF_MAX_PAGES,
  type PdfInput,
  type PdfPageImage,
  type PdfSession,
  type PdfRenderRequest,
} from "../services/pdf";
import type { JobHandle } from "../services/jobs";

export interface PdfPageConversionOptions {
  ranges: readonly PageRange[];
  dpi: number;
  image_format: "png" | "jpeg";
  quality: number;
}

export interface PdfPageConversionPort {
  open(input: PdfInput, password?: string): Promise<JobHandle<PdfSession>>;
  render(request: PdfRenderRequest): Promise<JobHandle<PdfPageImage>>;
  release(lease: PdfPageImage["image"]): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export interface PdfPageName {
  page: number;
  name_part: { kind: "page"; page: number };
}

/** Normalize ranges exactly as the native pure function does. */
export function normalizedPdfPages(ranges: readonly PageRange[], pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > PDF_MAX_PAGES) {
    throw new Error("convert.too_large");
  }
  const intervals: { first: number; last: number }[] = [];
  for (const range of ranges) {
    if (
      !Number.isInteger(range.first) ||
      !Number.isInteger(range.last) ||
      range.first < 1 ||
      range.last < range.first ||
      range.last > pageCount
    ) {
      throw new Error("convert.invalid_range");
    }
    intervals.push({ first: range.first, last: range.last });
  }
  if (intervals.length === 0) intervals.push({ first: 1, last: pageCount });
  intervals.sort((left, right) => left.first - right.first || left.last - right.last);
  const merged: { first: number; last: number }[] = [];
  for (const range of intervals) {
    const last = merged[merged.length - 1];
    if (last && range.first <= last.last + 1) last.last = Math.max(last.last, range.last);
    else merged.push({ ...range });
  }
  const pages: number[] = [];
  for (const range of merged) {
    for (let page = range.first; page <= range.last; page += 1) pages.push(page);
  }
  if (pages.length > PDF_MAX_PAGES) throw new Error("convert.too_large");
  return pages;
}

/** The exact render requests for one session. */
export function pdfPageRenderRequests(
  session: PdfSession,
  options: PdfPageConversionOptions,
  startRevision = 1,
): PdfRenderRequest[] {
  return normalizedPdfPages(options.ranges, session.page_count).map((page, index) => ({
    session_id: session.session_id,
    page,
    raster: { kind: "dpi", value: options.dpi },
    rotation: 0,
    request_revision: startRevision + index,
  }));
}

/** The name part each page contributes; the parent expands the pattern. */
export function pdfPageNameParts(
  session: PdfSession,
  options: PdfPageConversionOptions,
): PdfPageName[] {
  return normalizedPdfPages(options.ranges, session.page_count).map((page) => ({
    page,
    name_part: { kind: "page", page },
  }));
}

/**
 * Run one PDF-pages conversion lifecycle. `onPage` receives the page image
 * and its name part while the lease is still alive; the lease is released
 * immediately after `onPage` returns or throws. The session is always closed.
 */
export async function convertPdfPages(
  port: PdfPageConversionPort,
  input: PdfInput,
  options: PdfPageConversionOptions,
  onPage: (image: PdfPageImage, namePart: PdfPageName["name_part"]) => Promise<void> | void,
): Promise<void> {
  const opened = await port.open(input);
  const session = await opened.completion;
  try {
    const requests = pdfPageRenderRequests(session, options);
    const names = pdfPageNameParts(session, options);
    for (let index = 0; index < requests.length; index += 1) {
      const job = await port.render(requests[index]);
      const image = await job.completion;
      try {
        await onPage(image, names[index].name_part);
      } finally {
        await port.release(image.image);
      }
    }
  } finally {
    await port.close(session.session_id);
  }
}

/** The full name of one page after the parent applies its naming pattern.
 * This helper exists only for previews; the native parent is authoritative. */
export function pdfPagePatternContext(
  naming: ConversionNaming,
  pagePart: PdfPageName["name_part"],
  globalOutputIndex: number,
): { index: number; effectiveStemSuffix: string } {
  return {
    index: naming.start_index + globalOutputIndex,
    effectiveStemSuffix: `-page-${String(pagePart.page).padStart(3, "0")}`,
  };
}
