import type { CellRange } from "../types";
import type { SerializableViewState } from "../../documents/types";
import { sheetRibbonTabIds, type SheetEditorViewState } from "./sheetUiTypes";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Reflect.ownKeys(value).every((key) => typeof key === "string" && !["__proto__", "constructor", "prototype"].includes(key) && !Object.getOwnPropertyDescriptor(value, key)?.get);
}

export function defaultSheetViewState(): SheetEditorViewState {
  return { active_sheet_id: null, selection: null,
    viewport: { x_px: 0, y_px: 0, width_px: 1, height_px: 1, zoom_percent: 100, device_scale: 1, view_revision: 0 },
    active_ribbon_tab: "sheet.home", formula_bar: true, gridlines: true, headings: true, freeze: null, zoom: 100 };
}

function readRange(value: unknown, sheet_id: string): CellRange | null {
  if (!record(value) || value.sheet_id !== sheet_id || !integer(value.first_row, 0, 1_048_575) ||
    !integer(value.last_row, value.first_row, 1_048_575) || !integer(value.first_column, 0, 16_383) || !integer(value.last_column, value.first_column, 16_383)) return null;
  return { sheet_id, first_row: value.first_row, last_row: value.last_row, first_column: value.first_column, last_column: value.last_column };
}

function decode(value: unknown): SheetEditorViewState | null {
  if (!record(value)) return null;
  const state = defaultSheetViewState();
  if (typeof value.active_sheet_id === "string" && uuid.test(value.active_sheet_id)) state.active_sheet_id = value.active_sheet_id;
  if (sheetRibbonTabIds.some((id) => id === value.active_ribbon_tab)) state.active_ribbon_tab = value.active_ribbon_tab as SheetEditorViewState["active_ribbon_tab"];
  for (const key of ["formula_bar", "gridlines", "headings"] as const) if (typeof value[key] === "boolean") state[key] = value[key];
  if (finite(value.zoom, 25, 400)) state.zoom = value.zoom;
  if (record(value.viewport)) {
    const v = value.viewport;
    if (finite(v.x_px, 0, 1e9)) state.viewport.x_px = v.x_px;
    if (finite(v.y_px, 0, 1e9)) state.viewport.y_px = v.y_px;
    if (integer(v.width_px, 1, 16_384)) state.viewport.width_px = v.width_px;
    if (integer(v.height_px, 1, 16_384)) state.viewport.height_px = v.height_px;
    if (finite(v.device_scale, 0.5, 4)) state.viewport.device_scale = v.device_scale;
    if (integer(v.view_revision, 0, 0xffffffff)) state.viewport.view_revision = v.view_revision;
  }
  state.viewport.zoom_percent = state.zoom;
  const selected = value.selection;
  if (state.active_sheet_id && record(selected) && selected.kind === "sheet" && record(selected.active) &&
    selected.active.sheet_id === state.active_sheet_id && integer(selected.active.row, 0, 1_048_575) && integer(selected.active.column, 0, 16_383) &&
    Array.isArray(selected.ranges) && selected.ranges.length >= 1 && selected.ranges.length <= 32) {
    const ranges = selected.ranges.map((range) => readRange(range, state.active_sheet_id!));
    if (ranges.every((range): range is CellRange => range !== null)) state.selection = {
      kind: "sheet", active: { sheet_id: state.active_sheet_id, row: selected.active.row, column: selected.active.column }, ranges,
    };
  }
  // Freeze is derived document state. Saved sessions cannot invent or restore it.
  return state;
}

/** Field whitelist drops formula buffers, cell bodies, grant IDs and passwords. */
function encode(value: unknown): SerializableViewState | null {
  const state = decode(value);
  if (!state) return null;
  return {
    active_sheet_id: state.active_sheet_id, active_ribbon_tab: state.active_ribbon_tab,
    formula_bar: state.formula_bar, gridlines: state.gridlines, headings: state.headings,
    zoom: state.zoom, freeze: null, viewport: { ...state.viewport },
    selection: state.selection ? { kind: "sheet", active: { ...state.selection.active }, ranges: state.selection.ranges.map((range) => ({ ...range })) } : null,
  };
}
export const sheetViewStateCodec = { version: 1, encode, decode };

/** Decode one saved view state for a mounted editor; corrupt or foreign data
 * falls back to the documented defaults instead of half-restoring fields. */
export function normalizeSheetViewState(value: unknown): SheetEditorViewState {
  return decode(value) ?? defaultSheetViewState();
}

/** Apply live UUID/dimension checks after the producer's sheet catalogue arrives. */
export function clampSheetViewState(state: SheetEditorViewState, sheets: readonly { id: string; rows: number; columns: number; hidden: boolean }[]): SheetEditorViewState {
  const sheet = sheets.find((item) => item.id === state.active_sheet_id && !item.hidden) ?? sheets.find((item) => !item.hidden);
  if (!sheet) return { ...defaultSheetViewState(), active_ribbon_tab: state.active_ribbon_tab };
  if (sheet.id !== state.active_sheet_id) return { ...state, active_sheet_id: sheet.id, selection: null, freeze: null, viewport: { ...state.viewport, x_px: 0, y_px: 0 } };
  const selection = state.selection;
  const valid = selection && selection.active.row < sheet.rows && selection.active.column < sheet.columns &&
    selection.ranges.every((range) => range.sheet_id === sheet.id && range.last_row < sheet.rows && range.last_column < sheet.columns);
  return { ...state, selection: valid ? selection : null, freeze: null };
}
