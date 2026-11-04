import { describe, expect, it } from "vitest";
import { sheetCleaningOperations } from "../office/sheet/ai/sheetCleaningProposal";
import type { SheetCleanDiff } from "../office/sheet/ai/sheetAiTypes";
import { validateSheetChartSource } from "../office/sheet/ai/sheetChartProposal";
import { validateSheetExplanation } from "../office/sheet/ai/sheetDescription";

const sheet_id = "00000000-0000-4000-8000-000000000001";
describe("cleaning proposal operations (no engine evidence)", () => {
  it("three_changes_form_one_operation_bundle", () => {
    const diffs: SheetCleanDiff[] = [0, 1, 2].map(column => ({ address: { sheet_id, row: 0, column },
      before: { kind: "text", text: " A " }, after: { kind: "text", text: "A" },
      reason: "trim_spaces", warning: null, duplicate_of: null }));
    expect(sheetCleaningOperations(diffs)).toEqual([{ family: "sheet", operation: {
      kind: "set_cells", mode: "values", range: { sheet_id, first_row: 0, last_row: 0, first_column: 0, last_column: 2 },
      values: [[{ kind: "text", text: "A" }, { kind: "text", text: "A" }, { kind: "text", text: "A" }]],
    } }]);
  });
  it("mark_only_generates_no_operations", () => {
    expect(sheetCleaningOperations([{ address: { sheet_id, row: 1, column: 0 }, before: { kind: "text", text: "A" },
      after: { kind: "text", text: "A" }, reason: "duplicate", warning: "duplicate_mark_only", duplicate_of: { sheet_id, row: 0, column: 0 } }])).toEqual([]);
  });
  it("chart_external_range", () => {
    expect(() => validateSheetChartSource({ schema_id: "sheet.chart.v1", kind: "column", headers: true,
      title: "", explanation: "", source: { sheet_id, first_row: 0, last_row: 2, first_column: 0, last_column: 2 } },
    { sheet_id, first_row: 0, last_row: 2, first_column: 0, last_column: 1 }, [])).toThrow("sheet_ai.invalid");
  });
  it("explain_no_mutation", () => {
    const captured = [{ sheet_id, first_row: 0, last_row: 1, first_column: 0, last_column: 0 }];
    const before = structuredClone(captured);
    expect(validateSheetExplanation({ schema_id: "sheet.explain.v1", explanation: "Adds values",
      function_ids: ["SUM"], cited_ranges: captured }, captured, new Set(["SUM"]))).toBeUndefined();
    expect(captured).toEqual(before);
  });
  it("invented_explanation_functions_are_refused", () => {
    expect(() => validateSheetExplanation({ schema_id: "sheet.explain.v1", explanation: "",
      function_ids: ["WEBSERVICE"], cited_ranges: [] }, [], new Set(["SUM"]))).toThrow("sheet_ai.invalid");
  });
});
