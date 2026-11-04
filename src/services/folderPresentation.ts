import { invoke } from "@tauri-apps/api/core";
import type { SortSpec } from "./explorer";
import type { GroupBy } from "./grouping";
import { isTauriRuntime, isViewModeId, type ViewModeId } from "./settings";
import { FOLDER_VIEWS_CLEARED_EVENT } from "./folderViews";

export const COLUMN_IDS = ["name", "modified", "kind", "size", "width", "height", "date_taken", "camera_model", "duration_ms", "author", "page_count", "audio_title", "audio_artist", "audio_album", "dimensions"] as const;
export type ColumnId = typeof COLUMN_IDS[number];
export interface ColumnSpec { id: ColumnId; width: number }
export interface FolderPresentation {
  view_mode: ViewModeId;
  sort: SortSpec;
  group_by: GroupBy;
  columns: ColumnSpec[];
}
export const COLUMN_LABEL_KEYS: Record<ColumnId, string> = {
  name: "explorer.columnName", modified: "explorer.columnModified", kind: "explorer.columnType", size: "explorer.columnSize",
  width: "columns.widthPixels", height: "columns.heightPixels", date_taken: "columns.dateTaken", camera_model: "columns.camera",
  duration_ms: "columns.duration", author: "columns.author", page_count: "columns.pages",
  audio_title: "folderCustom.audioTitle", audio_artist: "folderCustom.artist", audio_album: "folderCustom.album", dimensions: "folderCustom.dimensions",
};
export function defaultColumnWidth(id: ColumnId): number {
  return ({ name: 320, modified: 180, kind: 160, size: 100 } as Partial<Record<ColumnId, number>>)[id] ?? 140;
}
export function columnBounds(id: ColumnId): readonly [number, number] { return id === "name" ? [160, 1000] : [96, 600]; }
export function clampColumnWidth(id: ColumnId, width: number): number {
  const [min, max] = columnBounds(id);
  return Number.isFinite(width) ? Math.max(min, Math.min(max, Math.round(width))) : defaultColumnWidth(id);
}
export function defaultColumns(): ColumnSpec[] { return COLUMN_IDS.slice(0, 4).map((id) => ({ id, width: defaultColumnWidth(id) })); }
export function legacyPresentation(mode: ViewModeId): FolderPresentation {
  return { view_mode: mode, sort: { key: "name", direction: "ascending" }, group_by: "none", columns: defaultColumns() };
}
function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every((key) => keys.includes(key));
}
export function validColumns(value: unknown): value is ColumnSpec[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 15 || value[0]?.id !== "name") return false;
  const seen = new Set<string>();
  return value.every((column: unknown) => {
    if (!objectWithKeys(column, ["id", "width"]) || !COLUMN_IDS.includes(column.id as ColumnId)) return false;
    const id = column.id as ColumnId;
    const [min, max] = columnBounds(id);
    if (seen.has(id) || !Number.isInteger(column.width) || (column.width as number) < min || (column.width as number) > max) return false;
    seen.add(id);
    return true;
  });
}
export function validPresentation(value: unknown): value is FolderPresentation {
  if (!objectWithKeys(value, ["view_mode", "sort", "group_by", "columns"])) return false;
  return isViewModeId(value.view_mode) && objectWithKeys(value.sort, ["key", "direction"]) &&
    typeof value.sort.key === "string" && ["name", "modified", "size", "kind"].includes(value.sort.key) &&
    typeof value.sort.direction === "string" && ["ascending", "descending"].includes(value.sort.direction) &&
    typeof value.group_by === "string" && ["none", "name", "modified", "type", "size"].includes(value.group_by) && validColumns(value.columns);
}
function checkPath(path: string): void {
  if (!path || path.length > 32768 || path.includes("\0")) throw new Error("presentation.invalid");
}
export async function getFolderPresentation(path: string): Promise<FolderPresentation | null> {
  checkPath(path);
  if ([...path].length > 1024 || !isTauriRuntime()) return null;
  const result = await invoke<unknown>("folder_presentation_get", { path });
  if (result === null) return null;
  if (!validPresentation(result)) throw new Error("presentation.invalid");
  return result;
}
export async function setFolderPresentation(path: string, presentation: FolderPresentation): Promise<void> {
  checkPath(path);
  if (!validPresentation(presentation)) throw new Error("presentation.invalid");
  if ([...path].length > 1024 || !isTauriRuntime()) return;
  await invoke("folder_presentation_set", { path, presentation });
}
export async function clearFolderPresentations(): Promise<void> {
  if (isTauriRuntime()) await invoke("folder_presentation_clear");
  window.dispatchEvent(new Event(FOLDER_VIEWS_CLEARED_EVENT));
}
