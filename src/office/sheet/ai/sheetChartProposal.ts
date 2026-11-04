import type { CellRange, OfficeDisplayCell } from "../../types";
import type { SheetChartOutput } from "./sheetAiTypes";
import { sheetRangeContains, validateSheetAiOutput, validateSheetRange } from "./sheetAiTypes";

/** Source preflight only. Success does not mean that an engine can render/apply this chart. */
export function validateSheetChartSource(output: SheetChartOutput, selection: CellRange, cells: readonly OfficeDisplayCell[]): void {
  validateSheetAiOutput(output);
  validateSheetRange(selection);
  if (!sheetRangeContains(selection, output.source) || cells.length > 2000) throw new Error("sheet_ai.invalid");
  const r = output.source;
  const rows = r.last_row - r.first_row + 1;
  const columns = r.last_column - r.first_column + 1;
  if (rows * columns > 2000 || columns < 2 || columns > 33 || rows <= (output.headers ? 1 : 0))
    throw new Error("sheet_ai.invalid");
  if (output.kind === "pie" && columns !== 2) throw new Error("sheet_ai.invalid");
  const map = new Map(cells.filter(c => c.address.sheet_id === r.sheet_id).map(c => [`${c.address.row}:${c.address.column}`, c]));
  for (let column = r.first_column; column <= r.last_column; column++) {
    let numeric = false;
    for (let row = r.first_row; row <= r.last_row; row++) {
      const cell = map.get(`${row}:${column}`);
      if (!cell || cell.error_code) throw new Error("sheet_ai.invalid");
      if (output.headers && row === r.first_row) continue;
      if (column === r.first_column && output.kind !== "scatter") continue;
      // Formulas remain a pending engine check; cached display text is never parsed as a number.
      // E21 must prove the numeric result and render on the actual clone before Apply.
      if (cell.input.kind === "formula") { numeric = true; continue; }
      if (cell.input.kind === "number" && Number.isFinite(cell.input.value)) numeric = true;
      else if (cell.input.kind !== "blank") throw new Error("sheet_ai.invalid");
    }
    if ((column > r.first_column || output.kind === "scatter") && !numeric) throw new Error("sheet_ai.invalid");
  }
}
