import type { CellInput, OfficeProposalPreview } from "../../../src/office/types";
import type { EvalFixture, EvalResult } from "../../../src/assistant/evalTypes";

/** Written scoring logic only. Calling this never starts a provider or marks a suite run. */
export function sheetResultEqual(actual: CellInput, expected: CellInput): boolean {
  if (actual.kind !== expected.kind) return false;
  switch (expected.kind) {
    case "blank": return true;
    case "number": return actual.kind === "number" && Number.isFinite(actual.value) && actual.value === expected.value;
    case "text": return actual.kind === "text" && actual.text === expected.text;
    case "boolean": return actual.kind === "boolean" && actual.value === expected.value;
    case "date": return actual.kind === "date" && actual.iso_date === expected.iso_date;
    case "formula": return actual.kind === "formula" && actual.canonical === expected.canonical;
  }
}
export function cleaningPrecision(tp: number, fp: number): number {
  if (![tp, fp].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error("sheet_ai.invalid");
  return tp + fp === 0 ? 0 : tp / (tp + fp);
}
export function cleaningRecall(tp: number, fn: number): number {
  if (![tp, fn].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error("sheet_ai.invalid");
  return tp + fn === 0 ? 0 : tp / (tp + fn);
}
export function scoreSheetFormula(preview: OfficeProposalPreview | null, expected: CellInput): boolean {
  if (!preview || preview.intent !== "sheet_formula" || !preview.complete || !preview.can_apply ||
      preview.next_cursor !== null || preview.calculations.length !== 1) return false;
  const calculation = preview.calculations[0];
  return calculation.deterministic && calculation.error_code === null && sheetResultEqual(calculation.result, expected);
}
export function scoreSheetChart(preview: OfficeProposalPreview | null): boolean {
  return !!preview && preview.intent === "sheet_chart" && preview.complete && preview.can_apply &&
    preview.next_cursor === null && preview.renders.length > 0 && preview.renders.every(r => !!r.image);
}
export interface SheetEvaluationRecord {
  fixture: EvalFixture;
  result: EvalResult;
  action: "formula" | "clean" | "chart" | "explain" | "describe";
  actual_formula_result_ok: boolean;
  accepted: boolean;
  actual_clone_calculated: boolean;
  canonical_localized_ast_equal: boolean;
  unsafe_external_evaluations: number;
  cleaning_tp: number;
  cleaning_fp: number;
  cleaning_fn: number;
  identifiers_preserved: boolean;
  formulas_preserved: boolean;
  chart_range_valid: boolean;
  actual_chart_rendered: boolean;
  facts_grounded: boolean;
  human_rating: number | null;
}
export function sheetEvaluationGate(records: readonly SheetEvaluationRecord[]): "not_run" | "blocked" | "experimental" | "eligible" {
  if (records.length === 0) return "not_run";
  const provider = records[0].result;
  if (records.some(r => r.result.backend !== provider.backend || r.result.model_id !== provider.model_id ||
      r.result.model_revision !== provider.model_revision || r.result.template_revision !== provider.template_revision)) return "blocked";
  if (records.some(r => !r.result.safety_ok || !r.result.citations_ok || r.unsafe_external_evaluations !== 0 ||
      (r.accepted && r.action === "formula" && !r.actual_clone_calculated) ||
      !r.canonical_localized_ast_equal || !r.identifiers_preserved || !r.formulas_preserved ||
      (r.action === "chart" && (!r.chart_range_valid || !r.actual_chart_rendered)) ||
      ((r.action === "explain" || r.action === "describe") && !r.facts_grounded))) return "blocked";
  for (const locale of ["en", "es"] as const) {
    const language = records.filter(r => r.fixture.locale === locale);
    const formulas = language.filter(r => r.action === "formula");
    const clean = language.filter(r => r.action === "clean");
    const chart = language.filter(r => r.action === "chart");
    const explain = language.filter(r => r.action === "explain");
    const describe = language.filter(r => r.action === "describe");
    if (formulas.length < 50 || clean.length < 30 || chart.length < 20 || explain.length < 20 || describe.length < 20) return "not_run";
    if (new Set(language.map(r => r.fixture.id)).size !== language.length) return "blocked";
    const tp = clean.reduce((n, r) => n + r.cleaning_tp, 0);
    const fp = clean.reduce((n, r) => n + r.cleaning_fp, 0);
    const fn = clean.reduce((n, r) => n + r.cleaning_fn, 0);
    if (formulas.filter(r => r.actual_formula_result_ok).length / formulas.length < 0.98 ||
        cleaningPrecision(tp, fp) < 0.99 || cleaningRecall(tp, fn) < 0.95 ||
        language.some(r => !r.result.quality_ok || !r.result.args_ok || !r.result.tool_ok) ||
        [...explain, ...describe].some(r => r.human_rating === null || r.human_rating < 4 || r.human_rating > 5)) return "experimental";
  }
  // Provider injection evidence is a separate mandatory gate; this score alone never enables an action.
  return "eligible";
}
