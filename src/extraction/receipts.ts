/** Receipt parsing rules (Step 17d T3, decision D5).
 *
 * Amounts become signed minor units only when the source states an explicit
 * ISO 4217 currency with a known scale. A missing or unknown currency stays
 * text. Ambiguous D/M versus M/D dates stay text until a person reviews them.
 * Tax IDs and other identifiers are never converted to numbers.
 */

/** Known currencies and their minor-unit exponent. Unknown codes have none. */
export const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
  PEN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  MXN: 2,
  CAD: 2,
  BRL: 2,
  ARS: 2,
  CLP: 0,
  COP: 2,
  JPY: 0,
  KRW: 0,
  CNY: 2,
  INR: 2,
  CHF: 2,
  KWD: 3,
  BHD: 3,
  TND: 3,
};

export const RECEIPT_MISMATCH_WARNING = "receipt_arithmetic_mismatch";
export const RECEIPT_DATE_AMBIGUOUS = "receipt_date_ambiguous";
export const RECEIPT_CURRENCY_UNKNOWN = "receipt_currency_unknown";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const AMOUNT = /^-?(?:\d{1,3}(?:[., ]\d{3})+|\d+)(?:[.,]\d{1,3})?$/;

/** The exponent of an explicit ISO code, or null when it is not known. */
export function currencyScale(code: string | null | undefined): number | null {
  if (typeof code !== "string") return null;
  const key = code.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, key)
    ? CURRENCY_MINOR_UNITS[key]
    : null;
}

/** The explicit ISO code of a field value, or null. Never inferred. */
export function explicitCurrency(text: string): string | null {
  const code = text.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return currencyScale(code) === null ? null : code;
}

function digits(value: string): number {
  return Number(value.replace(/\D/g, ""));
}

/**
 * Parse an amount to minor units. With scale 2, `100.00`, `100,00`,
 * `1,234.56` and `1.234,56` parse; `1.234` is ambiguous and returns null.
 */
export function parseMinorAmount(text: string, currencyCode: string | null): number | null {
  const scale = currencyScale(currencyCode);
  if (scale === null) return null;
  const raw = text.trim();
  if (raw === "" || raw.length > 32 || !AMOUNT.test(raw)) return null;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const lastSeparator = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let whole: string;
  let fraction = "";
  if (lastSeparator >= 0) {
    whole = body.slice(0, lastSeparator);
    fraction = body.slice(lastSeparator + 1);
    if (!/^\d{1,3}$/.test(fraction)) return null;
    // A three-digit tail under a 2-decimal currency could be a thousands
    // group; refuse to guess instead of inventing cents.
    if (fraction.length > scale) {
      if (fraction.length !== 3) return null;
      if (scale === 0) {
        whole = `${whole}${fraction}`;
        fraction = "";
      } else {
        return null;
      }
    }
  } else {
    whole = body;
  }
  if (!/^\d{1,3}(?:[., ]\d{3})*$|^\d+$/.test(whole)) return null;
  const wholeDigits = digits(whole);
  const fractionDigits = fraction === "" ? 0 : Number(fraction.padEnd(scale, "0"));
  const factor = 10 ** scale;
  const value = wholeDigits * factor + (scale === 0 ? 0 : fractionDigits);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * An unambiguous date becomes ISO `YYYY-MM-DD`. `03/04/2026` could be the
 * third of April or the fourth of March, so it returns null (D5).
 */
export function parseReceiptDate(text: string): string | null {
  const raw = text.trim();
  const iso = ISO_DATE.exec(raw);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = SLASH_DATE.exec(raw);
  if (!local) return null;
  const first = Number(local[1]);
  const second = Number(local[2]);
  const year = Number(local[3]);
  if (first > 12 && second <= 12) return validDate(year, second, first);
  if (second > 12 && first <= 12) return validDate(year, first, second);
  return null;
}

/** Identifiers stay text: leading zeros and separators survive exactly. */
export function taxIdText(text: string): string {
  return text.trim();
}

export interface ReceiptFieldText {
  vendor: string;
  tax_id: string;
  date: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
}

export interface ReceiptArithmetic {
  currency_code: string | null;
  date_iso: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  total_minor: number | null;
  /** Null when a required amount or currency is missing or unknown. */
  arithmetic_ok: boolean | null;
  warnings: string[];
}

/** Recompute every derived receipt field from the reviewed text. */
export function computeReceipt(field: ReceiptFieldText): ReceiptArithmetic {
  const warnings: string[] = [];
  const currency = explicitCurrency(field.currency);
  if (field.currency.trim() !== "" && currency === null) warnings.push(RECEIPT_CURRENCY_UNKNOWN);
  const subtotal = parseMinorAmount(field.subtotal, currency);
  const tax = parseMinorAmount(field.tax, currency);
  const total = parseMinorAmount(field.total, currency);
  let arithmeticOk: boolean | null = null;
  if (subtotal !== null && tax !== null && total !== null) {
    arithmeticOk = Math.abs(subtotal + tax - total) <= 1;
    if (!arithmeticOk) warnings.push(RECEIPT_MISMATCH_WARNING);
  }
  const dateIso = parseReceiptDate(field.date);
  if (field.date.trim() !== "" && dateIso === null) warnings.push(RECEIPT_DATE_AMBIGUOUS);
  return {
    currency_code: currency,
    date_iso: dateIso,
    subtotal_minor: subtotal,
    tax_minor: tax,
    total_minor: total,
    arithmetic_ok: arithmeticOk,
    warnings,
  };
}

/** A field needs a person's attention when any rule could not decide. */
export function receiptNeedsReview(result: ReceiptArithmetic): boolean {
  return (
    result.arithmetic_ok !== true ||
    result.date_iso === null ||
    result.currency_code === null ||
    result.warnings.length > 0
  );
}
