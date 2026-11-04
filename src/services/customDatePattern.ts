/** The small, safe custom date pattern (Step 10c T3, display-formats-1).
 *
 * Only the tokens listed below and the literal characters `space`, `-`,
 * `:`, `.` and `,` are accepted. There is no user regular expression and
 * no code execution. Longest tokens match first, so `YYYY` is one token,
 * not four `Y`s.
 */

export const CUSTOM_DATE_PATTERN_MAX = 64;

export const CUSTOM_DATE_TOKENS = ["YYYY", "MM", "DD", "HH", "hh", "mm", "ss", "A"] as const;
export type CustomDateToken = (typeof CUSTOM_DATE_TOKENS)[number];

const LITERAL_CHARS = new Set([" ", "-", ":", ".", ","]);

type PatternPart = { kind: "field"; token: CustomDateToken } | { kind: "literal"; text: string };

/** Parse a pattern, or null when it contains an unknown character/token. */
export function parseCustomDatePattern(pattern: string): PatternPart[] | null {
  if (pattern.length === 0 || Array.from(pattern).length > CUSTOM_DATE_PATTERN_MAX) return null;
  const chars = Array.from(pattern);
  const parts: PatternPart[] = [];
  let index = 0;
  let fields = 0;
  while (index < chars.length) {
    const rest = chars.slice(index, index + 4).join("");
    const four = CUSTOM_DATE_TOKENS.find((token) => token.length === 4 && rest.startsWith(token));
    if (four !== undefined) {
      parts.push({ kind: "field", token: four });
      fields += 1;
      index += 4;
      continue;
    }
    const twoText = chars.slice(index, index + 2).join("");
    const two = CUSTOM_DATE_TOKENS.find((token) => token.length === 2 && twoText === token);
    if (two !== undefined) {
      parts.push({ kind: "field", token: two });
      fields += 1;
      index += 2;
      continue;
    }
    const one = chars[index];
    if (one === "A") {
      parts.push({ kind: "field", token: "A" });
      fields += 1;
      index += 1;
      continue;
    }
    if (LITERAL_CHARS.has(one)) {
      parts.push({ kind: "literal", text: one });
      index += 1;
      continue;
    }
    return null;
  }
  return fields > 0 ? parts : null;
}

export function isValidCustomDatePattern(pattern: string): boolean {
  return parseCustomDatePattern(pattern) !== null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dayPeriod(date: Date, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    hour12: true,
  }).formatToParts(date);
  return parts.find((part) => part.type === "dayPeriod")?.value ?? "";
}

/**
 * Format a date with a validated pattern. An invalid pattern raises
 * `preferences.invalid_format`; callers validate before saving.
 */
export function formatCustomDatePattern(pattern: string, date: Date, locale: string): string {
  const parts = parseCustomDatePattern(pattern);
  if (parts === null) throw new Error("preferences.invalid_format");
  let result = "";
  for (const part of parts) {
    if (part.kind === "literal") {
      result += part.text;
      continue;
    }
    switch (part.token) {
      case "YYYY":
        result += String(date.getFullYear()).padStart(4, "0");
        break;
      case "MM":
        result += pad2(date.getMonth() + 1);
        break;
      case "DD":
        result += pad2(date.getDate());
        break;
      case "HH":
        result += pad2(date.getHours());
        break;
      case "hh": {
        const hour = date.getHours() % 12;
        result += pad2(hour === 0 ? 12 : hour);
        break;
      }
      case "mm":
        result += pad2(date.getMinutes());
        break;
      case "ss":
        result += pad2(date.getSeconds());
        break;
      case "A":
        result += dayPeriod(date, locale);
        break;
    }
  }
  return result;
}
