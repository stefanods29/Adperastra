import { useCallback, useRef } from "react";
import type { CellAddress, OfficeSelection } from "../types";

export type SheetSelection = Extract<OfficeSelection, { kind: "sheet" }>;

export function validSheetAddress(address: CellAddress, rows: number, columns: number): boolean {
  return Number.isInteger(rows) && rows > 0 && rows <= 1_048_576 &&
    Number.isInteger(columns) && columns > 0 && columns <= 16_384 &&
    Number.isInteger(address.row) && address.row >= 0 && address.row < rows &&
    Number.isInteger(address.column) && address.column >= 0 && address.column < columns;
}

export function sheetColumnName(column: number): string {
  if (!Number.isInteger(column) || column < 0 || column >= 16_384) throw new Error("office_edit.invalid");
  let value = column + 1, name = "";
  while (value > 0) { value -= 1; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return name;
}

export function sheetAddressName(address: CellAddress): string {
  return `${sheetColumnName(address.column)}${address.row + 1}`;
}

/** Named-range lookup is intentionally separate from filesystem navigation. */
export function parseSheetAddress(text: string, sheet_id: string, rows: number, columns: number):
  { kind: "address"; address: CellAddress } | { kind: "name"; name: string } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(text);
  if (match) {
    let column = 0;
    for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    const address = { sheet_id, row: Number(match[2]) - 1, column: column - 1 };
    return validSheetAddress(address, rows, columns) ? { kind: "address", address } : null;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/.test(text) || /^R\d+C\d+$/i.test(text)) return null;
  return { kind: "name", name: text };
}

export function useSheetSelection(sheet_id: string, rows: number, columns: number, selection: SheetSelection | null, onSelection: (value: SheetSelection) => void) {
  const anchorRef = useRef<CellAddress | null>(null);
  const lastFocus = useRef<CellAddress | null>(null);
  return useCallback((address: CellAddress, extend = false) => {
    if (address.sheet_id !== sheet_id || !validSheetAddress(address, rows, columns)) return false;
    const prior = selection?.active;
    const last = lastFocus.current;
    if (!extend || !prior || prior.sheet_id !== sheet_id) anchorRef.current = address;
    else if (!anchorRef.current || !last || last.sheet_id !== prior.sheet_id || last.row !== prior.row || last.column !== prior.column) anchorRef.current = prior;
    const anchor = anchorRef.current ?? address;
    lastFocus.current = address;
    onSelection({ kind: "sheet", active: { ...address }, ranges: [{ sheet_id,
      first_row: Math.min(anchor.row, address.row), last_row: Math.max(anchor.row, address.row),
      first_column: Math.min(anchor.column, address.column), last_column: Math.max(anchor.column, address.column),
    }] });
    return true;
  }, [sheet_id, rows, columns, selection, onSelection]);
}
