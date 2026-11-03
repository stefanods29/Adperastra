import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

/** Stable file identity (Step 07a, E9). Metadata only: no content is read
 * and an online-only file is never hydrated. */

/** Mirrors Rust `fs_service::source_stamp::FileIdentityKey`. */
export interface FileIdentityKey {
  volume_id: string;
  file_id: string;
  path_key: string;
  /** False when the volume cannot provide stable IDs (FAT/exFAT, network). */
  stable: boolean;
}

export async function readFileIdentity(path: string): Promise<FileIdentityKey> {
  if (!isTauriRuntime()) {
    return { volume_id: "00000000", file_id: "0000000000000000", path_key: "", stable: false };
  }
  return (await invoke("file_identity", { path })) as FileIdentityKey;
}
