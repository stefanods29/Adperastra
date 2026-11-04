import { describe, expect, it, vi } from "vitest";
vi.mock("../services/exportSnapshots", () => ({
  authorizeSnapshotFile: vi.fn(async () => ({ document_id: "doc" })),
  uploadSnapshot: vi.fn(async (metadata) => ({ ...metadata, snapshot_id: "snap" })),
  releaseExportSnapshot: vi.fn(async () => {}),
  releaseSnapshotAuthority: vi.fn(async () => {}),
}));
import { createFileExportCapture } from "../convert/exportCapture";
import { releaseSnapshotAuthority, uploadSnapshot } from "../services/exportSnapshots";

describe("immutable editor export capture", () => {
  it("copies the current revision before asynchronous upload and retains authority for a live snapshot", async () => {
    const bytes = new Uint8Array([65, 66]);
    const capture = createFileExportCapture("granted-token", () => ({
      bytes, revision: 1, contentId: "content-one", mime: "text/plain",
    }));
    const pending = capture.capture();
    bytes[0] = 90;
    const snapshot = await pending;
    expect(uploadSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      revision: 1, content_id: "content-one",
    }), new Uint8Array([65, 66]));
    await capture.close();
    expect(releaseSnapshotAuthority).not.toHaveBeenCalled();
    await capture.dispose(snapshot.snapshot_id);
    expect(releaseSnapshotAuthority).toHaveBeenCalledWith("doc");
    await expect(capture.capture()).rejects.toThrow("snapshot.bad_request");
  });
});
