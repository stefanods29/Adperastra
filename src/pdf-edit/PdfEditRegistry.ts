import type {
  DocumentControllerBinding,
  DocumentControllerContext,
} from "../documents/controller";
import {
  stateAfterContentChange,
  type DocumentInfo,
  type DocumentState,
} from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { deepFreezePdfEdit, createPdfEditModel, nextPdfContentId } from "./model";
import {
  assertPdfEditModel,
  applyPdfEditOperation,
  pushPdfEditHistory,
  runPdfEditOperations,
} from "./model";
import { serializePdfEdit } from "./serialize";
import {
  PDF_EDIT_MAX_SOURCE_BYTES,
  emptyPdfEditHistory,
  isPdfEditUuid,
  isSafeInteger,
  pdfEditError,
  validatePdfEditInspection,
  type PdfEditCapabilities,
  type PdfEditHistoryEntry,
  type PdfEditInspection,
  type PdfEditModel,
  type PdfEditOperation,
} from "./types";

/** Shared editable PDF controller (Step 14a E1/E2, `pdf-edit-1`).
 *
 * One controller exists per document id; every view shares it. Loading the
 * source inspection and serializing a capture both go through registered
 * trusted hosts, because PDF parsing and writing belong to the isolated
 * helper and the 08a snapshot authority. No source path is fabricated. */

export interface PdfEditDocument {
  readonly id: string;
  readonly info: DocumentInfo;
  getState(): DocumentState;
  subscribe(listener: (state: DocumentState) => void): () => void;
  captureSnapshot(): Promise<ExportSnapshot>;
}

/** Inspect one authorized source snapshot; implemented by the native host. */
export type PdfEditSourceLoader = (
  document: PdfEditDocument,
  snapshot: ExportSnapshot,
) => Promise<PdfEditInspection>;

let sourceLoader: PdfEditSourceLoader | null = null;

export function registerPdfEditSourceLoader(loader: PdfEditSourceLoader): void {
  if (sourceLoader !== null) throw pdfEditError("pdf_edit.unsupported");
  sourceLoader = loader;
}

export function resetPdfEditSourceLoaderForTests(): void {
  sourceLoader = null;
}

function assertCaptureState(state: DocumentState): void {
  if (!state.ready) throw pdfEditError("pdf_edit.changed");
  if (state.status_code === "documents.provider_missing" || state.status_code === "documents.changed") {
    throw pdfEditError("pdf_edit.changed");
  }
}

function assertEditable(state: DocumentState, info: DocumentInfo, capabilities: PdfEditCapabilities): void {
  assertCaptureState(state);
  if (state.read_only_reason || info.read_only) throw pdfEditError("pdf_edit.read_only");
  if (!state.editing_enabled) throw pdfEditError("pdf_edit.read_only");
  if (info.sensitive && !capabilities.sensitive_memory_only) throw pdfEditError("pdf_edit.read_only");
}

export class PdfEditController {
  private modelValue: PdfEditModel;
  private stateValue: DocumentState;
  private readonly listeners = new Set<(model: Readonly<PdfEditModel>) => void>();
  private readonly capabilitiesValue: PdfEditCapabilities;
  private readonly formOptionsValue: PdfEditInspection["form_options"];
  private contextValue: DocumentControllerContext | undefined;
  private readonly onDispose: (() => void) | undefined;
  private readonly unsubscribeDocument: () => void;
  private viewCount = 1;
  private disposed = false;
  private captureGeneration = 0;

  constructor(
    private readonly document: PdfEditDocument,
    model: PdfEditModel,
    capabilities: PdfEditCapabilities,
    context?: DocumentControllerContext,
    onDispose?: () => void,
    viewCount = 1,
    formOptions: PdfEditInspection["form_options"] = [],
  ) {
    this.modelValue = model;
    this.stateValue = document.getState();
    this.capabilitiesValue = capabilities;
    this.formOptionsValue = formOptions;
    this.contextValue = context;
    this.onDispose = onDispose;
    this.viewCount = viewCount;
    this.unsubscribeDocument = document.subscribe((state) => {
      this.stateValue = state;
    });
    context?.notifyReady({
      editing_enabled: this.stateValue.editing_enabled,
      can_save_existing: this.stateValue.can_save_existing,
      can_save_copy: this.stateValue.can_save_copy,
    });
  }

  get documentId(): string {
    return this.document.id;
  }

  getModel(): Readonly<PdfEditModel> {
    return this.modelValue;
  }

  getCapabilities(): Readonly<PdfEditCapabilities> {
    return this.capabilitiesValue;
  }

  getFormOptions(): Readonly<PdfEditInspection["form_options"]> {
    return this.formOptionsValue;
  }

  getDocumentState(): DocumentState {
    return this.stateValue;
  }

  subscribe(listener: (model: Readonly<PdfEditModel>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  retain(): void {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    this.viewCount += 1;
  }

  release(): void {
    if (this.disposed) return;
    this.viewCount -= 1;
    if (this.viewCount > 0) return;
    this.disposed = true;
    this.listeners.clear();
    this.unsubscribeDocument();
    this.onDispose?.();
  }

  /** Attach the 09a controller context after a view acquired the controller.
   * A controller created from a bare DocumentHandle has no context yet. */
  attachContext(context: DocumentControllerContext): void {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    this.contextValue = context;
    context.notifyReady({
      editing_enabled: this.stateValue.editing_enabled,
      can_save_existing: this.stateValue.can_save_existing,
      can_save_copy: this.stateValue.can_save_copy,
    });
  }

  setEditingEnabled(enabled: boolean): void {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    this.stateValue = { ...this.stateValue, editing_enabled: enabled };
    this.contextValue?.notifyReady({
      editing_enabled: enabled,
      can_save_existing: this.stateValue.can_save_existing,
      can_save_copy: this.stateValue.can_save_copy,
    });
  }

  async apply(operation: PdfEditOperation): Promise<void> {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    assertEditable(this.stateValue, this.document.info, this.capabilitiesValue);
    if (operation.kind === "set_form") {
      // XFA and rich-text fields stay read-only even if a caller bypasses the
      // form panel: writing them would require flattening or dropping data.
      if (this.capabilitiesValue.xfa_present) throw pdfEditError("pdf_edit.unsupported");
      if (this.capabilitiesValue.rich_text_fields.includes(operation.field_id)) {
        throw pdfEditError("pdf_edit.unsupported");
      }
    }
    const beforeContentId = this.modelValue.content_id;
    const afterContentId = nextPdfContentId();
    const applied = applyPdfEditOperation(this.modelValue, operation, afterContentId);
    const entry: PdfEditHistoryEntry = {
      applied: operation,
      inverse: applied.inverse,
      before_content_id: beforeContentId,
      after_content_id: afterContentId,
      bytes: 0,
    };
    const next = pushPdfEditHistory(applied.model, entry);
    this.commit(next, afterContentId);
  }

  async undo(): Promise<void> {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    const history = this.modelValue.history;
    if (history.cursor <= 0) return;
    assertEditable(this.stateValue, this.document.info, this.capabilitiesValue);
    const entry = history.entries[history.cursor - 1];
    const replayed = runPdfEditOperations(this.modelValue, entry.inverse);
    const next = deepFreezePdfEdit({
      ...replayed,
      content_id: entry.before_content_id,
      history: { ...history, cursor: history.cursor - 1 },
    });
    this.commit(next, entry.before_content_id);
  }

  async redo(): Promise<void> {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    const history = this.modelValue.history;
    if (history.cursor >= history.entries.length) return;
    assertEditable(this.stateValue, this.document.info, this.capabilitiesValue);
    const entry = history.entries[history.cursor];
    const replayed = runPdfEditOperations(this.modelValue, [entry.applied]);
    const next = deepFreezePdfEdit({
      ...replayed,
      content_id: entry.after_content_id,
      history: { ...history, cursor: history.cursor + 1 },
    });
    this.commit(next, entry.after_content_id);
  }

  /** Freeze the requested revision/content tuple before the host encodes it.
   * A newer edit during encoding never changes the returned snapshot. */
  async capture(revision: number, contentId: string): Promise<ExportSnapshot> {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    assertCaptureState(this.stateValue);
    if (!isSafeInteger(revision, 1) || !isPdfEditUuid(contentId)) throw pdfEditError("pdf_edit.bad_request");
    if (contentId !== this.modelValue.content_id) throw pdfEditError("pdf_edit.changed");
    const generation = ++this.captureGeneration;
    const captured = this.modelValue;
    const snapshot = await serializePdfEdit(captured, revision, contentId);
    if (this.disposed || generation !== this.captureGeneration) throw pdfEditError("pdf_edit.changed");
    return snapshot;
  }

  /** Drop every unsaved change and return to the saved content identity.
   * This never reloads the source and never writes a file. */
  async discardToSaved(savedContentId: string): Promise<void> {
    if (this.disposed) throw pdfEditError("pdf_edit.changed");
    if (!isPdfEditUuid(savedContentId)) throw pdfEditError("pdf_edit.bad_request");
    if (savedContentId === this.modelValue.content_id) return;
    let current = this.modelValue;
    let cursor = current.history.cursor;
    while (cursor > 0 && current.content_id !== savedContentId) {
      const entry = current.history.entries[cursor - 1];
      const replayed = runPdfEditOperations(current, entry.inverse);
      current = deepFreezePdfEdit({
        ...replayed,
        content_id: entry.before_content_id,
        history: { ...current.history, cursor: cursor - 1 },
      });
      cursor -= 1;
    }
    if (current.content_id !== savedContentId) throw pdfEditError("pdf_edit.changed");
    const reset = deepFreezePdfEdit({
      ...current,
      content_id: savedContentId,
      history: emptyPdfEditHistory(),
    });
    this.commit(reset, savedContentId);
  }

  asDocumentControllerBinding(): DocumentControllerBinding {
    return {
      handler_id: "pdf",
      capture: (revision, contentId) => this.capture(revision, contentId),
      discardToSaved: (savedContentId) => this.discardToSaved(savedContentId),
      setEditingEnabled: async (enabled) => this.setEditingEnabled(enabled),
      dispose: async () => this.release(),
    };
  }

  private commit(next: PdfEditModel, contentId: string): void {
    // Validate before touching the live model: a rejected transition must
    // leave the previous immutable model intact for every view.
    assertPdfEditModel(next);
    const frozen = deepFreezePdfEdit(next);
    this.modelValue = frozen;
    this.stateValue = this.contextValue
      ? this.contextValue.notifyContentChanged(contentId)
      : stateAfterContentChange(this.stateValue, contentId);
    for (const listener of this.listeners) listener(frozen);
  }
}

export class PdfEditRegistry {
  private readonly controllers = new Map<string, PdfEditController>();
  private readonly loading = new Map<string, Promise<PdfEditController>>();
  private readonly generations = new Map<string, number>();

  async acquirePdfEditor(document: PdfEditDocument, context?: DocumentControllerContext): Promise<PdfEditController> {
    if (!isPdfEditUuid(document.id)) throw pdfEditError("pdf_edit.bad_request");
    const existing = this.controllers.get(document.id);
    if (existing) {
      existing.retain();
      return existing;
    }
    const pending = this.loading.get(document.id);
    if (pending) {
      const controller = await pending;
      controller.retain();
      return controller;
    }
    const generation = (this.generations.get(document.id) ?? 0) + 1;
    this.generations.set(document.id, generation);
    const promise = this.load(document, context, generation);
    this.loading.set(document.id, promise);
    try {
      const controller = await promise;
      this.controllers.set(document.id, controller);
      return controller;
    } finally {
      this.loading.delete(document.id);
    }
  }

  get(documentId: string): PdfEditController | null {
    return this.controllers.get(documentId) ?? null;
  }

  /** Invalidate an in-flight load (for example a closed view). */
  invalidate(documentId: string): void {
    this.generations.set(documentId, (this.generations.get(documentId) ?? 0) + 1);
  }

  /** Test helper: forget every controller and pending load. */
  resetForTests(): void {
    this.controllers.clear();
    this.loading.clear();
    this.generations.clear();
  }

  private async load(
    document: PdfEditDocument,
    context: DocumentControllerContext | undefined,
    generation: number,
  ): Promise<PdfEditController> {
    const loader = sourceLoader;
    if (!loader) throw pdfEditError("pdf_edit.unsupported");
    const state = document.getState();
    if (state.status_code === "documents.provider_missing" || state.status_code === "documents.changed") {
      throw pdfEditError("pdf_edit.changed");
    }
    const snapshot = await document.captureSnapshot();
    if (snapshot.document_id !== document.id) throw pdfEditError("pdf_edit.changed");
    // The source MIME is descriptive; the document presenter already proved
    // this is a PDF. The capture authority registers application/pdf as the
    // capture MIME, so never reject a valid PDF because its origin encoder
    // called it application/octet-stream.
    if (!isSafeInteger(snapshot.byte_len, 1, PDF_EDIT_MAX_SOURCE_BYTES)) throw pdfEditError("pdf_edit.too_large");
    const inspection = validatePdfEditInspection(await loader(document, snapshot));
    if (!inspection) throw pdfEditError("pdf_edit.bad_request");
    if (this.generations.get(document.id) !== generation) throw pdfEditError("pdf_edit.changed");
    const contentId = context?.initial_content_id ?? state.content_id;
    if (!isPdfEditUuid(contentId)) throw pdfEditError("pdf_edit.bad_request");
    const model = createPdfEditModel({
      document_id: document.id,
      content_id: contentId,
      pages: inspection.pages,
      annotations: inspection.annotations,
      forms: inspection.forms,
      source_snapshot: snapshot,
    });
    return new PdfEditController(
      document,
      model,
      inspection.capabilities,
      context,
      () => {
        this.controllers.delete(document.id);
      },
      1,
      inspection.form_options,
    );
  }
}

export const pdfEditRegistry = new PdfEditRegistry();

/** Build one 09a controller binding for an already acquired document. The
 * coordinator calls this from the editable PDF handler once the DocumentHandle
 * exists; see `handoff/step-14a/README.md` for the 09a context gap. */
export async function createPdfEditDocumentBinding(
  document: PdfEditDocument,
  context?: DocumentControllerContext,
): Promise<DocumentControllerBinding> {
  const controller = await pdfEditRegistry.acquirePdfEditor(document, context);
  if (context) controller.attachContext(context);
  return controller.asDocumentControllerBinding();
}
