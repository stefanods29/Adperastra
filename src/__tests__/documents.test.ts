import { describe, expect, it, vi } from "vitest";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import {
  clearDocumentClosePolicies,
  prepareDocumentClose,
  registerDocumentClosePolicy,
  registerGenericDocumentCloseDecider,
} from "../documents/closePolicies";
import {
  clearDocumentControllerFactories,
  registerDocumentControllerFactory,
  type DocumentControllerBinding,
} from "../documents/controller";
import {
  initialDocumentState,
  stateAfterContentChange,
  stateAfterSave,
  type DocumentHandle,
  type DocumentInfo,
  type DocumentRef,
  type DocumentState,
} from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { releaseExportSnapshot } from "../services/exportSnapshots";
import { startDocumentCommit } from "../services/documents";

vi.mock("../services/documents", () => ({
  openDocumentSource: vi.fn(async (source: DocumentRef) => ({
    document_id: "123e4567-e89b-12d3-a456-426614174000",
    info: {
      document_id: "123e4567-e89b-12d3-a456-426614174000",
      source,
      name: "note.txt",
      ext: "txt",
      mime: "text/plain",
      size: 5,
      modified_unix: 1,
      read_only: false,
      from_internet: false,
      sensitive: false,
      disk_path: source.kind === "disk" ? source.path : undefined,
    } satisfies DocumentInfo,
    token: "a".repeat(32),
  })),
  releaseDocumentSource: vi.fn(async () => undefined),
  readDocumentRange: vi.fn(async () => new Uint8Array([104, 105])),
  startDocumentCommit: vi.fn(async () => ({
    id: "job-1",
    cancel: async () => undefined,
    completion: Promise.resolve({
      saved_revision: 1,
      content_id: "123e4567-e89b-12d3-a456-426614174001",
      new_source: undefined,
      output_path: "C:\\docs\\copy.txt",
      mode: "copy",
    }),
  })),
  beginDocumentSnapshot: vi.fn(),
}));

vi.mock("../services/exportSnapshots", () => ({
  beginExportSnapshot: vi.fn(async () => ({ snapshot_id: "snap-1", upload_token: "b".repeat(32) })),
  appendExportSnapshot: vi.fn(async () => undefined),
  finishExportSnapshot: vi.fn(async (snapshotId: string): Promise<ExportSnapshot> => ({
    snapshot_id: snapshotId,
    document_id: "123e4567-e89b-12d3-a456-426614174000",
    revision: 1,
    content_id: "123e4567-e89b-12d3-a456-426614174001",
    mime: "text/plain",
    byte_len: 2,
    storage_policy: "ordinary",
    expires_unix: 9999999999,
  })),
  releaseExportSnapshot: vi.fn(async () => undefined),
  releaseSnapshotAuthority: vi.fn(async () => undefined),
}));

const disk: DocumentRef = { kind: "disk", path: "C:\\docs\\note.txt" };

function fakeHandle(overrides: Partial<DocumentHandle> & { state: DocumentState }): DocumentHandle {
  let state = overrides.state;
  return {
    id: overrides.id ?? "doc-1",
    source: overrides.source ?? disk,
    info: overrides.info ?? ({
      document_id: "doc-1",
      source: disk,
      name: "note.txt",
      ext: "txt",
      mime: "text/plain",
      size: 1,
      modified_unix: 1,
      read_only: false,
      from_internet: false,
      sensitive: false,
    }),
    getState: () => state,
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => {
      throw new Error("not used");
    },
    save: overrides.save ?? (async () => true),
    saveCopy: overrides.saveCopy ?? (async () => true),
    discard: async () => {
      state = { ...state, dirty: false, content_id: state.saved_content_id };
    },
    release: () => undefined,
  };
}

describe("shared revision and lifetime registry (T2)", () => {
  it("initial_revision_one_and_clean", () => {
    const state = initialDocumentState("content-1");
    expect(state.revision).toBe(1);
    expect(state.saved_revision).toBe(1);
    expect(state.dirty).toBe(false);
  });

  it("two_acquires_one_source_one_document", async () => {
    const first = await DocumentRegistry.acquire(disk);
    const second = await DocumentRegistry.acquire({ kind: "disk", path: "c:\\DOCS\\NOTE.TXT" });
    expect(second.id).toBe(first.id);
    first.release();
    // One view remains: the document is still there.
    expect(DocumentRegistry.get(first.id)).not.toBeNull();
    second.release();
    expect(DocumentRegistry.get(first.id)).toBeNull();
  });

  it("absent_locked_provider_fails_explicitly", async () => {
    await expect(
      DocumentRegistry.acquire({
        kind: "virtual",
        provider: "locked",
        container_path: "C:\\vault.adplock",
        entry_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).rejects.toThrow("documents.provider_missing");
  });

  it("snapshot_revision_1_unchanged_after_edit_2", () => {
    let state = initialDocumentState("content-1");
    const snapshotRevision = state.revision;
    state = stateAfterContentChange(state, "content-2");
    expect(state.revision).toBe(2);
    expect(snapshotRevision).toBe(1);
    // Saving revision 1 later only moves the saved markers.
    const saved = stateAfterSave(state, 1, "content-1");
    expect(saved.saved_revision).toBe(1);
    expect(saved.content_id).toBe("content-2");
    expect(saved.dirty).toBe(true);
    // Undo back to the saved content is clean again.
    const undone = stateAfterContentChange(state, "content-1");
    expect(undone.dirty).toBe(false);
  });

  it("same_editable_model_reused_and_incompatible_factory_refused", async () => {
    clearDocumentControllerFactories();
    let calls = 0;
    const binding: DocumentControllerBinding = {
      handler_id: "text",
      capture: async (revision, content_id) => ({
        snapshot_id: "snap-x",
        document_id: "doc-x",
        revision,
        content_id,
        mime: "text/plain",
        byte_len: 1,
        storage_policy: "ordinary",
        expires_unix: 1,
      }),
      discardToSaved: async () => undefined,
      setEditingEnabled: async () => undefined,
      dispose: async () => undefined,
    };
    registerDocumentControllerFactory("text", async () => {
      calls += 1;
      return binding;
    });
    const path: DocumentRef = { kind: "disk", path: "C:\\docs\\shared.txt" };
    const first = await DocumentRegistry.acquireEditor(path, "text");
    const second = await DocumentRegistry.acquireEditor(path, "text");
    expect(calls).toBe(1);
    await expect(DocumentRegistry.acquireEditor(path, "hex")).rejects.toThrow("documents.editor_conflict");
    first.release();
    second.release();
    clearDocumentControllerFactories();
  });
});

describe("atomic close preparation (E11)", () => {
  it("duplicate_provider_close_policy_refused", () => {
    clearDocumentClosePolicies();
    const policy = { prepareClose: async () => true };
    registerDocumentClosePolicy("locked", policy);
    expect(() => registerDocumentClosePolicy("locked", policy)).toThrow();
    clearDocumentClosePolicies();
  });

  it("closing_one_of_two_views_never_calls_policy", async () => {
    clearDocumentClosePolicies();
    const prepareClose = vi.fn(async () => true);
    registerDocumentClosePolicy("locked", { prepareClose });
    // The host only passes documents whose last view would close; with a
    // second view open the document is not in the plan at all.
    const plan: DocumentHandle[] = [];
    await expect(prepareDocumentClose(plan, "tab")).resolves.toBe(true);
    expect(prepareClose).not.toHaveBeenCalled();
    clearDocumentClosePolicies();
  });

  it("locked_policy_cancel_keeps_all_group_tabs_and_models", async () => {
    clearDocumentClosePolicies();
    registerDocumentClosePolicy("locked", { prepareClose: async () => false });
    const locked = fakeHandle({
      id: "locked-doc",
      source: { kind: "virtual", provider: "locked", container_path: "C:\\v", entry_id: "123e4567-e89b-12d3-a456-426614174000" },
      state: { ...initialDocumentState("c1"), dirty: true },
    });
    await expect(prepareDocumentClose([locked], "group")).resolves.toBe(false);
    expect(locked.getState().dirty).toBe(true);
    clearDocumentClosePolicies();
  });

  it("content_changed_after_prepare_requires_new_policy", async () => {
    clearDocumentClosePolicies();
    let state: DocumentState = { ...initialDocumentState("c1"), dirty: true };
    const handle = fakeHandle({ state });
    handle.getState = () => state;
    registerGenericDocumentCloseDecider(async () => {
      state = stateAfterContentChange(state, "c2");
      return true;
    });
    await expect(prepareDocumentClose([handle], "tab")).resolves.toBe(false);
    clearDocumentClosePolicies();
  });

  it("last_release_disposes_without_discard_to_saved", async () => {
    clearDocumentControllerFactories();
    const discardToSaved = vi.fn(async () => undefined);
    const dispose = vi.fn(async () => undefined);
    registerDocumentControllerFactory("text", async () => ({
      handler_id: "text",
      capture: async () => {
        throw new Error("not used");
      },
      discardToSaved,
      setEditingEnabled: async () => undefined,
      dispose,
    }));
    const doc = await DocumentRegistry.acquireEditor({ kind: "disk", path: "C:\\docs\\dispose.txt" }, "text");
    doc.release();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalled();
    expect(discardToSaved).not.toHaveBeenCalled();
    clearDocumentControllerFactories();
  });

  it("closing_one_of_two_views_never_discards_shared_edits", async () => {
    clearDocumentControllerFactories();
    const discardToSaved = vi.fn(async () => undefined);
    registerDocumentControllerFactory("text", async () => ({
      handler_id: "text",
      capture: async () => {
        throw new Error("not used");
      },
      discardToSaved,
      setEditingEnabled: async () => undefined,
      dispose: async () => undefined,
    }));
    const path: DocumentRef = { kind: "disk", path: "C:\\docs\\shared-discard.txt" };
    const first = await DocumentRegistry.acquireEditor(path, "text");
    const second = await DocumentRegistry.acquireEditor(path, "text");
    // The first view closes while the second still shows the model.
    await first.discard();
    expect(discardToSaved).not.toHaveBeenCalled();
    first.release();
    // Only the last view may discard the shared model.
    await second.discard();
    expect(discardToSaved).toHaveBeenCalledTimes(1);
    second.release();
    clearDocumentControllerFactories();
  });

  it("provider_save_copy_uses_the_provider_rule", async () => {
    const saveCopy = vi.fn(async () => true);
    const source: DocumentRef = { kind: "draft", draft_id: "123e4567-e89b-12d3-a456-426614174010" };
    DocumentRegistry.register({
      id: "draft",
      supports: (ref) => ref.kind === "draft",
      open: async () =>
        fakeHandle({
          id: "draft-doc",
          source,
          state: initialDocumentState("draft-content"),
          saveCopy,
        }),
    });
    const handle = await DocumentRegistry.acquire(source);
    await expect(handle.saveCopy("C:\\out\\copy.txt")).resolves.toBe(true);
    expect(saveCopy).toHaveBeenCalledWith("C:\\out\\copy.txt");
    handle.release();
  });

  it("publishes the frozen office copy and releases it without cleaning newer edits", async () => {
    clearDocumentControllerFactories();
    let change!: (contentId: string) => DocumentState;
    let complete!: (snapshot: ExportSnapshot) => void;
    const capture = vi.fn(() => new Promise<ExportSnapshot>((resolve) => { complete = resolve; }));
    registerDocumentControllerFactory("office-word", async (context) => {
      change = context.notifyContentChanged;
      context.notifyReady({ editing_enabled: true, can_save_existing: false, can_save_copy: true });
      return {
        handler_id: "office-word", capture,
        discardToSaved: async () => undefined,
        setEditingEnabled: async () => undefined,
        dispose: async () => undefined,
      };
    });
    const doc = await DocumentRegistry.acquireEditor({ kind: "disk", path: "C:\\docs\\fixture.docx" }, "office-word");
    try {
      const frozen = change("first-edit");
      const operation = doc.saveCopy("C:\\docs\\fixture-copy.docx");
      const newer = change("second-edit");
      expect(capture).toHaveBeenCalledWith(frozen.revision, frozen.content_id);
      complete({
        snapshot_id: "office-frozen-copy", document_id: doc.id,
        revision: frozen.revision, content_id: frozen.content_id,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byte_len: 5, storage_policy: "ordinary", expires_unix: 9999999999,
      });
      await expect(operation).resolves.toBe(true);
      expect(startDocumentCommit).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: "copy", snapshot_id: "office-frozen-copy",
        captured_revision: frozen.revision, content_id: frozen.content_id,
      }));
      expect(doc.getState()).toEqual(newer);
      expect(doc.getState().dirty).toBe(true);
      expect(releaseExportSnapshot).toHaveBeenCalledWith("office-frozen-copy");
    } finally {
      doc.release();
      clearDocumentControllerFactories();
    }
  });
});
