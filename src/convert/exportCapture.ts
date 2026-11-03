import {
  authorizeSnapshotFile, releaseExportSnapshot, releaseSnapshotAuthority,
  uploadSnapshot, type ExportSnapshot,
} from "../services/exportSnapshots";

/** Captured synchronously from the editor model, before any asynchronous upload. */
export interface CapturedModel {
  revision: number;
  contentId: string;
  mime: string;
  bytes: Uint8Array;
}

/** The view owns this binding until unmount. Captures never reload disk bytes. */
export function createFileExportCapture(token: string, readModel: () => CapturedModel) {
  let disposed = false;
  let pending = 0;
  const authority = authorizeSnapshotFile(token);
  // Authorization errors remain visible to capture callers without becoming
  // an unhandled rejection before the first export action.
  void authority.catch(() => undefined);
  const snapshots = new Set<string>();
  const releaseAuthority = async () => {
    if (!disposed || pending > 0 || snapshots.size > 0) return;
    const issued = await authority.catch(() => null);
    if (issued) await releaseSnapshotAuthority(issued.document_id);
  };
  return {
    async capture(): Promise<ExportSnapshot> {
      if (disposed) throw new Error("snapshot.bad_request");
      const model = readModel();
      if (!Number.isSafeInteger(model.revision) || model.revision < 1 ||
          model.bytes.length === 0 || model.bytes.length > 256 * 1024 * 1024) {
        throw new Error("snapshot.too_large");
      }
      // Copy now, so a later edit cannot change an in-flight upload.
      const bytes = new Uint8Array(model.bytes);
      pending++;
      try {
        const issued = await authority;
        if (disposed) throw new Error("snapshot.bad_request");
        const snapshot = await uploadSnapshot({
          document_id: issued.document_id, revision: model.revision,
          content_id: model.contentId, mime: model.mime, byte_len: bytes.length,
        }, bytes);
        if (disposed) {
          await releaseExportSnapshot(snapshot.snapshot_id);
          throw new Error("snapshot.bad_request");
        }
        snapshots.add(snapshot.snapshot_id);
        return snapshot;
      } finally {
        pending--;
        await releaseAuthority();
      }
    },
    async dispose(snapshotId: string): Promise<void> {
      if (!snapshots.delete(snapshotId)) return;
      await releaseExportSnapshot(snapshotId);
      await releaseAuthority();
    },
    async close(): Promise<void> {
      disposed = true;
      await releaseAuthority();
    },
  };
}
