import type { CellRange, OfficeCellWindow } from "../types";
import { officeCellWindow } from "../../services/officeSheet";

export const SHEET_ROW_HEIGHT = 22;
export const SHEET_COLUMN_WIDTH = 120;
export const SHEET_MAX_WINDOW_CELLS = 2000;

/** Allocates a visible rectangle only, never one entry per workbook row. */
export function sheetVisibleWindow(sheet_id: string, rows: number, columns: number, x: number, y: number, width: number, height: number, zoom: number): CellRange | null {
  if (!Number.isInteger(rows) || rows < 1 || rows > 1_048_576 || !Number.isInteger(columns) || columns < 1 || columns > 16_384 ||
    ![x, y, width, height, zoom].every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1 || zoom < 25 || zoom > 400) return null;
  const scale = zoom / 100;
  const first_column = Math.max(0, Math.min(columns - 1, Math.floor(x / (SHEET_COLUMN_WIDTH * scale))) - 2);
  const first_row = Math.max(0, Math.min(rows - 1, Math.floor(y / (SHEET_ROW_HEIGHT * scale))) - 8);
  const columnCount = Math.min(columns - first_column, 2000, Math.ceil(width / (SHEET_COLUMN_WIDTH * scale)) + 4);
  const rowCount = Math.min(rows - first_row, 500, Math.floor(2000 / columnCount), Math.ceil(height / (SHEET_ROW_HEIGHT * scale)) + 16);
  return { sheet_id, first_row, last_row: first_row + rowCount - 1, first_column, last_column: first_column + columnCount - 1 };
}

/** Caller invalidates current() on hide/unmount, viewport, session or content change. */
export async function loadSheetWindow(sessionId: string, range: CellRange, revision: number, current: () => boolean, fetchWindow: typeof officeCellWindow = officeCellWindow): Promise<OfficeCellWindow | null> {
  const rows: OfficeCellWindow["rows"] = [];
  let first_row = range.first_row;
  const columns = range.last_column - range.first_column + 1;
  if (columns < 1 || range.last_row < first_row || (range.last_row - first_row + 1) * columns > 2000 || range.last_row - first_row >= 500) throw new Error("office_edit.too_large");
  while (first_row <= range.last_row) {
    if (!current()) return null;
    const page = await fetchWindow(sessionId, { ...range, first_row });
    if (!current() || page.revision !== revision) return null;
    if (page.range.sheet_id !== range.sheet_id || page.range.first_column !== range.first_column ||
      page.range.last_column !== range.last_column || page.range.first_row !== first_row || page.range.last_row > range.last_row ||
      page.range.last_row < first_row || page.rows.length !== page.range.last_row - first_row + 1 ||
      page.rows.some((row, r) => row.length !== columns || row.some((cell, c) => cell.address.sheet_id !== range.sheet_id || cell.address.row !== first_row + r || cell.address.column !== range.first_column + c))) throw new Error("office_edit.invalid");
    rows.push(...page.rows);
    if (page.next_row === null) {
      if (page.range.last_row !== range.last_row) throw new Error("office_edit.invalid");
      return { revision, range: { ...range }, rows, next_row: null };
    }
    if (!Number.isInteger(page.next_row) || page.next_row !== page.range.last_row + 1 || page.next_row > range.last_row) throw new Error("office_edit.invalid");
    first_row = page.next_row;
  }
  throw new Error("office_edit.invalid");
}
