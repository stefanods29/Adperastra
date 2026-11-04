import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentControllerContext } from "../documents/controller";
import type { DocumentHandle, DocumentInfo, DocumentState } from "../documents/types";
import type {
  OfficeItemPage, OfficeSessionState, OfficeTransaction, OfficeTransactionResult,
} from "../office/types";
import { acquireOfficeController, registerOfficeControllerFactory } from "../office/OfficeController";
import {
  captureOffice, closeOfficeEdit, discardOfficeSaved, officeItems, onOfficeState, openOfficeEdit,
  renderOffice, transactOffice, undoOffice,
} from "../services/officeEdit";
import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import { initialDocumentState } from "../documents/types";
import { registerDocumentControllerFactory } from "../documents/controller";

const acquireEditor = vi.fn();
vi.mock("../documents/DocumentRegistry", () => ({
  DocumentRegistry: { acquireEditor: (...args: unknown[]) => acquireEditor(...args) },
}));
vi.mock("../documents/controller", () => ({
  registerDocumentControllerFactory: vi.fn(),
}));
vi.mock("../services/exportSnapshots", () => ({
  releaseExportSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../services/officeEdit", () => ({
  openOfficeEdit: vi.fn(),
  closeOfficeEdit: vi.fn(async () => undefined),
  onOfficeState: vi.fn(async () => () => undefined),
  transactOffice: vi.fn(),
  undoOffice: vi.fn(),
  redoOffice: vi.fn(),
  setOfficeMode: vi.fn(),
  captureOffice: vi.fn(),
  exportOffice: vi.fn(),
  discardOfficeSaved: vi.fn(),
  officeItems: vi.fn(),
  officeFormatting: vi.fn(),
  renderOffice: vi.fn(),
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const contentId = "33333333-3333-4333-8333-333333333333";
const savedId = "44444444-4444-4444-8444-444444444444";
const nextId = "55555555-5555-4555-8555-555555555555";
const blockId = "66666666-6666-4666-8666-666666666666";

let documentCounter = 0;
function nextDocumentId(): string {
  documentCounter += 1;
  return `22222222-2222-4222-8222-${String(documentCounter).padStart(12, "0")}`;
}
let currentDocumentId = nextDocumentId();

function sessionState(overrides: Partial<OfficeSessionState> = {}): OfficeSessionState {
  return {
    session_id: sessionId,
    document_id: currentDocumentId,
    family: "document",
    format: "docx",
    revision: 1,
    saved_revision: 1,
    content_id: contentId,
    saved_content_id: savedId,
    ready: true,
    mode: "editing",
    dirty: true,
    can_undo: true,
    can_redo: false,
    capabilities: ["document_text", "save_existing"],
    selection: null,
    compatibility: {
      format: "docx", entries: [], next_cursor: null,
      can_preserve_unknown: true, blocks_save: false,
    },
    page_count: 1, sheet_count: 0, slide_count: 0, busy: false, status_key: null,
    ...overrides,
  };
}

function info(): DocumentInfo {
  return {
    document_id: currentDocumentId,
    source: { kind: "disk", path: "C:\\review\\document.docx" },
    name: "document.docx",
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 1024,
    modified_unix: 0,
    read_only: false,
    from_internet: false,
    sensitive: false,
  };
}

function cleanState(documentContentId = contentId): DocumentState {
  return { ...initialDocumentState(documentContentId), saved_content_id: savedId };
}

let documentState: DocumentState = cleanState();
const releases: Array<ReturnType<typeof vi.fn>> = [];
const handles: DocumentHandle[] = [];

function viewHandle(): DocumentHandle {
  const release = vi.fn();
  releases.push(release);
  handles.push({
    id: currentDocumentId,
    source: info().source,
    info: info(),
    getState: () => documentState,
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => { throw new Error("the contract captures through the engine"); },
    save: async () => false,
    saveCopy: async () => false,
    discard: async () => undefined,
    release,
  });
  return handles[handles.length - 1];
}
/** The registry returns one view reference per editor acquisition. */
function acquireMock(): DocumentHandle {
  const handle = handles[handles.length - 1];
  if (!handle) throw new Error("no view handle was created");
  return { ...handle };
}

function contextFor(): DocumentControllerContext {
  return {
    document_id: currentDocumentId,
    source: info().source,
    info: info(),
    initial_content_id: contentId,
    notifyContentChanged: vi.fn((id: string) => {
      documentState = {
        ...documentState,
        revision: documentState.revision + 1,
        content_id: id,
        dirty: id !== documentState.saved_content_id,
      };
      return documentState;
    }),
    notifyReady: vi.fn(),
  };
}

registerOfficeControllerFactory("office-word", "document");
const controllerFactory = vi.mocked(registerDocumentControllerFactory).mock.calls[0]?.[1];

interface ContractController {
  session_id: string;
  family: string;
  getState(): OfficeSessionState;
  transact(transaction: OfficeTransaction): Promise<OfficeTransactionResult>;
  undo(): Promise<OfficeTransactionResult>;
  capture(revision: number, contentId: string): Promise<{ revision: number; content_id: string }>;
  render(viewport: unknown): Promise<unknown>;
  items(kind: string, cursor?: string): Promise<unknown>;
  formatting(selection: unknown): Promise<unknown>;
  close(): Promise<void>;
  discardToSaved(savedContentId: string): Promise<void>;
  dispose(): Promise<void>;
}

const live: ContractController[] = [];

async function bindingFor(state: OfficeSessionState = sessionState()) {
  if (!controllerFactory) throw new Error("controller factory missing");
  documentState = cleanState(state.content_id);
  vi.mocked(openOfficeEdit).mockResolvedValue({
    id: "officeopen-test",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(state),
  });
  vi.mocked(onOfficeState).mockResolvedValue(() => undefined);
  const context = contextFor();
  const binding = (await controllerFactory(context)) as unknown as ContractController;
  return { binding, context };
}

async function acquired(): Promise<ContractController> {
  const { binding } = await bindingFor();
  live.push(binding);
  await acquireOfficeController(viewHandle(), "document");
  return binding;
}

function transaction(expected = 1, id = nextId): OfficeTransaction {
  return {
    transaction_id: id,
    expected_revision: expected,
    operations: [{
      family: "document",
      operation: { kind: "insert_text", position: { block_id: blockId, offset_utf16: 0 }, text: "a" },
    }],
    selection_after: null,
    label_key: "office.transaction",
  } as unknown as OfficeTransaction;
}

function changedResult(to: string, overrides: Partial<OfficeSessionState> = {}): OfficeTransactionResult {
  return {
    transaction_id: nextId,
    state: sessionState({ revision: 2, content_id: to, dirty: true, ...overrides }),
    changed: true,
    affected_ids: [],
    warnings: [],
  };
}

function snapshot(): ExportSnapshot {
  return {
    snapshot_id: "77777777-7777-4777-8777-777777777777",
    document_id: currentDocumentId,
    revision: 1,
    content_id: contentId,
    mime: info().mime,
    byte_len: 10,
    storage_policy: "ordinary",
    expires_unix: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDocumentId = nextDocumentId();
  documentState = cleanState();
  releases.length = 0;
  handles.length = 0;
  live.length = 0;
  vi.mocked(closeOfficeEdit).mockResolvedValue(undefined);
  vi.mocked(releaseExportSnapshot).mockResolvedValue(undefined);
  acquireEditor.mockImplementation(async () => acquireMock());
});

afterEach(async () => {
  for (const controller of live.splice(0)) {
    await controller.dispose().catch(() => undefined);
  }
});

describe("OfficeController contract", () => {
  it("never_advertises_save_existing", async () => {
    const { binding } = await bindingFor();
    live.push(binding);
    expect(binding.getState().capabilities).not.toContain("save_existing");
    expect(binding.getState().capabilities).toContain("document_text");
  });

  it("two_views_one_session", async () => {
    const { binding } = await bindingFor();
    live.push(binding);
    const first = await acquireOfficeController(viewHandle(), "document");
    const second = await acquireOfficeController(viewHandle(), "document");
    expect(first).toBe(second);
    expect(first).toBe(binding);
    expect(openOfficeEdit).toHaveBeenCalledTimes(1);
    expect(first.session_id).toBe(sessionId);
    expect(first.family).toBe("document");
  });

  it("missing_factory_fails_closed", async () => {
    await expect(acquireOfficeController(viewHandle(), "sheet")).rejects.toThrow("office_edit.engine_missing");
    expect(acquireEditor).not.toHaveBeenCalled();
  });

  it("close_one_view_retains_edits", async () => {
    const binding = await acquired();
    const firstHandle = viewHandle();
    const firstRelease = vi.mocked(firstHandle.release);
    const first = await acquireOfficeController(firstHandle, "document");
    const secondHandle = viewHandle();
    const secondRelease = vi.mocked(secondHandle.release);
    const second = await acquireOfficeController(secondHandle, "document");
    vi.mocked(transactOffice).mockResolvedValue(changedResult(nextId));
    await first.transact(transaction());
    await first.close();
    expect(second.getState()).toMatchObject({ revision: 2, content_id: nextId, dirty: true });
    expect(firstRelease.mock.calls.length + secondRelease.mock.calls.length).toBe(1);
    expect(closeOfficeEdit).not.toHaveBeenCalled();
    expect(binding.getState().revision).toBe(2);
  });

  it("duplicate_identical_transaction_one_mutation", async () => {
    const binding = await acquired();
    vi.mocked(transactOffice).mockResolvedValue(changedResult(nextId));
    const first = await binding.transact(transaction());
    const replay = await binding.transact(transaction(2, nextId));
    expect(first.changed).toBe(true);
    expect(replay.transaction_id).toBe(nextId);
    expect(replay.changed).toBe(true);
    expect(transactOffice).toHaveBeenCalledTimes(2);
    expect(binding.getState().revision).toBe(2);
  });

  it("reused_id_different_payload_invalid", async () => {
    const binding = await acquired();
    vi.mocked(transactOffice).mockResolvedValueOnce(changedResult(nextId));
    await binding.transact(transaction());
    vi.mocked(transactOffice).mockRejectedValueOnce(new Error("office_edit.invalid"));
    await expect(binding.transact(transaction(2, nextId))).rejects.toThrow("office_edit.invalid");
    expect(binding.getState().revision).toBe(2);
  });

  it("failed_operation_leaves_history_selection_revision", async () => {
    const { binding, context } = await bindingFor();
    live.push(binding);
    await acquireOfficeController(viewHandle(), "document");
    vi.mocked(transactOffice).mockRejectedValueOnce(new Error("office_edit.busy"));
    await expect(binding.transact(transaction())).rejects.toThrow("office_edit.busy");
    expect(binding.getState()).toMatchObject({
      revision: 1, content_id: contentId, can_undo: true, selection: null, status_key: null,
    });
    expect(binding.getState().ready).toBe(true);
    expect(context.notifyContentChanged).not.toHaveBeenCalled();
  });

  it("stale_revision_rejected_before_service", async () => {
    const binding = await acquired();
    await expect(binding.transact(transaction(7))).rejects.toThrow("office_edit.invalid");
    expect(transactOffice).not.toHaveBeenCalled();
  });

  it("revision_disagreement_fails_closed", async () => {
    const binding = await acquired();
    vi.mocked(transactOffice).mockResolvedValue(changedResult(nextId, { revision: 5 }));
    await expect(binding.transact(transaction())).rejects.toThrow("office_edit.changed");
    expect(binding.getState()).toMatchObject({ ready: false, mode: "viewing", can_undo: false });
  });

  it("save_capture_while_edit_remains_dirty", async () => {
    const binding = await acquired();
    vi.mocked(transactOffice).mockResolvedValue(changedResult(nextId));
    await binding.transact(transaction());
    const captured = { ...snapshot(), revision: 2, content_id: nextId };
    vi.mocked(captureOffice).mockResolvedValue({
      id: "officecap-test", cancel: vi.fn(async () => undefined), completion: Promise.resolve(captured),
    });
    const result = await binding.capture(2, nextId);
    expect(captureOffice).toHaveBeenCalledWith(sessionId, 2);
    expect(result).toMatchObject({ document_id: currentDocumentId, revision: 2, content_id: nextId });
    expect(binding.getState().dirty).toBe(true);
  });

  it("capture_requires_exact_identity", async () => {
    const binding = await acquired();
    vi.mocked(captureOffice).mockResolvedValue({
      id: "officecap-test", cancel: vi.fn(async () => undefined),
      completion: Promise.resolve({ ...snapshot(), content_id: nextId }),
    });
    await expect(binding.capture(1, contentId)).rejects.toThrow("office_edit.changed");
    expect(releaseExportSnapshot).toHaveBeenCalledTimes(1);
  });

  it("render_stale_identity_rejected", async () => {
    const binding = await acquired();
    vi.mocked(renderOffice).mockResolvedValue({
      id: "officerender-test", cancel: vi.fn(async () => undefined),
      completion: Promise.resolve({
        items: [{
          session_id: sessionId, view_revision: 1, page_id: "page-1",
          image: { lease_id: nextId, token: "t", name: "p", mime: "image/png", byte_len: 1, storage_policy: "ordinary" },
          rect: { x_pt: 0, y_pt: 0, width_pt: 10, height_pt: 10, rotation_deg: 0 },
          accessibility: [], next_cursor: null,
        }],
        next_cursor: null, complete: true, revision: 5,
      }),
    });
    await expect(binding.render({
      x_px: 0, y_px: 0, width_px: 800, height_px: 600,
      zoom_percent: 100, device_scale: 1, view_revision: 3,
    })).rejects.toThrow("office_edit.changed");
  });

  it("items_and_formatting_are_family_checked", async () => {
    const binding = await acquired();
    await expect(binding.items("sheets")).rejects.toThrow("office_edit.unsupported");
    await expect(binding.formatting({
      kind: "sheet", ranges: [], active: { sheet_id: nextId, row: 0, column: 0 },
    })).rejects.toThrow("office_edit.invalid");
    const comments: OfficeItemPage = {
      kind: "comments", items: [], next_cursor: null, complete: true, revision: 1,
    };
    vi.mocked(officeItems).mockResolvedValue(comments);
    await expect(binding.items("comments")).resolves.toBe(comments);
  });

  it("undo_uses_one_new_intent", async () => {
    const binding = await acquired();
    vi.mocked(undoOffice).mockImplementation(async (_session, _revision, transactionId) => ({
      ...changedResult(nextId, { can_undo: false, can_redo: true }),
      transaction_id: transactionId,
    }));
    const result = await binding.undo();
    expect(undoOffice).toHaveBeenCalledTimes(1);
    expect(result.transaction_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.state).toMatchObject({ revision: 2, can_undo: false, can_redo: true });
  });

  it("dispose_closes_session_and_every_view", async () => {
    const binding = await acquired();
    const before = releases.length;
    await acquireOfficeController(viewHandle(), "document");
    expect(releases.length).toBe(before + 1);
    await binding.dispose();
    expect(releases[before].mock.calls.length).toBe(1);
    expect(releases[before - 1].mock.calls.length).toBe(1);
    expect(closeOfficeEdit).toHaveBeenCalledTimes(1);
    await expect(binding.transact(transaction())).rejects.toThrow("office_edit.engine_missing");
  });
});

describe("OfficeController discard-to-saved", () => {
  it("discard_saved_is_one_typed_atomic_restore", async () => {
    const { binding, context } = await bindingFor();
    live.push(binding);
    await acquireOfficeController(viewHandle(), "document");
    vi.mocked(discardOfficeSaved).mockResolvedValue({
      state: sessionState({ revision: 1, content_id: savedId, dirty: false, can_undo: false, can_redo: false }),
      changed: true,
    });
    await binding.discardToSaved(savedId);
    expect(discardOfficeSaved).toHaveBeenCalledTimes(1);
    expect(discardOfficeSaved).toHaveBeenCalledWith(sessionId, savedId, 1, contentId);
    expect(binding.getState()).toMatchObject({ content_id: savedId, dirty: false, ready: true });
    expect(context.notifyContentChanged).not.toHaveBeenCalled();
  });

  it("already_saved_identity_does_not_call_native", async () => {
    const { binding } = await bindingFor(sessionState({ content_id: savedId, dirty: false }));
    live.push(binding);
    await acquireOfficeController(viewHandle(), "document");
    await binding.discardToSaved(savedId);
    expect(discardOfficeSaved).not.toHaveBeenCalled();
  });

  it("stale_or_foreign_restore_fails_closed", async () => {
    const binding = await acquired();
    vi.mocked(discardOfficeSaved).mockResolvedValue({
      state: sessionState({ revision: 1, content_id: blockId, saved_content_id: savedId, dirty: false }),
      changed: true,
    });
    await expect(binding.discardToSaved(savedId)).rejects.toThrow("office_edit.changed");
    expect(binding.getState().ready).toBe(false);
  });
});
