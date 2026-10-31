import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

/** Recovery copies of unsaved text (Step 06a). Mirrors Rust `Draft`. */

export interface Draft {
  schema_version: number;
  /** The file's display path. */
  path: string;
  /** The editor's text with `\n` line breaks. */
  text: string;
  /** When the copy was written. */
  saved_unix: number;
  /** The file's modified time when the tab last read or saved it. */
  file_modified_unix: number;
}

export async function writeDraft(path: string, text: string, fileModifiedUnix: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("recovery_write", { path, text, fileModifiedUnix });
}

export async function readDraft(path: string): Promise<Draft | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("recovery_read", { path })) as Draft | null;
}

export async function deleteDraft(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("recovery_delete", { path });
}
