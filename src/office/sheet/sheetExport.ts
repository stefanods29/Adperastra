import type { OfficeController } from "../OfficeController";
import { exportOffice } from "../../services/officeEdit";
import { releaseExportSnapshot } from "../../services/exportSnapshots";
import type { PageRange } from "../../convert/types";

/** Current encoded model only; original-byte readRange is never an export. */
export async function exportSheetPdf(controller: OfficeController, ranges: PageRange[]): ReturnType<typeof exportOffice> {
  const state = controller.getState();
  const handle = await exportOffice(controller.session_id, state.revision, "pdf", ranges);
  return { ...handle, completion: handle.completion.then(async (snapshot) => {
    if (snapshot.document_id !== controller.document.id || snapshot.revision !== state.revision || snapshot.content_id !== state.content_id || snapshot.mime !== "application/pdf") {
      await releaseExportSnapshot(snapshot.snapshot_id);
      throw new Error("office_edit.changed");
    }
    return snapshot;
  }) };
}
