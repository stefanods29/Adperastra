import { describe, expect, it } from "vitest";
import { checkSheetFormulaFunctions, sheetFormulaCalculated } from "../office/sheet/ai/sheetFormulaSafety";
import type { OfficeProposalPreview } from "../office/types";

const id = "00000000-0000-4000-8000-000000000001";
const target = { sheet_id: id, row: 2, column: 0 };
const expected = { session_id: id, context_id: id, revision: 1, content_id: id };
// DTO test double only. This is NOT proof of real engine arithmetic or isolation.
const preview: OfficeProposalPreview = { ...expected, preview_id: id, intent: "sheet_formula", diffs: [], renders: [],
  warnings: [], complete: true, can_apply: true, next_cursor: null, expires_unix: 300,
  calculations: [{ address: target, canonical: "=SUM(A1:A2)", localized: "=SUMA(A1:A2)",
    result: { kind: "number", value: 5 }, display: "5", error_code: null, deterministic: true }] };
describe("formula eligibility only", () => {
  it("requires_actual_calculation_record", () => {
    expect(sheetFormulaCalculated({ ...preview, calculations: [] }, target, "=SUM(A1:A2)", expected, 10)).toBe(false);
    expect(sheetFormulaCalculated(preview, target, "=SUM(A1:A2)", expected, 10)).toBe(true);
  });
  it("formula_error_disables_acceptance", () => {
    expect(sheetFormulaCalculated({ ...preview, calculations: [{ ...preview.calculations[0], error_code: "formula_error" }] },
      target, "=SUM(A1:A2)", expected, 10)).toBe(false);
  });
  it("stale_incomplete_expired_previews_disabled", () => {
    expect(sheetFormulaCalculated(preview, target, "=SUM(A1:A2)", { ...expected, revision: 2 }, 10)).toBe(false);
    expect(sheetFormulaCalculated({ ...preview, complete: false }, target, "=SUM(A1:A2)", expected, 10)).toBe(false);
    expect(sheetFormulaCalculated(preview, target, "=SUM(A1:A2)", expected, 300)).toBe(false);
  });
  it("blocked_and_unknown_functions_refused", () => {
    expect(() => checkSheetFormulaFunctions(["WEBSERVICE"], new Set(["WEBSERVICE"]))).toThrow("sheet_ai.unsafe_formula");
    expect(() => checkSheetFormulaFunctions(["NOW"], new Set(["NOW"]))).toThrow();
    expect(() => checkSheetFormulaFunctions(["UNPROVED"], new Set(["SUM"]))).toThrow();
  });
});
