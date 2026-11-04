import type { SheetCleanOperation } from "./sheetAiTypes";

type Format = Extract<SheetCleanOperation, { kind: "normalize_date" }>["source_format"];
/** Gregorian validation without Date rollover, timezone conversion or locale guessing. */
export function cleaningDate(text: string, format: Format): string | null {
  let year: number, month: number, day: number;
  if (format === "YYYY-MM-DD") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;
    [, year, month, day] = match.map(Number);
  } else {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!match) return null;
    year = Number(match[3]);
    month = Number(match[format === "DD/MM/YYYY" ? 2 : 1]);
    day = Number(match[format === "DD/MM/YYYY" ? 1 : 2]);
  }
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
