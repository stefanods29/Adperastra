import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import type { TransferEnvelope } from "../transfer/types";
import { documentTransferTarget } from "../office/document/documentTransfer";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("../services/contentTransfer", () => ({ getTransfer: lookup }));
vi.mock("../office/document/documentController", () => ({
  canDocumentMutate: (state: { mode: string }) => ({ enabled: state.mode === "editing" }),
}));

function fixture() {
  const position = { block_id: "00000000-0000-4000-8000-000000000001", offset_utf16: 0 };
  const state = { revision: 1, content_id: "c", document_id: "doc", mode: "editing",
    selection: { kind: "document", page: 1, span: { anchor: position, focus: position, revision: 1 } } };
  const transact = vi.fn(async (_transaction: unknown) => ({ transaction_id: "actual", changed: true, state: { revision: 2, document_id: "doc" } }));
  const controller = { getState: () => state, document: { id: "doc", info: { sensitive: false } }, transact } as unknown as OfficeController;
  const envelope = { transfer_id: "native", sensitive: false, payload: { kind: "text", text: "=1+1" } } as TransferEnvelope;
  lookup.mockResolvedValue(envelope);
  return { state, transact, envelope, target: documentTransferTarget(controller) };
}
beforeEach(() => vi.clearAllMocks());
describe("document transfer", () => {
  it("formula-likeinert and actual receipt", async () => {
    const f = fixture(); const receipt = await f.target.accept(f.envelope, "insert_text");
    expect(f.transact).toHaveBeenCalledTimes(1);
    expect(f.transact.mock.calls[0][0]).toMatchObject({ expected_revision: 1, operations: [
      { family: "document", operation: { kind: "insert_text", text: "=1+1" } },
    ] });
    expect(receipt).toEqual({ transaction_id: "actual", target_document_id: "doc", revision: 2,
      inserted_count: 4, losses: [], complete: true });
  });
  it("description does not mutate; protected target has no actions", () => {
    const f = fixture(); expect(f.target.describe(f.envelope)).toHaveLength(1);
    expect(f.transact).not.toHaveBeenCalled(); f.state.mode = "viewing";
    expect(f.target.describe(f.envelope)).toEqual([]);
  });
  it("cancelled or expired transfer makes zero target mutations", async () => {
    const f = fixture(); lookup.mockRejectedValue(new Error("transfer.expired"));
    await expect(f.target.accept(f.envelope, "insert_text")).rejects.toThrow("transfer.expired");
    expect(f.transact).not.toHaveBeenCalled();
  });
  it("changed revision during lookup refuses insertion", async () => {
    const f = fixture(); lookup.mockImplementationOnce(async () => { f.state.revision++; return f.envelope; });
    await expect(f.target.accept(f.envelope, "insert_text")).rejects.toThrow("office_edit.changed");
    expect(f.transact).not.toHaveBeenCalled();
  });
  it("sensitive payload is not offered to an ordinary target", () => {
    const f = fixture(); expect(f.target.describe({ ...f.envelope, sensitive: true })).toEqual([]);
  });
});
