import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import type { DocumentRef } from "../documents/types";
import {
  abortExportSnapshot,
  appendExportSnapshot,
  authorizeNewSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
  releaseExportSnapshot,
  releaseSnapshotAuthority,
  type ExportSnapshot,
} from "./exportSnapshots";
import { fileRevoke, fileUrl } from "./files";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/**
 * Encrypted recovery records (Step 09h, `recovery-1`). The old plaintext
 * draft entrypoints remain source-compatible below, but every one of them
 * now uses the encrypted 08a snapshot upload and the recovery store. No
 * command or file in this module writes plaintext unsaved text.
 */

export const RECOVERY_VERSION = 1;
export const MAX_RECOVERY_BYTES = 67_108_864;
export const MAX_DRAFT_BYTES = 33_554_432;

/** Mirrors native `recovery_types::RecoveryMetadata` (snake_case). */
export interface RecoveryMetadata {
  version: 1;
  record_id: string;
  document_id: string;
  source: DocumentRef;
  source_stamp?: SourceStamp;
  name: string;
  mime: string;
  handler_id: string;
  captured_revision: number;
  content_id: string;
  captured_unix: number;
  byte_len: number;
  from_internet: boolean;
  sensitive: false;
}

export type RecoveryStatus = "available" | "unsupported" | "corrupt";

export interface RecoveryCandidate {
  record_id: string;
  name: string;
  source_path?: string | null;
  captured_unix: number;
  revision: number;
  byte_len: number;
  status: RecoveryStatus;
  error_code?: string | null;
}

export interface RecoveryListPage {
  items: RecoveryCandidate[];
  next_cursor?: string | null;
  complete: boolean;
  unclean_exit: boolean;
  safe_mode: boolean;
}

export interface RecoveryOpenResult {
  record_id: string;
  copy_path: string;
  from_internet: boolean;
}

export interface RecoverySaveResult {
  record_id: string;
  captured_revision: number;
}

export type SafeModeReason = "repeated_startup_failure" | "manual" | "none";

export interface SafeModeStatus {
  active: boolean;
  reason: SafeModeReason;
  failed_starts: number;
  settings_read_only: boolean;
}

/** E1: save one immutable encoded revision. Only controller metadata is
 * accepted by the native side; the snapshot identity is checked there. */
export async function saveRecoverySnapshot(
  snapshot: ExportSnapshot,
  metadata: RecoveryMetadata,
): Promise<JobHandle<RecoverySaveResult>> {
  if (!isTauriRuntime()) throw new Error("recovery.unsupported");
  return runJob<RecoverySaveResult>("recsave", async (requestId) => {
    await invoke("recovery_save_start", {
      requestId,
      snapshotId: snapshot.snapshot_id,
      metadata,
    });
  });
}

/** E2: list decrypted metadata only; content is never part of this answer. */
export async function listRecovery(cursor?: string): Promise<RecoveryListPage> {
  if (!isTauriRuntime()) throw new Error("recovery.unsupported");
  return (await invoke("recovery_list", { cursor: cursor ?? null })) as RecoveryListPage;
}

/** E2: open a reviewed recovered copy; the encrypted record is retained. */
export async function openRecoveredCopy(recordId: string): Promise<JobHandle<RecoveryOpenResult>> {
  if (!isTauriRuntime()) throw new Error("recovery.unsupported");
  return runJob<RecoveryOpenResult>("recopen", async (requestId) => {
    await invoke("recovery_open_start", { requestId, recordId });
  });
}

/** E2: discard only these recovery records; originals never change. */
export async function discardRecovery(ids: readonly string[]): Promise<void> {
  if (!isTauriRuntime()) return;
  if (ids.length === 0) return;
  await invoke("recovery_discard", { ids });
}

/** E6: the current safe-mode status. */
export async function safeModeStatus(): Promise<SafeModeStatus> {
  if (!isTauriRuntime()) {
    return { active: false, reason: "none", failed_starts: 0, settings_read_only: false };
  }
  return (await invoke("safe_mode_status")) as SafeModeStatus;
}

type RestartGuard = () => Promise<boolean>;
let restartGuard: RestartGuard | null = null;

/** The coordinator registers the app's close/dirty decision before safe mode
 * can restart. Returning false cancels the restart and keeps every view. */
export function registerRestartGuard(guard: RestartGuard | null): void {
  restartGuard = guard;
}

/** E6: first await the dirty-close decision, then ask native to restart. */
export async function restartNormally(): Promise<void> {
  if (!isTauriRuntime()) return;
  if (restartGuard) {
    const proceed = await restartGuard();
    if (!proceed) throw new Error("app.close_cancelled");
  }
  await invoke("restart_normal");
}

export interface LegacyImportReport {
  imported: number;
  skipped: number;
}

/** The number of old plaintext drafts detected by name only. They are never
 * read automatically; the recovery dialog offers an explicit import. */
export async function legacyRecoveryCount(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return (await invoke("recovery_legacy_count")) as number;
}

/** Explicitly encrypt old plaintext drafts as new records. Old files are
 * renamed to `.migrated` after a successful save; corrupt ones stay. */
export async function importLegacyRecovery(): Promise<JobHandle<LegacyImportReport>> {
  if (!isTauriRuntime()) throw new Error("recovery.unsupported");
  return runJob<LegacyImportReport>("recimport", async (requestId) => {
    await invoke("recovery_legacy_import_start", { requestId });
  });
}

// ---------------------------------------------------------------------------
// Step 06a compatibility facades (same names and signatures)
// ---------------------------------------------------------------------------

export interface Draft {
  schema_version: number;
  path: string;
  text: string;
  saved_unix: number;
  file_modified_unix: number;
}

interface LegacyDraftRead {
  record_id: string;
  token: string;
  name: string;
  saved_unix: number;
  file_modified_unix: number;
}

function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Compatibility wrapper: encode as UTF-8, upload one 08a snapshot, then
 * store it through E1. It never calls the old plaintext command. */
export async function writeDraft(
  path: string,
  text: string,
  _fileModifiedUnix: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength > MAX_DRAFT_BYTES) throw new Error("recovery.too_large");
  const authority = await authorizeNewSnapshot(fileNameOf(path), "text/plain");
  let snapshotId: string | null = null;
  let finished = false;
  try {
    const begin = await beginExportSnapshot({
      document_id: authority.document_id,
      revision: 1,
      content_id: crypto.randomUUID(),
      mime: "text/plain",
      byte_len: encoded.byteLength,
    });
    snapshotId = begin.snapshot_id;
    if (encoded.byteLength > 0) {
      await appendExportSnapshot(begin.snapshot_id, begin.upload_token, 0, encoded);
    }
    const snapshot = await finishExportSnapshot(begin.snapshot_id);
    finished = true;
    const metadata: RecoveryMetadata = {
      version: RECOVERY_VERSION,
      record_id: crypto.randomUUID(),
      document_id: authority.document_id,
      source: { kind: "disk", path },
      name: fileNameOf(path),
      mime: "text/plain",
      handler_id: "text",
      captured_revision: snapshot.revision,
      content_id: snapshot.content_id,
      captured_unix: Math.floor(Date.now() / 1000),
      byte_len: snapshot.byte_len,
      from_internet: false,
      sensitive: false,
    };
    const handle = await saveRecoverySnapshot(snapshot, metadata);
    await handle.completion;
  } finally {
    if (snapshotId) {
      // An unfinished upload is aborted; a finalized snapshot is released.
      if (finished) {
        await releaseExportSnapshot(snapshotId).catch(() => undefined);
      } else {
        await abortExportSnapshot(snapshotId).catch(() => undefined);
      }
    }
    await releaseSnapshotAuthority(authority.document_id).catch(() => undefined);
  }
}

/** Compatibility wrapper: resolve an authorized memory grant, decode the
 * bounded bytes, and build the old `Draft`. The record is never opened as a
 * plaintext file and no file bytes travel as JSON. */
export async function readDraft(path: string): Promise<Draft | null> {
  if (!isTauriRuntime()) return null;
  const found = (await invoke("recovery_legacy_read", { path })) as LegacyDraftRead | null;
  if (!found) return null;
  try {
    const response = await fetch(fileUrl(found.token, found.name));
    if (!response.ok) throw new Error("recovery.io");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DRAFT_BYTES) throw new Error("recovery.too_large");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      schema_version: 1,
      path,
      text,
      saved_unix: found.saved_unix,
      file_modified_unix: found.file_modified_unix,
    };
  } finally {
    await fileRevoke(found.token).catch(() => undefined);
  }
}

/** Compatibility wrapper: resolve exactly this path's record and discard it
 * through E2. A foreign or uncertain old file is never deleted. */
export async function deleteDraft(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const found = (await invoke("recovery_legacy_read", { path })) as LegacyDraftRead | null;
  if (!found) return;
  await fileRevoke(found.token).catch(() => undefined);
  await discardRecovery([found.record_id]);
}
