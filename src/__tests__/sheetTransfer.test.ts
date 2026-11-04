import { describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import type { TransferEnvelope } from "../transfer/types";
import { sheetTransferTarget } from "../office/sheet/sheetTransfer";
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../services/contentTransfer", () => ({ getTransfer: api.get }));
vi.mock("../office/officeCompatibility", () => ({ canOfficeCommand: () => ({ enabled: true, reason_key: null }) }));
function controller() {
  return {
    document: { id: "target", info: { sensitive: false } },
    getState: () => ({ revision: 3, selection: { kind: "sheet", active: { sheet_id: "sheet", row: 2, column: 3 } } }),
    transact: vi.fn().mockResolvedValue({ transaction_id: "intent", state: { revision: 4 } }),
  } as unknown as OfficeController;
}
function envelope(payload: TransferEnvelope["payload"]): TransferEnvelope {
  return { transfer_id: "lease", sensitive: false, expires_unix: 123, payload };
}
describe("sheet transfer", () => {
  it("formula-like cell text inert; one target transaction", async () => {
    const transfer = envelope({ kind: "cells", rows: [[{ kind: "text", text: "=WEBSERVICE(\"https://example.com\")" }]], row_count: 1, column_count: 1 });
    api.get.mockResolvedValue(transfer);
    const c = controller();
    const receipt = await sheetTransferTarget(c).accept(transfer, "insert_cells");
    expect(c.transact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(c.transact).mock.calls[0][0].operations).toEqual([{
      family: "sheet", operation: { kind: "set_cells", range: { sheet_id: "sheet", first_row: 2, last_row: 2, first_column: 3, last_column: 3 },
        values: [[{ kind: "text", text: "=WEBSERVICE(\"https://example.com\")" }]], mode: "values" },
    }]);
    expect(receipt).toMatchObject({ complete: true, inserted_count: 1, revision: 4 });
  });
  it("paste 100001 cells rejected before transaction", async () => {
    const transfer = envelope({ kind: "cells", rows: [], row_count: 100_001, column_count: 1 });
    api.get.mockResolvedValue(transfer);
    const c = controller();
    await expect(sheetTransferTarget(c).accept(transfer, "insert_cells")).rejects.toThrow("transfer.too_large");
    expect(c.transact).not.toHaveBeenCalled();
  });
  it("forged ordinary envelope cannot downgrade native sensitive classification", async () => {
    const transfer = envelope({ kind: "text", text: "private" });
    api.get.mockResolvedValue({ ...transfer, sensitive: true });
    const c = controller();
    await expect(sheetTransferTarget(c).accept(transfer, "insert_text")).rejects.toThrow("transfer.unsupported");
    expect(c.transact).not.toHaveBeenCalled();
  });
  it("plain multiline text is one text cell", async () => {
    const transfer = envelope({ kind: "text", text: "a\tb\nc\td" });
    api.get.mockResolvedValue(transfer); const c = controller();
    await sheetTransferTarget(c).accept(transfer, "insert_text");
    const operation = vi.mocked(c.transact).mock.calls[0][0].operations[0];
    expect(operation).toMatchObject({ operation: { values: [[{ kind: "text", text: "a\tb\nc\td" }]] } });
  });
});
