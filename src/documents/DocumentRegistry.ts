import {
  abortExportSnapshot,
  appendExportSnapshot,
  finishExportSnapshot,
  releaseExportSnapshot,
  releaseSnapshotAuthority,
  type ExportSnapshot,
} from "../services/exportSnapshots";
import {
  MAX_READ_RANGE,
  beginDocumentSnapshot,
  openDocumentSource,
  readDocumentRange,
  releaseDocumentSource,
  startDocumentCommit,
  type DocumentRebindResult,
  type OpenDocumentResult,
} from "../services/documents";
import {
  documentControllerFactory,
  type DocumentControllerBinding,
} from "./controller";
import { registerRecoveryHandlerId, unregisterRecoveryHandlerId } from "./recoveryScheduler";
import {
  documentSourceKey,
  initialDocumentState,
  providerIdOf,
  stateAfterContentChange,
  stateAfterSave,
  validateDocumentRef,
  type DocumentHandle,
  type DocumentInfo,
  type DocumentProvider,
  type DocumentRef,
  type DocumentState,
} from "./types";
/** The shared document registry (Step 09a E3). One entry per normalized
 * source; views acquire references and the entry lives until the last
 * view releases it. Releasing never discards unsaved changes and never
 * writes the source: disposal only cancels native work, revokes grants
 * and disposes the controller. */

interface DocumentEntry {
  id: string;
  source: DocumentRef;
  key: string;
  info: DocumentInfo;
  state: DocumentState;
  refs: number;
  listeners: Set<(state: DocumentState) => void>;
  native: OpenDocumentResult | null;
  providerHandle: DocumentHandle | null;
  binding: DocumentControllerBinding | null;
  bindingPromise: Promise<DocumentControllerBinding> | null;
  editorHandlerId: string | null;
  sourceGeneration: number;
  released: boolean;
}

const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

class DocumentRegistryImpl {
  private entries = new Map<string, DocumentEntry>();
  private byId = new Map<string, DocumentEntry>();
  private pending = new Map<string, Promise<DocumentEntry>>();
  private providers = new Map<string, DocumentProvider>();

  register(provider: DocumentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`duplicate document provider: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): DocumentHandle | null {
    const entry = this.byId.get(id);
    return entry && !entry.released ? this.viewOf(entry) : null;
  }

  async acquire(source: DocumentRef): Promise<DocumentHandle> {
    const entry = await this.entryFor(source);
    entry.refs += 1;
    return this.viewOf(entry);
  }

  /** Acquire the one editable controller for a document plus a view
   * reference. A second, incompatible editable handler is refused with
   * `documents.editor_conflict`; read-only viewers use `acquire`. */
  async acquireEditor(source: DocumentRef, handlerId: string): Promise<DocumentHandle> {
    const entry = await this.entryFor(source);
    if (entry.editorHandlerId !== null && entry.editorHandlerId !== handlerId) {
      throw new Error("documents.editor_conflict");
    }
    if (!entry.binding) {
      if (!entry.bindingPromise) {
        const factory = documentControllerFactory(handlerId);
        if (!factory) throw new Error("documents.editor_conflict");
        entry.editorHandlerId = handlerId;
        entry.bindingPromise = factory({
          document_id: entry.id,
          source: entry.source,
          info: entry.info,
          initial_source: entry.native?.source_stamp,
          initial_content_id: entry.state.content_id,
          notifyContentChanged: (contentId) => {
            entry.state = stateAfterContentChange(entry.state, contentId);
            this.emit(entry);
            return entry.state;
          },
          notifyReady: (options) => {
            entry.state = {
              ...entry.state,
              ready: true,
              editing_enabled: options.editing_enabled,
              can_save_existing: options.can_save_existing,
              can_save_copy: options.can_save_copy,
            };
            this.emit(entry);
          },
        }).then((binding) => {
          entry.binding = binding;
          entry.bindingPromise = null;
          return binding;
        });
      }
      await entry.bindingPromise;
    }
    // Step 09h E3: the controller owner is the one place that knows the
    // recovery handler of an editable document. Capture needs it; without
    // it the scheduler would warn `recovery.unsupported`.
    if (entry.binding) registerRecoveryHandlerId(entry.id, entry.binding.handler_id);
    entry.refs += 1;
    return this.viewOf(entry);
  }

  release(id: string): void {
    const entry = this.byId.get(id);
    if (!entry || entry.released) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    entry.released = true;
    this.entries.delete(entry.key);
    this.byId.delete(entry.id);
    void this.dispose(entry);
  }

  /** Switch a document to its verified Save-as-new file (E13). Only a
   * result whose source generation follows the entry's current one is
   * applied; a stale or forged result does nothing. The controller, model
   * and view ids are untouched. */
  async applyRebind(result: DocumentRebindResult): Promise<void> {
    if (!result.rebound) return;
    const key = documentSourceKey(result.previous_source);
    const entry = this.entries.get(key);
    if (!entry || entry.released) return;
    if (result.source_generation !== entry.sourceGeneration + 1) return;
    if (result.new_source.kind !== "disk") return;
    entry.source = result.new_source;
    entry.key = documentSourceKey(result.new_source);
    this.entries.delete(key);
    this.entries.set(entry.key, entry);
    entry.sourceGeneration = result.source_generation;
    entry.info = {
      ...entry.info,
      source: result.new_source,
      disk_path: result.new_source.path,
      name: result.new_source.path.split(/[\\/]/).filter(Boolean).pop() ?? entry.info.name,
    };
    entry.state = stateAfterSave(entry.state, result.commit.saved_revision, result.commit.content_id);
    this.emit(entry);
  }

  private async entryFor(source: DocumentRef): Promise<DocumentEntry> {
    const valid = validateDocumentRef(source);
    if (!valid) throw new Error("documents.invalid");
    const key = documentSourceKey(valid);
    const existing = this.entries.get(key);
    if (existing && !existing.released) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const created = this.createEntry(valid, key).then((entry) => {
      this.pending.delete(key);
      this.entries.set(key, entry);
      this.byId.set(entry.id, entry);
      return entry;
    });
    this.pending.set(key, created);
    return created;
  }

  private async createEntry(source: DocumentRef, key: string): Promise<DocumentEntry> {
    if (source.kind === "disk") {
      const opened = await openDocumentSource(source);
      const state = initialDocumentState(opened.document_id);
      return {
        id: opened.document_id,
        source,
        key,
        info: opened.info,
        state: { ...state, ready: true, can_save_copy: true },
        refs: 0,
        listeners: new Set(),
        native: opened,
        providerHandle: null,
        binding: null,
        bindingPromise: null,
        editorHandlerId: null,
        sourceGeneration: 0,
        released: false,
      };
    }
    const provider = this.providers.get(providerIdOf(source));
    if (!provider || !provider.supports(source)) throw new Error("documents.provider_missing");
    const handle = await provider.open(source);
    return {
      id: handle.id,
      source,
      key,
      info: handle.info,
      state: handle.getState(),
      refs: 0,
      listeners: new Set(),
      native: null,
      providerHandle: handle,
      binding: null,
      bindingPromise: null,
      editorHandlerId: null,
      sourceGeneration: 0,
      released: false,
    };
  }

  private async dispose(entry: DocumentEntry): Promise<void> {
    unregisterRecoveryHandlerId(entry.id);
    if (entry.binding) {
      try {
        await entry.binding.dispose();
      } catch {
        // Disposal is best-effort; the entry is already unregistered.
      }
    }
    if (entry.providerHandle) {
      try {
        entry.providerHandle.release();
      } catch {
        // Same as above.
      }
    }
    if (entry.native) {
      try {
        await releaseDocumentSource(entry.id);
      } catch {
        // The native side releases on window close as well.
      }
      try {
        await releaseSnapshotAuthority(entry.id);
      } catch {
        // No authority was registered for this document.
      }
    }
  }

  private emit(entry: DocumentEntry): void {
    for (const listener of entry.listeners) listener(entry.state);
  }

  private viewOf(entry: DocumentEntry): DocumentHandle {
    let released = false;
    const registry = this;
    return {
      // Every view reads the entry, never a snapshot of it: a verified
      // rebind changes the source for all views of the same document.
      get id() {
        return entry.id;
      },
      get source() {
        return entry.source;
      },
      get info() {
        return entry.info;
      },
      get sourceStamp() {
        return entry.native?.source_stamp;
      },
      getState: () => entry.providerHandle?.getState() ?? entry.state,
      subscribe(listener) {
        if (entry.providerHandle) return entry.providerHandle.subscribe(listener);
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      readRange: (offset, length) => registry.readRange(entry, offset, length),
      captureSnapshot: () => registry.captureSnapshot(entry),
      save: () => registry.save(entry),
      saveCopy: (destPath) => registry.saveCopy(entry, destPath),
      discard: () => registry.discard(entry),
      release() {
        if (released) return;
        released = true;
        registry.release(entry.id);
      },
    };
  }

  private async readRange(entry: DocumentEntry, offset: number, length: number): Promise<Uint8Array> {
    if (entry.providerHandle) return entry.providerHandle.readRange(offset, length);
    if (!entry.native) throw new Error("documents.provider_missing");
    return readDocumentRange(entry.native.token, entry.info.name, offset, length);
  }

  private async captureSnapshot(entry: DocumentEntry): Promise<ExportSnapshot> {
    const state = entry.providerHandle?.getState() ?? entry.state;
    if (entry.binding) return entry.binding.capture(state.revision, state.content_id);
    if (entry.providerHandle) return entry.providerHandle.captureSnapshot();
    if (!entry.native) throw new Error("documents.provider_missing");
    if (entry.info.size > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
    // The native document snapshot command checks the registered
    // authority (document, encoder MIME, sensitivity) before any upload.
    const begin = await beginDocumentSnapshot({
      document_id: entry.id,
      captured_revision: state.revision,
      content_id: state.content_id,
      mime: entry.info.mime,
      byte_len: entry.info.size,
    });
    try {
      let offset = 0;
      while (offset < entry.info.size) {
        const length = Math.min(MAX_READ_RANGE, entry.info.size - offset);
        const chunk = await this.readRange(entry, offset, length);
        if (chunk.length === 0) throw new Error("documents.changed");
        let inner = 0;
        while (inner < chunk.length) {
          const part = chunk.subarray(inner, Math.min(inner + 1024 * 1024, chunk.length));
          await appendExportSnapshot(begin.snapshot_id, begin.upload_token, offset + inner, part);
          inner += part.length;
        }
        offset += chunk.length;
      }
      return await finishExportSnapshot(begin.snapshot_id);
    } catch (error) {
      await abortExportSnapshot(begin.snapshot_id).catch(() => undefined);
      throw error;
    }
  }

  private async save(entry: DocumentEntry): Promise<boolean> {
    const state = entry.providerHandle?.getState() ?? entry.state;
    // Replacing an existing file stays unavailable until the approved
    // object proof exists; no provider may claim it from here.
    if (!state.can_save_existing) return false;
    if (entry.providerHandle) return entry.providerHandle.save();
    const snapshot = await this.captureSnapshot(entry);
    const job = await startDocumentCommit({
      document_id: entry.id,
      snapshot_id: snapshot.snapshot_id,
      captured_revision: snapshot.revision,
      content_id: snapshot.content_id,
      expected_source: entry.native?.source_stamp,
      mode: "save",
    });
    const result = await job.completion;
    entry.state = stateAfterSave(entry.state, result.saved_revision, result.content_id);
    this.emit(entry);
    return true;
  }

  private async saveCopy(entry: DocumentEntry, destPath: string): Promise<boolean> {
    if (!(entry.providerHandle?.getState() ?? entry.state).can_save_copy) return false;
    if (entry.providerHandle) return entry.providerHandle.saveCopy(destPath);
    const snapshot = await this.captureSnapshot(entry);
    try {
      const job = await startDocumentCommit({
        document_id: entry.id,
        snapshot_id: snapshot.snapshot_id,
        captured_revision: snapshot.revision,
        content_id: snapshot.content_id,
        expected_source: entry.native?.source_stamp,
        mode: "copy",
        dest_path: destPath,
      });
      await job.completion;
      // A copy is independent. Its publication does not change the live model.
      return true;
    } finally {
      await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    }
  }

  private async discard(entry: DocumentEntry): Promise<void> {
    // A second view still shows this model: closing one view never throws
    // away edits the other view would keep showing (D8).
    if (entry.refs > 1) return;
    if (entry.binding) {
      await entry.binding.discardToSaved(entry.state.saved_content_id);
      entry.state = { ...entry.state, content_id: entry.state.saved_content_id, dirty: false };
      this.emit(entry);
      return;
    }
    if (entry.providerHandle) await entry.providerHandle.discard();
  }
}

/** The one shared registry. */
export const DocumentRegistry = new DocumentRegistryImpl();
export type DocumentRegistryType = DocumentRegistryImpl;
