/**
 * Validation for `ai_eval_page` (Step 17a T8, `ai-eval-1`). Mirrors
 * `src-tauri/src/ai_eval_commands.rs` and `ai_eval_fixtures.rs`; unknown
 * fields are refused. A page carries deterministic fixture shape only:
 * `notrun` must be exactly `true`, so model absence stays explicit and a
 * response that implies a real model run is refused instead of shown.
 */

/** The suite names the native command accepts. */
export const AI_EVAL_SUITES = [
  "assistant-en",
  "assistant-es",
  "assistant-injection",
  "assistant-all",
] as const;

export type AiEvalSuiteId = (typeof AI_EVAL_SUITES)[number];

/** Largest combined suite (`MAX_CASES`). */
export const AI_EVAL_MAX_CASES = 512;
/** Largest page the caller may request (`MAX_PAGE`). */
export const AI_EVAL_MAX_PAGE = 200;
/** Page used when the caller asks for zero (`DEFAULT_PAGE`). */
export const AI_EVAL_DEFAULT_PAGE = 50;

const MAX_ID = 64;
const MAX_TEXT = 8 * 1024;
const MAX_EFFECTS = 16;
const EFFECTS = new Set([
  "disk_write",
  "disk_read",
  "network",
  "shell",
  "permanent_delete",
]);

export const ERR_UNKNOWN_SUITE = "ai_eval.unknown_suite";
export const ERR_PAGE_INVALID = "ai_eval.page_invalid";

/** One validated fixture. It carries no model output and no quality claim. */
export interface AiEvalCase {
  id: string;
  feature: string;
  locale: "en" | "es";
  tool_id: string | null;
  must_refuse: boolean;
  must_warn: boolean;
  forbidden_effects: string[];
  valid: boolean;
}

/**
 * One bounded page of validated cases. `notrun` is the literal `true`: the
 * rows prove fixture/oracle shape, never model quality.
 */
export interface AiEvalPage {
  suite_id: AiEvalSuiteId;
  offset: number;
  limit: number;
  total: number;
  next_offset: number | null;
  notrun: true;
  cases: AiEvalCase[];
}

const PAGE_KEYS = [
  "suite_id",
  "offset",
  "limit",
  "total",
  "next_offset",
  "notrun",
  "cases",
] as const;
const CASE_KEYS = [
  "id",
  "feature",
  "locale",
  "tool_id",
  "must_refuse",
  "must_warn",
  "forbidden_effects",
  "valid",
] as const;

function fail(code = ERR_PAGE_INVALID): never {
  throw new Error(code);
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const raw = value as Record<string, unknown>;
  const actual = Object.keys(raw);
  if (actual.length !== allowed.length) fail();
  for (const key of actual) {
    if (!allowed.includes(key)) fail();
  }
  for (const key of allowed) {
    if (!(key in raw)) fail();
  }
  return raw;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > max) fail();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail();
  }
  return value;
}

function suite(value: unknown, code = ERR_PAGE_INVALID): AiEvalSuiteId {
  if (typeof value !== "string" || !(AI_EVAL_SUITES as readonly string[]).includes(value)) {
    fail(code);
  }
  return value as AiEvalSuiteId;
}

function effects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EFFECTS) fail();
  const seen = new Set<string>();
  for (const effect of value) {
    if (typeof effect !== "string" || !EFFECTS.has(effect) || seen.has(effect)) fail();
    seen.add(effect);
  }
  return [...seen];
}

function caseRow(value: unknown): AiEvalCase {
  const raw = record(value, CASE_KEYS);
  const locale = raw.locale;
  if (locale !== "en" && locale !== "es") fail();
  const mustRefuse = raw.must_refuse;
  const mustWarn = raw.must_warn;
  const valid = raw.valid;
  if (
    typeof mustRefuse !== "boolean" ||
    typeof mustWarn !== "boolean" ||
    typeof valid !== "boolean"
  ) {
    fail();
  }
  return {
    id: text(raw.id, MAX_ID),
    feature: text(raw.feature, MAX_TEXT),
    locale,
    tool_id: raw.tool_id === null ? null : text(raw.tool_id, MAX_ID),
    must_refuse: mustRefuse,
    must_warn: mustWarn,
    forbidden_effects: effects(raw.forbidden_effects),
    valid,
  };
}

/** Validate one native page; the bounds, case count and cursor must agree. */
export function validateEvalPage(value: unknown): AiEvalPage {
  const raw = record(value, PAGE_KEYS);
  const suiteId = suite(raw.suite_id);
  const offset = integer(raw.offset, 0, AI_EVAL_MAX_CASES);
  const limit = integer(raw.limit, 1, AI_EVAL_MAX_PAGE);
  const total = integer(raw.total, 0, AI_EVAL_MAX_CASES);
  if (offset > total) fail();
  // This command never runs a model; a page that claims otherwise is refused.
  if (raw.notrun !== true) fail();
  if (!Array.isArray(raw.cases)) fail();
  const cases = raw.cases.map(caseRow);
  if (new Set(cases.map((row) => row.id)).size !== cases.length) fail();
  if (cases.length !== Math.min(limit, total - offset)) fail();
  const next = offset + cases.length < total ? offset + cases.length : null;
  if (raw.next_offset !== next) fail();
  return {
    suite_id: suiteId,
    offset,
    limit,
    total,
    next_offset: next,
    notrun: true,
    cases,
  };
}

/** Check a suite name before it reaches the backend. */
export function assertEvalSuite(value: string): AiEvalSuiteId {
  return suite(value, ERR_UNKNOWN_SUITE);
}

/** Check and normalize page arguments; zero asks for the native default. */
export function normalizeEvalPageRequest(
  suiteId: string,
  offset: number,
  limit: number,
): { suiteId: AiEvalSuiteId; offset: number; limit: number } {
  const id = suite(suiteId, ERR_UNKNOWN_SUITE);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > AI_EVAL_MAX_CASES) fail();
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > AI_EVAL_MAX_PAGE) fail();
  return { suiteId: id, offset, limit: limit === 0 ? AI_EVAL_DEFAULT_PAGE : limit };
}
