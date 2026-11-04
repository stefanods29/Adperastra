import { useTranslation } from "react-i18next";
import { useId, type CSSProperties } from "react";
import type { CellAddress, CellRange, OfficeCellWindow, OfficeSelection } from "../types";
import { SHEET_COLUMN_WIDTH, SHEET_ROW_HEIGHT } from "./sheetWindow";
import { sheetAddressName, sheetColumnName, validSheetAddress } from "./useSheetSelection";

function color(value: NonNullable<OfficeCellWindow["rows"][number][number]["format"]["fill"]>): string {
  return `rgba(${value.r},${value.g},${value.b},${value.a / 255})`;
}

function cellStyle(cell: OfficeCellWindow["rows"][number][number], scale: number): CSSProperties {
  const format = cell.format;
  const text = format.text;
  return {
    fontFamily: text?.font?.family ?? "Calibri, Arial, sans-serif",
    fontSize: (text?.size_pt ?? 11) * 4 / 3 * scale,
    fontWeight: text?.bold ? 700 : 400, fontStyle: text?.italic ? "italic" : "normal",
    color: text?.foreground ? color(text.foreground) : undefined,
    backgroundColor: format.fill ? color(format.fill) : undefined,
    textAlign: format.horizontal === "left" || format.horizontal === "center" || format.horizontal === "right" ? format.horizontal : cell.input.kind === "number" ? "right" : "left",
    lineHeight: `${SHEET_ROW_HEIGHT * scale}px`,
  };
}

interface SheetGridProps {
  window: OfficeCellWindow | null;
  rows: number;
  columns: number;
  selection: Extract<OfficeSelection, { kind: "sheet" }> | null;
  zoom: number;
  headings: boolean;
  gridlines: boolean;
  active: boolean;
  onSelect: (address: CellAddress, extend: boolean) => void;
  onEdit: (initialText?: string) => void;
  onScroll: (x: number, y: number, width: number, height: number) => void;
}

function contains(range: CellRange, address: CellAddress): boolean {
  return range.sheet_id === address.sheet_id && address.row >= range.first_row && address.row <= range.last_row && address.column >= range.first_column && address.column <= range.last_column;
}

/** Host supplies one current revision; this surface never reads original bytes. */
export default function SheetGrid(props: SheetGridProps) {
  const { t } = useTranslation();
  const viewId = useId();
  const scale = props.zoom / 100;
  const rowHeight = SHEET_ROW_HEIGHT * scale, columnWidth = SHEET_COLUMN_WIDTH * scale;
  const cells = props.window?.rows.flat() ?? [];
  if (cells.length > 2000) throw new Error("office_edit.too_large");
  const active = props.selection?.active;
  const activeCell = active && cells.find((cell) => contains(cell.merged_range ?? {
    sheet_id: cell.address.sheet_id, first_row: cell.address.row, last_row: cell.address.row,
    first_column: cell.address.column, last_column: cell.address.column,
  }, active));
  const cellId = (address: CellAddress) => `${viewId}-sheet-${address.sheet_id}-${address.row}-${address.column}`;
  return <div className={`adp-sheet-grid${props.gridlines ? " adp-sheet-grid--lines" : ""}`}
    role="grid" tabIndex={props.active ? 0 : -1} aria-label={t("office.sheet")}
    aria-rowcount={props.rows} aria-colcount={props.columns}
    aria-activedescendant={activeCell ? cellId(activeCell.address) : undefined}
    onScroll={(event) => { if (props.active) { const el = event.currentTarget; props.onScroll(el.scrollLeft, el.scrollTop, el.clientWidth, el.clientHeight); } }}
    onKeyDown={(event) => {
      if (!props.active || !active || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "F2") { event.preventDefault(); props.onEdit(); return; }
      if (!event.nativeEvent.isComposing && Array.from(event.key).length === 1 && activeCell?.editable) {
        event.preventDefault();
        props.onEdit(event.key);
        return;
      }
      const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, event.shiftKey ? -1 : 1] };
      const delta = moves[event.key]; if (!delta) return;
      event.preventDefault();
      const next = { ...active, row: active.row + delta[0], column: active.column + delta[1] };
      if (validSheetAddress(next, props.rows, props.columns)) props.onSelect(next, event.shiftKey && event.key !== "Tab");
    }}>
    <div className="adp-sheet-grid-space" style={{ width: props.columns * columnWidth + (props.headings ? 44 : 0), height: props.rows * rowHeight + (props.headings ? 26 : 0) }}>
      {props.window?.rows.map((row) => row.length > 0 && <div role="row" key={row[0].address.row} aria-rowindex={row[0].address.row + 1}>
        {row.map((cell) => <div key={cellId(cell.address)} id={cellId(cell.address)} role="gridcell"
          className="adp-sheet-cell" aria-colindex={cell.address.column + 1}
          aria-selected={!!props.selection?.ranges.some((range) => contains(range, cell.address))}
          aria-readonly={!cell.editable} aria-rowspan={cell.merged_range ? cell.merged_range.last_row - cell.merged_range.first_row + 1 : undefined}
          aria-colspan={cell.merged_range ? cell.merged_range.last_column - cell.merged_range.first_column + 1 : undefined}
          aria-label={`${t("officeSheet.cellAddress", { address: sheetAddressName(cell.address) })}: ${cell.display}`}
          style={{ ...cellStyle(cell, scale), top: cell.address.row * rowHeight + (props.headings ? 26 : 0), left: cell.address.column * columnWidth + (props.headings ? 44 : 0), width: columnWidth, height: rowHeight }}
          onMouseDown={(event) => {
            if (!props.active) return;
            event.currentTarget.closest<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
            props.onSelect(cell.address, event.shiftKey);
          }}
          onDoubleClick={() => { if (props.active && cell.editable) props.onEdit(); }}>{cell.display}</div>)}
      </div>)}
      {props.headings && props.window && <div className="adp-sheet-row-headings" aria-hidden="true">
        {props.window.rows.map((row) => row.length > 0 && <span key={row[0].address.row} style={{ top: 26 + row[0].address.row * rowHeight, height: rowHeight, lineHeight: `${rowHeight}px` }}>{row[0].address.row + 1}</span>)}
      </div>}
      {props.headings && props.window && <div className="adp-sheet-column-headings" aria-hidden="true">
        <span className="adp-sheet-corner" />
        {Array.from({ length: props.window.range.last_column - props.window.range.first_column + 1 }, (_, i) => {
          const column = props.window!.range.first_column + i;
          return <span key={column} style={{ left: 44 + column * columnWidth, width: columnWidth }}>{sheetColumnName(column)}</span>;
        })}
      </div>}
    </div>
  </div>;
}
