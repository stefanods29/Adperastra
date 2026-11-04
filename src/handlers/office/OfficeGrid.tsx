import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  OFFICE_MAX_CELL_COLUMNS,
  type OfficeCell,
  type OfficeCellPage,
} from "../../services/officeViewTypes";

export const OFFICE_GRID_ROW_HEIGHT = 28;
export const OFFICE_GRID_COLUMN_WIDTH = 96;
export const OFFICE_GRID_MAX_VISIBLE_CELLS = 200;
export const OFFICE_GRID_FETCH_ROWS = 200;
/** A column window is fetched as a 40-column chunk starting at the first
 * missing cell, so one invoke covers many horizontal scroll steps without
 * re-reading the columns a truncated answer already returned. */
export const OFFICE_GRID_FETCH_COLUMNS = 40;
export const OFFICE_GRID_OVERSCAN = 2;
export const OFFICE_GRID_HEADER_HEIGHT = 26;
export const OFFICE_GRID_ROW_HEADER_WIDTH = 44;

export interface OfficeGridWindow {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  visibleCells: number;
  overscanRows: number;
  overscanColumns: number;
}

/** The bounded rectangle the grid paints. A 100,000-row sheet still renders
 * only the visible cells plus two rows/columns of overscan; the actual visible
 * rectangle is capped at 200 cells before overscan is added. */
export function visibleOfficeWindow(
  totalRows: number,
  totalColumns: number,
  scrollTop: number,
  viewportHeight: number,
  scrollLeft: number,
  viewportWidth: number,
  rowHeight = OFFICE_GRID_ROW_HEIGHT,
  columnWidth = OFFICE_GRID_COLUMN_WIDTH,
  overscan = OFFICE_GRID_OVERSCAN,
): OfficeGridWindow {
  const rows = Math.max(1, Math.floor(Math.max(0, viewportHeight) / rowHeight));
  const columns = Math.max(1, Math.floor(Math.max(0, viewportWidth) / columnWidth));
  const rowStart = Math.min(Math.max(0, totalRows - 1), Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight)));
  const columnStart = Math.min(Math.max(0, totalColumns - 1), Math.max(0, Math.floor(Math.max(0, scrollLeft) / columnWidth)));
  let visibleRows = Math.min(rows, Math.max(0, totalRows - rowStart));
  let visibleColumns = Math.min(columns, Math.max(0, totalColumns - columnStart));
  if (visibleRows > 0 && visibleColumns > 0 && visibleRows * visibleColumns > OFFICE_GRID_MAX_VISIBLE_CELLS) {
    visibleColumns = Math.max(1, Math.floor(OFFICE_GRID_MAX_VISIBLE_CELLS / visibleRows));
    if (visibleRows * visibleColumns > OFFICE_GRID_MAX_VISIBLE_CELLS) {
      visibleRows = Math.max(1, Math.floor(OFFICE_GRID_MAX_VISIBLE_CELLS / visibleColumns));
    }
  }
  return {
    rowStart,
    rowEnd: Math.min(totalRows, rowStart + visibleRows),
    columnStart,
    columnEnd: Math.min(totalColumns, columnStart + visibleColumns),
    visibleCells: Math.max(0, visibleRows * visibleColumns),
    overscanRows: Math.max(0, Math.min(overscan, 2)),
    overscanColumns: Math.max(0, Math.min(overscan, 2)),
  };
}

/** Storage-style column name (A, B, ... Z, AA, ... XFD). */
export function officeGridColumnName(index: number): string {
  let name = "";
  let value = Math.max(0, Math.floor(index)) + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

interface GridViewport {
  width: number;
  height: number;
  scrollTop: number;
  scrollLeft: number;
}

interface RequestScope {
  windowKey: string;
  attempts: number;
  requestKey: string;
}

export interface OfficeGridProps {
  pages?: readonly OfficeCellPage[];
  /** Kept for callers that hold one page; the view passes the bounded cache. */
  page?: OfficeCellPage | null;
  loading: boolean;
  errorText: string | null;
  onRequestRows: (
    rowStart: number,
    rowCount: number,
    columnStart: number,
    columnCount: number,
  ) => void;
  onOpenChosenApp?: () => void;
}

/** The structural sheet grid (D5): row 28 px, column 96 px, virtualized on
 * both axes and read-only. A spacer canvas carries the full logical extent so
 * scrolling reaches every row; only the visible rectangle is mounted.
 * Formulas are shown as saved values with the honest "not recalculated" note;
 * this grid never evaluates anything. */
export default function OfficeGrid({
  pages,
  page,
  loading,
  errorText,
  onRequestRows,
  onOpenChosenApp,
}: OfficeGridProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef(0);
  const requestScopeRef = useRef<RequestScope>({ windowKey: "", attempts: 0, requestKey: "" });
  const [viewport, setViewport] = useState<GridViewport>({ width: 0, height: 0, scrollTop: 0, scrollLeft: 0 });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      setViewport((current) => {
        const width = element.clientWidth;
        const height = element.clientHeight;
        return current.width === width && current.height === height
          ? current
          : { ...current, width, height };
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // A new sheet or a cleared cache shrinks the canvas; the browser clamps the
  // old offset, so reset both the element and the paging window to the top.
  const pageCount = pages?.length ?? (page ? 1 : 0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || pageCount > 0) return;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    element.scrollTop = 0;
    element.scrollLeft = 0;
    setViewport((current) =>
      current.scrollTop === 0 && current.scrollLeft === 0
        ? current
        : { ...current, scrollTop: 0, scrollLeft: 0 },
    );
  }, [pageCount]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const scrollTop = element.scrollTop;
    const scrollLeft = element.scrollLeft;
    const apply = () => {
      frameRef.current = 0;
      setViewport((current) =>
        current.scrollTop === scrollTop && current.scrollLeft === scrollLeft
          ? current
          : { ...current, scrollTop, scrollLeft },
      );
    };
    if (typeof requestAnimationFrame === "undefined") {
      apply();
      return;
    }
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(apply);
  }, []);

  const { rowMap, totalRows, totalColumns } = useMemo(() => {
    // Rows hold sparse arrays indexed by the cell's absolute column, so
    // windows fetched from different `column_start` values merge instead of
    // overwriting each other.
    const map = new Map<number, OfficeCell[]>();
    const pageList = pages ?? (page ? [page] : []);
    let rows = 0;
    let columns = 0;
    for (const entry of pageList) {
      rows = Math.max(rows, entry.total_rows);
      columns = Math.max(columns, entry.columns);
      for (let index = 0; index < entry.rows.length; index += 1) {
        const absoluteRow = entry.row_start + index;
        let target = map.get(absoluteRow);
        if (!target) {
          target = [];
          map.set(absoluteRow, target);
        }
        for (const cell of entry.rows[index]) target[cell.column] = cell;
      }
    }
    return { rowMap: map, totalRows: rows, totalColumns: columns };
  }, [page, pages]);

  // Before layout (or in a test DOM without client sizes) fall back to the
  // original 14 x 12 visible rectangle instead of mounting a single cell.
  const bodyHeight = viewport.height > OFFICE_GRID_HEADER_HEIGHT
    ? viewport.height - OFFICE_GRID_HEADER_HEIGHT
    : 14 * OFFICE_GRID_ROW_HEIGHT;
  const bodyWidth = viewport.width > OFFICE_GRID_ROW_HEADER_WIDTH
    ? viewport.width - OFFICE_GRID_ROW_HEADER_WIDTH
    : 12 * OFFICE_GRID_COLUMN_WIDTH;
  const visible = useMemo(
    () =>
      visibleOfficeWindow(
        totalRows,
        totalColumns,
        viewport.scrollTop,
        bodyHeight,
        viewport.scrollLeft,
        bodyWidth,
      ),
    [bodyHeight, bodyWidth, totalColumns, totalRows, viewport.scrollLeft, viewport.scrollTop],
  );

  const rowStart = Math.max(0, visible.rowStart - visible.overscanRows);
  const rowEnd = Math.min(totalRows, visible.rowEnd + visible.overscanRows);
  const columnStart = Math.max(0, visible.columnStart - visible.overscanColumns);
  const columnEnd = Math.min(totalColumns, visible.columnEnd + visible.overscanColumns);
  const windowKey = `${rowStart}:${rowEnd}:${columnStart}:${columnEnd}`;

  const drawnRows = useMemo(() => {
    const rows: { index: number; cells: readonly OfficeCell[] | null; formula: boolean }[] = [];
    for (let index = rowStart; index < rowEnd; index += 1) {
      const cells = rowMap.get(index) ?? null;
      let formula = false;
      if (cells) {
        for (let column = columnStart; column < columnEnd; column += 1) {
          if (cells[column]?.value_kind === "formula") {
            formula = true;
            break;
          }
        }
      }
      rows.push({ index, cells, formula });
    }
    return rows;
  }, [columnEnd, columnStart, rowEnd, rowMap, rowStart]);
  const hasFormula = drawnRows.some((row) => row.formula);

  const drawnColumns = useMemo(() => {
    const columns: number[] = [];
    for (let column = columnStart; column < columnEnd; column += 1) columns.push(column);
    return columns;
  }, [columnEnd, columnStart]);

  useEffect(() => {
    if (
      loading ||
      totalRows <= 0 ||
      totalColumns <= 0 ||
      rowEnd <= rowStart ||
      columnEnd <= columnStart
    ) {
      return;
    }
    // Find the first cell of the painted window that no cached page covers.
    // A page now covers only its `column_start`..`column_start+column_count`
    // window, so checking the row alone would leave right-side columns blank.
    let missingRow = -1;
    let missingColumn = -1;
    for (let row = rowStart; row < rowEnd && missingRow < 0; row += 1) {
      const cells = rowMap.get(row);
      for (let column = columnStart; column < columnEnd; column += 1) {
        if (!cells || !cells[column]) {
          missingRow = row;
          missingColumn = column;
          break;
        }
      }
    }
    if (missingRow < 0) return;
    if (requestScopeRef.current.windowKey !== windowKey) {
      requestScopeRef.current = { windowKey, attempts: 0, requestKey: "" };
    }
    // A truncated native page (wide or text-heavy sheet) cannot fill the whole
    // window in one answer. Two attempts per window avoid an invoke loop while
    // still letting a normal page complete after a scroll.
    if (requestScopeRef.current.attempts >= 2) return;
    const requestColumnStart = missingColumn;
    const requestColumnCount = Math.max(
      1,
      Math.min(
        OFFICE_MAX_CELL_COLUMNS,
        totalColumns - requestColumnStart,
        Math.max(OFFICE_GRID_FETCH_COLUMNS, columnEnd - requestColumnStart),
      ),
    );
    const requestCount = Math.min(OFFICE_GRID_FETCH_ROWS, Math.max(1, totalRows - missingRow));
    const requestKey = `${missingRow}:${requestCount}:${requestColumnStart}:${requestColumnCount}`;
    if (requestScopeRef.current.requestKey === requestKey) return;
    requestScopeRef.current = {
      windowKey,
      attempts: requestScopeRef.current.attempts + 1,
      requestKey,
    };
    onRequestRows(missingRow, requestCount, requestColumnStart, requestColumnCount);
  }, [
    columnEnd,
    columnStart,
    loading,
    onRequestRows,
    rowEnd,
    rowMap,
    rowStart,
    totalColumns,
    totalRows,
    windowKey,
  ]);

  const canvasWidth = OFFICE_GRID_ROW_HEADER_WIDTH + totalColumns * OFFICE_GRID_COLUMN_WIDTH;
  const canvasHeight = OFFICE_GRID_HEADER_HEIGHT + totalRows * OFFICE_GRID_ROW_HEIGHT;

  return (
    <div className="adp-office-grid-wrap">
      {loading ? <p role="status">{t("preview.loading")}</p> : null}
      {errorText ? (
        <div className="adp-office-error" role="alert">
          <p>{errorText}</p>
          {onOpenChosenApp ? (
            <button type="button" className="adp-btn" onClick={onOpenChosenApp}>
              {t("office.openChosen")}
            </button>
          ) : null}
        </div>
      ) : null}
      {hasFormula ? <p className="adp-office-formula-note">{t("office.notRecalculated")}</p> : null}
      <div
        ref={scrollRef}
        className="adp-office-grid"
        role="grid"
        aria-label={t("office.sheet")}
        aria-rowcount={totalRows > 0 ? totalRows + 1 : undefined}
        aria-colcount={totalColumns > 0 ? totalColumns + 1 : undefined}
        aria-readonly="true"
        aria-busy={loading}
        tabIndex={0}
        onScroll={onScroll}
      >
        <div className="adp-office-grid-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
          <div className="adp-office-grid-header" role="row" aria-rowindex={1} style={{ width: "100%" }}>
            <div className="adp-office-grid-corner" aria-hidden="true" />
            {drawnColumns.map((column) => (
              <div
                key={`column-${column}`}
                role="columnheader"
                aria-colindex={column + 2}
                className="adp-office-grid-column"
                style={{
                  left: OFFICE_GRID_ROW_HEADER_WIDTH + column * OFFICE_GRID_COLUMN_WIDTH,
                  width: OFFICE_GRID_COLUMN_WIDTH,
                }}
              >
                {officeGridColumnName(column)}
              </div>
            ))}
          </div>
          {drawnRows.map((row) => (
            <div
              key={`row-${row.index}`}
              className="adp-office-grid-row"
              role="row"
              aria-rowindex={row.index + 2}
              style={{
                top: OFFICE_GRID_HEADER_HEIGHT + row.index * OFFICE_GRID_ROW_HEIGHT,
                width: canvasWidth,
              }}
            >
              <div className="adp-office-grid-row-header" role="rowheader" aria-colindex={1}>
                {row.index + 1}
              </div>
              {row.cells
                ? drawnColumns.map((column) => {
                    const cell = row.cells?.[column];
                    if (!cell) return null;
                    return (
                      <div
                        key={`${cell.row}:${cell.column}`}
                        role="gridcell"
                        aria-colindex={cell.column + 2}
                        className={cell.value_kind === "formula" ? "adp-office-cell adp-office-cell--formula" : "adp-office-cell"}
                        title={cell.value_kind === "formula" ? t("office.notRecalculated") : undefined}
                        data-row={cell.row}
                        data-column={cell.column}
                        style={{
                          left: OFFICE_GRID_ROW_HEADER_WIDTH + cell.column * OFFICE_GRID_COLUMN_WIDTH,
                          top: 0,
                          width: OFFICE_GRID_COLUMN_WIDTH,
                          height: OFFICE_GRID_ROW_HEIGHT,
                        }}
                      >
                        {cell.text}
                        {cell.cached ? null : <span className="adp-office-cell-note">{t("office.loading")}</span>}
                      </div>
                    );
                  })
                : null}
            </div>
          ))}
          {totalRows === 0 && !loading && !errorText ? (
            <div className="adp-office-grid-empty" role="status">
              {t("office.noPreview")}
            </div>
          ) : null}
        </div>
      </div>
      {totalRows > 0 ? (
        <p className="adp-office-grid-status" role="status" aria-live="polite">
          {t("office.pageOf", { page: visible.rowStart + 1, count: totalRows })}
        </p>
      ) : null}
    </div>
  );
}
