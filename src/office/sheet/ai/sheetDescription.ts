import type { CellRange } from "../../types";
import type { SheetExplainOutput } from "./sheetAiTypes";
import { sheetRangeContains, validateSheetAiOutput } from "./sheetAiTypes";

/** The caller obtains parsed IDs from20a E7 for the same immutable context. No editing API. */
export function validateSheetExplanation(output: SheetExplainOutput, capturedRanges: readonly CellRange[], parsedFunctions: ReadonlySet<string>): void {
  validateSheetAiOutput(output);
  if (output.function_ids.some(id => !parsedFunctions.has(id)) ||
      output.cited_ranges.some(range => !capturedRanges.some(captured => sheetRangeContains(captured, range))))
    throw new Error("sheet_ai.invalid");
}
// Describe is intentionally not implemented: E20 lacks app-owned statistic IDs/values.
