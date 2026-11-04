import { describe, expect, it } from "vitest";
import { defaultSheetAiSettings } from "../office/sheet/ai/sheetAiSettings";
import { validateSheetAiOutput, validateSheetAiRequest } from "../office/sheet/ai/sheetAiTypes";

const id = "00000000-0000-4000-8000-000000000001";
const selection = { sheet_id: id, first_row: 0, last_row: 1, first_column: 0, last_column: 0 };
const request = { action: "clean", session_id: id, expected_revision: 1, expected_content_id: id,
  selection, target: null, header: true, include_hidden: false, request: "Trim spaces",
  locale: "en", request_revision: 0 };
describe("sheet AI contracts", () => {
  it("sheet_ai_defaults_off", () => expect(defaultSheetAiSettings()).toEqual({ enabled: false, experimental_actions: [] }));
  it("sheet_ai_one_rectangle", () => expect(() => validateSheetAiRequest({ ...request, selection: [selection, selection] })).toThrow("sheet_ai.invalid"));
  it("sheet_ai_oversize", () => expect(() => validateSheetAiRequest({ ...request,
    selection: { ...selection, last_row: 22, last_column: 86 } })).toThrow("sheet_ai.invalid"));
  it("sheet_ai_no_arbitrary_code", () => expect(() => validateSheetAiOutput({ schema_id: "sheet.formula.v1",
    canonical: "=SUM(A1:A2)", explanation: "Total", referenced_ranges: [selection], script: "run()" })).toThrow("sheet_ai.invalid"));
  it("model_result_is_forbidden", () => expect(() => validateSheetAiOutput({ schema_id: "sheet.formula.v1",
    canonical: "=SUM(A1:A2)", explanation: "Total", referenced_ranges: [selection], result: 5 })).toThrow());
  it("unicode_limits_count_scalars", () => expect(validateSheetAiRequest({ ...request, request: "😀".repeat(2000) }).request).toHaveLength(4000));
  it("formula_target_required", () => expect(() => validateSheetAiRequest({ ...request, action: "formula" })).toThrow());
  it("strict_safe_integer_revision", () => expect(() => validateSheetAiRequest({ ...request, expected_revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow());
  it("extra_range_fields_are_refused", () => expect(() => validateSheetAiRequest({ ...request, selection: { ...selection, script: "x" } })).toThrow());
  it("unknown_operation_is_refused", () => expect(() => validateSheetAiOutput({ schema_id: "sheet.clean.v1",
    operations: [{ kind: "delete_rows", columns: [0] }], explanation: "" })).toThrow());
  it("enum_arrays_are_not_coerced_to_strings", () => expect(() => validateSheetAiRequest({ ...request, action: ["clean"] })).toThrow());
});
