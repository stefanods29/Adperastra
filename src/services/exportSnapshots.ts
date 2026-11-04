import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";

/** Immutable editor snapshots (Step 08a T2, `export-snapshot-2`). The
 * native mirror is `src-tauri/src/export_snapshot_types.rs`. */

export type StoragePolicy = "ordinary" | "sensitive";

export interface ExportSnapshot {
  snapshot_id: string;
  document_id: string;
  revision: number;
  content_id: string;
  mime: string;
  byte_len: number;
  source?: SourceStamp;
  storage_policy: StoragePolicy;
  expires_unix: number;
}

export interface SnapshotAuthority {
  document_id: string;
  name: string;
  mime: string;
  storage_policy: StoragePolicy;
}

export interface SnapshotBeginRequest {
  document_id: string;
  revision: number;
  content_id: string;
  mime: string;
  byte_len: number;
  source?: SourceStamp;
}

export interface SnapshotBeginReply {
  snapshot_id: string;
  upload_token: string;
}

/** The most one upload chunk may carry. */
export const MAX_SNAPSHOT_CHUNK = 1024 * 1024;

function snapshotError(status: number): Error {
  if (status === 413) return new Error("snapshot.too_large");
  if (status === 409) return new Error("snapshot.changed");
  return new Error("snapshot.bad_request");
}

/** Authorize a capture of a file the app already opened. The native parent
 * derives the source stamp from the granted file, never from this call. */
export async function authorizeSnapshotFile(token: string): Promise<SnapshotAuthority> {
  return (await invoke("export_snapshot_authorize_file", { token })) as SnapshotAuthority;
}

/** Authorize a brand-new, unsaved document. */
export async function authorizeNewSnapshot(
  name: string,
  mime: string,
): Promise<SnapshotAuthority> {
  return (await invoke("export_snapshot_authorize_new", {
    name,
    mime,
  })) as SnapshotAuthority;
}

export async function beginExportSnapshot(
  metadata: SnapshotBeginRequest,
): Promise<SnapshotBeginReply> {
  return (await invoke("export_snapshot_begin", { metadata })) as SnapshotBeginReply;
}

/** Append one contiguous raw chunk; no bytes travel through invoke. */
export async function appendExportSnapshot(
  snapshotId: string,
  token: string,
  offset: number,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_CHUNK) {
    throw new Error("snapshot.too_large");
  }
  const response = await fetch(
    `http://adpfile.localhost/export-snapshot/${encodeURIComponent(snapshotId)}`,
    {
      method: "POST",
      headers: {
        "X-Adp-Upload-Token": token,
        "X-Adp-Offset": String(offset),
      },
      body: new Uint8Array(bytes).buffer,
    },
  );
  if (!response.ok) throw snapshotError(response.status);
}

/** Finalize after the exact declared length and hash were received. */
export async function finishExportSnapshot(snapshotId: string): Promise<ExportSnapshot> {
  return (await invoke("export_snapshot_finish", {
    snapshotId,
  })) as ExportSnapshot;
}

/** Idempotent: releasing an already released snapshot is not an error. */
export async function releaseExportSnapshot(snapshotId: string): Promise<void> {
  await invoke("export_snapshot_release", { snapshotId });
}

/** Drop an unfinished upload; only its own staging/memory is removed. */
export async function abortExportSnapshot(snapshotId: string): Promise<void> {
  await invoke("export_snapshot_abort", { snapshotId });
}

/** A view owner releases its authority only after its capture leases end. */
export async function releaseSnapshotAuthority(documentId: string): Promise<void> {
  await invoke("export_snapshot_authority_release", { documentId });
}

/** Upload a whole bounded snapshot in order; used by editor adapters. */
export async function uploadSnapshot(
  metadata: SnapshotBeginRequest,
  bytes: Uint8Array,
): Promise<ExportSnapshot> {
  if (bytes.length !== metadata.byte_len) throw new Error("snapshot.changed");
  const begun = await beginExportSnapshot(metadata);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, offset + MAX_SNAPSHOT_CHUNK);
      await appendExportSnapshot(begun.snapshot_id, begun.upload_token, offset, chunk);
      offset += chunk.length;
    }
    return await finishExportSnapshot(begun.snapshot_id);
  } catch (error) {
    await abortExportSnapshot(begun.snapshot_id).catch(() => undefined);
    throw error;
  }
}
