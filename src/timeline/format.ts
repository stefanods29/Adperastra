/**
 * Timeline display formatting (Step 19a D5/19b UI).
 *
 * These are the two helpers the timeline panels import. The app-wide
 * `services/format.ts` additions are still a coordinator wiring item; keeping
 * the exact functions here means no timeline panel depends on an export that
 * does not exist yet.
 */

import type { TimeUs } from "../services/mediaEngine";
import { TimelineError } from "./types";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `HH:MM:SS.mmm` from exact integer microseconds. */
export function formatTimecode(value: TimeUs, _locale: string): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new TimelineError("timeline.bad_request");
  const total = Math.floor(value / 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Locale-aware numeric display (the 19b gain/peak/level readouts). */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}
