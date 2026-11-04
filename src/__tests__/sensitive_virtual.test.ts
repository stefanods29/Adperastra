import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentProvider } from "../documents/types";

const entry = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  parent_id: null,
  name: "notes.txt",
  kind: "file" as const,
  mime: "text/plain",
  size: 5,
  modified_unix: 10,
  chunks: [],
  from_internet: false,
  hidden: false,
  system: false,
  read_only: false,
};

vi.mock("../services/lockedFolders", () => ({
  lockedEntryInfo: vi.fn(async () => entry),
  readLockedEntry: vi.fn(async (_session: string, _entry: string, offset: number, length: number) =>
    offset === 0 ? Uint8Array.from([104, 101, 108, 108, 111]).subarray(0, length) : new Uint8Array(length),
  ),
  releaseLockedEntry: vi.fn(async () => undefined),
  touchLockedSession: vi.fn(async () => undefined),
  persistLockedSnapshot: vi.fn(async (request: { content_id: string; session_id: string; entry_id: string }) => ({
    completion: Promise.resolve({
      session_id: request.session_id,
      entry_id: request.entry_id,
      container_revision: 1,
      captured_revision: 1,
      content_id: request.content_id,
      pending_id: "22222222-2222-4222-8222-222222222222",
      verified: true,
    }),
  })),
  saveLockedCopy: vi.fn(),
  lockFolder: vi.fn(),
  markLockedDirty: vi.fn(async () => undefined),
  listLockedRecovery: vi.fn(async () => []),
  chooseLockedRecovery: vi.fn(),
  listLockedEntries: vi.fn(),
  createLockedCopy: vi.fn(),
  unlockLockedFolder: vi.fn(),
  exportUnlockedCopy: vi.fn(),
  registerLockedModelPersister: vi.fn(),
}));

vi.mock("../services/exportSnapshots", () => ({
  beginExportSnapshot: vi.fn(async (metadata: { document_id: string; revision: number; content_id: string; byte_len: number }) => ({
    snapshot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    upload_token: "0123456789abcdef0123456789abcdef",
    metadata,
  })),
  appendExportSnapshot: vi.fn(async (_id: string, _token: string, _offset: number, _bytes: Uint8Array) => undefined),
  finishExportSnapshot: vi.fn(async () => ({
    snapshot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    document_id: entry.id,
    revision: 1,
    content_id: "123e4567-e89b-42d3-8456-426614174000",
    mime: "text/plain",
    byte_len: 5,
    storage_policy: "sensitive",
    expires_unix: 1,
  })),
  releaseExportSnapshot: vi.fn(async () => undefined),
  releaseSnapshotAuthority: vi.fn(async () => undefined),
}));

import { beginExportSnapshot, appendExportSnapshot } from "../services/exportSnapshots";
import { clearDocumentControllerFactories } from "../documents/controller";
import { clearDocumentClosePolicies } from "../documents/closePolicies";
import { readLockedEntry, releaseLockedEntry, touchLockedSession, persistLockedSnapshot } from "../services/lockedFolders";
import {
  __resetLockedProviderForTests,
  commitLockedBytes,
  loadLockedOriginal,
  lockedModelState,
  lockedOriginalForTests,
  registerLockedDocumentProvider,
  registerLockedSession,
  type LockedCloseChoice,
  registerLockedCloseChooser,
} from "../documents/LockedDocumentProvider";

const session = {
  session_id: "11111111-1111-4111-8111-111111111111",
  container_path: "C:\\Vault\\v.adplock",
  container_id: "33333333-3333-4333-8333-333333333333",
  revision: 1,
  entry_count: 1,
  dirty: false,
  state: "unlocked" as const,
  pending_recovery: false,
  can_save_existing: false as const,
  can_save_copy: true,
};

const source = {
  kind: "virtual" as const,
  provider: "locked" as const,
  container_path: session.container_path,
  entry_id: entry.id,
};

let provider!: DocumentProvider;

beforeEach(() => {
  clearDocumentControllerFactories();
  clearDocumentClosePolicies();
  __resetLockedProviderForTests();
  registerLockedSession(session);
  const registry = { register: (candidate: DocumentProvider) => { provider = candidate; } };
  registerLockedDocumentProvider(registry);
});

afterEach(() => {
  clearDocumentControllerFactories();
  clearDocumentClosePolicies();
  __resetLockedProviderForTests();
  vi.clearAllMocks();
});

describe("locked virtual documents", () => {
  it("read_range_returns_the_original_while_capture_uses_the_edited_bytes", async () => {
    const document = await provider.open(source);
    const original = await document.readRange(0, 5);
    expect(Array.from(original)).toEqual([104, 101, 108, 108, 111]);
    await commitLockedBytes(document.id, new TextEncoder().encode("edited"));
    const snapshot = await document.captureSnapshot();
    expect(snapshot.storage_policy).toBe("sensitive");
    const appended = vi.mocked(appendExportSnapshot).mock.calls.at(-1)?.[3];
    expect(new TextDecoder().decode(appended)).toBe("edited");
    const rangedAgain = await document.readRange(0, 5);
    expect(Array.from(rangedAgain)).toEqual([104, 101, 108, 108, 111]);
    expect(vi.mocked(readLockedEntry)).toHaveBeenCalled();
    expect(vi.mocked(beginExportSnapshot)).toHaveBeenCalled();
  });

  it("two_views_share_one_model_and_one_document_id", async () => {
    const first = await provider.open(source);
    const second = await provider.open(source);
    expect(first.id).toBe(second.id);
    await commitLockedBytes(first.id, new TextEncoder().encode("changed"));
    expect(second.getState().dirty).toBe(true);
    expect(second.getState().content_id).toBe(first.getState().content_id);
  });

  it("a_fake_path_is_never_used_and_no_disk_path_exists", async () => {
    const document = await provider.open(source);
    expect(document.source.kind).toBe("virtual");
    expect(document.info.disk_path).toBeUndefined();
    expect(document.info.sensitive).toBe(true);
    await document.readRange(0, 5);
    expect(vi.mocked(readLockedEntry)).toHaveBeenCalledWith(
      session.session_id,
      entry.id,
      0,
      5,
    );
  });

  it("the_last_release_cancels_reads_and_zeroizes_the_model", async () => {
    const document = await provider.open(source);
    await loadLockedOriginal(document.id);
    expect(lockedOriginalForTests(document.id)).not.toBeNull();
    document.release();
    expect(lockedOriginalForTests(document.id)).toBeNull();
    await expect(document.readRange(0, 5)).rejects.toThrow("locked.locked");
    expect(vi.mocked(releaseLockedEntry)).not.toHaveBeenCalled();
  });

  it("commit_touches_the_session_but_writes_no_ordinary_storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const document = await provider.open(source);
    await commitLockedBytes(document.id, new TextEncoder().encode("secret"));
    expect(vi.mocked(touchLockedSession)).toHaveBeenCalledWith(session.session_id);
    expect(setItem).not.toHaveBeenCalled();
    expect(lockedModelState(document.id)?.dirty).toBe(true);
    setItem.mockRestore();
  });

  it("the_close_policy_requires_a_verified_receipt_for_every_current_edit", async () => {
    const document = await provider.open(source);
    await commitLockedBytes(document.id, new TextEncoder().encode("secret"));
    let choice: LockedCloseChoice = { choice: "keep" };
    registerLockedCloseChooser(async () => choice);
    const { prepareDocumentClose } = await import("../documents/closePolicies");
    expect(await prepareDocumentClose([document], "tab")).toBe(true);
    choice = { choice: "keep" };
    vi.mocked(persistLockedSnapshot).mockImplementationOnce(async (request: import("../services/lockedFolders").LockedPersistRequest) => {
      await commitLockedBytes(document.id, new TextEncoder().encode("newer"));
      return {
        id: "job",
        cancel: async () => undefined,
        completion: Promise.resolve({
          session_id: request.session_id,
          entry_id: request.entry_id,
          container_revision: 1,
          captured_revision: 1,
          content_id: request.content_id,
          pending_id: "22222222-2222-4222-8222-222222222222",
          verified: true,
        }),
      };
    });
    expect(await prepareDocumentClose([document], "tab")).toBe(false);
  });
});
