/** Date rules for the Gallery (Step 07c, decisions D5/D6; export E3).
 * Pure: the same rules produce the backend's UTC group key and the local
 * month label, so 11b can reuse them instead of inventing a second rule. */

import { displayPath } from "../../services/explorer";
import type { GalleryDateSource, GalleryItem } from "../../services/gallery";

export const GALLERY_UNDATED = "undated";

export interface GalleryGroup {
  /** `YYYY-MM` or `undated`. */
  key: string;
  /** Locale-aware month label; empty for the undated group. */
  label: string;
  items: GalleryItem[];
}

/** The active time zone, or UTC when the platform cannot report one. */
export function galleryTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Taken when requested and valid, else modified; 0 means no date. */
export function galleryEffectiveUnix(
  takenUtc: string | null,
  fallbackModifiedUnix: number,
  dateSource: GalleryDateSource,
): number {
  if (dateSource === "taken" && takenUtc) {
    const parsed = Date.parse(takenUtc);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  if (Number.isFinite(fallbackModifiedUnix) && fallbackModifiedUnix > 0) {
    return Math.floor(fallbackModifiedUnix);
  }
  return 0;
}

function monthParts(date: Date, timeZone: string): { year: string; month: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    return year && month ? { year, month } : null;
  } catch {
    return null;
  }
}

/** Canonical local `YYYY-MM` (or `undated`). A taken date is used only when
 * the user groups by date taken and a valid one exists. */
export function galleryMonthKey(
  takenUtc: string | null,
  fallbackModifiedUnix: number,
  dateSource: GalleryDateSource,
  timeZone: string,
): string {
  const timestamp = galleryEffectiveUnix(takenUtc, fallbackModifiedUnix, dateSource);
  if (timestamp === 0) return GALLERY_UNDATED;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return GALLERY_UNDATED;
  const parts = monthParts(date, timeZone) ?? monthParts(date, "UTC");
  return parts ? `${parts.year}-${parts.month}` : GALLERY_UNDATED;
}

/** A locale-aware month label; numeric keys are never translated. */
export function galleryMonthLabel(key: string, locale: string): string {
  if (key === GALLERY_UNDATED) return "";
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  // The pseudo-locale is English text in disguise; its tag is not a locale
  // Intl should format with.
  const effectiveLocale = locale === "pseudo" ? "en" : locale;
  try {
    return new Intl.DateTimeFormat(effectiveLocale, {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
    }).format(date);
  } catch {
    return "";
  }
}

export type GalleryTakenLookup = (item: GalleryItem) => string | null;

/** The taken date known for an item: the wire value first, then the value the
 * metadata service returned for the visible rows. */
export function galleryTakenUtc(item: GalleryItem, takenFor?: GalleryTakenLookup): string | null {
  return item.taken_utc ?? takenFor?.(item) ?? null;
}

/** Newest first, then normalized path ascending. Called only at a safe
 * regroup point (scan completion or Refresh), never under a live pointer. */
export function sortGalleryItems(
  items: readonly GalleryItem[],
  dateSource: GalleryDateSource,
  takenFor?: GalleryTakenLookup,
): GalleryItem[] {
  return [...items].sort((left, right) => {
    const leftDate = galleryEffectiveUnix(
      galleryTakenUtc(left, takenFor),
      left.item.modified_unix,
      dateSource,
    );
    const rightDate = galleryEffectiveUnix(
      galleryTakenUtc(right, takenFor),
      right.item.modified_unix,
      dateSource,
    );
    if (leftDate !== rightDate) return rightDate - leftDate;
    const leftPath = displayPath(left.item.path).replace(/\//g, "\\").toLowerCase();
    const rightPath = displayPath(right.item.path).replace(/\//g, "\\").toLowerCase();
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

/** Groups in newest-month-first order; `undated` is last. The input order is
 * kept inside a group so appending a page does not move the pointer. */
export function groupGalleryItems(
  items: readonly GalleryItem[],
  dateSource: GalleryDateSource,
  timeZone: string,
  locale: string,
  takenFor?: GalleryTakenLookup,
): GalleryGroup[] {
  const buckets = new Map<string, GalleryItem[]>();
  for (const item of items) {
    const key = galleryMonthKey(
      galleryTakenUtc(item, takenFor),
      item.item.modified_unix,
      dateSource,
      timeZone,
    );
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const keys = [...buckets.keys()].sort((left, right) => {
    if (left === GALLERY_UNDATED) return 1;
    if (right === GALLERY_UNDATED) return -1;
    return right.localeCompare(left);
  });
  return keys.map((key) => ({
    key,
    label: galleryMonthLabel(key, locale),
    items: buckets.get(key) ?? [],
  }));
}
