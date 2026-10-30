import type { TFunction } from "i18next";

/** Error codes from Rust look like `files.not_found` (plan/conventions.md
 * 4.2). These helpers turn a rejected `invoke` into a translated message. */

/** The raw code string of a rejected invoke, or "" when there is none. */
export function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

/** `errors.<area>.<reason>` for codes of this area, else `errors.<area>.other`. */
export function errorText(t: TFunction, error: unknown, area: string): string {
  const code = errorCode(error);
  const reason = code.startsWith(`${area}.`) ? code.slice(area.length + 1) : "other";
  return t(`errors.${area}.${reason}`, { defaultValue: t(`errors.${area}.other`) });
}
