/**
 * Shared timeline document controller (Step 19a E1/E2).
 *
 * One controller per open `.adtimeline` document is installed through the 09a
 * document controller factory, so two views of one project share one model and
 * one history. The controller keeps a bounded project in memory, serializes it
 * only through the 08a snapshot upload path when `capture` is asked, and never
 * writes the source file itself. Project JSON is at most 16 MiB; no grant,
 * token, password or media byte is part of it.
 */

import {
  DocumentRegistry,
} from "../documents/DocumentRegistry";
import {
  registerDocumentControllerFactory,
  type DocumentControllerBinding,
  type DocumentControllerContext,
} from "../documents/controller";
import type { DocumentHandle, DocumentState } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  appendExportSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
  releaseExportSnapshot,
} from "../services/exportSnapshots";
import type { TimelineOperation, TimelineProject } from "./types";
import {
  TIMELINE_HANDLER_ID,
  TIMELINE_MAX_PROJECT_BYTES,
  TIMELINE_MIME,
  TimelineError,
  newUuid,
} from "./types";
import {
  cloneProject,
  decodeTimelineFile,
  encodeTimelineProject,
  freezeProject,
  validateTimelineProject,
} from "./projectValidation";
import { ClipHistory } from "./clipHistory";
import {
  applyTimelineOperationToHost,
  registerTimelineTransactionHost,
  type TimelineTransactionHost,
} from "./transactions";

const READ_CHUNK = 4 * 1024 * 1024;
const cores = new Map<string, TimelineCore>();
let factoryInstalled = false;

/** What a timeline view holds. `release` only releases this view. */
export interface TimelineController {
  getProject(): Readonly<TimelineProject>;
  subscribe(listener: (project: Readonly<TimelineProject>) => void): () => void;
  apply(operation: TimelineOperation): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  capture(revision: number, contentId: string): Promise<ExportSnapshot>;
  release(): void;
}

async function readSourceBytes(handle: DocumentHandle, size: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 0) throw new TimelineError("timeline.bad_request");
  if (size > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const length = Math.min(READ_CHUNK, TIMELINE_MAX_PROJECT_BYTES + 1 - offset);
    if (length <= 0) break;
    const chunk = await handle.readRange(offset, length);
    if (chunk.length === 0) break;
    chunks.push(chunk);
    offset += chunk.length;
    if (offset > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
    if (offset >= size) break;
  }
  if (offset > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
  const bytes = new Uint8Array(offset);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TimelineError("timeline.bad_request", "project encoding");
  }
}

/** The one model a document shares between views. */
class TimelineCore implements DocumentControllerBinding, TimelineTransactionHost {
  readonly handler_id = TIMELINE_HANDLER_ID;
  readonly documentId: string;
  private readonly context: DocumentControllerContext;
  private project: TimelineProject | null = null;
  private projectRevision = 1;
  private history = new ClipHistory();
  private listeners = new Set<(project: Readonly<TimelineProject>) => void>();
  private handle: DocumentHandle | null = null;
  private ready: Promise<void> | null = null;
  private disposed = false;
  private editingEnabled = true;
  private readonly unregisterHost: () => void;
  private unsubscribeState: (() => void) | null = null;

  constructor(context: DocumentControllerContext) {
    this.context = context;
    this.documentId = context.document_id;
    this.unregisterHost = registerTimelineTransactionHost(this);
  }

  /** Load the project once, from the shared document handle. */
  async attach(handle: DocumentHandle): Promise<void> {
    if (this.handle === handle && this.ready) {
      await this.ready;
      return;
    }
    this.handle = handle;
    if (!this.ready) this.ready = this.initialize(handle);
    await this.ready;
  }

  private async initialize(handle: DocumentHandle): Promise<void> {
    const state = handle.getState();
    this.projectRevision = state.revision;
    const bytes = await readSourceBytes(handle, handle.info.size);
    const file = decodeTimelineFile(decodeText(bytes));
    if (file.kind === "newer") {
      throw new TimelineError("timeline.unsupported", "newer project schema");
    }
    // The native document identity is the initial immutable model state. The
    // file's stored ID is replaced by that identity without changing the file.
    const project = validateTimelineProject({
      ...file.project,
      content_id: this.context.initial_content_id,
    });
    this.project = freezeProject(project);
    this.context.notifyReady({
      editing_enabled: true,
      can_save_existing: true,
      can_save_copy: true,
    });
    this.unsubscribeState = handle.subscribe((next: DocumentState) => {
      this.projectRevision = next.revision;
    });
  }

  getProject(): Readonly<TimelineProject> {
    if (!this.project || this.disposed) throw new TimelineError("timeline.bad_request");
    return this.project;
  }

  getRevision(): number {
    return this.projectRevision;
  }

  getContentId(): string {
    return this.getProject().content_id;
  }

  subscribe(listener: (project: Readonly<TimelineProject>) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const project = this.project;
    if (!project) return;
    for (const listener of this.listeners) {
      try {
        listener(project);
      } catch {
        // A view must never break the shared model.
      }
    }
  }

  async apply(operation: TimelineOperation): Promise<void> {
    await applyTimelineOperationToHost(this, operation);
  }

  async commitProject(next: TimelineProject, label: string): Promise<void> {
    if (this.disposed || !this.project) throw new TimelineError("timeline.bad_request");
    if (!this.editingEnabled) throw new TimelineError("timeline.locked");
    const validated = validateTimelineProject(next);
    // One completed gesture gets one new immutable content identity.
    const committed = validateTimelineProject({
      ...validated,
      content_id: newUuid(),
    });
    this.history.record(this.project, label);
    const state = this.context.notifyContentChanged(committed.content_id);
    this.project = freezeProject(committed);
    this.projectRevision = state.revision;
    this.emit();
  }

  async undo(): Promise<void> {
    if (this.disposed || !this.project) return;
    const previous = this.history.undo(this.project);
    if (!previous) return;
    const state = this.context.notifyContentChanged(previous.content_id);
    this.project = freezeProject(previous);
    this.projectRevision = state.revision;
    this.emit();
  }

  async redo(): Promise<void> {
    if (this.disposed || !this.project) return;
    const next = this.history.redo(this.project);
    if (!next) return;
    const state = this.context.notifyContentChanged(next.content_id);
    this.project = freezeProject(next);
    this.projectRevision = state.revision;
    this.emit();
  }

  async capture(revision: number, contentId: string): Promise<ExportSnapshot> {
    if (this.disposed || !this.project) throw new TimelineError("timeline.failed");
    if (!Number.isSafeInteger(revision) || revision !== this.projectRevision) {
      throw new TimelineError("timeline.changed");
    }
    if (contentId !== this.project.content_id) throw new TimelineError("timeline.changed");
    const bytes = new TextEncoder().encode(encodeTimelineProject(this.project));
    if (bytes.length > TIMELINE_MAX_PROJECT_BYTES) throw new TimelineError("timeline.too_large");
    const begun = await beginExportSnapshot({
      document_id: this.documentId,
      revision,
      content_id: contentId,
      mime: TIMELINE_MIME,
      byte_len: bytes.length,
    });
    try {
      for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
        const chunk = bytes.subarray(offset, Math.min(offset + 1024 * 1024, bytes.length));
        await appendExportSnapshot(begun.snapshot_id, begun.upload_token, offset, chunk);
      }
      const snapshot = await finishExportSnapshot(begun.snapshot_id);
      if (
        snapshot.document_id !== this.documentId ||
        snapshot.revision !== revision ||
        snapshot.content_id !== contentId ||
        snapshot.mime !== TIMELINE_MIME ||
        snapshot.byte_len !== bytes.length
      ) {
        throw new TimelineError("timeline.changed");
      }
      return snapshot;
    } catch (error) {
      try {
        await releaseExportSnapshot(begun.snapshot_id);
      } catch {
        // The snapshot expires on its own; the original project is untouched.
      }
      throw error;
    }
  }

  async discardToSaved(savedContentId: string): Promise<void> {
    if (!this.handle || this.disposed) throw new TimelineError("timeline.failed");
    const bytes = await readSourceBytes(this.handle, this.handle.info.size);
    const file = decodeTimelineFile(decodeText(bytes));
    if (file.kind === "newer") throw new TimelineError("timeline.unsupported");
    const saved = validateTimelineProject({
      ...file.project,
      content_id: savedContentId,
    });
    this.history.clear();
    const notified = this.context.notifyContentChanged(savedContentId);
    this.project = freezeProject(saved);
    this.projectRevision = notified.revision;
    this.emit();
  }

  async setEditingEnabled(enabled: boolean): Promise<void> {
    this.editingEnabled = enabled === true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterHost();
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.listeners.clear();
    this.history.clear();
    if (cores.get(this.documentId) === this) cores.delete(this.documentId);
    this.project = null;
    this.handle = null;
  }

  /** A core is never read directly by views; this exists for the factory. */
  get projectId(): string | null {
    return this.project?.project_id ?? null;
  }
}

/** A per-view reference: release only this view's subscription and registry ref. */
class TimelineView implements TimelineController {
  private readonly unsubscribers = new Set<() => void>();
  private released = false;

  constructor(
    private readonly core: TimelineCore,
    private readonly handle: DocumentHandle,
  ) {}

  getProject(): Readonly<TimelineProject> {
    return this.core.getProject();
  }

  subscribe(listener: (project: Readonly<TimelineProject>) => void): () => void {
    const unsubscribe = this.core.subscribe(listener);
    this.unsubscribers.add(unsubscribe);
    return () => {
      this.unsubscribers.delete(unsubscribe);
      unsubscribe();
    };
  }

  apply(operation: TimelineOperation): Promise<void> {
    return this.core.apply(operation);
  }

  undo(): Promise<void> {
    return this.core.undo();
  }

  redo(): Promise<void> {
    return this.core.redo();
  }

  capture(revision: number, contentId: string): Promise<ExportSnapshot> {
    return this.core.capture(revision, contentId);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.clear();
    DocumentRegistry.release(this.handle.id);
  }
}

function installFactory(): void {
  if (factoryInstalled) return;
  registerDocumentControllerFactory(TIMELINE_HANDLER_ID, async (context) => {
    const core = new TimelineCore(context);
    cores.set(context.document_id, core);
    return core;
  });
  factoryInstalled = true;
}

/**
 * E1: acquire the shared timeline controller for an open document. The 09a
 * registry installs the controller factory on the first editable acquire and
 * returns the same model to every view.
 */
export async function acquireTimeline(document: DocumentHandle): Promise<TimelineController> {
  installFactory();
  const editor = await DocumentRegistry.acquireEditor(document.source, TIMELINE_HANDLER_ID);
  const core = cores.get(editor.id) ?? cores.get(document.id);
  if (!core) {
    DocumentRegistry.release(editor.id);
    throw new TimelineError("timeline.bad_request", "timeline controller missing");
  }
  try {
    await core.attach(editor);
  } catch (error) {
    // A project that failed to parse must not leave a half-installed core or
    // transaction host behind. The 09a registry still owns retry policy.
    await core.dispose();
    DocumentRegistry.release(editor.id);
    throw error;
  }
  return new TimelineView(core, editor);
}

/** Test seam and 19b helper: the shared project of a document, or null. */
export function peekTimelineProject(documentId: string): Readonly<TimelineProject> | null {
  const core = cores.get(documentId);
  return core && core.projectId !== null ? cloneProject(core.getProject()) : null;
}
