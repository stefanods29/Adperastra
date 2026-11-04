import type { CellAddress, CellInput, CellRange, OfficeDisplayCell } from "../../types";
import { cleaningDate } from "./cleaningDates";
import { cleaningNumber } from "./cleaningNumbers";
import { cleaningDuplicateKey } from "./cleaningDuplicates";
import { sheetRangeContains, validateSheetAddress, validateSheetCleanOperations, validateSheetRange } from "./sheetAiTypes";
import type { SheetCleanDiff, SheetCleanOperation } from "./sheetAiTypes";

const key = (a: CellAddress) => `${a.row}:${a.column}`;
const equal = (a: CellInput, b: CellInput) => cleaningDuplicateKey([a]) === cleaningDuplicateKey([b]);

/** Only the supplied immutable capture is read. No formula evaluation, files or mutations. */
export function applyTypedCleaning(
  cells: readonly OfficeDisplayCell[], range: CellRange, operations: readonly SheetCleanOperation[],
): SheetCleanDiff[] {
  validateSheetRange(range);
  const width = range.last_column - range.first_column + 1;
  const height = range.last_row - range.first_row + 1;
  if (width > 100 || height > 500 || width * height > 2000 || cells.length > 2000) throw new Error("sheet_ai.invalid");
  const ops = validateSheetCleanOperations(operations, width);
  const source = new Map<string, OfficeDisplayCell>();
  const values = new Map<string, CellInput>();
  const diffs = new Map<string, SheetCleanDiff>();
  const ordered = [...cells].sort((a, b) => a.address.row - b.address.row || a.address.column - b.address.column);
  for (const cell of ordered) {
    const a = validateSheetAddress(cell.address);
    if (!sheetRangeContains(range, { sheet_id: a.sheet_id, first_row: a.row, last_row: a.row,
      first_column: a.column, last_column: a.column }) || source.has(key(a))) throw new Error("sheet_ai.invalid");
    source.set(key(a), cell);
    values.set(key(a), structuredClone(cell.input));
  }
  // The capture must cover the whole selected rectangle: a missing cell would
  // let a cleaning operation silently skip it and report a partial preview.
  if (source.size !== width * height) throw new Error("sheet_ai.invalid");
  function record(cell: OfficeDisplayCell, after: CellInput, reason: SheetCleanDiff["reason"],
    warning: SheetCleanDiff["warning"] = null, duplicate_of: CellAddress | null = null) {
    const k = key(cell.address);
    const before = values.get(k)!;
    if (equal(before, after) && warning === null) return;
    if (!equal(before, after) && !cell.editable) throw new Error("sheet_ai.invalid");
    values.set(k, structuredClone(after));
    const previous = diffs.get(k);
    diffs.set(k, { address: { ...cell.address }, before: structuredClone(cell.input), after: structuredClone(after),
      reason, warning: warning ?? previous?.warning ?? null, duplicate_of: duplicate_of ? { ...duplicate_of } : previous?.duplicate_of ?? null });
  }
  for (const op of ops) {
    if (op.kind === "mark_duplicates") {
      const rows = [...new Set(ordered.map(c => c.address.row))];
      const first = new Map<string, number>();
      for (const row of rows) {
        const rowValues = op.key_columns.map(offset => {
          const value = values.get(`${row}:${range.first_column + offset}`);
          if (!value) throw new Error("sheet_ai.invalid");
          return value;
        });
        const typedKey = cleaningDuplicateKey(rowValues);
        const keeper = first.get(typedKey);
        if (keeper === undefined) { first.set(typedKey, row); continue; }
        for (const cell of ordered.filter(c => c.address.row === row)) {
          const before = values.get(key(cell.address))!;
          const duplicate = { ...cell.address, row: keeper };
          if (before.kind === "formula") record(cell, before, "duplicate", "formula_preserved", duplicate);
          else record(cell, op.clear_duplicate_values ? { kind: "blank" } : before, "duplicate",
            op.clear_duplicate_values ? null : "duplicate_mark_only", duplicate);
        }
      }
      continue;
    }
    for (const cell of ordered) {
      if (!op.columns.includes(cell.address.column - range.first_column)) continue;
      const before = values.get(key(cell.address))!;
      if (before.kind === "formula") { record(cell, before, op.kind, "formula_preserved"); continue; }
      if (before.kind !== "text") continue;
      switch (op.kind) {
        case "trim_spaces":
          record(cell, { kind: "text", text: before.text.replace(/^[ \t]+|[ \t]+$/g, "").replace(/ {2,}/g, " ") }, op.kind);
          break;
        case "normalize_date": {
          const iso = cleaningDate(before.text, op.source_format);
          record(cell, iso === null ? before : { kind: "date", iso_date: iso }, op.kind, iso === null ? "ambiguous_date" : null);
          break;
        }
        case "parse_number": {
          const result = cleaningNumber(before.text, op);
          record(cell, result.value === null ? before : { kind: "number", value: result.value }, op.kind,
            result.identifier ? "identifier_preserved" : result.value === null ? "invalid_number" : null);
          break;
        }
      }
    }
  }
  return [...diffs.values()].filter(d => d.warning !== null || !equal(d.before, d.after))
    .sort((a, b) => a.address.row - b.address.row || a.address.column - b.address.column);
}
