/** File-name patterns and output-name parts (Step 08b D9, E5).
 *
 * This is the instant preview mirror of `crates/convert/src/naming.rs`; the
 * Rust function is authoritative and the native side validates every result
 * again. A pattern is data, never executable text or a regular expression.
 *
 * Tokens are braced: `{stem}`, `{ext}`, `{index}` and `{date}`. The pattern is
 * expanded exactly once; no adapter appends an extension or page/sheet suffix
 * afterwards. */

import type { OutputNamePart } from "./types";

/** Longest pattern, in Unicode scalar values (D9). */
export const MAX_PATTERN_CHARS = 128;
/** Longest resulting file name, in UTF-16 units (D9 / Windows limit). */
export const MAX_RESULT_UTF16 = 255;
/** `{index}` is padded to at least three decimal digits (D9). */
export const MIN_INDEX_DIGITS = 3;
/** The default pattern used by every request (D9). */
export const DEFAULT_NAME_PATTERN = "{stem}.{ext}";

const INVALID_LITERAL = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
const TOKENS = new Set(["stem", "ext", "index", "date"]);

/** A canonical target extension: lower-case ASCII letters and digits. */
export function isCanonicalExtension(ext: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(ext);
}

/** At least three digits; larger indices keep all their digits. */
export function formatIndex(index: number): string {
  return String(Math.max(0, Math.trunc(index))).padStart(MIN_INDEX_DIGITS, "0");
}

export function formatPage(page: number): string {
  return formatIndex(Math.max(1, Math.trunc(page)));
}

/** Strict `YYYY-MM-DD` in UTC, including leap years. */
export function isValidUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year === 0 || month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= days;
}

/** A worksheet name as it may appear inside a file name (D6). */
export function normalizeSheetComponent(sheet: string): string {
  let value = "";
  for (const character of Array.from(sheet)) {
    value += character.charCodeAt(0) < 32 || INVALID_LITERAL.has(character) ? "_" : character;
  }
  value = value.replace(/[ .]+$/u, "");
  return value === "" ? "sheet" : value;
}

/** The effective stem after one adapter-provided output-name part. */
export function effectiveStem(stem: string, part: OutputNamePart): string {
  if (part.kind === "none") return stem;
  if (part.kind === "page") return `${stem}-page-${formatPage(part.page)}`;
  return `${stem}-${normalizeSheetComponent(part.sheet)}`;
}

/** Windows file-name rules used for an instant preview, before Rust checks
 * `fs_service::validate_new_name` again. */
function resultNameError(result: string): string | null {
  if (result === "" || result.length > MAX_RESULT_UTF16) return "convert.invalid_pattern";
  if (result.endsWith(" ") || result.endsWith(".")) return "convert.invalid_pattern";
  if (/[\u0000-\u001f<>:"/\\|?*]/u.test(result)) return "convert.invalid_pattern";
  const base = result.replace(/\.[^.]*$/u, "").toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) return "convert.invalid_pattern";
  return null;
}

/**
 * Expand a pattern once.
 *
 * Returns `{ name }` or `{ error: "convert.invalid_pattern" }`; it never
 * writes a file or touches a path.
 */
export function renderConversionName(
  pattern: string,
  stem: string,
  ext: string,
  index: number,
  dateUtc: string,
): { name: string } | { error: string } {
  if (
    pattern === "" ||
    Array.from(pattern).length > MAX_PATTERN_CHARS ||
    stem === "" ||
    !isCanonicalExtension(ext) ||
    !Number.isInteger(index) ||
    index < 1 ||
    !isValidUtcDate(dateUtc)
  ) {
    return { error: "convert.invalid_pattern" };
  }

  const counts = new Map<string, number>();
  let pos = 0;
  while (pos < pattern.length) {
    const open = pattern.indexOf("{", pos);
    const close = pattern.indexOf("}", pos);
    if (close !== -1 && (open === -1 || close < open)) {
      return { error: "convert.invalid_pattern" };
    }
    if (open === -1) {
      const literal = pattern.slice(pos);
      if (!literalIsValid(literal)) return { error: "convert.invalid_pattern" };
      break;
    }
    const literal = pattern.slice(pos, open);
    if (!literalIsValid(literal)) return { error: "convert.invalid_pattern" };
    const end = pattern.indexOf("}", open + 1);
    if (end === -1) return { error: "convert.invalid_pattern" };
    const token = pattern.slice(open + 1, end);
    if (!TOKENS.has(token) || token.includes("{")) {
      return { error: "convert.invalid_pattern" };
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if ((counts.get(token) ?? 0) > 1) return { error: "convert.invalid_pattern" };
    pos = end + 1;
  }

  if ((counts.get("ext") ?? 0) !== 1 || !pattern.endsWith(".{ext}")) {
    return { error: "convert.invalid_pattern" };
  }

  const values: Record<string, string> = {
    stem,
    ext,
    index: formatIndex(index),
    date: dateUtc,
  };
  let result = "";
  let cursor = 0;
  while (cursor < pattern.length) {
    const open = pattern.indexOf("{", cursor);
    if (open === -1) {
      result += pattern.slice(cursor);
      break;
    }
    result += pattern.slice(cursor, open);
    const end = pattern.indexOf("}", open + 1);
    result += values[pattern.slice(open + 1, end)] ?? "";
    cursor = end + 1;
  }

  const error = resultNameError(result);
  return error ? { error } : { name: result };
}

function literalIsValid(literal: string): boolean {
  for (const character of Array.from(literal)) {
    const code = character.charCodeAt(0);
    if (code < 32 || INVALID_LITERAL.has(character)) return false;
  }
  return true;
}
