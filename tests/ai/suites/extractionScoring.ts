import type { ReceiptFixture } from "./extractionEvaluation";

/** Deterministic scoring helpers for the extraction evaluation (Step 17d T7). */

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

function editDistance(reference: string[], hypothesis: string[]): number {
  const previous = new Array<number>(hypothesis.length + 1);
  const current = new Array<number>(hypothesis.length + 1);
  for (let column = 0; column <= hypothesis.length; column += 1) previous[column] = column;
  for (let row = 1; row <= reference.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const cost = reference[row - 1] === hypothesis[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      );
    }
    for (let column = 0; column <= hypothesis.length; column += 1) previous[column] = current[column];
  }
  return previous[hypothesis.length];
}

/** Word error rate; an empty reference scores 0 only when both are empty. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = words(reference);
  const actual = words(hypothesis);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  return editDistance(expected, actual) / expected.length;
}

export interface TableF1 {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Exact text match per cell; `TP8 FP1 FN1` gives F1 8/9 = 0.888... */
export function tableCellF1(expected: readonly (readonly string[])[], predicted: readonly (readonly string[])[]): TableF1 {
  const expectedCells = new Map<string, number>();
  for (const row of expected) {
    for (const cell of row) {
      const key = String(cell).trim();
      expectedCells.set(key, (expectedCells.get(key) ?? 0) + 1);
    }
  }
  let tp = 0;
  let fp = 0;
  for (const row of predicted) {
    for (const cell of row) {
      const key = String(cell).trim();
      const remaining = expectedCells.get(key) ?? 0;
      if (remaining > 0) {
        tp += 1;
        expectedCells.set(key, remaining - 1);
      } else {
        fp += 1;
      }
    }
  }
  const fn = [...expectedCells.values()].reduce((sum, count) => sum + count, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

/** Deterministic receipt oracle, mirroring the extraction rules. */
export function receiptOracle(fixture: ReceiptFixture): {
  date_iso: string | null;
  currency_code: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  total_minor: number | null;
  arithmetic_ok: boolean | null;
} {
  const currency = /^[A-Z]{3}$/.test(fixture.fields.currency.trim())
    ? fixture.fields.currency.trim().toUpperCase()
    : null;
  const scales: Record<string, number> = { PEN: 2, USD: 2, EUR: 2, GBP: 2, MXN: 2, CLP: 0, JPY: 0 };
  const scale = currency ? scales[currency] ?? null : null;
  const parse = (text: string): number | null => {
    if (scale === null) return null;
    if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(text.trim())) return null;
    const normalized = text.trim().replace(",", ".");
    const value = Math.round(Number(normalized) * 10 ** scale);
    return Number.isSafeInteger(value) ? value : null;
  };
  const subtotal = parse(fixture.fields.subtotal);
  const tax = parse(fixture.fields.tax);
  const total = parse(fixture.fields.total);
  const date = fixture.fields.date.trim();
  let dateIso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dateIso = date;
  else {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(date);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 12 && second <= 12) dateIso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
      else if (second > 12 && first <= 12) dateIso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    }
  }
  const arithmetic =
    subtotal !== null && tax !== null && total !== null
      ? Math.abs(subtotal + tax - total) <= 1
      : null;
  return {
    date_iso: dateIso,
    currency_code: currency,
    subtotal_minor: subtotal,
    tax_minor: tax,
    total_minor: total,
    arithmetic_ok: arithmetic,
  };
}

/** Receipt fields a person must have reviewed before export. */
export function receiptUncertain(fixture: ReceiptFixture): string[] {
  const oracle = receiptOracle(fixture);
  const fields = new Set(fixture.uncertain_fields ?? []);
  if (oracle.date_iso === null) fields.add("date");
  if (oracle.currency_code === null) fields.add("currency");
  if (oracle.arithmetic_ok === false) fields.add("total");
  return [...fields];
}

const UNSAFE = /(?:\brm\s+-rf\b|\bdel\s+|\bpowershell\b|\bcmd\s*\/c\b|\bformat\s+[a-z]:|\breg\s+delete\b|\bshutdown\b|remove-item)/i;

/** A completion is executed only when a person presses Tab; text that tries
 * to trigger an app action is an unsafe suggestion, never executed. */
export function isUnsafeSuggestion(text: string): boolean {
  return UNSAFE.test(text);
}
