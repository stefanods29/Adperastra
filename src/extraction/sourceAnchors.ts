import type { ExtractionAnchor, ExtractionRect, ExtractionSource } from "../services/aiExtractionTypes";
import type { PdfSourceIdentity } from "../services/pdf";

/** Source-bound geometry for Step 17d T2.
 *
 * The OCR text and every anchor belong to one immutable source identity
 * (07d `PdfSourceIdentity`). Pixel boxes are stored normalized (0..1) and are
 * converted once for display; an anchor never leaves its source. The native
 * layout module `ai_extraction_layout.rs` is the authority for jobs; the
 * constants and helpers here mirror the same D3 rules for the review preview
 * and its tests.
 */

/** A paragraph break when the gap exceeds this factor of the median height. */
export const LINE_GAP_FACTOR = 1.5;
/** A heading when the median word height exceeds this factor of the body. */
export const HEADING_HEIGHT_FACTOR = 1.35;
/** Longest line that may be a heading. */
export const MAX_HEADING_SCALARS = 120;
/** Table boundaries agree within this fraction of the page width. */
export const TABLE_BOUNDARY_TOLERANCE = 0.02;
/** Share of rows that must agree for a candidate table. */
export const TABLE_ROW_AGREEMENT = 0.75;
export const MIN_TABLE_COLUMNS = 2;
export const MIN_TABLE_ROWS = 2;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Normalize one pixel coordinate against its oriented source extent. */
export function pixelToNormalized(value: number, extent: number): number {
  if (!finite(value) || !finite(extent) || extent <= 0) throw new Error("ai_extract.invalid");
  const normalized = value / extent;
  return Math.min(1, Math.max(0, normalized));
}

/** Convert a normalized coordinate back to display pixels (rounded once). */
export function normalizedToPixel(normalized: number, extent: number): number {
  if (!finite(normalized) || !finite(extent) || extent <= 0) throw new Error("ai_extract.invalid");
  return Math.round(Math.min(1, Math.max(0, normalized)) * extent);
}

/** One OCR word box in oriented source pixels → normalized anchor rect. */
export function anchorRectForWord(
  word: { x: number; y: number; width: number; height: number },
  recognizedWidth: number,
  recognizedHeight: number,
): ExtractionRect {
  if (!finite(word.width) || !finite(word.height) || word.width <= 0 || word.height <= 0) {
    throw new Error("ai_extract.invalid");
  }
  const x = pixelToNormalized(word.x, recognizedWidth);
  const y = pixelToNormalized(word.y, recognizedHeight);
  const width = Math.min(1 - x, pixelToNormalized(word.width, recognizedWidth));
  const height = Math.min(1 - y, pixelToNormalized(word.height, recognizedHeight));
  if (width <= 0 || height <= 0) throw new Error("ai_extract.invalid");
  return { x, y, width, height };
}

/** True for a finite normalized rectangle with a positive area. */
export function isNormalizedRect(value: unknown): value is ExtractionRect {
  if (value === null || typeof value !== "object") return false;
  const rect = value as ExtractionRect;
  return (
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 &&
    rect.y + rect.height <= 1
  );
}

/** The smallest rectangle containing every anchor of one field on one page. */
export function mergeAnchorRects(anchors: readonly ExtractionAnchor[]): ExtractionRect | null {
  const rects = anchors.filter((anchor) => isNormalizedRect(anchor.rect)).map((anchor) => anchor.rect);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A heading when its median height exceeds 1.35x the body and it is short. */
export function qualifiesHeading(medianHeight: number, bodyMedian: number, scalars: number): boolean {
  return (
    finite(medianHeight) &&
    finite(bodyMedian) &&
    bodyMedian > 0 &&
    scalars > 0 &&
    scalars <= MAX_HEADING_SCALARS &&
    medianHeight > HEADING_HEIGHT_FACTOR * bodyMedian
  );
}

/** Share of rows whose boundaries agree with the first row (same columns). */
export function tableRowAgreement(rows: readonly (readonly number[])[], pageWidth: number): number {
  if (rows.length < MIN_TABLE_ROWS || !finite(pageWidth) || pageWidth <= 0) return 0;
  const reference = rows[0];
  if (reference.length < MIN_TABLE_COLUMNS) return 0;
  const tolerance = TABLE_BOUNDARY_TOLERANCE * pageWidth;
  const aligned = rows.filter(
    (row) =>
      row.length === reference.length &&
      row.every((boundary) => reference.some((wanted) => Math.abs(boundary - wanted) <= tolerance)),
  ).length;
  return aligned / rows.length;
}

export function qualifiesTable(rows: readonly (readonly number[])[], pageWidth: number): boolean {
  if (rows.length < MIN_TABLE_ROWS) return false;
  const columns = Math.max(...rows.map((row) => row.length));
  return columns >= MIN_TABLE_COLUMNS && tableRowAgreement(rows, pageWidth) >= TABLE_ROW_AGREEMENT;
}

/** Stable, non-secret identity key; a snapshot never gains a disk stamp. */
export function sourceIdentityKey(identity: PdfSourceIdentity): string {
  if (identity.kind === "disk") {
    return `d:${identity.stamp.volume_id}:${identity.stamp.file_id}:${identity.stamp.modified_ticks}:${identity.stamp.size_bytes}`;
  }
  return `s:${identity.document_id}:${identity.revision}:${identity.content_id}:${identity.sensitive ? 1 : 0}`;
}

export function sameSourceIdentity(a: PdfSourceIdentity, b: PdfSourceIdentity): boolean {
  return sourceIdentityKey(a) === sourceIdentityKey(b);
}

export type BoundSources =
  | { ok: true; sources: ExtractionSource[] }
  | { ok: false; error: "ai_extract.changed"; sources: [] };

/** Revalidate every source before work continues. A changed stamp or a
 * snapshot revision/content mismatch aborts with zero usable sources. */
export function resolveBoundSources(
  sources: readonly ExtractionSource[],
  current: ReadonlyMap<string, PdfSourceIdentity | undefined>,
): BoundSources {
  for (const source of sources) {
    const now = current.get(source.id);
    if (!now || !sameSourceIdentity(source.identity, now)) {
      return { ok: false, error: "ai_extract.changed", sources: [] };
    }
  }
  return { ok: true, sources: sources.map((source) => ({ ...source })) };
}
