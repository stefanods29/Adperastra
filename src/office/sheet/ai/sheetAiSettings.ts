import type { SheetAiAction } from "./sheetAiTypes";

export interface SheetAiSettings { enabled: boolean; experimental_actions: SheetAiAction[] }
export function defaultSheetAiSettings(): SheetAiSettings {
  return { enabled: false, experimental_actions: [] };
}
