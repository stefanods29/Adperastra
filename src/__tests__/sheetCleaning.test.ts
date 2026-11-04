import { describe, expect, it } from "vitest";
import type { CellInput, CellRange, OfficeDisplayCell } from "../office/types";
import { applyTypedCleaning } from "../office/sheet/ai/cleaningTransforms";

const sheet_id = "00000000-0000-4000-8000-000000000001";
function range(rows = 1, columns = 1): CellRange {
  return { sheet_id, first_row: 0, last_row: rows - 1, first_column: 0, last_column: columns - 1 };
}
function cell(input: CellInput, row = 0, column = 0, editable = true): OfficeDisplayCell {
  return { address: { sheet_id, row, column }, input, display: "", format: { locked: false },
    error_code: null, merged_range: null, editable };
}
function text(value: string, row = 0) { return cell({ kind: "text", text: value }, row); }

describe("typed sheet cleaning", () => {
  it("trim_exact", () => {
    const cells = [text("  A  B\t"), text("\u00a0 A  B \u00a0", 1)];
    const diffs = applyTypedCleaning(cells, range(2), [{ kind: "trim_spaces", columns: [0] }]);
    expect(diffs.map(d => d.after)).toEqual([
      { kind: "text", text: "A B" }, { kind: "text", text: "\u00a0 A B \u00a0" },
    ]);
    expect(cells[0].input).toEqual({ kind: "text", text: "  A  B\t" });
  });
  it("date_dmy", () => {
    expect(applyTypedCleaning([text("31/12/2026")], range(), [
      { kind: "normalize_date", columns: [0], source_format: "DD/MM/YYYY" },
    ])[0].after).toEqual({ kind: "date", iso_date: "2026-12-31" });
  });
  it("date_invalid", () => {
    const [diff] = applyTypedCleaning([text("31/02/2026")], range(), [
      { kind: "normalize_date", columns: [0], source_format: "DD/MM/YYYY" },
    ]);
    expect(diff.after).toEqual(diff.before);
    expect(diff.warning).toBe("ambiguous_date");
  });
  it("number_es", () => {
    expect(applyTypedCleaning([text("1.234,50")], range(), [{ kind: "parse_number",
      columns: [0], decimal: "comma", thousands: "dot", allow_leading_zero: false }])[0].after)
      .toEqual({ kind: "number", value: 1234.5 });
  });
  it("identifier_zero", () => {
    const [diff] = applyTypedCleaning([text("000123")], range(), [{ kind: "parse_number",
      columns: [0], decimal: "dot", thousands: "none", allow_leading_zero: false }]);
    expect(diff.after).toEqual({ kind: "text", text: "000123" });
    expect(diff.warning).toBe("identifier_preserved");
  });
  it("duplicate_first", () => {
    const diffs = applyTypedCleaning([text("A"), text("A", 1), text("B", 2)], range(3), [
      { kind: "mark_duplicates", key_columns: [0], clear_duplicate_values: false },
    ]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ address: { row: 1 }, duplicate_of: { row: 0 }, warning: "duplicate_mark_only" });
    expect(diffs[0].before).toEqual(diffs[0].after);
  });
  it("formulas_are_never_cleaned_or_cleared", () => {
    const cells = [cell({ kind: "formula", canonical: "=SUM(A1:A2)" }),
      cell({ kind: "formula", canonical: "=SUM(A1:A2)" }, 1)];
    const diffs = applyTypedCleaning(cells, range(2), [
      { kind: "trim_spaces", columns: [0] },
      { kind: "mark_duplicates", key_columns: [0], clear_duplicate_values: true },
    ]);
    expect(diffs.every(d => d.after.kind === "formula" && d.warning === "formula_preserved")).toBe(true);
  });
  it("rejects_malformed_grouping_and_separator_overlap", () => {
    expect(applyTypedCleaning([text("12.34,50")], range(), [{ kind: "parse_number", columns: [0],
      decimal: "comma", thousands: "dot", allow_leading_zero: false }])[0].warning).toBe("invalid_number");
    expect(() => applyTypedCleaning([], range(), [{ kind: "parse_number", columns: [0],
      decimal: "dot", thousands: "dot", allow_leading_zero: false }])).toThrow("sheet_ai.ambiguous");
  });
  it("blocked_cell_changes_are_refused_atomically", () => {
    expect(() => applyTypedCleaning([cell({ kind: "text", text: " A " }, 0, 0, false)], range(), [
      { kind: "trim_spaces", columns: [0] },
    ])).toThrow("sheet_ai.invalid");
  });
  it("composes_operations_without_mutating_input", () => {
    const source = [text(" 1.234,50 ")];
    const diffs = applyTypedCleaning(source, range(), [{ kind: "trim_spaces", columns: [0] },
      { kind: "parse_number", columns: [0], decimal: "comma", thousands: "dot", allow_leading_zero: false }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].before).toEqual(source[0].input);
    expect(diffs[0].after).toEqual({ kind: "number", value: 1234.5 });
  });
  it("rejects_oversize_missing_and_duplicate_cells", () => {
    expect(() => applyTypedCleaning([], range(501), [])).toThrow("sheet_ai.invalid");
    expect(() => applyTypedCleaning([text("A"), text("B")], range(2), [
      { kind: "mark_duplicates", key_columns: [0], clear_duplicate_values: false },
    ])).toThrow("sheet_ai.invalid");
    expect(() => applyTypedCleaning([text("A")], range(2), [
      { kind: "mark_duplicates", key_columns: [0], clear_duplicate_values: false },
    ])).toThrow("sheet_ai.invalid");
  });
  it("dates_use_gregorian_leap_rules", () => {
    const diffs = applyTypedCleaning([text("29/02/2000"), text("29/02/1900", 1)], range(2), [
      { kind: "normalize_date", columns: [0], source_format: "DD/MM/YYYY" },
    ]);
    expect(diffs[0].after).toEqual({ kind: "date", iso_date: "2000-02-29" });
    expect(diffs[1].warning).toBe("ambiguous_date");
  });
});
