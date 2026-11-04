import { invoke } from "@tauri-apps/api/core";
import type { AssistantScope } from "../assistant/types";

/**
 * Native scope grants (Step 17a T3, E5).
 *
 * `requestAssistantScope` opens the native Allow/Cancel dialog. The model and
 * the WebView can never set `approved`; only that dialog can. A folder mention
 * in chat text does not call this function.
 */

export async function requestAssistantScope(
  chatId: string,
  rootPath: string,
  recursive: boolean,
  readContents: boolean,
): Promise<AssistantScope> {
  return (await invoke("assistant_scope_request", {
    chatId,
    rootPath,
    recursive,
    readContents,
  })) as AssistantScope;
}

export async function assistantScope(chatId: string): Promise<AssistantScope> {
  return (await invoke("assistant_scope", { chatId })) as AssistantScope;
}

export async function revokeAssistantScope(scopeId: string): Promise<void> {
  await invoke("assistant_scope_revoke", { scopeId });
}
