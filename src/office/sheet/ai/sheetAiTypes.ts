import type { CellAddress, CellRange, CellInput, OfficeChart, OfficeAiContext, OfficeProposalPreview } from "../../types";
import type { AssistantOutboundPreview } from "../../../assistant/types";

/** ai-sheet-1. Shared Office/provider DTOs stay owned by their producers. */
export type SheetAiAction = "formula" | "explain" | "clean" | "chart" | "describe";
export interface SheetAiRequest {
  action: SheetAiAction;
  session_id: string;
  expected_revision: number;
  expected_content_id: string;
  selection: CellRange;
  target: CellAddress | null;
  header: boolean;
  include_hidden: boolean;
  request: string;
  locale: "en" | "es";
  request_revision: number;
}
export interface SheetFormulaOutput {
  schema_id: "sheet.formula.v1";
  canonical: string;
  explanation: string;
  referenced_ranges: CellRange[];
}
export interface SheetExplainOutput {
  schema_id: "sheet.explain.v1";
  explanation: string;
  function_ids: string[];
  cited_ranges: CellRange[];
}
export type SheetCleanOperation =
  | { kind: "trim_spaces"; columns: number[] }
  | { kind: "normalize_date"; columns: number[]; source_format: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" }
  | { kind: "parse_number"; columns: number[]; decimal: "dot" | "comma"; thousands: "none" | "dot" | "comma" | "space"; allow_leading_zero: boolean }
  | { kind: "mark_duplicates"; key_columns: number[]; clear_duplicate_values: boolean };
export interface SheetCleanOutput { schema_id: "sheet.clean.v1"; operations: SheetCleanOperation[]; explanation: string }
export interface SheetChartOutput {
  schema_id: "sheet.chart.v1";
  kind: OfficeChart["kind"];
  source: CellRange;
  headers: boolean;
  title: string;
  explanation: string;
}
export interface SheetDescribeOutput { schema_id: "sheet.describe.v1"; text: string; cited_ranges: CellRange[]; statistic_ids: string[] }
export type SheetAiOutput = SheetFormulaOutput | SheetExplainOutput | SheetCleanOutput | SheetChartOutput | SheetDescribeOutput;
export interface SheetCleanDiff {
  address: CellAddress;
  before: CellInput;
  after: CellInput;
  reason: "trim_spaces" | "normalize_date" | "parse_number" | "duplicate";
  warning: "ambiguous_date" | "invalid_number" | "identifier_preserved" | "formula_preserved" | "duplicate_mark_only" | null;
  duplicate_of: CellAddress | null;
}
export interface SheetAiPreparedRequest {
  id: string;
  request: SheetAiRequest;
  context_id: string;
  outbound_preview: AssistantOutboundPreview;
  expires_unix: number;
}
export interface SheetAiSuggestion {
  id: string;
  action: SheetAiAction;
  context: OfficeAiContext;
  output: SheetAiOutput;
  diffs: SheetCleanDiff[];
  preview: OfficeProposalPreview | null;
  localized_formula: string | null;
  status: "awaiting_send" | "generating" | "previewing" | "ready" | "applying" | "applied" | "error" | "cancelled";
  model_id: string;
  model_revision: string;
  request_revision: number;
  expires_unix: number;
}

const invalid = (): never => { throw new Error("sheet_ai.invalid"); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function object(v: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return invalid();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== fields.length || fields.some(k => !Object.hasOwn(o, k))) return invalid();
  return o;
}
function integer(v: unknown, max: number, min = 0): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}
function choice(v: unknown, values: readonly string[]): v is string {
  return typeof v === "string" && values.includes(v);
}
function text(v: unknown, max: number, min = 0): v is string {
  if (typeof v !== "string") return false;
  const points = Array.from(v);
  return points.length >= min && points.length <= max && points.every(c => {
    const point = c.codePointAt(0)!;
    return point < 0xd800 || point > 0xdfff;
  });
}
function list(v: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return invalid();
  return v;
}
export function validateSheetRange(v: unknown): CellRange {
  const o = object(v, ["sheet_id", "first_row", "last_row", "first_column", "last_column"]);
  if (!uuid(o.sheet_id) || !integer(o.first_row, 1048575) || !integer(o.last_row, 1048575) ||
      !integer(o.first_column, 16383) || !integer(o.last_column, 16383) ||
      o.first_row > o.last_row || o.first_column > o.last_column) return invalid();
  return { sheet_id: o.sheet_id, first_row: o.first_row, last_row: o.last_row,
    first_column: o.first_column, last_column: o.last_column };
}
export function validateSheetAddress(v: unknown): CellAddress {
  const o = object(v, ["sheet_id", "row", "column"]);
  if (!uuid(o.sheet_id) || !integer(o.row, 1048575) || !integer(o.column, 16383)) return invalid();
  return { sheet_id: o.sheet_id, row: o.row, column: o.column };
}
export function sheetRangeContains(outer: CellRange, inner: CellRange): boolean {
  return outer.sheet_id === inner.sheet_id && inner.first_row >= outer.first_row &&
    inner.last_row <= outer.last_row && inner.first_column >= outer.first_column && inner.last_column <= outer.last_column;
}
export function validateSheetAiRequest(v: unknown): SheetAiRequest {
  const o = object(v, ["action", "session_id", "expected_revision", "expected_content_id", "selection", "target",
    "header", "include_hidden", "request", "locale", "request_revision"]);
  if (!choice(o.action, ["formula", "explain", "clean", "chart", "describe"]) || !uuid(o.session_id) ||
      !uuid(o.expected_content_id) || !integer(o.expected_revision, Number.MAX_SAFE_INTEGER, 1) ||
      !integer(o.request_revision, 0xffffffff) || !text(o.request, 2000, 1) ||
      (o.locale !== "en" && o.locale !== "es") || typeof o.header !== "boolean" || typeof o.include_hidden !== "boolean") return invalid();
  const selection = validateSheetRange(o.selection);
  const rows = selection.last_row - selection.first_row + 1;
  const columns = selection.last_column - selection.first_column + 1;
  if (rows > 500 || columns > 100 || rows * columns > 2000) return invalid();
  const target = o.target === null ? null : validateSheetAddress(o.target);
  if (o.action === "formula" && target === null) return invalid();
  if (target && !sheetRangeContains(selection, { sheet_id: target.sheet_id, first_row: target.row,
    last_row: target.row, first_column: target.column, last_column: target.column })) return invalid();
  return { ...o, selection, target } as unknown as SheetAiRequest;
}
export function validateSheetCleanOperations(v: unknown, width = 100): SheetCleanOperation[] {
  return list(v, 16, 1).map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const kind = (value as Record<string, unknown>).kind;
    let fields: string[];
    switch (kind) {
      case "trim_spaces": fields = ["kind", "columns"]; break;
      case "normalize_date": fields = ["kind", "columns", "source_format"]; break;
      case "parse_number": fields = ["kind", "columns", "decimal", "thousands", "allow_leading_zero"]; break;
      case "mark_duplicates": fields = ["kind", "key_columns", "clear_duplicate_values"]; break;
      default: return invalid();
    }
    const o = object(value, fields);
    const columns = list(kind === "mark_duplicates" ? o.key_columns : o.columns, 100, 1);
    if (columns.some(c => !integer(c, width - 1)) || new Set(columns).size !== columns.length) return invalid();
    if (kind === "normalize_date" && !choice(o.source_format, ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"])) return invalid();
    if (kind === "parse_number") {
      if (!choice(o.decimal, ["dot", "comma"]) || !choice(o.thousands, ["none", "dot", "comma", "space"]) ||
          typeof o.allow_leading_zero !== "boolean") return invalid();
      if (o.decimal === o.thousands) throw new Error("sheet_ai.ambiguous");
    }
    if (kind === "mark_duplicates" && typeof o.clear_duplicate_values !== "boolean") return invalid();
    return structuredClone(o) as unknown as SheetCleanOperation;
  });
}
export function validateSheetAiOutput(v: unknown): SheetAiOutput {
  let bytes: string;
  try { bytes = JSON.stringify(v); } catch { return invalid(); }
  if (typeof bytes !== "string" || new TextEncoder().encode(bytes).length > 262144) return invalid();
  if (!v || typeof v !== "object" || Array.isArray(v)) return invalid();
  const schema = (v as Record<string, unknown>).schema_id;
  let o: Record<string, unknown>;
  const ranges = (r: unknown) => list(r, 32).forEach(validateSheetRange);
  switch (schema) {
    case "sheet.formula.v1":
      o = object(v, ["schema_id", "canonical", "explanation", "referenced_ranges"]);
      if (!text(o.canonical, 8192, 1) || !o.canonical.startsWith("=") || !text(o.explanation, 4096)) return invalid();
      ranges(o.referenced_ranges); break;
    case "sheet.explain.v1":
      o = object(v, ["schema_id", "explanation", "function_ids", "cited_ranges"]);
      if (!text(o.explanation, 8192) || list(o.function_ids, 64).some(id => typeof id !== "string" || !/^[A-Z][A-Z0-9_.]{0,63}$/.test(id))) return invalid();
      ranges(o.cited_ranges); break;
    case "sheet.clean.v1":
      o = object(v, ["schema_id", "operations", "explanation"]);
      if (!text(o.explanation, 4096)) return invalid();
      validateSheetCleanOperations(o.operations); break;
    case "sheet.chart.v1":
      o = object(v, ["schema_id", "kind", "source", "headers", "title", "explanation"]);
      if (!choice(o.kind, ["column", "bar", "line", "area", "pie", "scatter"]) ||
          typeof o.headers !== "boolean" || !text(o.title, 512) || !text(o.explanation, 4096)) return invalid();
      validateSheetRange(o.source); break;
    case "sheet.describe.v1":
      o = object(v, ["schema_id", "text", "cited_ranges", "statistic_ids"]);
      if (!text(o.text, 8192) || list(o.statistic_ids, 32).some(id => !uuid(id))) return invalid();
      ranges(o.cited_ranges); break;
    default: return invalid();
  }
  return structuredClone(o) as unknown as SheetAiOutput;
}
