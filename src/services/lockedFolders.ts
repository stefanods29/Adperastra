import { invoke } from "@tauri-apps/api/core";
import type { ConversionReport } from "../convert/types";
import { fileUrl } from "./files";
import { runJob, type JobHandle } from "./jobs";

/** Locked-folder service (Step 09k, `locked-container-1`). The native
 * mirror is `crates/locked-store/src/types.rs`; every field is snake_case.
 * Passwords and recovery secrets exist only in memory for one invoke. */

export type LockedSessionState = "unlocked" | "saving" | "lock_pending" | "locked";
export type LockRequestMode = "normal" | "idle" | "workstation" | "close";
export type LockedRecoveryAction = "recover" | "use_original" | "later";

export interface LockedEntry {
  id: string;
  parent_id?: string | null;
  name: string;
  kind: "file" | "folder";
  mime: string;
  size: number;
  modified_unix: number;
  chunks: string[];
  from_internet: boolean;
  hidden: boolean;
  system: boolean;
  read_only: boolean;
}

export interface LockedSession {
  session_id: string;
  container_path: string;
  container_id: string;
  revision: number;
  entry_count: number;
  dirty: boolean;
  state: LockedSessionState;
  pending_recovery: boolean;
  can_save_existing: false;
  can_save_copy: boolean;
}

export interface LockedEntryPage {
  entries: LockedEntry[];
  next_cursor?: string | null;
  complete: boolean;
  session_id: string;
  revision: number;
}

export interface LockedCreateRequest {
  source_dir: string;
  dest_path: string;
  /** Never logged, serialized into a report, or kept in a session. */
  password: string;
  recovery_dest_path: string;
  keep_original: true;
  confirm_original_unprotected: true;
}

export interface LockedCreateResult {
  path: string;
  container_id: string;
  recovery_path: string;
  original_kept: true;
  skipped: number;
}

export type LockedCredential =
  | { kind: "password"; value: string }
  | { kind: "recovery"; recovery_path: string };

export interface LockedUnlockRequest {
  path: string;
  credential: LockedCredential;
}

export interface LockedCopyRequest {
  session_id: string;
  dest_path: string;
  expected_revision: number;
}

export interface LockedCopyResult {
  path: string;
  container_id: string;
  revision: number;
  original_kept: true;
}

export interface LockRequest {
  session_id: string;
  mode: LockRequestMode;
  /** True only after the user explicitly chose Discard. */
  discard_dirty: boolean;
}

export interface LockResult {
  locked: boolean;
  state: LockedSession;
}

export interface LockedPersistRequest {
  session_id: string;
  entry_id: string;
  snapshot_id: string;
  expected_container_revision: number;
  captured_revision: number;
  content_id: string;
}

export interface LockedPersistResult {
  session_id: string;
  entry_id: string;
  container_revision: number;
  captured_revision: number;
  content_id: string;
  pending_id: string;
  verified: true;
}

export interface LockedGrantReply {
  token: string;
  length: number;
  mime: string;
  name: string;
  size: number;
  modified_unix: number;
  from_internet: boolean;
  read_only: boolean;
}

export interface LockedRecoveryItem {
  id: string;
  revision: number;
  created_unix: number;
}

export interface LockedSettings {
  auto_lock_minutes: 0 | 1 | 5 | 15 | 30;
  lock_on_workstation: boolean;
}

export const MAX_LOCKED_READ_RANGE = 8 * 1024 * 1024;
export const MAX_LOCKED_PROTOCOL_RANGE = 4 * 1024 * 1024;
export const LOCKED_EXTENSION = "adplock";
export const RECOVERY_EXTENSION = "adprecovery";

/** The model persister is registered once by LockedDocumentProvider. */
type PersistDirty = (sessionId: string) => Promise<LockedPersistResult[]>;
let persistDirtyModels: PersistDirty | null = null;

export function registerLockedModelPersister(persister: PersistDirty | null): void {
  persistDirtyModels = persister;
}

async function persistBeforeSessionWrite(sessionId: string): Promise<void> {
  if (!persistDirtyModels) return;
  await persistDirtyModels(sessionId);
}

export async function createLockedCopy(
  request: LockedCreateRequest,
): Promise<JobHandle<LockedCreateResult>> {
  return runJob<LockedCreateResult>("lockedcreate", async (requestId) => {
    await invoke("locked_create_start", { requestId, request });
  });
}

export async function unlockLockedFolder(
  request: LockedUnlockRequest,
): Promise<JobHandle<LockedSession>> {
  return runJob<LockedSession>("lockedunlock", async (requestId) => {
    await invoke("locked_unlock_start", { requestId, request });
  });
}

export async function listLockedEntries(
  sessionId: string,
  parentId: string | null,
  cursor?: string | null,
): Promise<LockedEntryPage> {
  return (await invoke("locked_list", {
    sessionId,
    parentId,
    cursor: cursor ?? null,
  })) as LockedEntryPage;
}

export async function lockedEntryInfo(
  sessionId: string,
  entryId: string,
): Promise<LockedEntry> {
  return (await invoke("locked_entry_info", { sessionId, entryId })) as LockedEntry;
}

export async function releaseLockedEntry(sessionId: string, token: string): Promise<void> {
  await invoke("locked_entry_release", { sessionId, token });
}

/**
 * Read at most 8 MiB from one entry. The wrapper splits into at most two
 * protocol requests of 4 MiB, checks the returned offsets/total and only
 * combines contiguous authenticated chunks.
 */
export async function readLockedEntry(
  sessionId: string,
  entryId: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("locked.invalid");
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_LOCKED_READ_RANGE) {
    throw new Error("locked.invalid");
  }
  if (!Number.isSafeInteger(offset + length)) throw new Error("locked.invalid");
  if (length === 0) return new Uint8Array(0);
  const result = new Uint8Array(length);
  let position = 0;
  while (position < length) {
    const partLength = Math.min(MAX_LOCKED_PROTOCOL_RANGE, length - position);
    const partOffset = offset + position;
    const grant = (await invoke("locked_entry_grant", {
      sessionId,
      entryId,
      offset: partOffset,
      length: partLength,
    })) as LockedGrantReply;
    if (grant.length !== partLength) throw new Error("locked.changed");
    try {
      const response = await fetch(fileUrl(grant.token, grant.name), {
        headers: { Range: `bytes=0-${partLength - 1}` },
      });
      if (!response.ok && response.status !== 206) throw new Error("locked.changed");
      const contentRange = response.headers.get("Content-Range");
      if (
        contentRange !== null &&
        contentRange !== `bytes 0-${partLength - 1}/${partLength}`
      ) {
        throw new Error("locked.changed");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== partLength) throw new Error("locked.changed");
      result.set(bytes, position);
    } finally {
      await releaseLockedEntry(sessionId, grant.token).catch(() => undefined);
    }
    position += partLength;
  }
  return result;
}

export async function saveLockedCopy(
  request: LockedCopyRequest,
): Promise<JobHandle<LockedCopyResult>> {
  await persistBeforeSessionWrite(request.session_id);
  return runJob<LockedCopyResult>("lockedsave", async (requestId) => {
    await invoke("locked_save_copy_start", { requestId, request });
  });
}

export async function lockFolder(
  request: LockRequest,
  persistBefore = true,
): Promise<JobHandle<LockResult>> {
  if (persistBefore && !request.discard_dirty) {
    await persistBeforeSessionWrite(request.session_id);
  }
  return runJob<LockResult>("lockedlock", async (requestId) => {
    await invoke("locked_lock_start", { requestId, request });
  });
}

export async function exportUnlockedCopy(
  sessionId: string,
  entryIds: readonly string[],
  destDir: string,
  confirmedUnencrypted: boolean,
): Promise<JobHandle<ConversionReport>> {
  if (!confirmedUnencrypted) throw new Error("locked.unencrypted_copy_required");
  return runJob<ConversionReport>("lockedexport", async (requestId) => {
    await invoke("locked_export_start", {
      requestId,
      request: {
        session_id: sessionId,
        entry_ids: [...entryIds],
        dest_dir: destDir,
        confirmed_unencrypted: true,
      },
    });
  });
}

export async function listLockedRecovery(
  sessionId: string,
): Promise<LockedRecoveryItem[]> {
  return (await invoke("locked_recovery_list", { sessionId })) as LockedRecoveryItem[];
}

export async function chooseLockedRecovery(
  sessionId: string,
  recoveryId: string,
  action: LockedRecoveryAction,
): Promise<JobHandle<LockedSession | null>> {
  return runJob<LockedSession | null>("lockedrec", async (requestId) => {
    await invoke("locked_recovery_choose", {
      requestId,
      sessionId,
      recoveryId,
      action,
    });
  });
}

export async function persistLockedSnapshot(
  request: LockedPersistRequest,
): Promise<JobHandle<LockedPersistResult>> {
  return runJob<LockedPersistResult>("lockedstore", async (requestId) => {
    await invoke("locked_persist_start", { requestId, request });
  });
}

export async function touchLockedSession(sessionId: string): Promise<void> {
  await invoke("locked_touch", { sessionId });
}

export async function markLockedDirty(
  sessionId: string,
  entryId: string,
  dirty: boolean,
): Promise<void> {
  await invoke("locked_mark_dirty", { sessionId, entryId, dirty });
}

export async function lockedIdleCheck(): Promise<JobHandle<LockedSession[]>> {
  return runJob<LockedSession[]>("lockedidle", async (requestId) => {
    await invoke("locked_idle_check", { requestId });
  });
}

export async function pickLockedRecoveryPath(
  title: string,
  filterName: string,
): Promise<string | null> {
  return (await invoke("locked_pick_recovery_path", { title, filterName })) as string | null;
}

/** A small, bounded name for dialogs; never used as a path by Rust. */
export function lockedNameOf(entry: LockedEntry): string {
  return entry.name;
}
