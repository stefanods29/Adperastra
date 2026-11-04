/**
 * Bounded model-output shapes for the three AI-search schemas (Step 17c T1).
 *
 * These are *model* shapes, not a second query language. Natural-language
 * output is normalized once into the Step 11a SearchFilter AST; names and
 * destinations are suggestions only. Unknown fields, operators, units and
 * concepts fail before any executable query or file operation exists.
 */

import type { AiCitation } from "../../services/localAiTypes";
import type { SearchFilter } from "../../services/search";
import {
  isCanonicalUuid,
  isSafeU64,
  MAX_AI_NAME_STEM_SCALARS,
  MAX_NATURAL_EXPLANATION_SCALARS,
  MAX_NATURAL_QUERY_SCALARS,
  MAX_UNSUPPORTED_TERMS,
  validateAiSearchQuery,
} from "../../services/aiSearchTypes";

export interface NaturalQueryModelOutput {
  status: "ready" | "clarify";
  query: NaturalQueryModelQuery | null;
  explanation: string;
  unsupported: string[];
}

export interface NaturalQueryModelQuery {
  text: string;
  roots: string[];
  filter: NaturalQueryModelFilter | null;
  sort: { key: "name" | "modified" | "size" | "kind"; direction: "ascending" | "descending" } | null;
}

export type NaturalQueryModelFilter =
  | { kind: "all"; clauses: NaturalQueryModelFilter[] }
  | { kind: "any"; clauses: NaturalQueryModelFilter[] }
  | { kind: "not"; clause: NaturalQueryModelFilter }
  | { kind: "string"; field: "kind" | "ext" | "author"; op: "eq" | "contains"; value: string }
  | {
      kind: "number";
      field: "size" | "width" | "height" | "duration_ms" | "pages";
      op: "eq" | "gte" | "lte" | "gt" | "lt";
      value: number;
      unit?: "B" | "KiB" | "MiB" | "GiB";
    }
  | {
      kind: "date";
      field: "modified" | "created" | "date_taken";
      preset?: "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "last_year";
      from?: string;
      to?: string;
    };

export interface NameSuggestionModelOutput {
  suggestions: Array<{
    input_index: number;
    proposed_stem: string;
    reason: string;
    confidence: number;
    citations: AiCitation[];
  }>;
}

export interface DestinationModelOutput {
  destination_id: string | null;
  reason: string;
  confidence: number;
}

export type ModelOutputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error_code: "ai.schema_invalid" };

const INVALID = { ok: false as const, error_code: "ai.schema_invalid" as const };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysAre(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function stringWithin(value: unknown, max: number): value is string {
  return typeof value === "string" && Array.from(value).length <= max;
}

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validFilter(value: unknown, depth: number, clauses: { count: number }): value is NaturalQueryModelFilter {
  if (!isRecord(value) || depth > 4) return false;
  clauses.count += 1;
  if (clauses.count > 32) return false;
  if (value.kind === "all" || value.kind === "any") {
    return (
      keysAre(value, ["kind", "clauses"]) &&
      Array.isArray(value.clauses) &&
      value.clauses.every((child) => validFilter(child, depth + 1, clauses))
    );
  }
  if (value.kind === "not") {
    return keysAre(value, ["kind", "clause"]) && validFilter(value.clause, depth + 1, clauses);
  }
  if (value.kind === "string") {
    return (
      keysAre(value, ["kind", "field", "op", "value"]) &&
      ["kind", "ext", "author"].includes(value.field as string) &&
      ["eq", "contains"].includes(value.op as string) &&
      stringWithin(value.value, 256)
    );
  }
  if (value.kind === "number") {
    return (
      keysAre(value, ["kind", "field", "op", "value", "unit"]) &&
      ["size", "width", "height", "duration_ms", "pages"].includes(value.field as string) &&
      ["eq", "gte", "lte", "gt", "lt"].includes(value.op as string) &&
      typeof value.value === "number" &&
      Number.isFinite(value.value) &&
      value.value >= 0 &&
      (value.unit === undefined || ["B", "KiB", "MiB", "GiB"].includes(value.unit as string))
    );
  }
  if (value.kind === "date") {
    if (!keysAre(value, ["kind", "field", "preset", "from", "to"])) return false;
    if (!["modified", "created", "date_taken"].includes(value.field as string)) return false;
    if (value.preset !== undefined) {
      return (
        typeof value.preset === "string" &&
        [
          "today",
          "yesterday",
          "this_week",
          "last_week",
          "this_month",
          "last_month",
          "this_year",
          "last_year",
        ].includes(value.preset) &&
        value.from === undefined &&
        value.to === undefined
      );
    }
    return (
      (value.from === undefined || validIsoDate(value.from)) &&
      (value.to === undefined || validIsoDate(value.to)) &&
      (value.from !== undefined || value.to !== undefined)
    );
  }
  return false;
}

export function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validateNaturalQueryOutput(value: unknown): ModelOutputResult<NaturalQueryModelOutput> {
  if (!isRecord(value) || !keysAre(value, ["status", "query", "explanation", "unsupported"])) return INVALID;
  if (value.status !== "ready" && value.status !== "clarify") return INVALID;
  if (typeof value.explanation !== "string") return INVALID;
  if (Array.from(value.explanation).length > MAX_NATURAL_EXPLANATION_SCALARS) return INVALID;
  if (!Array.isArray(value.unsupported) || value.unsupported.length > MAX_UNSUPPORTED_TERMS) return INVALID;
  if (!value.unsupported.every((term) => stringWithin(term, 128))) return INVALID;
  if (value.status === "clarify") {
    return value.query === null ? { ok: true, value: value as unknown as NaturalQueryModelOutput } : INVALID;
  }
  if (!isRecord(value.query) || !keysAre(value.query, ["text", "roots", "filter", "sort"])) return INVALID;
  const query = value.query;
  if (typeof query.text !== "string" || Array.from(query.text).length > MAX_NATURAL_QUERY_SCALARS) {
    return INVALID;
  }
  if (!Array.isArray(query.roots) || query.roots.length === 0 || query.roots.length > 32) return INVALID;
  if (!query.roots.every(isCanonicalUuid) || new Set(query.roots).size !== query.roots.length) {
    return INVALID;
  }
  if (query.filter !== null && !validFilter(query.filter, 1, { count: 0 })) return INVALID;
  if (query.sort !== null) {
    if (!isRecord(query.sort) || !keysAre(query.sort, ["key", "direction"])) return INVALID;
    if (!["name", "modified", "size", "kind"].includes(query.sort.key as string)) return INVALID;
    if (query.sort.direction !== "ascending" && query.sort.direction !== "descending") return INVALID;
  }
  return { ok: true, value: value as unknown as NaturalQueryModelOutput };
}

export function validateNameSuggestionOutput(value: unknown): ModelOutputResult<NameSuggestionModelOutput> {
  if (!isRecord(value) || !keysAre(value, ["suggestions"]) || !Array.isArray(value.suggestions)) {
    return INVALID;
  }
  if (value.suggestions.length > 100) return INVALID;
  const seen = new Set<number>();
  for (const suggestion of value.suggestions) {
    if (!isRecord(suggestion) || !keysAre(suggestion, ["input_index", "proposed_stem", "reason", "confidence", "citations"])) {
      return INVALID;
    }
    if (
      !Number.isInteger(suggestion.input_index) ||
      (suggestion.input_index as number) < 0 ||
      seen.has(suggestion.input_index as number)
    ) {
      return INVALID;
    }
    seen.add(suggestion.input_index as number);
    if (
      typeof suggestion.proposed_stem !== "string" ||
      suggestion.proposed_stem.trim().length === 0 ||
      Array.from(suggestion.proposed_stem).length > MAX_AI_NAME_STEM_SCALARS
    ) {
      return INVALID;
    }
    if (!stringWithin(suggestion.reason, 512) || !finiteUnit(suggestion.confidence)) return INVALID;
    if (!Array.isArray(suggestion.citations) || suggestion.citations.length > 8) return INVALID;
  }
  return { ok: true, value: value as unknown as NameSuggestionModelOutput };
}

export function validateDestinationOutput(value: unknown): ModelOutputResult<DestinationModelOutput> {
  if (!isRecord(value) || !keysAre(value, ["destination_id", "reason", "confidence"])) return INVALID;
  if (value.destination_id !== null && !isCanonicalUuid(value.destination_id)) return INVALID;
  if (!stringWithin(value.reason, 512) || !finiteUnit(value.confidence)) return INVALID;
  return { ok: true, value: value as unknown as DestinationModelOutput };
}

/** Convert a validated model number to the exact 11a bytes integer. */
export function modelNumberToBytes(value: number, op: "eq" | "gte" | "lte" | "gt" | "lt", unit?: string): number | null {
  const scale =
    unit === "B" || unit === undefined ? 1 : unit === "KiB" ? 1024 : unit === "MiB" ? 1024 * 1024 : unit === "GiB" ? 1024 ** 3 : 0;
  if (!scale || !Number.isFinite(value) || value < 0) return null;
  const bytes = Math.ceil(value * scale);
  if (!isSafeU64(bytes)) return null;
  if (op === "gt") return bytes + 1;
  if (op === "lt") return bytes === 0 ? 0 : bytes - 1;
  return bytes;
}

/** Structural check used by the final confirmation path as defence in depth. */
export function modelFilterAsSearchFilter(
  filter: NaturalQueryModelFilter | null,
  toBytes: (filter: Extract<NaturalQueryModelFilter, { kind: "number" }>) => number | null,
  dateBounds: (filter: Extract<NaturalQueryModelFilter, { kind: "date" }>) => { from?: number; to?: number },
): SearchFilter | null {
  if (filter === null) return null;
  if (filter.kind === "all" || filter.kind === "any") {
    const clauses: SearchFilter[] = [];
    for (const clause of filter.clauses) {
      const converted = modelFilterAsSearchFilter(clause, toBytes, dateBounds);
      if (converted === null) return null;
      clauses.push(converted);
    }
    return { kind: filter.kind, clauses };
  }
  if (filter.kind === "not") {
    const clause = modelFilterAsSearchFilter(filter.clause, toBytes, dateBounds);
    return clause ? { kind: "not", clause } : null;
  }
  if (filter.kind === "string") {
    return { kind: "string", field: filter.field, op: filter.op, value: filter.value };
  }
  if (filter.kind === "number") {
    const value = toBytes(filter);
    if (value === null) return null;
    const op = filter.op === "gt" ? "gte" : filter.op === "lt" ? "lte" : filter.op;
    return { kind: "number", field: filter.field, op, value };
  }
  const bounds = dateBounds(filter);
  if (bounds.from === undefined && bounds.to === undefined) return null;
  return { kind: "date", field: filter.field, ...bounds };
}

/** The last gate before 11a search; unknown fields cannot survive here. */
export function searchQueryFromModelOutput(output: NaturalQueryModelOutput): { query: unknown; valid: boolean } {
  if (output.status !== "ready" || output.query === null) return { query: null, valid: false };
  const query = {
    mode: "filters",
    text: output.query.text,
    roots: output.query.roots,
    filter: output.query.filter,
    regex_scope: "name",
    match_case: false,
    sort: output.query.sort ?? { key: "name", direction: "ascending" },
  };
  return { query, valid: validateAiSearchQuery(query as never) };
}
