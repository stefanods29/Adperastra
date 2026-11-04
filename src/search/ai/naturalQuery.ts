/**
 * Natural language -> editable 11a filters (Step 17c T4).
 *
 * The model output is validated by the registered schema, then normalized
 * once into the ordinary SearchQuery AST. Dates are resolved against the
 * captured UTC instant and the explicit IANA timezone; nothing searches until
 * the user confirms the preview.
 */

import { search, type SearchFilter, type SearchQuery } from "../../services/search";
import type { JobHandle } from "../../services/jobs";
import type { SearchPage } from "../../services/search";
import type { NaturalQueryPreview, NaturalQueryRequest } from "../../services/aiSearchTypes";
import { PREVIEW_TTL_SECONDS, validateAiSearchQuery } from "../../services/aiSearchTypes";
import {
  modelFilterAsSearchFilter,
  validateNaturalQueryOutput,
  type NaturalQueryModelFilter,
  type NaturalQueryModelOutput,
} from "./aiSearchModelOutputs";

export interface NaturalQueryChip {
  kind: "string" | "number" | "date" | "root" | "sort" | "extension" | "missing";
  field?: string;
  op?: string;
  value?: string | number;
  from_unix?: number;
  to_unix?: number;
  root_id?: string;
  exclude?: boolean;
}

export type PreviewResult =
  | { ok: true; preview: NaturalQueryPreview }
  | { ok: false; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}

/** Parts in a real IANA zone; invalid zones throw and are refused upstream. */
function zonedParts(unix: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unix * 1000));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day") };
}

function zoneOffsetMs(unix: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unix * 1000));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return asUtc - unix * 1000;
}

/** Convert a civil time in `timeZone` to a Unix instant (two-pass DST). */
export function zonedTimeToUnix(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour) / 1000;
  const first = zoneOffsetMs(guess, timeZone);
  const second = zoneOffsetMs(guess - first / 1000, timeZone);
  return Math.round(guess - second / 1000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Half-open internal interval converted once to 11a's inclusive bounds.
 * October 2026 in UTC is 1790812800 through 1793491199.
 */
export function resolveRelativeDate(
  preset: string,
  capturedNowUnix: number,
  timeZone: string,
): { from_unix: number; to_unix: number } {
  const now = zonedParts(capturedNowUnix, timeZone);
  const currentMonthStart = zonedTimeToUnix(now.year, now.month, 1, 0, timeZone);
  let start: number;
  let end: number;
  switch (preset) {
    case "today": {
      start = zonedTimeToUnix(now.year, now.month, now.day, 0, timeZone);
      end = start + 86_400;
      break;
    }
    case "yesterday": {
      const day = new Date(Date.UTC(now.year, now.month - 1, now.day) - 86_400_000);
      start = zonedTimeToUnix(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, timeZone);
      end = zonedTimeToUnix(now.year, now.month, now.day, 0, timeZone);
      break;
    }
    case "this_week": {
      const weekday = (new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay() + 6) % 7;
      start = zonedTimeToUnix(now.year, now.month, now.day, 0, timeZone) - weekday * 86_400;
      end = start + 7 * 86_400;
      break;
    }
    case "last_week": {
      const weekday = (new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay() + 6) % 7;
      end = zonedTimeToUnix(now.year, now.month, now.day, 0, timeZone) - weekday * 86_400;
      start = end - 7 * 86_400;
      break;
    }
    case "this_month": {
      start = currentMonthStart;
      const next = now.month === 12 ? { year: now.year + 1, month: 1 } : { year: now.year, month: now.month + 1 };
      end = zonedTimeToUnix(next.year, next.month, 1, 0, timeZone);
      break;
    }
    case "last_month": {
      const previous = previousMonth(now.year, now.month);
      start = zonedTimeToUnix(previous.year, previous.month, 1, 0, timeZone);
      end = currentMonthStart;
      break;
    }
    case "this_year": {
      start = zonedTimeToUnix(now.year, 1, 1, 0, timeZone);
      end = zonedTimeToUnix(now.year + 1, 1, 1, 0, timeZone);
      break;
    }
    case "last_year": {
      start = zonedTimeToUnix(now.year - 1, 1, 1, 0, timeZone);
      end = zonedTimeToUnix(now.year, 1, 1, 0, timeZone);
      break;
    }
    default:
      throw new Error("ai_search.ambiguous");
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("ai_search.invalid");
  }
  return { from_unix: Math.max(0, Math.round(start)), to_unix: Math.max(0, Math.round(end) - 1) };
}

function dateBounds(
  filter: Extract<NaturalQueryModelFilter, { kind: "date" }>,
  request: NaturalQueryRequest,
): { from?: number; to?: number } {
  if (filter.preset) {
    const bounds = resolveRelativeDate(filter.preset, request.now_unix, request.timezone);
    return { from: bounds.from_unix, to: bounds.to_unix };
  }
  const from = filter.from
    ? zonedTimeToUnix(
        Number(filter.from.slice(0, 4)),
        Number(filter.from.slice(5, 7)),
        Number(filter.from.slice(8, 10)),
        0,
        request.timezone,
      )
    : undefined;
  const to = filter.to
    ? zonedTimeToUnix(
        Number(filter.to.slice(0, 4)),
        Number(filter.to.slice(5, 7)),
        Number(filter.to.slice(8, 10)),
        0,
        request.timezone,
      ) + 86_399
    : undefined;
  return { from, to };
}

function numberBytes(filter: Extract<NaturalQueryModelFilter, { kind: "number" }>): number | null {
  const scale =
    filter.unit === "KiB" ? 1024 : filter.unit === "MiB" ? 1024 * 1024 : filter.unit === "GiB" ? 1024 ** 3 : 1;
  const bytes = Math.ceil(filter.value * scale);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  if (filter.op === "gt") return bytes + 1;
  if (filter.op === "lt") return bytes === 0 ? 0 : bytes - 1;
  return bytes;
}

function toFilter(filter: NaturalQueryModelFilter | null, request: NaturalQueryRequest): SearchFilter | null {
  return modelFilterAsSearchFilter(filter, numberBytes, (value) => dateBounds(value, request));
}

function previewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return uuid();
}

/** Pure preview builder: zero search calls. */
export function buildNaturalQueryPreview(
  raw: unknown,
  request: NaturalQueryRequest,
  allowedRootIds: readonly string[],
): PreviewResult {
  if (!Number.isFinite(request.now_unix) || request.now_unix <= 0) return { ok: false, code: "ai_search.invalid" };
  if (request.text.trim().length === 0 || Array.from(request.text).length > 1024) {
    return { ok: false, code: "ai_search.invalid" };
  }
  if (request.root_ids.length === 0 || request.root_ids.length > 32) {
    return { ok: false, code: "ai_search.too_large" };
  }
  const validated = validateNaturalQueryOutput(raw);
  if (!validated.ok) return { ok: false, code: "ai_search.invalid" };
  const output: NaturalQueryModelOutput = validated.value;
  const base = {
    id: previewId(),
    request_revision: request.request_revision,
    captured_now_unix: request.now_unix,
    expires_unix: request.now_unix + PREVIEW_TTL_SECONDS,
  };
  if (output.status === "clarify") {
    return {
      ok: true,
      preview: {
        ...base,
        status: "clarify",
        query: null,
        explanation: output.explanation,
        unsupported: output.unsupported,
      },
    };
  }
  if (!output.query) return { ok: false, code: "ai_search.invalid" };
  if (output.unsupported.length > 0) {
    return {
      ok: true,
      preview: { ...base, status: "clarify", query: null, explanation: output.explanation, unsupported: output.unsupported },
    };
  }
  const allowed = new Set(allowedRootIds);
  const requested = new Set(request.root_ids);
  for (const root of output.query.roots) {
    if (!requested.has(root) || !allowed.has(root)) return { ok: false, code: "ai_search.denied" };
  }
  if (new Set(output.query.roots).size !== output.query.roots.length) {
    return { ok: false, code: "ai_search.invalid" };
  }
  let filter: SearchFilter | null;
  try {
    filter = toFilter(output.query.filter, request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ai_search.invalid";
    return { ok: false, code };
  }
  if (output.query.filter !== null && filter === null) return { ok: false, code: "ai_search.invalid" };
  const query: SearchQuery = {
    mode: "filters",
    text: output.query.text,
    roots: output.query.roots,
    filter,
    regex_scope: "name",
    match_case: false,
    sort: output.query.sort ?? { key: "name", direction: "ascending" },
  };
  if (!validateAiSearchQuery(query)) return { ok: false, code: "ai_search.invalid" };
  return {
    ok: true,
    preview: {
      ...base,
      status: "ready",
      query,
      explanation: output.explanation,
      unsupported: [],
    },
  };
}

/**
 * The explicit confirmation. Esc/close never calls this; Enter inside a ready
 * dialog does. Only the interpreted SearchQuery is saved, never model text.
 */
export async function confirmNaturalQuery(
  preview: NaturalQueryPreview,
  edited: SearchQuery,
): Promise<JobHandle<SearchPage>> {
  if (preview.status !== "ready" || !preview.query) throw new Error("ai_search.ambiguous");
  if (!validateAiSearchQuery(edited)) throw new Error("ai_search.invalid");
  const reviewed = new Set(preview.query.roots);
  if (!edited.roots.every((root) => reviewed.has(root))) throw new Error("ai_search.denied");
  return search(edited);
}

function chipsForFilter(filter: SearchFilter | null | undefined): NaturalQueryChip[] {
  if (!filter) return [];
  if (filter.kind === "all" || filter.kind === "any") return filter.clauses.flatMap(chipsForFilter);
  if (filter.kind === "not") return chipsForFilter(filter.clause);
  if (filter.kind === "string") {
    return [{ kind: "string", field: filter.field, op: filter.op, value: filter.value }];
  }
  if (filter.kind === "number") {
    return [{ kind: "number", field: filter.field, op: filter.op, value: filter.value }];
  }
  if (filter.kind === "date") {
    return [{ kind: "date", field: filter.field, from_unix: filter.from_unix, to_unix: filter.to_unix }];
  }
  if (filter.kind === "ext_list") {
    return filter.values.map((value) => ({
      kind: "extension" as const,
      value,
      exclude: filter.exclude,
    }));
  }
  if (filter.kind === "missing_date") {
    return [{ kind: "missing", field: filter.field }];
  }
  return [];
}

/** Every typed clause, every root and the sort are shown before Search. */
export function naturalQueryChips(preview: NaturalQueryPreview): NaturalQueryChip[] {
  if (!preview.query) return [];
  return [
    ...chipsForFilter(preview.query.filter),
    ...preview.query.roots.map((root) => ({ kind: "root" as const, root_id: root })),
    { kind: "sort", field: preview.query.sort.key, value: preview.query.sort.direction },
  ];
}

/** Saved searches store exactly this query, never the AI execution plan. */
export function savedNaturalQuery(preview: NaturalQueryPreview): SearchQuery | null {
  return preview.query ? { ...preview.query, roots: [...preview.query.roots] } : null;
}

export { isRecord, daysInMonth };
