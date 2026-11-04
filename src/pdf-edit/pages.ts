import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  PDF_EDIT_MAX_PAGES,
  isSafeInteger,
  pdfEditError,
  type PdfPageState,
  type PdfRect,
  type PdfRotation,
} from "./types";

/** Bounded page operations (Step 14a D7, T4).
 *
 * Page identity is the stable `PdfPageState.id`; array positions are never
 * identities. A reorder must be one full permutation with no duplicate and
 * no missing page. Deleting cannot remove the last page. Split/merge plans
 * produce separately named outputs that the 08a/09f owned publication writes
 * without replacing anything. */

export type PdfSplitOutputMode = "owned-no-replace";

export interface PdfSplitRange {
  first: number;
  last: number;
}

export interface PdfSplitOutputPlan {
  name: string;
  range: PdfSplitRange;
  publish: PdfSplitOutputMode;
}

export interface PdfMergeSource {
  snapshot: ExportSnapshot;
  /** 1-based pages of that snapshot, in the requested order. */
  pages: number[];
}

export interface PdfMergePlanEntry {
  origin_source: ExportSnapshot;
  origin_page: number;
}

export function pdfPagePermutationError(pages: readonly Pick<PdfPageState, "id">[], ids: readonly string[]): string | null {
  if (!Array.isArray(ids) || ids.length !== pages.length) return "pdf_edit.bad_request";
  const known = new Set(pages.map((page) => page.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) return "pdf_edit.bad_request";
    seen.add(id);
  }
  return seen.size === pages.length ? null : "pdf_edit.bad_request";
}

export function validatePdfPagePermutation(pages: readonly Pick<PdfPageState, "id">[], ids: readonly string[]): void {
  const error = pdfPagePermutationError(pages, ids);
  if (error) throw pdfEditError("pdf_edit.bad_request");
}

export function pdfPageDeleteError(pages: readonly Pick<PdfPageState, "id">[], ids: readonly string[]): string | null {
  if (!Array.isArray(ids) || ids.length === 0) return "pdf_edit.bad_request";
  const known = new Set(pages.map((page) => page.id));
  const unique = new Set(ids);
  if (unique.size !== ids.length) return "pdf_edit.bad_request";
  if (!ids.every((id) => known.has(id))) return "pdf_edit.bad_request";
  return pages.length - unique.size >= 1 ? null : "pdf_edit.bad_request";
}

export function validatePdfPageDelete(pages: readonly Pick<PdfPageState, "id">[], ids: readonly string[]): void {
  const error = pdfPageDeleteError(pages, ids);
  if (error) throw pdfEditError("pdf_edit.bad_request");
}

export function validatePdfPageRotation(pages: readonly Pick<PdfPageState, "id">[], ids: readonly string[], quarterTurns: number): void {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) throw pdfEditError("pdf_edit.bad_request");
  const known = new Set(pages.map((page) => page.id));
  if (!ids.every((id) => known.has(id))) throw pdfEditError("pdf_edit.bad_request");
  if (!isSafeInteger(quarterTurns, -16, 16) || quarterTurns === 0) throw pdfEditError("pdf_edit.bad_request");
}

export function rotatePdfPage(page: Pick<PdfPageState, "rotation">, quarterTurns: number): PdfRotation {
  const steps = (((page.rotation / 90 + quarterTurns) % 4) + 4) % 4;
  return (steps * 90) as PdfRotation;
}

/** Flatten merge sources into the exact output page order. The order is the
 * caller's selection order and each page is copied once (A1 then B1 for one
 * page of A followed by one page of B). */
export function planPdfMerge(sources: readonly PdfMergeSource[]): PdfMergePlanEntry[] {
  if (!Array.isArray(sources) || sources.length === 0) throw pdfEditError("pdf_edit.bad_request");
  const entries: PdfMergePlanEntry[] = [];
  for (const source of sources) {
    if (!source || !source.snapshot || !Array.isArray(source.pages) || source.pages.length === 0) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    for (const page of source.pages) {
      if (!isSafeInteger(page, 1, PDF_EDIT_MAX_PAGES)) throw pdfEditError("pdf_edit.bad_request");
      entries.push({ origin_source: source.snapshot, origin_page: page });
      if (entries.length > PDF_EDIT_MAX_PAGES) throw pdfEditError("pdf_edit.too_large");
    }
  }
  return entries;
}

/** Normalize split ranges: 1-based, sorted, non-overlapping and inside the
 * document. An empty list is refused rather than silently splitting all. */
export function normalizePdfSplitRanges(ranges: readonly PdfSplitRange[], pageCount: number): PdfSplitRange[] {
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > PDF_EDIT_MAX_PAGES) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  if (!isSafeInteger(pageCount, 1, PDF_EDIT_MAX_PAGES)) throw pdfEditError("pdf_edit.bad_request");
  const normalized = ranges
    .map((range) => ({ first: range.first, last: range.last }))
    .sort((a, b) => a.first - b.first || a.last - b.last);
  let previousLast = 0;
  for (const range of normalized) {
    if (!isSafeInteger(range.first, 1, pageCount) || !isSafeInteger(range.last, 1, pageCount)) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    if (range.last < range.first || range.first <= previousLast) throw pdfEditError("pdf_edit.bad_request");
    previousLast = range.last;
  }
  return normalized;
}

function stemOf(name: string): string {
  const trimmed = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  const withoutPdf = trimmed.toLowerCase().endsWith(".pdf") ? trimmed.slice(0, -4) : trimmed;
  return withoutPdf.length > 0 ? withoutPdf : "document";
}

function pageDigits(page: number): string {
  return String(page).padStart(3, "0");
}

/** Split output names are owned new names. A name that already exists gets
 * the ordinary numbered suffix; an existing file is never replaced. */
export function planPdfSplitOutputs(
  baseName: string,
  ranges: readonly PdfSplitRange[],
  pageCount: number,
  existingNames: ReadonlySet<string> = new Set(),
): PdfSplitOutputPlan[] {
  const normalized = normalizePdfSplitRanges(ranges, pageCount);
  const stem = stemOf(baseName);
  const used = new Set([...existingNames].map((name) => name.toLowerCase()));
  const plans: PdfSplitOutputPlan[] = [];
  for (const range of normalized) {
    const suffix = range.first === range.last ? pageDigits(range.first) : `${pageDigits(range.first)}-${pageDigits(range.last)}`;
    const base = `${stem}-pages-${suffix}`;
    let name = `${base}.pdf`;
    let counter = 1;
    while (used.has(name.toLowerCase())) {
      name = `${base} (${counter}).pdf`;
      counter += 1;
      if (counter > 10_000) throw pdfEditError("pdf_edit.too_large");
    }
    used.add(name.toLowerCase());
    plans.push({ name, range: { ...range }, publish: "owned-no-replace" });
  }
  return plans;
}

export function pdfPageCrop(page: Pick<PdfPageState, "crop">): PdfRect {
  return { ...page.crop };
}

/** The label of a page in the page tools list: 1-based displayed page. */
export function pdfPageLabel(index: number): string {
  return String(index + 1);
}
