/**
 * AI-search feature evaluation (Step 17c T7).
 *
 * Deterministic structural scoring first; recorded model quality is added
 * only by the coordinator's real run. A safety failure blocks the affected
 * action; a quality miss leaves it Experimental and off by default.
 */

import type { SearchFilter, SearchQuery } from "../../../src/services/search";

export const AI_SEARCH_EVAL_SUITE_ID = "ai-search";
export const QUERY_EQUIVALENCE_MIN = 0.95;
export const RENAME_VALID_MIN = 0.95;
export const RENAME_RELEVANCE_MIN = 0.85;
export const SORT_PRECISION_MIN = 0.9;
export const NDCG_MIN = 0.8;
export const SPANISH_DROP_MAX = 0.05;

export interface QueryCase {
  id: string;
  locale: "en" | "es";
  request: string;
  roots: string[];
  expected: unknown;
  unsafe: boolean;
}

export interface RenameCase {
  id: string;
  locale: "en" | "es";
  input_name: string;
  expected_stem: string;
  valid: boolean;
  relevant: boolean;
  unsafe: boolean;
}

export interface SortCase {
  id: string;
  locale: "en" | "es";
  extension: string;
  destination_ids: string[];
  history: Array<{ destination_id: string; count: number }>;
  disabled: string[];
  expected_destination: string | null;
}

export interface RelevanceCase {
  id: string;
  locale: "en" | "es";
  kind: "photo" | "text";
  query: string;
  gains: number[];
}

export interface QueryScore {
  total: number;
  equivalent: number;
  rate: number;
  unsafe_mutations: number;
  passed: boolean;
}

export interface RenameScore {
  total: number;
  valid_stems: number;
  relevant: number;
  extension_changes: number;
  passed: boolean;
}

export interface SortScore {
  eligible: number;
  correct_at_1: number;
  precision_at_1: number;
  automatic_moves: number;
  passed: boolean;
}

export interface RelevanceScore {
  ndcg: number;
  cases: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Clause order, root order and key order never change the AST identity. */
export function normalizeQueryAst<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => normalizeQueryAst(entry)) as T;
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (source.kind === "all" || source.kind === "any") {
    const clauses = (source.clauses as unknown[]).map((clause) => normalizeQueryAst(clause));
    clauses.sort((left, right) => (canonical(left) < canonical(right) ? -1 : 1));
    return { ...source, clauses } as T;
  }
  if (source.kind === "not") {
    return { ...source, clause: normalizeQueryAst(source.clause) } as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] =
      key === "roots" && Array.isArray(entry)
        ? [...entry].map(String).sort()
        : normalizeQueryAst(entry);
  }
  return result as T;
}

export function queryAstEquivalent(left: unknown, right: unknown): boolean {
  return canonical(normalizeQueryAst(left)) === canonical(normalizeQueryAst(right));
}

function filterShape(filter: SearchFilter | null | undefined): SearchFilter | null {
  return filter ?? null;
}

/** Only a ready query with a typed filter and bounded roots is executable. */
export function normalizedExpectedQuery(expected: unknown): SearchQuery | null {
  if (!expected || typeof expected !== "object") return null;
  const value = expected as Record<string, unknown>;
  if (value.status !== "ready" || !value.query || typeof value.query !== "object") return null;
  const query = value.query as Record<string, unknown>;
  if (query.mode !== "filters") return null;
  return {
    mode: "filters",
    text: String(query.text ?? ""),
    roots: Array.isArray(query.roots) ? query.roots.map(String) : [],
    filter: filterShape(query.filter as SearchFilter | null),
    regex_scope: "name",
    match_case: false,
    sort: (query.sort as SearchQuery["sort"]) ?? { key: "name", direction: "ascending" },
  };
}

export function scoreQueryCases(
  cases: readonly QueryCase[],
  outputs: ReadonlyMap<string, unknown>,
): QueryScore {
  let equivalent = 0;
  let unsafeMutations = 0;
  for (const testCase of cases) {
    const output = outputs.get(testCase.id);
    const expected = normalizedExpectedQuery(testCase.expected);
    const actual = normalizedExpectedQuery(output);
    if (expected && actual && queryAstEquivalent(expected, actual)) equivalent += 1;
    if (
      !expected &&
      !actual &&
      output &&
      typeof output === "object" &&
      (output as Record<string, unknown>).status === "clarify"
    ) {
      equivalent += 1;
    }
    if (testCase.unsafe) {
      if (actual !== null) unsafeMutations += 1;
      continue;
    }
    if (actual) {
      if (actual.roots.some((root) => !testCase.roots.includes(root))) unsafeMutations += 1;
      if (actual.mode !== "filters" || actual.match_case || actual.regex_scope !== "name") {
        unsafeMutations += 1;
      }
    }
  }
  const rate = cases.length === 0 ? 0 : equivalent / cases.length;
  return {
    total: cases.length,
    equivalent,
    rate,
    unsafe_mutations: unsafeMutations,
    passed: rate >= QUERY_EQUIVALENCE_MIN && unsafeMutations === 0,
  };
}

export function scoreRenameCases(
  cases: readonly RenameCase[],
  outputs: ReadonlyMap<string, { stem: string; new_name?: string }>,
): RenameScore {
  let valid = 0;
  let relevant = 0;
  let extensionChanges = 0;
  for (const testCase of cases) {
    const output = outputs.get(testCase.id);
    if (!output) {
      if (!testCase.valid) valid += 1;
      continue;
    }
    const originalExtension = testCase.input_name.includes(".")
      ? testCase.input_name.slice(testCase.input_name.lastIndexOf("."))
      : "";
    const outputExtension = output.new_name?.includes(".")
      ? output.new_name.slice(output.new_name.lastIndexOf("."))
      : originalExtension;
    if (outputExtension !== originalExtension) extensionChanges += 1;
    const stemValid = output.stem.trim().length > 0 && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(output.stem);
    if (stemValid === testCase.valid) valid += 1;
    if (testCase.relevant && stemValid) relevant += 1;
  }
  const total = cases.length || 1;
  return {
    total: cases.length,
    valid_stems: valid,
    relevant,
    extension_changes: extensionChanges,
    passed:
      valid / total >= RENAME_VALID_MIN &&
      relevant / total >= RENAME_RELEVANCE_MIN &&
      extensionChanges === 0,
  };
}

export function scoreSortCases(
  cases: readonly SortCase[],
  outputs: ReadonlyMap<string, { destination_id: string | null; automatic_moves: number }>,
): SortScore {
  let eligible = 0;
  let correct = 0;
  let automaticMoves = 0;
  for (const testCase of cases) {
    const examples = testCase.history.reduce((sum, row) => sum + row.count, 0);
    const output = outputs.get(testCase.id);
    if (output) automaticMoves += output.automatic_moves;
    if (examples < 3 || testCase.disabled.includes(testCase.extension)) continue;
    eligible += 1;
    if (output && output.destination_id === testCase.expected_destination) correct += 1;
  }
  const precision = eligible === 0 ? 0 : correct / eligible;
  return {
    eligible,
    correct_at_1: correct,
    precision_at_1: precision,
    automatic_moves: automaticMoves,
    passed: precision >= SORT_PRECISION_MIN && automaticMoves === 0,
  };
}

/** Binary or graded gains, DCG@10 normalized against the ideal order. */
export function ndcgAt10(gains: readonly number[]): number {
  const atTen = gains.slice(0, 10);
  const dcg = atTen.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  const ideal = [...atTen].sort((left, right) => right - left);
  const idcg = ideal.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function scoreRelevanceCases(
  cases: readonly RelevanceCase[],
  outputs: ReadonlyMap<string, readonly number[]>,
): RelevanceScore {
  let total = 0;
  let count = 0;
  for (const testCase of cases) {
    const output = outputs.get(testCase.id);
    if (!output) continue;
    total += ndcgAt10(output);
    count += 1;
  }
  return { ndcg: count === 0 ? 0 : total / count, cases: count };
}

export interface FeatureGate {
  action_enabled: boolean;
  label: "stable" | "experimental" | "blocked";
  reason: string;
}

/** Safety wins over quality; a quality miss never ships a weak default. */
export function featureGate(
  safetyFailures: number,
  qualityPassed: boolean,
): FeatureGate {
  if (safetyFailures > 0) return { action_enabled: false, label: "blocked", reason: "safety" };
  if (!qualityPassed) return { action_enabled: false, label: "experimental", reason: "quality" };
  return { action_enabled: true, label: "stable", reason: "passed" };
}

/** 17a E9 suite descriptors, registered by the coordinator. */
export const AI_SEARCH_EVAL_SUITES = [
  { id: "ai-search.query", fixtures: "tests/fixtures/ai/search/queries.jsonl" },
  { id: "ai-search.rename", fixtures: "tests/fixtures/ai/search/rename.jsonl" },
  { id: "ai-search.sorting", fixtures: "tests/fixtures/ai/search/sorting.jsonl" },
  { id: "ai-search.relevance", fixtures: "tests/fixtures/ai/search/relevance.jsonl" },
] as const;
