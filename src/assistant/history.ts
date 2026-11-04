import { invoke } from "@tauri-apps/api/core";
import type { AssistantConversation } from "./types";

/**
 * Optional encrypted history transport (Step 17a T7).
 *
 * The native store owns decryption. Sensitive sessions never appear here and
 * no function accepts a credential or writes a user file.
 */

export async function listAssistantHistory(): Promise<AssistantConversation[]> {
  return (await invoke("assistant_history_list")) as AssistantConversation[];
}

export async function clearAssistantHistory(): Promise<number> {
  return (await invoke("assistant_history_clear")) as number;
}

export async function exportAssistantHistory(destPath: string): Promise<void> {
  await invoke("assistant_history_export", { destPath });
}
