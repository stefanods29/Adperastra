import type { CommandContext } from "../commands/registry";
export type PaletteKind = "command" | "folder" | "recent_file" | "tab" | "saved_group" | "settings" | "help";
export interface PaletteEntry {
  id: string;
  kind: PaletteKind;
  label_key?: string;
  /** Localized runtime title for catalog entries that have no locale key. */
  runtime_label?: string;
  /** English title used for cross-language matching and as the fallback. */
  english_label: string;
  keywords: string[];
  description?: string;
  shortcut?: string;
  disabled_reason_key?: string;
  enabled: boolean;
  target_id: string;
}
export interface PaletteMatch { entry: PaletteEntry; score: number; matched_ranges: [number, number][] }
export interface PaletteHost {
  commandContext(): CommandContext;
  dispatchCommand(id: string): void;
  openFolder(path: string): Promise<void>;
  openFile(path: string): Promise<void>;
  activateTab(id: string): void;
  openSavedGroup(id: string): Promise<void>;
  openSettings(sectionId: string): void;
  openHelp(slug: string): void;
}
export interface PaletteProvider {
  snapshot(): Promise<readonly PaletteEntry[]>;
  dispatch(entry: PaletteEntry, host: PaletteHost): Promise<void>;
}
