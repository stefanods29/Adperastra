import { invoke } from "@tauri-apps/api/core";
import type { CellRange, OfficeCellWindow } from "../office/types";
import { isTauriRuntime } from "./settings";

/** Bounded visible-cell window (20a E14). No whole-sheet upload: the caller
 * passes one inclusive rectangle and native returns only that window. */
export async function officeCellWindow(
  sessionId: string,
  range: CellRange,
): Promise<OfficeCellWindow> {
  if (!isTauriRuntime()) throw new Error("office_edit.engine_missing");
  return invoke("office_edit_cell_window", { sessionId, range });
}
