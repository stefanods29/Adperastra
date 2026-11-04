import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  authorizeSnapshotFile,
  releaseExportSnapshot,
  releaseSnapshotAuthority,
  uploadSnapshot,
} from "../services/exportSnapshots";
import { fileDetect, fileGrant, fileRevoke, fileUrl } from "../services/files";
import {
  acquireAiDocumentInput,
  acquireAiInput,
  releaseAiInput,
} from "../services/localAiArtifacts";
import type { AiInputRef } from "../services/localAiTypes";
import { MAX_EXTRACTION_INPUT_BYTES } from "../services/aiExtractionTypes";

/** Authorized inputs for one extraction review (Step 17d T3/T8).
 *
 * A path is never an input: every lease starts from an open file token or an
 * immutable 08a snapshot, and every lease releases exactly what it acquired.
 * The native extraction provider validates the same refs again; this helper
 * only performs the ordinary 14c grant/upload handshake.
 */

export interface ExtractionFileItem {
  path: string;
  name: string;
  /** The file tab's open token; a missing token is granted and released here. */
  token?: string | null;
}

export interface ExtractionInputLease {
  input: AiInputRef;
  release: () => Promise<void>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function contentId(bytes: Uint8Array): Promise<string> {
  if (typeof crypto.subtle?.digest !== "function") throw new Error("ai_extract.unsupported");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

/** One open or granted file as a snapshot-backed 14c input. */
export async function leaseFileInput(item: ExtractionFileItem): Promise<ExtractionInputLease> {
  const granted = item.token ?? (await fileGrant(item.path));
  const ownedToken: string | null = item.token ? null : granted;
  let authorityId: string | null = null;
  let snapshotId: string | null = null;
  let input: AiInputRef | null = null;
  try {
    const info = await fileDetect(item.path);
    if (info.size <= 0 || info.size > MAX_EXTRACTION_INPUT_BYTES) {
      throw new Error("ai_extract.too_large");
    }
    const authority = await authorizeSnapshotFile(granted);
    authorityId = authority.document_id;
    const response = await fetch(fileUrl(granted, info.name));
    if (!response.ok) throw new Error("ai_extract.failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength !== info.size) {
      throw new Error("ai_extract.changed");
    }
    const snapshot = await uploadSnapshot(
      {
        document_id: authority.document_id,
        revision: 1,
        content_id: await contentId(bytes),
        mime: authority.mime || info.mime || "application/octet-stream",
        byte_len: bytes.byteLength,
      },
      bytes,
    );
    snapshotId = snapshot.snapshot_id;
    input = await acquireAiInput({
      kind: "snapshot",
      snapshot_id: snapshot.snapshot_id,
      document_id: snapshot.document_id,
      revision: snapshot.revision,
    });
    const ownedInput = input;
    return {
      input: ownedInput,
      release: async () => {
        await releaseAiInput(ownedInput.id).catch(() => undefined);
        await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
        // A token the tab already owns keeps its authority; never revoke it.
        if (ownedToken) {
          await releaseSnapshotAuthority(authority.document_id).catch(() => undefined);
          await fileRevoke(ownedToken).catch(() => undefined);
        }
      },
    };
  } catch (reason) {
    if (input) await releaseAiInput(input.id).catch(() => undefined);
    if (snapshotId) await releaseExportSnapshot(snapshotId).catch(() => undefined);
    if (authorityId && ownedToken) {
      await releaseSnapshotAuthority(authorityId).catch(() => undefined);
    }
    if (ownedToken) await fileRevoke(ownedToken).catch(() => undefined);
    throw reason;
  }
}

/** The original opened backing at its current revision (no unsaved model). */
export async function leaseDocumentInput(documentId: string): Promise<ExtractionInputLease> {
  const input = await acquireAiDocumentInput(documentId);
  return {
    input,
    release: async () => {
      await releaseAiInput(input.id).catch(() => undefined);
    },
  };
}

/** A captured editor snapshot, released together with its 14c input. */
export async function leaseCapturedSnapshot(
  snapshot: ExportSnapshot,
): Promise<ExtractionInputLease> {
  const input = await acquireAiInput({
    kind: "snapshot",
    snapshot_id: snapshot.snapshot_id,
    document_id: snapshot.document_id,
    revision: snapshot.revision,
  });
  return {
    input,
    release: async () => {
      await releaseAiInput(input.id).catch(() => undefined);
      await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    },
  };
}
