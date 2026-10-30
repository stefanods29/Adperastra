/** Grid and flow layouts for the icon, tiles, content and list views
 * (Step 05a). Pure: the components only draw what these return. */

export type GridRow =
  | { type: "header"; key: string; group: number }
  | { type: "cells"; key: string; group: number; first: number; count: number };

export interface GridLayout {
  rows: GridRow[];
  /** The indexes in `rows` of the cells rows, top to bottom. */
  lines: number[];
  /** Number of items. */
  count: number;
}

export type GridMove = "left" | "right" | "up" | "down" | "home" | "end" | "pageUp" | "pageDown";

/** How many whole cells fit side by side; 1 for full-width cells. */
export function columnsFor(width: number, cellWidth: number, gap: number): number {
  if (cellWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (cellWidth + gap)));
}

/** One group after another; each group starts on a new row, under its
 * header when headers are on. */
export function buildGridLayout(
  groupSizes: readonly number[],
  columns: number,
  headers: boolean,
): GridLayout {
  const cols = Math.max(1, Math.floor(columns));
  const rows: GridRow[] = [];
  const lines: number[] = [];
  let offset = 0;
  groupSizes.forEach((size, group) => {
    if (size <= 0) return;
    if (headers) rows.push({ type: "header", key: `h${group}`, group });
    for (let line = 0; line * cols < size; line += 1) {
      rows.push({
        type: "cells",
        key: `c${group}-${line}`,
        group,
        first: offset + line * cols,
        count: Math.min(cols, size - line * cols),
      });
      lines.push(rows.length - 1);
    }
    offset += size;
  });
  return { rows, lines, count: offset };
}

/** The position in `lines` of the cells row that holds `index`, or -1.
 * Binary search: the layouts can hold 100,000 items. */
export function lineOfIndex(layout: GridLayout, index: number): number {
  let low = 0;
  let high = layout.lines.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const row = layout.rows[layout.lines[mid]];
    if (!row || row.type !== "cells") return -1;
    if (index < row.first) high = mid - 1;
    else if (index >= row.first + row.count) low = mid + 1;
    else return mid;
  }
  return -1;
}

/** Where an arrow move lands in a grid (Step 05a D5). */
export function gridMove(
  layout: GridLayout,
  index: number,
  move: GridMove,
  pageLines: number,
): number {
  const count = layout.count;
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return 0;
  if (move === "left") return Math.max(0, index - 1);
  if (move === "right") return Math.min(count - 1, index + 1);
  if (move === "home") return 0;
  if (move === "end") return count - 1;
  const line = lineOfIndex(layout, index);
  if (line < 0) return index;
  const row = layout.rows[layout.lines[line]];
  if (!row || row.type !== "cells") return index;
  const column = index - row.first;
  const step =
    move === "up"
      ? -1
      : move === "down"
        ? 1
        : move === "pageUp"
          ? -Math.max(1, pageLines)
          : Math.max(1, pageLines);
  const lastLine = layout.lines.length - 1;
  const targetRow = layout.rows[layout.lines[Math.min(lastLine, Math.max(0, line + step))]];
  if (!targetRow || targetRow.type !== "cells") return index;
  return targetRow.first + Math.min(column, targetRow.count - 1);
}

/** Where an arrow move lands in List view: items flow down a column, then
 * on to the next one. */
export function flowMove(
  count: number,
  rowsPerColumn: number,
  pageColumns: number,
  index: number,
  move: GridMove,
): number {
  if (count <= 0) return -1;
  const rpc = Math.max(1, rowsPerColumn);
  if (index < 0 || index >= count) return 0;
  if (move === "up") return Math.max(0, index - 1);
  if (move === "down") return Math.min(count - 1, index + 1);
  if (move === "home") return 0;
  if (move === "end") return count - 1;
  if (move === "left") return index - rpc >= 0 ? index - rpc : index;
  if (move === "right") {
    if (index + rpc <= count - 1) return index + rpc;
    return Math.floor(index / rpc) < Math.floor((count - 1) / rpc) ? count - 1 : index;
  }
  const pages = Math.max(1, pageColumns);
  if (move === "pageUp") return Math.max(0, index - rpc * pages);
  return Math.min(count - 1, index + rpc * pages);
}
