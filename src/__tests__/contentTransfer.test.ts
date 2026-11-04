import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransfer, getTransfer, releaseTransfer } from "../services/contentTransfer";
import type { TransferEnvelope } from "../transfer/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const DOCUMENT_ID = "0f2f6a8e-7b1c-4d3a-9e5f-1a2b3c4d5e6f";
const TRANSFER_ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function envelope(): TransferEnvelope {
  return {
    transfer_id: TRANSFER_ID,
    source_document_id: DOCUMENT_ID,
    sensitive: false,
    payload: { kind: "text", text: "alpha" },
    expires_unix: 1_800_000_000,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("content transfer service", () => {
  it("creates a validated frozen transfer", async () => {
    invokeMock.mockImplementation(async () => envelope());
    const result = await createTransfer(DOCUMENT_ID, { kind: "text", text: "alpha" });
    expect(invokeMock).toHaveBeenCalledWith("transfer_create", {
      sourceDocumentId: DOCUMENT_ID,
      payload: { kind: "text", text: "alpha" },
    });
    expect(result).toEqual(envelope());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
  });

  it("rejects invalid payloads and source ids before invoking", async () => {
    await expect(
      createTransfer(DOCUMENT_ID, { kind: "text", text: 7 } as never),
    ).rejects.toThrow("transfer.invalid");
    await expect(
      createTransfer("not-a-uuid", { kind: "text", text: "alpha" }),
    ).rejects.toThrow("transfer.invalid");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("gets and releases a transfer idempotently", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "transfer_get" ? envelope() : undefined,
    );
    const first = await getTransfer(TRANSFER_ID);
    expect(first.transfer_id).toBe(TRANSFER_ID);
    await releaseTransfer(TRANSFER_ID);
    await releaseTransfer(TRANSFER_ID);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "transfer_get",
      "transfer_release",
      "transfer_release",
    ]);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "transfer_release", {
      transferId: TRANSFER_ID,
    });
  });

  it("rejects a malformed token without invoking", async () => {
    await expect(getTransfer("forged")).rejects.toThrow("transfer.invalid");
    await expect(releaseTransfer("forged")).rejects.toThrow("transfer.invalid");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("passes native error codes through unchanged", async () => {
    invokeMock.mockRejectedValue(new Error("transfer.expired"));
    await expect(getTransfer(TRANSFER_ID)).rejects.toThrow("transfer.expired");
  });
});
