import { describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { exportSheetPdf } from "../office/sheet/sheetExport";
const api = vi.hoisted(() => ({ export: vi.fn(), release: vi.fn() }));
vi.mock("../services/officeEdit", () => ({ exportOffice: api.export }));
vi.mock("../services/exportSnapshots", () => ({ releaseExportSnapshot: api.release }));
describe("sheet PDF snapshot", () => {
  it("current unsaved PDF snapshot correct and later edit does not change captured identity", async () => {
    let revision = 4;
    const c = { session_id: "session", document: { id: "doc", readRange: vi.fn() }, getState: () => ({ revision, content_id: `content-${revision}` }) } as unknown as OfficeController;
    const snapshot = { snapshot_id: "snapshot", document_id: "doc", revision: 4, content_id: "content-4", mime: "application/pdf" };
    const cancel = vi.fn();
    api.export.mockResolvedValue({ id: "export", cancel, completion: Promise.resolve(snapshot) });
    const job = await exportSheetPdf(c, [{ first: 1, last: 1 }]);
    revision = 5;
    expect(await job.completion).toBe(snapshot);
    expect(job.cancel).toBe(cancel);
    expect(api.export).toHaveBeenCalledWith("session", 4, "pdf", [{ first: 1, last: 1 }]);
    expect(c.document.readRange).not.toHaveBeenCalled();
  });
  it("wrong content identity released and refused", async () => {
    const c = { session_id: "session", document: { id: "doc" }, getState: () => ({ revision: 4, content_id: "current" }) } as unknown as OfficeController;
    api.export.mockResolvedValue({ id: "export", cancel: vi.fn(), completion: Promise.resolve({ snapshot_id: "wrong", document_id: "doc", revision: 4, content_id: "old", mime: "application/pdf" }) });
    const job = await exportSheetPdf(c, []);
    await expect(job.completion).rejects.toThrow("office_edit.changed");
    expect(api.release).toHaveBeenCalledWith("wrong");
  });
});
