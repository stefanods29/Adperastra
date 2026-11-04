import type { OfficeOperation } from "../../types";
import type { SheetCleanDiff } from "./sheetAiTypes";
import { cleaningDuplicateKey } from "./cleaningDuplicates";

/** All returned operations must be evaluated/applied together by E21/E22, never one at a time. */
export function sheetCleaningOperations(diffs: readonly SheetCleanDiff[]): OfficeOperation[] {
  if (diffs.length > 2000) throw new Error("sheet_ai.invalid");
  const changed = diffs.filter(d => cleaningDuplicateKey([d.before]) !== cleaningDuplicateKey([d.after]));
  const seen = new Set<string>();
  const operations: OfficeOperation[] = [];
  for (const diff of changed) {
    if (diff.before.kind === "formula" || diff.after.kind === "formula") throw new Error("sheet_ai.invalid");
    const { sheet_id, row, column } = diff.address;
    const key = `${sheet_id}:${row}:${column}`;
    if (seen.has(key)) throw new Error("sheet_ai.invalid");
    seen.add(key);
    const previous = operations[operations.length - 1];
    // Coalesce horizontal runs, preserving unmodified cells and their formatting.
    if (previous?.family === "sheet" && previous.operation.kind === "set_cells" &&
      previous.operation.range.sheet_id === sheet_id && previous.operation.range.first_row === row &&
      previous.operation.range.last_column + 1 === column) {
      previous.operation.range.last_column = column;
      previous.operation.values[0].push(structuredClone(diff.after));
    } else {
      operations.push({ family: "sheet", operation: { kind: "set_cells", mode: "values",
        range: { sheet_id, first_row: row, last_row: row, first_column: column, last_column: column },
        values: [[structuredClone(diff.after)]] } });
    }
  }
  if (operations.length > 1000) throw new Error("sheet_ai.invalid");
  return operations;
}
