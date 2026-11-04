import type { IndexRoot, SearchMode, SearchSettings } from "../services/search";

/** Pure settings schema-34 data. Kept out of `services/search.ts` so
 * `services/settings.ts` does not create a runtime import cycle. */

export const SEARCH_INDEX_LIMITS_MB: readonly number[] = [
  128, 256, 512, 1024, 2048, 4096, 8192,
];

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  roots: [],
  default_mode: "name",
  index_limit_mb: 2048,
  content_max_chars: 100_000,
  usn_enabled: false,
  excluded_paths: [],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ABSOLUTE_RE = /^(?:[A-Za-z]:\\|\\\\)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors native `validate_absolute_path`: absolute, bounded and without
 * parent-directory components. */
function isSafeAbsolutePath(value: string): boolean {
  if (value.trim().length === 0 || value.length > 32_768) return false;
  if (!ABSOLUTE_RE.test(value)) return false;
  return !value.split(/[\\/]+/).some((part) => part === "..");
}

/** Repair search settings field by field; invalid roots and limits fall back
 * without changing any other setting. */
export function normalizeSearchSettings(value: unknown): SearchSettings {
  const input = isRecord(value) ? value : {};
  const roots: IndexRoot[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.roots)) {
    for (const entry of input.roots) {
      if (roots.length >= 32) break;
      if (!isRecord(entry)) continue;
      if (
        typeof entry.id !== "string" ||
        !UUID_RE.test(entry.id) ||
        typeof entry.path !== "string" ||
        !isSafeAbsolutePath(entry.path)
      ) {
        continue;
      }
      const key = entry.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const filename = typeof entry.filename === "boolean" ? entry.filename : true;
      // Native skips a root without filename indexing, so content and OCR
      // cannot be effective for it either.
      const content = filename && entry.content === true;
      roots.push({
        id: entry.id,
        path: entry.path,
        filename,
        content,
        ocr: content && entry.ocr === true,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      });
    }
  }
  const defaultMode: SearchMode =
    input.default_mode === "content" ||
    input.default_mode === "filters" ||
    input.default_mode === "regex" ||
    input.default_mode === "name"
      ? input.default_mode
      : "name";
  const indexLimit =
    typeof input.index_limit_mb === "number" &&
    SEARCH_INDEX_LIMITS_MB.includes(input.index_limit_mb)
      ? input.index_limit_mb
      : DEFAULT_SEARCH_SETTINGS.index_limit_mb;
  const contentMax =
    typeof input.content_max_chars === "number" &&
    Number.isInteger(input.content_max_chars) &&
    input.content_max_chars >= 1_000 &&
    input.content_max_chars <= 100_000
      ? input.content_max_chars
      : DEFAULT_SEARCH_SETTINGS.content_max_chars;
  const excluded: string[] = [];
  if (Array.isArray(input.excluded_paths)) {
    for (const path of input.excluded_paths) {
      if (excluded.length >= 100) break;
      if (typeof path === "string" && isSafeAbsolutePath(path)) {
        excluded.push(path);
      }
    }
  }
  return {
    roots,
    default_mode: defaultMode,
    index_limit_mb: indexLimit,
    content_max_chars: contentMax,
    usn_enabled: input.usn_enabled === true,
    excluded_paths: excluded,
  };
}
