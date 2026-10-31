import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime, normalizeSettings, type AppSettings } from "./settings";

/** The local date as YYYY-MM-DD, for the suggested export file name. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Shows the save dialog and writes the settings. Null when cancelled. */
export async function exportSettings(title: string, fileName: string, filterName: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("settings_export", { title, fileName, filterName })) as string | null;
}

/** Shows the open dialog and returns the file's settings, not saved yet. Null when cancelled. */
export async function importSettings(title: string, filterName: string): Promise<AppSettings | null> {
  if (!isTauriRuntime()) return null;
  const settings = await invoke("settings_import", { title, filterName });
  return settings === null ? null : normalizeSettings(settings);
}
