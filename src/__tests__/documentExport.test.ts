import { describe, expect, it, vi } from "vitest";
import { captureDocumentRevision } from "../office/document/documentExport";
import type { OfficeController } from "../office/OfficeController";
import { releaseExportSnapshot } from "../services/exportSnapshots";
vi.mock("../services/exportSnapshots", () => ({ releaseExportSnapshot: vi.fn(async () => undefined) }));

describe("document capture", () => {
  it("capture_supplied_revision_and_content_id", async () => {
    const state = { revision: 1, content_id: "old", document_id: "doc" };
    const capture = vi.fn(async () => { state.revision = 2; state.content_id = "new";
      return { snapshot_id: "snapshot", document_id: "doc", revision: 1, content_id: "old", storage_policy: "ordinary" }; });
    const controller = { getState: () => state, document: { info: { sensitive: false } }, capture } as unknown as OfficeController;
    const result = await captureDocumentRevision(controller);
    expect(capture).toHaveBeenCalledWith(1, "old"); expect(result.content_id).toBe("old");
  });
  it("rejects and releases policy downgrade", async () => {
    const controller = { getState: () => ({ revision: 1, content_id: "c", document_id: "doc" }),
      document: { info: { sensitive: true } }, capture: async () => ({ snapshot_id: "downgrade", document_id: "doc",
        revision: 1, content_id: "c", storage_policy: "ordinary" }),
    } as unknown as OfficeController;
    await expect(captureDocumentRevision(controller)).rejects.toThrow("office_edit.changed");
    expect(releaseExportSnapshot).toHaveBeenCalledWith("downgrade");
  });
});
