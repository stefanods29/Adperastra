import type { OfficeController } from "../OfficeController";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import { releaseExportSnapshot } from "../../services/exportSnapshots";

/** Immutable capture shared by recovery/export integration; caller releases a successful lease. */
export async function captureDocumentRevision(controller: OfficeController): Promise<ExportSnapshot> {
  const { revision, content_id, document_id } = controller.getState();
  const sensitive = controller.document.info.sensitive;
  const snapshot = await controller.capture(revision, content_id);
  if (snapshot.document_id !== document_id || snapshot.revision !== revision || snapshot.content_id !== content_id ||
      (sensitive && snapshot.storage_policy !== "sensitive")) {
    await releaseExportSnapshot(snapshot.snapshot_id);
    throw new Error("office_edit.changed");
  }
  return snapshot;
}
