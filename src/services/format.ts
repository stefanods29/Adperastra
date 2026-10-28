/** Locale-aware display formatting (rules.md section 2). */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

export function formatDate(unixSeconds: number, locale: string): string {
  if (!unixSeconds) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(unixSeconds * 1000),
  );
}