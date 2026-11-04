import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentHandle, DocumentState } from "../documents/types";
import {
  MAX_RECORD_BYTES,
  RecoveryCaptureRegistry,
  registerRecoveryHandlerId,
  unregisterRecoveryHandlerId,
} from "../documents/recoveryScheduler";
import type { ExportSnapshot } from "../services/exportSnapshots";

const INFO = {
  document_id: "doc-1",
  source: { kind: "disk", path: "C:\\Work\\notes.txt" },
  name: "notes.txt",
  ext: "txt",
  mime: "text/plain",
  size: 10,
  modified_unix: 1_700_000_000,
  read_only: false,
  from_internet: false,
  sensitive: false,
  disk_path: "C:\\Work\\notes.txt",
};

function snapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    snapshot_id: crypto.randomUUID(),
    document_id: "doc-1",
    revision: 2,
    content_id: crypto.randomUUID(),
    mime: "text/plain",
    byte_len: 10,
    storage_policy: "ordinary",
    expires_unix: 1_700_000_300,
    ...overrides,
  } as ExportSnapshot;
}

function fakeDocument(
  initial: Partial<DocumentState> = {},
  sensitive = false,
  capture?: () => Promise<ExportSnapshot>,
) {
  let state: DocumentState = {
    revision: 2,
    saved_revision: 1,
    content_id: crypto.randomUUID(),
    saved_content_id: "saved-content",
    dirty: true,
    ready: true,
    editing_enabled: true,
    can_save_existing: true,
    can_save_copy: true,
    ...initial,
  };
  const listeners = new Set<(next: DocumentState) => void>();
  const captures: ExportSnapshot[] = [];
  const info = { ...INFO, sensitive };
  const handler: DocumentHandle = {
    id: "doc-1",
    source: info.source as DocumentHandle["source"],
    info: info as DocumentHandle["info"],
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => {
      const next = capture ? await capture() : snapshot();
      captures.push(next);
      return next;
    },
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  } as DocumentHandle;
  const update = (patch: Partial<DocumentState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  return { handler, update, captures, info };
}

let clock = 1_000_000;
interface TestDeps {
  upload: import("vitest").Mock<(snapshot: ExportSnapshot, metadata: import("../services/recovery").RecoveryMetadata) => Promise<unknown>>;
  release: import("vitest").Mock<(snapshotId: string) => Promise<unknown>>;
  now: () => number;
  handlerIdFor: () => string | undefined;
}
const deps = (): TestDeps => ({
  upload: vi.fn(async (_snapshot: ExportSnapshot, _metadata: unknown) => undefined),
  release: vi.fn(async (_snapshotId: string) => undefined),
  now: () => clock,
  handlerIdFor: () => "text",
});
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};
const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  registerRecoveryHandlerId("doc-1", "text");
});
afterEach(() => {
  vi.useRealTimers();
  unregisterRecoveryHandlerId("doc-1");
});

describe("recovery capture scheduling", () => {
  it("captures once for two views of the same document", async () => {
    const { handler, update } = fakeDocument();
    const injected = deps();
    const registry = new RecoveryCaptureRegistry(injected);
    const releaseA = registry.acquire(handler, { enabled: true, interval_seconds: 10 }, () => undefined);
    const releaseB = registry.acquire(handler, { enabled: true, interval_seconds: 10 }, () => undefined);
    expect(registry.size).toBe(1);
    update({ content_id: crypto.randomUUID(), dirty: true });
    await advance(2_100);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);
    releaseA();
    expect(registry.size).toBe(1);
    releaseB();
    expect(registry.size).toBe(0);
  });

  it("keeps snapshot R even when the document changes before the upload ends", async () => {
    const { handler, update, captures } = fakeDocument();
    let finish: (() => void) | null = null;
    const injected = deps();
    injected.upload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(handler, { enabled: true, interval_seconds: 10 }, () => undefined);
    update({ content_id: crypto.randomUUID(), dirty: true });
    await advance(2_100);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);
    const used = injected.upload.mock.calls[0];
    const captured = captures[0];
    expect(used[0]).toBe(captured);
    expect(used[1].content_id).toBe(captured.content_id);
    update({ content_id: crypto.randomUUID(), revision: 3, dirty: true });
    (finish as (() => void) | null)?.();
    await flush();
    expect(injected.upload.mock.calls[0][0]).toBe(captured);
    release();
  });

  it("debounces edits for two seconds and waits ten seconds between captures", async () => {
    const { handler, update } = fakeDocument();
    const injected = deps();
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(handler, { enabled: true, interval_seconds: 10 }, () => undefined);
    update({ content_id: crypto.randomUUID() });
    await advance(1_000);
    update({ content_id: crypto.randomUUID() });
    await advance(1_000);
    update({ content_id: crypto.randomUUID() });
    await advance(1_999);
    expect(injected.upload).not.toHaveBeenCalled();
    await advance(2);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);

    update({ content_id: crypto.randomUUID() });
    await advance(2_100);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);
    await advance(8_000);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(2);
    release();
  });

  it("does not rewrite a clean or already captured content identity", async () => {
    const { handler, update } = fakeDocument();
    const injected = deps();
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(handler, { enabled: true, interval_seconds: 10 }, () => undefined);
    update({ dirty: false, content_id: crypto.randomUUID() });
    await advance(3_000);
    await flush();
    expect(injected.upload).not.toHaveBeenCalled();

    update({ dirty: true, content_id: crypto.randomUUID() });
    await advance(10_100);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);
    const capturedId = (injected.upload.mock.calls[0][1] as { content_id: string }).content_id;
    update({ dirty: false, content_id: capturedId });
    await advance(20_000);
    await flush();
    expect(injected.upload).toHaveBeenCalledTimes(1);
    release();
  });

  it("refuses a sensitive source with a visible warning", async () => {
    const { handler, update } = fakeDocument({ dirty: true }, true);
    const injected = deps();
    const warnings: string[] = [];
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(
      handler,
      { enabled: true, interval_seconds: 10 },
      (code) => warnings.push(code),
    );
    update({ content_id: crypto.randomUUID() });
    await advance(3_000);
    await flush();
    expect(injected.upload).not.toHaveBeenCalled();
    expect(warnings).toContain("recovery.sensitive");
    release();
  });

  it("shows a cap warning instead of pretending to autosave", async () => {
    const { handler, update } = fakeDocument({}, false, async () =>
      snapshot({ byte_len: MAX_RECORD_BYTES + 1 }),
    );
    const injected = deps();
    const warnings: string[] = [];
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(
      handler,
      { enabled: true, interval_seconds: 10 },
      (code) => warnings.push(code),
    );
    update({ content_id: crypto.randomUUID() });
    await advance(2_100);
    await flush();
    expect(injected.upload).not.toHaveBeenCalled();
    expect(warnings).toContain("recovery.too_large");
    release();
  });

  it("warns when the controller has no registered recovery handler", async () => {
    const { handler, update } = fakeDocument();
    const injected = deps();
    injected.handlerIdFor = () => undefined;
    const warnings: string[] = [];
    const registry = new RecoveryCaptureRegistry(injected);
    const release = registry.acquire(
      handler,
      { enabled: true, interval_seconds: 10 },
      (code) => warnings.push(code),
    );
    update({ content_id: crypto.randomUUID() });
    await advance(2_100);
    await flush();
    expect(injected.upload).not.toHaveBeenCalled();
    expect(warnings).toContain("recovery.unsupported");
    release();
  });
});
