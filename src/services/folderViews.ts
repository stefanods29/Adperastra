import { invoke } from "@tauri-apps/api/core";
import { displayPath } from "./explorer";
import { isTauriRuntime, isViewModeId, type ViewModeId } from "./settings";

/** Mirrors Rust `fs_service::FolderView` (snake_case fields). */
export interface FolderView {
  /** Display form (no `\\?\` prefix), in the user's case. */
  path: string;
  mode: string;
  used_unix: number;
}

/** Fired on `window` after "Forget folder views" so open Explorers reload. */
export const FOLDER_VIEWS_CLEARED_EVENT = "adp-folder-views-cleared";

/** The key two paths share when they name the same folder: display form,
 * no trailing backslashes, lower case. */
export function folderViewKey(path: string): string {
  return displayPath(path).replace(/\\+$/, "").toLowerCase();
}

/** Folder key to view, first entry per folder, known views only. */
export function folderViewMap(entries: readonly FolderView[]): Map<string, ViewModeId> {
  const map = new Map<string, ViewModeId>();
  for (const entry of entries) {
    if (!isViewModeId(entry.mode)) continue;
    const key = folderViewKey(entry.path);
    if (!map.has(key)) map.set(key, entry.mode);
  }
  return map;
}

export async function getFolderViews(): Promise<FolderView[]> {
  if (!isTauriRuntime()) return [];
  return (await invoke("folder_views_get")) as FolderView[];
}

export async function setFolderView(path: string, mode: ViewModeId): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("folder_view_set", { path, mode });
}

export async function clearFolderViews(): Promise<void> {
  try {
    if (isTauriRuntime()) await invoke("folder_views_clear");
  } finally {
    window.dispatchEvent(new Event(FOLDER_VIEWS_CLEARED_EVENT));
  }
}
