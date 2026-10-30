import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { executeFileAction, runFileJob, setRetainedTransfers, type OpReport } from "../services/fileops";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
const invokeMock = vi.mocked(invoke);
const report = (extra: Partial<OpReport> = {}): OpReport => ({
  completed: [], skipped: [], cancelled: false, created: [], replaced: [], transfer_id: null, ...extra,
});
const poll = (value: OpReport) => ({ done: true, report: value, error: null,
  progress: { items_done: 1, items_total: 1, bytes_done: 0, bytes_total: 0, current: "" } });

beforeEach(() => { invokeMock.mockReset(); setRetainedTransfers([]); });

describe("executing history actions", () => {
  it("throws when an Undo job skips an item instead of reporting success", async () => {
    invokeMock.mockImplementation(async (command) => command === "file_op_poll"
      ? poll(report({ skipped: [{ path: "C:\\source.txt", reason: "in_use" }] })) : undefined);
    await expect(executeFileAction({ type: "transfer", id: "op-original", reverse: true }))
      .rejects.toThrow("ops.in_use");
  });

  it("throws when an Undo job is cancelled", async () => {
    invokeMock.mockImplementation(async (command) => command === "file_op_poll"
      ? poll(report({ cancelled: true })) : undefined);
    await expect(executeFileAction({ type: "recycle", paths: ["C:\\copy.txt"] }))
      .rejects.toThrow("ops.cancelled");
  });

  it("retries only the system job that needed confirmation inside a sequence", async () => {
    let recycleAttempts = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "file_op_start") {
        const request = (args as { request: { kind: string; allow_system: boolean } }).request;
        if (request.kind === "recycle" && ++recycleAttempts === 1) throw new Error("ops.system_confirmation_required");
      }
      return command === "file_op_poll" ? poll(report()) : undefined;
    });
    const confirm = vi.fn(async () => true);
    await executeFileAction({ type: "sequence", actions: [
      { type: "copy", sources: ["C:\\a.txt"], destDir: "D:\\out", conflict: "keepBoth" },
      { type: "recycle", paths: ["C:\\system.txt"] },
    ] }, confirm);
    const requests = invokeMock.mock.calls.filter(([command]) => command === "file_op_start")
      .map(([, args]) => (args as { request: { kind: string; allow_system: boolean } }).request);
    expect(requests.map((request) => [request.kind, request.allow_system]))
      .toEqual([["copy", false], ["recycle", false], ["recycle", true]]);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("leaves a declined system job unexecuted", async () => {
    invokeMock.mockRejectedValue(new Error("ops.system_confirmation_required"));
    await expect(executeFileAction({ type: "transfer", id: "op-original", reverse: true }, async () => false))
      .rejects.toThrow("ops.cancelled");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("sends opaque history IDs rather than a folder's file effects", async () => {
    setRetainedTransfers([{ labelKey: "toast.moved",
      undo: { type: "transfer", id: "op-original", reverse: true },
      redo: { type: "sequence", actions: [{ type: "transfer", id: "op-original", reverse: false }] },
    }]);
    invokeMock.mockImplementation(async (command) => command === "file_op_poll" ? poll(report()) : undefined);
    await executeFileAction({ type: "transfer", id: "op-original", reverse: true });
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ request: { kind: "transfer", sources: [],
      transfer_id: "op-original", reverse: true, retained_transfers: ["op-original"] } });
    expect(invokeMock.mock.calls[0][1]).not.toHaveProperty("request.transfer");
  });

  it("retains a just-finished job while an Undo group is still pending", async () => {
    invokeMock.mockImplementation(async (command) => command === "file_op_poll"
      ? poll(report({ transfer_id: "op-pending" })) : undefined);
    await runFileJob("copy", ["C:\\a.txt"], { destDir: "D:\\out" });
    await runFileJob("copy", ["C:\\b.txt"], { destDir: "D:\\out" });
    const starts = invokeMock.mock.calls.filter(([command]) => command === "file_op_start");
    expect(starts[1][1]).toMatchObject({ request: { retained_transfers: ["op-pending"] } });
  });
});
