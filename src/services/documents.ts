import { invoke } from "@tauri-apps/api/core";
import type { DocumentHandle, DocumentInfo, DocumentRef } from "../documents/types";
import type { SourceStamp } from "./cache";
import { fileUrl } from "./files";
import { runJob, type JobHandle } from "./jobs";

/** Native document sources (Step 09a). The only place that calls the
 * `document_*` commands. A token is exactly 32 lower-case hex characters;
 * source bytes travel through the `adpfile` protocol, never as JSON. */

export interface OpenDocumentResult {
  document_id: string;
  info: DocumentInfo;
  token: string;
  source_stamp?: SourceStamp;
}

export interface DocumentSnapshotBegin {
  snapshot_id: string;
  upload_token: string;
}

export interface DocumentCommitRequest {
  document_id: string;
  snapshot_id: string;
  captured_revision: number;
  content_id: string;
  expected_source?: SourceStamp;
  mode: "save" | "copy";
  dest_path?: string;
}

export interface DocumentCommitResult {
  saved_revision: number;
  content_id: string;
  new_source: SourceStamp;
  output_path: string;
  mode: "save" | "copy";
}

export interface DocumentSaveAsNewRequest {
  document_id: string;
  snapshot_id: string;
  captured_revision: number;
  content_id: string;
  expected_source_generation: number;
  dest_path: string;
}

/** The verified result of Save as new (E12/E13): the document keeps its
 * model, history and views and switches to the new file at once. */
export interface DocumentRebindResult {
  commit: DocumentCommitResult;
  previous_source: DocumentRef;
  new_source: DocumentRef;
  source_generation: number;
  rebound: boolean;
  output_path: string;
}

export async function openDocumentSource(source: DocumentRef): Promise<OpenDocumentResult> {
  return (await invoke("document_open", { source })) as OpenDocumentResult;
}

export async function releaseDocumentSource(documentId: string): Promise<void> {
  await invoke("document_release", { documentId });
}

export async function beginDocumentSnapshot(request: {
  document_id: string;
  captured_revision: number;
  content_id: string;
  mime: string;
  byte_len: number;
}): Promise<DocumentSnapshotBegin> {
  return (await invoke("document_snapshot_begin", { request })) as DocumentSnapshotBegin;
}

/** Start a commit (save or copy) of a finished snapshot. The native side
 * re-checks the snapshot's document, revision, content and source. */
export async function startDocumentCommit(request: DocumentCommitRequest): Promise<JobHandle<DocumentCommitResult>> {
  return runJob<DocumentCommitResult>("doccommit", async (requestId) => {
    await invoke("document_commit_start", { requestId, request });
  });
}

export const MAX_READ_RANGE = 4 * 1024 * 1024;

/** Original authorized source bytes for `document`, through its grant
 * token. Never unsaved edits. */
export async function readDocumentRange(token: string, name: string, offset: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("documents.invalid");
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_READ_RANGE) throw new Error("documents.invalid");
  if (length === 0) return new Uint8Array(0);
  const response = await fetch(fileUrl(token, name), {
    headers: { Range: `bytes=${offset}-${offset + length - 1}` },
  });
  if (!response.ok && response.status !== 206) throw new Error("documents.changed");
  return new Uint8Array(await response.arrayBuffer());
}

/** Save-as-new also has to rebind the guarded read grant and snapshot
 * authority. That transaction is not available yet, so the wrapper fails
 * before capturing or uploading a snapshot instead of producing a partial
 * rebind receipt. Save copy remains available through `startDocumentCommit`.
 */
export const DOCUMENT_SAVE_AS_NEW_AVAILABLE = false;

export async function saveDocumentAsNew(
  document: DocumentHandle,
  destPath: string,
  expectedSourceGeneration: number,
): Promise<JobHandle<DocumentRebindResult>> {
  if (!DOCUMENT_SAVE_AS_NEW_AVAILABLE) throw new Error("documents.read_only");
  const state = document.getState();
  const snapshot = await document.captureSnapshot();
  if (snapshot.revision !== state.revision || snapshot.content_id !== state.content_id) {
    throw new Error("documents.changed");
  }
  const request: DocumentSaveAsNewRequest = {
    document_id: document.id,
    snapshot_id: snapshot.snapshot_id,
    captured_revision: snapshot.revision,
    content_id: snapshot.content_id,
    expected_source_generation: expectedSourceGeneration,
    dest_path: destPath,
  };
  return runJob<DocumentRebindResult>("docsaveas", async (requestId) => {
    await invoke("document_save_as_new_start", { requestId, request });
  });
}
