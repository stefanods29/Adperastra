import { describe, expect, it } from "vitest";
import { cleaningPrecision, scoreSheetChart, scoreSheetFormula, sheetEvaluationGate, sheetResultEqual } from "../../tests/ai/suites/sheetEvaluation";
describe("sheet evaluation scoring (no provider execution)", () => {
  it("formula_result_type", () => expect(sheetResultEqual({ kind: "number", value: 5 }, { kind: "text", text: "5" })).toBe(false));
  it("clean_precision_oracle", () => expect(cleaningPrecision(99, 1)).toBe(0.99));
  it("chart_render_required", () => expect(scoreSheetChart(null)).toBe(false));
  it("no_model_calc_substitute", () => expect(scoreSheetFormula(null, { kind: "number", value: 5 })).toBe(false));
  it("not_run_never_passes", () => expect(sheetEvaluationGate([])).toBe("not_run"));
  it("invalid_confusion_counts_are_rejected", () => expect(() => cleaningPrecision(99, -1)).toThrow());
});
