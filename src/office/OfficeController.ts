import { DocumentRegistry } from "../documents/DocumentRegistry";
import {
  registerDocumentControllerFactory,
  type DocumentControllerBinding,
  type DocumentControllerContext,
} from "../documents/controller";
import type { DocumentHandle } from "../documents/types";
import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import type { PageRange } from "../convert/types";
import {
  captureOffice, closeOfficeEdit, discardOfficeSaved, exportOffice, officeFormatting,
  officeItems, onOfficeState, openOfficeEdit, redoOffice, renderOffice, setOfficeMode,
  transactOffice, undoOffice,
} from "../services/officeEdit";
import type {
  OfficeExportFormat, OfficeFamily, OfficeFormatting, OfficeItemKind, OfficeItemPage,
  OfficeRenderPage, OfficeResultPage, OfficeSelection, OfficeSessionState,
  OfficeTransaction, OfficeTransactionResult, OfficeViewport,
} from "./types";

/** One engine-neutral editing controller per document (20a E8, office-edit-1).
 * It owns no parser, renderer or engine process: typed intents go to the
 * Office service and any disagreement between the native session and the
 * document, or between the two public revisions, fails closed. `save_existing`
 * is never advertised; capture/export are immutable leases; `close` releases
 * one caller reference, `dispose` closes the native session and every lease. */
export interface OfficeController {
  readonly session_id: string;
  readonly document: DocumentHandle;
  readonly family: OfficeFamily;
  /** Registered 09a handler id this controller was created for. */
  readonly handler_id?: string;
  getState(): OfficeSessionState;
  subscribe(listener: (state: OfficeSessionState) => void): () => void;
  transact(transaction: OfficeTransaction): Promise<OfficeTransactionResult>;
  undo(): Promise<OfficeTransactionResult>;
  redo(): Promise<OfficeTransactionResult>;
  /** Freeze exactly the supplied immutable revision/content identity (E5). */
  capture(capturedRevision: number, contentId: string): Promise<ExportSnapshot>;
  /** Independent PDF/image export lease; never a source publication. */
  export(expectedRevision: number, format: OfficeExportFormat, ranges: readonly PageRange[]): Promise<OfficeExportLease>;
  render(viewport: OfficeViewport): Promise<OfficeRenderLease>;
  items(kind: OfficeItemKind, cursor?: string): Promise<OfficeItemPage>;
  formatting(selection: OfficeSelection): Promise<OfficeFormatting>;
  close(): Promise<void>;
  /** 09a members; called by DocumentRegistry, never by a view. */
  discardToSaved(savedContentId: string): Promise<void>;
  setEditingEnabled(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

/** The immutable identity a lease was frozen at. */
export interface OfficeRevision {
  readonly revision: number;
  readonly content_id: string;
}

/** Rendered pages plus the view revision they answer; release their image
 * leases with `releaseOfficeLease` on unmount. */
export interface OfficeRenderLease extends OfficeRevision {
  readonly session_id: string;
  readonly view_revision: number;
  readonly pages: OfficeRenderPage[];
}

/** One E5 snapshot with the identity it froze (`origin` capture | export). */
export interface OfficeExportLease extends OfficeRevision {
  readonly session_id: string;
  readonly origin: "capture" | "export";
  readonly format: string;
  readonly snapshot: ExportSnapshot;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function safeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Canonical lower-case hyphenated UUID for one new intent. */
function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function withoutSaveExisting(state: OfficeSessionState): OfficeSessionState {
  if (!Array.isArray(state.capabilities)) throw new Error("office_edit.invalid");
  return { ...state, capabilities: state.capabilities.filter((entry) => entry !== "save_existing") };
}

function itemFamily(kind: OfficeItemKind): OfficeFamily {
  if (kind === "sheets" || kind === "charts" || kind === "pivots") return "sheet";
  if (kind === "slides" || kind === "masters") return "deck";
  return "document";
}

function validState(state: OfficeSessionState, documentId: string, family: OfficeFamily): boolean {
  return Boolean(
    state && typeof state === "object" &&
    uuid(state.session_id) && state.document_id === documentId &&
    state.family === family && uuid(state.content_id) && uuid(state.saved_content_id) &&
    safeRevision(state.revision) && Number.isSafeInteger(state.saved_revision) &&
    Array.isArray(state.capabilities),
  );
}

class OfficeControllerImpl implements OfficeController, DocumentControllerBinding {
  readonly session_id: string;
  readonly family: OfficeFamily;
  readonly handler_id: string;
  private stateValue: OfficeSessionState;
  private documentHandle: DocumentHandle | null = null;
  private leases: DocumentHandle[] = [];
  private listeners = new Set<(state: OfficeSessionState) => void>();
  private unlisten: (() => void) | null = null;
  private disposed = false;
  private failed = false;

  constructor(
    private readonly context: DocumentControllerContext,
    handlerId: string,
    family: OfficeFamily,
    initial: OfficeSessionState,
  ) {
    this.handler_id = handlerId;
    this.family = family;
    this.session_id = initial.session_id;
    this.stateValue = withoutSaveExisting(initial);
  }

  get document(): DocumentHandle {
    if (!this.documentHandle) throw new Error("office_edit.engine_missing");
    return this.documentHandle;
  }

  getState(): OfficeSessionState {
    return this.stateValue;
  }

  subscribe(listener: (state: OfficeSessionState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Attach one caller reference: the handle `acquireOfficeController` just
   * acquired from DocumentRegistry. The first reference must agree with the
   * native session; disagreement fails closed before any edit is shown. */
  attach(handle: DocumentHandle): void {
    this.requireUsable();
    if (!this.documentHandle) {
      const document = handle.getState();
      if (document.revision !== this.stateValue.revision ||
          document.content_id !== this.stateValue.content_id) {
        this.failClosed();
        throw new Error("office_edit.changed");
      }
      this.documentHandle = handle;
      this.syncReady(this.stateValue);
    }
    this.leases.push(handle);
  }

  /** Drop exactly the caller reference; edits and history stay owned by the
   * registry until its last view releases the document. */
  async close(): Promise<void> {
    const handle = this.leases.pop();
    if (handle) handle.release();
  }

  async transact(transaction: OfficeTransaction): Promise<OfficeTransactionResult> {
    this.requireUsable();
    if (!transaction || !uuid(transaction.transaction_id) ||
        !safeRevision(transaction.expected_revision) ||
        transaction.expected_revision !== this.stateValue.revision ||
        !Array.isArray(transaction.operations) || transaction.operations.length === 0) {
      throw new Error("office_edit.invalid");
    }
    const result = await transactOffice(this.session_id, transaction);
    return this.acceptTransaction(result, transaction.transaction_id, transaction.expected_revision);
  }

  async undo(): Promise<OfficeTransactionResult> {
    return this.history(undoOffice);
  }

  async redo(): Promise<OfficeTransactionResult> {
    return this.history(redoOffice);
  }

  private async history(
    step: (sessionId: string, expectedRevision: number, transactionId: string) => Promise<OfficeTransactionResult>,
  ): Promise<OfficeTransactionResult> {
    this.requireUsable();
    const expected = this.stateValue.revision;
    const transactionId = newUuid();
    return this.acceptTransaction(await step(this.session_id, expected, transactionId), transactionId, expected);
  }

  async capture(capturedRevision: number, contentId: string): Promise<ExportSnapshot> {
    this.requireUsable();
    if (!safeRevision(capturedRevision) || !uuid(contentId)) throw new Error("office_edit.invalid");
    const job = await captureOffice(this.session_id, capturedRevision);
    return this.lease(await job.completion, capturedRevision, contentId);
  }

  async export(
    expectedRevision: number,
    format: OfficeExportFormat,
    ranges: readonly PageRange[],
  ): Promise<OfficeExportLease> {
    this.requireUsable();
    if (!safeRevision(expectedRevision) || expectedRevision !== this.stateValue.revision ||
        (format !== "pdf" && format !== "png" && format !== "jpeg") ||
        !Array.isArray(ranges) || ranges.length === 0) {
      throw new Error("office_edit.invalid");
    }
    const contentId = this.stateValue.content_id;
    const job = await exportOffice(this.session_id, expectedRevision, format, [...ranges]);
    const snapshot = await this.lease(await job.completion, expectedRevision, contentId);
    return {
      session_id: this.session_id, origin: "export", format, revision: expectedRevision,
      content_id: contentId, snapshot,
    };
  }

  /** Validate one E5 result against the frozen identity before it is used.
   * The request revision/content tuple is authoritative, never live state. */
  private async lease(
    snapshot: ExportSnapshot, revision: number, contentId: string,
  ): Promise<ExportSnapshot> {
    const reject = async (code: string) => {
      if (snapshot && typeof snapshot.snapshot_id === "string") {
        await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
      }
      throw new Error(code);
    };
    if (!snapshot || typeof snapshot !== "object") throw new Error("office_edit.invalid");
    if (snapshot.document_id !== this.context.document_id ||
        snapshot.revision !== revision || snapshot.content_id !== contentId) {
      await reject("office_edit.changed");
    }
    if (this.context.info.sensitive && snapshot.storage_policy !== "sensitive") {
      await reject("office_edit.sensitive_unsupported");
    }
    return snapshot;
  }

  async render(viewport: OfficeViewport): Promise<OfficeRenderLease> {
    this.requireUsable();
    if (!viewport || typeof viewport !== "object" ||
        !Number.isSafeInteger(viewport.view_revision) || viewport.view_revision < 0) {
      throw new Error("office_edit.invalid");
    }
    const revision = this.stateValue.revision;
    const contentId = this.stateValue.content_id;
    const job = await renderOffice(this.session_id, viewport);
    const page: OfficeResultPage<OfficeRenderPage> = await job.completion;
    if (!page || !Array.isArray(page.items)) throw new Error("office_edit.invalid");
    if (page.revision !== revision || this.stateValue.revision !== revision ||
        this.stateValue.content_id !== contentId ||
        page.items.some((item) => !item || item.session_id !== this.session_id)) {
      throw new Error("office_edit.changed");
    }
    return {
      session_id: this.session_id, view_revision: viewport.view_revision,
      revision, content_id: contentId, pages: page.items,
    };
  }

  async items(kind: OfficeItemKind, cursor?: string): Promise<OfficeItemPage> {
    this.requireUsable();
    if (itemFamily(kind) !== this.family) throw new Error("office_edit.unsupported");
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0)) {
      throw new Error("office_edit.invalid");
    }
    return officeItems(this.session_id, kind, cursor);
  }

  async formatting(selection: OfficeSelection): Promise<OfficeFormatting> {
    this.requireUsable();
    if (!selection || typeof selection !== "object" || selection.kind !== this.family) {
      throw new Error("office_edit.invalid");
    }
    if (selection.kind === "document" &&
        (!safeRevision(selection.span?.revision) ||
         selection.span.revision !== this.stateValue.revision)) {
      throw new Error("office_edit.changed");
    }
    return officeFormatting(this.session_id, selection);
  }

  /** Restore the engine's saved content identity atomically (09a discard).
   *
   * Current content id/public revision are sent with the saved id so a stale
   * view cannot discard a newer model. This is not an Undo loop, creates no
   * Undo entry, writes no file and keeps the public revision unchanged. */
  async discardToSaved(savedContentId: string): Promise<void> {
    this.requireUsable();
    if (!uuid(savedContentId)) throw new Error("office_edit.invalid");
    const expected = this.stateValue;
    if (savedContentId === expected.content_id && savedContentId === expected.saved_content_id) {
      if (expected.dirty) this.publish({ ...expected, dirty: false });
      return;
    }
    const result = await discardOfficeSaved(this.session_id, savedContentId, expected.revision, expected.content_id);
    if (!result || typeof result.changed !== "boolean" || !result.changed) this.failChanged();
    const next = withoutSaveExisting(result.state);
    this.assertState(next);
    if (next.revision !== expected.revision || next.saved_revision !== expected.saved_revision ||
        next.content_id !== savedContentId || next.saved_content_id !== savedContentId || next.dirty) {
      this.failChanged();
    }
    this.publish(next);
  }

  async setEditingEnabled(enabled: boolean): Promise<void> {
    this.requireUsable();
    const next = withoutSaveExisting(await setOfficeMode(this.session_id, enabled ? "editing" : "viewing"));
    this.assertState(next);
    this.publish(next);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.unlisten) this.unlisten();
    this.unlisten = null;
    this.listeners.clear();
    if (controllers.get(this.context.document_id) === this) controllers.delete(this.context.document_id);
    for (const handle of this.leases.splice(0)) {
      try { handle.release(); } catch { /* the registry already released it */ }
    }
    this.documentHandle = null;
    await closeOfficeEdit(this.session_id).catch(() => undefined);
  }

  /** Install the additive state-event listener; called once after open. */
  async listen(): Promise<void> {
    this.unlisten = await onOfficeState((state) => this.receive(state));
  }

  private requireUsable(): void {
    if (this.disposed) throw new Error("office_edit.engine_missing");
    if (this.failed) throw new Error("office_edit.changed");
  }

  private assertState(state: OfficeSessionState): void {
    if (!state || state.session_id !== this.session_id ||
        state.document_id !== this.context.document_id || state.family !== this.family) {
      this.failChanged();
    }
  }

  private failChanged(): never {
    this.failClosed();
    throw new Error("office_edit.changed");
  }

  private canSaveCopy(state: OfficeSessionState): boolean {
    return state.capabilities.includes("save_copy") && !state.compatibility.blocks_save;
  }

  private syncReady(state: OfficeSessionState): void {
    this.context.notifyReady({
      editing_enabled: state.mode !== "viewing",
      can_save_existing: false,
      can_save_copy: this.canSaveCopy(state),
    });
  }

  private acceptTransaction(
    result: OfficeTransactionResult,
    transactionId: string,
    expectedRevision: number,
  ): OfficeTransactionResult {
    if (!result || result.transaction_id !== transactionId) this.failChanged();
    const next = withoutSaveExisting(result.state);
    this.assertState(next);
    if (result.changed && next.revision === expectedRevision) {
      // Identical duplicate transaction: the retained original receipt is
      // replayed with the same revision and identity, so no new Undo entry.
      if (next.content_id !== this.stateValue.content_id) this.failChanged();
      this.publish(next);
      return { ...result, state: next };
    }
    if (result.changed) {
      const document = this.document.getState();
      if (document.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
        this.failChanged();
      }
      let after;
      try {
        after = this.context.notifyContentChanged(next.content_id);
      } catch {
        this.failChanged();
      }
      if (after.revision !== next.revision || after.content_id !== next.content_id) this.failChanged();
    } else if (next.revision !== expectedRevision) {
      this.failChanged();
    }
    this.publish(next);
    return { ...result, state: next };
  }

  private receive(state: OfficeSessionState): void {
    if (this.disposed || this.failed || !state || typeof state !== "object") return;
    if (state.session_id !== this.session_id || state.document_id !== this.context.document_id ||
        state.family !== this.family) return;
    if (!safeRevision(state.revision) || state.revision < this.stateValue.revision) return;
    const next = withoutSaveExisting(state);
    this.publish(next);
  }

  private publish(state: OfficeSessionState): void {
    const previous = this.stateValue;
    this.stateValue = state;
    if (state.mode !== previous.mode || this.canSaveCopy(state) !== this.canSaveCopy(previous)) {
      this.syncReady(state);
    }
    for (const listener of this.listeners) listener(state);
  }

  private failClosed(): void {
    this.failed = true;
    this.stateValue = {
      ...this.stateValue,
      ready: false,
      busy: false,
      mode: "viewing",
      can_undo: false,
      can_redo: false,
      status_key: "office_edit.changed",
    };
    this.context.notifyReady({ editing_enabled: false, can_save_existing: false, can_save_copy: false });
    for (const listener of this.listeners) listener(this.stateValue);
  }
}

const handlers = new Map<OfficeFamily, string>();
const controllers = new Map<string, OfficeControllerImpl>();

async function createController(
  context: DocumentControllerContext,
  handlerId: string,
  family: OfficeFamily,
): Promise<OfficeControllerImpl> {
  const job = await openOfficeEdit(context.document_id, family);
  const initial = await job.completion;
  if (!validState(initial, context.document_id, family)) {
    if (initial && uuid(initial.session_id)) {
      await closeOfficeEdit(initial.session_id).catch(() => undefined);
    }
    throw new Error("office_edit.invalid");
  }
  const controller = new OfficeControllerImpl(context, handlerId, family, initial);
  try {
    await controller.listen();
  } catch (error) {
    await controller.dispose();
    throw error;
  }
  return controller;
}

/** Trusted static registration through 09a: one handler per family; a second
 * handler for a family is a conflict, the same handler twice is a no-op. */
export function registerOfficeControllerFactory(handlerId: string, family: OfficeFamily): void {
  if (!handlerId) throw new Error("documents.editor_conflict");
  const existing = handlers.get(family);
  if (existing) {
    if (existing === handlerId) return;
    throw new Error("documents.editor_conflict");
  }
  handlers.set(family, handlerId);
  registerDocumentControllerFactory(handlerId, async (context) => {
    const controller = await createController(context, handlerId, family);
    controllers.set(context.document_id, controller);
    return controller;
  });
}

/** Acquire one caller reference to the registry-owned controller. */
export async function acquireOfficeController(
  document: DocumentHandle,
  family: OfficeFamily,
): Promise<OfficeController> {
  const handlerId = handlers.get(family);
  if (!handlerId) throw new Error("office_edit.engine_missing");
  const handle = await DocumentRegistry.acquireEditor(document.source, handlerId);
  const controller = controllers.get(handle.id);
  if (!controller) {
    handle.release();
    throw new Error("office_edit.engine_missing");
  }
  try {
    controller.attach(handle);
  } catch (error) {
    handle.release();
    throw error;
  }
  return controller;
}
