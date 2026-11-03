import { invoke } from "@tauri-apps/api/core";
import type { FileTypeInfo } from "./files";
import { isTauriRuntime } from "./settings";
export interface PinnedPreviewGrant { token: string; info: FileTypeInfo }
export async function previewDetect(path: string, background = false): Promise<FileTypeInfo> {
  if (!isTauriRuntime()) throw new Error("metadata.failed");
  return await invoke("preview_detect", { path, background });
}
export async function previewGrant(path: string, background = false): Promise<PinnedPreviewGrant> {
  if (!isTauriRuntime()) throw new Error("metadata.failed");
  return await invoke("preview_grant", { path, background });
}
export async function previewRevoke(token: string): Promise<void> {
  await invoke("preview_revoke", { token });
}
