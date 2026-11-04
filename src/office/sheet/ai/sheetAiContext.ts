import type { OfficeController } from "../../OfficeController";
import type { CellInput, CellRange, OfficeAiContext, OfficeDisplayCell, OfficeSelection } from "../../types";
import {
  bindOfficeAiContext, captureOfficeAiContext, releaseOfficeAiContext,
} from "../../../services/officeAi";
import { sheetRangeContains } from "./sheetAiTypes";
import type { SheetAiRequest } from "./sheetAiTypes";

/** E20 capture for one explicit sheet rectangle (ai-sheet-1 T3).
 *
 * Capture never widens the caller's selection: E20 receives exactly one
 * bounded rectangle and the excerpt builder below reads only cells inside it.
 * Whole-sheet snapshots and hidden-row scope are not part of the request and
 * are refused instead of being forwarded implicitly. */

export const SHEET_AI_MAX_SCALARS = 24_000;
const MAX_CELLS = 2_000;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function scalars(value: string): number {
  return Array.from(value).length;
}

function inside(range: CellRange, address: { sheet_id: string; row: number; column: number }): boolean {
  return sheetRangeContains(range, {
    sheet_id: address.sheet_id, first_row: address.row, last_row: address.row,
    first_column: address.column, last_column: address.column,
  });
}

/** The exact E20 selection for this request. The active cell is the formula
 * target or the rectangle's first cell; E20 requires it inside the range. */
export function sheetOfficeSelection(request: SheetAiRequest): OfficeSelection {
  const range = request.selection;
  const active = request.target ?? {
    sheet_id: range.sheet_id, row: range.first_row, column: range.first_column,
  };
  if (!inside(range, active)) throw new Error("sheet_ai.invalid");
  return { kind: "sheet", active: { ...active }, ranges: [{ ...range }] };
}

/** Capture the immutable selected cells. A stale session, an incomplete or
 * truncated capture and a mismatched selection all fail closed and release
 * the native context before the caller can see it. */
export async function captureSheetSelection(
  controller: OfficeController,
  request: SheetAiRequest,
): Promise<OfficeAiContext> {
  if (request.include_hidden) {
    // E20 has no hidden-row receipt: refusing is safer than silently sending
    // rows the user explicitly excluded.
    throw new Error("sheet_ai.invalid");
  }
  const range = request.selection;
  const rows = range.last_row - range.first_row + 1;
  const columns = range.last_column - range.first_column + 1;
  if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_CELLS) {
    throw new Error("sheet_ai.invalid");
  }
  const state = controller.getState();
  if (!state || controller.family !== "sheet" || state.family !== "sheet" ||
      !state.ready || state.busy || state.session_id !== request.session_id ||
      state.revision !== request.expected_revision ||
      state.content_id !== request.expected_content_id) {
    throw new Error("sheet_ai.changed");
  }
  const selection = sheetOfficeSelection(request);
  const bound = bindOfficeAiContext(controller, selection, {
    max_scalars: SHEET_AI_MAX_SCALARS,
    include_images: false,
  });
  const handle = await captureOfficeAiContext(controller.session_id, bound);
  const context = await handle.completion;
  const captured = context.selection;
  const sameSelection = captured.kind === "sheet" && captured.ranges.length === 1 &&
    captured.ranges[0].sheet_id === range.sheet_id &&
    captured.ranges[0].first_row === range.first_row &&
    captured.ranges[0].last_row === range.last_row &&
    captured.ranges[0].first_column === range.first_column &&
    captured.ranges[0].last_column === range.last_column;
  if (context.session_id !== controller.session_id || context.family !== "sheet" ||
      context.revision !== request.expected_revision ||
      context.content_id !== request.expected_content_id || !sameSelection ||
      !context.complete || context.truncated || context.next_cursor !== null ||
      !Number.isSafeInteger(context.expires_unix) || context.expires_unix <= nowUnix()) {
    await releaseOfficeAiContext(context.context_id).catch(() => undefined);
    throw new Error("sheet_ai.changed");
  }
  const seen = new Set<string>();
  for (const cell of context.cells) {
    const key = `${cell.address.sheet_id}:${cell.address.row}:${cell.address.column}`;
    if (!inside(range, cell.address) || seen.has(key)) {
      await releaseOfficeAiContext(context.context_id).catch(() => undefined);
      throw new Error("sheet_ai.invalid");
    }
    seen.add(key);
  }
  if (context.cells.length > MAX_CELLS) {
    await releaseOfficeAiContext(context.context_id).catch(() => undefined);
    throw new Error("sheet_ai.invalid");
  }
  return context;
}

export async function releaseSheetSelection(contextId: string): Promise<void> {
  await releaseOfficeAiContext(contextId).catch(() => undefined);
}

function inputValue(input: CellInput): string | number | boolean {
  switch (input.kind) {
    case "blank": return "";
    case "text": return input.text;
    case "number": return Number.isFinite(input.value) ? input.value : "";
    case "boolean": return input.value;
    case "date": return input.iso_date;
    case "formula": return input.canonical;
  }
}

/** Typed selected-cell excerpt for the model prompt. It contains only input
 * values from the captured rectangle (never entire rows, the whole sheet or
 * a calculated claim), and refuses an excerpt over the capture budget. */
export function sheetSelectionExcerpt(context: OfficeAiContext, request: SheetAiRequest): string {
  const range = request.selection;
  const map = new Map<string, CellInput>();
  for (const cell of context.cells) {
    if (!inside(range, cell.address)) throw new Error("sheet_ai.invalid");
    map.set(`${cell.address.row}:${cell.address.column}`, cell.input);
  }
  const rows: (string | number | boolean | null)[][] = [];
  for (let row = range.first_row; row <= range.last_row; row += 1) {
    const values: (string | number | boolean | null)[] = [];
    for (let column = range.first_column; column <= range.last_column; column += 1) {
      const input = map.get(`${row}:${column}`);
      values.push(input ? inputValue(input) : null);
    }
    rows.push(values);
    if (rows.length > MAX_ROWS) throw new Error("sheet_ai.invalid");
  }
  const excerpt = JSON.stringify({
    sheet_id: range.sheet_id,
    first_row: range.first_row,
    first_column: range.first_column,
    header: request.header,
    rows,
  });
  if (scalars(excerpt) > SHEET_AI_MAX_SCALARS) throw new Error("sheet_ai.invalid");
  return excerpt;
}

export function sheetCellAt(context: OfficeAiContext, row: number, column: number): OfficeDisplayCell | null {
  return context.cells.find((cell) => cell.address.row === row && cell.address.column === column) ?? null;
}
