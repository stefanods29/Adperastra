import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Creating archives (Step 06e T9). Mirrors src-tauri/src/archive_create.rs.
 * The password travels only inside the start request; it never appears in a
 * result, error, job or Undo entry. */

export type CreateFormatId = "zip" | "seven_z";
export type CreateEncryptionId = "none" | "aes256" | "zip_crypto";

/** Mirrors Rust `CreateRequest` (snake_case fields). */
export interface ArchiveCreateRequest {
  sources: string[];
  dest_dir: string;
  file_name: string;
  format: CreateFormatId;
  encryption: CreateEncryptionId;
  password: string | null;
  encrypt_names: boolean;
}

/** What one creation really did (mirrors `ArchiveCreateReport`). */
export interface ArchiveCreateReport {
  created: string[];
  files_written: number;
  folders_written: number;
  source_bytes: number;
  archive_size: number;
  skipped: { path: string; reason: string }[];
  skipped_more: number;
  cancelled: boolean;
  error: string | null;
}

/** Start one creation as a job in the Explorer's jobs panel. */
export async function archiveCreate(
  request: ArchiveCreateRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<ArchiveCreateReport>> {
  if (!isTauriRuntime()) throw new Error("archive.other");
  return runJob<ArchiveCreateReport>(
    "arccreate",
    async (requestId) => {
      await invoke("archive_create_start", { requestId, request });
    },
    onProgress,
  );
}
