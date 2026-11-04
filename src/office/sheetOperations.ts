import type {
  CellAddress, CellFormatPatch, CellInput, CellRange, OfficeChart,
  OfficeColor, SheetPrintSettings,
} from "./officeValues";

/** office-edit-1. Formulas in generic content-transfer-1 remain inert text. */
export type SheetOperation =
  | { kind: "set_cells"; range: CellRange; values: CellInput[][]; mode: "all" | "values" | "formulas" }
  | { kind: "format_cells"; range: CellRange; patch: CellFormatPatch }
  | { kind: "merge_cells"; range: CellRange; merged: boolean }
  | { kind: "insert_axis" | "delete_axis"; sheet_id: string; axis: "row" | "column"; index: number; count: number }
  | { kind: "resize_axis"; sheet_id: string; axis: "row" | "column"; index: number; count: number; size_pt: number }
  | { kind: "hide_axis"; sheet_id: string; axis: "row" | "column"; index: number; count: number; hidden: boolean }
  | { kind: "add_sheet"; name: string; index: number }
  | { kind: "rename_sheet"; sheet_id: string; name: string }
  | { kind: "move_sheet"; sheet_id: string; index: number }
  | { kind: "delete_sheet"; sheet_id: string }
  | { kind: "color_sheet"; sheet_id: string; color: OfficeColor | null }
  | { kind: "freeze"; sheet_id: string; rows: number; columns: number }
  | { kind: "sort"; range: CellRange; has_header: boolean; keys: {
      column_offset: number; direction: "ascending" | "descending"; comparison: "auto" | "text" | "number";
    }[] }
  | { kind: "filter"; range: CellRange; predicates: {
      column_offset: number; kind: "equals" | "contains" | "greater" | "less" | "nonblank"; value: CellInput;
    }[] }
  | { kind: "set_conditional_rule"; rule: {
      id: string; range: CellRange; priority: number;
      kind: "compare" | "text" | "formula" | "color_scale" | "data_bar" | "icon_set";
      operator: "equal" | "not_equal" | "greater" | "less" | "between";
      values: CellInput[]; text?: string; formula?: string; colors: OfficeColor[];
      style: CellFormatPatch; stop_if_true: boolean;
    } }
  | { kind: "delete_conditional_rule"; sheet_id: string; rule_id: string }
  | { kind: "set_validation"; range: CellRange; rule: {
      kind: "whole" | "decimal" | "list" | "date" | "text_length" | "custom_formula";
      operator: "equal" | "not_equal" | "greater" | "less" | "between";
      values: CellInput[]; list: string[]; formula?: string; allow_blank: boolean;
      title: string; message: string; error_style: "stop" | "warning" | "information";
    } }
  | { kind: "clear_validation"; range: CellRange }
  | { kind: "upsert_chart"; chart: OfficeChart }
  | { kind: "delete_chart"; sheet_id: string; chart_id: string }
  | { kind: "upsert_pivot"; pivot: {
      id: string; source: CellRange; target: CellAddress; rows: number[]; columns: number[];
      values: { column: number; aggregate: "sum" | "count" | "average" | "min" | "max" }[];
      filters: number[];
    } }
  | { kind: "delete_pivot"; sheet_id: string; pivot_id: string }
  | { kind: "set_name"; name: string; range: CellRange }
  | { kind: "delete_name"; name: string }
  | { kind: "set_print_settings"; settings: SheetPrintSettings }
  | { kind: "calculate"; scope: "workbook" | "sheet" | "selection"; sheet_id: string | null }
  | { kind: "set_calculation_mode"; mode: "automatic" | "manual" }
  | { kind: "replace_cell_match"; address: CellAddress; expected: CellInput; replacement: CellInput };
