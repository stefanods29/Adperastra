import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const contentId = "44444444-4444-4444-8444-444444444444";

const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, _args?: unknown) => {
    if (command === "recovery_legacy_read") {
      return {
        record_id: "11111111-1111-4111-8111-111111111111",
        token: "a".repeat(32),
        name: "notes.txt",
        saved_unix: 1_700_000_000,
        file_modified_unix: 1_699_999_000,
      };
    }
    if (command === "recovery_legacy_count") return 1;
    return null;
  }),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/exportSnapshots", () => ({
  authorizeNewSnapshot: vi.fn(async () => ({
    document_id: "22222222-2222-4222-8222-222222222222",
    name: "notes.txt",
    mime: "text/plain",
  })),
  beginExportSnapshot: vi.fn(async () => ({
    snapshot_id: "33333333-3333-4333-8333-333333333333",
    upload_token: "b".repeat(32),
  })),
  appendExportSnapshot: vi.fn(async () => undefined),
  finishExportSnapshot: vi.fn(async () => ({
    snapshot_id: "33333333-3333-4333-8333-333333333333",
    document_id: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    content_id: "44444444-4444-4444-8444-444444444444",
    mime: "text/plain",
    byte_len: 5,
    storage_policy: "ordinary",
    expires_unix: 1_700_000_300,
  })),
  releaseExportSnapshot: vi.fn(async () => undefined),
  abortExportSnapshot: vi.fn(async () => undefined),
  releaseSnapshotAuthority: vi.fn(async () => undefined),
}));
vi.mock("../services/jobs", () => ({
  runJob: vi.fn(async (_prefix: string, start: (id: string) => Promise<void>) => {
    await start("recsave-1-1");
    return {
      id: "recsave-1-1",
      cancel: vi.fn(async () => undefined),
      completion: Promise.resolve({
        record_id: "11111111-1111-4111-8111-111111111111",
        captured_revision: 1,
      }),
    };
  }),
}));

import { deleteDraft, importLegacyRecovery, readDraft, writeDraft } from "../services/recovery";

beforeEach(() => {
  invoke.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("old recovery entrypoints are encrypted facades", () => {
  it("never calls a plaintext recovery command", async () => {
    await writeDraft("C:\\Work\\notes.txt", "hello", 1_699_999_000);
    await readDraft("C:\\Work\\notes.txt");
    await deleteDraft("C:\\Work\\notes.txt");
    const commands = invoke.mock.calls.map((call) => call[0]);
    expect(commands).not.toContain("recovery_write");
    expect(commands).not.toContain("recovery_read");
    expect(commands).not.toContain("recovery_delete");
  });

  it("writeDraft uploads one snapshot and saves through E1", async () => {
    await writeDraft("C:\\Work\\notes.txt", "hello", 1_699_999_000);
    const save = invoke.mock.calls.find((call) => call[0] === "recovery_save_start");
    expect(save).toBeDefined();
    const args = save?.[1] as { snapshotId: string; metadata: { document_id: string; content_id: string } };
    expect(args.snapshotId).toBe(snapshotId);
    expect(args.metadata.document_id).toBe(documentId);
    expect(args.metadata.content_id).toBe(contentId);
  });

  it("writeDraft releases the authority when the upload cannot start", async () => {
    const snapshots = await import("../services/exportSnapshots");
    vi.mocked(snapshots.beginExportSnapshot).mockRejectedValueOnce(
      new Error("snapshot.changed"),
    );
    vi.mocked(snapshots.releaseSnapshotAuthority).mockClear();
    await expect(writeDraft("C:\\Work\\notes.txt", "hello", 1)).rejects.toThrow(
      "snapshot.changed",
    );
    expect(snapshots.releaseSnapshotAuthority).toHaveBeenCalledWith(documentId);
    expect(snapshots.abortExportSnapshot).not.toHaveBeenCalled();
  });

  it("readDraft decodes bounded granted bytes into the old Draft", async () => {
    const draft = await readDraft("C:\\Work\\notes.txt");
    expect(draft).toEqual({
      schema_version: 1,
      path: "C:\\Work\\notes.txt",
      text: "hello",
      saved_unix: 1_700_000_000,
      file_modified_unix: 1_699_999_000,
    });
    expect(invoke).toHaveBeenCalledWith("recovery_legacy_read", { path: "C:\\Work\\notes.txt" });
  });

  it("deleteDraft discards exactly the resolved record", async () => {
    await deleteDraft("C:\\Work\\notes.txt");
    expect(invoke).toHaveBeenCalledWith("recovery_discard", { ids: [recordId] });
  });

  it("importLegacyRecovery starts the explicit encrypted import job", async () => {
    await importLegacyRecovery();
    expect(invoke).toHaveBeenCalledWith("recovery_legacy_import_start", {
      requestId: "recsave-1-1",
    });
  });
});
